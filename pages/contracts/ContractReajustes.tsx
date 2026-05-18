import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp, Calculator, CheckCircle2, AlertTriangle, History, Settings,
  ArrowRight, Plus, FileBadge,
} from 'lucide-react';
import {
  getContractReajusteSummary, listContractReajustes,
  simulateContractReajuste, applyContractReajuste,
  upsertContractAdjustmentRule, listAdjustmentIndices,
  type ReajusteSimulation, type AdjustmentIndex,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { dtTime } from '../../lib/format';
import { useAuth } from '../../hooks/useAuth';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { ScrollShadow } from '../../components/ui/ScrollShadow';
import { Field, Select } from '../../components/ui/FormField';
import { Skeleton } from '../../components/ui/Stat';

function brl(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
  });
}

function pct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(digits)}%`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export function ContractReajustes() {
  const { id: contractId } = useParams<{ id: string }>();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canManage = hasRole(['admin', 'gestor_contrato']);

  const [simModalOpen, setSimModalOpen] = useState(false);
  const [simTargetDate, setSimTargetDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [simResult, setSimResult] = useState<ReajusteSimulation | null>(null);
  const [applyNotes, setApplyNotes] = useState('');
  const [createAdditive, setCreateAdditive] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    id: null as string | null,
    index_id: '',
    formula: '',
    data_base: '',
    periodicidade_meses: 12,
    active: true,
  });
  const [ruleError, setRuleError] = useState<string | null>(null);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['contract-reajuste-summary', contractId],
    queryFn: () => getContractReajusteSummary(contractId!),
    enabled: !!contractId,
  });

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['contract-reajustes', contractId],
    queryFn: () => listContractReajustes(contractId!),
    enabled: !!contractId,
  });

  const { data: indices = [] } = useQuery({
    queryKey: ['adjustment-indices'],
    queryFn: listAdjustmentIndices,
    enabled: ruleModalOpen,
  });

  const mSimulate = useMutation({
    mutationFn: (target: string) => simulateContractReajuste(contractId!, target),
    onSuccess: (data) => setSimResult(data),
    onError: (err) => setFeedback({ tone: 'error', message: humanizeError(err) }),
  });

  const mApply = useMutation({
    mutationFn: () => applyContractReajuste(contractId!, simTargetDate, applyNotes || undefined, createAdditive),
    onSuccess: (result) => {
      setFeedback({
        tone: 'ok',
        message: result.additive_id
          ? `Reajuste aplicado e aditivo formal criado. Δ ${result.delta > 0 ? '+' : ''}${brl(result.delta)}.`
          : `Reajuste aplicado. Δ ${result.delta > 0 ? '+' : ''}${brl(result.delta)}.`,
      });
      setSimModalOpen(false);
      setSimResult(null);
      setApplyNotes('');
      setCreateAdditive(false);
      qc.invalidateQueries({ queryKey: ['contract-reajustes', contractId] });
      qc.invalidateQueries({ queryKey: ['contract-reajuste-summary', contractId] });
    },
    onError: (err) => setFeedback({ tone: 'error', message: humanizeError(err) }),
  });

  const mUpsertRule = useMutation({
    mutationFn: () => upsertContractAdjustmentRule({
      id: ruleForm.id,
      contract_id: contractId!,
      index_id: ruleForm.index_id,
      formula: ruleForm.formula,
      data_base: ruleForm.data_base || null,
      periodicidade_meses: ruleForm.periodicidade_meses,
      active: ruleForm.active,
    }),
    onSuccess: () => {
      setRuleModalOpen(false);
      setRuleError(null);
      qc.invalidateQueries({ queryKey: ['contract-reajuste-summary', contractId] });
    },
    onError: (err) => setRuleError(humanizeError(err)),
  });

  function openEditRule() {
    if (summary?.rule) {
      setRuleForm({
        id: summary.rule.id,
        index_id: summary.rule.index_id,
        formula: summary.rule.formula,
        data_base: summary.rule.data_base || '',
        periodicidade_meses: summary.rule.periodicidade_meses,
        active: summary.rule.active,
      });
    } else {
      setRuleForm({
        id: null,
        index_id: indices[0]?.id || '',
        formula: 'Vr = V0 × (Ifim / Iinicio), reajuste anual baseado em IPCA',
        data_base: '',
        periodicidade_meses: 12,
        active: true,
      });
    }
    setRuleError(null);
    setRuleModalOpen(true);
  }

  function submitRule() {
    if (!ruleForm.index_id) { setRuleError('Selecione um índice'); return; }
    if (ruleForm.formula.trim().length < 3) { setRuleError('Fórmula obrigatória'); return; }
    mUpsertRule.mutate();
  }

  function openSim() {
    setSimResult(null);
    setApplyNotes('');
    setSimTargetDate(new Date().toISOString().slice(0, 10));
    setSimModalOpen(true);
  }

  return (
    <>
      <Layout>
        <PageHeader
          kicker={`Contrato${summary?.contract_numero ? ' · ' + summary.contract_numero : ''}`}
          title="Reajustes"
          subtitle="Reajuste contratual baseado em índices econômicos (Lei 14.133 art. 25/92/124-127)"
          backTo={`/contratos/${contractId}`}
          backLabel="Contrato"
          actions={
            canManage && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={openEditRule}>
                  <Settings className="h-4 w-4" />{summary?.rule ? 'Editar regra' : 'Configurar regra'}
                </Button>
                {summary?.rule?.active && (
                  <Button onClick={openSim}>
                    <Calculator className="h-4 w-4" />Simular reajuste
                  </Button>
                )}
              </div>
            )
          }
        />

        {summaryLoading && <Card className="p-6"><Skeleton className="h-32" /></Card>}

        {summary && !summary.rule && (
          <Card className="border-amber-300/40 bg-amber-50/50 p-6 text-center dark:border-amber-900/40 dark:bg-amber-900/10">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
            <p className="mt-2 font-semibold dark:text-slate-200">Nenhuma regra de reajuste configurada</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Pra começar, configure o índice (IPCA / IGP-M / INCC / SINAPI), a data-base do contrato e a fórmula da cláusula.
            </p>
            {canManage && (
              <Button onClick={openEditRule} className="mt-4">
                <Plus className="h-4 w-4" />Configurar regra
              </Button>
            )}
          </Card>
        )}

        {summary?.rule && (
          <>
            {/* Cards de resumo */}
            <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
              <Card densityAware className="p-3 sm:p-4">
                <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                  Valor inicial
                </p>
                <p className="mt-1 font-mono text-lg font-bold tabular dark:text-slate-100">{brl(summary.valor_inicial)}</p>
              </Card>
              <Card densityAware className="p-3 sm:p-4">
                <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                  Valor atual (com aditivos)
                </p>
                <p className="mt-1 font-mono text-lg font-bold tabular dark:text-slate-100">{brl(summary.valor_total_atual)}</p>
              </Card>
              <Card densityAware className="p-3 sm:p-4">
                <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                  Total reajustado
                </p>
                <p className={`mt-1 font-mono text-lg font-bold tabular ${summary.total_reajustado > 0 ? 'text-success' : 'text-slate-500'}`}>
                  {brl(summary.total_reajustado)}
                </p>
              </Card>
              <Card densityAware className="p-3 sm:p-4">
                <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                  Aplicações
                </p>
                <p className="mt-1 font-mono text-xl sm:text-2xl font-bold tabular dark:text-slate-100">{summary.events_count}</p>
              </Card>
            </div>

            {/* Regra ativa */}
            <Card className="mb-4 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 flex-1">
                  <TrendingUp className="mt-1 h-5 w-5 text-magenta" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold dark:text-slate-200">{summary.rule.index_codigo}</p>
                      <span className="text-xs text-slate-500 dark:text-slate-400">·</span>
                      <p className="text-sm text-slate-600 dark:text-slate-300">{summary.rule.index_nome}</p>
                      {summary.rule.active ? (
                        <Badge tone="green"><CheckCircle2 className="mr-0.5 inline h-3 w-3" />Ativa</Badge>
                      ) : (
                        <Badge tone="slate">Inativa</Badge>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm italic text-slate-600 dark:text-slate-400">
                      "{summary.rule.formula}"
                    </p>
                    <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
                      <span>Data-base: <span className="text-slate-700 dark:text-slate-200">{fmtDate(summary.rule.data_base)}</span></span>
                      <span>Periodicidade: <span className="text-slate-700 dark:text-slate-200">{summary.rule.periodicidade_meses} meses</span></span>
                      <span>Carência: <span className="text-slate-700 dark:text-slate-200">{summary.rule.carencia_meses} meses</span></span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Histórico */}
            <Card>
              <div className="border-b border-slate-200 px-4 py-3 dark:border-border-dark">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-slate-500" />
                  <p className="font-semibold dark:text-slate-200">Histórico de reajustes</p>
                </div>
              </div>
              {eventsLoading && <div className="p-6"><Skeleton className="h-32" /></div>}
              {!eventsLoading && events.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  Nenhum reajuste aplicado ainda.
                </div>
              )}
              {events.length > 0 && (
                <ScrollShadow>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Aplicado em</th>
                        <th className="hidden md:table-cell">Período</th>
                        <th>Índice</th>
                        <th className="text-right">Variação</th>
                        <th className="hidden lg:table-cell text-right">Valor anterior</th>
                        <th className="text-right">Novo valor</th>
                        <th className="hidden md:table-cell text-right">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((ev) => (
                        <tr key={ev.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark/40">
                          <td>
                            <p className="text-sm dark:text-slate-200">{dtTime(ev.applied_at)}</p>
                            <p className="font-mono text-[10px] text-slate-500">por {ev.applied_by_nome || 'sistema'}</p>
                            {ev.additive_id && (
                              <Link
                                to={`/contratos/${contractId}/aditivos/${ev.additive_id}`}
                                className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-purple-100 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-display text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-200"
                                title="Aditivo formal vinculado a este reajuste"
                              >
                                <FileBadge className="h-2.5 w-2.5" />Aditivo #{ev.additive_numero}
                              </Link>
                            )}
                          </td>
                          <td className="hidden md:table-cell">
                            <p className="font-mono text-xs">{fmtDate(ev.base_date)}</p>
                            <p className="font-mono text-[10px] text-slate-500">↓ {fmtDate(ev.reference_date)}</p>
                          </td>
                          <td><Badge tone="blue">{ev.index_codigo}</Badge></td>
                          <td className="text-right">
                            <p className={`font-mono tabular text-sm font-semibold ${ev.variation_percent > 0 ? 'text-success' : ev.variation_percent < 0 ? 'text-error' : 'text-slate-500'}`}>
                              {ev.variation_percent > 0 ? '+' : ''}{pct(ev.variation_percent, 4)}
                            </p>
                            <p className="font-mono text-[10px] text-slate-500">fator {Number(ev.factor).toFixed(6)}</p>
                          </td>
                          <td className="hidden lg:table-cell text-right font-mono tabular text-xs">{brl(ev.value_before)}</td>
                          <td className="text-right font-mono tabular text-sm font-semibold dark:text-slate-100">{brl(ev.value_after)}</td>
                          <td className="hidden md:table-cell text-right">
                            <span className={`font-mono tabular text-xs ${ev.delta > 0 ? 'text-success' : 'text-error'}`}>
                              {ev.delta > 0 ? '+' : ''}{brl(ev.delta)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollShadow>
              )}
            </Card>
          </>
        )}
      </Layout>

      {/* Modal Simulação */}
      <Modal
        open={simModalOpen}
        onClose={() => setSimModalOpen(false)}
        title="Simular reajuste"
        subtitle="Calcule o impacto antes de aplicar"
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSimModalOpen(false)}>Cancelar</Button>
            <Button variant="outline" onClick={() => mSimulate.mutate(simTargetDate)} loading={mSimulate.isPending}>
              <Calculator className="h-4 w-4" />Calcular
            </Button>
            {simResult?.ok && (
              <Button onClick={() => mApply.mutate()} loading={mApply.isPending}>
                <CheckCircle2 className="h-4 w-4" />Aplicar reajuste
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Data alvo do reajuste" hint="Mês de aniversário pra calcular. Default: hoje.">
            <input
              type="date"
              value={simTargetDate}
              onChange={(e) => setSimTargetDate(e.target.value)}
              className="input"
            />
          </Field>

          {simResult && !simResult.ok && (
            <div className="rounded-lg border border-amber-300/40 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/15 dark:text-amber-200">
              <AlertTriangle className="mr-1 inline h-4 w-4" />
              {simResult.error}
              {simResult.next_anniversary && (
                <p className="mt-2 font-mono text-xs">
                  Próximo aniversário válido: <strong>{fmtDate(simResult.next_anniversary)}</strong>
                </p>
              )}
            </div>
          )}

          {simResult?.ok && (
            <>
              <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-success">
                <CheckCircle2 className="mr-1 inline h-4 w-4" />
                Simulação OK — pronto pra aplicar.
              </div>

              <Card className="p-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Índice</span>
                    <span className="font-mono font-semibold dark:text-slate-100">{simResult.index_codigo}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Período</span>
                    <span className="font-mono text-xs">
                      {fmtDate(simResult.base_date)} <ArrowRight className="inline h-3 w-3" /> {fmtDate(simResult.reference_date)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Índice inicial (Iinicio)</span>
                    <span className="font-mono tabular">{Number(simResult.index_value_base).toFixed(4)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Índice final (Ifim)</span>
                    <span className="font-mono tabular">{Number(simResult.index_value_ref).toFixed(4)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-2 dark:border-border-dark">
                    <span className="text-slate-600 dark:text-slate-400">Fator</span>
                    <span className="font-mono tabular font-semibold dark:text-slate-100">{Number(simResult.factor).toFixed(8)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Variação</span>
                    <span className={`font-mono tabular font-bold ${(simResult.variation_percent ?? 0) > 0 ? 'text-success' : 'text-error'}`}>
                      {(simResult.variation_percent ?? 0) > 0 ? '+' : ''}{pct(simResult.variation_percent, 4)}
                    </span>
                  </div>
                </div>
              </Card>

              <Card className="p-4">
                <p className="mb-2 font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500">
                  Impacto financeiro
                </p>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 text-center">
                    <p className="text-[10px] text-slate-500">Valor anterior</p>
                    <p className="mt-0.5 font-mono tabular text-sm font-bold dark:text-slate-100">{brl(simResult.value_before)}</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-magenta" />
                  <div className="flex-1 text-center">
                    <p className="text-[10px] text-slate-500">Novo valor</p>
                    <p className="mt-0.5 font-mono tabular text-base font-bold text-magenta">{brl(simResult.value_after)}</p>
                  </div>
                  <div className="flex-1 text-center">
                    <p className="text-[10px] text-slate-500">Δ</p>
                    <p className={`mt-0.5 font-mono tabular text-sm font-bold ${(simResult.delta ?? 0) > 0 ? 'text-success' : 'text-error'}`}>
                      {(simResult.delta ?? 0) > 0 ? '+' : ''}{brl(simResult.delta)}
                    </p>
                  </div>
                </div>
              </Card>

              <Field label="Observações (opcional)" hint="Ex: número da CI, referência ao processo, etc.">
                <textarea
                  value={applyNotes}
                  onChange={(e) => setApplyNotes(e.target.value)}
                  rows={2}
                  maxLength={500}
                  className="input"
                />
              </Field>

              {/* V31: criar aditivo formal */}
              <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition ${
                createAdditive
                  ? 'border-magenta/50 bg-magenta/5 dark:border-magenta/40'
                  : 'border-slate-200 hover:border-slate-300 dark:border-border-dark dark:hover:border-slate-600'
              }`}>
                <input
                  type="checkbox"
                  checked={createAdditive}
                  onChange={(e) => setCreateAdditive(e.target.checked)}
                  disabled={(simResult.delta ?? 0) <= 0}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-magenta focus:ring-magenta disabled:opacity-50"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium dark:text-slate-200">
                    Criar aditivo formal automaticamente
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Recomendado pra órgãos que exigem formalização documental (Lei 14.133 art. 125).
                    Será criado um aditivo <code className="font-mono">tipo=reajuste</code> com{' '}
                    <code className="font-mono">valor_acrescimo = Δ</code>, status <code className="font-mono">aprovado</code>,
                    linkado a este evento.
                  </p>
                  {(simResult.delta ?? 0) <= 0 && (
                    <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                      ⚠ Aditivo não pode ser criado quando o Δ é zero ou negativo.
                    </p>
                  )}
                </div>
              </label>
            </>
          )}
        </div>
      </Modal>

      {/* Modal Configurar/Editar Regra */}
      <Modal
        open={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        title={ruleForm.id ? 'Editar regra de reajuste' : 'Configurar regra de reajuste'}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRuleModalOpen(false)}>Cancelar</Button>
            <Button onClick={submitRule} loading={mUpsertRule.isPending}>Salvar</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Índice de referência" required>
            <Select
              value={ruleForm.index_id}
              onChange={(e) => setRuleForm({ ...ruleForm, index_id: e.target.value })}
              options={(indices as AdjustmentIndex[]).map((i) => ({
                value: i.id,
                label: `${i.codigo} — ${i.nome}`,
              }))}
              placeholder="Escolha o índice"
            />
          </Field>

          <Field label="Data-base" required hint="Data de referência inicial. Default: data de assinatura. Pode ser ajustada conforme cláusula.">
            <input
              type="date"
              value={ruleForm.data_base}
              onChange={(e) => setRuleForm({ ...ruleForm, data_base: e.target.value })}
              className="input"
            />
          </Field>

          <Field label="Periodicidade (meses)" required hint="Intervalo mínimo entre reajustes. Lei 14.133 padroniza 12 meses.">
            <input
              type="number"
              min={1}
              max={60}
              value={ruleForm.periodicidade_meses}
              onChange={(e) => setRuleForm({ ...ruleForm, periodicidade_meses: Number(e.target.value) || 12 })}
              className="input"
            />
          </Field>

          <Field label="Fórmula / cláusula" required hint="Descrição textual da cláusula contratual de reajuste">
            <textarea
              value={ruleForm.formula}
              onChange={(e) => setRuleForm({ ...ruleForm, formula: e.target.value })}
              rows={3}
              className="input"
              placeholder="Vr = V0 × (Ifim / Iinicio), reajuste anual baseado em IPCA"
            />
          </Field>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-border-dark dark:bg-muted-dark">
            <div>
              <p className="text-sm font-medium dark:text-slate-200">Regra ativa</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Inativa: simulação e aplicação ficam desabilitadas
              </p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={ruleForm.active}
                onChange={(e) => setRuleForm({ ...ruleForm, active: e.target.checked })}
                className="peer sr-only"
              />
              <div className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-magenta dark:bg-slate-600" />
              <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
            </label>
          </div>

          {ruleError && (
            <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {ruleError}
            </div>
          )}
        </div>
      </Modal>

      {/* Feedback toast modal */}
      <Modal
        open={!!feedback}
        onClose={() => setFeedback(null)}
        title="Status"
        size="sm"
        footer={<div className="flex justify-end"><Button onClick={() => setFeedback(null)}>OK</Button></div>}
      >
        {feedback && (
          <div className={`rounded-lg border px-3 py-3 text-sm ${
            feedback.tone === 'ok'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-error/30 bg-error/10 text-error'
          }`}>
            <div className="flex items-start gap-2">
              {feedback.tone === 'ok'
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
                : <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />}
              <p>{feedback.message}</p>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
