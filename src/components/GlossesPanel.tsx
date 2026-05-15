import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Scissors, Check, X } from 'lucide-react';
import {
  listItemGlosses, upsertItemGloss, deleteItemGloss, decideGloss,
  type ItemGloss,
} from '../lib/api';
import { brl } from '../lib/format';
import { humanizeError } from '../lib/errors';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Field, Select } from './ui/FormField';

interface MeasurementItemRef {
  id: string;
  codigo: string;
  descricao: string;
  valor_periodo?: number;
  quantidade_periodo?: number;
  preco_unitario_snapshot?: number;
}

const STATUS_TONE: Record<string, 'slate' | 'yellow' | 'green' | 'red'> = {
  pendente:  'yellow',
  aplicada:  'green',
  cancelada: 'slate',
};

export function GlossesPanel({ measurementId, items, readOnly = false }: {
  measurementId: string;
  items: MeasurementItemRef[];
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ItemGloss | 'new' | null>(null);

  const { data: glosses = [], isLoading } = useQuery({
    queryKey: ['glosses', measurementId],
    queryFn: () => listItemGlosses(measurementId),
    enabled: !!measurementId,
  });

  const remove = useMutation({
    mutationFn: deleteItemGloss,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['glosses', measurementId] }),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'aplicada' | 'cancelada' }) => decideGloss(id, decision),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['glosses', measurementId] }),
  });

  const totalAplicado = glosses.filter((g) => g.status === 'aplicada').reduce((s, g) => s + Number(g.valor_glosado || 0), 0);
  const totalPendente = glosses.filter((g) => g.status === 'pendente').reduce((s, g) => s + Number(g.valor_glosado || 0), 0);

  return (
    <Card className="overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-border-dark">
        <div>
          <div className="flex items-center gap-2">
            <Scissors className="h-4 w-4 text-error" />
            <h3 className="font-semibold dark:text-slate-100">Glosas</h3>
            <Badge tone="slate">{glosses.length}</Badge>
          </div>
          <div className="mt-1 flex gap-3 text-xs text-slate-500">
            <span>Aplicado: <span className="font-medium text-error">{brl(totalAplicado)}</span></span>
            {totalPendente > 0 && <span>Pendente: <span className="font-medium text-yellow-700 dark:text-yellow-300">{brl(totalPendente)}</span></span>}
          </div>
        </div>
        {!readOnly && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" />Nova glosa
          </Button>
        )}
      </header>

      {isLoading && <p className="px-5 py-6 text-center text-sm text-slate-500">Carregando…</p>}
      {!isLoading && glosses.length === 0 && (
        <p className="px-5 py-6 text-center text-sm text-slate-500">Nenhuma glosa cadastrada.</p>
      )}
      {glosses.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-border-dark">
          {glosses.map((g) => (
            <li key={g.id} className="px-5 py-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {g.measurement_items ? (
                      <>
                        <span className="font-mono text-xs text-slate-500">{g.measurement_items.codigo}</span>
                        <span className="font-medium dark:text-slate-100 truncate">{g.measurement_items.descricao}</span>
                      </>
                    ) : (
                      <Badge tone="purple">glosa geral</Badge>
                    )}
                    <Badge tone={STATUS_TONE[g.status] || 'slate'}>{g.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{g.justificativa}</p>
                  {g.quantidade_glosada && Number(g.quantidade_glosada) > 0 && (
                    <p className="mt-0.5 text-xs text-slate-500">Quantidade glosada: <span className="font-mono">{g.quantidade_glosada}</span></p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-mono tabular text-base font-semibold text-error">{brl(g.valor_glosado)}</span>
                  {!readOnly && (
                    <div className="flex gap-1">
                      {g.status === 'pendente' && (
                        <>
                          <button
                            type="button"
                            onClick={() => decide.mutate({ id: g.id, decision: 'aplicada' })}
                            className="rounded p-1 text-slate-400 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-900/20"
                            title="Aplicar glosa"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => decide.mutate({ id: g.id, decision: 'cancelada' })}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-muted-dark"
                            title="Cancelar glosa"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => { if (confirm('Remover esta glosa?')) remove.mutate(g.id); }}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-error dark:hover:bg-muted-dark"
                        title="Remover"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <GlossEditModal
          gloss={editing === 'new' ? null : editing}
          measurementId={measurementId}
          items={items}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['glosses', measurementId] }); }}
        />
      )}
    </Card>
  );
}

