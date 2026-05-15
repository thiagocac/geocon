import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, XCircle, RotateCcw, Clock, ShieldCheck, Send, AlertCircle,
  Mail, ArrowDown, UserCheck, Copy, ExternalLink,
} from 'lucide-react';
import {
  listMeasurementApprovalSteps, decideApprovalStep,
  instantiateMeasurementWorkflow, issueApprovalMagicLink,
  getMeasurement,
  type MeasurementApprovalStep,
} from '../lib/api';
import { humanizeError } from '../lib/errors';
import { dt, dtTime, relativeTime } from '../lib/format';
import { SITE_URL } from '../lib/supabase';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Field, Select } from '../components/ui/FormField';
import { Empty, Skeleton } from '../components/ui/Stat';
import type { BadgeTone } from '../lib/status';

const STATUS_LABEL: Record<MeasurementApprovalStep['status'], string> = {
  pendente:  'Pendente',
  aprovado:  'Aprovado',
  devolvido: 'Devolvido',
  reprovado: 'Reprovado',
  ignorado:  'Ignorado',
};

const STATUS_TONE: Record<MeasurementApprovalStep['status'], BadgeTone> = {
  pendente: 'yellow', aprovado: 'green', devolvido: 'yellow', reprovado: 'red', ignorado: 'slate',
};

