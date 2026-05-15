import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}

export function Card({ children, className = '', as: Tag = 'div' }: CardProps) {
  return (
    <Tag className={`surface ${className}`}>
      {children}
    </Tag>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function CardHeader({ title, subtitle, actions }: CardHeaderProps) {
  return (
    <div className="flex flex-col gap-1 border-b border-slate-100 px-5 py-4 dark:border-border-dark md:flex-row md:items-center md:justify-between">
      <div>
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
