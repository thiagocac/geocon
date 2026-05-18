import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  FileText, AlertOctagon, Clock, ShieldCheck, Eye,
  Layers, Activity, CalendarClock, BarChart3,
} from 'lucide-react';
import { getGedAcervoKpis, GED_STATUS_LABELS } from '../../lib/api';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Empty, ErrorState, Skeleton } from '../../components/ui/Stat';

/**
 * V59 — Painel KPI do acervo GED.
 *
 * Rota: /ged/dashboard
 *
 * Renderiza 5 seções:
 *   1. 4 KPI cards no header (Total · Validade · Texto extraído · Downloads/30d)
 *   2. Distribuição por status (6 estados em barra multi-segmento + lista)
 *   3. Top categorias (até 8, com barras horizontais)
 *   4. Saúde do acervo (3 alertas: aprovados >1ano sem revisão, em_revisao >30d, vencidos ativos)
 *   5. Geração timestamp + link rápido para acervo
 */
export function GedDashboard() {
  const { data: kpis, isLoading, isError, error } = useQuery({
    queryKey: ['ged-acervo-kpis'],
    queryFn: getGedAcervoKpis,
    staleTime: 30_000, // KPIs mudam pouco — cache 30s
  });

  return (
    <Layout>
      <PageHeader
        kicker="GED · Dashboard"
        title="Painel do acervo"
        subtitle="Métricas operacionais: distribuição · validade · taxa de uso · saúde do acervo"
        backTo="/ged"
        backLabel="GED"
      />

      {isError && <ErrorState message={(error as Error).message} />}
      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}

      {kpis && kpis.total === 0 && (
        <Empty
          title="Acervo vazio"
          body="Nenhum documento cadastrado. Faça upload do primeiro pelo botão Novo na lista de GED."
          action={<Link to="/ged" className="font-semibold text-navy hover:underline">Ir para GED →</Link>}
        />
      )}

      {kpis && kpis.total > 0 && (
        <>
          {/* Top KPIs */}
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <KpiCard
              icon={FileText}
              label="Documentos no acervo"
              value={kpis.total}
              tone="slate"
            />
            <KpiCard
              icon={CalendarClock}
              label="Com validade"
              value={`${kpis.validade.pct_com_validade}%`}
              subtitle={`${kpis.validade.com_validade} de ${kpis.total} documentos`}
              tone={kpis.validade.pct_com_validade >= 50 ? 'success' : 'yellow'}
            />
            <KpiCard
              icon={Layers}
              label="Texto extraído"
              value={`${kpis.extracao.pct_com_texto}%`}
              subtitle={`${kpis.extracao.com_texto} buscáveis no FTS`}
              tone={kpis.extracao.pct_com_texto >= 70 ? 'success' : 'yellow'}
            />
            <KpiCard
              icon={Eye}
              label="Downloads/30d"
              value={kpis.uso.downloads_30d}
              subtitle="Atividade recente"
              tone="slate"
            />
          </div>

          {/* Distribuição por status */}
          <Card className="mb-4 overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-border-dark">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-navy dark:text-purple-300" aria-hidden />
                <h2 className="font-semibold dark:text-slate-100">Distribuição por status</h2>
              </div>
            </header>
            <StatusBreakdown byStatus={kpis.by_status} total={kpis.total} />
          </Card>

          {/* Top categorias */}
          {kpis.by_category.length > 0 && (
            <Card className="mb-4 overflow-hidden">
              <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-border-dark">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-navy dark:text-purple-300" aria-hidden />
                  <h2 className="font-semibold dark:text-slate-100">Top categorias</h2>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
                  {kpis.by_category.length} de muitas
                </span>
              </header>
              <CategoryBreakdown categories={kpis.by_category} total={kpis.total} />
            </Card>
          )}

          {/* Saúde do acervo */}
          <Card className="overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-border-dark">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-navy dark:text-purple-300" aria-hidden />
                <h2 className="font-semibold dark:text-slate-100">Saúde do acervo</h2>
              </div>
            </header>
            <div className="grid grid-cols-1 gap-px bg-slate-100 dark:bg-border-dark md:grid-cols-3">
              <HealthCell
                icon={Clock}
                label="Aprovados há >1 ano"
                value={kpis.health.aprovados_sem_revisao_1ano}
                hint="Sem nova revisão · revisar relevância"
                tone={kpis.health.aprovados_sem_revisao_1ano > 0 ? 'yellow' : 'success'}
              />
              <HealthCell
                icon={ShieldCheck}
                label="Em revisão há >30 dias"
                value={kpis.health.em_revisao_mais_30d}
                hint="Gargalo no workflow · cobrar revisor"
                tone={kpis.health.em_revisao_mais_30d > 0 ? 'yellow' : 'success'}
              />
              <HealthCell
                icon={AlertOctagon}
                label="Vencidos ativos"
                value={kpis.health.vencidos_ativos}
                hint="Validade expirou · marcar obsoleto ou renovar"
                tone={kpis.health.vencidos_ativos > 0 ? 'red' : 'success'}
              />
            </div>
          </Card>

          <p className="mt-4 text-right font-mono text-[10px] uppercase tracking-display text-slate-400 dark:text-slate-500">
            Gerado em {new Date(kpis.generated_at).toLocaleString('pt-BR')}
          </p>
        </>
      )}
    </Layout>
  );
}

