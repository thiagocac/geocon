import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X, Users, ChevronDown, Check } from 'lucide-react';

export interface MemberOption {
  id: string;
  nome: string;
  email: string;
  cargo: string | null;
}

interface Props {
  options: MemberOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  loading?: boolean;
  maxVisible?: number;
}

/**
 * Combobox multi-select com search e chips visuais para membros.
 * Usado no Broadcast e em qualquer outro lugar que precise selecionar
 * múltiplos membros do tenant.
 */
export function MemberPicker({
  options, selectedIds, onChange,
  placeholder = 'Selecionar membros…', loading = false, maxVisible = 8,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((m) =>
      (m.nome || '').toLowerCase().includes(q) ||
      (m.email || '').toLowerCase().includes(q) ||
      (m.cargo || '').toLowerCase().includes(q)
    );
  }, [options, search]);

  const selectedSet = new Set(selectedIds);
  const selectedOptions = options.filter((o) => selectedSet.has(o.id));

  function toggle(id: string) {
    if (selectedSet.has(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  }
  function removeChip(id: string) {
    onChange(selectedIds.filter((x) => x !== id));
  }
  function clearAll() {
    onChange([]);
    setSearch('');
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input flex w-full items-center justify-between gap-2 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex flex-1 items-center gap-1.5 text-sm">
          <Users className="h-4 w-4 shrink-0 text-slate-400" />
          {selectedIds.length === 0
            ? <span className="text-slate-400">{placeholder}</span>
            : <span className="dark:text-slate-100">{selectedIds.length} {selectedIds.length === 1 ? 'membro selecionado' : 'membros selecionados'}</span>}
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {selectedOptions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {selectedOptions.slice(0, maxVisible).map((o) => (
            <span key={o.id}
              className="inline-flex items-center gap-1 rounded-full bg-magenta/15 px-2 py-0.5 text-xs font-medium text-magenta-700 dark:bg-magenta/25 dark:text-magenta-200">
              {o.nome}
              <button
                type="button"
                onClick={() => removeChip(o.id)}
                className="ml-0.5 rounded-full hover:bg-magenta/30"
                aria-label={`Remover ${o.nome}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {selectedOptions.length > maxVisible && (
            <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              + {selectedOptions.length - maxVisible}
            </span>
          )}
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-muted-dark"
          >
            <X className="h-3 w-3" />Limpar
          </button>
        </div>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-border-dark dark:bg-card-dark">
          <div className="border-b border-slate-100 p-2 dark:border-border-dark">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, e-mail ou cargo…"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-7 pr-2 text-sm dark:border-border-dark dark:bg-muted-dark dark:text-slate-200"
                autoFocus
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {loading && <p className="px-3 py-4 text-center text-xs text-slate-500">Carregando…</p>}
            {!loading && filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-slate-500">
                {search ? 'Nenhum membro encontrado.' : 'Sem membros no tenant.'}
              </p>
            )}
            {!loading && filtered.map((m) => {
              const isSel = selectedSet.has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-muted-dark/40 ${isSel ? 'bg-magenta/5 dark:bg-magenta/10' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium dark:text-slate-100">{m.nome}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {m.email}{m.cargo ? ` · ${m.cargo}` : ''}
                    </p>
                  </div>
                  {isSel && <Check className="h-4 w-4 shrink-0 text-magenta" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
