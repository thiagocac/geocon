import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, ClipboardList, Clock,
  FileCheck, Send, Lightbulb, ShieldAlert,
} from 'lucide-react';
import { getPendencias, type Pendencia } from '../lib/api';
import { dtTime } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Empty, Skeleton } from '../components/ui/Stat';
import { SavedFiltersBar, useDefaultPreset } from '../components/filters/SavedFiltersBar';

const PENDENCIA_META: Record<Pendencia['pendencia_tipo'], { label: string; icon: JSX.Element; linkBase: (p: Pendencia) => string }> = {
  medicao_aprovacao:  { label: 'Aprovação de medição', icon: <FileCheck    className="h-4 w-4 text-blue-700 dark:text-blue-300" />,
                        linkBase: (p) => `/contratos/${p.contract_id}/medicoes/${p.entity_id}/aprovar` },
  grd_recebimento:    { label: 'Confirmação de GRD',   icon: <Send         className="h-4 w-4 text-purple-700 dark:text-purple-300" />,
                        linkBase: (p) => `/ged/distribuicao/${p.entity_id}` },
  unforeseen_analise: { label: 'Item não previsto',    icon: <Lightbulb    className="h-4 w-4 text-yellow-700 dark:text-yellow-300" />,
                        linkBase: (p) => `/contratos/${p.contract_id}/itens-nao-previstos/${p.entity_id}` },
  risco_alto:         { label: 'Risco financeiro',     icon: <ShieldAlert  className="h-4 w-4 text-error" />,
                        linkBase: (p) => `/contratos/${p.contract_id}/financeiro` },
};

const SEVERIDADE_TONE: Record<string, 'slate' | 'yellow' | 'red'> = {
  low:    'slate',
  medium: 'yellow',
  high:   'red',
};

interface PendenciasFilters {
  tipo: Pendencia['pendencia_tipo'] | '';
  severidade: 'low' | 'medium' | 'high' | '';
}

export function Pendencias() {
  const [filterTipo, setFilterTipo] = useState<Pendencia['pendencia_tipo'] | ''>('');
  const [filterSeveridade, setFilterSeveridade] = useState<'low' | 'medium' | 'high' | ''>('');

  // Aplica preset default automaticamente ao montar
  useDefaultPreset<PendenciasFilters>('pendencias', (f) => {
    if (f.tipo !== undefined) setFilterTipo(f.tipo);
    if (f.severidade !== undefined) setFilterSeveridade(f.severidade);
  });

  const { data: all = [], isLoading } = useQuery({
    queryKey: ['pendencias'],
    queryFn: () => getPendencias(),
  });

  const filtered = useMemo(() => {
    return all.filter((p) => {
      if (filterTipo && p.pendencia_tipo !== filterTipo) return false;
      if (filterSeveridade && p.severidade !== filterSeveridade) return false;
      return true;
    });
  }, [all, filterTipo, filterSeveridade]);

  const counts = useMemo(() => ({
    total: all.length,
    high: all.filter((p) => p.severidade === 'high').length,
    medium: all.filter((p) => p.severidade === 'medium').length,
    low: all.filter((p) => p.severidade === 'low').length,
    medicao_aprovacao: all.filter((p) => p.pendencia_tipo === 'medicao_aprovacao').length,
    grd_recebimento:   all.filter((p) => p.pendencia_tipo === 'grd_recebimento').length,
    unforeseen_analise: all.filter((p) => p.pendencia_tipo === 'unforeseen_analise').length,
    risco_alto:        all.filter((p) => p.pendencia_tipo === 'risco_alto').length,
  }), [all]);

  return (
    <Layout>
      <PageHeader
        kicker="Operação · SLA"
        title="Pendências e SLAs"
        subtitle="Tudo o que requer atenção: medições atrasadas, GRDs sem confirmação, itens não previstos parados e contratos em risco"
      />

      <div className="mb-3">
        <SavedFiltersBar<PendenciasFilters>
          pageKey="pendencias"
          currentFilters={{ tipo: filterTipo, severidade: filterSeveridade }}
          hasActiveFilters={!!filterTipo || !!filterSeveridade}
          onApply={(f) => {
            setFilterTipo((f.tipo as Pendencia['pendencia_tipo']) ?? '');
            setFilterSeveridade((f.severidade as 'low' | 'medium' | 'high') ?? '');
          }}
        />
      </div>

      {/* KPIs */}
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <KPICard label="Total" value={counts.total} icon={<ClipboardList className="h-4 w-4" />} tone="navy" onClick={() => { setFilterTipo(''); setFilterSeveridade(''); }} active={!filterTipo && !filterSeveridade} />
        <KPICard label="Alta severidade" value={counts.high} icon={<AlertCircle className="h-4 w-4" />} tone="red" onClick={() => setFilterSeveridade(filterSeveridade === 'high' ? '' : 'high')} active={filterSeveridade === 'high'} />
        <KPICard label="Média" value={counts.medium} icon={<AlertTriangle className="h-4 w-4" />} tone="yellow" onClick={() => setFilterSeveridade(filterSeveridade === 'medium' ? '' : 'medium')} active={filterSeveridade === 'medium'} />
        <KPICard label="Baixa" value={counts.low} icon={<Clock className="h-4 w-4" />} tone="slate" onClick={() => setFilterSeveridade(filterSeveridade === 'low' ? '' : 'low')} active={filterSeveridade === 'low'} />
      </div>

      {/* Filtros por tipo */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap gap-2">
          <FilterChip active={!filterTipo} onClick={() => setFilterTipo('')} count={counts.total}>Todos os tipos</FilterChip>
          {(Object.keys(PENDENCIA_META) as Pendencia['pendencia_tipo'][]).map((tipo) => {
            const meta = PENDENCIA_META[tipo];
            return (
              <FilterChip
                key={tipo}
                active={filterTipo === tipo}
                onClick={() => setFilterTipo(filterTipo === tipo ? '' : tipo)}
                count={counts[tipo]}
                icon={meta.icon}
              >
                {meta.label}
              </FilterChip>
            );
          })}
        </div>
      </Card>

      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}

      {!isLoading && filtered.length === 0 && (
        <Empty
          title={all.length === 0 ? 'Sem pendências' : 'Nenhuma pendência para os filtros aplicados'}
          body={all.length === 0 ? 'Tudo em dia. Não há ações pendentes que requeiram sua atenção.' : 'Tente remover os filtros.'}
        />
      )}

      {filtered.length > 0 && (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100 dark:divide-border-dark">
            {filtered.map((p) => <PendenciaRow key={p.entity_id + p.pendencia_tipo} p={p} />)}
          </ul>
        </Card>
      )}
    </Layout>
  );
}

