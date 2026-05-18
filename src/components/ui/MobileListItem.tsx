import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * Card-row pattern para substituir linhas de tabela em mobile.
 * Estrutura: linha de cabeçalho (badge/título) + corpo (chave-valor opcional) + ações.
 *
 * Usar dentro de `<div className="md:hidden">` para mostrar só em mobile, e a tabela
 * convencional dentro de `<div className="hidden md:block">`.
 *
 * @example
 *   <div className="md:hidden divide-y divide-slate-200 dark:divide-border-dark">
 *     {items.map(item => (
 *       <MobileListItem
 *         key={item.id}
 *         leadingBadge={<Badge tone={...}>{...}</Badge>}
 *         title="Aditivo #3"
 *         subtitle="valor · R$ 1.250.000"
 *         meta={[{ label: 'Aprovação', value: '15/03/2025' }, ...]}
 *         onClick={() => navigate(...)}
 *         actions={canEdit && <button>...</button>}
 *       />
 *     ))}
 *   </div>
 */
interface MobileListItemProps {
  /** Badge ou ícone à esquerda do título (status, tipo, severity) */
  leadingBadge?: ReactNode;
  /** Título principal */
  title: ReactNode;
  /** Subtítulo (linha 2) */
  subtitle?: ReactNode;
  /** Lista de pares chave-valor pra mostrar abaixo do subtítulo */
  meta?: Array<{ label: string; value: ReactNode }>;
  /** Conteúdo de actions à direita (botões inline) */
  actions?: ReactNode;
  /** Quando definido, todo o card vira clicável (sem renderizar como <button> pra não conflitar com actions internas) */
  onClick?: () => void;
  className?: string;
}

export function MobileListItem({
  leadingBadge, title, subtitle, meta, actions, onClick, className = '',
}: MobileListItemProps) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
      } : undefined}
      className={[
        'flex flex-col gap-2 px-3 py-3',
        clickable ? 'cursor-pointer hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-muted-dark/30 dark:active:bg-muted-dark/50' : '',
        className,
      ].join(' ')}
    >
      {/* Linha 1: badge + título + chevron */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            {leadingBadge}
            <p className="text-sm font-medium dark:text-slate-200 line-clamp-2">{title}</p>
          </div>
          {subtitle && (
            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{subtitle}</p>
          )}
        </div>
        {clickable && (
          <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-slate-400" />
        )}
      </div>

      {/* Linha 2: meta key-value */}
      {meta && meta.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {meta.map((m, i) => (
            <div key={i} className="min-w-0">
              <dt className="font-mono text-[10px] uppercase tracking-display text-slate-500">{m.label}</dt>
              <dd className="font-mono tabular text-slate-700 dark:text-slate-300 truncate">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Linha 3: actions */}
      {actions && (
        <div className="flex flex-wrap items-center gap-1 -mx-1 px-1 pt-1 border-t border-slate-100 dark:border-border-dark/50">
          {actions}
        </div>
      )}
    </div>
  );
}
