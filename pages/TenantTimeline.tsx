import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, Filter, Calendar, ChevronRight, Search,
  FileText, Layers, ClipboardList, TrendingUp, Scale, AlertOctagon,
  FileCheck, Shield, Gavel, Hammer, X,
} from 'lucide-react';
import {
  listTenantTimeline, getTenantTimelineSummary, getTenantTimelineContracts,
  TIMELINE_KIND_LABELS, TIMELINE_KIND_ORDER, timelineSeverityTone,
  type TimelineEventKind, type TimelineSeverity, type TenantTimelineEvent,
} from '../lib/api';
import { dtTime } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { KpiGrid, KpiCard } from '../components/ui/KpiGrid';

const KIND_ICONS: Record<TimelineEventKind, React.ComponentType<{ className?: string }>> = {
  additive:     FileText,
  unforeseen:   ClipboardList,
  measurement:  Layers,
  reajuste:     TrendingUp,
  repactuacao:  Scale,
  reequilibrio: AlertOctagon,
  receipt:      FileCheck,
  guarantee:    Shield,
  par:          Gavel,
  sanction:     Hammer,
};

const ALL_SEVERITIES: TimelineSeverity[] = ['info', 'warning', 'danger', 'success', 'neutral'];

function fmtMonthYear(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function TenantTimeline() {
  const navigate = useNavigate();

  const [kinds, setKinds] = useState<Set<TimelineEventKind>>(new Set());
  const [severities, setSeverities] = useState<Set<TimelineSeverity>>(new Set());
  const [contractIds, setContractIds] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [contractSearch, setContractSearch] = useState('');

  const filters = useMemo(() => ({
    kinds:        kinds.size > 0 ? Array.from(kinds) : undefined,
    severity:     severities.size > 0 ? Array.from(severities) : undefined,
    contract_ids: contractIds.size > 0 ? Array.from(contractIds) : undefined,
    from:         from || undefined,
    to:           to   || undefined,
    limit:        300,
  }), [kinds, severities, contractIds, from, to]);

  const { data: summary } = useQuery({
    queryKey: ['tenant-timeline-summary'],
    queryFn: () => getTenantTimelineSummary(),
  });
  const { data: contracts = [] } = useQuery({
    queryKey: ['tenant-timeline-contracts'],
    queryFn: () => getTenantTimelineContracts(100),
  });
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['tenant-timeline', filters],
    queryFn: () => listTenantTimeline(filters),
  });

  // Agrupa por mês
  const groupedEvents = useMemo(() => {
    const groups = new Map<string, TenantTimelineEvent[]>();
    for (const e of events) {
      const key = e.event_date.slice(0, 7);
      const arr = groups.get(key) || [];
      arr.push(e);
      groups.set(key, arr);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, items]) => ({ month, items }));
  }, [events]);

  // Contratos filtrados pelo termo de busca
  const filteredContracts = useMemo(() => {
    if (!contractSearch) return contracts;
    const q = contractSearch.toLowerCase();
    return contracts.filter((c) =>
      c.contract_titulo.toLowerCase().includes(q) ||
      String(c.contract_numero).includes(q)
    );
  }, [contracts, contractSearch]);

  function toggleKind(k: TimelineEventKind) {
    setKinds((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }
  function toggleSeverity(s: TimelineSeverity) {
    setSeverities((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }
  function toggleContract(id: string) {
    setContractIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function clearFilters() {
    setKinds(new Set());
    setSeverities(new Set());
    setContractIds(new Set());
    setFrom(''); setTo(''); setContractSearch('');
  }

  const hasFilters = kinds.size > 0 || severities.size > 0 || contractIds.size > 0 || !!from || !!to;

  return (
    <Layout>
      <PageHeader
        kicker="Carteira"
        title="Linha do tempo global"
        subtitle="Eventos cronológicos de toda a carteira do tenant · 9 institutos Lei 14.133"
      />

      {/* KPIs */}
      {summary && (
        <KpiGrid cols={4}>
          <KpiCard
            label="Total de eventos"
            value={summary.total.toLocaleString('pt-BR')}
            sublabel={summary.last_event_at ? `último: ${dtTime(summary.last_event_at)}` : '—'}
          />
          <KpiCard
            label="Últimos 30 dias"
            value={summary.events_30d.toLocaleString('pt-BR')}
            sublabel={`${summary.events_7d.toLocaleString('pt-BR')} nos últimos 7d`}
            valueTone="info"
          />
          <KpiCard
            label="Contratos com atividade"
            value={
              <>
                {summary.contracts_active}
                <span className="text-slate-400 text-sm sm:text-base">/{summary.contracts_total}</span>
              </>
            }
            sublabel="nos últimos 30 dias"
          />
          <KpiCard
            label="Eventos críticos"
            value={(summary.by_severity.danger ?? 0).toLocaleString('pt-BR')}
            sublabel={`${(summary.by_severity.warning ?? 0).toLocaleString('pt-BR')} de aviso`}
            valueTone={(summary.by_severity.danger ?? 0) > 0 ? 'error' : 'default'}
          />
        </KpiGrid>
      )}

      {/* Filtros */}
      <Card className="mb-4">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-border-dark">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-500" />
              <p className="font-semibold dark:text-slate-200">Filtros</p>
              {hasFilters && (
                <span className="rounded-full bg-magenta/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-magenta">
                  ativos
                </span>
              )}
            </div>
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="text-xs text-magenta hover:underline">
                Limpar
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3 p-4">
          {/* Tipos */}
          <div>
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
              Tipo de evento
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TIMELINE_KIND_ORDER.map((k) => {
                const Icon = KIND_ICONS[k];
                const count = summary?.by_kind[k] ?? 0;
                const active = kinds.has(k);
                const disabled = count === 0;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => !disabled && toggleKind(k)}
                    disabled={disabled}
                    className={[
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'border-magenta bg-magenta/10 text-magenta dark:border-magenta dark:bg-magenta/20'
                        : disabled
                          ? 'border-slate-200 bg-slate-50 text-slate-400 dark:border-border-dark dark:bg-muted-dark/30 dark:text-slate-600 cursor-not-allowed'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-border-dark dark:bg-card-dark dark:text-slate-300 dark:hover:bg-muted-dark',
                    ].join(' ')}
                  >
                    <Icon className="h-3 w-3" />
                    {TIMELINE_KIND_LABELS[k]}
                    <span className={`font-mono text-[10px] tabular ${active ? 'text-magenta' : 'text-slate-400'}`}>
                      {count.toLocaleString('pt-BR')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Severidade */}
          <div>
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
              Severidade
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ALL_SEVERITIES.map((s) => {
                const active = severities.has(s);
                const count = summary?.by_severity[s] ?? 0;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSeverity(s)}
                    className={[
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'border-magenta bg-magenta/10 text-magenta dark:border-magenta dark:bg-magenta/20'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-border-dark dark:bg-card-dark dark:text-slate-300 dark:hover:bg-muted-dark',
                    ].join(' ')}
                  >
                    <span className={`h-2 w-2 rounded-full ${
                      s === 'success' ? 'bg-success' :
                      s === 'danger'  ? 'bg-error' :
                      s === 'warning' ? 'bg-yellow-500' :
                      s === 'info'    ? 'bg-blue-500' :
                                        'bg-slate-400'
                    }`} />
                    {s}
                    <span className={`font-mono text-[10px] tabular ${active ? 'text-magenta' : 'text-slate-400'}`}>
                      {count.toLocaleString('pt-BR')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contratos */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
                Contratos {contractIds.size > 0 && <span className="text-magenta">· {contractIds.size} selecionado{contractIds.size === 1 ? '' : 's'}</span>}
              </p>
              {contractIds.size > 0 && (
                <button type="button" onClick={() => setContractIds(new Set())}
                  className="font-mono text-[10px] text-magenta hover:underline">
                  limpar seleção
                </button>
              )}
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={contractSearch}
                onChange={(e) => setContractSearch(e.target.value)}
                placeholder="Buscar por número ou título…"
                className="input pl-8"
              />
              {contractSearch && (
                <button type="button" onClick={() => setContractSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 dark:border-border-dark">
              {filteredContracts.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-500">Nenhum contrato com atividade encontrado.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-border-dark">
                  {filteredContracts.map((c) => {
                    const active = contractIds.has(c.contract_id);
                    return (
                      <li key={c.contract_id}>
                        <button
                          type="button"
                          onClick={() => toggleContract(c.contract_id)}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors ${
                            active
                              ? 'bg-magenta/5 hover:bg-magenta/10'
                              : 'hover:bg-slate-50 dark:hover:bg-muted-dark/30'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-mono font-bold text-magenta">
                              #{c.contract_numero}
                              {active && <span className="ml-1 text-magenta">✓</span>}
                            </p>
                            <p className="line-clamp-1 text-slate-700 dark:text-slate-300">{c.contract_titulo}</p>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <p className="font-mono tabular text-slate-500">{c.event_count} ev.</p>
                            {c.last_event_at && (
                              <p className="font-mono text-[10px] text-slate-400">{dtTime(c.last_event_at)}</p>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Período */}
          <div>
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
              Período
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input w-auto" />
              <span className="text-slate-400">→</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input w-auto" />
            </div>
          </div>
        </div>
      </Card>

      {/* Timeline */}
      <Card>
        <div className="border-b border-slate-200 px-4 py-3 dark:border-border-dark">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-slate-500" />
            <p className="font-semibold dark:text-slate-200">
              {isLoading ? 'Carregando…' : `${events.length.toLocaleString('pt-BR')} evento${events.length === 1 ? '' : 's'}`}
            </p>
            {!isLoading && events.length === 300 && (
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
                limite atingido
              </span>
            )}
          </div>
        </div>

        {!isLoading && events.length === 0 && (
          <div className="px-4 py-12 text-center">
            <Activity className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {hasFilters ? 'Nenhum evento com os filtros aplicados' : 'Nenhum evento na carteira ainda'}
            </p>
          </div>
        )}

        <div className="px-4 py-3">
          {groupedEvents.map(({ month, items }) => (
            <div key={month} className="mb-6 last:mb-0">
              <h3 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-display text-slate-500 dark:text-slate-400">
                <Calendar className="h-3 w-3" />
                {fmtMonthYear(month + '-01')}
                <span className="ml-1 font-mono text-[10px] text-slate-400">· {items.length}</span>
              </h3>
              <div className="relative space-y-2 border-l-2 border-slate-200 pl-4 dark:border-border-dark">
                {items.map((e, idx) => {
                  const Icon = KIND_ICONS[e.event_kind];
                  return (
                    <button
                      key={`${e.ref_id}-${e.event_at}-${idx}`}
                      type="button"
                      onClick={() => navigate(`/contratos/${e.contract_id}${e.ref_link}`)}
                      className="group relative -ml-[1.625rem] flex w-full items-start gap-2 sm:gap-3 rounded-lg border border-slate-200 bg-white p-2.5 sm:p-3 text-left transition-colors hover:border-magenta/30 hover:bg-slate-50 dark:border-border-dark dark:bg-card-dark dark:hover:border-magenta/40 dark:hover:bg-muted-dark/40"
                    >
                      <div className={`flex h-7 w-7 sm:h-8 sm:w-8 flex-shrink-0 items-center justify-center rounded-full border-2 bg-white dark:bg-card-dark ${
                        e.severity === 'success' ? 'border-success text-success' :
                        e.severity === 'danger'  ? 'border-error text-error' :
                        e.severity === 'warning' ? 'border-yellow-500 text-yellow-600 dark:text-yellow-300' :
                        e.severity === 'info'    ? 'border-blue-500 text-blue-600 dark:text-blue-300' :
                                                   'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400'
                      }`}>
                        <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex flex-wrap items-center gap-1.5 sm:gap-2">
                          <span className="font-mono text-[10px] font-bold text-magenta">
                            #{e.contract_numero}
                          </span>
                          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            {TIMELINE_KIND_LABELS[e.event_kind]}
                          </span>
                          <Badge tone={timelineSeverityTone(e.severity)}>{e.event_subtype}</Badge>
                          <span className="font-mono text-[10px] text-slate-400">{dtTime(e.event_at)}</span>
                        </div>
                        <p className="text-sm font-medium dark:text-slate-200 line-clamp-1 sm:line-clamp-2">{e.title}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                          <span className="text-slate-400">contrato:</span> {e.contract_titulo}
                        </p>
                        {e.subtitle && (
                          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 line-clamp-1">{e.subtitle}</p>
                        )}
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-slate-300 transition-colors group-hover:text-magenta" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {!isLoading && events.length === 300 && (
        <p className="mt-2 text-center text-xs text-slate-500">
          Mostrando os 300 eventos mais recentes. Refine os filtros para alcançar outros períodos.
        </p>
      )}
    </Layout>
  );
}
