/**
 * auth-bridge — pontes entre auth.users e public.members.
 * Retorna o usuário autenticado + todos os members ativos dele
 * (1 por tenant), com tenants populados.
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient, getUserClient } from '../_shared/client.ts';
import { ok, fail, unauthorized, serverError } from '../_shared/response.ts';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const userClient = getUserClient(req);
    const { data: userResult, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userResult?.user) return unauthorized('JWT inválido');

    const svc = getServiceClient();
    const { data: members, error: memErr } = await svc
      .from('members')
      .select('*, tenants(id,nome,brand_logo_url,ativo,settings)')
      .eq('auth_id', userResult.user.id)
      .eq('active', true)
      .is('deleted_at', null)
      .order('created_at')
      .limit(20);

    if (memErr) throw memErr;

    return ok({
      user: { id: userResult.user.id, email: userResult.user.email },
      members: members || [],
      default_member: (members && members[0]) || null,
    });
  } catch (e) {
    return serverError(e);
  }
});
