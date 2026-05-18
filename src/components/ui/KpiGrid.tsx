import type { ReactNode } from 'react';

/**
 * Layout responsivo para grids de KPIs:
 *   - mobile (≤640px):  2 colunas (compacto, 4 KPIs viram 2x2)
 *   - desktop (≥768px): N colunas conforme `cols`
 *
 * Substitui o padrão repetido `mb-4 grid gap-3 md:grid-cols-N` (V30-V39).
 *
 * Uso:
 *   <KpiGrid cols={4}>
 *     <KpiCard label="Total" value={42} />
 *     ...
 *   </KpiGrid>
 *
 * Para layouts customizados onde os filhos não são `KpiCard`, a div com classes
 * responsivas é suficiente — o componente é um simples wrapper de classes.
 */
interface KpiGridProps {
  children: ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
}

export function KpiGrid({ children, cols = 4, className = '' }: KpiGridProps) {
  // Pre-mapeia classes Tailwind (evita class names dinâmicos que JIT não vê)
  const colsClass =
    cols === 4 ? 'grid-cols-2 md:grid-cols-4' :
    cols === 3 ? 'grid-cols-2 md:grid-cols-3' :
                 'grid-cols-2';
  return (
    <div className={`mb-4 grid gap-2 sm:gap-3 ${colsClass} ${className}`}>
      {children}
    </div>
  );
}

/**
 * Card de KPI padronizado: label uppercase + valor grande + sublabel opcional.
 * Em mobile, padding e font sizes são reduzidos automaticamente.
 */
interface KpiCardProps {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  /** Cor do valor (default herda do tema) */
  valueTone?: 'default' | 'success' | 'error' | 'warning' | 'info';
  /** Ícone opcional ao lado do label */
  icon?: ReactNode;
  className?: string;
}

export function KpiCard({ label, value, sublabel, valueTone = 'default', icon, className = '' }: KpiCardProps) {
  const toneClass =
    valueTone === 'success' ? 'text-success' :
    valueTone === 'error'   ? 'text-error' :
    valueTone === 'warning' ? 'text-yellow-600 dark:text-yellow-300' :
    valueTone === 'info'    ? 'text-blue-600 dark:text-blue-300' :
                              'dark:text-slate-100';
  return (
    <div className={`surface p-3 sm:p-4 ${className}`} data-density-pad>
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="font-mono text-[9px] sm:text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400 line-clamp-1">
          {label}
        </p>
      </div>
      <p className={`mt-1 font-mono text-lg sm:text-2xl font-bold tabular ${toneClass}`}>
        {value}
      </p>
      {sublabel && (
        <p className="mt-0.5 font-mono text-[9px] sm:text-[10px] text-slate-500 line-clamp-1">
          {sublabel}
        </p>
      )}
    </div>
  );
}
