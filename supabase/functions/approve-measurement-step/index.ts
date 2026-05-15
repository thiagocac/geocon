/**
 * approve-measurement-step — wrapper REST sobre a RPC decide_approval_step.
 * Exige JWT do usuário (a RPC valida o member via auth.uid()).
 *
 * Body:
 *   {
 *     step_id: string,
 *     action: 'aprovar' | 'devolver' | 'reprovar',
 *     comment?: string,
 *     signature_method?: string | null
 *   }
 *
 * O cliente web hoje chama `supabase.rpc('decide_approval_step', ...)` direto;
 * esta EF existe como ponto único para integrações externas (webhook, CLI, etc).
 */
import { handleCors } from '../_shared/cors.ts';
import { getUserClient } from '../_shared/client.ts';
import { ok, fail, unauthorized, serverError } from '../_shared/response.ts';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const userClient = getUserClient(req);
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return unauthorized();

    const body = await req.json().catch(() => ({}));
    const stepId = String(body.step_id || '');
    const action = String(body.action || '');
    const comment = body.comment ? String(body.comment) : null;
    const signatureMethod = body.signature_method ? String(body.signature_method) : null;

    if (!stepId) return fail('step_id é obrigatório');
    if (!['aprovar', 'devolver', 'reprovar'].includes(action)) {
      return fail('action deve ser aprovar | devolver | reprovar');
    }
    if (['devolver', 'reprovar'].includes(action) && !comment?.trim()) {
      return fail(`Comentário obrigatório ao ${action} (RN-018)`);
    }

    const { data, error } = await userClient.rpc('decide_approval_step', {
      p_step_id: stepId,
      p_action: action,
      p_comment: comment,
      p_signature_method: signatureMethod,
    });
    if (error) return fail(error.message || 'Falha ao decidir etapa', 400);

    return ok({ step_id: stepId, action, result: data });
  } catch (e) {
    return serverError(e);
  }
});
