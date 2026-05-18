import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertOctagon, Plus, History, Send, CheckCircle2, XCircle, AlertTriangle,
  ClipboardCheck, FileSearch, RotateCcw, Link as LinkIcon,
} from 'lucide-react';
import {
  listContractReequilibrios, getReequilibrioDetail, getContractReequilibrioSummary,
  createReequilibrioRequest, submitReequilibrioRequest, completeTechnicalAnalysis,
  decideReequilibrio, applyReequilibrio, cancelReequilibrio,
  REEQUILIBRIO_TIPO_EVENTO_LABELS, REEQUILIBRIO_IMPACTO_LABELS,
  REEQUILIBRIO_STATUS_LABELS, reequilibrioStatusTone,
  type ReequilibrioRow, type ReequilibrioDetail,
  type ReequilibrioTipoEvento, type ReequilibrioImpactoTipo,
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

function brl(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export function ContractReequilibrios() {
  const { id: contractId } = useParams<{ id: string }>();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canSolicitar = hasRole(['admin', 'gestor_contrato', 'fiscal']);
  const canDecidir   = hasRole(['admin', 'gestor_contrato']);
  const canAnalisar  = hasRole(['admin', 'fiscal']);

  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  // Form de nova solicitação
  const [form, setForm] = useState({
    tipo_evento:           'alta_insumo' as ReequilibrioTipoEvento,
    data_evento:           new Date().toISOString().slice(0, 10),
    descricao:             '',
    impacto_tipo:          'valor_aumento' as ReequilibrioImpactoTipo,
    valor_solicitado:      '',
    prazo_solicitado_dias: '',
  });

  const { data: summary } = useQuery({
    queryKey: ['contract-reequilibrio-summary', contractId],
    queryFn: () => getContractReequilibrioSummary(contractId!),
    enabled: !!contractId,
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['contract-reequilibrios', contractId],
    queryFn: () => listContractReequilibrios(contractId!),
    enabled: !!contractId,
  });

  const mCreate = useMutation({
    mutationFn: () => createReequilibrioRequest({
      contract_id:           contractId!,
      tipo_evento:           form.tipo_evento,
      data_evento:           form.data_evento,
      descricao:             form.descricao,
      impacto_tipo:          form.impacto_tipo,
      valor_solicitado:      form.valor_solicitado ? parseFloat(form.valor_solicitado.replace(',', '.')) : 0,
      prazo_solicitado_dias: form.prazo_solicitado_dias ? parseInt(form.prazo_solicitado_dias) : 0,
    }),
    onSuccess: () => {
      setNewOpen(false);
      setForm({
        tipo_evento: 'alta_insumo', data_evento: new Date().toISOString().slice(0, 10),
        descricao: '', impacto_tipo: 'valor_aumento',
        valor_solicitado: '', prazo_solicitado_dias: '',
      });
      setFeedback({ tone: 'ok', message: 'Solicitação criada em rascunho. Abra o detalhe para submeter à análise.' });
      qc.invalidateQueries({ queryKey: ['contract-reequilibrios', contractId] });
      qc.invalidateQueries({ queryKey: ['contract-reequilibrio-summary', contractId] });
    },
    onError: (err) => setFeedback({ tone: 'error', message: humanizeError(err) }),
  });

  return (
    <>
      <Layout>
        <PageHeader
          kicker={`Contrato${rows[0]?.numero ? '' : ''}`}
          title="Reequilíbrio econômico-financeiro"
          subtitle="Eventos extraordinários, imprevisíveis ou de consequência incalculável (Lei 14.133 art. 124)"
          backTo={`/contratos/${contractId}`}
          backLabel="Contrato"
          actions={
            canSolicitar && (
              <Button onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" />Nova solicitação
              </Button>
            )
          }
        />

        {/* KPIs */}
        {summary && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Total
              </p>
              <p className="mt-1 font-mono text-xl sm:text-2xl font-bold tabular dark:text-slate-100">{summary.total}</p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Em andamento
              </p>
              <p className="mt-1 font-mono text-xl sm:text-2xl font-bold tabular text-purple-600 dark:text-purple-300">{summary.open}</p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Aplicados
              </p>
              <p className="mt-1 font-mono text-xl sm:text-2xl font-bold tabular text-success">{summary.aplicado}</p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Valor aprovado (total)
              </p>
              <p className="mt-1 font-mono text-lg font-bold tabular dark:text-slate-100">{brl(summary.valor_aprovado_total)}</p>
            </Card>
          </div>
        )}

        <Card>
          <div className="border-b border-slate-200 px-4 py-3 dark:border-border-dark">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-500" />
              <p className="font-semibold dark:text-slate-200">Solicitações de reequilíbrio</p>
            </div>
          </div>

          {isLoading && <div className="p-6 text-sm text-slate-500">Carregando…</div>}

          {!isLoading && rows.length === 0 && (
            <div className="px-4 py-12 text-center">
              <AlertOctagon className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Nenhuma solicitação de reequilíbrio</p>
              <p className="mt-1 text-xs text-slate-400">
                Reequilíbrio se aplica a eventos extraordinários que afetem a equação econômico-financeira do contrato.
              </p>
            </div>
          )}

          {rows.length > 0 && (
            <ScrollShadow>
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Evento</th>
                    <th className="hidden md:table-cell">Data evento</th>
                    <th>Status</th>
                    <th className="hidden lg:table-cell">Impacto</th>
                    <th className="text-right">Solicitado</th>
                    <th className="text-right">Aprovado</th>
                    <th className="w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-muted-dark/40"
                      onClick={() => setDetailId(r.id)}
                    >
                      <td className="font-mono tabular text-xs font-bold dark:text-slate-200">#{r.numero}</td>
                      <td>
                        <p className="text-sm dark:text-slate-200">{REEQUILIBRIO_TIPO_EVENTO_LABELS[r.tipo_evento]}</p>
                        <p className="line-clamp-1 text-[11px] text-slate-500" title={r.descricao_evento}>
                          {r.descricao_evento}
                        </p>
                      </td>
                      <td className="hidden md:table-cell font-mono text-xs">{fmtDate(r.data_evento)}</td>
                      <td>
                        <Badge tone={reequilibrioStatusTone(r.status)}>{REEQUILIBRIO_STATUS_LABELS[r.status]}</Badge>
                      </td>
                      <td className="hidden lg:table-cell text-xs text-slate-600 dark:text-slate-300">
                        {REEQUILIBRIO_IMPACTO_LABELS[r.impacto_tipo]}
                      </td>
                      <td className="text-right font-mono tabular text-xs">
                        {r.impacto_tipo !== 'prazo' ? brl(r.valor_solicitado) : '—'}
                        {r.prazo_solicitado_dias > 0 && (
                          <p className="text-[10px] text-slate-500">+{r.prazo_solicitado_dias}d</p>
                        )}
                      </td>
                      <td className="text-right font-mono tabular text-xs font-semibold">
                        {r.valor_aprovado != null ? brl(r.valor_aprovado) : '—'}
                        {(r.prazo_aprovado_dias ?? 0) > 0 && (
                          <p className="text-[10px] text-slate-500">+{r.prazo_aprovado_dias}d</p>
                        )}
                      </td>
                      <td>
                        {r.applied_via_additive_num != null && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-900/40 dark:text-purple-200"
                            title="Aditivo formal vinculado"
                          >
                            <LinkIcon className="h-2.5 w-2.5" />Adt#{r.applied_via_additive_num}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollShadow>
          )}
        </Card>
      </Layout>

      {/* Modal: nova solicitação */}
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Nova solicitação de reequilíbrio"
        subtitle="Lei 14.133 art. 124 — caracterização do evento extraordinário"
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => mCreate.mutate()}
              loading={mCreate.isPending}
              disabled={form.descricao.trim().length < 30 || !form.data_evento}
            >
              <Plus className="h-4 w-4" />Criar em rascunho
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo do evento" required>
              <Select
                value={form.tipo_evento}
                onChange={(e) => setForm({ ...form, tipo_evento: e.target.value as ReequilibrioTipoEvento })}
                options={Object.entries(REEQUILIBRIO_TIPO_EVENTO_LABELS).map(([v, l]) => ({ value: v, label: l }))}
              />
            </Field>
            <Field label="Data do evento" required>
              <input
                type="date"
                value={form.data_evento}
                onChange={(e) => setForm({ ...form, data_evento: e.target.value })}
                className="input"
              />
            </Field>
          </div>

          <Field label="Descrição do evento" required hint="Caracterização legal — mínimo 30 caracteres">
            <textarea
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              rows={4}
              maxLength={2000}
              className="input"
              placeholder="Ex: Alta abrupta no preço do aço CA-50 entre março e junho/2025, com aumento de 42% conforme tabela SINAPI…"
            />
            <p className="mt-1 font-mono text-[10px] text-slate-500">
              {form.descricao.length}/2000 · mínimo 30 caracteres
            </p>
          </Field>

          <Field label="Tipo do impacto solicitado" required>
            <Select
              value={form.impacto_tipo}
              onChange={(e) => setForm({ ...form, impacto_tipo: e.target.value as ReequilibrioImpactoTipo })}
              options={Object.entries(REEQUILIBRIO_IMPACTO_LABELS).map(([v, l]) => ({ value: v, label: l }))}
            />
          </Field>

          {(form.impacto_tipo === 'valor_aumento' || form.impacto_tipo === 'valor_reducao' || form.impacto_tipo === 'misto') && (
            <Field label={`Valor ${form.impacto_tipo === 'valor_reducao' ? 'a reduzir' : 'a acrescer'} solicitado`} hint="Em R$. Opcional na criação, pode ajustar depois">
              <input
                type="text"
                inputMode="decimal"
                value={form.valor_solicitado}
                onChange={(e) => setForm({ ...form, valor_solicitado: e.target.value })}
                placeholder="0,00"
                className="input font-mono"
              />
            </Field>
          )}

          {(form.impacto_tipo === 'prazo' || form.impacto_tipo === 'misto') && (
            <Field label="Prazo adicional solicitado (dias)">
              <input
                type="number"
                min={0}
                value={form.prazo_solicitado_dias}
                onChange={(e) => setForm({ ...form, prazo_solicitado_dias: e.target.value })}
                className="input"
              />
            </Field>
          )}
        </div>
      </Modal>

      {/* Modal: detalhe + workflow */}
      <ReequilibrioDetailModal
        id={detailId}
        onClose={() => setDetailId(null)}
        contractId={contractId!}
        canSolicitar={canSolicitar}
        canAnalisar={canAnalisar}
        canDecidir={canDecidir}
        onFeedback={setFeedback}
      />

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

// =============================================================================
// Modal de detalhe — mostra ciclo de vida + actions contextuais
// =============================================================================
function ReequilibrioDetailModal({
  id, onClose, contractId, canSolicitar, canAnalisar, canDecidir, onFeedback,
}: {
  id: string | null;
  onClose: () => void;
  contractId: string;
  canSolicitar: boolean;
  canAnalisar: boolean;
  canDecidir: boolean;
  onFeedback: (f: { tone: 'ok' | 'error'; message: string }) => void;
}) {
  const qc = useQueryClient();
  const [activeAction, setActiveAction] = useState<null | 'analyze' | 'decide' | 'apply' | 'cancel'>(null);
  const [parecer, setParecer] = useState('');
  const [decideMot, setDecideMot] = useState('');
  const [decideAprovar, setDecideAprovar] = useState(true);
  const [decideValor, setDecideValor] = useState('');
  const [decidePrazo, setDecidePrazo] = useState('');
  const [applyAditivoId, setApplyAditivoId] = useState('');
  const [applyNotes, setApplyNotes] = useState('');
  const [cancelMot, setCancelMot] = useState('');

  const { data: r } = useQuery({
    queryKey: ['reequilibrio-detail', id],
    queryFn: () => getReequilibrioDetail(id!),
    enabled: !!id,
  });

  function resetActionState() {
    setActiveAction(null);
    setParecer(''); setDecideMot(''); setDecideValor(''); setDecidePrazo('');
    setApplyAditivoId(''); setApplyNotes(''); setCancelMot('');
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['reequilibrio-detail', id] });
    qc.invalidateQueries({ queryKey: ['contract-reequilibrios', contractId] });
    qc.invalidateQueries({ queryKey: ['contract-reequilibrio-summary', contractId] });
  }

  const mSubmit = useMutation({
    mutationFn: () => submitReequilibrioRequest(id!),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Submetido para análise técnica' }); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mAnalyze = useMutation({
    mutationFn: () => completeTechnicalAnalysis(id!, parecer),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Análise técnica concluída · aguarda decisão' }); resetActionState(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mDecide = useMutation({
    mutationFn: () => decideReequilibrio({
      id: id!,
      aprovar: decideAprovar,
      motivacao: decideMot,
      valor_aprovado: decideAprovar && decideValor ? parseFloat(decideValor.replace(',', '.')) : null,
      prazo_aprovado_dias: decideAprovar && decidePrazo ? parseInt(decidePrazo) : null,
    }),
    onSuccess: () => { onFeedback({ tone: 'ok', message: decideAprovar ? 'Reequilíbrio aprovado' : 'Reequilíbrio recusado' }); resetActionState(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mApply = useMutation({
    mutationFn: () => applyReequilibrio({
      id: id!,
      additive_id: applyAditivoId || null,
      notes: applyNotes || undefined,
    }),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Reequilíbrio marcado como aplicado' }); resetActionState(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mCancel = useMutation({
    mutationFn: () => cancelReequilibrio(id!, cancelMot),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Solicitação cancelada' }); resetActionState(); invalidate(); onClose(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  if (!r) {
    return (
      <Modal open={!!id} onClose={onClose} title="Carregando…" size="lg">
        <p className="text-sm text-slate-500">Buscando detalhe…</p>
      </Modal>
    );
  }

  const showSubmit  = canSolicitar && r.status === 'rascunho';
  const showAnalyze = canAnalisar  && r.status === 'em_analise_tecnica';
  const showDecide  = canDecidir   && r.status === 'em_aprovacao';
  const showApply   = canDecidir   && r.status === 'aprovado';
  const showCancel  = (canSolicitar || canDecidir) &&
                      ['rascunho','em_analise_tecnica','em_aprovacao','aprovado'].includes(r.status);

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      title={`Reequilíbrio #${r.numero}`}
      subtitle={REEQUILIBRIO_TIPO_EVENTO_LABELS[r.tipo_evento]}
      size="xl"
    >
      <div className="space-y-3">
        {/* Status + ações */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-border-dark dark:bg-muted-dark">
          <div className="flex items-center gap-2">
            <Badge tone={reequilibrioStatusTone(r.status)}>{REEQUILIBRIO_STATUS_LABELS[r.status]}</Badge>
            <span className="text-xs text-slate-500">·</span>
            <span className="font-mono text-[10px] uppercase tracking-display text-slate-500">{r.fundamentacao_legal}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {showSubmit && (
              <Button size="sm" onClick={() => mSubmit.mutate()} loading={mSubmit.isPending}>
                <Send className="h-3.5 w-3.5" />Submeter à análise
              </Button>
            )}
            {showAnalyze && (
              <Button size="sm" onClick={() => setActiveAction('analyze')}>
                <ClipboardCheck className="h-3.5 w-3.5" />Concluir análise
              </Button>
            )}
            {showDecide && (
              <Button size="sm" onClick={() => setActiveAction('decide')}>
                <FileSearch className="h-3.5 w-3.5" />Decidir
              </Button>
            )}
            {showApply && (
              <Button size="sm" onClick={() => setActiveAction('apply')}>
                <CheckCircle2 className="h-3.5 w-3.5" />Marcar como aplicado
              </Button>
            )}
            {showCancel && (
              <Button size="sm" variant="outline" onClick={() => setActiveAction('cancel')}>
                <XCircle className="h-3.5 w-3.5" />Cancelar
              </Button>
            )}
          </div>
        </div>

        {/* Conteúdo principal */}
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="p-3">
            <p className="mb-1 font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500">Evento</p>
            <p className="text-sm dark:text-slate-200">{REEQUILIBRIO_TIPO_EVENTO_LABELS[r.tipo_evento]}</p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">Ocorrência: {fmtDate(r.data_evento)}</p>
          </Card>
          <Card className="p-3">
            <p className="mb-1 font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500">Impacto pleiteado</p>
            <p className="text-sm dark:text-slate-200">{REEQUILIBRIO_IMPACTO_LABELS[r.impacto_tipo]}</p>
            <div className="mt-1 flex gap-3 font-mono text-[10px] text-slate-500">
              {r.impacto_tipo !== 'prazo' && <span>Valor: {brl(r.valor_solicitado)}</span>}
              {(r.impacto_tipo === 'prazo' || r.impacto_tipo === 'misto') && <span>Prazo: +{r.prazo_solicitado_dias}d</span>}
            </div>
          </Card>
        </div>

        <Card className="p-3">
          <p className="mb-1 font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500">Descrição do evento</p>
          <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{r.descricao_evento}</p>
        </Card>

        {/* Análise técnica */}
        {r.parecer_tecnico && (
          <Card className="p-3 border-blue-200 dark:border-blue-900/40">
            <div className="mb-1 flex items-center justify-between">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-blue-700 dark:text-blue-300">Parecer técnico</p>
              <p className="font-mono text-[10px] text-slate-500">
                {r.analista_nome || '—'} · {dtTime(r.analise_at!)}
              </p>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{r.parecer_tecnico}</p>
          </Card>
        )}

        {/* Decisão */}
        {r.decided_at && (
          <Card className={`p-3 ${r.status === 'recusado' ? 'border-error/40' : 'border-success/40'}`}>
            <div className="mb-1 flex items-center justify-between">
              <p className={`font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display ${r.status === 'recusado' ? 'text-error' : 'text-success'}`}>
                {r.status === 'recusado' ? 'Decisão · Recusado' : 'Decisão · Aprovado'}
              </p>
              <p className="font-mono text-[10px] text-slate-500">
                {r.decided_by_nome || '—'} · {dtTime(r.decided_at)}
              </p>
            </div>
            {r.status !== 'recusado' && (r.valor_aprovado != null || (r.prazo_aprovado_dias ?? 0) > 0) && (
              <div className="mb-2 flex flex-wrap gap-2 text-xs">
                {r.valor_aprovado != null && (
                  <span className="rounded-full bg-success/15 px-2 py-0.5 font-mono tabular text-success">
                    Valor aprovado: {brl(r.valor_aprovado)}
                  </span>
                )}
                {(r.prazo_aprovado_dias ?? 0) > 0 && (
                  <span className="rounded-full bg-success/15 px-2 py-0.5 font-mono tabular text-success">
                    Prazo aprovado: +{r.prazo_aprovado_dias}d
                  </span>
                )}
              </div>
            )}
            <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{r.decisao_motivacao}</p>
          </Card>
        )}

        {/* Aplicação */}
        {r.applied_at && (
          <Card className="p-3 border-purple-200 dark:border-purple-900/40">
            <div className="mb-1 flex items-center justify-between">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-purple-700 dark:text-purple-300">
                Aplicado
              </p>
              <p className="font-mono text-[10px] text-slate-500">
                {r.applied_by_nome || '—'} · {dtTime(r.applied_at)}
              </p>
            </div>
            {r.additive_numero != null && (
              <p className="mb-1 text-xs">
                <LinkIcon className="mr-1 inline h-3 w-3" />
                Vinculado ao Aditivo <strong>#{r.additive_numero}</strong>
              </p>
            )}
            {r.application_notes && (
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{r.application_notes}</p>
            )}
          </Card>
        )}

        {/* Action panels */}
        {activeAction === 'analyze' && (
          <Card className="p-3 border-blue-300 bg-blue-50/50 dark:border-blue-900/60 dark:bg-blue-900/10">
            <Field label="Parecer técnico" required hint="Análise fundamentada do evento e do nexo causal com a equação econômica · mínimo 50 caracteres">
              <textarea
                value={parecer}
                onChange={(e) => setParecer(e.target.value)}
                rows={5}
                maxLength={5000}
                className="input"
                placeholder="Análise da imprevisibilidade do evento, do nexo causal com o desequilíbrio, e do quantum proposto…"
              />
              <p className="mt-1 font-mono text-[10px] text-slate-500">{parecer.length}/5000 · mínimo 50</p>
            </Field>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetActionState}>Cancelar</Button>
              <Button size="sm" onClick={() => mAnalyze.mutate()} loading={mAnalyze.isPending} disabled={parecer.trim().length < 50}>
                Concluir análise
              </Button>
            </div>
          </Card>
        )}

        {activeAction === 'decide' && (
          <Card className="p-3 border-purple-300 bg-purple-50/50 dark:border-purple-900/60 dark:bg-purple-900/10">
            <div className="mb-3 flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="radio" checked={decideAprovar} onChange={() => setDecideAprovar(true)} />
                Aprovar
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="radio" checked={!decideAprovar} onChange={() => setDecideAprovar(false)} />
                Recusar
              </label>
            </div>

            {decideAprovar && (
              <div className="mb-3 grid gap-3 md:grid-cols-2">
                <Field label="Valor aprovado (R$)" hint="Pode ser diferente do solicitado">
                  <input
                    type="text" inputMode="decimal"
                    value={decideValor}
                    onChange={(e) => setDecideValor(e.target.value)}
                    placeholder={r.valor_solicitado ? r.valor_solicitado.toFixed(2).replace('.', ',') : '0,00'}
                    className="input font-mono"
                  />
                </Field>
                <Field label="Prazo aprovado (dias)">
                  <input
                    type="number" min={0}
                    value={decidePrazo}
                    onChange={(e) => setDecidePrazo(e.target.value)}
                    placeholder={String(r.prazo_solicitado_dias)}
                    className="input"
                  />
                </Field>
              </div>
            )}

            <Field label="Motivação da decisão" required hint="Fundamentação · mínimo 20 caracteres">
              <textarea
                value={decideMot}
                onChange={(e) => setDecideMot(e.target.value)}
                rows={3}
                maxLength={3000}
                className="input"
              />
              <p className="mt-1 font-mono text-[10px] text-slate-500">{decideMot.length}/3000 · mínimo 20</p>
            </Field>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetActionState}>Cancelar</Button>
              <Button size="sm" onClick={() => mDecide.mutate()} loading={mDecide.isPending} disabled={decideMot.trim().length < 20}>
                {decideAprovar ? 'Aprovar' : 'Recusar'}
              </Button>
            </div>
          </Card>
        )}

        {activeAction === 'apply' && (
          <Card className="p-3 border-success/40 bg-success/5">
            <Field label="ID do aditivo vinculado (opcional)" hint="Se a aplicação se materializou em aditivo formal, cole o UUID do aditivo">
              <input
                type="text"
                value={applyAditivoId}
                onChange={(e) => setApplyAditivoId(e.target.value)}
                placeholder="uuid do aditivo · opcional"
                className="input font-mono text-xs"
              />
            </Field>
            <Field label="Observações da aplicação">
              <textarea
                value={applyNotes}
                onChange={(e) => setApplyNotes(e.target.value)}
                rows={3}
                maxLength={1000}
                className="input"
              />
            </Field>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetActionState}>Cancelar</Button>
              <Button size="sm" onClick={() => mApply.mutate()} loading={mApply.isPending}>
                Marcar como aplicado
              </Button>
            </div>
          </Card>
        )}

        {activeAction === 'cancel' && (
          <Card className="p-3 border-error/40 bg-error/5">
            <Field label="Motivo do cancelamento">
              <textarea
                value={cancelMot}
                onChange={(e) => setCancelMot(e.target.value)}
                rows={3}
                maxLength={1000}
                className="input"
                placeholder="Ex: Solicitação substituída pelo reequilíbrio #X, evento sanado, etc."
              />
            </Field>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetActionState}>Manter</Button>
              <Button size="sm" onClick={() => mCancel.mutate()} loading={mCancel.isPending}>
                <RotateCcw className="h-3.5 w-3.5" />Cancelar solicitação
              </Button>
            </div>
          </Card>
        )}

        {/* Audit footer */}
        <p className="font-mono text-[10px] text-slate-400">
          Criado em {dtTime(r.created_at)} por {r.created_by_nome || '—'}
        </p>
      </div>
    </Modal>
  );
}
