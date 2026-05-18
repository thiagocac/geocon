import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, TrendingUp, TrendingDown, CheckCircle2, XOctagon,
  Calculator, ArrowRight, Database,
} from 'lucide-react';
import {
  listContractPriceDivergences, DIVERGENCIA_SEVERIDADE_LABELS,
  type DivergenciaSeveridade,
} from '../lib/api';
import { brl, num } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Empty, ErrorState, Skeleton } from '../components/ui/Stat';
import type { BadgeTone } from '../lib/status';

const SEVERIDADE_TONE: Record<DivergenciaSeveridade, BadgeTone> = {
  ok: 'green', atencao: 'yellow', alerta: 'yellow', critico: 'red', indeterminado: 'slate',
};

/**
 * V67 — Análise de divergência entre preço atual e calculado pela composição.
 *
 * Rota: /contratos/:id/divergencias-preco
 *
 * Liga V57 (auditoria) + V64 (histórico) + V66 (composição). Mostra todos os
 * itens com composição cadastrada onde o preço unitário cravado diverge do
 * calculado (total × (1+BDI)).
 *
 * Útil para auditoria pré-licitação: identificar onde o preço de proposta
 * difere do orçamento técnico — pode ser estratégia comercial ou erro.
 */
export function ContractPriceDivergence() {
  const { id = '' } = useParams();
  const [filter, setFilter] = useState<DivergenciaSeveridade | 'todos'>('todos');

  const { data: rows = [], isLoading, isError, error } = useQuery({
    queryKey: ['price-divergence', id, filter],
    queryFn: () => listContractPriceDivergences(
      id,
      filter === 'todos' ? undefined : [filter],
    ),
    enabled: !!id,
  });

  // Estatísticas agregadas (sempre sobre dataset completo, ignora filtro)
  const { data: allRows = [] } = useQuery({
    queryKey: ['price-divergence-all', id],
    queryFn: () => listContractPriceDivergences(id),
    enabled: !!id,
  });

  const stats = useMemo(() => {
    const acc = { ok: 0, atencao: 0, alerta: 0, critico: 0, indeterminado: 0 };
    let impactoSobreestimado = 0;
    let impactoSubestimado = 0;
    for (const r of allRows) {
      acc[r.severidade]++;
      if (r.impacto_financeiro > 0) impactoSobreestimado += r.impacto_financeiro;
      else                          impactoSubestimado += r.impacto_financeiro;
    }
    return {
      total: allRows.length, ...acc,
      impactoSobreestimado, impactoSubestimado,
      impactoLiquido: impactoSobreestimado + impactoSubestimado,
    };
  }, [allRows]);

  return (
    <Layout>
      <PageHeader
        kicker="SOV · Auditoria"
        title="Divergência de preços"
        subtitle="Itens onde preço cravado difere do calculado pela composição × (1+BDI)"
        backTo={`/contratos/${id}/planilha`}
        backLabel="Planilha"
      />

      {isError && <ErrorState message={(error as Error).message} />}

      {/* Stats */}
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <StatCard label="Itens com composição" value={stats.total} tone="slate"  icon={Calculator} />
        <StatCard label="Alertas"              value={stats.alerta} tone="yellow" icon={AlertTriangle} />
        <StatCard label="Críticos"             value={stats.critico} tone="red"    icon={XOctagon} />
        <StatCard
          label="Impacto líquido na proposta"
          tone={stats.impactoLiquido >= 0 ? 'green' : 'red'}
          icon={stats.impactoLiquido >= 0 ? TrendingUp : TrendingDown}
          rich={
            <>
              <p className={`mt-1 font-mono tabular text-xl font-bold ${stats.impactoLiquido >= 0 ? 'text-success' : 'text-error'}`}>
                {stats.impactoLiquido >= 0 ? '+' : ''}{brl(stats.impactoLiquido)}
              </p>
              <p className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                ↑ {brl(stats.impactoSobreestimado)} · ↓ {brl(Math.abs(stats.impactoSubestimado))}
              </p>
            </>
          }
        />
      </div>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <FilterChip active={filter === 'todos'}   onClick={() => setFilter('todos')}   label={`Todos · ${stats.total}`} />
        <FilterChip active={filter === 'critico'} onClick={() => setFilter('critico')} label={`Críticos · ${stats.critico}`} tone="red" />
        <FilterChip active={filter === 'alerta'}  onClick={() => setFilter('alerta')}  label={`Alertas · ${stats.alerta}`} tone="yellow" />
        <FilterChip active={filter === 'atencao'} onClick={() => setFilter('atencao')} label={`Atenção · ${stats.atencao}`} tone="yellow" />
        <FilterChip active={filter === 'ok'}      onClick={() => setFilter('ok')}      label={`OK · ${stats.ok}`} tone="green" />
      </div>

      {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}

      {!isLoading && rows.length === 0 && (
        <Empty
          title={filter === 'todos' ? 'Sem composições cadastradas' : 'Nenhum item nesta faixa'}
          body={filter === 'todos'
            ? 'Para análise de divergência, primeiro cadastre composições nos itens. Importação via Excel ou cadastro manual estão disponíveis na planilha.'
            : 'Tente outra faixa de severidade ou volte para "Todos".'}
          action={<Link to={`/contratos/${id}/planilha`} className="font-semibold text-navy hover:underline">Voltar à planilha →</Link>}
        />
      )}

      {!isLoading && rows.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[10px] uppercase tracking-display dark:border-border-dark dark:bg-muted-dark/40">
              <tr>
                <th className="px-4 py-2 text-left">Item</th>
                <th className="px-4 py-2 text-right">Atual</th>
                <th className="px-4 py-2 text-right">Calculado</th>
                <th className="px-4 py-2 text-right">Divergência</th>
                <th className="px-4 py-2 text-right">Impacto</th>
                <th className="px-4 py-2 text-center">Severidade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item_id} className="border-t border-slate-100 dark:border-border-dark">
                  <td className="px-4 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.codigo}</span>
                      <span className="truncate text-slate-900 dark:text-slate-100" title={r.descricao}>
                        {r.descricao}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                      <Database className="h-3 w-3" />
                      {r.codigo_composicao} · {r.fonte}
                      <span className="text-slate-400">·</span>
                      {num(r.quantidade_contratada, 2)} {r.unidade}
                      <span className="text-slate-400">·</span>
                      BDI {r.bdi_percentual}%
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular">{brl(r.preco_atual)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular text-slate-600 dark:text-slate-400">{brl(r.preco_calculado)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className={`font-mono tabular font-semibold ${r.divergencia_pct >= 0 ? 'text-warning' : 'text-info'}`}>
                      {r.divergencia_pct >= 0 ? '+' : ''}{r.divergencia_pct.toFixed(2)}%
                    </div>
                    <div className="font-mono tabular text-[10px] text-slate-500 dark:text-slate-400">
                      {r.divergencia_abs >= 0 ? '+' : ''}{brl(r.divergencia_abs)}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular text-xs">
                    <span className={r.impacto_financeiro >= 0 ? 'text-success' : 'text-error'}>
                      {r.impacto_financeiro >= 0 ? '+' : ''}{brl(r.impacto_financeiro)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <Badge tone={SEVERIDADE_TONE[r.severidade]}>
                      {DIVERGENCIA_SEVERIDADE_LABELS[r.severidade]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        <CheckCircle2 className="mr-1 inline h-3 w-3 text-success" />
        Divergência positiva = preço cravado <strong>acima</strong> do calculado (sobreestimado, vantagem comercial).
        <ArrowRight className="mx-2 inline h-3 w-3 text-slate-400" />
        Divergência negativa = preço cravado <strong>abaixo</strong> (subestimado, risco de prejuízo).
      </p>
    </Layout>
  );
}

function StatCard({
  label, value, tone, icon: Icon, rich,
}: {
  label: string;
  value?: number;
  tone: 'slate' | 'green' | 'yellow' | 'red';
  icon: React.ComponentType<{ className?: string }>;
  rich?: React.ReactNode;
}) {
  const cfg = {
    slate:  'text-slate-700 dark:text-slate-200',
    green:  'text-success',
    yellow: 'text-yellow-700 dark:text-yellow-300',
    red:    'text-error',
  }[tone];
  return (
    <Card className={`px-4 py-3 ${value === 0 ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${cfg}`} aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
          {label}
        </span>
      </div>
      {rich
        ? rich
        : <p className={`mt-1 font-mono tabular text-2xl font-bold ${cfg}`}>{value ?? 0}</p>}
    </Card>
  );
}

function FilterChip({
  active, onClick, label, tone,
}: {
  active: boolean; onClick: () => void; label: string;
  tone?: 'red' | 'yellow' | 'green';
}) {
  const activeCfg = {
    red:    'bg-error text-white',
    yellow: 'bg-yellow-500 text-white',
    green:  'bg-success text-white',
  }[tone || 'red'];  // default doesn't matter since active+no-tone uses navy
  const cls = active
    ? (tone ? activeCfg : 'bg-navy text-white dark:bg-purple-600')
    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-muted-dark dark:text-slate-300 dark:hover:bg-slate-700';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-display transition-colors ${cls}`}
    >
      {label}
    </button>
  );
}