// =============================================================================
// Sub-componentes
// =============================================================================

function KpiCard({
  icon: Icon, label, value, subtitle, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  subtitle?: string;
  tone: 'slate' | 'success' | 'yellow' | 'red';
}) {
  const cfg = {
    slate:   'text-slate-700 dark:text-slate-200',
    success: 'text-success',
    yellow:  'text-yellow-700 dark:text-yellow-300',
    red:     'text-error',
  }[tone];
  return (
    <Card className="px-4 py-3">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${cfg}`} aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
          {label}
        </span>
      </div>
      <p className={`mt-1 font-mono tabular text-2xl font-bold ${cfg}`}>{value}</p>
      {subtitle && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
      )}
    </Card>
  );
}

const STATUS_TONE: Record<string, string> = {
  em_elaboracao: 'bg-slate-400 dark:bg-slate-500',
  em_revisao:    'bg-yellow-500',
  aprovado:      'bg-success',
  distribuido:   'bg-navy dark:bg-purple-500',
  obsoleto:      'bg-slate-300 dark:bg-slate-600',
  cancelado:     'bg-error',
};

function StatusBreakdown({
  byStatus, total,
}: {
  byStatus: Partial<Record<string, number>>;
  total: number;
}) {
  const order = ['em_elaboracao', 'em_revisao', 'aprovado', 'distribuido', 'obsoleto', 'cancelado'] as const;
  const segments = order
    .map((s) => ({ status: s, count: byStatus[s] || 0 }))
    .filter((s) => s.count > 0);

  return (
    <div className="p-5">
      {/* Stacked bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-muted-dark" role="img" aria-label="Distribuição por status">
        {segments.map((s) => {
          const pct = (s.count / total) * 100;
          return (
            <div
              key={s.status}
              className={`${STATUS_TONE[s.status]}`}
              style={{ width: `${pct}%` }}
              title={`${GED_STATUS_LABELS[s.status]}: ${s.count} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>

      {/* Legenda em grid */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {segments.map((s) => {
          const pct = (s.count / total) * 100;
          return (
            <div key={s.status} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`inline-block h-3 w-3 shrink-0 rounded-sm ${STATUS_TONE[s.status]}`} />
                <span className="truncate text-slate-700 dark:text-slate-200">
                  {GED_STATUS_LABELS[s.status] || s.status}
                </span>
              </div>
              <span className="shrink-0 font-mono tabular text-xs text-slate-500 dark:text-slate-400">
                {s.count} <span className="text-slate-400">· {pct.toFixed(1)}%</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CategoryBreakdown({
  categories, total,
}: {
  categories: Array<{ id: string; codigo: string; nome: string; cnt: number; aprovados: number; em_revisao: number; obsoletos: number }>;
  total: number;
}) {
  const max = Math.max(...categories.map((c) => c.cnt), 1);

  return (
    <ul className="divide-y divide-slate-100 dark:divide-border-dark">
      {categories.map((c) => {
        const widthPct = (c.cnt / max) * 100;
        const pctTotal = (c.cnt / total) * 100;
        return (
          <li key={c.id} className="px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{c.codigo}</span>
                  <span className="truncate font-medium text-slate-900 dark:text-slate-100" title={c.nome}>
                    {c.nome}
                  </span>
                </div>
                <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-muted-dark">
                  <div className="bg-navy dark:bg-purple-500" style={{ width: `${widthPct}%` }} />
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono tabular text-lg font-bold dark:text-slate-100">{c.cnt}</p>
                <p className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                  {pctTotal.toFixed(1)}% do acervo
                </p>
              </div>
            </div>
            {(c.aprovados > 0 || c.em_revisao > 0 || c.obsoletos > 0) && (
              <p className="mt-1 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                {c.aprovados > 0  && <>aprovado: {c.aprovados} · </>}
                {c.em_revisao > 0 && <>em revisão: {c.em_revisao} · </>}
                {c.obsoletos > 0  && <>obsoleto: {c.obsoletos}</>}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function HealthCell({
  icon: Icon, label, value, hint, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  hint: string;
  tone: 'success' | 'yellow' | 'red';
}) {
  const cfg = {
    success: { text: 'text-success', icon: 'text-success' },
    yellow:  { text: 'text-yellow-700 dark:text-yellow-300', icon: 'text-yellow-600 dark:text-yellow-400' },
    red:     { text: 'text-error', icon: 'text-error' },
  }[tone];
  return (
    <div className="bg-white px-4 py-3 dark:bg-card-dark">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${cfg.icon}`} aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
          {label}
        </span>
      </div>
      <p className={`mt-1 font-mono tabular text-2xl font-bold ${cfg.text}`}>{value}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  );
}
