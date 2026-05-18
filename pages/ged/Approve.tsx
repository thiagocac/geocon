import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, XCircle, RotateCcw, Clock, ShieldCheck, AlertCircle,
  Mail, ArrowDown, UserCheck, Copy, ExternalLink, FileText,
} from 'lucide-react';
import {
  listGedRevisionApprovalSteps, decideGedRevisionStep, issueGedRevisionMagicLink,
  listGedDocumentVersions, getGedDocument,
  type GedRevisionApprovalStep,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { dt, dtTime, relativeTime } from '../../lib/format';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Field, Select } from '../../components/ui/FormField';
import { Empty, Skeleton } from '../../components/ui/Stat';
import type { BadgeTone } from '../../lib/status';

const STATUS_LABEL: Record<GedRevisionApprovalStep['status'], string> = {
  pendente:  'Pendente',
  aprovado:  'Aprovado',
  devolvido: 'Devolvido',
  reprovado: 'Reprovado',
  ignorado:  'Ignorado',
};

const STATUS_TONE: Record<GedRevisionApprovalStep['status'], BadgeTone> = {
  pendente: 'yellow', aprovado: 'green', devolvido: 'yellow', reprovado: 'red', ignorado: 'slate',
};

/**
 * V60 — Página de aprovação de revisão GED.
 *
 * Rota: /ged/documentos/:docId/aprovar
 *
 * Lista steps de aprovação da versão atualmente em_aprovacao (a mais recente
 * que tem status='em_aprovacao' ou 'em_revisao'). Permite aprovar/devolver/reprovar
 * cada um + emitir magic link para aprovador externo.
 */
