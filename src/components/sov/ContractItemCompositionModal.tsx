import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Calculator, HardHat, Package, Wrench, Briefcase, MoreHorizontal,
  Database, Calendar, AlertCircle, CheckCircle2, ArrowRight,
  Pencil, Plus, Trash2, X, Save,
} from 'lucide-react';
import {
  getContractItemComposition, applyCompositionPriceToItem,
  replaceCompositionLines,
  COMPOSITION_TIPO_LABELS,
  type CompositionLine, type CompositionLineTipo, type CompositionLineDraft,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { brl, num, dt } from '../../lib/format';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Skeleton, Empty } from '../ui/Stat';

/**
 * V66 — Modal de visualização da composição de preço de 1 contract_item.
 *
 * Aberto a partir do ContractSheet via botão "Composição" na coluna de ações.
 * Mostra:
 *   - Header: código, fonte (SINAPI/SICRO/etc), data_base
 *   - Linhas agrupadas por tipo (mão-de-obra / material / equipamento / terceiros / aux)
 *   - Subtotais por grupo + total sem BDI + total com BDI estimado
 *   - Botão "Aplicar preço calculado" → grava em contract_items.preco_unitario
 *
 * V66 é leitura + sync; edição inline fica para V67+ ou via import Excel.
 */
export function ContractItemCompositionModal({
  open, onClose, itemId, itemCodigo, itemDescricao, bdiPercentual = 0,
}: {
  open: boolean;
  onClose: () => void;
  itemId: string | null;
  itemCodigo?: string;
  itemDescricao?: string;
  bdiPercentual?: number;
}) {
  const qc = useQueryClient();
  const [applied, setApplied] = useState<{ preco_anterior: number; preco_novo: number } | null>(null);
  const [applyErr, setApplyErr] = useState<string | null>(null);

  // V69 — modo edição
  const [editing, setEditing]       = useState(false);
  const [draftLines, setDraftLines] = useState<CompositionLineDraft[]>([]);
  const [saveErr, setSaveErr]       = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['contract-item-composition', itemId],
    queryFn: () => getContractItemComposition(itemId!),
    enabled: open && !!itemId,
    staleTime: 30_000,
  });

  // Quando entra em modo edit, popula draft a partir do data carregado
  useEffect(() => {
    if (editing && data?.lines) {
      setDraftLines(data.lines.map((l) => ({
        ordem: l.ordem, tipo: l.tipo, codigo: l.codigo, descricao: l.descricao,
        unidade: l.unidade, coeficiente: l.coeficiente, preco_unitario: l.preco_unitario,
        observacao: l.observacao,
      })));
    }
  }, [editing, data?.lines]);

  const applyMut = useMutation({
    mutationFn: (compositionId: string) => applyCompositionPriceToItem(compositionId),
    onSuccess: (result) => {
      setApplied({ preco_anterior: result.preco_anterior, preco_novo: result.preco_novo });
      qc.invalidateQueries({ queryKey: ['items'] });  // SOV
      qc.invalidateQueries({ queryKey: ['contract-item-history', itemId] });
      setApplyErr(null);
    },
    onError: (e: Error) => setApplyErr(humanizeError(e)),
  });

  const saveMut = useMutation({
    mutationFn: (compositionId: string) => replaceCompositionLines(compositionId, draftLines),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contract-item-composition', itemId] });
      qc.invalidateQueries({ queryKey: ['price-divergence', itemId] });
      setEditing(false);
      setSaveErr(null);
    },
    onError: (e: Error) => setSaveErr(humanizeError(e)),
  });

  function handleClose() {
    setApplied(null);
    setApplyErr(null);
    setSaveErr(null);
    setEditing(false);
    setDraftLines([]);
    onClose();
  }

  function updateDraft(i: number, patch: Partial<CompositionLineDraft>) {
    setDraftLines((cur) => cur.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }
  function removeDraft(i: number) {
    setDraftLines((cur) => cur.filter((_, idx) => idx !== i));
  }
  function addDraft(tipo: CompositionLineTipo) {
    setDraftLines((cur) => [
      ...cur,
      { ordem: (cur[cur.length - 1]?.ordem ?? 0) + 1, tipo, codigo: null, descricao: 'Novo insumo', unidade: 'un', coeficiente: 1, preco_unitario: 0, observacao: null },
    ]);
  }

  const summary = data?.summary;
  const lines   = data?.lines || [];

  // Agrupa linhas por tipo, preservando ordem dos tipos relevantes
  const grouped = groupByTipo(lines);

  // Total com BDI = total_sem_bdi × (1 + bdi/100)
  const totalComBdi = summary
    ? summary.total_sem_bdi * (1 + (bdiPercentual || 0) / 100)
    : 0;

  return (
    <Modal open={open} onClose={handleClose} title="Composição de preço">
      {itemCodigo && (
        <p className="mb-3 flex items-baseline gap-2 text-sm">
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{itemCodigo}</span>
          {itemDescricao && (
            <span className="truncate text-slate-700 dark:text-slate-300" title={itemDescricao}>{itemDescricao}</span>
          )}
        </p>
      )}

      {isLoading && <Skeleton className="h-48" />}

      {!isLoading && !summary && (
        <Empty
          title="Sem composição cadastrada"
          body="Este item não tem decomposição de preço. Você pode importar uma composição SINAPI/SICRO via Excel ou cadastrar manualmente (em breve)."
        />
      )}

      {!isLoading && summary && (
        <>
          {/* Header da composição */}
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-muted-dark/60">
            {summary.codigo_composicao && (
              <span className="flex items-center gap-1 font-mono text-xs text-slate-700 dark:text-slate-200">
                <Database className="h-3 w-3 text-navy dark:text-purple-300" />
                {summary.codigo_composicao}
              </span>
            )}
            <span className="rounded-full bg-navy/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-display text-navy dark:bg-purple-900/30 dark:text-purple-300">
              {summary.fonte}
            </span>
            {summary.data_base && (
              <span className="flex items-center gap-1 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                <Calendar className="h-3 w-3" />
                base {dt(summary.data_base)}
              </span>
            )}
            <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
              {summary.num_linhas} insumo{summary.num_linhas === 1 ? '' : 's'}
            </span>
          </div>

          {summary.observacao && (
            <p className="mb-3 text-xs italic text-slate-600 dark:text-slate-400">
              {summary.observacao}
            </p>
          )}

          {/* Linhas por grupo */}
          <div className="-mx-5 max-h-[50vh] overflow-y-auto scrollbar-thin">
            {editing
              ? <EditableLines draft={draftLines} onUpdate={updateDraft} onRemove={removeDraft} onAdd={addDraft} />
              : grouped.map(({ tipo, items, subtotal }) => (
                  <CompositionGroup key={tipo} tipo={tipo} items={items} subtotal={subtotal} />
                ))
            }
          </div>

          {/* Totais — calculados sobre draft em modo edit */}
          {!editing && (
          <div className="mt-4 space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-border-dark dark:bg-muted-dark/40">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-300">Subtotal (sem BDI)</span>
              <span className="font-mono tabular text-base font-semibold dark:text-slate-100">
                {brl(summary.total_sem_bdi)}
              </span>
            </div>
            {bdiPercentual > 0 && (
              <>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">
                    BDI ({bdiPercentual.toFixed(2)}%)
                  </span>
                  <span className="font-mono tabular text-slate-500 dark:text-slate-400">
                    + {brl(summary.total_sem_bdi * bdiPercentual / 100)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between border-t border-slate-200 pt-1 text-base dark:border-border-dark">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">Total com BDI</span>
                  <span className="font-mono tabular text-lg font-bold text-success">
                    {brl(totalComBdi)}
                  </span>
                </div>
              </>
            )}
          </div>
          )}

          {/* Total preview em modo edit */}
          {editing && (
          <div className="mt-4 space-y-1 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-display text-warning">Preview do total (não salvo)</p>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-300">Novo subtotal (sem BDI)</span>
              <span className="font-mono tabular text-base font-semibold dark:text-slate-100">
                {brl(draftLines.reduce((a, b) => a + b.coeficiente * b.preco_unitario, 0))}
              </span>
            </div>
          </div>
          )}

          {/* Sync feedback */}
          {applied && (
            <div className="mt-3 rounded-lg bg-success/10 px-4 py-3">
              <p className="flex items-start gap-2 text-sm text-success">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Preço sincronizado: {brl(applied.preco_anterior)}
                  <ArrowRight className="mx-1 inline h-3 w-3" />
                  {brl(applied.preco_novo)}
                </span>
              </p>
            </div>
          )}
          {applyErr && (
            <p className="mt-3 flex items-start gap-1 text-xs text-error">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />{applyErr}
            </p>
          )}

          {saveErr && (
            <p className="mt-3 flex items-start gap-1 text-xs text-error">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />{saveErr}
            </p>
          )}

          {/* Botões */}
          {!applied && (
            <div className="mt-4 flex items-center justify-between gap-2">
              {editing ? (
                <>
                  <Button variant="ghost" onClick={() => { setEditing(false); setDraftLines([]); setSaveErr(null); }}>
                    <X className="h-4 w-4" />Cancelar
                  </Button>
                  <Button
                    onClick={() => saveMut.mutate(summary.id)}
                    loading={saveMut.isPending}
                    disabled={draftLines.length === 0}
                    title="Substitui todas as linhas da composição"
                  >
                    <Save className="h-4 w-4" />
                    Salvar {draftLines.length} linha{draftLines.length === 1 ? '' : 's'}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    <Pencil className="h-4 w-4" />Editar linhas
                  </Button>
                  <Button
                    onClick={() => applyMut.mutate(summary.id)}
                    loading={applyMut.isPending}
                    title="Atualiza o preço unitário do item com o valor calculado pela composição × (1 + BDI)"
                  >
                    <Calculator className="h-4 w-4" />
                    Aplicar preço calculado
                  </Button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

// =============================================================================
// V69 — Editor inline de linhas
// =============================================================================

function EditableLines({
  draft, onUpdate, onRemove, onAdd,
}: {
  draft: CompositionLineDraft[];
  onUpdate: (i: number, patch: Partial<CompositionLineDraft>) => void;
  onRemove: (i: number) => void;
  onAdd: (tipo: CompositionLineTipo) => void;
}) {
  const tiposOrder: CompositionLineTipo[] = ['mao_obra', 'material', 'equipamento', 'servico_terceiro', 'consumo_auxiliar'];
  // Mantém índice original para callbacks
  const grouped = tiposOrder.map((tipo) => ({
    tipo,
    items: draft.map((l, i) => ({ line: l, originalIndex: i })).filter((x) => x.line.tipo === tipo),
  }));

  return (
    <div className="space-y-1">
      {grouped.map(({ tipo, items }) => (
        <section key={tipo} className="border-t border-slate-100 first:border-t-0 dark:border-border-dark">
          <header className="flex items-center justify-between bg-slate-50 px-5 py-1.5 dark:bg-muted-dark/40">
            <h3 className="font-mono text-[10px] uppercase tracking-display text-slate-600 dark:text-slate-300">
              {COMPOSITION_TIPO_LABELS[tipo]}
            </h3>
            <button
              type="button"
              onClick={() => onAdd(tipo)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-display text-navy hover:bg-navy/10 dark:text-purple-300 dark:hover:bg-purple-900/30"
            >
              <Plus className="h-3 w-3" />Adicionar
            </button>
          </header>
          {items.map(({ line, originalIndex }) => (
            <div key={originalIndex} className="grid grid-cols-12 items-baseline gap-2 px-5 py-2 hover:bg-slate-50/50 dark:hover:bg-muted-dark/30">
              <input
                value={line.codigo || ''}
                onChange={(e) => onUpdate(originalIndex, { codigo: e.target.value || null })}
                placeholder="código"
                className="col-span-2 rounded border border-slate-200 px-2 py-1 font-mono text-xs dark:border-border-dark dark:bg-card-dark"
              />
              <input
                value={line.descricao}
                onChange={(e) => onUpdate(originalIndex, { descricao: e.target.value })}
                placeholder="Descrição"
                className="col-span-5 rounded border border-slate-200 px-2 py-1 text-sm dark:border-border-dark dark:bg-card-dark"
              />
              <input
                value={line.unidade}
                onChange={(e) => onUpdate(originalIndex, { unidade: e.target.value })}
                placeholder="un"
                className="col-span-1 rounded border border-slate-200 px-2 py-1 text-center text-xs dark:border-border-dark dark:bg-card-dark"
              />
              <input
                type="number" step="0.00000001"
                value={line.coeficiente}
                onChange={(e) => onUpdate(originalIndex, { coeficiente: parseFloat(e.target.value) || 0 })}
                placeholder="coef"
                className="col-span-1 rounded border border-slate-200 px-2 py-1 text-right font-mono tabular text-xs dark:border-border-dark dark:bg-card-dark"
              />
              <input
                type="number" step="0.000001"
                value={line.preco_unitario}
                onChange={(e) => onUpdate(originalIndex, { preco_unitario: parseFloat(e.target.value) || 0 })}
                placeholder="preço"
                className="col-span-2 rounded border border-slate-200 px-2 py-1 text-right font-mono tabular text-xs dark:border-border-dark dark:bg-card-dark"
              />
              <button
                type="button"
                onClick={() => onRemove(originalIndex)}
                className="col-span-1 text-slate-400 hover:text-error"
                title="Remover linha"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// =============================================================================
// Sub-componentes
// =============================================================================

const TIPO_ICONS: Record<CompositionLineTipo, React.ComponentType<{ className?: string }>> = {
  mao_obra:         HardHat,
  material:         Package,
  equipamento:      Wrench,
  servico_terceiro: Briefcase,
  consumo_auxiliar: MoreHorizontal,
};

const TIPO_ORDER: CompositionLineTipo[] = [
  'mao_obra', 'material', 'equipamento', 'servico_terceiro', 'consumo_auxiliar',
];

function groupByTipo(lines: CompositionLine[]): Array<{
  tipo: CompositionLineTipo;
  items: CompositionLine[];
  subtotal: number;
}> {
  const map = new Map<CompositionLineTipo, CompositionLine[]>();
  for (const l of lines) {
    if (!map.has(l.tipo)) map.set(l.tipo, []);
    map.get(l.tipo)!.push(l);
  }
  return TIPO_ORDER
    .filter((t) => map.has(t))
    .map((tipo) => {
      const items = (map.get(tipo) || []).sort((a, b) => a.ordem - b.ordem);
      const subtotal = items.reduce((acc, l) => acc + l.coeficiente * l.preco_unitario, 0);
      return { tipo, items, subtotal };
    });
}

function CompositionGroup({
  tipo, items, subtotal,
}: {
  tipo: CompositionLineTipo;
  items: CompositionLine[];
  subtotal: number;
}) {
  const Icon = TIPO_ICONS[tipo];
  return (
    <section className="border-t border-slate-100 first:border-t-0 dark:border-border-dark">
      <header className="flex items-center justify-between bg-slate-50 px-5 py-1.5 dark:bg-muted-dark/40">
        <h3 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-display text-slate-600 dark:text-slate-300">
          <Icon className="h-3 w-3 text-navy dark:text-purple-300" />
          {COMPOSITION_TIPO_LABELS[tipo]}
        </h3>
        <span className="font-mono tabular text-xs font-semibold text-slate-700 dark:text-slate-200">
          {brl(subtotal)}
        </span>
      </header>
      <ul className="divide-y divide-slate-100 dark:divide-border-dark">
        {items.map((line) => (
          <LineRow key={line.id} line={line} />
        ))}
      </ul>
    </section>
  );
}

function LineRow({ line }: { line: CompositionLine }) {
  const total = line.coeficiente * line.preco_unitario;
  return (
    <li className="px-5 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-slate-800 dark:text-slate-200" title={line.descricao}>
            {line.codigo && (
              <span className="mr-2 font-mono text-xs text-slate-500 dark:text-slate-400">{line.codigo}</span>
            )}
            {line.descricao}
          </p>
          {line.observacao && (
            <p className="mt-0.5 truncate text-xs italic text-slate-500 dark:text-slate-400" title={line.observacao}>
              {line.observacao}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono tabular text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-300">{num(line.coeficiente, 6)}</span>
            {' '}<span className="text-slate-400">{line.unidade}</span>
            {' × '}<span>{brl(line.preco_unitario)}</span>
          </p>
          <p className="font-mono tabular text-sm font-semibold text-slate-900 dark:text-slate-100">
            {brl(total)}
          </p>
        </div>
      </div>
    </li>
  );
}
