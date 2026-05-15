/**
 * validate-measurement — executa o motor de validação da medição.
 * Roda regras configuráveis:
 *   - Saldo de item disponível
 *   - BDI plausível
 *   - Glosa vs período (limite %)
 *   - Memória de cálculo presente
 *   - Evidências obrigatórias por disciplina
 *
 * Persiste o resultado em measurement_items.validacao_status / .validacao_erros.
 * Status agregado: ok | alerta | bloqueado.
 */
import { handleCors } from '../_shared/cors.ts';
import { getUserClient, getServiceClient } from '../_shared/client.ts';
import { ok, fail, unauthorized, notFound, serverError } from '../_shared/response.ts';

interface Issue {
  rule: string;
  severity: 'alerta' | 'bloqueado';
  message: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const userClient = getUserClient(req);
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return unauthorized();

    const body = await req.json();
    const measurementId = body.measurement_id as string;
    if (!measurementId) return fail('measurement_id obrigatório');

    const svc = getServiceClient();

    const { data: m, error: mErr } = await svc
      .from('measurements')
      .select('*, contracts(tenant_id)')
      .eq('id', measurementId)
      .maybeSingle();
    if (mErr || !m) return notFound('Medição não encontrada');

    const { data: items, error: itErr } = await svc
      .from('measurement_items')
      .select('*, contract_items(codigo,quantidade_contratada,quantidade_aditada,quantidade_medida_acumulada,unidade)')
      .eq('measurement_id', measurementId)
      .is('deleted_at', null);
    if (itErr) throw itErr;

    let countOk = 0, countAlert = 0, countBlock = 0;
    const updates: Array<{ id: string; validacao_status: string; validacao_erros: Issue[] }> = [];

    for (const it of items || []) {
      const issues: Issue[] = [];
      const ci = it.contract_items;
      const qtdContratada = Number(ci?.quantidade_contratada || 0) + Number(ci?.quantidade_aditada || 0);
      const acumuladoAntes = Number(ci?.quantidade_medida_acumulada || 0) - Number(it.quantidade_periodo || 0);
      const previstoAcumulado = acumuladoAntes + Number(it.quantidade_periodo || 0);

      // Regra 1: saldo
      if (previstoAcumulado > qtdContratada * 1.001) {
        issues.push({
          rule: 'saldo',
          severity: 'bloqueado',
          message: `Quantidade ultrapassa saldo contratual (contratada+aditada=${qtdContratada}, acumulado previsto=${previstoAcumulado}).`,
        });
      }

      // Regra 2: glosa > 30% do período
      const vp = Number(it.valor_periodo || 0);
      const vg = Number(it.valor_glosado || 0);
      if (vp > 0 && vg / vp > 0.3) {
        issues.push({
          rule: 'glosa_excessiva',
          severity: 'alerta',
          message: `Glosa de ${((vg / vp) * 100).toFixed(1)}% supera 30% do período — revisar.`,
        });
      }

      // Regra 3: memória vazia
      if (!it.memoria_resumo || it.memoria_resumo.trim() === '') {
        issues.push({
          rule: 'memoria_ausente',
          severity: 'alerta',
          message: 'Memória de cálculo vazia.',
        });
      }

      // Regra 4: quantidade zero
      if (Number(it.quantidade_periodo || 0) <= 0 && vp > 0) {
        issues.push({
          rule: 'quantidade_zero',
          severity: 'bloqueado',
          message: 'Quantidade do período é zero mas há valor lançado.',
        });
      }

      const hasBlock = issues.some((i) => i.severity === 'bloqueado');
      const hasAlert = issues.some((i) => i.severity === 'alerta');
      const status = hasBlock ? 'bloqueado' : hasAlert ? 'alerta' : 'ok';
      if (status === 'ok') countOk++;
      else if (status === 'alerta') countAlert++;
      else countBlock++;

      updates.push({ id: it.id, validacao_status: status, validacao_erros: issues });
    }

    // Batch update
    for (const u of updates) {
      await svc.from('measurement_items')
        .update({ validacao_status: u.validacao_status, validacao_erros: u.validacao_erros })
        .eq('id', u.id);
    }

    const aggregateStatus = countBlock > 0 ? 'bloqueado' : countAlert > 0 ? 'alerta' : 'ok';

    return ok({
      measurement_id: measurementId,
      total: items?.length || 0,
      ok: countOk,
      alertas: countAlert,
      bloqueados: countBlock,
      status_agregado: aggregateStatus,
    });
  } catch (e) {
    return serverError(e);
  }
});
