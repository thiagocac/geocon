import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Layout } from '../layout/Layout';
import { PageHeader } from '../ui/PageHeader';
import { Card } from '../ui/Card';
import { Skeleton, ErrorState, Empty } from '../ui/Stat';

interface Props {
  /** Texto do kicker acima do título (DS) */
  kicker?: string;
  /** Título principal */
  title: string;
  /** Subtítulo descritivo */
  subtitle?: string;
  /** Botões de ação no header (ex: "Novo item") */
  actions?: ReactNode;
  /** Link "Voltar" no topo */
  backTo?: string;
  backLabel?: string;

  /** Searchbar — quando omitida, não renderiza */
  searchTerm?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;

  /** Filtros customizados na barra (ao lado do search) */
  filters?: ReactNode;

  /** SavedFiltersBar ou outra row antes do conteúdo */
  toolbar?: ReactNode;

  /** Estados */
  loading?: boolean;
  error?: Error | null;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  emptyAction?: ReactNode;

  /** Conteúdo principal (table, grid, etc) */
  children: ReactNode;
}

/**
 * AdminListPage — template canônico para páginas de listagem admin/operacionais.
 * Encapsula: Layout + PageHeader (com kicker) + searchbar + filtros + toolbar +
 * tratamento de loading/error/empty + conteúdo.
 *
 * Reduz boilerplate em ~50 linhas por página vs montar manualmente.
 */
export function AdminListPage({
  kicker, title, subtitle, actions, backTo, backLabel,
  searchTerm, onSearchChange, searchPlaceholder,
  filters, toolbar,
  loading, error, isEmpty, emptyTitle, emptyBody, emptyAction,
  children,
}: Props) {
  const hasSearchbar = onSearchChange !== undefined;

  return (
    <Layout>
      <PageHeader
        kicker={kicker}
        title={title}
        subtitle={subtitle}
        actions={actions}
        backTo={backTo}
        backLabel={backLabel}
      />

      {toolbar && <div className="mb-3">{toolbar}</div>}

      {(hasSearchbar || filters) && (
        <Card className="mb-4 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            {hasSearchbar && (
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={searchTerm || ''}
                  onChange={(e) => onSearchChange!(e.target.value)}
                  placeholder={searchPlaceholder || 'Buscar…'}
                  className="input pl-10"
                />
              </div>
            )}
            {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
          </div>
        </Card>
      )}

      {error && <ErrorState message={error.message} />}
      {loading && <Card className="p-6"><Skeleton className="h-64" /></Card>}
      {!loading && !error && isEmpty && (
        <Empty
          title={emptyTitle || 'Sem registros'}
          body={emptyBody || 'Nenhum dado disponível.'}
          action={emptyAction}
        />
      )}
      {!loading && !error && !isEmpty && children}
    </Layout>
  );
}
