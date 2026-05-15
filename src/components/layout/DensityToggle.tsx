import { useEffect, useRef, useState } from 'react';
import { Rows3, Rows2, Square, Check } from 'lucide-react';
import { useDensity, type Density } from '../../hooks/useDensity';

const DENSITY_META: Array<{ value: Density; label: string; icon: typeof Rows3; hint: string }> = [
  { value: 'compact',     label: 'Compacto',    icon: Rows3,  hint: 'Mais info por tela · ideal para dashboards' },
  { value: 'comfortable', label: 'Confortável', icon: Rows2,  hint: 'Padrão · equilibrado para uso diário' },
  { value: 'spacious',    label: 'Espaçoso',    icon: Square, hint: 'Mais respiração · ideal para foco' },
];

export function DensityToggle() {
  const [density, setDensity] = useDensity();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Fecha ao clicar fora ou ESC
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const ActiveIcon = DENSITY_META.find((m) => m.value === density)?.icon || Rows2;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Densidade atual: ${density}. Clique para alterar.`}
        aria-expanded={open}
        title="Densidade visual"
        className="inline-flex h-10 min-w-[40px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-muted-dark"
      >
        <ActiveIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-elevated dark:border-border-dark dark:bg-card-dark"
        >
          <div className="border-b border-slate-100 px-4 py-2.5 dark:border-border-dark">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
              Densidade visual
            </p>
          </div>
          <div className="py-1">
            {DENSITY_META.map((m) => {
              const isActive = m.value === density;
              const Icon = m.icon;
              return (
                <button
                  key={m.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => {
                    setDensity(m.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-muted-dark ${
                    isActive ? 'bg-navy-50 dark:bg-navy-900/30' : ''
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? 'text-navy dark:text-magenta' : 'text-slate-500'}`} />
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${isActive ? 'text-navy dark:text-magenta' : 'text-slate-800 dark:text-slate-200'}`}>
                      {m.label}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{m.hint}</p>
                  </div>
                  {isActive && <Check className="h-4 w-4 text-navy dark:text-magenta" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
