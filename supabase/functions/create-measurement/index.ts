/**
 * create-measurement — cria nova medição num contrato. Encapsula RPC
 * create_measurement_period (que valida período não sobreposto, status
 * do contrato e numera sequencialmente).
 *
 * Body:
 *   { contract_id, periodo_inicio, periodo_fim, tipo?, complementar_de? }
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
    const { contract_id, periodo_inicio, periodo_fim, tipo, complementar_de } = body;

    if (!contract_id || !periodo_inicio || !periodo_fim) {
      return fail('contract_id, periodo_inicio, periodo_fim obrigatórios');
    }

    const { data, error } = await userClient.rpc('create_measurement_period', {
      p_contract_id: contract_id,
      p_periodo_inicio: periodo_inicio,
      p_periodo_fim: periodo_fim,
      p_tipo: tipo || 'mensal_quantitativo',
      p_complementar_de: complementar_de || null,
    });

    if (error) throw error;

    return ok({ measurement_id: data });
  } catch (e) {
    return serverError(e);
  }
});