export function GedDocumentApprove() {
  const { docId = '' } = useParams();
  const qc = useQueryClient();

  const { data: doc } = useQuery({
    queryKey: ['ged-doc', docId],
    queryFn: () => getGedDocument(docId),
    enabled: !!docId,
  });
  const { data: versions = [] } = useQuery({
    queryKey: ['ged-versions', docId],
    queryFn: () => listGedDocumentVersions(docId),
    enabled: !!docId,
  });

  // Pega a versão mais recente que tem status em_aprovacao ou em_revisao
  // Fallback para a mais recente.
  const targetVersion = versions.find((v) => v.status === 'em_aprovacao')
                     ?? versions.find((v) => v.status === 'vigente')
                     ?? versions[0];

  const { data: steps = [], isLoading } = useQuery({
    queryKey: ['ged-rev-steps', targetVersion?.id],
    queryFn: () => listGedRevisionApprovalSteps(targetVersion!.id),
    enabled: !!targetVersion?.id,
  });

  const [decisionStep, setDecisionStep] = useState<GedRevisionApprovalStep | null>(null);
  const [decisionAction, setDecisionAction] = useState<'aprovar' | 'devolver' | 'reprovar'>('aprovar');
  const [decisionComment, setDecisionComment] = useState('');
  const [decisionErr, setDecisionErr] = useState<string | null>(null);

  const [magicOpen, setMagicOpen] = useState(false);
  const [magicStep, setMagicStep] = useState<GedRevisionApprovalStep | null>(null);
  const [magicEmail, setMagicEmail] = useState('');
  const [magicTtl, setMagicTtl] = useState(72);
  const [magicUrl, setMagicUrl] = useState<string | null>(null);
  const [magicErr, setMagicErr] = useState<string | null>(null);

  const decideMut = useMutation({
    mutationFn: (input: { step_id: string; action: 'aprovar' | 'devolver' | 'reprovar'; comment?: string }) =>
      decideGedRevisionStep(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ged-rev-steps', targetVersion?.id] });
      qc.invalidateQueries({ queryKey: ['ged-doc', docId] });
      qc.invalidateQueries({ queryKey: ['ged-versions', docId] });
      setDecisionStep(null);
      setDecisionComment('');
      setDecisionErr(null);
    },
    onError: (e: Error) => setDecisionErr(humanizeError(e)),
  });

  const magicMut = useMutation({
    mutationFn: (input: { step_id: string; email: string; ttl: number }) =>
      issueGedRevisionMagicLink(input.step_id, input.email, input.ttl),
    onSuccess: (url) => {
      setMagicUrl(url);
      setMagicErr(null);
    },
    onError: (e: Error) => setMagicErr(humanizeError(e)),
  });

  function openDecision(step: GedRevisionApprovalStep, action: 'aprovar' | 'devolver' | 'reprovar') {
    setDecisionStep(step);
    setDecisionAction(action);
    setDecisionComment('');
    setDecisionErr(null);
  }

  function openMagic(step: GedRevisionApprovalStep) {
    setMagicStep(step);
    setMagicEmail('');
    setMagicTtl(72);
    setMagicUrl(null);
    setMagicErr(null);
    setMagicOpen(true);
  }

  const totalSteps = steps.length;
  const aprovados  = steps.filter((s) => s.status === 'aprovado').length;
  const reprovados = steps.filter((s) => s.status === 'reprovado').length;
  const pendentes  = steps.filter((s) => s.status === 'pendente').length;

  return (
    <Layout>
      <PageHeader
        kicker="GED · Aprovação de revisão"
        title={doc?.title ?? 'Aprovação'}
        subtitle={targetVersion ? `Revisão ${targetVersion.revision} · ${steps.length} etapas` : 'Carregando…'}
        backTo={`/ged/documentos/${docId}`}
        backLabel="Documento"
      />

      {isLoading && <Card className="p-6"><Skeleton className="h-32" /></Card>}

      {!isLoading && !targetVersion && (
        <Empty
          title="Sem revisão pendente"
          body="Este documento não tem versão em aprovação. Faça upload de uma nova revisão para iniciar."
          action={<Link to={`/ged/documentos/${docId}/nova-revisao`} className="font-semibold text-navy hover:underline">Nova revisão →</Link>}
        />
      )}

      {!isLoading && targetVersion && totalSteps === 0 && (
        <Empty
          title="Workflow ainda não instanciado"
          body="Submeta a revisão para aprovação a partir do detalhe do documento."
          action={<Link to={`/ged/documentos/${docId}`} className="font-semibold text-navy hover:underline">Ir para documento →</Link>}
        />
      )}

      {targetVersion && totalSteps > 0 && (
        <>
          {/* Resumo */}
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <SummaryCard label="Total etapas"  value={totalSteps}  tone="slate"  icon={FileText} />
            <SummaryCard label="Aprovadas"     value={aprovados}   tone="green"  icon={CheckCircle2} />
            <SummaryCard label="Pendentes"     value={pendentes}   tone="yellow" icon={Clock} />
            <SummaryCard label="Reprovadas"    value={reprovados}  tone="red"    icon={XCircle} />
          </div>

          {/* Lista de steps */}
          <Card className="overflow-hidden">
            <header className="border-b border-slate-100 px-5 py-3 dark:border-border-dark">
              <h2 className="font-semibold dark:text-slate-100">Etapas de aprovação</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sequência configurada no template GED do tenant
              </p>
            </header>
            <ul className="divide-y divide-slate-100 dark:divide-border-dark">
              {steps.map((step, idx) => (
                <li key={step.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-xs font-bold dark:bg-muted-dark">
                        {step.ordem}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold dark:text-slate-100">{step.nome}</h3>
                          <Badge tone={STATUS_TONE[step.status]}>{STATUS_LABEL[step.status]}</Badge>
                          <span className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
                            {step.role_required}
                          </span>
                        </div>
                        {step.assigned_member && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                            <UserCheck className="h-3 w-3" />
                            Atribuído a {step.assigned_member.nome}
                            {step.assigned_member.email && <> · {step.assigned_member.email}</>}
                          </p>
                        )}
                        {step.due_at && step.status === 'pendente' && (
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            <Clock className="mr-1 inline h-3 w-3" />
                            Prazo: {dtTime(step.due_at)} · {relativeTime(step.due_at)}
                          </p>
                        )}
                        {step.decided_at && (
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            Decidido em {dtTime(step.decided_at)}
                            {step.decided_member && <> por {step.decided_member.nome}</>}
                          </p>
                        )}
                        {step.comment && (
                          <blockquote className="mt-2 rounded-md border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-muted-dark dark:text-slate-300">
                            {step.comment}
                          </blockquote>
                        )}
                      </div>
                    </div>
                    {step.status === 'pendente' && (
                      <div className="flex flex-col items-stretch gap-2">
                        <Button size="sm" onClick={() => openDecision(step, 'aprovar')}>
                          <CheckCircle2 className="h-3.5 w-3.5" />Aprovar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openDecision(step, 'devolver')}>
                          <RotateCcw className="h-3.5 w-3.5" />Devolver
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openDecision(step, 'reprovar')}
                                className="text-error hover:bg-error/10">
                          <XCircle className="h-3.5 w-3.5" />Reprovar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openMagic(step)}
                                title="Gerar link para aprovador externo via e-mail">
                          <Mail className="h-3.5 w-3.5" />Magic link
                        </Button>
                      </div>
                    )}
                  </div>
                  {idx < steps.length - 1 && (
                    <div className="ml-4 mt-3 flex items-center text-slate-300 dark:text-slate-600">
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {/* Modal de decisão */}
      <Modal
        open={!!decisionStep}
        onClose={() => setDecisionStep(null)}
        title={decisionStep
          ? `${decisionAction === 'aprovar' ? 'Aprovar' : decisionAction === 'devolver' ? 'Devolver' : 'Reprovar'} etapa: ${decisionStep.nome}`
          : ''}
      >
        {decisionStep && (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {decisionAction === 'aprovar' && 'Aprovar avança o workflow. Se for a última etapa, a revisão será publicada como vigente.'}
              {decisionAction === 'devolver' && 'Devolver mantém a revisão em análise para ajustes; outras etapas continuam pendentes.'}
              {decisionAction === 'reprovar' && 'Reprovar encerra o ciclo; a revisão volta como reprovada e o documento volta a em_revisao.'}
            </p>
            <div className="mt-3">
              <Field label={decisionAction === 'aprovar' ? 'Comentário (opcional)' : 'Motivo'}>
                <textarea
                  value={decisionComment}
                  onChange={(e) => setDecisionComment(e.target.value)}
                  rows={4}
                  className="input font-sans"
                  placeholder={decisionAction === 'aprovar' ? 'Conformidade verificada…' : 'Descreva os ajustes necessários…'}
                />
              </Field>
            </div>
            {decisionErr && (
              <p className="mt-3 flex items-start gap-1 text-xs text-error">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                {decisionErr}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDecisionStep(null)}>Cancelar</Button>
              <Button
                onClick={() => decideMut.mutate({
                  step_id: decisionStep.id,
                  action: decisionAction,
                  comment: decisionComment.trim() || undefined,
                })}
                loading={decideMut.isPending}
                disabled={decisionAction !== 'aprovar' && !decisionComment.trim()}
                title={decisionAction !== 'aprovar' && !decisionComment.trim() ? 'Comentário obrigatório' : undefined}
              >
                Confirmar
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* Modal de magic link */}
      <Modal
        open={magicOpen}
        onClose={() => setMagicOpen(false)}
        title="Gerar link para aprovador externo"
      >
        {magicStep && !magicUrl && (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Etapa: <strong>{magicStep.nome}</strong>. O destinatário receberá um link
              válido para decidir essa etapa sem precisar criar conta.
            </p>
            <div className="mt-4 space-y-3">
              <Field label="E-mail do aprovador">
                <input type="email" value={magicEmail} onChange={(e) => setMagicEmail(e.target.value)}
                       placeholder="aprovador@empresa.com" className="input" />
              </Field>
              <Field label="Validade do link (horas)" hint="entre 1 e 168 (1 semana)">
                <input type="number" min={1} max={168} value={magicTtl}
                       onChange={(e) => setMagicTtl(Number(e.target.value) || 72)} className="input" />
              </Field>
            </div>
            {magicErr && (
              <p className="mt-3 flex items-start gap-1 text-xs text-error">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                {magicErr}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMagicOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => magicMut.mutate({ step_id: magicStep.id, email: magicEmail, ttl: magicTtl })}
                loading={magicMut.isPending}
                disabled={!magicEmail || !/\S+@\S+\.\S+/.test(magicEmail)}
              >
                <Mail className="h-4 w-4" />Gerar link
              </Button>
            </div>
          </>
        )}
        {magicUrl && (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Link gerado. Encaminhe ao aprovador externo:
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-border-dark dark:bg-muted-dark">
              <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
              <code className="flex-1 truncate text-xs">{magicUrl}</code>
              <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(magicUrl)}>
                <Copy className="h-3.5 w-3.5" />Copiar
              </Button>
              <a href={magicUrl} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-navy">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="mt-5 flex justify-end">
              <Button onClick={() => setMagicOpen(false)}>Fechar</Button>
            </div>
          </>
        )}
      </Modal>
    </Layout>
  );
}

function SummaryCard({
  icon: Icon, label, value, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: 'slate' | 'green' | 'yellow' | 'red';
}) {
  const cfg = {
    slate:  'text-slate-700 dark:text-slate-200',
    green:  'text-success',
    yellow: 'text-yellow-700 dark:text-yellow-300',
    red:    'text-error',
  }[tone];
  return (
    <Card className={`px-4 py-3 ${value === 0 ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${cfg}`} aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
          {label}
        </span>
      </div>
      <p className={`mt-1 font-mono tabular text-2xl font-bold ${cfg}`}>{value}</p>
    </Card>
  );
}