function KPICard({ label, value, icon, tone, onClick, active }: { label: string; value: number; icon: JSX.Element; tone: 'navy' | 'red' | 'yellow' | 'slate'; onClick: () => void; active: boolean }) {
  const toneCls: Record<string, string> = {
    navy:  'border-navy/30 bg-navy/5 text-navy dark:text-purple-200',
    red:   'border-error/30 bg-error/5 text-error',
    yellow:'border-yellow-400/30 bg-yellow-50 text-yellow-900 dark:bg-yellow-900/10 dark:text-yellow-200',
    slate: 'border-slate-200 bg-slate-50 text-slate-700 dark:bg-muted-dark dark:text-slate-200',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-4 text-left transition ${toneCls[tone]} ${active ? 'ring-2 ring-navy' : 'hover:scale-[1.01]'}`}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </button>
  );
}

function FilterChip({ children, active, onClick, count, icon }: { children: React.ReactNode; active: boolean; onClick: () => void; count: number; icon?: JSX.Element }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? 'bg-navy text-white'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-muted-dark dark:text-slate-200 dark:hover:bg-slate-800'
      }`}
    >
      {icon}{children}
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-700'}`}>{count}</span>
    </button>
  );
}

function PendenciaRow({ p }: { p: Pendencia }) {
  const meta = PENDENCIA_META[p.pendencia_tipo];
  const tone = SEVERIDADE_TONE[p.severidade] || 'slate';
  return (
    <li className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-muted-dark/40">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-muted-dark">
        {meta.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium uppercase tracking-wider text-slate-500">{meta.label}</span>
          {p.contract_numero && (
            <Link to={`/contratos/${p.contract_id}`} className="font-mono text-navy hover:underline dark:text-purple-300">
              {p.contract_numero}
            </Link>
          )}
        </div>
        <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{p.descricao}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Aberta em {dtTime(p.desde)}
          {p.dias_aberta > 0 && <> · há <strong>{p.dias_aberta} dia{p.dias_aberta !== 1 ? 's' : ''}</strong></>}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <Badge tone={tone}>{p.severidade === 'high' ? 'alta' : p.severidade === 'medium' ? 'média' : 'baixa'}</Badge>
        <Link
          to={meta.linkBase(p)}
          className="text-xs text-navy hover:underline dark:text-purple-300"
        >
          Resolver →
        </Link>
      </div>
    </li>
  );
}
