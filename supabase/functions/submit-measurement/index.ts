/**
 * submit-measurement — wrapper REST sobre a RPC submit_measurement.
 * Exige JWT do usuário. Transição rascunho/preliminar/devolvida → em_aprovacao,
 * instancia workflow (se houver template) e marca data_emissao = CURRENT_DATE.
 *
 * Body: { measurement_id: uuid }
 * Output: { ok, measurement_id, new_status, items, workflow_steps_created, ... }
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
    const measurementId = String(body.measurement_id || '');
    if (!measurementId) return fail('measurement_id é obrigatório');

    const { data, error } = await userClient.rpc('submit_measurement', {
      p_measurement_id: measurementId,
    });
    if (error) return fail(error.message || 'Falha ao submeter medição', 400);

    return ok({ result: data });
  } catch (e) {
    return serverError(e);
  }
});
