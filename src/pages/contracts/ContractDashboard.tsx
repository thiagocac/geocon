import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Gauge, AlertTriangle, CheckCircle2, Activity, ChevronRight,
  FileText, Layers, ClipboardList, TrendingUp, Scale, AlertOctagon,
  FileCheck, Shield, Gavel, Hammer, Calendar, Clock, ArrowUpRight,
} from 'lucide-react';
import {
  getContractDashboard, DASHBOARD_NEXT_DATE_KIND_LABELS, dashboardDueTone,
  TIMELINE_KIND_LABELS, timelineSeverityTone,
  type DashboardAlert, type DashboardNextDate, type DashboardRecentEvent,
  type ContractDashboard, type TimelineEventKind,
} from '../../lib/api';
import { dtTime } from '../../lib/format';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
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
function brlShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(Number(n))) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1e6) return `R$ ${(v / 1e6).toFixed(1).replace('.', ',')}M`;
  if (Math.abs(v) >= 1e3) return `R$ ${(v / 1e3).toFixed(1).replace('.', ',')}k`;
  return brl(v);
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export function ContractDashboard() {
  const { id: contractId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['contract-dashboard', contractId],
    queryFn: () => getContractDashboard(contractId!),
    enabled: !!contractId,
  });

  if (isLoading || !data) {
    return (
      <Layout>
        <PageHeader
          kicker="Contrato"
          title="Dashboard"
          subtitle="Carregando…"
          backTo={`/contratos/${contractId}`}
          backLabel="Contrato"
        />
        <Card className="p-6"><p className="text-sm text-slate-500">Carregando dashboard…</p></Card>
      </Layout>
    );
  }

  const { contract, alerts, kpis, per_axis, next_dates, recent_events } = data;
  const hasCriticalAlerts = alerts.some((a) => a.severity === 'danger');

  return (
    <Layout>
      <PageHeader
        kicker={`Contrato #${contract.numero}`}
        title="Dashboard"
        subtitle={contract.titulo || 'Visão executiva consolidada'}
        backTo={`/contratos/${contractId}`}
        backLabel="Contrato"
      />

      {/* Alerts críticos no topo */}
      {alerts.length > 0 && (
        <div className="mb-4 space-y-2">
          {alerts.map((a, i) => (
            <AlertBanner key={i} alert={a} contractId={contractId!} />
          ))}
        </div>
      )}

      {/* KPIs financeiros */}
      <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
        Financeiro
      </p>
      <KpiGrid cols={4}>
        <KpiCard
          label="Valor inicial"
          value={brlShort(kpis.financial.valor_inicial)}
          sublabel={brl(kpis.financial.valor_inicial)}
        />
        <KpiCard
          label="Total atual"
          value={brlShort(kpis.financial.valor_total_atual)}
          sublabel={kpis.financial.valor_aditado > 0
            ? `aditado +${brlShort(kpis.financial.valor_aditado)}`
            : 'sem aditivos'}
          valueTone={kpis.financial.valor_aditado > 0 ? 'info' : 'default'}
        />
        <KpiCard
          label="Garantia disponível"
          value={brlShort(kpis.financial.valor_garantia_disponivel)}
          valueTone={kpis.financial.valor_garantia_disponivel > 0 ? 'success' : 'default'}
        />
        <KpiCard
          label="Garantia executada"
          value={brlShort(kpis.financial.valor_garantia_executado)}
          valueTone={kpis.financial.valor_garantia_executado > 0 ? 'error' : 'default'}
        />
      </KpiGrid>

      {/* KPIs de pendência */}
      <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
        Pendências
      </p>
      <KpiGrid cols={4}>
        <KpiCard
          label="Vícios abertos"
          value={kpis.pending.vicios_abertos}
          valueTone={kpis.pending.vicios_abertos > 0 ? 'error' : 'default'}
          icon={<FileCheck className="h-3 w-3 text-slate-400" />}
        />
        <KpiCard
          label="PARs em curso"
          value={kpis.pending.pars_em_curso}
          valueTone={kpis.pending.pars_em_curso > 0 ? 'warning' : 'default'}
          icon={<Gavel className="h-3 w-3 text-slate-400" />}
        />
        <KpiCard
          label="Multas pendentes"
          value={kpis.pending.multas_pendentes}
          valueTone={kpis.pending.multas_pendentes > 0 ? 'warning' : 'default'}
          icon={<Hammer className="h-3 w-3 text-slate-400" />}
        />
        <KpiCard
          label="Recebimentos com pendência"
          value={kpis.pending.recebimentos_pendentes}
          valueTone={kpis.pending.recebimentos_pendentes > 0 ? 'warning' : 'default'}
          icon={<FileCheck className="h-3 w-3 text-slate-400" />}
        />
      </KpiGrid>

      {/* Layout principal: 2 colunas em desktop, 1 em mobile */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Próximos vencimentos */}
        <Card>
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-border-dark">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-slate-500" />
              <p className="font-semibold dark:text-slate-200">Próximos vencimentos</p>
            </div>
            <p className="font-mono text-[10px] text-slate-500">top 10</p>
          </div>
          {next_dates.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <CheckCircle2 className="mx-auto h-7 w-7 text-success/60" />
              <p className="mt-2 text-sm text-slate-500">Nenhum vencimento próximo</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-border-dark">
              {next_dates.map((d) => (
                <NextDateRow
                  key={`${d.kind}-${d.ref_id}`}
                  d={d}
                  onClick={() => navigate(`/contratos/${contractId}${d.link}`)}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Atividade recente (mini-timeline) */}
        <Card>
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-border-dark">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-slate-500" />
              <p className="font-semibold dark:text-slate-200">Atividade recente</p>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/contratos/${contractId}/timeline`)}
              className="font-mono text-[10px] text-magenta hover:underline"
            >
              ver timeline completa →
            </button>
          </div>
          <div className="px-4 py-3">
            <p className="mb-3 font-mono text-[10px] text-slate-500">
              {kpis.recent.events_30d} evento{kpis.recent.events_30d === 1 ? '' : 's'} nos últimos 30 dias
              {kpis.recent.last_event_at && ` · último: ${dtTime(kpis.recent.last_event_at)}`}
            </p>
            {recent_events.length === 0 ? (
              <p className="text-sm text-slate-500">Sem atividade no período</p>
            ) : (
              <div className="space-y-2">
                {recent_events.slice(0, 6).map((e, i) => (
                  <RecentEventRow
                    key={`${e.event_at}-${i}`}
                    e={e}
                    onClick={() => navigate(`/contratos/${contractId}${e.ref_link}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Status por eixo Lei 14.133 */}
      <p className="mt-4 mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
        Status por instituto · Lei 14.133
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AxisCard
          icon={FileText}
          label="Aditivos"
          link="aditivos"
          contractId={contractId!}
          stats={[
            { label: 'Total',         value: per_axis.aditivo.total },
            { label: 'Aprovados',     value: per_axis.aditivo.aprovados,    tone: 'success' },
            { label: 'Em aprovação',  value: per_axis.aditivo.em_aprovacao, tone: 'warning' },
          ]}
          footer={brl(per_axis.aditivo.valor_liquido_total)}
        />
        <AxisCard
          icon={TrendingUp}
          label="Reajustes"
          link="reajustes"
          contractId={contractId!}
          stats={[
            { label: 'Regras ativas', value: per_axis.reajuste.rules_active },
            { label: 'Aplicados',     value: per_axis.reajuste.events_total, tone: 'success' },
          ]}
          footer={brl(per_axis.reajuste.delta_total)}
        />
        <AxisCard
          icon={Scale}
          label="Repactuações"
          link="repactuacoes"
          contractId={contractId!}
          stats={[
            { label: 'Eventos',       value: per_axis.repactuacao.events_total, tone: 'success' },
          ]}
          footer={brl(per_axis.repactuacao.delta_total)}
        />
        <AxisCard
          icon={AlertOctagon}
          label="Reequilíbrios"
          link="reequilibrios"
          contractId={contractId!}
          stats={[
            { label: 'Total',     value: per_axis.reequilibrio.total },
            { label: 'Em curso',  value: per_axis.reequilibrio.open,      tone: 'warning' },
            { label: 'Aplicados', value: per_axis.reequilibrio.aplicado,  tone: 'success' },
          ]}
          footer={brl(per_axis.reequilibrio.valor_aprovado_total)}
        />
        <AxisCard
          icon={FileCheck}
          label="Recebimentos"
          link="recebimentos"
          contractId={contractId!}
          stats={[
            { label: 'Provisórios', value: per_axis.recebimento.provisorios_emitidos },
            { label: 'Definitivos', value: per_axis.recebimento.definitivos_emitidos, tone: 'success' },
            { label: 'Vícios',      value: per_axis.recebimento.vicios_abertos,       tone: per_axis.recebimento.vicios_abertos > 0 ? 'error' : 'default' },
          ]}
        />
        <AxisCard
          icon={Shield}
          label="Garantias"
          link="garantias"
          contractId={contractId!}
          stats={[
            { label: 'Total',     value: per_axis.garantia.total },
            { label: 'Ativas',    value: per_axis.garantia.ativas,    tone: 'success' },
            { label: 'Executadas', value: per_axis.garantia.valor_executado > 0 ? 1 : 0, tone: per_axis.garantia.valor_executado > 0 ? 'error' : 'default' },
          ]}
          footer={`${brlShort(per_axis.garantia.valor_disponivel)} disponível`}
        />
        <AxisCard
          icon={Gavel}
          label="PARs"
          link="processos-administrativos"
          contractId={contractId!}
          stats={[
            { label: 'Total',           value: per_axis.par.total },
            { label: 'Em curso',        value: per_axis.par.em_andamento,    tone: 'warning' },
            { label: 'Procedentes',     value: per_axis.par.procedentes,     tone: per_axis.par.procedentes > 0 ? 'error' : 'default' },
            { label: 'Prazo vencido',   value: per_axis.par.prazo_estourado, tone: per_axis.par.prazo_estourado > 0 ? 'error' : 'default' },
          ]}
        />
        <AxisCard
          icon={Hammer}
          label="Sanções"
          link="sancoes"
          contractId={contractId!}
          stats={[
            { label: 'Total',                       value: per_axis.sancao.total },
            { label: 'Ativas',                      value: per_axis.sancao.ativas,                          tone: per_axis.sancao.ativas > 0 ? 'error' : 'default' },
            { label: 'Impedimento/Inidoneidade',    value: per_axis.sancao.impedimento_inidoneidade_ativos, tone: per_axis.sancao.impedimento_inidoneidade_ativos > 0 ? 'error' : 'default' },
          ]}
          footer={per_axis.sancao.multa_pendente > 0 ? `${brlShort(per_axis.sancao.multa_pendente)} pendente` : undefined}
        />
      </div>

      <p className="mt-4 text-center font-mono text-[10px] text-slate-400">
        Snapshot consolidado · {hasCriticalAlerts ? '⚠ atenção necessária' : 'sem questões críticas no momento'}
      </p>
    </Layout>
  );
}

// =============================================================================
// Alert banner no topo
// =============================================================================
function AlertBanner({ alert, contractId }: { alert: DashboardAlert; contractId: string }) {
  const navigate = useNavigate();
  const tone =
    alert.severity === 'danger'  ? 'border-error/40 bg-error/5 text-error' :
    alert.severity === 'warning' ? 'border-yellow-300/50 bg-yellow-50 text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-900/15 dark:text-yellow-200' :
                                    'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/15 dark:text-blue-200';
  return (
    <button
      type="button"
      onClick={() => navigate(`/contratos/${contractId}${alert.link}`)}
      className={`group flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-opacity hover:opacity-90 ${tone}`}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{alert.title}</p>
        <p className="mt-0.5 text-xs opacity-80">{alert.body}</p>
      </div>
      <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

// =============================================================================
// Linha de próximo vencimento
// =============================================================================
function NextDateRow({ d, onClick }: { d: DashboardNextDate; onClick: () => void }) {
  const tone = dashboardDueTone(d.days_until);
  const toneColor =
    tone === 'red'    ? 'text-error' :
    tone === 'yellow' ? 'text-yellow-600 dark:text-yellow-300' :
    tone === 'blue'   ? 'text-blue-600 dark:text-blue-300' :
                        'text-slate-500';
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-muted-dark/30"
    >
      <Clock className={`mt-0.5 h-4 w-4 flex-shrink-0 ${toneColor}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium dark:text-slate-200 truncate">{d.label}</p>
        <p className="font-mono text-[10px] text-slate-500">
          {DASHBOARD_NEXT_DATE_KIND_LABELS[d.kind]} · {fmtDate(d.due_date)}
        </p>
      </div>
      <div className="flex-shrink-0 text-right">
        <p className={`font-mono tabular text-sm font-bold ${toneColor}`}>
          {d.days_until}d
        </p>
      </div>
      <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-slate-300 transition-colors group-hover:text-magenta" />
    </button>
  );
}

// =============================================================================
// Linha de evento recente (compacta)
// =============================================================================
function RecentEventRow({ e, onClick }: { e: DashboardRecentEvent; onClick: () => void }) {
  const Icon = KIND_ICONS[e.event_kind];
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-muted-dark/30"
    >
      <div className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border ${
        e.severity === 'success' ? 'border-success text-success' :
        e.severity === 'danger'  ? 'border-error text-error' :
        e.severity === 'warning' ? 'border-yellow-500 text-yellow-600 dark:text-yellow-300' :
        e.severity === 'info'    ? 'border-blue-500 text-blue-600 dark:text-blue-300' :
                                   'border-slate-300 text-slate-500'
      }`}>
        <Icon className="h-3 w-3" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            {TIMELINE_KIND_LABELS[e.event_kind]}
          </span>
          <Badge tone={timelineSeverityTone(e.severity)}>{e.event_subtype}</Badge>
        </div>
        <p className="text-xs font-medium dark:text-slate-200 line-clamp-1">{e.title}</p>
      </div>
      <span className="font-mono text-[10px] text-slate-400 flex-shrink-0">{dtTime(e.event_at)}</span>
    </button>
  );
}

// =============================================================================
// Card de eixo (instituto Lei 14.133)
// =============================================================================
type StatTone = 'default' | 'success' | 'warning' | 'error';

function AxisCard({
  icon: Icon, label, link, contractId, stats, footer,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  link: string;
  contractId: string;
  stats: Array<{ label: string; value: number; tone?: StatTone }>;
  footer?: string;
}) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/contratos/${contractId}/${link}`)}
      className="group surface flex flex-col p-3 text-left transition-colors hover:border-magenta/30 dark:hover:border-magenta/40"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          <p className="text-sm font-semibold dark:text-slate-200">{label}</p>
        </div>
        <ArrowUpRight className="h-3.5 w-3.5 text-slate-300 transition-colors group-hover:text-magenta" />
      </div>
      <dl className="space-y-1 text-xs">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center justify-between">
            <dt className="text-slate-500 dark:text-slate-400">{s.label}</dt>
            <dd className={`font-mono tabular font-semibold ${
              s.tone === 'success' ? 'text-success' :
              s.tone === 'warning' ? 'text-yellow-600 dark:text-yellow-300' :
              s.tone === 'error'   ? 'text-error' :
                                     'dark:text-slate-200'
            }`}>
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
      {footer && (
        <p className="mt-2 pt-2 border-t border-slate-100 dark:border-border-dark/50 font-mono text-[10px] text-slate-500 truncate">
          {footer}
        </p>
      )}
    </button>
  );
}
