import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, serverError } from '../_shared/response.ts';

/**
 * recalc-financial-snapshot
 * Input: { contract_id: uuid, ensure_periods?: boolean }
 * Output: { contract_id, snapshot_id, snapshot: {...} }
 */
Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const contractId = body.contract_id as string;
    const ensurePeriods = !!body.ensure_periods;
    if (!contractId) return fail('contract_id obrigatório');

    const svc = getServiceClient();

    if (ensurePeriods) {
      const { error: epErr } = await svc.rpc('ensure_schedule_periods', { p_contract_id: contractId });
      if (epErr) console.warn('[ensure_schedule_periods]', epErr.message);
    }

    const { data: snapId, error } = await svc.rpc('recalc_financial_snapshot', { p_contract_id: contractId });
    if (error) throw error;

    const { data: snapshot } = await svc.from('contract_financial_snapshots')
      .select('*').eq('id', snapId).maybeSingle();

    return ok({ contract_id: contractId, snapshot_id: snapId, snapshot });
  } catch (e) {
    return serverError(e);
  }
});
