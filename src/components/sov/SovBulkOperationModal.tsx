import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  bulkLockItems, bulkSetDiscipline, bulkAdjustPrices, bulkSoftDeleteItems,
  listDisciplines, type BulkResult,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { Modal } from '../ui/Modal';
import { Field, Select } from '../ui/FormField';
import { Button } from '../ui/Button';

type Op = 'lock' | 'unlock' | 'set_discipline' | 'adjust_prices' | 'soft_delete';

interface Props {
  op: Op | null;
  itemIds: string[];
  contractId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const OP_META: Record<Op, { title: string; cta: string; danger?: boolean; needsMotivo?: boolean; description: string }> = {
  lock:           { title: 'Bloquear itens',       cta: 'Bloquear',  description: 'Itens bloqueados não podem ser editados, mas continuam disponíveis para medição.' },
  unlock:         { title: 'Desbloquear itens',    cta: 'Desbloquear', description: 'Itens voltam a aceitar edição (quantidade, preço, disciplina).' },
  set_discipline: { title: 'Trocar disciplina',    cta: 'Aplicar disciplina', description: 'Reatribui a disciplina dos itens selecionados. Itens bloqueados são ignorados.' },
  adjust_prices:  { title: 'Ajustar preços (%)',   cta: 'Aplicar ajuste', needsMotivo: true, description: 'Aplica fator percentual no preço unitário. Itens bloqueados ou já medidos são preservados (não permitido alterar preço pós-medição).' },
  soft_delete:    { title: 'Excluir itens',        cta: 'Excluir', danger: true, needsMotivo: true, description: 'Exclusão soft: itens são removidos da planilha mas podem ser restaurados via auditoria. Itens bloqueados ou referenciados por medições são preservados.' },
};

export function SovBulkOperationModal({ op, itemIds, contractId, onClose, onSuccess }: Props) {
  // Estado local para campos do form
  const [motivo, setMotivo] = useState('');
  const [discId, setDiscId] = useState<string>('');
  const [factor, setFactor] = useState('1.05');
  const [factorMode, setFactorMode] = useState<'increase' | 'decrease' | 'custom'>('increase');
  const [factorPct, setFactorPct] = useState('5');
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset state ao abrir um novo op
  useEffect(() => {
    setMotivo('');
    setDiscId('');
    setFactor('1.05');
    setFactorMode('increase');
    setFactorPct('5');
    setResult(null);
    setError(null);
  }, [op]);

  const { data: disciplines = [] } = useQuery({
    queryKey: ['disciplines'],
    queryFn: listDisciplines,
    enabled: op === 'set_discipline',
  });

  const mut = useMutation({
    mutationFn: async () => {
      setError(null);
      switch (op!) {
        case 'lock':           return bulkLockItems(itemIds, true, motivo || undefined);
        case 'unlock':         return bulkLockItems(itemIds, false, motivo || undefined);
        case 'set_discipline': return bulkSetDiscipline(itemIds, discId || null);
        case 'adjust_prices': {
          const f = parseFloat(factor);
          return bulkAdjustPrices(itemIds, f, motivo);
        }
        case 'soft_delete':    return bulkSoftDeleteItems(itemIds, motivo);
      }
    },
    onSuccess: (r) => { setResult(r); },
    onError: (e) => setError(humanizeError(e as Error)),
  });

  // Calcula factor a partir do percentual + modo
  useEffect(() => {
    const p = parseFloat(factorPct);
    if (isNaN(p)) return;
    if (factorMode === 'increase')      setFactor((1 + p / 100).toFixed(4));
    else if (factorMode === 'decrease') setFactor((1 - p / 100).toFixed(4));
  }, [factorMode, factorPct]);

  if (!op) return null;
  const meta = OP_META[op];

  const motivoTooShort = meta.needsMotivo && motivo.trim().length < 5;
  const factorInvalid  = op === 'adjust_prices' && (parseFloat(factor) < 0.1 || parseFloat(factor) > 10);
  const canConfirm = !motivoTooShort && !factorInvalid && !result;

  return (
    <Modal
      open={!!op}
      onClose={onClose}
      title={meta.title}
      subtitle={`${itemIds.length} ${itemIds.length === 1 ? 'item selecionado' : 'itens selecionados'}`}
      size="md"
      footer={
        <>
          {result ? (
            <Button onClick={() => { onSuccess(); onClose(); }}>Fechar</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button
                variant={meta.danger ? 'danger' : 'primary'}
                onClick={() => mut.mutate()}
                loading={mut.isPending}
                disabled={!canConfirm}
              >
                {meta.cta}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {!result && (
          <div className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700 dark:bg-muted-dark dark:text-slate-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p>{meta.description}</p>
          </div>
        )}

        {!result && op === 'set_discipline' && (
          <Field label="Nova disciplina">
            <Select
              value={discId}
              onChange={(e) => setDiscId(e.target.value)}
              placeholder="— sem disciplina —"
              options={disciplines.map((d) => ({ value: d.id, label: d.nome }))}
            />
          </Field>
        )}

        {!result && op === 'adjust_prices' && (
          <>
            <Field label="Tipo de ajuste">
              <div className="flex flex-wrap gap-2">
                {[
                  { v: 'increase', label: 'Aumentar' },
                  { v: 'decrease', label: 'Descontar' },
                  { v: 'custom',   label: 'Fator livre' },
                ].map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setFactorMode(o.v as typeof factorMode)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                      factorMode === o.v
                        ? 'border-navy bg-navy text-white dark:border-purple dark:bg-purple'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-navy dark:border-border-dark dark:bg-card-dark dark:text-slate-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </Field>

            {factorMode !== 'custom' && (
              <Field label="Percentual" hint="0–100">
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={factorPct}
                    onChange={(e) => setFactorPct(e.target.value)}
                    className="input pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">%</span>
                </div>
              </Field>
            )}

            <Field label="Fator final" hint="Ex: 1.05 = +5% · 0.9 = -10%">
              <input
                type="number"
                step="0.0001"
                min="0.1"
                max="10"
                value={factor}
                onChange={(e) => { setFactor(e.target.value); setFactorMode('custom'); }}
                className={`input ${factorInvalid ? 'border-error' : ''}`}
              />
              {factorInvalid && <p className="mt-1 text-xs text-error">Permitido entre 0.1 e 10.0</p>}
            </Field>
          </>
        )}

        {!result && meta.needsMotivo && (
          <Field label="Motivo" required hint="Mín 5 caracteres — fica registrado na auditoria">
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              maxLength={200}
              placeholder="Ex: Reajuste contratual 2026 conforme cláusula 8.2"
              className="input"
            />
          </Field>
        )}

        {!result && (op === 'lock' || op === 'unlock') && (
          <Field label="Motivo (opcional)">
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={200}
              placeholder="Ex: Início de medição — congelar SOV"
              className="input"
            />
          </Field>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 p-2 text-sm text-error dark:bg-red-900/20">{error}</p>
        )}

        {result && (
          <div className="rounded-lg border border-success/30 bg-success/5 p-4">
            <div className="mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <p className="font-semibold text-success">Operação concluída</p>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Solicitados</dt>
                <dd className="font-mono font-semibold tabular dark:text-slate-200">{result.requested}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Afetados</dt>
                <dd className="font-mono font-semibold tabular text-success">{result.affected}</dd>
              </div>
              {(result.blocked_locked ?? 0) > 0 && (
                <div>
                  <dt className="text-xs text-slate-500">Bloqueados (locked)</dt>
                  <dd className="font-mono font-semibold tabular text-amber-600">{result.blocked_locked}</dd>
                </div>
              )}
              {(result.blocked_measured ?? 0) > 0 && (
                <div>
                  <dt className="text-xs text-slate-500">Bloqueados (medidos)</dt>
                  <dd className="font-mono font-semibold tabular text-amber-600">{result.blocked_measured}</dd>
                </div>
              )}
              {(result.skipped ?? 0) > 0 && (
                <div>
                  <dt className="text-xs text-slate-500">Já no estado</dt>
                  <dd className="font-mono font-semibold tabular text-slate-500">{result.skipped}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>
    </Modal>
  );
}
