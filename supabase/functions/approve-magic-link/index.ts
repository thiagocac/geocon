/**
 * approve-magic-link — fluxo público de aprovação por link mágico.
 *
 * NÃO requer JWT do usuário; a segurança vem da posse do token (hash
 * SHA-256 armazenado em approval_magic_links) + expiração curta.
 *
 * GET ?token=...
 *   → chama RPC get_magic_link_preview e retorna step + medição + contrato
 *
 * POST { token, action: 'aprovar'|'devolver'|'reprovar', comment?, signature_method? }
 *   → chama RPC consume_magic_link e retorna { step_id, new_status, measurement_id }
 */
import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, serverError } from '../_shared/response.ts';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const svc = getServiceClient();

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const token = url.searchParams.get('token');
      if (!token) return fail('Parâmetro token é obrigatório', 400);

      const { data, error } = await svc.rpc('get_magic_link_preview', { p_token: token });
      if (error) {
        return fail(error.message || 'Não foi possível validar o link', 400);
      }
      // A RPC já retorna jsonb com {ok: true, ...}; repassamos sem encapsular de novo
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const token = String(body.token || '');
      const action = String(body.action || '');
      const comment = body.comment ? String(body.comment) : null;
      const signatureMethod = body.signature_method ? String(body.signature_method) : null;

      if (!token) return fail('token é obrigatório', 400);
      if (!['aprovar', 'devolver', 'reprovar'].includes(action)) {
        return fail('action deve ser aprovar | devolver | reprovar', 400);
      }
      if (['devolver', 'reprovar'].includes(action) && !comment?.trim()) {
        return fail(`Comentário obrigatório ao ${action} (RN-018)`, 400);
      }

      const { data, error } = await svc.rpc('consume_magic_link', {
        p_token: token,
        p_action: action,
        p_comment: comment,
        p_signature_method: signatureMethod,
      });
      if (error) {
        return fail(error.message || 'Falha ao processar o link', 400);
      }
      return ok({ result: data });
    }

    return fail('Método não suportado', 405);
  } catch (e) {
    return serverError(e);
  }
});