export function MeasurementApprovePage() {
  const { id = '', medId = '' } = useParams();
  const qc = useQueryClient();

  const { data: measurement } = useQuery({
    queryKey: ['measurement', medId], queryFn: () => getMeasurement(medId), enabled: !!medId,
  });
  const { data: steps = [], isLoading } = useQuery({
    queryKey: ['approval-steps', medId], queryFn: () => listMeasurementApprovalSteps(medId), enabled: !!medId,
  });

  const instantiate = useMutation({
    mutationFn: () => instantiateMeasurementWorkflow(medId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approval-steps', medId] }),
  });

  const [decisionStep, setDecisionStep] = useState<{ step: MeasurementApprovalStep; action: 'aprovar' | 'devolver' | 'reprovar' } | null>(null);
  const [comment, setComment] = useState('');
  const [signatureMethod, setSignatureMethod] = useState('');
  const [decisionErr, setDecisionErr] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: () => decideApprovalStep({
      step_id: decisionStep!.step.id,
      action: decisionStep!.action,
      comment, signature_method: signatureMethod || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approval-steps', medId] });
      qc.invalidateQueries({ queryKey: ['measurement', medId] });
      setDecisionStep(null); setComment(''); setSignatureMethod(''); setDecisionErr(null);
    },
    onError: (e: Error) => setDecisionErr(humanizeError(e)),
  });

  function openDecision(step: MeasurementApprovalStep, action: 'aprovar' | 'devolver' | 'reprovar') {
    setDecisionStep({ step, action });
    setComment('');
    setSignatureMethod(step.signature_method || '');
    setDecisionErr(null);
  }

  const [linkStep, setLinkStep] = useState<MeasurementApprovalStep | null>(null);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkResult, setLinkResult] = useState<{ token: string; expires_in_hours: number } | null>(null);
  const [linkErr, setLinkErr] = useState<string | null>(null);

  const issueLink = useMutation({
    mutationFn: () => issueApprovalMagicLink({ step_id: linkStep!.id, recipient_email: linkEmail, ttl_hours: 72 }),
    onSuccess: (r) => { setLinkResult(r); setLinkErr(null); },
    onError: (e: Error) => setLinkErr(humanizeError(e)),
  });

  function openLink(step: MeasurementApprovalStep) {
    setLinkStep(step);
    setLinkEmail(step.assigned_member?.email || '');
    setLinkResult(null); setLinkErr(null);
  }

  const isPreliminar = measurement && !['emitida', 'aprovada', 'paga'].includes(measurement.status);
  const allDone = steps.length > 0 && steps.every((s) => s.status === 'aprovado');
  const currentIdx = steps.findIndex((s) => s.status === 'pendente');

  return (
    <Layout>
      <PageHeader
        title="Aprovação da medição"
        subtitle={`Workflow configurável · ${steps.length} etapas${measurement ? ` · Medição n.º ${measurement.numero}` : ''}`}
        backTo={`/contratos/${id}/medicoes/${medId}`}
        backLabel="Medição"
        actions={
          steps.length === 0 ? (
            <Button onClick={() => instantiate.mutate()} loading={instantiate.isPending}>
              <Send className="h-4 w-4" />Iniciar workflow
            </Button>
          ) : null
        }
      />

      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}

      {!isLoading && steps.length === 0 && (
        <Empty
          title="Workflow ainda não iniciado"
          body="Inicie o workflow para que cada etapa de aprovação seja criada a partir do template configurado para este contrato."
          action={
            <Button onClick={() => instantiate.mutate()} loading={instantiate.isPending}>
              <Send className="h-4 w-4" />Iniciar workflow
            </Button>
          }
        />
      )}

      {allDone && (
        <Card className="mb-4 border-2 border-success bg-green-50 p-4 dark:bg-green-900/10">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-success" />
            <div>
              <p className="font-semibold text-green-900 dark:text-green-200">Todas as etapas aprovadas</p>
              <p className="text-sm text-green-800 dark:text-green-300">
                A medição passou pelo fluxo completo. Gere o PDF oficial pelo botão "Gerar PDF" na tela da medição.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Pipeline vertical de etapas */}
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={step.id} className="flex gap-3">
            {/* Coluna esquerda: badge numerada + conector */}
            <div className="flex flex-col items-center">
              <div className={`flex h-10 w-10 items-center justify-center rounded-full font-bold ${
                step.status === 'aprovado' ? 'bg-success text-white' :
                step.status === 'reprovado' ? 'bg-error text-white' :
                step.status === 'devolvido' ? 'bg-warning text-white' :
                i === currentIdx ? 'bg-navy text-white ring-4 ring-navy/20' :
                'bg-slate-200 text-slate-500 dark:bg-muted-dark'
              }`}>
                {step.status === 'aprovado' ? <CheckCircle2 className="h-5 w-5" /> :
                 step.status === 'reprovado' ? <XCircle className="h-5 w-5" /> :
                 step.status === 'devolvido' ? <RotateCcw className="h-5 w-5" /> :
                 step.ordem}
              </div>
              {i < steps.length - 1 && (
                <div className={`mt-1 h-full w-0.5 ${step.status === 'aprovado' ? 'bg-success' : 'bg-slate-200 dark:bg-muted-dark'}`} />
              )}
            </div>

            {/* Card da etapa */}
            <Card className="mb-3 flex-1 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">{step.nome}</h3>
                    <Badge tone={STATUS_TONE[step.status]}>{STATUS_LABEL[step.status]}</Badge>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Papel: <strong>{step.role_required}</strong>
                    {step.assigned_member && <> · Responsável: {step.assigned_member.nome}</>}
                  </p>

                  {step.due_at && step.status === 'pendente' && (
                    <p className={`mt-1 flex items-center gap-1 text-xs ${
                      new Date(step.due_at) < new Date() ? 'text-error' : 'text-slate-500'
                    }`}>
                      <Clock className="h-3 w-3" />
                      Prazo: {dtTime(step.due_at)} ({relativeTime(step.due_at)})
                    </p>
                  )}

                  {step.decided_at && (
                    <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs dark:bg-muted-dark">
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {STATUS_LABEL[step.status]} por {step.decided_member?.nome || '—'}
                        {step.decided_via_delegation && <span className="ml-1 text-purple"> · via delegação</span>}
                        {' · '}{dt(step.decided_at)} {dtTime(step.decided_at).slice(11)}
                      </p>
                      {step.comment && (
                        <p className="mt-1 text-slate-600 dark:text-slate-300">"{step.comment}"</p>
                      )}
                      {step.signature_method && (
                        <p className="mt-1 text-xs">
                          <ShieldCheck className="mr-1 inline h-3 w-3 text-success" />
                          Assinado via <strong>{step.signature_method}</strong>
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Ações */}
                {step.status === 'pendente' && (
                  <div className="flex flex-col gap-1">
                    <Button onClick={() => openDecision(step, 'aprovar')} className="!py-1 !text-xs">
                      <CheckCircle2 className="h-3.5 w-3.5" />Aprovar
                    </Button>
                    <Button variant="outline" onClick={() => openDecision(step, 'devolver')} className="!py-1 !text-xs">
                      <RotateCcw className="h-3.5 w-3.5" />Devolver
                    </Button>
                    <Button variant="danger" onClick={() => openDecision(step, 'reprovar')} className="!py-1 !text-xs">
                      <XCircle className="h-3.5 w-3.5" />Reprovar
                    </Button>
                    <button onClick={() => openLink(step)} className="mt-1 flex items-center gap-1 text-xs text-navy hover:underline dark:text-slate-300">
                      <Mail className="h-3 w-3" />Enviar magic link
                    </button>
                  </div>
                )}
              </div>
            </Card>
          </div>
        ))}
      </div>

      {isPreliminar && steps.length > 0 && (
        <Card className="mt-4 bg-slate-50 p-3 dark:bg-muted-dark">
          <p className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <AlertCircle className="h-3 w-3 text-warning" />
            Documento PRELIMINAR. Após todas as etapas serem aprovadas, o status muda para "aprovada" e o boletim
            sai sem marca d'água.
          </p>
        </Card>
      )}

      {/* Modal: confirmar decisão */}
      <Modal
        open={!!decisionStep} onClose={() => setDecisionStep(null)}
        title={decisionStep ? `${decisionStep.action === 'aprovar' ? 'Aprovar' : decisionStep.action === 'devolver' ? 'Devolver' : 'Reprovar'} etapa: ${decisionStep.step.nome}` : ''}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecisionStep(null)}>Cancelar</Button>
            <Button
              variant={decisionStep?.action === 'reprovar' ? 'danger' : decisionStep?.action === 'devolver' ? 'outline' : 'primary'}
              onClick={() => decide.mutate()} loading={decide.isPending}
              disabled={(decisionStep?.action !== 'aprovar') && !comment.trim()}
            >
              Confirmar {decisionStep?.action}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field
            label="Comentário"
            required={decisionStep?.action !== 'aprovar'}
            hint={decisionStep?.action !== 'aprovar' ? 'Obrigatório ao devolver ou reprovar (RN-018)' : 'Opcional'}
          >
            <textarea className="input" rows={3}
              value={comment} onChange={(e) => setComment(e.target.value)} autoFocus
              placeholder={decisionStep?.action === 'aprovar' ? 'Comentário opcional' : 'Descreva os motivos'}
            />
          </Field>

          {decisionStep?.action === 'aprovar' && (
            <Field label="Método de assinatura" hint="Se a etapa exige assinatura digital">
              <Select
                options={[
                  { value: '',         label: '— sem assinatura digital —' },
                  { value: 'gov_br',   label: 'gov.br' },
                  { value: 'zapsign',  label: 'ZapSign' },
                  { value: 'simples',  label: 'Assinatura simples (login)' },
                ]}
                value={signatureMethod} onChange={(e) => setSignatureMethod(e.target.value)}
              />
            </Field>
          )}

          {decisionErr && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4" /><span>{decisionErr}</span>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal: magic link */}
      <Modal
        open={!!linkStep} onClose={() => { setLinkStep(null); setLinkResult(null); }}
        title="Enviar link de aprovação por email"
        subtitle={linkStep ? `${linkStep.nome} · ${linkStep.role_required}` : ''}
        size="md"
        footer={
          linkResult ? (
            <Button onClick={() => { setLinkStep(null); setLinkResult(null); }}>Fechar</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setLinkStep(null)}>Cancelar</Button>
              <Button onClick={() => issueLink.mutate()} loading={issueLink.isPending} disabled={!linkEmail.includes('@')}>
                <Mail className="h-4 w-4" />Gerar e enviar
              </Button>
            </>
          )
        }
      >
        {!linkResult && (
          <div className="space-y-3">
            <Field label="Email do destinatário" required hint="Quem vai receber o link com poder de aprovação">
              <input type="email" className="input" value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} autoFocus />
            </Field>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              O link expira em 72 horas. Após uso, fica invalidado automaticamente.
            </p>
            {linkErr && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4" /><span>{linkErr}</span>
              </div>
            )}
          </div>
        )}

        {linkResult && (
          <div className="space-y-3">
            <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/10 dark:text-green-300">
              <CheckCircle2 className="mb-1 h-5 w-5" />
              <p className="font-semibold">Link gerado · expira em {linkResult.expires_in_hours}h</p>
              <p className="mt-1 text-xs">
                Email enviado para <strong>{linkEmail}</strong>. O destinatário pode usar a URL abaixo
                para decidir a etapa sem precisar fazer login no sistema.
              </p>
            </div>

            {(() => {
              const url = `${SITE_URL.replace(/\/$/, '')}/aprovar/${linkResult.token}`;
              return (
                <>
                  <Field label="URL pública de aprovação">
                    <div className="flex gap-2">
                      <input className="input font-mono text-xs" readOnly value={url} />
                      <button
                        onClick={() => { navigator.clipboard?.writeText(url); }}
                        className="rounded-lg border border-slate-300 px-3 hover:bg-slate-50 dark:border-border-dark dark:text-slate-200"
                        title="Copiar URL"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <a href={url} target="_blank" rel="noopener noreferrer"
                        className="rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50 dark:border-border-dark dark:text-slate-200"
                        title="Abrir em nova aba"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  </Field>

                  <details className="text-xs text-slate-500 dark:text-slate-400">
                    <summary className="cursor-pointer">Mostrar apenas o token</summary>
                    <div className="mt-2 flex gap-2">
                      <input className="input font-mono text-xs" readOnly value={linkResult.token} />
                      <button
                        onClick={() => { navigator.clipboard?.writeText(linkResult.token); }}
                        className="rounded-lg border border-slate-300 px-3 hover:bg-slate-50 dark:border-border-dark dark:text-slate-200"
                        title="Copiar token"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  </details>
                </>
              );
            })()}

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Por segurança, só armazenamos o hash SHA-256 do token. Guarde a URL caso precise reenviar
              — o sistema não consegue recuperá-la depois de fechado este modal.
            </p>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
