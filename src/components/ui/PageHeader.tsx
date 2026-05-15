import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  backTo?: string;
  backLabel?: string;
}

export function PageHeader({ title, subtitle, actions, backTo, backLabel }: PageHeaderProps) {
  return (
    <div className="mb-6">
      {backTo && (
        <Link
          to={backTo}
          className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-navy dark:text-slate-400 dark:hover:text-slate-200"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {backLabel || 'Voltar'}
        </Link>
      )}
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-navy dark:text-slate-400 dark:hover:text-slate-200"
    >
      <ChevronLeft className="h-3.5 w-3.5" />
      {children}
    </Link>
  );
}