function GlossEditModal({ gloss, measurementId, items, onClose, onSaved }: {
  gloss: ItemGloss | null;
  measurementId: string;
  items: MeasurementItemRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !gloss;
  const [itemId, setItemId] = useState<string>(gloss?.measurement_item_id || '');
  const [valor, setValor] = useState<number>(gloss?.valor_glosado || 0);
  const [quantidade, setQuantidade] = useState<number | ''>(gloss?.quantidade_glosada ?? '');
  const [justificativa, setJustificativa] = useState(gloss?.justificativa || '');
  const [error, setError] = useState<string | null>(null);

  const selectedItem = items.find((i) => i.id === itemId);

  // Cálculo automático de valor a partir da quantidade × preço unitário
  function recalcByQty(qty: number) {
    setQuantidade(qty);
    if (selectedItem && selectedItem.preco_unitario_snapshot) {
      setValor(Number((qty * selectedItem.preco_unitario_snapshot).toFixed(2)));
    }
  }

  const save = useMutation({
    mutationFn: () => upsertItemGloss({
      id: gloss?.id,
      measurement_id: measurementId,
      measurement_item_id: itemId || null,
      valor_glosado: Number(valor) || 0,
      quantidade_glosada: quantidade === '' ? null : Number(quantidade),
      justificativa: justificativa.trim(),
    }),
    onSuccess: () => onSaved(),
    onError: (e) => setError(humanizeError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!justificativa.trim()) { setError('Justificativa é obrigatória'); return; }
    if (!valor || valor <= 0) { setError('Valor glosado deve ser positivo'); return; }
    if (selectedItem && valor > (selectedItem.valor_periodo || 0)) {
      if (!confirm(`Valor glosado (${brl(valor)}) é maior que o valor do item (${brl(selectedItem.valor_periodo || 0)}). Prosseguir mesmo assim?`)) return;
    }
    save.mutate();
  }

  return (
    <Modal
      open onClose={onClose}
      title={isNew ? 'Nova glosa' : 'Editar glosa'}
      subtitle="Glosa pontual em um item ou geral na medição."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={save.isPending}><Save className="h-4 w-4" />Salvar</Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Item alvo" hint="Deixe vazio para registrar como glosa geral da medição">
          <Select
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            placeholder="— Glosa geral —"
            options={items.map((i) => ({ value: i.id, label: `${i.codigo} — ${i.descricao.slice(0, 60)}` }))}
          />
          {selectedItem && (
            <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-muted-dark">
              <div className="text-slate-500">Valor do item no período: <span className="font-mono text-slate-900 dark:text-slate-100">{brl(selectedItem.valor_periodo || 0)}</span></div>
              {selectedItem.preco_unitario_snapshot && (
                <div className="text-slate-500">Preço unitário: <span className="font-mono text-slate-900 dark:text-slate-100">{brl(selectedItem.preco_unitario_snapshot)}</span></div>
              )}
            </div>
          )}
        </Field>

        {selectedItem && (
          <Field label="Quantidade glosada (opcional)" hint="Se informado, o valor é calculado automaticamente: qty × preço unitário">
            <input
              type="number" step="0.000001" min="0"
              value={quantidade}
              onChange={(e) => recalcByQty(Number(e.target.value))}
              className="input tabular"
              placeholder="0,000000"
            />
          </Field>
        )}

        <Field label="Valor glosado (R$)" required>
          <input
            type="number" step="0.01" min="0"
            value={valor}
            onChange={(e) => setValor(Number(e.target.value))}
            className="input tabular"
          />
        </Field>

        <Field label="Justificativa" required hint="Descreva o motivo da glosa (obrigatório para auditoria)">
          <textarea
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            rows={4}
            className="input min-h-[80px] resize-y"
            placeholder="Ex: Quantidade lançada (50 m³) superior à verificada em campo (42 m³). Glosa de 8 m³ × R$ 124,00 = R$ 992,00."
          />
        </Field>

        {error && <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">{error}</p>}
      </form>
    </Modal>
  );
}
