import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Scale, History, AlertTriangle, CheckCircle2, Calculator, ChevronDown, ChevronRight,
  ArrowRight,
} from 'lucide-react';
import {
  listRepactuacaoCandidates, simulateRepactuacao, applyRepactuacao,
  listContractRepactuacoes, getContractRepactuacaoSummary, getRepactuacaoEventItems,
  type RepactuacaoSimulation, type RepactuacaoEvent,
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
import { Field } from '../../components/ui/FormField';
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

export function ContractRepactuacoes() {
  const { id: contractId } = useParams<{ id: string }>();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canManage = hasRole(['admin', 'gestor_contrato']);

  const [editorOpen, setEditorOpen] = useState(false);
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [novoPrecos, setNovoPrecos] = useState<Record<string, string>>({});  // item_id → preco_novo (string pra preservar digitação)
  const [referenceDate, setReferenceDate] = useState(new Date().toISOString().slice(0, 10));
  const [cctReference, setCctReference] = useState('');
  const [motivacao, setMotivacao] = useState('');
  const [notes, setNotes] = useState('');
  const [simResult, setSimResult] = useState<RepactuacaoSimulation | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const { data: summary } = useQuery({
    queryKey: ['contract-repactuacao-summary', contractId],
    queryFn: () => getContractRepactuacaoSummary(contractId!),
    enabled: !!contractId,
  });

  const { data: events = [] } = useQuery({
    queryKey: ['contract-repactuacoes', contractId],
    queryFn: () => listContractRepactuacoes(contractId!),
    enabled: !!contractId,
  });

  const { data: candidates = [], isLoading: candidatesLoading } = useQuery({
    queryKey: ['repactuacao-candidates', contractId],
    queryFn: () => listRepactuacaoCandidates(contractId!),
    enabled: !!contractId && editorOpen,
  });

  // Pré-popula com preço atual quando candidates carregam
  const itemsForSim = useMemo(() => {
    return candidates
      .filter((c) => {
        const novoStr = novoPrecos[c.item_id];
        if (!novoStr || novoStr.trim() === '') return false;
        const novo = parseFloat(novoStr.replace(',', '.'));
        return isFinite(novo) && novo !== c.preco_unitario_atual;
      })
      .map((c) => {
        const novo = parseFloat(novoPrecos[c.item_id].replace(',', '.'));
        return { item_id: c.item_id, preco_novo: novo };
      });
  }, [candidates, novoPrecos]);

  const localDelta = useMemo(() => {
    let total = 0;
    let affected = 0;
    candidates.forEach((c) => {
      const novoStr = novoPrecos[c.item_id];
      if (!novoStr || novoStr.trim() === '') return;
      const novo = parseFloat(novoStr.replace(',', '.'));
      if (!isFinite(novo) || novo === c.preco_unitario_atual) return;
      total += c.quantidade_total * (novo - c.preco_unitario_atual);
      affected++;
    });
    return { total, affected };
  }, [candidates, novoPrecos]);

  const mSimulate = useMutation({
    mutationFn: () => simulateRepactuacao(contractId!, itemsForSim),
    onSuccess: (data) => {
      setSimResult(data);
      if (data.ok) setStep('review');
    },
    onError: (err) => setFeedback({ tone: 'error', message: humanizeError(err) }),
  });

  const mApply = useMutation({
    mutationFn: () => applyRepactuacao({
      contract_id: contractId!,
      items: itemsForSim,
      reference_date: referenceDate,
      motivacao,
      cct_reference: cctReference || undefined,
      notes: notes || undefined,
    }),
    onSuccess: (r) => {
      setFeedback({
        tone: 'ok',
        message: `Repactuação aplicada · ${r.items_affected} itens · Δ ${brl(r.delta_total)}`,
      });
      closeEditor();
      qc.invalidateQueries({ queryKey: ['contract-repactuacao-summary', contractId] });
      qc.invalidateQueries({ queryKey: ['contract-repactuacoes', contractId] });
    },
    onError: (err) => setFeedback({ tone: 'error', message: humanizeError(err) }),
  });

  function closeEditor() {
    setEditorOpen(false);
    setStep('edit');
    setNovoPrecos({});
    setCctReference('');
    setMotivacao('');
    setNotes('');
    setSimResult(null);
  }

  return (
    <>
      <Layout>
        <PageHeader
          kicker={`Contrato${summary?.contract_numero ? ' · ' + summary.contract_numero : ''}`}
          title="Repactuações"
          subtitle="Recálculo de preços com base em CCT/convenção (Lei 14.133 art. 135) — distinta de reajuste"
          backTo={`/contratos/${contractId}`}
          backLabel="Contrato"
          actions={
            canManage && (
              <Button onClick={() => setEditorOpen(true)}>
                <Scale className="h-4 w-4" />Nova repactuação
              </Button>
            )
          }
        />

        {/* KPIs */}
        {summary && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Valor atual
              </p>
              <p className="mt-1 font-mono text-lg font-bold tabular dark:text-slate-100">{brl(summary.valor_total_atual)}</p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Total repactuado
              </p>
              <p className={`mt-1 font-mono text-lg font-bold tabular ${summary.total_repactuado > 0 ? 'text-success' : summary.total_repactuado < 0 ? 'text-error' : 'text-slate-500'}`}>
                {brl(summary.total_repactuado)}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                {pct(summary.percent_sobre_inicial, 2)} sobre inicial
              </p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Aplicações
              </p>
              <p className="mt-1 font-mono text-xl sm:text-2xl font-bold tabular dark:text-slate-100">{summary.events_count}</p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Última repactuação
              </p>
              <p className="mt-1 text-sm dark:text-slate-200">
                {summary.last_applied_at ? new Date(summary.last_applied_at).toLocaleDateString('pt-BR') : '—'}
              </p>
              {summary.last_delta != null && (
                <p className="mt-0.5 font-mono text-[10px] text-slate-500">Δ {brl(summary.last_delta)}</p>
              )}
            </Card>
          </div>
        )}

        {/* Histórico */}
        <Card>
          <div className="border-b border-slate-200 px-4 py-3 dark:border-border-dark">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-500" />
              <p className="font-semibold dark:text-slate-200">Histórico de repactuações</p>
            </div>
          </div>
          {events.length === 0 && (
            <div className="px-4 py-12 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Nenhuma repactuação aplicada ainda.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Use "Nova repactuação" para registrar a primeira (com motivação obrigatória — art. 135 §2º).
              </p>
            </div>
          )}
          {events.length > 0 && (
            <ScrollShadow>
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-8"></th>
                    <th>Aplicada em</th>
                    <th className="hidden md:table-cell">Data-base CCT</th>
                    <th className="hidden lg:table-cell">CCT</th>
                    <th className="text-right">Variação</th>
                    <th className="text-right">Δ total</th>
                    <th className="hidden md:table-cell text-right">Itens</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <RepactuacaoEventRow
                      key={ev.id}
                      ev={ev}
                      expanded={expandedEventId === ev.id}
                      onToggle={() => setExpandedEventId(expandedEventId === ev.id ? null : ev.id)}
                    />
                  ))}
                </tbody>
              </table>
            </ScrollShadow>
          )}
        </Card>
      </Layout>

      {/* Editor de Repactuação */}
      <Modal
        open={editorOpen}
        onClose={closeEditor}
        title={step === 'edit' ? 'Nova repactuação · editar preços' : 'Nova repactuação · revisar e confirmar'}
        size="xl"
        footer={
          step === 'edit' ? (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeEditor}>Cancelar</Button>
              <Button
                onClick={() => mSimulate.mutate()}
                loading={mSimulate.isPending}
                disabled={localDelta.affected === 0}
              >
                <Calculator className="h-4 w-4" />Revisar · {localDelta.affected} {localDelta.affected === 1 ? 'item' : 'itens'}
              </Button>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep('edit')}>Voltar</Button>
              <Button
                onClick={() => mApply.mutate()}
                loading={mApply.isPending}
                disabled={!motivacao.trim() || motivacao.trim().length < 10 || !referenceDate}
              >
                <CheckCircle2 className="h-4 w-4" />Aplicar repactuação
              </Button>
            </div>
          )
        }
      >
        {step === 'edit' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/15 dark:text-blue-200">
              Edite o "Preço novo" apenas dos itens que serão repactuados. Itens deixados em branco ou iguais ao atual são ignorados.
              O cálculo de Δ é local; só os itens alterados vão para a simulação no banco.
            </div>

            {candidatesLoading && <Skeleton className="h-48" />}

            {!candidatesLoading && candidates.length === 0 && (
              <p className="rounded-lg border border-slate-200 p-3 text-sm text-slate-500 dark:border-border-dark">
                Contrato sem itens de SOV ativos para repactuar.
              </p>
            )}

            {candidates.length > 0 && (
              <>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-border-dark">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="hidden md:table-cell text-right">Qtd</th>
                        <th className="text-right">Preço atual</th>
                        <th className="text-right">Preço novo</th>
                        <th className="hidden md:table-cell text-right">Δ unitário</th>
                        <th className="text-right">Δ total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c) => {
                        const novoStr = novoPrecos[c.item_id] || '';
                        const novo = novoStr ? parseFloat(novoStr.replace(',', '.')) : NaN;
                        const validNovo = isFinite(novo);
                        const deltaUnit = validNovo ? novo - c.preco_unitario_atual : 0;
                        const deltaTotal = validNovo ? c.quantidade_total * deltaUnit : 0;
                        const isChanged = validNovo && novo !== c.preco_unitario_atual;
                        return (
                          <tr key={c.item_id} className={isChanged ? 'bg-magenta/5' : ''}>
                            <td>
                              <p className="font-mono text-xs font-medium dark:text-slate-200">{c.codigo}</p>
                              <p className="line-clamp-1 text-[11px] text-slate-500" title={c.descricao}>{c.descricao}</p>
                            </td>
                            <td className="hidden md:table-cell text-right">
                              <span className="font-mono tabular text-xs">
                                {c.quantidade_total.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
                              </span>
                              <span className="ml-1 text-[10px] text-slate-400">{c.unidade}</span>
                            </td>
                            <td className="text-right font-mono tabular text-xs text-slate-600 dark:text-slate-300">{brl(c.preco_unitario_atual)}</td>
                            <td>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={novoStr}
                                onChange={(e) => setNovoPrecos({ ...novoPrecos, [c.item_id]: e.target.value })}
                                placeholder={c.preco_unitario_atual.toFixed(2).replace('.', ',')}
                                className="input w-32 text-right font-mono tabular text-xs"
                              />
                            </td>
                            <td className="hidden md:table-cell text-right">
                              {isChanged && (
                                <span className={`font-mono tabular text-xs ${deltaUnit > 0 ? 'text-success' : 'text-error'}`}>
                                  {deltaUnit > 0 ? '+' : ''}{brl(deltaUnit)}
                                </span>
                              )}
                            </td>
                            <td className="text-right">
                              {isChanged && (
                                <span className={`font-mono tabular text-xs font-semibold ${deltaTotal > 0 ? 'text-success' : 'text-error'}`}>
                                  {deltaTotal > 0 ? '+' : ''}{brl(deltaTotal)}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {localDelta.affected > 0 && (
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-muted-dark">
                          <td colSpan={5} className="text-right font-semibold dark:text-slate-200">
                            Total ({localDelta.affected} {localDelta.affected === 1 ? 'item alterado' : 'itens alterados'})
                          </td>
                          <td className="text-right">
                            <span className={`font-mono tabular text-sm font-bold ${localDelta.total > 0 ? 'text-success' : 'text-error'}`}>
                              {localDelta.total > 0 ? '+' : ''}{brl(localDelta.total)}
                            </span>
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'review' && simResult?.ok && (
          <div className="space-y-3">
            <Card className="p-4">
              <p className="mb-2 font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500">
                Resumo da operação
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Itens alterados</span>
                  <span className="font-mono font-semibold dark:text-slate-100">{simResult.items_affected}</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 dark:border-border-dark">
                  <span className="text-slate-600 dark:text-slate-400">Valor anterior</span>
                  <span className="font-mono tabular">{brl(simResult.value_before)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Valor após</span>
                  <span className="font-mono tabular font-bold text-magenta">{brl(simResult.value_after)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 dark:border-border-dark">
                  <span className="text-slate-600 dark:text-slate-400">Δ total</span>
                  <span className={`font-mono tabular font-bold ${(simResult.total_delta ?? 0) > 0 ? 'text-success' : 'text-error'}`}>
                    {(simResult.total_delta ?? 0) > 0 ? '+' : ''}{brl(simResult.total_delta)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Variação</span>
                  <span className={`font-mono tabular font-bold ${(simResult.variation_percent ?? 0) > 0 ? 'text-success' : 'text-error'}`}>
                    {(simResult.variation_percent ?? 0) > 0 ? '+' : ''}{pct(simResult.variation_percent, 4)}
                  </span>
                </div>
              </div>
            </Card>

            <Field label="Data-base de referência" required hint="Data do CCT/convenção coletiva que motiva a repactuação">
              <input
                type="date"
                value={referenceDate}
                onChange={(e) => setReferenceDate(e.target.value)}
                className="input"
              />
            </Field>

            <Field label="Referência do CCT (opcional)" hint="Ex: CCT 2025 SEAC-DF, Convenção 001/2024">
              <input
                type="text"
                value={cctReference}
                onChange={(e) => setCctReference(e.target.value)}
                maxLength={200}
                className="input"
                placeholder="CCT 2025 SEAC-DF"
              />
            </Field>

            <Field label="Motivação" required hint="Justificativa formal (mínimo 10 caracteres) — Lei 14.133 art. 135 §2º">
              <textarea
                value={motivacao}
                onChange={(e) => setMotivacao(e.target.value)}
                rows={3}
                maxLength={2000}
                className="input"
                placeholder="Repactuação anual baseada na CCT 2025 da categoria, conforme cláusula contratual…"
              />
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                {motivacao.length}/2000 · mínimo 10 caracteres
              </p>
            </Field>

            <Field label="Observações (opcional)">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
                className="input"
              />
            </Field>

            <div className="rounded-lg border border-amber-300/40 bg-amber-50/50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/15 dark:text-amber-200">
              <AlertTriangle className="mr-1 inline h-4 w-4" />
              <strong>Ao aplicar:</strong> os preços unitários dos {simResult.items_affected} itens serão atualizados imediatamente.
              Medições futuras usarão os novos preços. A operação é registrada em audit trail completo.
            </div>
          </div>
        )}

        {step === 'review' && simResult && !simResult.ok && (
          <div className="rounded-lg border border-amber-300/40 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/15 dark:text-amber-200">
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            {simResult.error}
          </div>
        )}
      </Modal>

      {/* Feedback */}
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

function RepactuacaoEventRow({
  ev, expanded, onToggle,
}: { ev: RepactuacaoEvent; expanded: boolean; onToggle: () => void }) {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['repactuacao-event-items', ev.id],
    queryFn: () => getRepactuacaoEventItems(ev.id),
    enabled: expanded,
    staleTime: 60_000,
  });

  return (
    <>
      <tr className="cursor-pointer hover:bg-slate-50 dark:hover:bg-muted-dark/40" onClick={onToggle}>
        <td>
          {expanded
            ? <ChevronDown className="h-4 w-4 text-slate-400" />
            : <ChevronRight className="h-4 w-4 text-slate-400" />}
        </td>
        <td>
          <p className="text-sm dark:text-slate-200">{dtTime(ev.applied_at)}</p>
          <p className="font-mono text-[10px] text-slate-500">por {ev.applied_by_nome || 'sistema'}</p>
        </td>
        <td className="hidden md:table-cell font-mono text-xs">{fmtDate(ev.reference_date)}</td>
        <td className="hidden lg:table-cell text-xs text-slate-600 dark:text-slate-300">{ev.cct_reference || '—'}</td>
        <td className="text-right">
          <span className={`font-mono tabular text-sm font-semibold ${ev.variation_percent > 0 ? 'text-success' : ev.variation_percent < 0 ? 'text-error' : 'text-slate-500'}`}>
            {ev.variation_percent > 0 ? '+' : ''}{pct(ev.variation_percent, 4)}
          </span>
        </td>
        <td className="text-right">
          <span className={`font-mono tabular text-sm font-semibold ${ev.delta_total > 0 ? 'text-success' : 'text-error'}`}>
            {ev.delta_total > 0 ? '+' : ''}{brl(ev.delta_total)}
          </span>
        </td>
        <td className="hidden md:table-cell text-right"><Badge tone="blue">{ev.items_affected}</Badge></td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="bg-slate-50 px-4 py-3 dark:bg-muted-dark/30">
            <div className="space-y-3">
              <div className="grid gap-2 text-xs md:grid-cols-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">Motivação</p>
                  <p className="mt-0.5 italic text-slate-700 dark:text-slate-300">"{ev.motivacao}"</p>
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">Valor anterior → após</p>
                  <p className="mt-0.5 font-mono tabular">
                    {brl(ev.value_before)} <ArrowRight className="inline h-3 w-3 mx-1" /> {brl(ev.value_after)}
                  </p>
                </div>
                {ev.notes && (
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">Observações</p>
                    <p className="mt-0.5 text-slate-700 dark:text-slate-300">{ev.notes}</p>
                  </div>
                )}
              </div>

              {isLoading && <Skeleton className="h-24" />}
              {!isLoading && items.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-border-dark">
                  <table className="table text-xs">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="hidden md:table-cell text-right">Qtd</th>
                        <th className="text-right">Preço anterior</th>
                        <th className="text-right">Preço novo</th>
                        <th className="text-right">Variação</th>
                        <th className="text-right">Δ total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.item_id}>
                          <td>
                            <p className="font-mono">{it.codigo}</p>
                            <p className="line-clamp-1 text-[10px] text-slate-500">{it.descricao}</p>
                          </td>
                          <td className="hidden md:table-cell text-right font-mono tabular">
                            {Number(it.quantidade_referencia).toLocaleString('pt-BR', { maximumFractionDigits: 6 })} {it.unidade || ''}
                          </td>
                          <td className="text-right font-mono tabular">{brl(it.preco_unitario_anterior)}</td>
                          <td className="text-right font-mono tabular font-semibold">{brl(it.preco_unitario_novo)}</td>
                          <td className="text-right">
                            <span className={`font-mono tabular ${it.variation_percent > 0 ? 'text-success' : 'text-error'}`}>
                              {it.variation_percent > 0 ? '+' : ''}{pct(it.variation_percent, 2)}
                            </span>
                          </td>
                          <td className="text-right">
                            <span className={`font-mono tabular font-semibold ${it.delta_total_item > 0 ? 'text-success' : 'text-error'}`}>
                              {it.delta_total_item > 0 ? '+' : ''}{brl(it.delta_total_item)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
