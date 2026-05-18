import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Activity, Filter, Calendar, ChevronRight, Download, FileDown,
  FileText, Layers, ClipboardList, TrendingUp, Scale, AlertOctagon,
  FileCheck, Shield, Gavel, Hammer, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import {
  listContractTimeline, getContractTimelineSummary,
  TIMELINE_KIND_LABELS, TIMELINE_KIND_ORDER, timelineSeverityTone,
  exportContractTimelinePdf, getTimelinePdfDownloadUrl,
  type TimelineEventKind, type TimelineSeverity, type TimelineEvent,
  type TimelinePdfExportResult,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { dtTime } from '../../lib/format';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { KpiGrid, KpiCard } from '../../components/ui/KpiGrid';

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

function brl(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
  });
}

function fmtMonthYear(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const ALL_SEVERITIES: TimelineSeverity[] = ['info', 'warning', 'danger', 'success', 'neutral'];

export function ContractTimeline() {
  const { id: contractId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [kinds, setKinds] = useState<Set<TimelineEventKind>>(new Set());
  const [severities, setSeverities] = useState<Set<TimelineSeverity>>(new Set());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exportResult, setExportResult] = useState<TimelinePdfExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const filters = useMemo(() => ({
    kinds:    kinds.size > 0 ? Array.from(kinds) : undefined,
    severity: severities.size > 0 ? Array.from(severities) : undefined,
    from:     from || undefined,
    to:       to   || undefined,
    limit:    1000,
  }), [kinds, severities, from, to]);

  const mExport = useMutation({
    mutationFn: () => exportContractTimelinePdf(contractId!, {
      kinds:    filters.kinds,
      severity: filters.severity,
      from:     filters.from,
      to:       filters.to,
    }),
    onSuccess: async (result) => {
      setExportResult(result);
      setExportError(null);
      // Auto-baixar o arquivo
      try {
        const url = await getTimelinePdfDownloadUrl(result.storage_path, 300);
        // Trigger download em nova aba
        const a = document.createElement('a');
        a.href = url;
        a.download = `linha-do-tempo-contrato.pdf`;
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (e) {
        console.error('download error', e);
      }
    },
    onError: (e) => {
      setExportError(humanizeError(e));
      setExportResult(null);
    },
  });

  const { data: summary } = useQuery({
    queryKey: ['contract-timeline-summary', contractId],
    queryFn: () => getContractTimelineSummary(contractId!),
    enabled: !!contractId,
  });
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['contract-timeline', contractId, filters],
    queryFn: () => listContractTimeline(contractId!, filters),
    enabled: !!contractId,
  });

  // Agrupa por mês/ano
  const groupedEvents = useMemo(() => {
    const groups = new Map<string, TimelineEvent[]>();
    for (const e of events) {
      const key = e.event_date.slice(0, 7);  // YYYY-MM
      const arr = groups.get(key) || [];
      arr.push(e);
      groups.set(key, arr);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, items]) => ({ month, items }));
  }, [events]);

  function toggleKind(k: TimelineEventKind) {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }
  function toggleSeverity(s: TimelineSeverity) {
    setSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }
  function clearFilters() {
    setKinds(new Set());
    setSeverities(new Set());
    setFrom(''); setTo('');
  }

  const hasFilters = kinds.size > 0 || severities.size > 0 || !!from || !!to;

  return (
    <>
      <Layout>
      <PageHeader
        kicker="Contrato"
        title="Linha do tempo"
        subtitle="Eventos contratuais cronologicamente unificados · 9 institutos Lei 14.133"
        backTo={`/contratos/${contractId}`}
        backLabel="Contrato"
        actions={
          <Button
            variant="outline"
            onClick={() => mExport.mutate()}
            loading={mExport.isPending}
          >
            <FileDown className="h-4 w-4" />Exportar PDF
          </Button>
        }
      />

      {/* KPIs */}
      {summary && (
        <KpiGrid cols={3}>
          <KpiCard
            label="Total de eventos"
            value={summary.total}
          />
          <KpiCard
            label="Período coberto"
            value={
              summary.first_at && summary.last_at ? (
                <span className="text-sm sm:text-base">
                  {fmtMonthYear(summary.first_at)} <span className="text-slate-400">→</span> {fmtMonthYear(summary.last_at)}
                </span>
              ) : (
                <span className="text-slate-400">—</span>
              )
            }
          />
          <KpiCard
            label="Módulos com atividade"
            value={
              <>
                {Object.keys(summary.by_kind).length}<span className="text-slate-400 text-sm sm:text-base">/10</span>
              </>
            }
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
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs text-magenta hover:underline"
              >
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
                    title={disabled ? `Sem eventos de ${TIMELINE_KIND_LABELS[k]}` : undefined}
                  >
                    <Icon className="h-3 w-3" />
                    {TIMELINE_KIND_LABELS[k]}
                    <span className={`font-mono text-[10px] tabular ${active ? 'text-magenta' : 'text-slate-400'}`}>
                      {count}
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
                  </button>
                );
              })}
            </div>
          </div>

          {/* Período */}
          <div>
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
              Período
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="input w-auto"
              />
              <span className="text-slate-400">→</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="input w-auto"
              />
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
              {isLoading ? 'Carregando…' : `${events.length} evento${events.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        {!isLoading && events.length === 0 && (
          <div className="px-4 py-12 text-center">
            <Activity className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {hasFilters ? 'Nenhum evento com os filtros aplicados' : 'Nenhum evento registrado neste contrato'}
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
                      onClick={() => navigate(`/contratos/${contractId}${e.ref_link}`)}
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
                          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            {TIMELINE_KIND_LABELS[e.event_kind]}
                          </span>
                          <Badge tone={timelineSeverityTone(e.severity)}>{e.event_subtype}</Badge>
                          <span className="font-mono text-[10px] text-slate-400">{dtTime(e.event_at)}</span>
                        </div>
                        <p className="text-sm font-medium dark:text-slate-200 line-clamp-2">{e.title}</p>
                        {e.subtitle && (
                          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 line-clamp-1 sm:line-clamp-2">{e.subtitle}</p>
                        )}
                        {e.actor_name && (
                          <p className="mt-0.5 font-mono text-[10px] text-slate-400 truncate">por {e.actor_name}</p>
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

      {!isLoading && events.length === 1000 && (
        <p className="mt-2 text-center text-xs text-slate-500">
          Mostrando os 1000 eventos mais recentes. Refine os filtros para ver outros.
        </p>
      )}
    </Layout>

    {/* V44: Modal de feedback do export */}
    <Modal
      open={!!exportResult || !!exportError}
      onClose={() => { setExportResult(null); setExportError(null); }}
      title={exportError ? 'Falha ao exportar' : 'PDF gerado'}
      size="sm"
      footer={
        <div className="flex justify-end">
          <Button onClick={() => { setExportResult(null); setExportError(null); }}>OK</Button>
        </div>
      }
    >
      {exportError && (
        <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-3 text-sm text-error">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <p>{exportError}</p>
          </div>
        </div>
      )}
      {exportResult && (
        <div className="space-y-3">
          <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-3 text-sm text-success">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <p>
                PDF com {exportResult.total_events} evento{exportResult.total_events === 1 ? '' : 's'} gerado.
                O download começou automaticamente.
              </p>
            </div>
          </div>
          <div className="space-y-1 text-xs">
            <p className="text-slate-500">
              <span className="font-mono">{(exportResult.size_bytes / 1024).toFixed(1)} KB</span>
              {' · '}
              <a
                href={exportResult.validation_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-magenta hover:underline"
              >
                Validação pública
              </a>
            </p>
            <p className="font-mono text-[10px] text-slate-400 break-all">
              Hash: {exportResult.hash_sha256}
            </p>
          </div>
        </div>
      )}
    </Modal>
    </>
  );
}
