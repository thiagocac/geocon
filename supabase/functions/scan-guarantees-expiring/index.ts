/**
 * scan-guarantees-expiring — V53 · cron diário (06:00 UTC sugerido)
 *
 * Para cada garantia ativa ou estendida com `data_vigencia_fim` entre hoje e
 * hoje+7d, insere alert_kind='garantia_vencendo' em `realtime_alerts` —
 * idempotente: skip se já existe alerta não-dismissado para a mesma
 * guarantee_id nos últimos 7 dias.
 *
 * Esta é a 4ª categoria de realtime_alerts (V52 criou 3 via triggers; esta
 * é via cron porque é passagem do tempo, não mudança de estado).
 *
 * Body opcional: { dry_run?: bool, tenant_id?: uuid, days_ahead?: int }
 *   - dry_run: busca mas não insere
 *   - tenant_id: limita a um tenant
 *   - days_ahead: janela de alerta (default 7, max 30)
 *
 * Idempotência:
 *   - Verifica `realtime_alerts` por { contract_id, alert_kind='garantia_vencendo',
 *     metadata->>guarantee_id = X, created_at > now()-7d, dismissed_at IS NULL }
 *   - Se existe, skip. Senão, insere.
 *
 * Resposta:
 *   { processed: int, alerts_created: int, skipped_idempotent: int,
 *     errors: int, by_tenant: [...] }
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, serverError } from '../_shared/response.ts';

const DEFAULT_DAYS_AHEAD = 7;
const MAX_DAYS_AHEAD = 30;

interface ExpiringGuarantee {
  id: string;
  tenant_id: string;
  contract_id: string;
  contract_numero: string;
  numero: number;
  modalidade: string;
  valor_garantido: number;
  data_vigencia_fim: string;
  dias_para_vencimento: number;
}

const MODALIDADE_LABEL: Record<string, string> = {
  caucao_dinheiro:  'Caução em dinheiro',
  caucao_titulos:   'Caução em títulos',
  seguro_garantia:  'Seguro-garantia',
  fianca_bancaria:  'Fiança bancária',
};

function fmtBRL(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
}

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return serverError('Method not allowed', 405);

  let body: { dry_run?: boolean; tenant_id?: string; days_ahead?: number } = {};
  try { body = await req.json(); } catch { /* default */ }

  const dryRun = body.dry_run === true;
  const tenantId = body.tenant_id ?? null;
  const daysAhead = Math.min(
    MAX_DAYS_AHEAD,
    Math.max(1, body.days_ahead ?? DEFAULT_DAYS_AHEAD),
  );

  const supabase = getServiceClient();

  // Query: garantias ativas/estendidas com vigência entre hoje e hoje+days_ahead
  let q = supabase
    .from('contract_guarantees')
    .select(`
      id, contract_id, numero, modalidade, valor_garantido, data_vigencia_fim,
      contracts!inner ( tenant_id, numero )
    `)
    .in('status', ['ativa', 'estendida'])
    .gte('data_vigencia_fim', new Date().toISOString().slice(0, 10))
    .lte(
      'data_vigencia_fim',
      new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10),
    );

  if (tenantId) {
    q = q.eq('contracts.tenant_id', tenantId);
  }

  const { data: rows, error: qErr } = await q;
  if (qErr) return serverError(`Query failed: ${qErr.message}`, 500);

  const expiring: ExpiringGuarantee[] = (rows || []).map((r: Record<string, unknown>) => {
    const contracts = r.contracts as { tenant_id: string; numero: string };
    const dataFim = r.data_vigencia_fim as string;
    const dias = Math.ceil(
      (new Date(dataFim).getTime() - Date.now()) / 86_400_000,
    );
    return {
      id: r.id as string,
      tenant_id: contracts.tenant_id,
      contract_id: r.contract_id as string,
      contract_numero: contracts.numero,
      numero: r.numero as number,
      modalidade: r.modalidade as string,
      valor_garantido: Number(r.valor_garantido),
      data_vigencia_fim: dataFim,
      dias_para_vencimento: dias,
    };
  });

  // Para cada garantia: verifica idempotência + insere
  const byTenant = new Map<string, { created: number; skipped: number; errors: number }>();
  let alertsCreated = 0;
  let skippedIdempotent = 0;
  let errors = 0;

  for (const g of expiring) {
    const tenantSum = byTenant.get(g.tenant_id) ?? { created: 0, skipped: 0, errors: 0 };

    // Idempotência: alerta para esta guarantee criado nos últimos 7d?
    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: existing, error: chkErr } = await supabase
      .from('realtime_alerts')
      .select('id')
      .eq('tenant_id', g.tenant_id)
      .eq('contract_id', g.contract_id)
      .eq('alert_kind', 'garantia_vencendo')
      .eq('metadata->>guarantee_id', g.id)
      .gte('created_at', cutoff)
      .is('dismissed_at', null)
      .limit(1);

    if (chkErr) {
      errors++;
      tenantSum.errors++;
      byTenant.set(g.tenant_id, tenantSum);
      continue;
    }

    if (existing && existing.length > 0) {
      skippedIdempotent++;
      tenantSum.skipped++;
      byTenant.set(g.tenant_id, tenantSum);
      continue;
    }

    if (dryRun) {
      alertsCreated++;  // count what would be created
      tenantSum.created++;
      byTenant.set(g.tenant_id, tenantSum);
      continue;
    }

    const severity = g.dias_para_vencimento <= 3 ? 'danger' : 'warning';
    const modLabel = MODALIDADE_LABEL[g.modalidade] || g.modalidade;
    const title = `Garantia GA-${String(g.numero).padStart(5, '0')} vence em ${g.dias_para_vencimento} dia${g.dias_para_vencimento === 1 ? '' : 's'}`;
    const bodyText = `${modLabel} · ${fmtBRL(g.valor_garantido)} · contrato ${g.contract_numero}`;
    const refLink = `/contratos/${g.contract_id}/garantias`;

    const { error: insErr } = await supabase.rpc('_insert_realtime_alert', {
      p_tenant_id:   g.tenant_id,
      p_contract_id: g.contract_id,
      p_alert_kind:  'garantia_vencendo',
      p_severity:    severity,
      p_title:       title,
      p_body:        bodyText,
      p_ref_link:    refLink,
      p_metadata: {
        guarantee_id: g.id,
        guarantee_numero: g.numero,
        modalidade: g.modalidade,
        valor: g.valor_garantido,
        dias_para_vencimento: g.dias_para_vencimento,
        data_vigencia_fim: g.data_vigencia_fim,
      },
    });

    if (insErr) {
      errors++;
      tenantSum.errors++;
    } else {
      alertsCreated++;
      tenantSum.created++;
    }
    byTenant.set(g.tenant_id, tenantSum);
  }

  return ok({
    processed: expiring.length,
    alerts_created: alertsCreated,
    skipped_idempotent: skippedIdempotent,
    errors,
    dry_run: dryRun,
    days_ahead: daysAhead,
    by_tenant: Array.from(byTenant.entries()).map(([tid, s]) => ({
      tenant_id: tid, ...s,
    })),
  });
});
