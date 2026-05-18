/**
 * refresh-risk-snapshots
 *
 * Atualiza em batch os snapshots de risco de contratos com snapshot
 * ausente ou stale (mais antigo que `max_age_days`).
 *
 * Modos de chamada:
 *
 *   1) Manual (admin via UI, autenticado):
 *      POST { tenant_id?, max_age_days?: 14, max_contracts?: 50 }
 *      → usa rpc contracts_needing_risk_refresh com tenant_id resolvido
 *        pelo current_tenant_id (ignora p_tenant_id, segurança).
 *
 *   2) Scheduled (cron / scheduled function, service_role):
 *      POST { tenant_id, max_age_days, max_contracts }
 *      → resolve por tenant_id explícito; varre todos os tenants se
 *        body.all_tenants === true.
 *
 * Resposta:
 *   { tenant_id?, refreshed: [{ contract_id, numero, score, nivel }],
 *     errors: [{ contract_id, message }], total }
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient, getUserClient, getAuthUser } from '../_shared/client.ts';
import { ok, fail as failResp, serverError } from '../_shared/response.ts';

interface StaleRow {
  contract_id: string;
  tenant_id: string;
  numero: string;
  objeto: string;
  last_snapshot_at: string | null;
  freshness: string;
}

async function refreshOne(
  svc: ReturnType<typeof getServiceClient>,
  contractId: string,
  source: 'cron' | 'manual',
): Promise<{ ok: boolean; row?: { contract_id: string; score: number; nivel: string }; error?: string }> {
  // capture_risk_snapshot grava em contract_risk_snapshots e retorna a linha
  const { data, error } = await svc.rpc('capture_risk_snapshot', {
    p_contract_id: contractId,
    p_source: source,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  // data pode vir como objeto ou array de 1 elemento dependendo do driver
  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    row: {
      contract_id: contractId,
      score: row?.score ?? 0,
      nivel: row?.nivel ?? 'estavel',
    },
  };
}

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  try {
    if (req.method !== 'POST') return failResp('Use POST', 405);
    const body = await req.json().catch(() => ({}));
    const maxAge = Math.max(1, Math.min(90, Number(body?.max_age_days ?? 14)));
    const maxContracts = Math.max(1, Math.min(500, Number(body?.max_contracts ?? 50)));
    const allTenants = body?.all_tenants === true;
    const explicitTenantId = body?.tenant_id as string | undefined;

    const svc = getServiceClient();

    /* ---------- Scheduled / all tenants ---------- */
    if (allTenants) {
      // Apenas service_role pode disparar pra todos os tenants — verifica via header
      const auth = req.headers.get('Authorization') || '';
      const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      if (!auth.includes(svcKey)) {
        return failResp('all_tenants=true requer service_role', 401);
      }
      const { data: rows, error } = await svc.from('v_contracts_stale_risk')
        .select('contract_id, tenant_id, numero, objeto, last_snapshot_at, freshness')
        .or(`last_snapshot_at.is.null,last_snapshot_at.lt.${new Date(Date.now() - maxAge * 86400_000).toISOString()}`)
        .limit(maxContracts);
      if (error) return failResp(error.message);

      const refreshed: Array<{ contract_id: string; score: number; nivel: string; tenant_id: string }> = [];
      const errors: Array<{ contract_id: string; tenant_id: string; message: string }> = [];
      for (const r of (rows || []) as StaleRow[]) {
        const out = await refreshOne(svc, r.contract_id, 'cron');
        if (out.ok && out.row) refreshed.push({ ...out.row, tenant_id: r.tenant_id });
        else errors.push({ contract_id: r.contract_id, tenant_id: r.tenant_id, message: out.error || 'erro' });
      }
      return ok({ scope: 'all_tenants', total: refreshed.length, refreshed, errors });
    }

    /* ---------- Manual (autenticado) ---------- */
    if (explicitTenantId) {
      // service_role pode forçar tenant_id; usuário não pode
      const auth = req.headers.get('Authorization') || '';
      const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      if (!auth.includes(svcKey)) {
        return failResp('tenant_id explícito requer service_role', 401);
      }
      const { data: rows, error } = await svc.from('v_contracts_stale_risk')
        .select('contract_id, tenant_id, numero, objeto, last_snapshot_at, freshness')
        .eq('tenant_id', explicitTenantId)
        .or(`last_snapshot_at.is.null,last_snapshot_at.lt.${new Date(Date.now() - maxAge * 86400_000).toISOString()}`)
        .limit(maxContracts);
      if (error) return failResp(error.message);

      const refreshed: Array<{ contract_id: string; score: number; nivel: string }> = [];
      const errors: Array<{ contract_id: string; message: string }> = [];
      for (const r of (rows || []) as StaleRow[]) {
        const out = await refreshOne(svc, r.contract_id, 'cron');
        if (out.ok && out.row) refreshed.push(out.row);
        else errors.push({ contract_id: r.contract_id, message: out.error || 'erro' });
      }
      return ok({ tenant_id: explicitTenantId, total: refreshed.length, refreshed, errors });
    }

    // Usuário autenticado — usa current_tenant_id via RPC
    await getAuthUser(req); // valida JWT
    const userSupa = getUserClient(req);
    const { data: rows, error } = await userSupa.rpc('contracts_needing_risk_refresh', {
      p_max_age_days: maxAge,
      p_limit: maxContracts,
    });
    if (error) return failResp(error.message);

    const refreshed: Array<{ contract_id: string; numero: string; score: number; nivel: string }> = [];
    const errors: Array<{ contract_id: string; numero: string; message: string }> = [];
    for (const r of (rows || []) as Array<StaleRow & { numero: string }>) {
      const out = await refreshOne(svc, r.contract_id, 'manual');
      if (out.ok && out.row) refreshed.push({ ...out.row, numero: r.numero });
      else errors.push({ contract_id: r.contract_id, numero: r.numero, message: out.error || 'erro' });
    }
    return ok({ total: refreshed.length, refreshed, errors });
  } catch (err) {
    return serverError(err);
  }
});
