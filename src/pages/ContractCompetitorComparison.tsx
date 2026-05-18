import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Trophy, TrendingDown, TrendingUp, Building2, Calendar, Download,
} from 'lucide-react';
import { listContractCompetitorComparison } from '../lib/api';
import { brl } from '../lib/format';
import { downloadCsv } from '../lib/csv';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Empty, Skeleton } from '../components/ui/Stat';

/**
 * V72 — Comparação de preço próprio vs concorrentes.
 *
 * Rota: /contratos/:id/comparacao-concorrentes
 *
 * Lista cada cotação de concorrente registrada, junto com diferença
 * relativa ao preço próprio cravado. Útil para análise pós-licitação:
 * "fomos competitivos?" ou pré-licitação: "preciso baixar preços para
 * vencer?"
 */
export function ContractCompetitorComparison() {
  const { id = '' } = useParams();
  const [filterCompetitor, setFilterCompetitor] = useState<string>('all');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['competitor-comparison', id],
    queryFn: () => listContractCompetitorComparison(id),
    enabled: !!id,
  });

  const competitors = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of rows) set.set(r.competitor_id, r.competitor_name);
    return Array.from(set.entries());
  }, [rows]);

  const filtered = filterCompetitor === 'all'
    ? rows
    : rows.filter((r) => r.competitor_id === filterCompetitor);

  const stats = useMemo(() => {
    let nWon = 0, nLost = 0, sumDiff = 0;
    for (const r of filtered) {
      if (r.diff_pct < 0) nWon++; // concorrente mais barato = perdemos
      else if (r.diff_pct > 0) nLost++; // concorrente mais caro = ganhamos
      sumDiff += r.diff_abs;
    }
    return { nWon, nLost, sumDiff };
  }, [filtered]);

  function exportCsv() {
    downloadCsv(
      `concorrentes-${id}.csv`,
      filtered.map((r) => ({
        codigo: r.codigo,
        descricao: r.descricao,
        unidade: r.unidade,
        preco_proprio: r.preco_proprio,
        competitor_name: r.competitor_name,
        competitor_cnpj: r.competitor_cnpj || '',
        preco_competitor: r.preco_competitor,
        diff_abs: r.diff_abs,
        diff_pct: r.diff_pct.toFixed(2) + '%',
        data_proposta: r.data_proposta || '',
        origem: r.origem,
      })),
      {
        codigo: 'Código', descricao: 'Descrição', unidade: 'Un',
        preco_proprio: 'Preço próprio (R$)',
        competitor_name: 'Concorrente', competitor_cnpj: 'CNPJ',
        preco_competitor: 'Preço concorrente (R$)',
        diff_abs: 'Diferença (R$)', diff_pct: 'Diferença (%)',
        data_proposta: 'Data proposta', origem: 'Origem',
      },
    );
  }

  return (
    <Layout>
      <PageHeader
        kicker="SOV · Benchmarking"
        title="Comparação com concorrentes"
        subtitle="Preço próprio vs cotações de concorrentes (licitação pública, SIRHAD, manual)"
        backTo={`/contratos/${id}/planilha`}
        backLabel="Planilha"
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4" />Exportar CSV
          </Button>
        }
      />

      {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}

      {!isLoading && rows.length === 0 && (
        <Empty
          title="Nenhuma cotação de concorrente registrada"
          body="Para usar este painel, cadastre preços de concorrentes nos itens. A importação via Excel pode ser feita pela equipe técnica antes da licitação."
        />
      )}

      {!isLoading && rows.length > 0 && (
        <>
          {/* Stats */}
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <StatCard
              label="Mais barato que próprio"
              value={stats.nWon}
              icon={TrendingDown}
              tone="red"
              hint="Concorrente cotou abaixo · perdemos competitividade"
            />
            <StatCard
              label="Mais caro que próprio"
              value={stats.nLost}
              icon={TrendingUp}
              tone="green"
              hint="Concorrente cotou acima · nossa vantagem"
            />
            <Card className="px-4 py-3">
              <div className="flex items-center gap-1.5">
                <Trophy className={`h-3.5 w-3.5 ${stats.sumDiff < 0 ? 'text-error' : 'text-success'}`} aria-hidden />
                <span className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
                  Diferença agregada
                </span>
              </div>
              <p className={`mt-1 font-mono tabular text-2xl font-bold ${stats.sumDiff < 0 ? 'text-error' : 'text-success'}`}>
                {stats.sumDiff >= 0 ? '+' : ''}{brl(stats.sumDiff)}
              </p>
              <p className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                soma das diferenças unitárias
              </p>
            </Card>
          </div>

          {/* Filtros */}
          {competitors.length > 1 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFilterCompetitor('all')}
                className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-display ${
                  filterCompetitor === 'all'
                    ? 'bg-navy text-white dark:bg-purple-600'
                    : 'bg-slate-100 text-slate-700 dark:bg-muted-dark dark:text-slate-300'
                }`}
              >
                Todos · {rows.length}
              </button>
              {competitors.map(([cid, name]) => {
                const count = rows.filter((r) => r.competitor_id === cid).length;
                return (
                  <button
                    key={cid}
                    type="button"
                    onClick={() => setFilterCompetitor(cid)}
                    className={`flex items-center gap-1 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-display ${
                      filterCompetitor === cid
                        ? 'bg-navy text-white dark:bg-purple-600'
                        : 'bg-slate-100 text-slate-700 dark:bg-muted-dark dark:text-slate-300'
                    }`}
                  >
                    <Building2 className="h-3 w-3" />{name} · {count}
                  </button>
                );
              })}
            </div>
          )}

          {/* Tabela */}
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[10px] uppercase tracking-display dark:border-border-dark dark:bg-muted-dark/40">
                <tr>
                  <th className="px-4 py-2 text-left">Item</th>
                  <th className="px-4 py-2 text-left">Concorrente</th>
                  <th className="px-4 py-2 text-right">Próprio</th>
                  <th className="px-4 py-2 text-right">Concorrente</th>
                  <th className="px-4 py-2 text-right">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, idx) => (
                  <tr key={`${r.contract_item_id}-${r.competitor_id}-${idx}`} className="border-t border-slate-100 dark:border-border-dark">
                    <td className="px-4 py-2">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.codigo}</span>
                        <span className="truncate" title={r.descricao}>{r.descricao}</span>
                        <span className="font-mono text-[10px] text-slate-400">{r.unidade}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="text-sm">{r.competitor_name}</div>
                      <div className="flex items-center gap-2 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                        {r.competitor_cnpj && <span>{r.competitor_cnpj}</span>}
                        {r.data_proposta && (
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3 w-3" />{r.data_proposta}
                          </span>
                        )}
                        <Badge tone="slate">{r.origem}</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular">{brl(r.preco_proprio)}</td>
                    <td className="px-4 py-2 text-right font-mono tabular text-slate-700 dark:text-slate-300">{brl(r.preco_competitor)}</td>
                    <td className="px-4 py-2 text-right">
                      <div className={`font-mono tabular font-semibold ${r.diff_pct >= 0 ? 'text-success' : 'text-error'}`}>
                        {r.diff_pct >= 0 ? '+' : ''}{r.diff_pct.toFixed(2)}%
                      </div>
                      <div className="font-mono tabular text-[10px] text-slate-500 dark:text-slate-400">
                        {r.diff_abs >= 0 ? '+' : ''}{brl(r.diff_abs)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            <Trophy className="mr-1 inline h-3 w-3 text-success" />
            Verde = concorrente mais caro (vantagem nossa).
            Vermelho = concorrente mais barato (perdemos competitividade).
          </p>
        </>
      )}
    </Layout>
  );
}

function StatCard({
  icon: Icon, label, value, tone, hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: 'red' | 'green';
  hint: string;
}) {
  const cls = tone === 'red' ? 'text-error' : 'text-success';
  return (
    <Card className={`px-4 py-3 ${value === 0 ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${cls}`} aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
          {label}
        </span>
      </div>
      <p className={`mt-1 font-mono tabular text-2xl font-bold ${cls}`}>{value}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
    </Card>
  );
}
