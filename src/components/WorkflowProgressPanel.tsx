import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RotateCcw, XCircle, Clock, AlertTriangle } from 'lucide-react';
import {
  listMeasurementApprovalSteps, decideApprovalStep, getMeasurementWorkflowStatus,
  type MeasurementApprovalStep, type MeasurementWorkflowStatus,
} from '../lib/api';
import { dtTime } from '../lib/format';
import { humanizeError } from '../lib/errors';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Field, Select } from './ui/FormField';
import { Progress, Skeleton } from './ui/Stat';

const STATUS_TONE: Record<string, 'slate' | 'yellow' | 'green' | 'red'> = {
  pendente:  'yellow',
  aprovado:  'green',
  liberado:  'green',
  devolvido: 'yellow',
  reprovado: 'red',
  cancelado: 'slate',
};

const SLA_TONE: Record<MeasurementWorkflowStatus['proximo_step_sla'], 'green' | 'yellow' | 'red' | 'slate'> = {
  no_prazo: 'green',
  urgente:  'yellow',
  atrasado: 'red',
  sem_sla:  'slate',
};

const SLA_LABEL: Record<MeasurementWorkflowStatus['proximo_step_sla'], string> = {
  no_prazo: 'No prazo',
  urgente:  'Urgente',
  atrasado: 'Atrasado',
  sem_sla:  'Sem SLA',
};

export function WorkflowProgressPanel({ measurementId, readOnly = false }: {
  measurementId: string;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState<{ step: MeasurementApprovalStep; action: 'aprovar' | 'devolver' | 'reprovar' } | null>(null);

  const { data: status, isLoading: ls } = useQuery({
    queryKey: ['workflow-status', measurementId],
    queryFn: () => getMeasurementWorkflowStatus(measurementId),
    enabled: !!measurementId,
  });

  const { data: steps = [], isLoading: ll } = useQuery({
    queryKey: ['workflow-steps', measurementId],
    queryFn: () => listMeasurementApprovalSteps(measurementId),
    enabled: !!measurementId,
  });

  if (ls || ll) return <Card className="p-5"><Skeleton className="h-40" /></Card>;
  if (!status || status.total_steps === 0) {
    return (
      <Card className="overflow-hidden">
        <header className="border-b border-slate-100 px-5 py-3 dark:border-border-dark">
          <h2 className="font-semibold dark:text-slate-100">Aprovação</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Nenhum fluxo instanciado ainda.</p>
        </header>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden">
        <header className="border-b border-slate-100 px-5 py-3 dark:border-border-dark">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold dark:text-slate-100">Aprovação</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {status.approved_steps} de {status.total_steps} etapa(s) concluída(s)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={SLA_TONE[status.proximo_step_sla]}>{SLA_LABEL[status.proximo_step_sla]}</Badge>
              <span className="font-mono text-sm tabular dark:text-slate-200">{status.pct_concluido}%</span>
            </div>
          </div>
          <div className="mt-3">
            <Progress value={status.pct_concluido} />
          </div>
        </header>

        <ul className="divide-y divide-slate-100 dark:divide-border-dark">
          {steps.map((s, i) => {
            const tone = STATUS_TONE[s.status] || 'slate';
            const isPending = s.status === 'pendente';
            return (
              <li key={s.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">#{s.ordem ?? i + 1}</span>
                      <p className="truncate font-medium dark:text-slate-100">{s.nome || s.role_required || `Etapa ${s.ordem ?? i + 1}`}</p>
                      <Badge tone={tone}>{s.status}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {s.role_required ? `Papel: ${s.role_required}` : null}
                      {s.due_at ? ` · Vence ${dtTime(s.due_at)}` : null}
                      {s.decided_at ? ` · Decidida ${dtTime(s.decided_at)}` : null}
                    </p>
                    {s.comment && (
                      <p className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600 dark:bg-muted-dark dark:text-slate-300">
                        “{s.comment}”
                      </p>
                    )}
                  </div>
                  {!readOnly && isPending && (
                    <div className="flex flex-shrink-0 gap-1">
                      <Button size="sm" variant="outline" onClick={() => setEditing({ step: s, action: 'aprovar' })}>
                        <CheckCircle2 className="h-3.5 w-3.5" />Aprovar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing({ step: s, action: 'devolver' })}>
                        <RotateCcw className="h-3.5 w-3.5" />Devolver
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing({ step: s, action: 'reprovar' })}
                              className="!text-error hover:!bg-red-50 dark:hover:!bg-red-900/20">
                        <XCircle className="h-3.5 w-3.5" />Reprovar
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {editing && (
        <DecideModal
          step={editing.step}
          action={editing.action}
          measurementId={measurementId}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Modal de decisão
// -----------------------------------------------------------------------------
function DecideModal({ step, action, measurementId, onClose }: {
  step: MeasurementApprovalStep;
  action: 'aprovar' | 'devolver' | 'reprovar';
  measurementId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [signatureMethod, setSignatureMethod] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: () => decideApprovalStep({
      step_id: step.id,
      action,
      comment: comment.trim() || undefined,
      signature_method: signatureMethod || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow-steps', measurementId] });
      qc.invalidateQueries({ queryKey: ['workflow-status', measurementId] });
      qc.invalidateQueries({ queryKey: ['measurement', measurementId] });
      onClose();
    },
    onError: (e) => setErr(humanizeError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if ((action === 'devolver' || action === 'reprovar') && comment.trim().length < 5) {
      setErr(`Comentário obrigatório ao ${action} (mínimo 5 caracteres)`);
      return;
    }
    decide.mutate();
  }

  const title = action === 'aprovar' ? 'Aprovar etapa' : action === 'devolver' ? 'Devolver etapa' : 'Reprovar etapa';
  const verb = action === 'aprovar' ? 'Confirmar aprovação' : action === 'devolver' ? 'Devolver para correção' : 'Reprovar';

  return (
    <Modal open onClose={onClose} title={title}
      subtitle={`Etapa #${step.ordem ?? '—'}: ${step.nome || step.role_required || '—'}`}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={decide.isPending}
            className={action === 'reprovar' ? '!bg-error hover:!bg-red-700' : ''}>
            {action === 'aprovar' && <CheckCircle2 className="h-4 w-4" />}
            {action === 'devolver' && <RotateCcw className="h-4 w-4" />}
            {action === 'reprovar' && <XCircle className="h-4 w-4" />}
            {verb}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {action === 'reprovar' && (
          <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>Reprovar move a medição para o status <strong>cancelada</strong>. Esta ação não pode ser desfeita pela interface.</span>
          </div>
        )}
        <Field label="Comentário" required={action !== 'aprovar'}
          hint={action === 'aprovar' ? 'Opcional. Use para registrar observações de auditoria.' : 'Mínimo 5 caracteres. Será gravado no histórico.'}>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
            className="input min-h-[80px] resize-y"
            placeholder={action === 'devolver' ? 'Ex: Refazer a glosa do item 3.1 com base no RDO 04/2025.' : ''}
          />
        </Field>
        <Field label="Método de assinatura" hint="Opcional — apenas para registro auditoria.">
          <Select value={signatureMethod} onChange={(e) => setSignatureMethod(e.target.value)}
            options={[
              { value: '',              label: '— Sem assinatura digital —' },
              { value: 'pin',           label: 'PIN interno' },
              { value: 'certificado_a3', label: 'Certificado A3' },
              { value: 'icp_brasil',    label: 'ICP-Brasil' },
            ]}
          />
        </Field>
        {err && <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          <Clock className="mr-1 inline h-4 w-4 align-text-bottom" />{err}
        </p>}
      </form>
    </Modal>
  );
}
