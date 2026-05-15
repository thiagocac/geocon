/**
 * register-payment — wrapper REST sobre register_payment_event.
 * Body: { measurement_id, valor_pago, data_pagamento, numero_ordem_bancaria?, nota_fiscal?, observacao? }
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
    const valorPago = Number(body.valor_pago || 0);
    const dataPagamento = String(body.data_pagamento || '');
    const ordem = body.numero_ordem_bancaria ? String(body.numero_ordem_bancaria) : null;
    const nf = body.nota_fiscal ? String(body.nota_fiscal) : null;
    const obs = body.observacao ? String(body.observacao) : null;

    if (!measurementId) return fail('measurement_id é obrigatório');
    if (!valorPago || valorPago <= 0) return fail('valor_pago deve ser > 0');
    if (!dataPagamento) return fail('data_pagamento é obrigatória');

    const { data, error } = await userClient.rpc('register_payment_event', {
      p_measurement_id: measurementId,
      p_valor_pago: valorPago,
      p_data_pagamento: dataPagamento,
      p_numero_ordem_bancaria: ordem,
      p_nota_fiscal: nf,
      p_observacao: obs,
    });
    if (error) return fail(error.message || 'Falha ao registrar pagamento', 400);

    return ok({ event_id: data });
  } catch (e) {
    return serverError(e);
  }
});
