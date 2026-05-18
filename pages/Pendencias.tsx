import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, ClipboardList, Clock,
  FileCheck, Send, Lightbulb, ShieldAlert,
  Shield, Gavel, Hammer, Download, ScrollText,
} from 'lucide-react';
import { getPendencias, type Pendencia } from '../lib/api';
import { dtTime } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
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
  vicio_aberto:       { label: 'Vício em recebimento',  icon: <FileCheck    className="h-4 w-4 text-error" />,
                        linkBase: (p) => `/contratos/${p.contract_id}/recebimentos` },
  par_defesa:         { label: 'PAR em defesa',         icon: <Gavel        className="h-4 w-4 text-purple-700 dark:text-purple-300" />,
                        linkBase: (p) => `/contratos/${p.contract_id}/processos-administrativos` },
  garantia_vencendo:  { label: 'Garantia vencendo',     icon: <Shield       className="h-4 w-4 text-yellow-700 dark:text-yellow-300" />,
                        linkBase: (p) => `/contratos/${p.contract_id}/garantias` },
  sancao_multa_pendente: { label: 'Multa pendente',     icon: <Hammer       className="h-4 w-4 text-error" />,
                        linkBase: (p) => `/contratos/${p.contract_id}/sancoes` },
  recebimento_definitivo_atrasado: { label: 'Definitivo atrasado', icon: <FileCheck className="h-4 w-4 text-error" />,
                        linkBase: (p) => `/contratos/${p.contract_id}/recebimentos` },
};

// V49: agrupamento visual dos chips de filtro por categoria.
// "Operação corrente" = tipos clássicos V12. "Lei 14.133" = tipos V35-V38 (migration 047).
const PENDENCIA_GROUP: Record<Pendencia['pendencia_tipo'], 'operacao' | 'lei14133'> = {
  medicao_aprovacao: 'operacao',
  grd_recebimento: 'operacao',
  unforeseen_analise: 'operacao',
  risco_alto: 'operacao',
  vicio_aberto: 'lei14133',
  par_defesa: 'lei14133',
  garantia_vencendo: 'lei14133',
  sancao_multa_pendente: 'lei14133',
  recebimento_definitivo_atrasado: 'lei14133',
};

