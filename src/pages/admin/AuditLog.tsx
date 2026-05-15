import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Filter, AlertCircle, AlertTriangle, Info, Search } from 'lucide-react';
import { listAuditLog, type AuditLogEntry } from '../../lib/api';
import { dtTime } from '../../lib/format';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Empty, Skeleton } from '../../components/ui/Stat';
import { Select } from '../../components/ui/FormField';

const ENTITY_TYPES = [
  'measurement', 'additive', 'contract', 'sov_version', 'unforeseen_item',
  'ged_document', 'ged_transmittal', 'measurement_approval_step', 'workflow_template',
];

const SEVERITY_TONE: Record<AuditLogEntry['severity'], 'slate' | 'yellow' | 'red'> = {
  info: 'slate', warn: 'yellow', error: 'red',
};

const SEVERITY_ICON: Record<AuditLogEntry['severity'], typeof Info> = {
  info: Info, warn: AlertTriangle, error: AlertCircle,
};

export function AdminAuditLog() {
  const [filterEntity, setFilterEntity] = useState<string>('');
  const [filterSeverity, setFilterSeverity] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['audit-log', filterEntity, filterSeverity],
    queryFn: () => listAuditLog({
      entity_type: filterEntity || null,
      severity: (filterSeverity as 'info' | 'warn' | 'error') || null,
      limit: 200,
    }),
  });

  const filtered = search
    ? entries.filter((e) =>
        e.action.toLowerCase().includes(search.toLowerCase()) ||
        e.entity_type.toLowerCase().includes(search.toLowerCase()) ||
        (e.actor?.nome ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (e.source ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : entries;

  function toggleExpand(id: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <Layout>
      <PageHeader
        title="Auditoria"
        subtitle="Trilha completa de alterações em entidades sensíveis (medições, aditivos, GED, workflows)."
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por ação, entidade, responsável ou origem…"
              className="input pl-10"
            />
          </div>
          <Select
            value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)}
            placeholder="Todas as entidades"
            options={ENTITY_TYPES.map((t) => ({ value: t, label: t }))}
          />
          <Select
            value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)}
            placeholder="Todas as severidades"
            options={[
              { value: 'info',  label: 'Info' },
              { value: 'warn',  label: 'Atenção' },
              { value: 'error', label: 'Erro' },
            ]}
          />
          <Button variant="outline" onClick={() => { setFilterEntity(''); setFilterSeverity(''); setSearch(''); }}>
            <Filter className="h-4 w-4" />Limpar
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Mostrando até 200 entradas mais recentes. {filtered.length !== entries.length && `${filtered.length} de ${entries.length} após busca.`}
        </p>
      </Card>

      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}
      {!isLoading && filtered.length === 0 && (
        <Empty title="Nenhuma entrada"
               body={search || filterEntity || filterSeverity
                 ? 'Nenhum resultado para os filtros aplicados.'
                 : 'A auditoria ainda não registrou eventos neste tenant.'}
               icon={<History className="h-6 w-6 text-slate-500 dark:text-slate-400" />} />
      )}

      {filtered.length > 0 && (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100 dark:divide-border-dark">
            {filtered.map((e) => {
              const Icon = SEVERITY_ICON[e.severity];
              const isExp = expanded.has(e.id);
              const hasDiff = e.before_value || e.after_value;
              return (
                <li key={e.id} className="px-5 py-3">
                  <div className="flex items-start gap-3">
                    <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                      e.severity === 'error' ? 'text-error' :
                      e.severity === 'warn' ? 'text-warning' : 'text-slate-500'
                    }`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{e.entity_type}</span>
                        <span className="font-medium dark:text-slate-100">{e.action}</span>
                        <Badge tone={SEVERITY_TONE[e.severity]}>{e.severity}</Badge>
                        {e.source && <span className="font-mono text-xs text-slate-400">via {e.source}</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500 dark:text-slate-400">
                        <span>{dtTime(e.created_at)}</span>
                        {e.actor ? <span>por <strong className="dark:text-slate-300">{e.actor.nome}</strong></span> : <span className="italic">sistema</span>}
                        {e.entity_id && <span className="font-mono">#{e.entity_id.slice(0, 8)}</span>}
                      </div>
                      {hasDiff && (
                        <button
                          type="button" onClick={() => toggleExpand(e.id)}
                          className="mt-1 text-xs text-navy hover:underline dark:text-purple-300"
                        >
                          {isExp ? 'Ocultar diff' : 'Ver diff'}
                        </button>
                      )}
                      {isExp && hasDiff && (
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {e.before_value && (
                            <div className="rounded-lg border border-red-200 bg-red-50/50 p-2 dark:border-red-900/40 dark:bg-red-900/10">
                              <p className="mb-1 text-xs font-bold uppercase tracking-wider text-error">Antes</p>
                              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-700 dark:text-slate-300">
{JSON.stringify(e.before_value, null, 2)}
                              </pre>
                            </div>
                          )}
                          {e.after_value && (
                            <div className="rounded-lg border border-green-200 bg-green-50/50 p-2 dark:border-green-900/40 dark:bg-green-900/10">
                              <p className="mb-1 text-xs font-bold uppercase tracking-wider text-success">Depois</p>
                              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-700 dark:text-slate-300">
{JSON.stringify(e.after_value, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                      {isExp && e.metadata && Object.keys(e.metadata).length > 0 && (
                        <div className="mt-2 rounded-lg bg-slate-50 p-2 dark:bg-muted-dark">
                          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Metadata</p>
                          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-700 dark:text-slate-300">
{JSON.stringify(e.metadata, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </Layout>
  );
}
