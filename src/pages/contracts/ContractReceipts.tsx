import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileCheck, Plus, ShieldCheck, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, Send, ClipboardList, Clock, RotateCcw,
} from 'lucide-react';
import {
  listContractReceipts, listReceiptVicios, getContractReceiptsSummary,
  createReceipt, emitReceipt, addReceiptVicio, resolveVicio, cancelReceipt,
  RECEIPT_TIPO_LABELS, RECEIPT_STATUS_LABELS, receiptStatusTone,
  VICIO_SEVERIDADE_LABELS, vicioSeveridadeTone, VICIO_STATUS_LABELS,
  type ContractReceipt, type ReceiptTipo, type VicioSeveridade,
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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export function ContractReceipts() {
  const { id: contractId } = useParams<{ id: string }>();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canWrite = hasRole(['admin', 'gestor_contrato', 'fiscal']);

  const [newOpen, setNewOpen] = useState(false);
  const [emitOpen, setEmitOpen] = useState<ContractReceipt | null>(null);
  const [vicioOpen, setVicioOpen] = useState<ContractReceipt | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  const { data: summary } = useQuery({
    queryKey: ['contract-receipts-summary', contractId],
    queryFn: () => getContractReceiptsSummary(contractId!),
    enabled: !!contractId,
  });
  const { data: receipts = [] } = useQuery({
    queryKey: ['contract-receipts', contractId],
    queryFn: () => listContractReceipts(contractId!),
    enabled: !!contractId,
  });

  // Form de nova solicitação
  const [newForm, setNewForm] = useState({
    tipo: 'provisorio' as ReceiptTipo,
    data_comunicacao: '',
    provisorio_id: '',
    observacoes: '',
  });

  const mCreate = useMutation({
    mutationFn: () => createReceipt({
      contract_id: contractId!,
      tipo: newForm.tipo,
      data_comunicacao: newForm.data_comunicacao || null,
      provisorio_id: newForm.tipo === 'definitivo' ? (newForm.provisorio_id || null) : null,
      observacoes: newForm.observacoes || null,
    }),
    onSuccess: () => {
      setNewOpen(false);
      setNewForm({ tipo: 'provisorio', data_comunicacao: '', provisorio_id: '', observacoes: '' });
      setFeedback({ tone: 'ok', message: 'Termo criado em rascunho. Abra "Emitir" para liberar.' });
      qc.invalidateQueries({ queryKey: ['contract-receipts', contractId] });
      qc.invalidateQueries({ queryKey: ['contract-receipts-summary', contractId] });
    },
    onError: (e) => setFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  // Form de emissão
  const [emitForm, setEmitForm] = useState({
    data_emissao: new Date().toISOString().slice(0, 10),
    parecer_tecnico: '',
    prazo_garantia_meses: 12,
  });
  function openEmitModal(r: ContractReceipt) {
    setEmitForm({
      data_emissao: r.data_emissao || new Date().toISOString().slice(0, 10),
      parecer_tecnico: '',
      prazo_garantia_meses: r.tipo === 'definitivo' ? 12 : 0,
    });
    setEmitOpen(r);
  }
  const mEmit = useMutation({
    mutationFn: () => emitReceipt({
      id: emitOpen!.id,
      data_emissao: emitForm.data_emissao,
      parecer_tecnico: emitForm.parecer_tecnico || undefined,
      prazo_garantia_meses: emitOpen!.tipo === 'definitivo' && emitForm.prazo_garantia_meses > 0
        ? emitForm.prazo_garantia_meses : null,
    }),
    onSuccess: () => {
      setEmitOpen(null);
      setFeedback({ tone: 'ok', message: 'Termo emitido' });
      qc.invalidateQueries({ queryKey: ['contract-receipts', contractId] });
      qc.invalidateQueries({ queryKey: ['contract-receipts-summary', contractId] });
    },
    onError: (e) => setFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  const provisoriosDisponiveis = receipts.filter(
    (r) => r.tipo === 'provisorio' && ['emitido', 'sanado'].includes(r.status) && r.vicios_abertos === 0,
  );

  return (
    <>
      <Layout>
        <PageHeader
          kicker="Contrato"
          title="Recebimentos"
          subtitle="Termos provisório e definitivo (Lei 14.133 art. 140) · prazo de garantia · vícios"
          backTo={`/contratos/${contractId}`}
          backLabel="Contrato"
          actions={
            canWrite && (
              <Button onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" />Novo termo
              </Button>
            )
          }
        />

        {/* KPIs */}
        {summary && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Provisórios emitidos
              </p>
              <p className="mt-1 font-mono text-xl sm:text-2xl font-bold tabular dark:text-slate-100">{summary.provisorios_emitidos}</p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Definitivos emitidos
              </p>
              <p className="mt-1 font-mono text-xl sm:text-2xl font-bold tabular dark:text-slate-100">{summary.definitivos_emitidos}</p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Vícios abertos
              </p>
              <p className={`mt-1 font-mono text-xl sm:text-2xl font-bold tabular ${summary.vicios_abertos > 0 ? 'text-error' : 'text-slate-500'}`}>
                {summary.vicios_abertos}
              </p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Garantia
              </p>
              {summary.garantia_ativa && summary.garantia_fim ? (
                <>
                  <p className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-success">
                    <ShieldCheck className="h-4 w-4" />Ativa
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                    Até {fmtDate(summary.garantia_fim)} · {summary.garantia_dias_restantes}d
                  </p>
                </>
              ) : summary.garantia_fim ? (
                <>
                  <p className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-slate-500">
                    <Clock className="h-4 w-4" />Vencida
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                    Venceu {fmtDate(summary.garantia_fim)}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-400">—</p>
              )}
            </Card>
          </div>
        )}

        <Card>
          <div className="border-b border-slate-200 px-4 py-3 dark:border-border-dark">
            <p className="font-semibold dark:text-slate-200">Termos emitidos</p>
          </div>

          {receipts.length === 0 && (
            <div className="px-4 py-12 text-center">
              <FileCheck className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Nenhum termo emitido</p>
              <p className="mt-1 text-xs text-slate-400">
                Crie primeiro o provisório; o definitivo pode ser emitido até 90 dias depois.
              </p>
            </div>
          )}

          {receipts.length > 0 && (
            <ScrollShadow>
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-8"></th>
                    <th>Termo</th>
                    <th>Status</th>
                    <th className="hidden md:table-cell">Emissão</th>
                    <th className="hidden lg:table-cell">Limite definitivo</th>
                    <th className="text-right">Vícios</th>
                    <th className="hidden lg:table-cell">Garantia</th>
                    <th className="w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <ReceiptRow
                      key={r.id}
                      r={r}
                      expanded={expandedId === r.id}
                      onToggleExpand={() => setExpandedId(expandedId === r.id ? null : r.id)}
                      onEmit={() => openEmitModal(r)}
                      onAddVicio={() => setVicioOpen(r)}
                      onFeedback={setFeedback}
                      canWrite={canWrite}
                    />
                  ))}
                </tbody>
              </table>
            </ScrollShadow>
          )}
        </Card>
      </Layout>

      {/* Modal: novo termo */}
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Novo termo de recebimento"
        subtitle="Lei 14.133 art. 140"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => mCreate.mutate()}
              loading={mCreate.isPending}
              disabled={newForm.tipo === 'definitivo' && !newForm.provisorio_id}
            >
              Criar em rascunho
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Tipo" required>
            <Select
              value={newForm.tipo}
              onChange={(e) => setNewForm({ ...newForm, tipo: e.target.value as ReceiptTipo })}
              options={[
                { value: 'provisorio', label: 'Provisório (até 15 dias após comunicação do contratado)' },
                { value: 'definitivo', label: 'Definitivo (até 90 dias após provisório)' },
              ]}
            />
          </Field>

          {newForm.tipo === 'provisorio' && (
            <Field label="Data da comunicação do contratado" hint="Marco do prazo de 15 dias">
              <input
                type="date"
                value={newForm.data_comunicacao}
                onChange={(e) => setNewForm({ ...newForm, data_comunicacao: e.target.value })}
                className="input"
              />
            </Field>
          )}

          {newForm.tipo === 'definitivo' && (
            <Field label="Recebimento provisório vinculado" required hint="Apenas provisórios sem vícios abertos">
              {provisoriosDisponiveis.length === 0 ? (
                <p className="rounded-lg border border-amber-300/40 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/15 dark:text-amber-200">
                  <AlertTriangle className="mr-1 inline h-3 w-3" />
                  Nenhum provisório elegível. Emita um provisório e sane os vícios antes de criar definitivo.
                </p>
              ) : (
                <Select
                  value={newForm.provisorio_id}
                  onChange={(e) => setNewForm({ ...newForm, provisorio_id: e.target.value })}
                  options={provisoriosDisponiveis.map((p) => ({
                    value: p.id,
                    label: `Provisório #${p.numero} · emitido em ${fmtDate(p.data_emissao)}`,
                  }))}
                  placeholder="Escolha o provisório"
                />
              )}
            </Field>
          )}

          <Field label="Observações (opcional)">
            <textarea
              value={newForm.observacoes}
              onChange={(e) => setNewForm({ ...newForm, observacoes: e.target.value })}
              rows={2}
              maxLength={500}
              className="input"
            />
          </Field>
        </div>
      </Modal>

      {/* Modal: emitir termo */}
      <Modal
        open={!!emitOpen}
        onClose={() => setEmitOpen(null)}
        title={emitOpen ? `Emitir ${RECEIPT_TIPO_LABELS[emitOpen.tipo]} #${emitOpen.numero}` : ''}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEmitOpen(null)}>Cancelar</Button>
            <Button onClick={() => mEmit.mutate()} loading={mEmit.isPending}>
              <Send className="h-4 w-4" />Emitir
            </Button>
          </div>
        }
      >
        {emitOpen && (
          <div className="space-y-3">
            <Field label="Data de emissão" required>
              <input
                type="date"
                value={emitForm.data_emissao}
                onChange={(e) => setEmitForm({ ...emitForm, data_emissao: e.target.value })}
                className="input"
              />
            </Field>

            <Field label="Parecer técnico (opcional)">
              <textarea
                value={emitForm.parecer_tecnico}
                onChange={(e) => setEmitForm({ ...emitForm, parecer_tecnico: e.target.value })}
                rows={4}
                maxLength={3000}
                className="input"
                placeholder="Verificações executadas, conformidade com termos contratuais, observações…"
              />
            </Field>

            {emitOpen.tipo === 'definitivo' && (
              <Field
                label="Prazo de garantia (meses)"
                hint="Deixe 0 ou vazio se não houver garantia formal. Garantia inicia na data de emissão."
              >
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={emitForm.prazo_garantia_meses}
                  onChange={(e) => setEmitForm({ ...emitForm, prazo_garantia_meses: Number(e.target.value) || 0 })}
                  className="input"
                />
              </Field>
            )}

            {emitOpen.tipo === 'provisorio' && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/15 dark:text-blue-200">
                Após emissão, prazo de 90 dias para emitir o recebimento definitivo será computado automaticamente.
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Modal: adicionar vício */}
      <AddVicioModal
        receipt={vicioOpen}
        onClose={() => setVicioOpen(null)}
        onFeedback={setFeedback}
        contractId={contractId!}
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
// Linha + linha expandida (vícios)
// =============================================================================
function ReceiptRow({
  r, expanded, onToggleExpand, onEmit, onAddVicio, onFeedback, canWrite,
}: {
  r: ContractReceipt;
  expanded: boolean;
  onToggleExpand: () => void;
  onEmit: () => void;
  onAddVicio: () => void;
  onFeedback: (f: { tone: 'ok' | 'error'; message: string }) => void;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const { data: vicios = [] } = useQuery({
    queryKey: ['receipt-vicios', r.id],
    queryFn: () => listReceiptVicios(r.id),
    enabled: expanded && r.vicios_total > 0,
  });

  const mResolve = useMutation({
    mutationFn: (vars: { id: string; status: 'sanado' | 'aceito_residual' | 'cancelado'; evidencia?: string }) =>
      resolveVicio(vars.id, vars.status, vars.evidencia),
    onSuccess: () => {
      onFeedback({ tone: 'ok', message: 'Vício resolvido' });
      qc.invalidateQueries({ queryKey: ['receipt-vicios', r.id] });
      qc.invalidateQueries({ queryKey: ['contract-receipts'] });
      qc.invalidateQueries({ queryKey: ['contract-receipts-summary'] });
    },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  const mCancel = useMutation({
    mutationFn: (motivo: string) => cancelReceipt(r.id, motivo),
    onSuccess: () => {
      onFeedback({ tone: 'ok', message: 'Termo cancelado' });
      qc.invalidateQueries({ queryKey: ['contract-receipts'] });
      qc.invalidateQueries({ queryKey: ['contract-receipts-summary'] });
    },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  const canEmit  = canWrite && r.status === 'rascunho';
  const canAddVicio = canWrite && ['rascunho', 'emitido', 'com_pendencias'].includes(r.status);
  const canCancel = canWrite && r.status !== 'cancelado' && !(r.tipo === 'provisorio' && r.status === 'emitido' && false);

  return (
    <>
      <tr className="hover:bg-slate-50 dark:hover:bg-muted-dark/40">
        <td>
          <button
            type="button"
            onClick={onToggleExpand}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-muted-dark"
            aria-label="Expandir vícios"
            disabled={r.vicios_total === 0}
          >
            {r.vicios_total === 0 ? (
              <div className="h-4 w-4" />
            ) : expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </td>
        <td>
          <p className="font-medium dark:text-slate-200">
            {RECEIPT_TIPO_LABELS[r.tipo]} #{r.numero}
          </p>
          {r.provisorio_numero != null && (
            <p className="font-mono text-[10px] text-slate-500">
              vinculado a Provisório #{r.provisorio_numero}
            </p>
          )}
        </td>
        <td>
          <Badge tone={receiptStatusTone(r.status)}>{RECEIPT_STATUS_LABELS[r.status]}</Badge>
        </td>
        <td className="hidden md:table-cell font-mono text-xs">{fmtDate(r.data_emissao)}</td>
        <td className="hidden lg:table-cell font-mono text-xs">
          {r.tipo === 'provisorio' && r.data_limite_definitivo
            ? fmtDate(r.data_limite_definitivo)
            : '—'}
        </td>
        <td className="text-right">
          {r.vicios_total > 0 ? (
            <span className={r.vicios_abertos > 0 ? 'text-error' : 'text-success'}>
              <span className="font-mono tabular text-sm font-semibold">{r.vicios_abertos}</span>
              <span className="text-[10px] text-slate-500">/{r.vicios_total}</span>
            </span>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </td>
        <td className="hidden lg:table-cell">
          {r.garantia_fim ? (
            <div className="text-xs">
              <p className="font-mono">{fmtDate(r.garantia_inicio)} → {fmtDate(r.garantia_fim)}</p>
              <p className="font-mono text-[10px] text-slate-500">{r.prazo_garantia_meses} meses</p>
            </div>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </td>
        <td>
          <div className="flex items-center gap-1">
            {canEmit && (
              <button
                type="button"
                onClick={onEmit}
                className="rounded p-2 sm:p-1.5 text-slate-500 hover:bg-slate-100 hover:text-magenta dark:hover:bg-muted-dark"
                title="Emitir"
                aria-label={`Emitir ${RECEIPT_TIPO_LABELS[r.tipo]} #${r.numero}`}
              >
                <Send className="h-4 w-4" />
              </button>
            )}
            {canAddVicio && (
              <button
                type="button"
                onClick={onAddVicio}
                className="rounded p-2 sm:p-1.5 text-slate-500 hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-900/30 dark:hover:text-amber-200"
                title="Adicionar vício"
                aria-label={`Adicionar vício a ${RECEIPT_TIPO_LABELS[r.tipo]} #${r.numero}`}
              >
                <ClipboardList className="h-4 w-4" />
              </button>
            )}
            {canCancel && r.status !== 'cancelado' && (
              <button
                type="button"
                onClick={() => {
                  const motivo = prompt('Motivo do cancelamento:');
                  if (motivo && motivo.trim()) mCancel.mutate(motivo.trim());
                }}
                className="rounded p-2 sm:p-1.5 text-slate-400 hover:bg-error/10 hover:text-error"
                title="Cancelar termo"
                aria-label={`Cancelar ${RECEIPT_TIPO_LABELS[r.tipo]} #${r.numero}`}
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && r.vicios_total > 0 && (
        <tr>
          <td colSpan={8} className="bg-slate-50 px-4 py-3 dark:bg-muted-dark/30">
            <p className="mb-2 font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500">
              Vícios identificados
            </p>
            <div className="space-y-2">
              {vicios.map((v) => (
                <div
                  key={v.id}
                  className="rounded-lg border border-slate-200 bg-white p-3 dark:border-border-dark dark:bg-card-dark"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold dark:text-slate-200">#{v.ordem}</span>
                        <Badge tone={vicioSeveridadeTone(v.severidade)}>{VICIO_SEVERIDADE_LABELS[v.severidade]}</Badge>
                        <Badge tone={
                          v.status === 'sanado' ? 'green' :
                          v.status === 'aceito_residual' ? 'blue' :
                          v.status === 'cancelado' ? 'slate' : 'yellow'
                        }>{VICIO_STATUS_LABELS[v.status]}</Badge>
                        {v.local_referencia && (
                          <span className="font-mono text-[10px] text-slate-500">{v.local_referencia}</span>
                        )}
                      </div>
                      <p className="text-sm text-slate-700 dark:text-slate-300">{v.descricao}</p>
                      <p className="mt-1 font-mono text-[10px] text-slate-500">
                        Prazo de saneamento: {v.prazo_saneamento_dias}d · limite {fmtDate(v.data_limite_saneamento)}
                        {v.sanado_at && ` · resolvido em ${dtTime(v.sanado_at)} por ${v.sanado_por_nome || '—'}`}
                      </p>
                      {v.evidencia_saneamento && (
                        <p className="mt-1 text-xs italic text-slate-600 dark:text-slate-400">
                          Evidência: "{v.evidencia_saneamento}"
                        </p>
                      )}
                    </div>
                    {canWrite && ['aberto', 'em_saneamento'].includes(v.status) && (
                      <div className="flex flex-shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const evidencia = prompt('Evidência de saneamento (opcional):') || undefined;
                            mResolve.mutate({ id: v.id, status: 'sanado', evidencia });
                          }}
                          className="rounded p-2 sm:p-1.5 text-success hover:bg-success/10"
                          title="Marcar como sanado"
                          aria-label={`Marcar vício #${v.ordem} como sanado`}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const evidencia = prompt('Justificativa para aceitação residual:') || undefined;
                            if (evidencia) mResolve.mutate({ id: v.id, status: 'aceito_residual', evidencia });
                          }}
                          className="rounded p-2 sm:p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                          title="Aceitar como residual (não-bloqueante)"
                          aria-label={`Aceitar vício #${v.ordem} como residual`}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// =============================================================================
// Modal: adicionar vício
// =============================================================================
function AddVicioModal({
  receipt, onClose, onFeedback, contractId,
}: {
  receipt: ContractReceipt | null;
  onClose: () => void;
  onFeedback: (f: { tone: 'ok' | 'error'; message: string }) => void;
  contractId: string;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    descricao: '',
    severidade: 'media' as VicioSeveridade,
    local_referencia: '',
    prazo_saneamento_dias: 30,
  });

  const mAdd = useMutation({
    mutationFn: () => addReceiptVicio({
      receipt_id: receipt!.id,
      descricao: form.descricao,
      severidade: form.severidade,
      local_referencia: form.local_referencia || undefined,
      prazo_saneamento_dias: form.prazo_saneamento_dias,
    }),
    onSuccess: () => {
      onFeedback({ tone: 'ok', message: 'Vício registrado' });
      onClose();
      setForm({ descricao: '', severidade: 'media', local_referencia: '', prazo_saneamento_dias: 30 });
      qc.invalidateQueries({ queryKey: ['contract-receipts', contractId] });
      qc.invalidateQueries({ queryKey: ['contract-receipts-summary', contractId] });
      qc.invalidateQueries({ queryKey: ['receipt-vicios', receipt!.id] });
    },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  return (
    <Modal
      open={!!receipt}
      onClose={onClose}
      title={receipt ? `Novo vício · ${RECEIPT_TIPO_LABELS[receipt.tipo]} #${receipt.numero}` : ''}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => mAdd.mutate()}
            loading={mAdd.isPending}
            disabled={form.descricao.trim().length < 20}
          >
            Registrar vício
          </Button>
        </div>
      }
    >
      {receipt && (
        <div className="space-y-3">
          <Field label="Descrição do vício" required hint="Caracterização técnica · mínimo 20 caracteres">
            <textarea
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              rows={3}
              maxLength={2000}
              className="input"
              placeholder="Ex: Fissuras de retração no piso da sala 304, com extensão de 1,2m e abertura média de 0,3mm…"
            />
            <p className="mt-1 font-mono text-[10px] text-slate-500">{form.descricao.length}/2000 · mínimo 20</p>
          </Field>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Severidade" required>
              <Select
                value={form.severidade}
                onChange={(e) => setForm({ ...form, severidade: e.target.value as VicioSeveridade })}
                options={Object.entries(VICIO_SEVERIDADE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
              />
            </Field>
            <Field label="Prazo de saneamento (dias)" required>
              <input
                type="number"
                min={1}
                value={form.prazo_saneamento_dias}
                onChange={(e) => setForm({ ...form, prazo_saneamento_dias: Number(e.target.value) || 30 })}
                className="input"
              />
            </Field>
          </div>

          <Field label="Localização (opcional)" hint="Ex: Bloco B · pavimento 3 · sala 304">
            <input
              type="text"
              value={form.local_referencia}
              onChange={(e) => setForm({ ...form, local_referencia: e.target.value })}
              maxLength={200}
              className="input"
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}
