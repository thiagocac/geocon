import { Lock, Unlock, Tag, Percent, Trash2, X } from 'lucide-react';

interface Props {
  count: number;
  onLock: () => void;
  onUnlock: () => void;
  onSetDiscipline: () => void;
  onAdjustPrices: () => void;
  onSoftDelete: () => void;
  onClear: () => void;
}

/**
 * Barra sticky no fundo da viewport mostrando ações em massa quando há
 * itens selecionados na planilha SOV.
 */
export function SovBulkActionsBar({ count, onLock, onUnlock, onSetDiscipline, onAdjustPrices, onSoftDelete, onClear }: Props) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-full border border-navy-900/20 bg-navy-900 px-4 py-2 text-white shadow-elevated dark:border-magenta-700/40 dark:bg-card-dark">
        <span className="flex items-center gap-2 pr-2 text-sm font-medium">
          <span className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-full bg-magenta px-2 font-mono text-xs font-bold tabular text-white">
            {count}
          </span>
          {count === 1 ? 'item selecionado' : 'itens selecionados'}
        </span>

        <span className="h-5 w-px bg-white/20" />

        <button
          type="button"
          onClick={onLock}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-white/10"
          title="Bloquear itens selecionados"
        >
          <Lock className="h-3.5 w-3.5" />Bloquear
        </button>
        <button
          type="button"
          onClick={onUnlock}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-white/10"
          title="Desbloquear"
        >
          <Unlock className="h-3.5 w-3.5" />Desbloquear
        </button>
        <button
          type="button"
          onClick={onSetDiscipline}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-white/10"
          title="Trocar disciplina"
        >
          <Tag className="h-3.5 w-3.5" />Disciplina
        </button>
        <button
          type="button"
          onClick={onAdjustPrices}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-white/10"
          title="Ajustar preços por %"
        >
          <Percent className="h-3.5 w-3.5" />Ajustar preço
        </button>
        <button
          type="button"
          onClick={onSoftDelete}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/30"
          title="Excluir (soft-delete)"
        >
          <Trash2 className="h-3.5 w-3.5" />Excluir
        </button>

        <span className="h-5 w-px bg-white/20" />

        <button
          type="button"
          onClick={onClear}
          aria-label="Limpar seleção"
          className="flex h-7 w-7 items-center justify-center rounded-full opacity-60 hover:bg-white/10 hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
