import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const SIZE_CLS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className={`relative w-full ${SIZE_CLS[size]} max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-card-dark`}>
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4 dark:border-border-dark">
          <div className="min-w-0">
            <h2 className="font-bold text-slate-900 dark:text-slate-100">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <button
            type="button" onClick={onClose} aria-label="Fechar"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-muted-dark"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: 'calc(90vh - 8rem)' }}>{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-3 dark:border-border-dark">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
