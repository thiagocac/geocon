import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Gavel, Plus, History, AlertTriangle, CheckCircle2, XCircle,
  Send, ClipboardCheck, FileSearch, ChevronRight, ChevronDown, Clock,
  ShieldAlert,
} from 'lucide-react';
import {
  listContractPars, getParDetail, listParSteps, getContractParsSummary,
  createParProcess, instaurarePar, registerParDefesa, concludeParInstrucao,
  decidePar, openParRecurso, judgeParRecurso, archivePar, cancelPar,
  PAR_STATUS_LABELS, parStatusTone, PAR_TIPO_INFRACAO_LABELS,
  PAR_RESULTADO_LABELS, parResultadoTone, PAR_RECURSO_RESULTADO_LABELS,
  PAR_SANCAO_TIPO_LABELS, parSancaoTipoTone,
  type ParRow, type ParTipoInfracao, type ParResultado, type ParRecursoResultado, type ParSancaoTipo,
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

const SANCAO_TIPO_OPTIONS: ParSancaoTipo[] = ['advertencia', 'multa', 'impedimento', 'inidoneidade'];

export function ContractParProcesses() {
  const { id: contractId } = useParams<{ id: string }>();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canAbrir   = hasRole(['admin', 'gestor_contrato', 'fiscal']);
  const canDecidir = hasRole(['admin']);

  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  // Form de nova abertura
  const [form, setForm] = useState({
    tipo_infracao:   'descumprimento_clausula' as ParTipoInfracao,
    data_ocorrencia: new Date().toISOString().slice(0, 10),
    fato_descricao:  '',
  });

  const { data: summary } = useQuery({
    queryKey: ['contract-pars-summary', contractId],
    queryFn: () => getContractParsSummary(contractId!),
    enabled: !!contractId,
  });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['contract-pars', contractId],
    queryFn: () => listContractPars(contractId!),
    enabled: !!contractId,
  });

  const mCreate = useMutation({
    mutationFn: () => createParProcess({
      contract_id:     contractId!,
      tipo_infracao:   form.tipo_infracao,
      fato_descricao:  form.fato_descricao,
      data_ocorrencia: form.data_ocorrencia,
    }),
    onSuccess: () => {
      setNewOpen(false);
      setForm({
        tipo_infracao: 'descumprimento_clausula',
        data_ocorrencia: new Date().toISOString().slice(0, 10),
        fato_descricao: '',
      });
      setFeedback({ tone: 'ok', message: 'PAR criado em rascunho. Abra o detalhe para instaurar.' });
      qc.invalidateQueries({ queryKey: ['contract-pars', contractId] });
      qc.invalidateQueries({ queryKey: ['contract-pars-summary', contractId] });
    },
    onError: (e) => setFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  return (
    <>
      <Layout>
        <PageHeader
          kicker="Contrato"
          title="Apuração administrativa (PAR)"
          subtitle="Processo Administrativo de Responsabilização · Lei 14.133 art. 158"
          backTo={`/contratos/${contractId}`}
          backLabel="Contrato"
          actions={
            canAbrir && (
              <Button onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" />Abrir PAR
              </Button>
            )
          }
        />

        {/* KPIs */}
        {summary && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Total / em andamento
              </p>
              <p className="mt-1 font-mono tabular text-sm dark:text-slate-200">
                <span className="text-2xl font-bold">{summary.total}</span>
                <span className="mx-1 text-slate-400">/</span>
                <span className="text-base font-semibold text-purple-600 dark:text-purple-300">{summary.em_andamento}</span>
              </p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Procedentes
              </p>
              <p className="mt-1 font-mono text-xl sm:text-2xl font-bold tabular text-error">{summary.procedentes}</p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Improcedentes
              </p>
              <p className="mt-1 font-mono text-xl sm:text-2xl font-bold tabular text-success">{summary.improcedentes}</p>
            </Card>
            <Card densityAware className="p-3 sm:p-4">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Em defesa · prazo estourado
              </p>
              <p className="mt-1 font-mono tabular text-sm dark:text-slate-200">
                <span className="text-2xl font-bold">{summary.em_defesa}</span>
                {summary.prazo_estourado > 0 && (
                  <span className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-error/15 px-2 py-0.5 text-[10px] font-semibold text-error">
                    <Clock className="h-3 w-3" />{summary.prazo_estourado} vencido{summary.prazo_estourado > 1 ? 's' : ''}
                  </span>
                )}
              </p>
            </Card>
          </div>
        )}

        <Card>
          <div className="border-b border-slate-200 px-4 py-3 dark:border-border-dark">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-500" />
              <p className="font-semibold dark:text-slate-200">Processos administrativos</p>
            </div>
          </div>

          {isLoading && <div className="p-6 text-sm text-slate-500">Carregando…</div>}

          {!isLoading && rows.length === 0 && (
            <div className="px-4 py-12 text-center">
              <Gavel className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Nenhum PAR aberto</p>
              <p className="mt-1 text-xs text-slate-400">
                PAR é exigido antes de aplicar sanções graves (impedimento, inidoneidade).
              </p>
            </div>
          )}

          {rows.length > 0 && (
            <ScrollShadow>
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Tipo de infração</th>
                    <th className="hidden md:table-cell">Ocorrência</th>
                    <th>Status</th>
                    <th className="hidden lg:table-cell">Prazo defesa</th>
                    <th>Resultado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const prazoEstourado = r.status === 'em_defesa' && r.defesa_prazo_limite &&
                      new Date(r.defesa_prazo_limite + 'T00:00:00Z') < new Date();
                    return (
                      <tr
                        key={r.id}
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-muted-dark/40"
                        onClick={() => setDetailId(r.id)}
                      >
                        <td className="font-mono tabular text-xs font-bold dark:text-slate-200">#{r.numero}</td>
                        <td className="text-sm dark:text-slate-200">{PAR_TIPO_INFRACAO_LABELS[r.tipo_infracao]}</td>
                        <td className="hidden md:table-cell font-mono text-xs">{fmtDate(r.data_ocorrencia)}</td>
                        <td><Badge tone={parStatusTone(r.status)}>{PAR_STATUS_LABELS[r.status]}</Badge></td>
                        <td className="hidden lg:table-cell">
                          {r.status === 'em_defesa' && r.defesa_prazo_limite ? (
                            <span className={`font-mono text-xs ${prazoEstourado ? 'font-bold text-error' : 'text-slate-600 dark:text-slate-300'}`}>
                              {fmtDate(r.defesa_prazo_limite)}
                              {prazoEstourado && ' · vencido'}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td>
                          {r.decisao_resultado ? (
                            <Badge tone={parResultadoTone(r.decisao_resultado)}>{PAR_RESULTADO_LABELS[r.decisao_resultado]}</Badge>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                          {r.recurso_resultado && (
                            <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                              Recurso: {PAR_RECURSO_RESULTADO_LABELS[r.recurso_resultado]}
                            </p>
                          )}
                        </td>
                        <td><ChevronRight className="h-4 w-4 text-slate-400" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollShadow>
          )}
        </Card>
      </Layout>

      {/* Modal: novo PAR */}
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Abrir novo PAR"
        subtitle="Lei 14.133 art. 158 — caracterização da infração"
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => mCreate.mutate()}
              loading={mCreate.isPending}
              disabled={form.fato_descricao.trim().length < 50}
            >
              Criar em rascunho
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo da infração" required>
              <Select
                value={form.tipo_infracao}
                onChange={(e) => setForm({ ...form, tipo_infracao: e.target.value as ParTipoInfracao })}
                options={Object.entries(PAR_TIPO_INFRACAO_LABELS).map(([v, l]) => ({ value: v, label: l }))}
              />
            </Field>
            <Field label="Data da ocorrência" required>
              <input
                type="date"
                value={form.data_ocorrencia}
                onChange={(e) => setForm({ ...form, data_ocorrencia: e.target.value })}
                className="input"
              />
            </Field>
          </div>

          <Field label="Descrição dos fatos" required hint="Caracterização legal · mínimo 50 caracteres">
            <textarea
              value={form.fato_descricao}
              onChange={(e) => setForm({ ...form, fato_descricao: e.target.value })}
              rows={5}
              maxLength={5000}
              className="input"
              placeholder="Descrição detalhada dos fatos, com indicação de cláusula contratual descumprida, datas, valores, prejuízos identificados…"
            />
            <p className="mt-1 font-mono text-[10px] text-slate-500">{form.fato_descricao.length}/5000 · mínimo 50</p>
          </Field>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/15 dark:text-blue-200">
            <strong>Workflow:</strong> rascunho → instaurado → em_defesa (15 dias úteis) → em_instrucao → em_julgamento → decidido → arquivado (ou em_recurso)
          </div>
        </div>
      </Modal>

      {/* Modal: detalhe + workflow */}
      <ParDetailModal
        id={detailId}
        onClose={() => setDetailId(null)}
        contractId={contractId!}
        canAbrir={canAbrir}
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
// Modal de detalhe com workflow inline (semelhante ao Reequilíbrio em V34)
// =============================================================================
function ParDetailModal({
  id, onClose, contractId, canAbrir, canDecidir, onFeedback,
}: {
  id: string | null;
  onClose: () => void;
  contractId: string;
  canAbrir: boolean;
  canDecidir: boolean;
  onFeedback: (f: { tone: 'ok' | 'error'; message: string }) => void;
}) {
  const qc = useQueryClient();
  type ActionType = null | 'instaurate' | 'defesa' | 'instrucao' | 'decide' | 'recurso' | 'judge_recurso' | 'archive' | 'cancel';
  const [active, setActive] = useState<ActionType>(null);

  // Form states (todos juntos pra simplicidade)
  const [instCommission, setInstCommission] = useState('');
  const [instDocumento, setInstDocumento] = useState('');
  const [instPrazo, setInstPrazo] = useState(15);

  const [defResumo, setDefResumo] = useState('');
  const [defRevelia, setDefRevelia] = useState(false);
  const [defDocumento, setDefDocumento] = useState('');

  const [instrParecer, setInstrParecer] = useState('');

  const [decResultado, setDecResultado] = useState<ParResultado>('procedente');
  const [decMotivacao, setDecMotivacao] = useState('');
  const [decSancaoProposta, setDecSancaoProposta] = useState('');
  const [decSancaoTipos, setDecSancaoTipos] = useState<Set<ParSancaoTipo>>(new Set());

  const [recMotivacao, setRecMotivacao] = useState('');
  const [recResultado, setRecResultado] = useState<ParRecursoResultado>('improvido');
  const [recJulgMotivacao, setRecJulgMotivacao] = useState('');

  const [cancelMotivo, setCancelMotivo] = useState('');

  const { data: par } = useQuery({
    queryKey: ['par-detail', id],
    queryFn: () => getParDetail(id!),
    enabled: !!id,
  });
  const { data: steps = [] } = useQuery({
    queryKey: ['par-steps', id],
    queryFn: () => listParSteps(id!),
    enabled: !!id,
  });

  function resetAll() {
    setActive(null);
    setInstCommission(''); setInstDocumento(''); setInstPrazo(15);
    setDefResumo(''); setDefRevelia(false); setDefDocumento('');
    setInstrParecer('');
    setDecResultado('procedente'); setDecMotivacao(''); setDecSancaoProposta(''); setDecSancaoTipos(new Set());
    setRecMotivacao(''); setRecResultado('improvido'); setRecJulgMotivacao('');
    setCancelMotivo('');
  }
  function invalidate() {
    qc.invalidateQueries({ queryKey: ['par-detail', id] });
    qc.invalidateQueries({ queryKey: ['par-steps', id] });
    qc.invalidateQueries({ queryKey: ['contract-pars', contractId] });
    qc.invalidateQueries({ queryKey: ['contract-pars-summary', contractId] });
  }

  const mInstaurate = useMutation({
    mutationFn: () => instaurarePar({
      id: id!, comissao_designacao: instCommission,
      instauracao_documento: instDocumento || undefined,
      defesa_prazo_dias: instPrazo,
    }),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'PAR instaurado · contratado em fase de defesa' }); resetAll(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mDefesa = useMutation({
    mutationFn: () => registerParDefesa({
      id: id!, defesa_resumo: defResumo, revelia: defRevelia,
      defesa_documento: defDocumento || undefined,
    }),
    onSuccess: () => { onFeedback({ tone: 'ok', message: defRevelia ? 'Revelia registrada' : 'Defesa registrada' }); resetAll(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mInstrucao = useMutation({
    mutationFn: () => concludeParInstrucao(id!, instrParecer),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Parecer da instrução concluído' }); resetAll(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mDecide = useMutation({
    mutationFn: () => decidePar({
      id: id!, resultado: decResultado, motivacao: decMotivacao,
      sancao_proposta: decSancaoProposta || undefined,
      sancao_tipos: decSancaoTipos.size > 0 ? Array.from(decSancaoTipos) : undefined,
    }),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Decisão registrada' }); resetAll(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mRecurso = useMutation({
    mutationFn: () => openParRecurso(id!, recMotivacao),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Recurso interposto' }); resetAll(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mJudgeRec = useMutation({
    mutationFn: () => judgeParRecurso({
      id: id!, resultado_recurso: recResultado, motivacao_julgamento: recJulgMotivacao,
    }),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'Recurso julgado · PAR arquivado' }); resetAll(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mArchive = useMutation({
    mutationFn: () => archivePar(id!),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'PAR arquivado' }); resetAll(); invalidate(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });
  const mCancel = useMutation({
    mutationFn: () => cancelPar(id!, cancelMotivo),
    onSuccess: () => { onFeedback({ tone: 'ok', message: 'PAR cancelado' }); resetAll(); invalidate(); onClose(); },
    onError: (e) => onFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  if (!par) {
    return (
      <Modal open={!!id} onClose={onClose} title="Carregando…" size="xl">
        <p className="text-sm text-slate-500">Buscando detalhe…</p>
      </Modal>
    );
  }

  const showInstaurate = canAbrir   && par.status === 'rascunho';
  const showDefesa     = canAbrir   && par.status === 'em_defesa';
  const showInstrucao  = canAbrir   && par.status === 'em_instrucao';
  const showDecide     = canDecidir && par.status === 'em_julgamento';
  const showRecurso    = canAbrir   && par.status === 'decidido';
  const showArchive    = canDecidir && par.status === 'decidido';
  const showJudgeRec   = canDecidir && par.status === 'em_recurso';
  const showCancel     = canAbrir   && !['arquivado', 'cancelado'].includes(par.status);

  function toggleSancao(t: ParSancaoTipo) {
    setDecSancaoTipos((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      title={`PAR #${par.numero}`}
      subtitle={PAR_TIPO_INFRACAO_LABELS[par.tipo_infracao]}
      size="xl"
    >
      <div className="space-y-3">
        {/* Status + ações */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-border-dark dark:bg-muted-dark">
          <div className="flex items-center gap-2">
            <Badge tone={parStatusTone(par.status)}>{PAR_STATUS_LABELS[par.status]}</Badge>
            <span className="text-xs text-slate-500">·</span>
            <span className="font-mono text-[10px] uppercase tracking-display text-slate-500">{par.fundamentacao_legal}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {showInstaurate && <Button size="sm" onClick={() => setActive('instaurate')}><Send className="h-3.5 w-3.5" />Instaurar</Button>}
            {showDefesa     && <Button size="sm" onClick={() => setActive('defesa')}><ClipboardCheck className="h-3.5 w-3.5" />Registrar defesa</Button>}
            {showInstrucao  && <Button size="sm" onClick={() => setActive('instrucao')}><ClipboardCheck className="h-3.5 w-3.5" />Concluir instrução</Button>}
            {showDecide     && <Button size="sm" onClick={() => setActive('decide')}><FileSearch className="h-3.5 w-3.5" />Decidir</Button>}
            {showRecurso    && <Button size="sm" variant="outline" onClick={() => setActive('recurso')}><ShieldAlert className="h-3.5 w-3.5" />Interpor recurso</Button>}
            {showArchive    && <Button size="sm" variant="outline" onClick={() => mArchive.mutate()} loading={mArchive.isPending}><CheckCircle2 className="h-3.5 w-3.5" />Arquivar</Button>}
            {showJudgeRec   && <Button size="sm" onClick={() => setActive('judge_recurso')}><Gavel className="h-3.5 w-3.5" />Julgar recurso</Button>}
            {showCancel     && <Button size="sm" variant="outline" onClick={() => setActive('cancel')}><XCircle className="h-3.5 w-3.5" />Cancelar</Button>}
          </div>
        </div>

        {/* Fatos */}
        <Card className="p-3">
          <div className="mb-1 flex items-center justify-between">
            <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500">Descrição dos fatos</p>
            <p className="font-mono text-[10px] text-slate-500">Ocorrência: {fmtDate(par.data_ocorrencia)}</p>
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{par.fato_descricao}</p>
        </Card>

        {/* Instauração */}
        {par.instaurado_at && (
          <Card className="p-3 border-blue-200 dark:border-blue-900/40">
            <div className="mb-1 flex items-center justify-between">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-blue-700 dark:text-blue-300">Instauração</p>
              <p className="font-mono text-[10px] text-slate-500">{par.instaurado_por_nome} · {dtTime(par.instaurado_at)}</p>
            </div>
            <p className="text-sm dark:text-slate-200">
              Comissão: <strong>{par.comissao_designacao}</strong>
              {par.instauracao_documento && <span className="ml-2 text-slate-500">· Doc: {par.instauracao_documento}</span>}
            </p>
            {par.defesa_prazo_limite && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Prazo de defesa: {par.defesa_prazo_dias} dias · limite {fmtDate(par.defesa_prazo_limite)}
              </p>
            )}
          </Card>
        )}

        {/* Defesa */}
        {par.defesa_resumo && (
          <Card className="p-3 border-yellow-200 dark:border-yellow-900/40">
            <div className="mb-1 flex items-center justify-between">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-yellow-700 dark:text-yellow-300">Defesa</p>
              <p className="font-mono text-[10px] text-slate-500">
                {par.defesa_apresentada_por_nome || 'Revelia'} {par.defesa_apresentada_at && `· ${dtTime(par.defesa_apresentada_at)}`}
              </p>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{par.defesa_resumo}</p>
            {par.defesa_documento && <p className="mt-1 font-mono text-[10px] text-slate-500">Doc: {par.defesa_documento}</p>}
          </Card>
        )}

        {/* Instrução */}
        {par.instrucao_parecer && (
          <Card className="p-3 border-purple-200 dark:border-purple-900/40">
            <div className="mb-1 flex items-center justify-between">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-purple-700 dark:text-purple-300">Parecer da instrução</p>
              <p className="font-mono text-[10px] text-slate-500">{par.instrucao_por_nome} · {dtTime(par.instrucao_concluida_at!)}</p>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{par.instrucao_parecer}</p>
          </Card>
        )}

        {/* Decisão */}
        {par.decisao_at && (
          <Card className={`p-3 ${par.decisao_resultado === 'improcedente' ? 'border-success/40' : 'border-error/40'}`}>
            <div className="mb-1 flex items-center justify-between">
              <p className={`font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display ${par.decisao_resultado === 'improcedente' ? 'text-success' : 'text-error'}`}>
                Decisão · {PAR_RESULTADO_LABELS[par.decisao_resultado!]}
              </p>
              <p className="font-mono text-[10px] text-slate-500">{par.decisao_por_nome} · {dtTime(par.decisao_at)}</p>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{par.decisao_motivacao}</p>
            {par.sancao_proposta_tipos && par.sancao_proposta_tipos.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {par.sancao_proposta_tipos.map((t) => (
                  <Badge key={t} tone={parSancaoTipoTone(t)}>{PAR_SANCAO_TIPO_LABELS[t]}</Badge>
                ))}
              </div>
            )}
            {par.sancao_proposta && (
              <p className="mt-2 italic text-xs text-slate-600 dark:text-slate-400">"{par.sancao_proposta}"</p>
            )}
          </Card>
        )}

        {/* Recurso */}
        {par.recurso_aberto_at && (
          <Card className="p-3 border-purple-200 dark:border-purple-900/40">
            <div className="mb-1 flex items-center justify-between">
              <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-purple-700 dark:text-purple-300">
                Recurso {par.recurso_resultado ? `· ${PAR_RECURSO_RESULTADO_LABELS[par.recurso_resultado]}` : '· aguarda julgamento'}
              </p>
              <p className="font-mono text-[10px] text-slate-500">Aberto em {dtTime(par.recurso_aberto_at)}</p>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{par.recurso_motivacao}</p>
            {par.recurso_julgado_at && par.recurso_motivacao_julgamento && (
              <div className="mt-2 rounded-md border-l-2 border-purple-300 pl-2 text-xs">
                <p className="font-mono text-[10px] text-slate-500">Julgamento em {dtTime(par.recurso_julgado_at)}</p>
                <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{par.recurso_motivacao_julgamento}</p>
              </div>
            )}
          </Card>
        )}

        {/* Action panels */}
        {active === 'instaurate' && (
          <Card className="p-3 border-blue-300 bg-blue-50/50 dark:border-blue-900/60 dark:bg-blue-900/10">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Designação da comissão" required hint="Ex: Portaria nº 042/2025">
                <input type="text" value={instCommission} onChange={(e) => setInstCommission(e.target.value)} maxLength={500} className="input" />
              </Field>
              <Field label="Prazo de defesa (dias úteis)" required>
                <input type="number" min={1} value={instPrazo} onChange={(e) => setInstPrazo(Number(e.target.value) || 15)} className="input" />
              </Field>
            </div>
            <Field label="Documento de instauração (opcional)">
              <input type="text" value={instDocumento} onChange={(e) => setInstDocumento(e.target.value)} maxLength={200} className="input" />
            </Field>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetAll}>Cancelar</Button>
              <Button size="sm" onClick={() => mInstaurate.mutate()} loading={mInstaurate.isPending} disabled={instCommission.trim().length < 5}>
                Instaurar
              </Button>
            </div>
          </Card>
        )}

        {active === 'defesa' && (
          <Card className="p-3 border-yellow-300 bg-yellow-50/50 dark:border-yellow-900/60 dark:bg-yellow-900/10">
            <label className="mb-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={defRevelia} onChange={(e) => setDefRevelia(e.target.checked)} />
              Marcar como revelia (defesa não apresentada)
            </label>
            {!defRevelia && (
              <>
                <Field label="Resumo da defesa" required hint="Mínimo 30 caracteres">
                  <textarea value={defResumo} onChange={(e) => setDefResumo(e.target.value)} rows={4} maxLength={5000} className="input" />
                  <p className="mt-1 font-mono text-[10px] text-slate-500">{defResumo.length}/5000 · mínimo 30</p>
                </Field>
                <Field label="Documento da defesa (opcional)">
                  <input type="text" value={defDocumento} onChange={(e) => setDefDocumento(e.target.value)} maxLength={200} className="input" />
                </Field>
              </>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetAll}>Cancelar</Button>
              <Button size="sm" onClick={() => mDefesa.mutate()} loading={mDefesa.isPending}
                disabled={!defRevelia && defResumo.trim().length < 30}>
                {defRevelia ? 'Registrar revelia' : 'Registrar defesa'}
              </Button>
            </div>
          </Card>
        )}

        {active === 'instrucao' && (
          <Card className="p-3 border-purple-300 bg-purple-50/50 dark:border-purple-900/60 dark:bg-purple-900/10">
            <Field label="Parecer da comissão" required hint="Mínimo 100 caracteres · fundamentação técnica">
              <textarea value={instrParecer} onChange={(e) => setInstrParecer(e.target.value)} rows={6} maxLength={10000} className="input" />
              <p className="mt-1 font-mono text-[10px] text-slate-500">{instrParecer.length}/10000 · mínimo 100</p>
            </Field>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetAll}>Cancelar</Button>
              <Button size="sm" onClick={() => mInstrucao.mutate()} loading={mInstrucao.isPending} disabled={instrParecer.trim().length < 100}>
                Concluir instrução
              </Button>
            </div>
          </Card>
        )}

        {active === 'decide' && (
          <Card className="p-3 border-error/40 bg-error/5">
            <div className="mb-3 flex flex-wrap gap-3">
              {(['procedente','parcialmente_procedente','improcedente'] as ParResultado[]).map((r) => (
                <label key={r} className="flex items-center gap-1.5 text-sm">
                  <input type="radio" checked={decResultado === r} onChange={() => setDecResultado(r)} />
                  {PAR_RESULTADO_LABELS[r]}
                </label>
              ))}
            </div>
            <Field label="Motivação da decisão" required hint="Mínimo 30 caracteres">
              <textarea value={decMotivacao} onChange={(e) => setDecMotivacao(e.target.value)} rows={4} maxLength={5000} className="input" />
              <p className="mt-1 font-mono text-[10px] text-slate-500">{decMotivacao.length}/5000 · mínimo 30</p>
            </Field>
            {decResultado !== 'improcedente' && (
              <>
                <div className="mb-2">
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-display text-slate-500">Sanções propostas (opcional)</p>
                  <div className="flex flex-wrap gap-2">
                    {SANCAO_TIPO_OPTIONS.map((t) => (
                      <label key={t} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={decSancaoTipos.has(t)} onChange={() => toggleSancao(t)} />
                        {PAR_SANCAO_TIPO_LABELS[t]}
                      </label>
                    ))}
                  </div>
                </div>
                <Field label="Descrição da proposta de sanção (opcional)" hint="Ex: valor da multa, duração do impedimento">
                  <textarea value={decSancaoProposta} onChange={(e) => setDecSancaoProposta(e.target.value)} rows={2} maxLength={2000} className="input" />
                </Field>
              </>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetAll}>Cancelar</Button>
              <Button size="sm" onClick={() => mDecide.mutate()} loading={mDecide.isPending} disabled={decMotivacao.trim().length < 30}>
                Decidir
              </Button>
            </div>
          </Card>
        )}

        {active === 'recurso' && (
          <Card className="p-3 border-purple-300 bg-purple-50/50 dark:border-purple-900/60 dark:bg-purple-900/10">
            <Field label="Motivação do recurso" required hint="Mínimo 30 caracteres">
              <textarea value={recMotivacao} onChange={(e) => setRecMotivacao(e.target.value)} rows={4} maxLength={5000} className="input" />
              <p className="mt-1 font-mono text-[10px] text-slate-500">{recMotivacao.length}/5000 · mínimo 30</p>
            </Field>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetAll}>Cancelar</Button>
              <Button size="sm" onClick={() => mRecurso.mutate()} loading={mRecurso.isPending} disabled={recMotivacao.trim().length < 30}>
                Interpor recurso
              </Button>
            </div>
          </Card>
        )}

        {active === 'judge_recurso' && (
          <Card className="p-3 border-purple-300 bg-purple-50/50 dark:border-purple-900/60 dark:bg-purple-900/10">
            <div className="mb-3 flex flex-wrap gap-3">
              {(['provido','parcialmente_provido','improvido'] as ParRecursoResultado[]).map((r) => (
                <label key={r} className="flex items-center gap-1.5 text-sm">
                  <input type="radio" checked={recResultado === r} onChange={() => setRecResultado(r)} />
                  {PAR_RECURSO_RESULTADO_LABELS[r]}
                </label>
              ))}
            </div>
            <Field label="Motivação do julgamento" required hint="Mínimo 30 caracteres">
              <textarea value={recJulgMotivacao} onChange={(e) => setRecJulgMotivacao(e.target.value)} rows={4} maxLength={5000} className="input" />
              <p className="mt-1 font-mono text-[10px] text-slate-500">{recJulgMotivacao.length}/5000 · mínimo 30</p>
            </Field>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetAll}>Cancelar</Button>
              <Button size="sm" onClick={() => mJudgeRec.mutate()} loading={mJudgeRec.isPending} disabled={recJulgMotivacao.trim().length < 30}>
                Julgar recurso
              </Button>
            </div>
          </Card>
        )}

        {active === 'cancel' && (
          <Card className="p-3 border-error/40 bg-error/5">
            <Field label="Motivo do cancelamento" required hint="Mínimo 10 caracteres">
              <textarea value={cancelMotivo} onChange={(e) => setCancelMotivo(e.target.value)} rows={3} maxLength={1000} className="input" />
            </Field>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetAll}>Manter</Button>
              <Button size="sm" onClick={() => mCancel.mutate()} loading={mCancel.isPending} disabled={cancelMotivo.trim().length < 10}>
                Cancelar PAR
              </Button>
            </div>
          </Card>
        )}

        {/* Timeline */}
        {steps.length > 0 && (
          <Card className="p-3">
            <p className="mb-2 font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500">Linha do tempo</p>
            <div className="space-y-1">
              {steps.map((s) => (
                <div key={s.id} className="flex items-start gap-2 text-xs">
                  <ChevronRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-slate-400" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium dark:text-slate-200">{s.descricao}</span>
                    <span className="ml-1 text-slate-500">· {s.applied_by_nome || '—'} · {dtTime(s.step_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <p className="font-mono text-[10px] text-slate-400">
          Criado em {dtTime(par.created_at)} por {par.created_by_nome || '—'}
        </p>
      </div>
    </Modal>
  );
}
