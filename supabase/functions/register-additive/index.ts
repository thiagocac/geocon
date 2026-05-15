/**
 * register-additive — registra um aditivo. Encapsula a RPC register_additive,
 * que verifica limites legais (25%/50%), trava SOV vigente e cria entrada
 * em additives + additive_items.
 *
 * Body:
 *   { contract_id, tipo, valor_acrescimo, valor_decrescimo, prazo_execucao_dias?,
 *     justificativa, items?: [{contract_item_id?, codigo, descricao, unidade, quantidade, preco_unitario, bdi?}] }
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

    const body = await req.json();
    const { contract_id, tipo, valor_acrescimo, valor_decrescimo, prazo_execucao_dias, justificativa, items } = body;

    if (!contract_id || !tipo || !justificativa) {
      return fail('contract_id, tipo e justificativa obrigatórios');
    }

    const { data, error } = await userClient.rpc('register_additive', {
      p_contract_id: contract_id,
      p_tipo: tipo,
      p_valor_acrescimo: Number(valor_acrescimo || 0),
      p_valor_decrescimo: Number(valor_decrescimo || 0),
      p_prazo_execucao_dias: Number(prazo_execucao_dias || 0),
      p_justificativa: justificativa,
      p_items: items || [],
    });

    if (error) throw error;

    return ok({ additive_id: data });
  } catch (e) {
    return serverError(e);
  }
});