const PENDENCIA_TYPES_ORDER: Pendencia['pendencia_tipo'][] = [
  'medicao_aprovacao', 'grd_recebimento', 'unforeseen_analise', 'risco_alto',
  'vicio_aberto', 'par_defesa', 'garantia_vencendo', 'sancao_multa_pendente', 'recebimento_definitivo_atrasado',
];

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

  const counts = useMemo(() => {
    const byType = {
      medicao_aprovacao:               all.filter((p) => p.pendencia_tipo === 'medicao_aprovacao').length,
      grd_recebimento:                 all.filter((p) => p.pendencia_tipo === 'grd_recebimento').length,
      unforeseen_analise:              all.filter((p) => p.pendencia_tipo === 'unforeseen_analise').length,
      risco_alto:                      all.filter((p) => p.pendencia_tipo === 'risco_alto').length,
      vicio_aberto:                    all.filter((p) => p.pendencia_tipo === 'vicio_aberto').length,
      par_defesa:                      all.filter((p) => p.pendencia_tipo === 'par_defesa').length,
      garantia_vencendo:               all.filter((p) => p.pendencia_tipo === 'garantia_vencendo').length,
      sancao_multa_pendente:           all.filter((p) => p.pendencia_tipo === 'sancao_multa_pendente').length,
      recebimento_definitivo_atrasado: all.filter((p) => p.pendencia_tipo === 'recebimento_definitivo_atrasado').length,
    };
    const operacao_total = byType.medicao_aprovacao + byType.grd_recebimento + byType.unforeseen_analise + byType.risco_alto;
    const lei14133_total = byType.vicio_aberto + byType.par_defesa + byType.garantia_vencendo + byType.sancao_multa_pendente + byType.recebimento_definitivo_atrasado;
    return {
      total: all.length,
      high: all.filter((p) => p.severidade === 'high').length,
      medium: all.filter((p) => p.severidade === 'medium').length,
      low: all.filter((p) => p.severidade === 'low').length,
      operacao_total,
      lei14133_total,
      ...byType,
    };
  }, [all]);

  // V49: export CSV das pendências filtradas
  function exportCsv() {
    const headers = ['contract_numero', 'pendencia_tipo', 'tipo_label', 'categoria', 'descricao', 'severidade', 'dias_aberta', 'desde'];
    const lines = [headers.join(';')];
    for (const p of filtered) {
      const tipo = p.pendencia_tipo;
      const row = [
        p.contract_numero,
        tipo,
        PENDENCIA_META[tipo]?.label || tipo,
        PENDENCIA_GROUP[tipo] === 'lei14133' ? 'Lei 14.133' : 'Operação corrente',
        `"${p.descricao.replace(/"/g, '""')}"`,
        p.severidade,
        String(p.dias_aberta),
        p.desde,
      ];
      lines.push(row.join(';'));
    }
    const csv = '\uFEFF' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pendencias_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Layout>
      <PageHeader
        kicker="Operação · SLA"
        title="Pendências e SLAs"
        subtitle="Tudo o que requer atenção: medições, GRDs, itens não previstos, riscos, vícios em recebimento, PARs, garantias, multas e definitivos atrasados"
        actions={
          filtered.length > 0 && (
            <Button variant="outline" onClick={exportCsv}>
              <Download className="h-4 w-4" />Exportar CSV
            </Button>
          )
        }
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

      {/* KPIs por severidade */}
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <KPICard label="Total" value={counts.total} icon={<ClipboardList className="h-4 w-4" />} tone="navy" onClick={() => { setFilterTipo(''); setFilterSeveridade(''); }} active={!filterTipo && !filterSeveridade} />
        <KPICard label="Alta severidade" value={counts.high} icon={<AlertCircle className="h-4 w-4" />} tone="red" onClick={() => setFilterSeveridade(filterSeveridade === 'high' ? '' : 'high')} active={filterSeveridade === 'high'} />
        <KPICard label="Média" value={counts.medium} icon={<AlertTriangle className="h-4 w-4" />} tone="yellow" onClick={() => setFilterSeveridade(filterSeveridade === 'medium' ? '' : 'medium')} active={filterSeveridade === 'medium'} />
        <KPICard label="Baixa" value={counts.low} icon={<Clock className="h-4 w-4" />} tone="slate" onClick={() => setFilterSeveridade(filterSeveridade === 'low' ? '' : 'low')} active={filterSeveridade === 'low'} />
      </div>

      {/* V49: KPIs por categoria — operação corrente vs Lei 14.133 */}
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <Card className="p-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
                Operação corrente
              </p>
              <p className="mt-1 text-2xl font-bold text-blue-700 dark:text-blue-300">{counts.operacao_total}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Medições · GRDs · não previstos · risco financeiro
              </p>
            </div>
            <ClipboardList className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-1" />
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
                Lei 14.133
              </p>
              <p className="mt-1 text-2xl font-bold text-magenta">{counts.lei14133_total}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Vícios · PARs · garantias · multas · definitivos
              </p>
            </div>
            <ScrollText className="h-5 w-5 text-magenta mt-1" />
          </div>
        </Card>
      </div>

      {/* Filtros por tipo — agrupados visualmente */}
      <Card className="mb-4 p-4 space-y-3">
        <FilterChip active={!filterTipo} onClick={() => setFilterTipo('')} count={counts.total}>Todos os tipos</FilterChip>

        <div>
          <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-display text-blue-700 dark:text-blue-300">
            Operação corrente
          </p>
          <div className="flex flex-wrap gap-2">
            {PENDENCIA_TYPES_ORDER.filter((t) => PENDENCIA_GROUP[t] === 'operacao').map((tipo) => {
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
        </div>

        <div>
          <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-display text-magenta">
            Lei 14.133
          </p>
          <div className="flex flex-wrap gap-2">
            {PENDENCIA_TYPES_ORDER.filter((t) => PENDENCIA_GROUP[t] === 'lei14133').map((tipo) => {
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
