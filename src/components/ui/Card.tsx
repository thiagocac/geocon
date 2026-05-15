import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
  /** Quando true, o padding interno responde ao modo de densidade global (data-density). */
  densityAware?: boolean;
}

export function Card({ children, className = '', as: Tag = 'div', densityAware = false }: CardProps) {
  const densityAttr = densityAware ? { 'data-density-pad': true } : {};
  return (
    <Tag className={`surface ${className}`} {...densityAttr}>
      {children}
    </Tag>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  kicker?: string;
  actions?: ReactNode;
}

export function CardHeader({ title, subtitle, kicker, actions }: CardHeaderProps) {
  return (
    <div className="flex flex-col gap-1 border-b border-slate-100 px-5 py-4 dark:border-border-dark md:flex-row md:items-center md:justify-between">
      <div>
        {kicker && (
          <p className="mb-1 font-mono text-[10px] font-semibold uppercase leading-none tracking-display text-slate-500 dark:text-slate-400">{kicker}</p>
        )}
        <h2 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}
