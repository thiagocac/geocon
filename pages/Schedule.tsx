import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Calendar, RefreshCw, AlertCircle, Save, BarChart3,
} from 'lucide-react';
import {
  getContract, listSchedulePeriods, ensureSchedulePeriods,
  listPhysicalFinancialSchedule, upsertScheduleRow, getCurvaS,
  type SchedulePeriod,
} from '../lib/api';
import { brl } from '../lib/format';
import { humanizeError } from '../lib/errors';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Empty, Skeleton } from '../components/ui/Stat';

export function Schedule() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const { data: contract } = useQuery({
    queryKey: ['contract', id], queryFn: () => getContract(id), enabled: !!id,
  });
  const { data: periods = [], isLoading: loadingPeriods } = useQuery({
    queryKey: ['schedule-periods', id], queryFn: () => listSchedulePeriods(id), enabled: !!id,
  });
  const { data: rows = [], isLoading: loadingRows } = useQuery({
    queryKey: ['schedule-rows', id], queryFn: () => listPhysicalFinancialSchedule(id), enabled: !!id,
  });
  const { data: curva = [] } = useQuery({
    queryKey: ['fin-curva-s', id], queryFn: () => getCurvaS(id), enabled: !!id,
  });

  const ensure = useMutation({
    mutationFn: () => ensureSchedulePeriods(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedule-periods', id] }),
    onError: (e) => setError(humanizeError(e)),
  });

  const saveRow = useMutation({
    mutationFn: (input: { schedule_period_id: string; valor_previsto: number | null }) =>
      upsertScheduleRow({
        contract_id: id,
        schedule_period_id: input.schedule_period_id,
        valor_previsto: input.valor_previsto,
        source: 'manual',
      }),
    onSuccess: (_, vars) => {
      setEditing((prev) => { const next = new Map(prev); next.delete(vars.schedule_period_id); return next; });
      qc.invalidateQueries({ queryKey: ['schedule-rows', id] });
      qc.invalidateQueries({ queryKey: ['fin-curva-s', id] });
    },
    onError: (e) => setError(humanizeError(e)),
  });

  // Agrega valores previstos e realizados por período (rollup geral, sem filtro de lote/disciplina)
  const rollup = useMemo(() => {
    const byPeriod = new Map<string, { previsto: number; realizado: number }>();
    for (const r of rows) {
      if (!r.schedule_period_id) continue;
      const cur = byPeriod.get(r.schedule_period_id) || { previsto: 0, realizado: 0 };
      cur.previsto  += Number(r.valor_previsto || 0);
      cur.realizado += Number(r.valor_realizado || 0);
      byPeriod.set(r.schedule_period_id, cur);
    }
    return byPeriod;
  }, [rows]);

  // Realizado a partir da view curva-s (que vem das medições)
  const realizadoPorMes = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of curva) {
      // chave: YYYY-MM-01
      map.set(p.mes.slice(0, 10), p.valor_realizado_mes);
    }
    return map;
  }, [curva]);

  const totalPrevisto = periods.reduce((s, p) => s + (rollup.get(p.id)?.previsto || 0), 0);
  const totalRealizado = periods.reduce((s, p) => s + (realizadoPorMes.get(p.periodo.slice(0, 10)) || 0), 0);

  return (
    <Layout>
      <PageHeader
        kicker="Contrato · Cronograma"
        title="Cronograma físico-financeiro"
        subtitle="Defina o valor previsto por mês. O realizado vem automaticamente das medições."
        backTo={`/contratos/${id}`} backLabel="Contrato"
        actions={
          periods.length === 0 ? (
            <Button onClick={() => { setError(null); ensure.mutate(); }} loading={ensure.isPending}>
              <Calendar className="h-4 w-4" />Gerar períodos mensais
            </Button>
          ) : null
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {(loadingPeriods || loadingRows) && <Card className="p-6"><Skeleton className="h-64" /></Card>}

      {!loadingPeriods && periods.length === 0 && (
        <Empty
          title="Cronograma não gerado"
          body="Clique em 'Gerar períodos mensais' para criar automaticamente um período por mês entre a data de início e o fim previsto do contrato."
        />
      )}

      {periods.length > 0 && (
        <>
          {/* KPIs */}
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-border-dark dark:bg-card-dark">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Calendar className="h-3.5 w-3.5" />Períodos
              </div>
              <div className="mt-1 text-2xl font-semibold dark:text-slate-100">{periods.length}</div>
              <div className="text-xs text-slate-500">meses de contrato</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-border-dark dark:bg-card-dark">
              <div className="flex items-center gap-2 text-xs text-purple-700 dark:text-purple-300">
                <BarChart3 className="h-3.5 w-3.5" />Total previsto
              </div>
              <div className="mt-1 text-2xl font-semibold tabular dark:text-slate-100">{brl(totalPrevisto)}</div>
              <div className="text-xs text-slate-500">
                {contract && totalPrevisto > 0
                  ? `${((totalPrevisto / Number(contract.valor_atual || contract.valor_inicial)) * 100).toFixed(1)}% do contrato`
                  : 'Preencha os valores na tabela'}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-border-dark dark:bg-card-dark">
              <div className="flex items-center gap-2 text-xs text-navy dark:text-purple-200">
                <BarChart3 className="h-3.5 w-3.5" />Realizado
              </div>
              <div className="mt-1 text-2xl font-semibold tabular dark:text-slate-100">{brl(totalRealizado)}</div>
              <div className="text-xs text-slate-500">
                {totalPrevisto > 0
                  ? `${((totalRealizado / totalPrevisto) * 100).toFixed(1)}% do previsto`
                  : '—'}
              </div>
            </div>
          </div>

          <Card className="overflow-hidden">
            <header className="border-b border-slate-100 px-5 py-3 dark:border-border-dark">
              <h2 className="font-semibold text-sm dark:text-slate-100">Distribuição mensal</h2>
              <p className="text-xs text-slate-500">Edite o "Previsto" para alimentar a Curva S. O realizado é calculado a partir das medições aprovadas.</p>
            </header>
            <table className="table">
              <thead><tr>
                <th>#</th>
                <th>Período</th>
                <th className="text-right">Previsto</th>
                <th className="text-right">Realizado</th>
                <th className="text-right">Δ</th>
                <th className="text-right">% do prev.</th>
                <th />
              </tr></thead>
              <tbody>
                {periods.map((p) => {
                  const previsto = rollup.get(p.id)?.previsto || 0;
                  const realizado = realizadoPorMes.get(p.periodo.slice(0, 10)) || 0;
                  const delta = realizado - previsto;
                  const pct = previsto > 0 ? (realizado / previsto) * 100 : 0;
                  const editValue = editing.get(p.id);
                  const isEditing = editValue !== undefined;
                  return (
                    <tr key={p.id}>
                      <td className="font-mono text-xs text-slate-500">{p.ordem}</td>
                      <td>
                        <div className="font-medium dark:text-slate-100">{p.label}</div>
                        <div className="text-xs text-slate-500">{new Date(p.periodo).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</div>
                      </td>
                      <td className="text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              step="0.01" min="0"
                              value={editValue}
                              onChange={(e) => setEditing((prev) => { const next = new Map(prev); next.set(p.id, e.target.value); return next; })}
                              className="input w-32 text-right tabular"
                              autoFocus
                            />
                            <Button
                              size="sm"
                              onClick={() => saveRow.mutate({ schedule_period_id: p.id, valor_previsto: Number(editValue) || 0 })}
                              loading={saveRow.isPending}
                            >
                              <Save className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="font-mono tabular hover:underline"
                            onClick={() => setEditing((prev) => { const next = new Map(prev); next.set(p.id, String(previsto)); return next; })}
                          >
                            {previsto > 0 ? brl(previsto) : <span className="text-slate-400">—</span>}
                          </button>
                        )}
                      </td>
                      <td className="text-right font-mono tabular">
                        {realizado > 0 ? <span className="text-navy dark:text-purple-300">{brl(realizado)}</span> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="text-right font-mono tabular">
                        {previsto > 0 && realizado > 0 ? (
                          <span className={delta >= 0 ? 'text-green-700 dark:text-green-300' : 'text-error'}>
                            {delta >= 0 ? '+' : ''}{brl(delta)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="text-right">
                        {previsto > 0 ? (
                          <Badge tone={pct >= 95 ? 'green' : pct >= 70 ? 'blue' : pct >= 30 ? 'yellow' : 'slate'}>
                            {pct.toFixed(1)}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td>
                        {isEditing && (
                          <Button variant="ghost" size="sm" onClick={() => setEditing((prev) => { const next = new Map(prev); next.delete(p.id); return next; })}>
                            Cancelar
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 font-semibold dark:border-border-dark">
                  <td colSpan={2}>Total</td>
                  <td className="text-right font-mono tabular">{brl(totalPrevisto)}</td>
                  <td className="text-right font-mono tabular">{brl(totalRealizado)}</td>
                  <td className="text-right font-mono tabular">
                    <span className={totalRealizado - totalPrevisto >= 0 ? 'text-green-700 dark:text-green-300' : 'text-error'}>
                      {totalRealizado - totalPrevisto >= 0 ? '+' : ''}{brl(totalRealizado - totalPrevisto)}
                    </span>
                  </td>
                  <td className="text-right">
                    {totalPrevisto > 0 ? <Badge tone="purple">{((totalRealizado / totalPrevisto) * 100).toFixed(1)}%</Badge> : null}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </Card>

          <p className="mt-4 text-xs text-slate-500">
            <RefreshCw className="mr-1 inline h-3 w-3" />
            Após editar valores, abra o <strong>Painel financeiro</strong> e clique em "Recalcular snapshot" para atualizar os totais agregados.
          </p>
        </>
      )}
    </Layout>
  );
}
