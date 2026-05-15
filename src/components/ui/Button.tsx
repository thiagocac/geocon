import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

const VARIANT_CLS: Record<Variant, string> = {
  primary:   'bg-navy text-white hover:bg-navy-900',
  secondary: 'bg-purple text-white hover:bg-purple-800',
  outline:   'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-border-dark dark:bg-card-dark dark:text-slate-200 dark:hover:bg-muted-dark',
  ghost:     'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-muted-dark',
  danger:    'bg-error text-white hover:bg-red-700',
};

const SIZE_CLS: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-navy focus:ring-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANT_CLS[variant],
        SIZE_CLS[size],
        className,
      ].join(' ')}
    >
      {loading && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
          <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  );
}
