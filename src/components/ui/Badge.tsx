import type { ReactNode } from 'react';
import type { BadgeTone } from '../../lib/status';

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const TONE_CLS: Record<BadgeTone, string> = {
  slate:   'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  blue:    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
  green:   'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200',
  yellow:  'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
  red:     'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  purple:  'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200',
  magenta: 'bg-magenta-100 text-magenta-700 dark:bg-magenta-900/40 dark:text-magenta-200',
};

export function Badge({ tone = 'slate', children, className = '' }: BadgeProps) {
  return (
    <span className={`badge ${TONE_CLS[tone]} ${className}`}>
      {children}
    </span>
  );
}
