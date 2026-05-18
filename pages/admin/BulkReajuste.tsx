import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  TrendingUp, RefreshCw, AlertTriangle, CheckCircle2, Calculator, FileBadge,
  Filter, Layers,
} from 'lucide-react';
import {
  listReajusteCandidates, bulkSimulateReajuste, bulkApplyReajuste,
  listAdjustmentIndices,
  type ReajusteCandidate, type BulkSimRow, type BulkApplyRow, type AdjustmentIndex,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Field, Select } from '../../components/ui/FormField';
import { Skeleton, Empty } from '../../components/ui/Stat';

function brl(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
  });
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(4)}%`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

type Step = 'filter' | 'simulate' | 'apply' | 'result';

export function AdminBulkReajuste() {
  const qc = useQueryClient();

  // Filtros
  const [windowDays, setWindowDays] = useState(30);
  const [onlyDue, setOnlyDue] = useState(false);
  const [indexFilter, setIndexFilter] = useState<string>('');

  // Seleção
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Wizard
  const [step, setStep] = useState<Step>('filter');
  const [targetDate, setTargetDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [createAdditive, setCreateAdditive] = useState(false);
  const [simRows, setSimRows] = useState<BulkSimRow[] | null>(null);
  const [applyRows, setApplyRows] = useState<BulkApplyRow[] | null>(null);

  const { data: indices = [] } = useQuery({
    queryKey: ['adjustment-indices'],
    queryFn: listAdjustmentIndices,
  });

  const { data: candidates = [], isLoading, error, refetch } = useQuery({
    queryKey: ['reajuste-candidates', windowDays, onlyDue, indexFilter],
    queryFn: () => listReajusteCandidates({
      window_days: windowDays,
      only_due: onlyDue,
      index_id: indexFilter || null,
    }),
  });

  const dueCount = useMemo(() => candidates.filter((c) => c.is_due).length, [candidates]);
  const upcomingCount = candidates.length - dueCount;

  const allSelected = candidates.length > 0 && candidates.every((c) => selectedIds.has(c.contract_id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(candidates.map((c) => c.contract_id)));
  }

  function selectAllDue() {
    setSelectedIds(new Set(candidates.filter((c) => c.is_due).map((c) => c.contract_id)));
  }

  const mSimulate = useMutation({
    mutationFn: () => bulkSimulateReajuste([...selectedIds], targetDate),
    onSuccess: (rows) => { setSimRows(rows); setStep('apply'); },
  });

  const mApply = useMutation({
    mutationFn: () => bulkApplyReajuste([...selectedIds], targetDate, notes || undefined, createAdditive),
    onSuccess: (rows) => {
      setApplyRows(rows);
      setStep('result');
      qc.invalidateQueries({ queryKey: ['reajuste-candidates'] });
    },
  });

  function reset() {
    setStep('filter');
    setSelectedIds(new Set());
    setSimRows(null);
    setApplyRows(null);
    setNotes('');
    setCreateAdditive(false);
  }

  // Estatísticas da simulação
  const simStats = useMemo(() => {
    if (!simRows) return null;
    const okRows = simRows.filter((r) => r.ok);
    const totalDelta = okRows.reduce((sum, r) => sum + Number(r.delta || 0), 0);
    const errored = simRows.length - okRows.length;
    return { applicable: okRows.length, errored, totalDelta };
  }, [simRows]);

  // Estatísticas do resultado
  const resultStats = useMemo(() => {
    if (!applyRows) return null;
    const okRows = applyRows.filter((r) => r.ok);
    const totalDelta = okRows.reduce((sum, r) => sum + Number(r.delta || 0), 0);
    const errored = applyRows.length - okRows.length;
    const additivesCreated = okRows.filter((r) => r.additive_id).length;
    return { ok: okRows.length, errored, totalDelta, additivesCreated };
  }, [applyRows]);

  return (
    <Layout>
      <PageHeader
        kicker="Administração · Operação"
        title="Reajuste em massa"
        subtitle="Aplica reajuste em múltiplos contratos com base na regra de cada um. Simulação prévia obrigatória."
        backTo="/admin"
        backLabel="Admin"
        actions={
          <Button variant="outline" onClick={() => refetch()} loading={isLoading}>
            <RefreshCw className="h-4 w-4" />Recarregar
          </Button>
        }
      />

      {/* KPIs */}
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Card densityAware className="p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">Candidatos</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular dark:text-slate-100">{candidates.length}</p>
        </Card>
        <Card densityAware className="p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">Vencidos</p>
          <p className={`mt-1 font-mono text-2xl font-bold tabular ${dueCount > 0 ? 'text-error' : 'text-slate-500'}`}>{dueCount}</p>
        </Card>
        <Card densityAware className="p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">Vencendo em {windowDays}d</p>
          <p className={`mt-1 font-mono text-2xl font-bold tabular ${upcomingCount > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-slate-500'}`}>{upcomingCount}</p>
        </Card>
      </div>

      {/* Filtros */}
      <Card className="mb-4 p-4">
        <div className="mb-2 flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-slate-500" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">Filtros</span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Janela (dias)" hint="Inclui contratos vencendo nos próximos N dias">
            <Select
              value={String(windowDays)}
              onChange={(e) => setWindowDays(Number(e.target.value))}
              options={[
                { value: '0',   label: 'Apenas vencidos hoje' },
                { value: '15',  label: 'Vencem em 15 dias' },
                { value: '30',  label: 'Vencem em 30 dias' },
                { value: '60',  label: 'Vencem em 60 dias' },
                { value: '90',  label: 'Vencem em 90 dias' },
              ]}
            />
          </Field>
          <Field label="Índice">
            <Select
              value={indexFilter}
              onChange={(e) => setIndexFilter(e.target.value)}
              options={[
                { value: '', label: 'Todos os índices' },
                ...(indices as AdjustmentIndex[]).map((i) => ({ value: i.id, label: `${i.codigo} — ${i.nome}` })),
              ]}
            />
          </Field>
          <Field label="Comportamento">
            <label className="flex h-[42px] items-center gap-2 rounded-md border border-slate-300 bg-white px-3 dark:border-border-dark dark:bg-card-dark">
              <input
                type="checkbox"
                checked={onlyDue}
                onChange={(e) => setOnlyDue(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-magenta focus:ring-magenta"
              />
              <span className="text-xs dark:text-slate-200">Apenas vencidos</span>
            </label>
          </Field>
        </div>
      </Card>

      {/* Toolbar de seleção */}
      {selectedIds.size > 0 && (
        <Card className="mb-3 border-magenta/30 bg-magenta/5 p-3 dark:bg-magenta/10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium dark:text-slate-200">
              {selectedIds.size} {selectedIds.size === 1 ? 'selecionado' : 'selecionados'}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>
                Limpar
              </Button>
              <Button
                size="sm"
                onClick={() => { setStep('simulate'); mSimulate.mutate(); }}
                loading={mSimulate.isPending}
              >
                <Calculator className="h-4 w-4" />Simular {selectedIds.size}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Tabela */}
      {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}

      {!isLoading && candidates.length === 0 && (
        <Empty
          title="Nenhum candidato"
          body={onlyDue
            ? 'Nenhum contrato com reajuste vencido hoje.'
            : `Nenhum contrato com aniversário até ${windowDays} dias.`}
        />
      )}

      {error && (
        <Card className="border-error/30 bg-error/5 p-4 text-sm text-error">
          <AlertTriangle className="mr-1 inline h-4 w-4" />
          {humanizeError(error as Error)}
        </Card>
      )}

      {candidates.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected; }}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-slate-300 text-magenta focus:ring-magenta"
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th>Contrato</th>
                  <th className="hidden md:table-cell">Índice</th>
                  <th>Aniversário</th>
                  <th className="hidden lg:table-cell text-right">Valor atual</th>
                  <th className="text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.contract_id} className="hover:bg-slate-50 dark:hover:bg-muted-dark/40">
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.contract_id)}
                        onChange={() => toggleSelected(c.contract_id)}
                        className="h-4 w-4 rounded border-slate-300 text-magenta focus:ring-magenta"
                        aria-label={`Selecionar ${c.contract_numero}`}
                      />
                    </td>
                    <td>
                      <Link
                        to={`/contratos/${c.contract_id}/reajustes`}
                        className="text-sm font-medium text-magenta hover:underline dark:text-purple-300"
                      >
                        {c.contract_numero}
                      </Link>
                      <p className="line-clamp-1 text-[11px] text-slate-500 dark:text-slate-400">
                        {c.objeto || '—'}
                      </p>
                    </td>
                    <td className="hidden md:table-cell">
                      <Badge tone="blue">{c.index_codigo}</Badge>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                        a cada {c.periodicidade_meses}m · {c.events_count} aplicação(ões)
                      </p>
                    </td>
                    <td>
                      <p className="font-mono text-xs dark:text-slate-200">{fmtDate(c.next_anniversary)}</p>
                      <p className="font-mono text-[10px] text-slate-500">base: {fmtDate(c.last_reference_date)}</p>
                    </td>
                    <td className="hidden lg:table-cell text-right font-mono tabular text-xs dark:text-slate-200">
                      {brl(c.valor_total_atual)}
                    </td>
                    <td className="text-center">
                      {c.is_due
                        ? <Badge tone="red">Vencido</Badge>
                        : <Badge tone="yellow">Próximo</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dueCount > 0 && (
            <div className="border-t border-slate-200 px-4 py-2 dark:border-border-dark">
              <button
                type="button"
                onClick={selectAllDue}
                className="font-mono text-[10px] uppercase tracking-display text-magenta hover:underline"
              >
                Selecionar todos os {dueCount} vencidos
              </button>
            </div>
          )}
        </Card>
      )}

      {/* Modal: revisar simulação + aplicar */}
      <Modal
        open={step === 'apply' || step === 'simulate'}
        onClose={() => { if (step === 'apply') setStep('filter'); }}
        title={step === 'simulate' ? 'Simulando…' : 'Revisar simulação'}
        subtitle={simStats
          ? `${simStats.applicable} aplicáveis · ${simStats.errored} com erro · impacto total ${brl(simStats.totalDelta)}`
          : ''}
        size="lg"
        footer={
          step === 'apply' && simStats && simStats.applicable > 0 ? (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep('filter')}>Voltar</Button>
              <Button onClick={() => mApply.mutate()} loading={mApply.isPending}>
                <CheckCircle2 className="h-4 w-4" />Aplicar {simStats.applicable}
              </Button>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setStep('filter')}>Fechar</Button>
            </div>
          )
        }
      >
        {mSimulate.isPending && <div className="py-8 text-center"><Skeleton className="h-24" /></div>}

        {simRows && (
          <div className="space-y-3">
            <Field label="Data alvo do reajuste">
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="input"
              />
            </Field>

            <Field label="Observação aplicada a TODOS" hint="Ex: PA-2025-001 — Reajuste anual lote primeiro semestre">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
                className="input"
              />
            </Field>

            <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition ${
              createAdditive
                ? 'border-magenta/50 bg-magenta/5 dark:border-magenta/40'
                : 'border-slate-200 hover:border-slate-300 dark:border-border-dark'
            }`}>
              <input
                type="checkbox"
                checked={createAdditive}
                onChange={(e) => setCreateAdditive(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-magenta focus:ring-magenta"
              />
              <div>
                <p className="text-sm font-medium dark:text-slate-200">Criar aditivo formal pra cada reajuste</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Aplica a todos os contratos selecionados com Δ {'>'} 0
                </p>
              </div>
            </label>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-border-dark">
              <table className="table">
                <thead className="sticky top-0 bg-slate-50 dark:bg-muted-dark">
                  <tr>
                    <th>Contrato</th>
                    <th>Status</th>
                    <th className="text-right">Variação</th>
                    <th className="text-right">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {simRows.map((r) => (
                    <tr key={r.contract_id}>
                      <td className="font-mono text-xs">{r.contract_numero}</td>
                      <td>
                        {r.ok
                          ? <Badge tone="green">OK</Badge>
                          : <span className="text-[10px] text-error" title={r.error || ''}>
                              <AlertTriangle className="mr-0.5 inline h-3 w-3" />
                              {(r.error || '').slice(0, 40)}
                            </span>}
                      </td>
                      <td className="text-right font-mono tabular text-xs">
                        {r.ok ? pct(r.variation_percent) : '—'}
                      </td>
                      <td className={`text-right font-mono tabular text-xs ${(r.delta || 0) > 0 ? 'text-success' : 'text-slate-500'}`}>
                        {r.ok ? brl(r.delta) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {simStats && simStats.applicable === 0 && (
              <div className="rounded-lg border border-amber-300/40 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/15 dark:text-amber-200">
                <AlertTriangle className="mr-1 inline h-4 w-4" />
                Nenhum dos contratos selecionados está aplicável (falta índice, não atingiu interregno, etc).
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Modal: resultado da aplicação */}
      <Modal
        open={step === 'result'}
        onClose={reset}
        title="Resultado"
        subtitle={resultStats
          ? `${resultStats.ok} aplicados · ${resultStats.errored} com erro · impacto total ${brl(resultStats.totalDelta)}`
          : ''}
        size="lg"
        footer={<div className="flex justify-end"><Button onClick={reset}>Concluir</Button></div>}
      >
        {applyRows && (
          <div className="space-y-3">
            {resultStats && (
              <div className="grid grid-cols-3 gap-2">
                <Card className="p-3 text-center">
                  <p className="font-mono text-[10px] uppercase text-slate-500">Aplicados</p>
                  <p className="font-mono text-xl font-bold tabular text-success">{resultStats.ok}</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="font-mono text-[10px] uppercase text-slate-500">Com erro</p>
                  <p className={`font-mono text-xl font-bold tabular ${resultStats.errored > 0 ? 'text-error' : 'text-slate-500'}`}>
                    {resultStats.errored}
                  </p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="font-mono text-[10px] uppercase text-slate-500">Aditivos criados</p>
                  <p className="font-mono text-xl font-bold tabular text-purple-600 dark:text-purple-300">
                    {resultStats.additivesCreated}
                  </p>
                </Card>
              </div>
            )}

            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-border-dark">
              <table className="table">
                <thead className="sticky top-0 bg-slate-50 dark:bg-muted-dark">
                  <tr>
                    <th>Contrato</th>
                    <th>Status</th>
                    <th className="text-right">Δ</th>
                    <th>Aditivo</th>
                  </tr>
                </thead>
                <tbody>
                  {applyRows.map((r) => (
                    <tr key={r.contract_id}>
                      <td>
                        <Link
                          to={`/contratos/${r.contract_id}/reajustes`}
                          className="font-mono text-xs text-magenta hover:underline"
                        >
                          {r.contract_numero}
                        </Link>
                      </td>
                      <td>
                        {r.ok
                          ? <Badge tone="green"><CheckCircle2 className="mr-0.5 inline h-3 w-3" />Aplicado</Badge>
                          : <span className="text-[10px] text-error" title={r.error || ''}>
                              <AlertTriangle className="mr-0.5 inline h-3 w-3" />
                              {(r.error || '').slice(0, 50)}
                            </span>}
                      </td>
                      <td className={`text-right font-mono tabular text-xs ${(r.delta || 0) > 0 ? 'text-success' : 'text-slate-500'}`}>
                        {r.ok ? brl(r.delta) : '—'}
                      </td>
                      <td>
                        {r.additive_id ? (
                          <Link
                            to={`/contratos/${r.contract_id}/aditivos/${r.additive_id}`}
                            className="inline-flex items-center gap-0.5 rounded-full bg-purple-100 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-display text-purple-700 dark:bg-purple-900/30 dark:text-purple-200"
                          >
                            <FileBadge className="h-2.5 w-2.5" />link
                          </Link>
                        ) : <span className="text-[10px] text-slate-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
