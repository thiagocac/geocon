import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkPlus, Star, Trash2, X } from 'lucide-react';
import { listMyFilterPresets, saveFilterPreset, deleteFilterPreset, type FilterPresetPage, type FilterPreset } from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/FormField';
import { Button } from '../ui/Button';

interface Props<F> {
  pageKey: FilterPresetPage;
  /** Filtros atuais — serão salvos quando o usuário clicar em "Salvar" */
  currentFilters: F;
  /** Aplica os filtros quando o usuário seleciona um preset */
  onApply: (filters: F) => void;
  /** Verdadeiro quando há filtros ativos no momento (controla o estado do botão Salvar) */
  hasActiveFilters?: boolean;
}

export function SavedFiltersBar<F>({
  pageKey, currentFilters, onApply, hasActiveFilters = true,
}: Props<F>) {
  const qc = useQueryClient();
  const [savingOpen, setSavingOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  const { data: presets = [], isLoading } = useQuery({
    queryKey: ['filter-presets', pageKey],
    queryFn: () => listMyFilterPresets(pageKey),
  });

  const saveMutation = useMutation({
    mutationFn: () => saveFilterPreset({
      page_key: pageKey,
      nome: presetName.trim(),
      filters: currentFilters as Record<string, unknown>,
      is_default: makeDefault,
    }),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['filter-presets', pageKey] });
      setSavingOpen(false);
      setPresetName('');
      setMakeDefault(false);
      setSaveError(null);
      setActivePresetId(saved.id);
    },
    onError: (e) => setSaveError(humanizeError(e as Error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFilterPreset(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['filter-presets', pageKey] });
    },
  });

  function applyPreset(p: FilterPreset) {
    onApply(p.filters as F);
    setActivePresetId(p.id);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {!isLoading && presets.length > 0 && (
          <>
            <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <Bookmark className="h-3.5 w-3.5" />
              Salvos:
            </span>
            {presets.map((p) => {
              const isActive = p.id === activePresetId;
              return (
                <div
                  key={p.id}
                  className={`group flex items-center gap-1 rounded-full border text-xs transition ${
                    isActive
                      ? 'border-navy bg-navy text-white dark:border-purple dark:bg-purple'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-navy hover:bg-slate-50 dark:border-border-dark dark:bg-card-dark dark:text-slate-200 dark:hover:border-purple dark:hover:bg-muted-dark'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => applyPreset(p)}
                    className="flex items-center gap-1 py-1 pl-3 pr-1.5 font-medium"
                  >
                    {p.is_default && <Star className={`h-3 w-3 ${isActive ? 'fill-yellow-300 text-yellow-300' : 'fill-yellow-500 text-yellow-500'}`} />}
                    <span>{p.nome}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Excluir o preset "${p.nome}"?`)) {
                        deleteMutation.mutate(p.id);
                        if (activePresetId === p.id) setActivePresetId(null);
                      }
                    }}
                    aria-label="Excluir preset"
                    className={`flex h-full items-center px-1.5 opacity-0 transition group-hover:opacity-100 ${
                      isActive ? 'hover:bg-white/20' : 'hover:bg-slate-100 dark:hover:bg-muted-dark'
                    }`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </>
        )}

        <button
          type="button"
          onClick={() => setSavingOpen(true)}
          disabled={!hasActiveFilters}
          title={hasActiveFilters ? 'Salvar os filtros atuais como preset' : 'Aplique algum filtro antes de salvar'}
          className="flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:border-navy hover:text-navy disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:border-purple dark:hover:text-purple-200"
        >
          <BookmarkPlus className="h-3.5 w-3.5" />Salvar filtros
        </button>
      </div>

      {savingOpen && (
        <Modal
          open={savingOpen}
          onClose={() => { setSavingOpen(false); setSaveError(null); }}
          title="Salvar filtros como preset"
          subtitle="Você poderá aplicar essa combinação de filtros com um clique"
          size="sm"
          footer={
            <>
              <Button variant="outline" onClick={() => setSavingOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => saveMutation.mutate()}
                loading={saveMutation.isPending}
                disabled={presetName.trim().length === 0}
              >
                Salvar preset
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Nome do preset" required>
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Ex: Pendências críticas da equipe"
                className="input"
                autoFocus
                maxLength={60}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              <span className="dark:text-slate-200">Aplicar automaticamente quando eu abrir esta página</span>
            </label>
            {saveError && <p className="rounded-lg bg-red-50 p-2 text-sm text-error dark:bg-red-900/20">{saveError}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * Hook utilitário: carrega o preset default da página e aplica via setter.
 * Use com onApply para inicializar filtros.
 */
export function useDefaultPreset<F>(
  pageKey: FilterPresetPage,
  apply: (filters: F) => void
) {
  useQuery({
    queryKey: ['filter-presets', pageKey, 'default'],
    queryFn: async () => {
      const presets = await listMyFilterPresets(pageKey);
      const def = presets.find((p) => p.is_default);
      if (def) apply(def.filters as F);
      return def || null;
    },
    staleTime: Infinity,
  });
}
