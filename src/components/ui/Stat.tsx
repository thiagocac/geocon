import type { ReactNode } from 'react';
import { FileText, AlertCircle } from 'lucide-react';
import { Card } from './Card';

interface StatProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'navy' | 'purple' | 'magenta' | 'success' | 'warning' | 'error' | 'neutral';
  icon?: ReactNode;
}

const TONE_BAR: Record<NonNullable<StatProps['tone']>, string> = {
  navy:    'bg-navy',
  purple:  'bg-purple',
  magenta: 'bg-magenta',
  success: 'bg-success',
  warning: 'bg-warning',
  error:   'bg-error',
  neutral: 'bg-slate-300 dark:bg-slate-600',
};

export function Stat({ label, value, sub, tone = 'neutral', icon }: StatProps) {
  return (
    <Card className="overflow-hidden p-4" densityAware>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="truncate font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400"
            title={label}
          >
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900 tabular dark:text-slate-100">{value}</p>
          {sub && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
        </div>
        {icon && <div className="text-slate-400 dark:text-slate-500">{icon}</div>}
      </div>
      <div className={`-mb-4 -mx-4 mt-3 h-1 ${TONE_BAR[tone]}`} />
    </Card>
  );
}

interface EmptyProps {
  title: string;
  body?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function Empty({ title, body, icon, action }: EmptyProps) {
  return (
    <Card className="px-6 py-12 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-muted-dark">
        {icon || <FileText className="h-6 w-6 text-slate-500 dark:text-slate-400" />}
      </div>
      <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {body && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Card>
  );
}

export function ErrorState({ title = 'Erro ao carregar', message }: { title?: string; message: string }) {
  return (
    <Card className="px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
        <AlertCircle className="h-6 w-6 text-error" />
      </div>
      <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>
    </Card>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700 ${className}`} />;
}

export function Progress({ value }: { value: number }) {
  const clamped = Math.min(Math.max(value, 0), 100);
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
      <div
        className="h-full rounded-full bg-gradient-to-r from-navy via-purple to-magenta transition-all"
        style={{ width: `${clamped}%` }}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}
