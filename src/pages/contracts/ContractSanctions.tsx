import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Hammer, Plus, History, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, ArrowRight, DollarSign, Clock,
  Pause, Play, RotateCcw, ShieldOff, FileText,
} from 'lucide-react';
import {
  listContractSanctions, listSanctionEvents, getContractSanctionsSummary,
  listContractPars,
  registerSanction, registerMultaPayment, suspendSanction, reactivateSanction,
  revokeSanction, markSanctionFulfilled,
  SANCTION_TIPO_LABELS, sanctionTipoTone, SANCTION_STATUS_LABELS, sanctionStatusTone,
  SANCTION_EVENT_TIPO_LABELS, SANCTION_MAX_MESES, sanctionRequiresPar,
  type ContractSanction, type SanctionTipo,
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

type ActionType = 'pay' | 'suspend' | 'reactivate' | 'revoke' | 'fulfill' | null;

export function ContractSanctions() {
  const { id: contractId } = useParams<{ id: string }>();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canApply  = hasRole(['admin', 'gestor_contrato']);
  const canRevoke = hasRole(['admin']);

  const [newOpen, setNewOpen] = useState(false);
  const [action, setAction] = useState<{ type: ActionType; sanction: ContractSanction | null }>({ type: null, sanction: null });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  const { data: summary } = useQuery({
    queryKey: ['contract-sanctions-summary', contractId],
    queryFn: () => getContractSanctionsSummary(contractId!),
    enabled: !!contractId,
  });
  const { data: sanctions = [] } = useQuery({
    queryKey: ['contract-sanctions', contractId],
    queryFn: () => listContractSanctions(contractId!),
    enabled: !!contractId,
  });

  return (
    <>
      <Layout>
        <PageHeader
          kicker="Contrato"
          title="Sanções e impedimentos"
          subtitle="Advertência, multa, impedimento, inidoneidade · Lei 14.133 art. 156"
          backTo={`/contratos/${contractId}`}
          backLabel="Contrato"
          actions={
            canApply && (
              <Button onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" />Aplicar sanção
              </Button>
            )
          }
        />

        {/* KPIs */}
        {summary && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Total / ativas
              </p>
              <p className="mt-1 font-mono tabular text-sm">
                <span className="text-2xl font-bold dark:text-slate-200">{summary.total}</span>
                <span className="mx-1 text-slate-400">/</span>
                <span className="text-base font-semibold text-error">{summary.ativas}</span>
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                {summary.advertencias}A · {summary.multas}M · {summary.impedimentos}I · {summary.inidoneidades}IN
              </p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Multas aplicadas
              </p>
              <p className="mt-1 font-mono text-lg font-bold tabular dark:text-slate-100">
                {brl(summary.multa_total)}
              </p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Pagas / pendentes
              </p>
              <p className="mt-1 font-mono tabular text-sm">
                <span className="text-success">{brl(summary.multa_paga)}</span>
                <span className="mx-1 text-slate-400">/</span>
                <span className="text-error font-semibold">{brl(summary.multa_pendente)}</span>
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
                    {SANCTION_TIPO_LABELS[summary.proximo_vencimento.tipo]} · {fmtDate(summary.proximo_vencimento.data)}
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
            <p className="font-semibold dark:text-slate-200">Sanções aplicadas</p>
          </div>

          {sanctions.length === 0 && (
            <div className="px-4 py-12 text-center">
              <Hammer className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Nenhuma sanção aplicada</p>
              <p className="mt-1 text-xs text-slate-400">
                Impedimento e inidoneidade exigem PAR procedente prévio (art. 158).
              </p>
            </div>
          )}

          {sanctions.length > 0 && (
            <ScrollShadow>
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-8"></th>
                    <th>#</th>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th className="hidden md:table-cell">Aplicação</th>
                    <th>PAR</th>
                    <th className="text-right">Valor / Vigência</th>
                    <th className="hidden lg:table-cell text-right">Vencimento</th>
                    <th className="w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {sanctions.map((s) => (
                    <SanctionRow
                      key={s.id}
                      s={s}
                      expanded={expandedId === s.id}
                      onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                      onAction={(type) => setAction({ type, sanction: s })}
                      canApply={canApply}
                      canRevoke={canRevoke}
                    />
                  ))}
                </tbody>
              </table>
            </ScrollShadow>
          )}
        </Card>
      </Layout>

      {/* Modal: aplicar nova sanção */}
      <NewSanctionModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        contractId={contractId!}
        onFeedback={setFeedback}
      />

      {/* Modal: ações */}
      <SanctionActionModal
        action={action}
        onClose={() => setAction({ type: null, sanction: null })}
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
// Linha + timeline
// =============================================================================
function SanctionRow({
  s, expanded, onToggle, onAction, canApply, canRevoke,
}: {
  s: ContractSanction;
  expanded: boolean;
  onToggle: () => void;
  onAction: (type: ActionType) => void;
  canApply: boolean;
  canRevoke: boolean;
}) {
  const { data: events = [] } = useQuery({
    queryKey: ['sanction-events', s.id],
    queryFn: () => listSanctionEvents(s.id),
    enabled: expanded,
  });

  const canPay = canApply && s.tipo === 'multa' && s.status === 'ativa' && !s.data_pagamento_multa;
  const canSuspend = canApply && s.status === 'ativa';
  const canReactivate = canApply && s.status === 'suspensa';
  const canRevokeIt = canRevoke && (s.status === 'ativa' || s.status === 'suspensa');
  const canFulfill = canApply && s.status === 'ativa' && s.tipo !== 'multa';

  const vencimentoTone =
    s.dias_para_vencimento === null ? 'text-slate-400' :
    s.status !== 'ativa' ? 'text-slate-400' :
    s.dias_para_vencimento < 0 ? 'text-success' :  // já passou, pode marcar como cumprida
    s.dias_para_vencimento <= 30 ? 'text-error' :
    s.dias_para_vencimento <= 60 ? 'text-yellow-600 dark:text-yellow-300' :
    'text-slate-700 dark:text-slate-200';

  return (
    <>
      <tr className="hover:bg-slate-50 dark:hover:bg-muted-dark/40">
        <td>
          <button type="button" onClick={onToggle}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-muted-dark"
            aria-label="Expandir histórico">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="font-mono tabular text-xs font-bold dark:text-slate-200">#{s.numero}</td>
        <td><Badge tone={sanctionTipoTone(s.tipo)}>{SANCTION_TIPO_LABELS[s.tipo]}</Badge></td>
        <td><Badge tone={sanctionStatusTone(s.status)}>{SANCTION_STATUS_LABELS[s.status]}</Badge></td>
        <td className="hidden md:table-cell font-mono text-xs">{fmtDate(s.data_aplicacao)}</td>
        <td>
          {s.par_numero != null ? (
            <span className="font-mono text-xs text-purple-600 dark:text-purple-300">PAR #{s.par_numero}</span>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </td>
        <td className="text-right">
          {s.tipo === 'multa' ? (
            <>
              <p className="font-mono tabular text-sm font-semibold dark:text-slate-200">{brl(s.valor_multa)}</p>
              {s.data_pagamento_multa && (
                <p className="font-mono text-[10px] text-success">Paga em {fmtDate(s.data_pagamento_multa)}</p>
              )}
            </>
          ) : s.vigencia_fim ? (
            <>
              <p className="font-mono text-xs">{s.duracao_meses}m</p>
              <p className="font-mono text-[10px] text-slate-500">
                {fmtDate(s.vigencia_inicio)} → {fmtDate(s.vigencia_fim)}
              </p>
            </>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </td>
        <td className="hidden lg:table-cell text-right">
          {s.dias_para_vencimento !== null && s.status === 'ativa' ? (
            <span className={`font-mono tabular text-sm ${vencimentoTone}`}>
              {s.dias_para_vencimento < 0 ? `${Math.abs(s.dias_para_vencimento)}d vencido` : `${s.dias_para_vencimento}d`}
            </span>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </td>
        <td>
          <div className="flex flex-wrap items-center gap-1">
            {canPay && (
              <button type="button" onClick={() => onAction('pay')}
                className="rounded p-2 sm:p-1.5 text-slate-500 hover:bg-success/10 hover:text-success"
                title="Registrar pagamento de multa" aria-label="Registrar pagamento">
                <DollarSign className="h-4 w-4" />
              </button>
            )}
            {canFulfill && (
              <button type="button" onClick={() => onAction('fulfill')}
                className="rounded p-2 sm:p-1.5 text-slate-500 hover:bg-success/10 hover:text-success"
                title="Marcar como cumprida (vigência terminou)" aria-label="Marcar como cumprida">
                <CheckCircle2 className="h-4 w-4" />
              </button>
            )}
            {canSuspend && (
              <button type="button" onClick={() => onAction('suspend')}
                className="rounded p-2 sm:p-1.5 text-slate-500 hover:bg-yellow-100 hover:text-yellow-700 dark:hover:bg-yellow-900/30 dark:hover:text-yellow-200"
                title="Suspender (decisão judicial/administrativa)" aria-label="Suspender">
                <Pause className="h-4 w-4" />
              </button>
            )}
            {canReactivate && (
              <button type="button" onClick={() => onAction('reactivate')}
                className="rounded p-2 sm:p-1.5 text-slate-500 hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900/30 dark:hover:text-blue-200"
                title="Reativar" aria-label="Reativar">
                <Play className="h-4 w-4" />
              </button>
            )}
            {canRevokeIt && (
              <button type="button" onClick={() => onAction('revoke')}
                className="rounded p-2 sm:p-1.5 text-slate-400 hover:bg-error/10 hover:text-error"
                title="Revogar (anulação)" aria-label="Revogar">
                <ShieldOff className="h-4 w-4" />
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} className="bg-slate-50 px-4 py-3 dark:bg-muted-dark/30">
            <div className="space-y-2 text-xs">
              {/* Fundamentação */}
              <Card className="p-3">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-display text-slate-500">Fundamentação</p>
                <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{s.fundamentacao}</p>
                {s.documento_aplicacao && (
                  <p className="mt-1 font-mono text-[10px] text-slate-500">
                    <FileText className="mr-1 inline h-3 w-3" />Doc: {s.documento_aplicacao}
                  </p>
                )}
                <p className="mt-1 font-mono text-[10px] text-slate-400">
                  Aplicada por {s.autoridade_nome || '—'} em {dtTime(s.created_at)}
                </p>
              </Card>

              {/* Timeline */}
              <Card className="p-3">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-display text-slate-500">Histórico</p>
                <div className="space-y-1">
                  {events.length === 0 && <p className="text-slate-500">Carregando…</p>}
                  {events.map((e) => (
                    <div key={e.id} className="flex items-start gap-2">
                      <ChevronRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-slate-400" />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium dark:text-slate-200">
                          {SANCTION_EVENT_TIPO_LABELS[e.tipo as keyof typeof SANCTION_EVENT_TIPO_LABELS] || e.tipo}
                        </span>
                        {e.status_anterior && e.status_novo && e.status_anterior !== e.status_novo && (
                          <span className="ml-1 font-mono text-[10px] text-slate-400">
                            ({e.status_anterior} → {e.status_novo})
                          </span>
                        )}
                        <p className="text-slate-600 dark:text-slate-400">{e.descricao}</p>
                        <p className="font-mono text-[10px] text-slate-400">{e.applied_by_nome || '—'} · {dtTime(e.applied_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// =============================================================================
// Modal: nova sanção
// =============================================================================
function NewSanctionModal({
  open, onClose, contractId, onFeedback,
}: {
  open: boolean;
  onClose: () => void;
  contractId: string;
  onFeedback: (f: { tone: 'ok' | 'error'; message: string }) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    tipo: 'advertencia' as SanctionTipo,
    fundamentacao: '',
    documento_aplicacao: '',
    par_id: '',
    // multa
    base_calculo: '',
    percentual: '',
    valor_multa: '',
    data_vencimento_multa: '',
    multa_mode: 'calculo' as 'calculo' | 'direto',
    // impedimento/inidoneidade
    vigencia_inicio: new Date().toISOString().slice(0, 10),
    duracao_meses: 12,
    observacoes: '',
  });

  // PARs procedentes do contrato (para vincular impedimento/inidoneidade)
  const { data: pars = [] } = useQuery({
    queryKey: ['contract-pars', contractId],
    queryFn: () => listContractPars(contractId),
    enabled: open && sanctionRequiresPar(form.tipo),
  });
  const parsProcedentes = pars.filter(
    (p) => p.decisao_resultado === 'procedente' || p.decisao_resultado === 'parcialmente_procedente'
  );

  const mCreate = useMutation({
    mutationFn: () => {
      const payload: Parameters<typeof registerSanction>[0] = {
        contract_id: contractId,
        tipo: form.tipo,
        fundamentacao: form.fundamentacao,
        documento_aplicacao: form.documento_aplicacao || undefined,
        observacoes: form.observacoes || undefined,
      };
      if (sanctionRequiresPar(form.tipo)) {
        payload.par_id = form.par_id;
        payload.vigencia_inicio = form.vigencia_inicio;
        payload.duracao_meses = form.duracao_meses;
      }
      if (form.tipo === 'multa') {
        if (form.multa_mode === 'direto') {
          payload.valor_multa = parseFloat(form.valor_multa.replace(',', '.'));
        } else {
          payload.base_calculo = parseFloat(form.base_calculo.replace(',', '.'));
          payload.percentual = parseFloat(form.percentual.replace(',', '.'));
        }
        if (form.data_vencimento_multa) payload.data_vencimento_multa = form.data_vencimento_multa;
      }
      return registerSanction(payload);
    },
    onSuccess: () => {
      onClose();
      setForm({
        tipo: 'advertencia', fundamentacao: '', documento_aplicacao: '', par_id: '',
        base_calculo: '', percentual: '', valor_multa: '', data_vencimento_multa: '',
        multa_mode: 'calculo',
        vigencia_inicio: new Date().toISOString().slice(0, 10),
        duracao_meses: 12, observacoes: '',
      });
      onFeedback({ tone: 'ok', message: 'Sanção aplicada' });
      qc.invalidateQueries({ queryKey: ['contract-sanctions', contractId] });
      qc.invalidateQueries({ queryKey: ['contract-sanctions-summary', contractId] });
    },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  // Cálculo preview client-side
  const calcPreview = (() => {
    if (form.tipo !== 'multa' || form.multa_mode !== 'calculo') return null;
    const base = parseFloat(form.base_calculo.replace(',', '.'));
    const pct  = parseFloat(form.percentual.replace(',', '.'));
    if (!isFinite(base) || !isFinite(pct) || base <= 0 || pct <= 0) return null;
    return Math.round(base * (pct / 100) * 100) / 100;
  })();

  const canSubmit =
    form.fundamentacao.trim().length >= 30 &&
    (form.tipo === 'multa'
       ? (form.multa_mode === 'direto'
           ? parseFloat(form.valor_multa.replace(',', '.')) > 0
           : parseFloat(form.base_calculo.replace(',', '.')) > 0 && parseFloat(form.percentual.replace(',', '.')) > 0)
       : true) &&
    (sanctionRequiresPar(form.tipo) ? !!form.par_id && form.duracao_meses > 0 : true);

  const maxMeses = SANCTION_MAX_MESES[form.tipo];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Aplicar sanção"
      subtitle="Lei 14.133 art. 156"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mCreate.mutate()} loading={mCreate.isPending} disabled={!canSubmit}>
            <Plus className="h-4 w-4" />Aplicar
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Tipo de sanção" required>
          <Select
            value={form.tipo}
            onChange={(e) => setForm({ ...form, tipo: e.target.value as SanctionTipo, par_id: '' })}
            options={Object.entries(SANCTION_TIPO_LABELS).map(([v, l]) => ({ value: v, label: l }))}
          />
        </Field>

        {sanctionRequiresPar(form.tipo) && (
          <>
            <div className="rounded-lg border border-amber-300/40 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/15 dark:text-amber-200">
              <AlertTriangle className="mr-1 inline h-3 w-3" />
              <strong>{SANCTION_TIPO_LABELS[form.tipo]}</strong> exige PAR procedente prévio (art. 158).
              Apenas PARs deste contrato com decisão procedente ou parcialmente procedente aparecem.
            </div>

            {parsProcedentes.length === 0 ? (
              <div className="rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-error">
                <AlertTriangle className="mr-1 inline h-4 w-4" />
                Nenhum PAR procedente disponível neste contrato. Abra um PAR e conclua até decisão procedente antes de aplicar esta sanção.
              </div>
            ) : (
              <Field label="PAR procedente vinculado" required>
                <Select
                  value={form.par_id}
                  onChange={(e) => setForm({ ...form, par_id: e.target.value })}
                  options={parsProcedentes.map((p) => ({
                    value: p.id,
                    label: `PAR #${p.numero} · ${p.decisao_resultado === 'procedente' ? 'procedente' : 'parcialmente procedente'} · ${fmtDate(p.data_ocorrencia)}`,
                  }))}
                  placeholder="Escolha o PAR"
                />
              </Field>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Vigência início" required>
                <input
                  type="date"
                  value={form.vigencia_inicio}
                  onChange={(e) => setForm({ ...form, vigencia_inicio: e.target.value })}
                  className="input"
                />
              </Field>
              <Field label={`Duração (meses) · máx ${maxMeses}`} required>
                <input
                  type="number"
                  min={1}
                  max={maxMeses ?? undefined}
                  value={form.duracao_meses}
                  onChange={(e) => setForm({ ...form, duracao_meses: Number(e.target.value) || 1 })}
                  className="input"
                />
              </Field>
            </div>
          </>
        )}

        {form.tipo === 'multa' && (
          <>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={form.multa_mode === 'calculo'}
                  onChange={() => setForm({ ...form, multa_mode: 'calculo' })}
                />
                Base × Percentual
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={form.multa_mode === 'direto'}
                  onChange={() => setForm({ ...form, multa_mode: 'direto' })}
                />
                Valor direto
              </label>
            </div>

            {form.multa_mode === 'calculo' ? (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Base de cálculo (R$)" required hint="Ex: valor total do contrato">
                  <input
                    type="text" inputMode="decimal"
                    value={form.base_calculo}
                    onChange={(e) => setForm({ ...form, base_calculo: e.target.value })}
                    placeholder="0,00"
                    className="input font-mono"
                  />
                </Field>
                <Field label="Percentual (%)" required hint="0-100">
                  <input
                    type="text" inputMode="decimal"
                    value={form.percentual}
                    onChange={(e) => setForm({ ...form, percentual: e.target.value })}
                    placeholder="10"
                    className="input font-mono"
                  />
                </Field>
              </div>
            ) : (
              <Field label="Valor da multa (R$)" required>
                <input
                  type="text" inputMode="decimal"
                  value={form.valor_multa}
                  onChange={(e) => setForm({ ...form, valor_multa: e.target.value })}
                  placeholder="0,00"
                  className="input font-mono"
                />
              </Field>
            )}

            {calcPreview != null && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/15 dark:text-blue-200">
                <strong>Preview:</strong> Multa calculada = {brl(calcPreview)}
              </div>
            )}

            <Field label="Data de vencimento da multa (opcional)">
              <input
                type="date"
                value={form.data_vencimento_multa}
                onChange={(e) => setForm({ ...form, data_vencimento_multa: e.target.value })}
                className="input"
              />
            </Field>
          </>
        )}

        <Field label="Fundamentação" required hint="Mínimo 30 caracteres · cláusulas, fatos, nexo">
          <textarea
            value={form.fundamentacao}
            onChange={(e) => setForm({ ...form, fundamentacao: e.target.value })}
            rows={4}
            maxLength={5000}
            className="input"
            placeholder="Descrição da infração, dispositivos legais, ônus probatório atendido…"
          />
          <p className="mt-1 font-mono text-[10px] text-slate-500">{form.fundamentacao.length}/5000 · mínimo 30</p>
        </Field>

        <Field label="Documento de aplicação (opcional)" hint="Nº do ato administrativo">
          <input
            type="text"
            value={form.documento_aplicacao}
            onChange={(e) => setForm({ ...form, documento_aplicacao: e.target.value })}
            maxLength={200}
            className="input"
            placeholder="Ex: Portaria nº 012/2025"
          />
        </Field>

        <Field label="Observações (opcional)">
          <textarea
            value={form.observacoes}
            onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
            rows={2}
            maxLength={1000}
            className="input"
          />
        </Field>
      </div>
    </Modal>
  );
}

// =============================================================================
// Modal de ações (suspend/reactivate/revoke/pay/fulfill)
// =============================================================================
function SanctionActionModal({
  action, onClose, onFeedback, contractId,
}: {
  action: { type: ActionType; sanction: ContractSanction | null };
  onClose: () => void;
  onFeedback: (f: { tone: 'ok' | 'error'; message: string }) => void;
  contractId: string;
}) {
  const qc = useQueryClient();
  const [motivacao, setMotivacao] = useState('');
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().slice(0, 10));
  const [obsPagamento, setObsPagamento] = useState('');

  function closeAndReset() {
    setMotivacao(''); setDataPagamento(new Date().toISOString().slice(0, 10)); setObsPagamento('');
    onClose();
  }
  function invalidate() {
    qc.invalidateQueries({ queryKey: ['contract-sanctions', contractId] });
    qc.invalidateQueries({ queryKey: ['contract-sanctions-summary', contractId] });
    qc.invalidateQueries({ queryKey: ['sanction-events'] });
  }

  const mPay = useMutation({
    mutationFn: () => registerMultaPayment({
      sanction_id: action.sanction!.id,
      data_pagamento: dataPagamento,
      observacoes: obsPagamento || undefined,
    }),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Pagamento registrado' }); closeAndReset(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mSuspend = useMutation({
    mutationFn: () => suspendSanction(action.sanction!.id, motivacao),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Sanção suspensa' }); closeAndReset(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mReactivate = useMutation({
    mutationFn: () => reactivateSanction(action.sanction!.id, motivacao),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Sanção reativada' }); closeAndReset(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mRevoke = useMutation({
    mutationFn: () => revokeSanction(action.sanction!.id, motivacao),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Sanção revogada' }); closeAndReset(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mFulfill = useMutation({
    mutationFn: () => markSanctionFulfilled(action.sanction!.id),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Sanção marcada como cumprida' }); closeAndReset(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  if (!action.sanction || !action.type) return null;
  const s = action.sanction;

  const titles: Record<NonNullable<ActionType>, string> = {
    pay:        `Registrar pagamento · Multa #${s.numero}`,
    suspend:    `Suspender sanção #${s.numero}`,
    reactivate: `Reativar sanção #${s.numero}`,
    revoke:     `Revogar sanção #${s.numero}`,
    fulfill:    `Marcar como cumprida · Sanção #${s.numero}`,
  };

  const minMotivacao = action.type === 'revoke' ? 30 : 20;
  const isPending = mPay.isPending || mSuspend.isPending || mReactivate.isPending || mRevoke.isPending || mFulfill.isPending;

  function submit() {
    if (action.type === 'pay')        mPay.mutate();
    if (action.type === 'suspend')    mSuspend.mutate();
    if (action.type === 'reactivate') mReactivate.mutate();
    if (action.type === 'revoke')     mRevoke.mutate();
    if (action.type === 'fulfill')    mFulfill.mutate();
  }

  const canSubmit = action.type === 'fulfill'
    ? true
    : action.type === 'pay'
      ? !!dataPagamento
      : motivacao.trim().length >= minMotivacao;

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
        <Card className="p-3">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-display text-slate-500">Sanção</p>
          <p className="text-sm dark:text-slate-200">
            {SANCTION_TIPO_LABELS[s.tipo]} #{s.numero}
            {s.tipo === 'multa' && s.valor_multa && <> · {brl(s.valor_multa)}</>}
            {s.vigencia_fim && <> · até {fmtDate(s.vigencia_fim)}</>}
          </p>
        </Card>

        {action.type === 'pay' && (
          <>
            <Field label="Data do pagamento" required>
              <input
                type="date"
                value={dataPagamento}
                onChange={(e) => setDataPagamento(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Observações (opcional)">
              <textarea
                value={obsPagamento}
                onChange={(e) => setObsPagamento(e.target.value)}
                rows={2}
                maxLength={500}
                className="input"
              />
            </Field>
          </>
        )}

        {action.type === 'fulfill' && (
          <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-success">
            <CheckCircle2 className="mr-1 inline h-4 w-4" />
            Confirma que a vigência da sanção foi cumprida? Status passará para "cumprida".
          </div>
        )}

        {action.type !== 'pay' && action.type !== 'fulfill' && (
          <Field label="Motivação" required hint={`Mínimo ${minMotivacao} caracteres`}>
            <textarea
              value={motivacao}
              onChange={(e) => setMotivacao(e.target.value)}
              rows={3}
              maxLength={3000}
              className="input"
              placeholder={
                action.type === 'suspend'    ? 'Ex: Liminar judicial nº X suspendeu temporariamente os efeitos' :
                action.type === 'reactivate' ? 'Ex: Decisão judicial reformou liminar; sanção volta a vigorar' :
                action.type === 'revoke'     ? 'Ex: Recurso administrativo provido; sanção anulada com efeito retroativo' :
                                                ''
              }
            />
            <p className="mt-1 font-mono text-[10px] text-slate-500">{motivacao.length}/3000 · mínimo {minMotivacao}</p>
          </Field>
        )}

        {action.type === 'revoke' && (
          <div className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            <strong>Atenção:</strong> revogação tem efeito retroativo. A sanção é considerada como nunca aplicada para fins de cadastros e licitações futuras.
          </div>
        )}
      </div>
    </Modal>
  );
}
