import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Plus, Calendar, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, ArrowRight, DollarSign, Clock,
  TrendingDown, TrendingUp,
} from 'lucide-react';
import {
  listContractGuarantees, listGuaranteeEvents, getContractGuaranteesSummary,
  registerGuarantee, extendGuarantee, releaseGuarantee, executeGuarantee, cancelGuarantee,
  GUARANTEE_MODALIDADE_LABELS, GUARANTEE_STATUS_LABELS, guaranteeStatusTone,
  GUARANTEE_EVENT_TIPO_LABELS, guaranteeEventTipoTone,
  type ContractGuarantee, type GuaranteeModalidade,
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

function pct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(digits)}%`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

type ActionType = 'extend' | 'release' | 'execute' | 'cancel' | null;

export function ContractGuarantees() {
  const { id: contractId } = useParams<{ id: string }>();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canWrite   = hasRole(['admin', 'gestor_contrato', 'financeiro']);
  const canExecute = hasRole(['admin', 'gestor_contrato']);

  const [newOpen, setNewOpen] = useState(false);
  const [action, setAction] = useState<{ type: ActionType; guarantee: ContractGuarantee | null }>({ type: null, guarantee: null });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  const { data: summary } = useQuery({
    queryKey: ['contract-guarantees-summary', contractId],
    queryFn: () => getContractGuaranteesSummary(contractId!),
    enabled: !!contractId,
  });
  const { data: guarantees = [] } = useQuery({
    queryKey: ['contract-guarantees', contractId],
    queryFn: () => listContractGuarantees(contractId!),
    enabled: !!contractId,
  });

  // Form de registro
  const [newForm, setNewForm] = useState({
    modalidade: 'seguro_garantia' as GuaranteeModalidade,
    valor_garantido: '',
    data_emissao: new Date().toISOString().slice(0, 10),
    data_vigencia_inicio: new Date().toISOString().slice(0, 10),
    data_vigencia_fim: '',
    emissor: '',
    instrumento_numero: '',
    beneficiario: '',
    observacoes: '',
  });

  const mRegister = useMutation({
    mutationFn: () => registerGuarantee({
      contract_id:          contractId!,
      modalidade:           newForm.modalidade,
      valor_garantido:      parseFloat(newForm.valor_garantido.replace(',', '.')),
      data_emissao:         newForm.data_emissao,
      data_vigencia_inicio: newForm.data_vigencia_inicio,
      data_vigencia_fim:    newForm.data_vigencia_fim,
      emissor:              newForm.emissor || undefined,
      instrumento_numero:   newForm.instrumento_numero || undefined,
      beneficiario:         newForm.beneficiario || undefined,
      observacoes:          newForm.observacoes || undefined,
    }),
    onSuccess: () => {
      setNewOpen(false);
      setNewForm({
        modalidade: 'seguro_garantia', valor_garantido: '',
        data_emissao: new Date().toISOString().slice(0, 10),
        data_vigencia_inicio: new Date().toISOString().slice(0, 10),
        data_vigencia_fim: '', emissor: '', instrumento_numero: '',
        beneficiario: '', observacoes: '',
      });
      setFeedback({ tone: 'ok', message: 'Garantia registrada' });
      qc.invalidateQueries({ queryKey: ['contract-guarantees', contractId] });
      qc.invalidateQueries({ queryKey: ['contract-guarantees-summary', contractId] });
    },
    onError: (e) => setFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  return (
    <>
      <Layout>
        <PageHeader
          kicker="Contrato"
          title="Garantias contratuais"
          subtitle="Caução, seguro-garantia, fiança (Lei 14.133 art. 96-101) · vigência, liberação, execução"
          backTo={`/contratos/${contractId}`}
          backLabel="Contrato"
          actions={
            canWrite && (
              <Button onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" />Registrar garantia
              </Button>
            )
          }
        />

        {/* KPIs */}
        {summary && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Garantias ativas
              </p>
              <p className="mt-1 font-mono text-xl sm:text-2xl font-bold tabular text-success">
                {summary.ativas}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                de {summary.total} total
              </p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Valor disponível
              </p>
              <p className="mt-1 font-mono text-lg font-bold tabular dark:text-slate-100">
                {brl(summary.valor_disponivel)}
              </p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Executado / Liberado
              </p>
              <p className="mt-1 font-mono text-sm tabular">
                <span className={summary.valor_executado_total > 0 ? 'text-error' : 'text-slate-500'}>
                  {brl(summary.valor_executado_total)}
                </span>
                <span className="text-slate-400 mx-1">/</span>
                <span className="text-slate-600 dark:text-slate-300">{brl(summary.valor_liberado_total)}</span>
              </p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Próximo vencimento
              </p>
              {summary.proximo_vencimento ? (
                <>
                  <p className={`mt-1 text-sm font-bold ${summary.proximo_vencimento.dias_restantes <= 30 ? 'text-error' : summary.proximo_vencimento.dias_restantes <= 60 ? 'text-yellow-600 dark:text-yellow-300' : 'text-slate-700 dark:text-slate-200'}`}>
                    #{summary.proximo_vencimento.numero} · {summary.proximo_vencimento.dias_restantes}d
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                    em {fmtDate(summary.proximo_vencimento.data_fim)}
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
            <p className="font-semibold dark:text-slate-200">Garantias registradas</p>
          </div>

          {guarantees.length === 0 && (
            <div className="px-4 py-12 text-center">
              <Shield className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Nenhuma garantia registrada</p>
              <p className="mt-1 text-xs text-slate-400">
                Registre garantias exigidas no edital/contrato (5% padrão, até 10% obras grandes, até 30% serviços de risco).
              </p>
            </div>
          )}

          {guarantees.length > 0 && (
            <ScrollShadow>
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-8"></th>
                    <th>#</th>
                    <th>Modalidade</th>
                    <th className="hidden md:table-cell">Emissor</th>
                    <th>Status</th>
                    <th className="text-right">Valor / Disponível</th>
                    <th className="hidden lg:table-cell">Vigência</th>
                    <th className="text-right">Vencimento</th>
                    <th className="w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {guarantees.map((g) => (
                    <GuaranteeRow
                      key={g.id}
                      g={g}
                      expanded={expandedId === g.id}
                      onToggle={() => setExpandedId(expandedId === g.id ? null : g.id)}
                      onAction={(type) => setAction({ type, guarantee: g })}
                      canWrite={canWrite}
                      canExecute={canExecute}
                    />
                  ))}
                </tbody>
              </table>
            </ScrollShadow>
          )}
        </Card>
      </Layout>

      {/* Modal: registrar */}
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Registrar nova garantia"
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => mRegister.mutate()}
              loading={mRegister.isPending}
              disabled={
                !newForm.valor_garantido ||
                !newForm.data_vigencia_fim ||
                parseFloat(newForm.valor_garantido.replace(',', '.')) <= 0
              }
            >
              <Plus className="h-4 w-4" />Registrar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Modalidade" required>
              <Select
                value={newForm.modalidade}
                onChange={(e) => setNewForm({ ...newForm, modalidade: e.target.value as GuaranteeModalidade })}
                options={Object.entries(GUARANTEE_MODALIDADE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
              />
            </Field>
            <Field label="Valor garantido (R$)" required>
              <input
                type="text"
                inputMode="decimal"
                value={newForm.valor_garantido}
                onChange={(e) => setNewForm({ ...newForm, valor_garantido: e.target.value })}
                placeholder="0,00"
                className="input font-mono"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3">
            <Field label="Data de emissão" required>
              <input
                type="date"
                value={newForm.data_emissao}
                onChange={(e) => setNewForm({ ...newForm, data_emissao: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Vigência início" required>
              <input
                type="date"
                value={newForm.data_vigencia_inicio}
                onChange={(e) => setNewForm({ ...newForm, data_vigencia_inicio: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Vigência fim" required>
              <input
                type="date"
                value={newForm.data_vigencia_fim}
                onChange={(e) => setNewForm({ ...newForm, data_vigencia_fim: e.target.value })}
                className="input"
              />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Emissor" hint="Nome da seguradora, banco ou instituição">
              <input
                type="text"
                value={newForm.emissor}
                onChange={(e) => setNewForm({ ...newForm, emissor: e.target.value })}
                maxLength={200}
                className="input"
                placeholder="Ex: Seguradora XYZ S/A"
              />
            </Field>
            <Field label="Nº do instrumento" hint="Apólice, contrato, depósito">
              <input
                type="text"
                value={newForm.instrumento_numero}
                onChange={(e) => setNewForm({ ...newForm, instrumento_numero: e.target.value })}
                maxLength={100}
                className="input font-mono"
                placeholder="Ex: APL-2025-001234"
              />
            </Field>
          </div>

          <Field label="Beneficiário" hint="Geralmente o órgão contratante">
            <input
              type="text"
              value={newForm.beneficiario}
              onChange={(e) => setNewForm({ ...newForm, beneficiario: e.target.value })}
              maxLength={200}
              className="input"
            />
          </Field>

          <Field label="Observações">
            <textarea
              value={newForm.observacoes}
              onChange={(e) => setNewForm({ ...newForm, observacoes: e.target.value })}
              rows={2}
              maxLength={500}
              className="input"
            />
          </Field>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/15 dark:text-blue-200">
            <strong>Limites legais (art. 98 §1º · art. 99):</strong> 5% padrão · até 10% em obras de grande vulto · até 30% em serviços de grande vulto com risco elevado. O sistema rejeita registro acima de 30%.
          </div>
        </div>
      </Modal>

      {/* Modal: ações sobre garantia */}
      <GuaranteeActionModal
        action={action}
        onClose={() => setAction({ type: null, guarantee: null })}
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
// Linha + timeline de eventos
// =============================================================================
function GuaranteeRow({
  g, expanded, onToggle, onAction, canWrite, canExecute,
}: {
  g: ContractGuarantee;
  expanded: boolean;
  onToggle: () => void;
  onAction: (type: ActionType) => void;
  canWrite: boolean;
  canExecute: boolean;
}) {
  const { data: events = [] } = useQuery({
    queryKey: ['guarantee-events', g.id],
    queryFn: () => listGuaranteeEvents(g.id),
    enabled: expanded,
  });

  const isActive = ['ativa', 'estendida', 'liberada_parcial', 'executada_parcial'].includes(g.status);
  const canExtend  = canWrite && ['ativa', 'estendida'].includes(g.status);
  const canRelease = canWrite && ['ativa', 'estendida', 'liberada_parcial'].includes(g.status);
  const canExec    = canExecute && ['ativa', 'estendida', 'executada_parcial'].includes(g.status);
  const canCancel  = canWrite && !['cancelada', 'liberada_total', 'executada_total'].includes(g.status);

  const vencimentoTone =
    !isActive ? 'text-slate-400' :
    g.dias_para_vencimento < 0 ? 'text-error font-bold' :
    g.dias_para_vencimento <= 30 ? 'text-error' :
    g.dias_para_vencimento <= 60 ? 'text-yellow-600 dark:text-yellow-300' :
    'text-slate-700 dark:text-slate-200';

  return (
    <>
      <tr className="hover:bg-slate-50 dark:hover:bg-muted-dark/40">
        <td>
          <button
            type="button"
            onClick={onToggle}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-muted-dark"
            aria-label="Expandir histórico"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="font-mono tabular text-xs font-bold dark:text-slate-200">#{g.numero}</td>
        <td>
          <p className="text-sm dark:text-slate-200">{GUARANTEE_MODALIDADE_LABELS[g.modalidade]}</p>
          {g.instrumento_numero && (
            <p className="font-mono text-[10px] text-slate-500">{g.instrumento_numero}</p>
          )}
        </td>
        <td className="hidden md:table-cell text-xs text-slate-600 dark:text-slate-300">
          {g.emissor || '—'}
        </td>
        <td>
          <Badge tone={guaranteeStatusTone(g.status)}>{GUARANTEE_STATUS_LABELS[g.status]}</Badge>
        </td>
        <td className="text-right">
          <p className="font-mono tabular text-sm font-semibold dark:text-slate-200">{brl(g.valor_garantido)}</p>
          {g.valor_disponivel !== g.valor_garantido && (
            <p className="font-mono tabular text-[10px] text-slate-500">
              Disponível: {brl(g.valor_disponivel)}
            </p>
          )}
          {g.percentual_contrato != null && (
            <p className="font-mono text-[10px] text-slate-400">{pct(g.percentual_contrato, 2)} do contrato</p>
          )}
        </td>
        <td className="hidden lg:table-cell font-mono text-xs">
          <p>{fmtDate(g.data_vigencia_inicio)}</p>
          <p className="text-slate-500">→ {fmtDate(g.data_vigencia_fim)}</p>
        </td>
        <td className="text-right">
          <span className={`font-mono tabular text-sm ${vencimentoTone}`}>
            {isActive ? (g.dias_para_vencimento < 0 ? `${Math.abs(g.dias_para_vencimento)}d vencida` : `${g.dias_para_vencimento}d`) : '—'}
          </span>
        </td>
        <td>
          <div className="flex flex-wrap items-center gap-1">
            {canExtend && (
              <button type="button" onClick={() => onAction('extend')}
                className="rounded p-2 sm:p-1.5 text-slate-500 hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900/30 dark:hover:text-blue-200"
                title="Estender vigência" aria-label={`Estender garantia #${g.numero}`}>
                <Calendar className="h-4 w-4" />
              </button>
            )}
            {canRelease && (
              <button type="button" onClick={() => onAction('release')}
                className="rounded p-2 sm:p-1.5 text-slate-500 hover:bg-success/10 hover:text-success"
                title="Liberar" aria-label={`Liberar garantia #${g.numero}`}>
                <TrendingDown className="h-4 w-4" />
              </button>
            )}
            {canExec && (
              <button type="button" onClick={() => onAction('execute')}
                className="rounded p-2 sm:p-1.5 text-slate-500 hover:bg-error/10 hover:text-error"
                title="Executar (inadimplemento)" aria-label={`Executar garantia #${g.numero}`}>
                <DollarSign className="h-4 w-4" />
              </button>
            )}
            {canCancel && (
              <button type="button" onClick={() => onAction('cancel')}
                className="rounded p-2 sm:p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-muted-dark"
                title="Cancelar" aria-label={`Cancelar garantia #${g.numero}`}>
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} className="bg-slate-50 px-4 py-3 dark:bg-muted-dark/30">
            <p className="mb-2 font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500">
              Histórico de movimentação
            </p>
            <div className="space-y-2">
              {events.length === 0 && <p className="text-xs text-slate-500">Carregando…</p>}
              {events.map((e) => (
                <div key={e.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-border-dark dark:bg-card-dark">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge tone={guaranteeEventTipoTone(e.tipo)}>{GUARANTEE_EVENT_TIPO_LABELS[e.tipo]}</Badge>
                        <span className="font-mono text-[10px] text-slate-500">{fmtDate(e.data_evento)}</span>
                        {e.valor_movimentado > 0 && (
                          <span className="font-mono tabular text-xs">
                            {e.tipo === 'execucao' ? <TrendingUp className="mr-0.5 inline h-3 w-3 text-error" /> : null}
                            {brl(e.valor_movimentado)}
                          </span>
                        )}
                        {e.nova_vigencia_fim && (
                          <span className="font-mono text-[10px] text-blue-600 dark:text-blue-300">
                            <ArrowRight className="mr-0.5 inline h-3 w-3" />
                            Nova vigência: {fmtDate(e.nova_vigencia_fim)}
                          </span>
                        )}
                        {e.aditivo_numero != null && (
                          <span className="font-mono text-[10px] text-purple-600 dark:text-purple-300">
                            Aditivo #{e.aditivo_numero}
                          </span>
                        )}
                        {e.receipt_numero != null && (
                          <span className="font-mono text-[10px] text-blue-600 dark:text-blue-300">
                            Recebimento #{e.receipt_numero}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-700 dark:text-slate-300">{e.motivacao}</p>
                      {e.evidencia && (
                        <p className="mt-1 text-xs italic text-slate-600 dark:text-slate-400">
                          Evidência: "{e.evidencia}"
                        </p>
                      )}
                      <p className="mt-1 font-mono text-[10px] text-slate-400">
                        por {e.applied_by_nome || '—'} · {dtTime(e.created_at)} · saldo após: {brl(e.valor_disponivel_apos)}
                      </p>
                    </div>
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
// Modal de ações
// =============================================================================
function GuaranteeActionModal({
  action, onClose, onFeedback, contractId,
}: {
  action: { type: ActionType; guarantee: ContractGuarantee | null };
  onClose: () => void;
  onFeedback: (f: { tone: 'ok' | 'error'; message: string }) => void;
  contractId: string;
}) {
  const qc = useQueryClient();
  const [novaVigenciaFim, setNovaVigenciaFim] = useState('');
  const [valor, setValor] = useState('');
  const [motivacao, setMotivacao] = useState('');
  const [evidencia, setEvidencia] = useState('');

  function reset() {
    setNovaVigenciaFim(''); setValor(''); setMotivacao(''); setEvidencia('');
  }
  function closeAndReset() { reset(); onClose(); }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['contract-guarantees', contractId] });
    qc.invalidateQueries({ queryKey: ['contract-guarantees-summary', contractId] });
    qc.invalidateQueries({ queryKey: ['guarantee-events'] });
  }

  const mExtend = useMutation({
    mutationFn: () => extendGuarantee({
      guarantee_id: action.guarantee!.id,
      nova_vigencia_fim: novaVigenciaFim,
      motivacao,
      evidencia: evidencia || undefined,
    }),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Vigência estendida' }); closeAndReset(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  const mRelease = useMutation({
    mutationFn: () => releaseGuarantee({
      guarantee_id: action.guarantee!.id,
      valor: parseFloat(valor.replace(',', '.')),
      motivacao,
      evidencia: evidencia || undefined,
    }),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Garantia liberada' }); closeAndReset(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  const mExecute = useMutation({
    mutationFn: () => executeGuarantee({
      guarantee_id: action.guarantee!.id,
      valor: parseFloat(valor.replace(',', '.')),
      motivacao,
      evidencia: evidencia || undefined,
    }),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Garantia executada' }); closeAndReset(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  const mCancel = useMutation({
    mutationFn: () => cancelGuarantee(action.guarantee!.id, motivacao),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Garantia cancelada' }); closeAndReset(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  if (!action.guarantee || !action.type) return null;
  const g = action.guarantee;

  const titles: Record<NonNullable<ActionType>, string> = {
    extend:  `Estender vigência · Garantia #${g.numero}`,
    release: `Liberar garantia #${g.numero}`,
    execute: `Executar garantia #${g.numero}`,
    cancel:  `Cancelar garantia #${g.numero}`,
  };

  const minMotivacao = action.type === 'execute' ? 20 : 10;
  const canSubmit =
    motivacao.trim().length >= minMotivacao &&
    (action.type === 'extend'  ? !!novaVigenciaFim && novaVigenciaFim > g.data_vigencia_fim :
     action.type === 'release' ? !!valor && parseFloat(valor.replace(',', '.')) > 0 && parseFloat(valor.replace(',', '.')) <= g.valor_disponivel :
     action.type === 'execute' ? !!valor && parseFloat(valor.replace(',', '.')) > 0 && parseFloat(valor.replace(',', '.')) <= g.valor_disponivel :
     true);

  function submit() {
    if (action.type === 'extend')  mExtend.mutate();
    if (action.type === 'release') mRelease.mutate();
    if (action.type === 'execute') mExecute.mutate();
    if (action.type === 'cancel')  mCancel.mutate();
  }

  const isPending = mExtend.isPending || mRelease.isPending || mExecute.isPending || mCancel.isPending;

  return (
    <Modal
      open={!!action.type}
      onClose={closeAndReset}
      title={titles[action.type]}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closeAndReset}>Cancelar</Button>
          <Button onClick={submit} loading={isPending} disabled={!canSubmit}>
            Confirmar
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Resumo da garantia */}
        <Card className="p-3">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-display text-slate-500">Garantia</p>
          <p className="text-sm dark:text-slate-200">
            {GUARANTEE_MODALIDADE_LABELS[g.modalidade]} · {brl(g.valor_garantido)}
          </p>
          <p className="mt-1 font-mono text-[10px] text-slate-500">
            Disponível: {brl(g.valor_disponivel)} · Vigência até {fmtDate(g.data_vigencia_fim)}
          </p>
        </Card>

        {action.type === 'extend' && (
          <Field label="Nova vigência fim" required hint={`Deve ser posterior a ${fmtDate(g.data_vigencia_fim)}`}>
            <input
              type="date"
              value={novaVigenciaFim}
              onChange={(e) => setNovaVigenciaFim(e.target.value)}
              min={g.data_vigencia_fim}
              className="input"
            />
          </Field>
        )}

        {(action.type === 'release' || action.type === 'execute') && (
          <Field
            label="Valor (R$)"
            required
            hint={`Disponível: ${brl(g.valor_disponivel)}`}
          >
            <input
              type="text"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder={g.valor_disponivel.toFixed(2).replace('.', ',')}
              className="input font-mono"
            />
          </Field>
        )}

        <Field
          label="Motivação"
          required
          hint={`Fundamentação · mínimo ${minMotivacao} caracteres${action.type === 'execute' ? ' (execução exige justificativa)' : ''}`}
        >
          <textarea
            value={motivacao}
            onChange={(e) => setMotivacao(e.target.value)}
            rows={3}
            maxLength={2000}
            className="input"
            placeholder={
              action.type === 'extend'  ? 'Ex: Aditivo de prazo #N estendeu vigência do contrato em 90 dias' :
              action.type === 'release' ? 'Ex: Recebimento definitivo #N sanado, libera 100% da garantia' :
              action.type === 'execute' ? 'Ex: Inadimplemento contratual identificado em medição #N. Processo administrativo nº X.' :
                                           'Ex: Substituída por nova garantia #N · Apólice cancelada pela seguradora'
            }
          />
          <p className="mt-1 font-mono text-[10px] text-slate-500">
            {motivacao.length}/2000 · mínimo {minMotivacao}
          </p>
        </Field>

        {action.type !== 'cancel' && (
          <Field label="Evidência (opcional)" hint="Ex: nº de processo, link de documento, referência interna">
            <input
              type="text"
              value={evidencia}
              onChange={(e) => setEvidencia(e.target.value)}
              maxLength={500}
              className="input"
            />
          </Field>
        )}

        {action.type === 'execute' && (
          <div className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            <strong>Atenção:</strong> execução de garantia exige processo administrativo prévio com contraditório e ampla defesa. Confirme que o procedimento legal foi observado antes de prosseguir.
          </div>
        )}
      </div>
    </Modal>
  );
}
