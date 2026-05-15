import type { ReactNode } from 'react';

interface KickerProps {
  children: ReactNode;
  className?: string;
}

/**
 * Kicker — "o ritmo do produto" segundo o Consulte GEO DS.
 *
 * Aparece acima de quase todo título de página, todo card, todo grupo de campo,
 * toda seção de menu. Anatomia: mono · 10px · uppercase · tracking 0.18em · stone-500.
 */
export function Kicker({ children, className = '' }: KickerProps) {
  return (
    <p
      className={`font-mono text-[10px] font-semibold uppercase leading-none tracking-display text-slate-500 dark:text-slate-400 ${className}`}
    >
      {children}
    </p>
  );
}
