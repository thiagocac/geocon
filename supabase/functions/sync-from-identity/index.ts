/**
 * sync-from-identity — webhook do identity hub. Recebe payload com lista de
 * tenants e members do usuário e replica nas tabelas locais.
 *
 * Espera body:
 *   { auth_id: uuid, email: string, tenants: [{id, nome, cnpj, ativo, role, roles[]}] }
 *
 * Idempotente via upsert.
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, serverError } from '../_shared/response.ts';

interface TenantPayload {
  id: string;
  nome: string;
  cnpj?: string;
  ativo?: boolean;
  role: string;
  roles?: string[];
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const authId = body.auth_id as string;
    const email = body.email as string;
    const tenants: TenantPayload[] = body.tenants || [];

    if (!authId || !email || tenants.length === 0) {
      return fail('auth_id, email e tenants[] são obrigatórios');
    }

    const svc = getServiceClient();

    // Upsert tenants
    const tenantRows = tenants.map((t) => ({
      id: t.id,
      nome: t.nome,
      cnpj: t.cnpj || null,
      ativo: t.ativo ?? true,
    }));
    const { error: tErr } = await svc.from('tenants').upsert(tenantRows, { onConflict: 'id' });
    if (tErr) throw tErr;

    // Upsert members (um por tenant)
    const memberRows = tenants.map((t) => ({
      auth_id: authId,
      tenant_id: t.id,
      email,
      nome: body.nome || email.split('@')[0],
      role: t.role || 'viewer',
      roles: t.roles || [t.role || 'viewer'],
      active: true,
    }));
    const { error: mErr } = await svc
      .from('members')
      .upsert(memberRows, { onConflict: 'auth_id,tenant_id' });
    if (mErr) throw mErr;

    return ok({
      synced_tenants: tenantRows.length,
      synced_members: memberRows.length,
    });
  } catch (e) {
    return serverError(e);
  }
});
