import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { useState, useMemo } from 'react';
import {
  AlertOctagon, AlertTriangle, TrendingUp, TrendingDown,
  Search, X, ArrowUpDown, FileSearch, Info,
} from 'lucide-react';
import {
  listContractPriceAudit, getContractPriceAuditSummary,
  type PriceAuditItem, type PriceAuditMagnitude, type PriceAuditSinal,
} from '../lib/api';
import { brl, num, dt } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Empty, ErrorState, Skeleton } from '../components/ui/Stat';
import { Select } from '../components/ui/FormField';
import { Button } from '../components/ui/Button';

type MagnitudeFilter = 'all' | PriceAuditMagnitude;
type SinalFilter     = 'all' | PriceAuditSinal;

const MAGNITUDE_TONE: Record<PriceAuditMagnitude, { text: string; bg: string; label: string }> = {
  pequena: { text: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-muted-dark', label: 'Pequena' },
  media:   { text: 'text-yellow-700 dark:text-yellow-300', bg: 'bg-yellow-100 dark:bg-yellow-900/30', label: 'Média' },
  alta:    { text: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-100 dark:bg-orange-900/30', label: 'Alta' },
  critica: { text: 'text-error', bg: 'bg-error/15 dark:bg-error/20', label: 'Crítica' },
};

export function ContractPriceAudit() {
  const { id = '' } = useParams();
  const [search, setSearch] = useState('');
  const [filterMagnitude, setFilterMagnitude] = useState<MagnitudeFilter>('all');
  const [filterSinal, setFilterSinal]         = useState<SinalFilter>('all');

  const { data: items = [], isLoading, isError, error } = useQuery({
    queryKey: ['price-audit', id],
    queryFn: () => listContractPriceAudit(id),
    enabled: !!id,
  });
  const { data: summary } = useQuery({
    queryKey: ['price-audit-summary', id],
    queryFn: () => getContractPriceAuditSummary(id),
    enabled: !!id,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (q) {
        const hay = (it.codigo + ' ' + it.descricao).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterMagnitude !== 'all' && it.magnitude !== filterMagnitude) return false;
      if (filterSinal     !== 'all' && it.sinal     !== filterSinal)     return false;
      return true;
    });
  }, [items, search, filterMagnitude, filterSinal]);

  const hasActiveFilters = !!(search || filterMagnitude !== 'all' || filterSinal !== 'all');
  function clearFilters() {
    setSearch(''); setFilterMagnitude('all'); setFilterSinal('all');
  }

  return (
    <Layout>
      <PageHeader
        kicker="Contrato · Auditoria de preços"
        title="Auditoria de divergência vs SINAPI/SICRO"
        subtitle="Compara preço contratado vs referência oficial mais recente · ordenado por divergência absoluta"
        backTo={`/contratos/${id}/planilha`}
        backLabel="Planilha"
      />

      {summary && (
        <div className="mb-4 grid gap-3 text-sm md:grid-cols-4">
          <Card className="px-4 py-3">
            <div className="flex items-center gap-1.5">
              <FileSearch className="h-3.5 w-3.5 text-slate-500" aria-hidden />
              <p className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
                Cobertura
              </p>
            </div>
            <p className="mt-1 font-mono tabular text-2xl font-bold dark:text-slate-100">
              {summary.cobertura_pct}%
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {summary.items_auditados} de {summary.items_total} itens com referência
            </p>
          </Card>
          <Card className="px-4 py-3">
            <div className="flex items-center gap-1.5">
              <AlertOctagon className="h-3.5 w-3.5 text-error" aria-hidden />
              <p className="font-mono text-[10px] uppercase tracking-display text-error">
                Crítica
              </p>
            </div>
            <p className="mt-1 font-mono tabular text-2xl font-bold text-error">
              {summary.magnitudes.critica}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {summary.magnitudes.alta} alta · {summary.magnitudes.media} média · {summary.magnitudes.pequena} pequena
            </p>
          </Card>
          <Card className="px-4 py-3">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-error" aria-hidden />
              <p className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
                Impacto acima
              </p>
            </div>
            <p className="mt-1 font-mono tabular text-2xl font-bold text-error">
              {brl(summary.impacto.acima)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {summary.sinais.caros} item{summary.sinais.caros === 1 ? '' : 's'} acima da referência
            </p>
          </Card>
          <Card className="px-4 py-3">
            <div className="flex items-center gap-1.5">
              <TrendingDown className="h-3.5 w-3.5 text-success" aria-hidden />
              <p className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
                Impacto abaixo
              </p>
            </div>
            <p className="mt-1 font-mono tabular text-2xl font-bold text-success">
              {brl(summary.impacto.abaixo)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {summary.sinais.baratos} item{summary.sinais.baratos === 1 ? '' : 's'} abaixo · líquido {brl(summary.impacto.liquido)}
            </p>
          </Card>
        </div>
      )}

      {/* Filtros */}
      {items.length > 0 && (
        <Card className="mb-4 p-4">
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                     placeholder="Buscar por código ou descrição…" className="input pl-10" />
            </div>
            <Select
              value={filterMagnitude}
              onChange={(e) => setFilterMagnitude(e.target.value as MagnitudeFilter)}
              placeholder="Magnitude · todas"
              options={[
                { value: 'all',     label: 'Magnitude · todas' },
                { value: 'critica', label: 'Crítica (>30%)' },
                { value: 'alta',    label: 'Alta (15–30%)' },
                { value: 'media',   label: 'Média (5–15%)' },
                { value: 'pequena', label: 'Pequena (≤5%)' },
              ]}
            />
            <Select
              value={filterSinal}
              onChange={(e) => setFilterSinal(e.target.value as SinalFilter)}
              placeholder="Sinal · todos"
              options={[
                { value: 'all',    label: 'Sinal · todos' },
                { value: 'caro',   label: 'Acima da referência' },
                { value: 'barato', label: 'Abaixo da referência' },
              ]}
            />
            <Button variant="ghost" onClick={clearFilters} disabled={!hasActiveFilters} title="Limpar filtros">
              <X className="h-4 w-4" />Limpar
            </Button>
          </div>
        </Card>
      )}

      {isError && <ErrorState message={(error as Error).message} />}
      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}
      {!isLoading && !isError && items.length === 0 && (
        <Empty
          title="Sem auditoria disponível"
          body="Nenhum item deste contrato tem referência de preço cadastrada. Importe via SINAPI/SICRO no Wizard de planilha para habilitar a análise."
          action={<Link to={`/contratos/${id}/planilha`}><Button variant="outline">Voltar à planilha</Button></Link>}
        />
      )}
      {!isLoading && items.length > 0 && filtered.length === 0 && (
        <Empty
          title="Nenhum item nos filtros"
          body="Ajuste os filtros para ver itens auditados."
          action={<Button variant="outline" onClick={clearFilters}><X className="h-4 w-4" />Limpar filtros</Button>}
        />
      )}

      {!isLoading && filtered.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/50 px-4 py-2 text-xs text-slate-600 dark:border-border-dark dark:bg-muted-dark/30 dark:text-slate-400">
            <Info className="mr-1 inline h-3 w-3" aria-hidden />
            Ordenado por divergência decrescente · {filtered.length} item{filtered.length === 1 ? '' : 's'}
          </div>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th className="text-center">Un.</th>
                  <th className="text-right">Preço contrato</th>
                  <th className="text-right">Referência</th>
                  <th>Fonte</th>
                  <th className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <ArrowUpDown className="h-3 w-3" />Divergência
                    </span>
                  </th>
                  <th className="text-right">Impacto</th>
                  <th>Magnitude</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <AuditRow key={it.id} item={it} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Layout>
  );
}

function AuditRow({ item }: { item: PriceAuditItem }) {
  const cfg = MAGNITUDE_TONE[item.magnitude];
  const SignIcon = item.sinal === 'caro' ? TrendingUp : TrendingDown;
  const signColor = item.sinal === 'caro' ? 'text-error' : 'text-success';

  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-muted-dark">
      <td className="font-mono text-xs">{item.codigo}</td>
      <td className="max-w-md">
        <p className="truncate font-medium text-slate-900 dark:text-slate-100" title={item.descricao}>
          {item.descricao}
        </p>
        {item.ref_codigo && (
          <p className="truncate text-xs text-slate-500" title={item.ref_descricao || ''}>
            ref: {item.ref_codigo}{item.ref_descricao ? ` — ${item.ref_descricao}` : ''}
          </p>
        )}
      </td>
      <td className="text-center text-xs uppercase text-slate-600 dark:text-slate-300">
        {item.unidade || '—'}
      </td>
      <td className="text-right tabular">{brl(item.preco_contrato)}</td>
      <td className="text-right tabular text-slate-600 dark:text-slate-400">{brl(item.preco_referencia)}</td>
      <td>
        <p className="font-mono text-xs text-slate-700 dark:text-slate-300">
          {item.ref_base}{item.ref_uf ? `/${item.ref_uf}` : ''}
        </p>
        {item.ref_data_base && (
          <p className="font-mono text-[10px] text-slate-500">
            base {dt(item.ref_data_base)}
          </p>
        )}
      </td>
      <td className={`text-right tabular font-medium ${signColor}`}>
        <span className="inline-flex items-center gap-1">
          <SignIcon className="h-3 w-3" aria-hidden />
          {item.divergencia_pct > 0 ? '+' : ''}{item.divergencia_pct.toFixed(1)}%
        </span>
      </td>
      <td className={`text-right tabular ${signColor}`}>
        {item.divergencia_pct > 0 ? '+' : ''}{brl(item.impacto_valor)}
      </td>
      <td>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-display ${cfg.bg} ${cfg.text}`}>
          {item.magnitude === 'critica' || item.magnitude === 'alta' ? (
            <AlertOctagon className="h-3 w-3" />
          ) : item.magnitude === 'media' ? (
            <AlertTriangle className="h-3 w-3" />
          ) : null}
          {cfg.label}
        </span>
      </td>
    </tr>
  );
}
