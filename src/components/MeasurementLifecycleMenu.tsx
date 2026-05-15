import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, FilePlus, RefreshCcw, XCircle, Save } from 'lucide-react';
import {
  createComplementarMeasurement,
  createRetificacaoMeasurement,
  cancelMeasurement,
} from '../lib/api';
import { humanizeError } from '../lib/errors';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Field } from './ui/FormField';

type Action = 'complementar' | 'retificacao' | 'cancelar' | null;

interface MeasurementForMenu {
  id: string;
  numero: number;
  complementar_numero: number | null;
  status: string;
  periodo_inicio: string;
  periodo_fim: string;
  contract_id: string;
}

export function MeasurementLifecycleMenu({ measurement, onMutated }: {
  measurement: MeasurementForMenu;
  onMutated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Disponibilidade das ações pelo status atual
  const canComplementar = ['emitida', 'aprovada', 'paga'].includes(measurement.status);
  const canRetificar    = ['emitida', 'aprovada', 'paga'].includes(measurement.status);
  const canCancelar     = !['aprovada', 'paga', 'cancelada', 'retificada'].includes(measurement.status);

  // Se nenhuma ação disponível, não mostra o botão
  if (!canComplementar && !canRetificar && !canCancelar) return null;

  return (
    <>
      <div ref={ref} className="relative">
        <Button variant="outline" onClick={() => setOpen((v) => !v)} title="Ações sobre o boletim">
          <MoreHorizontal className="h-4 w-4" />
          Ações
        </Button>
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-border-dark dark:bg-card-dark">
            <div className="border-b border-slate-100 px-4 py-2 dark:border-border-dark">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Ciclo de vida do boletim
              </p>
            </div>
            <button type="button" disabled={!canComplementar}
              onClick={() => { setOpen(false); setAction('complementar'); }}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-muted-dark"
            >
              <FilePlus className="mt-0.5 h-4 w-4 text-navy dark:text-purple-300" />
              <div>
                <p className="text-sm font-semibold dark:text-slate-100">Criar boletim complementar</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Novo período, mesmo número, complementar n+1. {!canComplementar && '— exige medição emitida/aprovada/paga'}
                </p>
              </div>
            </button>
            <button type="button" disabled={!canRetificar}
              onClick={() => { setOpen(false); setAction('retificacao'); }}
              className="flex w-full items-start gap-3 border-t border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border-dark dark:hover:bg-muted-dark"
            >
              <RefreshCcw className="mt-0.5 h-4 w-4 text-yellow-700 dark:text-yellow-300" />
              <div>
                <p className="text-sm font-semibold dark:text-slate-100">Abrir retificação</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Copia itens do boletim atual para correção. Pai vira "retificada". {!canRetificar && '— exige medição emitida/aprovada/paga'}
                </p>
              </div>
            </button>
            <button type="button" disabled={!canCancelar}
              onClick={() => { setOpen(false); setAction('cancelar'); }}
              className="flex w-full items-start gap-3 border-t border-slate-100 px-4 py-3 text-left transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border-dark dark:hover:bg-error/10"
            >
              <XCircle className="mt-0.5 h-4 w-4 text-error" />
              <div>
                <p className="text-sm font-semibold text-error">Cancelar boletim</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Marca como cancelada. {!canCancelar && '— não disponível para aprovada/paga/cancelada/retificada'}
                </p>
              </div>
            </button>
          </div>
        )}
      </div>

      {action === 'complementar' && (
        <ComplementarModal measurement={measurement} onClose={() => setAction(null)} onSaved={onMutated} />
      )}
      {action === 'retificacao' && (
        <RetificacaoModal measurement={measurement} onClose={() => setAction(null)} onSaved={onMutated} />
      )}
      {action === 'cancelar' && (
        <CancelModal measurement={measurement} onClose={() => setAction(null)} onSaved={onMutated} />
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Modal: complementar
// -----------------------------------------------------------------------------
function ComplementarModal({ measurement, onClose, onSaved }: {
  measurement: MeasurementForMenu;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Default: próximo mês após o período atual
  const defaultInicio = nextMonthStart(measurement.periodo_fim);
  const defaultFim    = lastDayOfMonth(defaultInicio);
  const [inicio, setInicio] = useState(defaultInicio);
  const [fim, setFim]       = useState(defaultFim);
  const [observacao, setObservacao] = useState('');
  const [err, setErr]       = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createComplementarMeasurement({
      parent_id: measurement.id, periodo_inicio: inicio, periodo_fim: fim, observacao: observacao.trim() || undefined,
    }),
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['measurements', measurement.contract_id] });
      onSaved?.();
      onClose();
      navigate(`/contratos/${measurement.contract_id}/medicoes/${newId}`);
    },
    onError: (e) => setErr(humanizeError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!inicio || !fim) { setErr('Informe início e fim do período'); return; }
    if (fim < inicio) { setErr('Fim não pode ser anterior ao início'); return; }
    create.mutate();
  }

  return (
    <Modal open onClose={onClose}
      title={`Boletim complementar — base na medição ${measurement.numero}${measurement.complementar_numero ? `.${measurement.complementar_numero}` : ''}`}
      subtitle="Cria um novo boletim vinculado, com período próprio, para faturar serviços não incluídos na medição original."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={create.isPending}><Save className="h-4 w-4" />Criar complementar</Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Período — início" required>
            <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="input" />
          </Field>
          <Field label="Período — fim" required>
            <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="input" />
          </Field>
        </div>
        <Field label="Observação (opcional)" hint="Contexto sobre o motivo da complementação (será gravado no snapshot da medição).">
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3}
            className="input min-h-[80px] resize-y"
            placeholder="Ex: Boletim complementar para faturar reforço estrutural P12 entregue após fechamento da medição mensal."
          />
        </Field>
        {err && <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">{err}</p>}
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Modal: retificação
// -----------------------------------------------------------------------------
function RetificacaoModal({ measurement, onClose, onSaved }: {
  measurement: MeasurementForMenu;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [justificativa, setJustificativa] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createRetificacaoMeasurement({ parent_id: measurement.id, justificativa: justificativa.trim() }),
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['measurements', measurement.contract_id] });
      qc.invalidateQueries({ queryKey: ['measurement', measurement.id] });
      onSaved?.();
      onClose();
      navigate(`/contratos/${measurement.contract_id}/medicoes/${newId}`);
    },
    onError: (e) => setErr(humanizeError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!justificativa.trim() || justificativa.trim().length < 10) {
      setErr('Justificativa obrigatória (mínimo 10 caracteres).');
      return;
    }
    create.mutate();
  }

  return (
    <Modal open onClose={onClose}
      title={`Retificar medição ${measurement.numero}${measurement.complementar_numero ? `.${measurement.complementar_numero}` : ''}`}
      subtitle="A medição atual será marcada como 'retificada' e um novo boletim com os mesmos itens será criado para edição."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={create.isPending}><RefreshCcw className="h-4 w-4" />Abrir retificação</Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border border-yellow-400/40 bg-yellow-50 px-3 py-2 text-xs text-yellow-900 dark:bg-yellow-900/10 dark:text-yellow-200">
          <strong>Atenção:</strong> esta operação é irreversível — depois de confirmada, a medição atual não poderá ser revertida ao status anterior. Os itens medidos serão copiados para o novo boletim, onde poderão ser corrigidos.
        </div>
        <Field label="Justificativa da retificação" required hint="Mínimo 10 caracteres. Obrigatória para fins de auditoria contratual.">
          <textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} rows={4}
            className="input min-h-[100px] resize-y"
            placeholder="Ex: Erro de cálculo no item 3.1 (Alvenaria) — quantidade lançada (520 m²) foi superior à área efetivamente executada (485 m²) conforme RDO 04/2025. Glosa será aplicada no boletim retificador."
          />
        </Field>
        {err && <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">{err}</p>}
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Modal: cancelar
// -----------------------------------------------------------------------------
function CancelModal({ measurement, onClose, onSaved }: {
  measurement: MeasurementForMenu;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const cancel = useMutation({
    mutationFn: () => cancelMeasurement({ id: measurement.id, motivo: motivo.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['measurements', measurement.contract_id] });
      qc.invalidateQueries({ queryKey: ['measurement', measurement.id] });
      onSaved?.();
      onClose();
    },
    onError: (e) => setErr(humanizeError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!motivo.trim() || motivo.trim().length < 5) {
      setErr('Motivo obrigatório (mínimo 5 caracteres).');
      return;
    }
    cancel.mutate();
  }

  return (
    <Modal open onClose={onClose}
      title={`Cancelar medição ${measurement.numero}${measurement.complementar_numero ? `.${measurement.complementar_numero}` : ''}`}
      subtitle="Marca o boletim como cancelado. A medição continua visível no histórico para auditoria."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Manter</Button>
          <Button onClick={submit} loading={cancel.isPending}
            className="!bg-error hover:!bg-error/90 !text-white">
            <XCircle className="h-4 w-4" />Cancelar boletim
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          <strong>Atenção:</strong> esta operação não pode ser desfeita pela interface. O cancelamento é registrado no histórico do contrato.
        </div>
        <Field label="Motivo do cancelamento" required hint="Mínimo 5 caracteres.">
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3}
            className="input min-h-[80px] resize-y"
            placeholder="Ex: Cancelada por engano — período correto está coberto pela medição 12."
          />
        </Field>
        {err && <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">{err}</p>}
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Helpers de data (sem dependência externa)
// -----------------------------------------------------------------------------
function nextMonthStart(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}
function lastDayOfMonth(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return d.toISOString().slice(0, 10);
}
