import type { ReactNode } from 'react';

type Tone = 'slate' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'magenta';
type Size = 'sm' | 'md';

interface StatusPillProps {
  children: ReactNode;
  tone?: Tone;
  size?: Size;
  className?: string;
}

const TONE_CLS: Record<Tone, { bg: string; fg: string; dot: string }> = {
  slate:   {
    bg:  'bg-slate-100 dark:bg-slate-800/50',
    fg:  'text-slate-700 dark:text-slate-300',
    dot: 'bg-slate-500',
  },
  blue:    {
    bg:  'bg-blue-50 dark:bg-blue-900/30',
    fg:  'text-blue-700 dark:text-blue-300',
    dot: 'bg-blue-500',
  },
  green:   {
    bg:  'bg-green-50 dark:bg-green-900/30',
    fg:  'text-green-700 dark:text-green-300',
    dot: 'bg-green-500',
  },
  yellow:  {
    bg:  'bg-yellow-50 dark:bg-yellow-900/30',
    fg:  'text-yellow-800 dark:text-yellow-200',
    dot: 'bg-yellow-500',
  },
  red:     {
    bg:  'bg-red-50 dark:bg-red-900/30',
    fg:  'text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
  },
  purple:  {
    bg:  'bg-purple-50 dark:bg-purple-900/30',
    fg:  'text-purple-700 dark:text-purple-300',
    dot: 'bg-purple-500',
  },
  magenta: {
    bg:  'bg-magenta-50 dark:bg-magenta-900/30',
    fg:  'text-magenta-700 dark:text-magenta-300',
    dot: 'bg-magenta',
  },
};

const SIZE_CLS: Record<Size, { padding: string; text: string; dot: string }> = {
  sm: { padding: 'px-2 py-0.5',  text: 'text-[10px]', dot: 'h-1.5 w-1.5' },
  md: { padding: 'px-2.5 py-1',  text: 'text-[11px]', dot: 'h-2 w-2' },
};

/**
 * StatusPill — anatomia DS Consulte GEO.
 * Mono · UPPERCASE · tracking-widest · dot colorido à esquerda.
 *
 * Usado para statuses do domínio (rascunho, em_aprovacao, aprovado, devolvido,
 * cancelado etc) — diferentemente de <Badge>, que é para counts/tags genéricos.
 */
export function StatusPill({ children, tone = 'slate', size = 'sm', className = '' }: StatusPillProps) {
  const t = TONE_CLS[tone];
  const s = SIZE_CLS[size];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded font-mono font-bold uppercase tracking-widest ${s.padding} ${s.text} ${t.bg} ${t.fg} ${className}`}
    >
      <span className={`shrink-0 rounded-full ${s.dot} ${t.dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}
