import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Filter, AlertCircle, AlertTriangle, Info, Search, Download, Calendar } from 'lucide-react';
import { listAuditLogRange, listAvailableMembers, type AuditLogEntry } from '../../lib/api';
import { dtTime } from '../../lib/format';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Empty, Skeleton } from '../../components/ui/Stat';
import { Select, Field } from '../../components/ui/FormField';
import { SavedFiltersBar, useDefaultPreset } from '../../components/filters/SavedFiltersBar';
import { AuditDiff } from '../../components/audit/AuditDiff';

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

function toCsvValue(v: unknown): string {
  if (v == null) return '';
  let s: string;
  if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  if (/[",\n\r;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => toCsvValue(r[h])).join(',')),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface AuditFilters {
  entity: string;
  severity: string;
  actor: string;
  date_from: string;
  date_to: string;
  search: string;
}

export function AdminAuditLog() {
  const [filterEntity, setFilterEntity] = useState<string>('');
  const [filterSeverity, setFilterSeverity] = useState<string>('');
  const [filterActor, setFilterActor] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [advanced, setAdvanced] = useState(false);

  useDefaultPreset<AuditFilters>('audit_log', (f) => {
    if (f.entity !== undefined)    setFilterEntity(String(f.entity));
    if (f.severity !== undefined)  setFilterSeverity(String(f.severity));
    if (f.actor !== undefined)     setFilterActor(String(f.actor));
    if (f.date_from !== undefined) setDateFrom(String(f.date_from));
    if (f.date_to !== undefined)   setDateTo(String(f.date_to));
    if (f.search !== undefined)    setSearch(String(f.search));
    if (f.date_from || f.date_to || f.actor) setAdvanced(true);
  });

  const { data: members = [] } = useQuery({
    queryKey: ['members-lite'],
    queryFn: listAvailableMembers,
  });

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['audit-log', filterEntity, filterSeverity, filterActor, dateFrom, dateTo],
    queryFn: () => listAuditLogRange({
      entity_type: filterEntity || null,
      severity: (filterSeverity as 'info' | 'warn' | 'error') || null,
      actor_id: filterActor || null,
      date_from: dateFrom ? new Date(dateFrom + 'T00:00:00').toISOString() : null,
      date_to:   dateTo   ? new Date(dateTo   + 'T23:59:59').toISOString() : null,
      limit: 500,
    }),
  });

  const filtered = useMemo(() => search
    ? entries.filter((e) =>
        e.action.toLowerCase().includes(search.toLowerCase()) ||
        e.entity_type.toLowerCase().includes(search.toLowerCase()) ||
        (e.actor?.nome ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (e.source ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : entries
  , [search, entries]);

  function toggleExpand(id: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setFilterEntity(''); setFilterSeverity(''); setFilterActor('');
    setDateFrom(''); setDateTo(''); setSearch('');
  }

  function exportCsv() {
    const rows = filtered.map((e) => ({
      created_at: e.created_at,
      entity_type: e.entity_type,
      entity_id: e.entity_id ?? '',
      action: e.action,
      severity: e.severity,
      actor_nome: e.actor?.nome ?? '',
      actor_email: e.actor?.email ?? '',
      source: e.source ?? '',
      before_value: e.before_value,
      after_value: e.after_value,
      metadata: e.metadata,
    }));
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadCsv(`auditoria-${stamp}.csv`, rows);
  }

  const hasActiveFilters = !!(filterEntity || filterSeverity || filterActor || dateFrom || dateTo || search);

  return (
    <Layout>
      <PageHeader
        kicker="Administração · Compliance"
        title="Auditoria"
        subtitle="Trilha completa de alterações em entidades sensíveis (medições, aditivos, GED, workflows)."
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4" />Exportar CSV ({filtered.length})
          </Button>
        }
      />

      <div className="mb-3">
        <SavedFiltersBar<AuditFilters>
          pageKey="audit_log"
          currentFilters={{
            entity: filterEntity, severity: filterSeverity, actor: filterActor,
            date_from: dateFrom, date_to: dateTo, search,
          }}
          hasActiveFilters={hasActiveFilters}
          onApply={(f) => {
            setFilterEntity(String(f.entity ?? ''));
            setFilterSeverity(String(f.severity ?? ''));
            setFilterActor(String(f.actor ?? ''));
            setDateFrom(String(f.date_from ?? ''));
            setDateTo(String(f.date_to ?? ''));
            setSearch(String(f.search ?? ''));
            if (f.date_from || f.date_to || f.actor) setAdvanced(true);
          }}
        />
      </div>

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
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdvanced((v) => !v)}>
              <Calendar className="h-3.5 w-3.5" />{advanced ? 'Menos' : 'Avançado'}
            </Button>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                <Filter className="h-3.5 w-3.5" />Limpar
              </Button>
            )}
          </div>
        </div>
        {advanced && (
          <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 dark:border-border-dark md:grid-cols-3">
            <Field label="De">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input" />
            </Field>
            <Field label="Até">
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input" />
            </Field>
            <Field label="Responsável">
              <Select
                value={filterActor} onChange={(e) => setFilterActor(e.target.value)}
                placeholder="Todos os usuários"
                options={members.map((m) => ({ value: m.id, label: `${m.nome} — ${m.email}` }))}
              />
            </Field>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Mostrando até 500 entradas mais recentes. {filtered.length !== entries.length && `${filtered.length} de ${entries.length} após busca.`}
        </p>
      </Card>

      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}
      {!isLoading && filtered.length === 0 && (
        <Empty title="Nenhuma entrada"
               body={hasActiveFilters
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
                      {(hasDiff || (e.metadata && Object.keys(e.metadata).length > 0)) && (
                        <button
                          type="button" onClick={() => toggleExpand(e.id)}
                          className="mt-1 text-xs text-navy hover:underline dark:text-purple-300"
                        >
                          {isExp ? 'Ocultar detalhes' : 'Ver detalhes'}
                        </button>
                      )}
                      {isExp && (hasDiff || (e.metadata && Object.keys(e.metadata).length > 0)) && (
                        <AuditDiff before={e.before_value} after={e.after_value} metadata={e.metadata} />
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
