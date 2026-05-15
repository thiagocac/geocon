import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, error, required, children, className = '' }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="label">
        {label}
        {required && <span className="ml-1 text-error">*</span>}
      </label>
      <div className="mt-1">{children}</div>
      {hint && !error && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-error">{error}</p>}
    </div>
  );
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  className?: string;
}

export function Select({ options, placeholder, className = '', ...rest }: SelectProps) {
  return (
    <select className={`input ${className}`} {...rest}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}
