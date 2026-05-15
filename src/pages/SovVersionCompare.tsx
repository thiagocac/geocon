import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layers, GitCompare, TrendingUp, TrendingDown, Plus, Minus, Equal } from 'lucide-react';
import {
  listSovVersions, compareSovVersions,
  type SovComparisonRow,
} from '../lib/api';
import { brl, num, dt } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Empty, Skeleton } from '../components/ui/Stat';
import { Field, Select } from '../components/ui/FormField';

const SITUACAO_META: Record<SovComparisonRow['situacao'], { label: string; tone: 'slate' | 'green' | 'red' | 'yellow'; icon: JSX.Element }> = {
  incluido:   { label: 'Incluído',   tone: 'green',  icon: <Plus  className="h-3 w-3" /> },
  removido:   { label: 'Removido',   tone: 'red',    icon: <Minus className="h-3 w-3" /> },
  alterado:   { label: 'Alterado',   tone: 'yellow', icon: <GitCompare className="h-3 w-3" /> },
  inalterado: { label: 'Inalterado', tone: 'slate',  icon: <Equal className="h-3 w-3" /> },
};

export function SovVersionCompare() {
  const { id = '' } = useParams();
  const { data: versions = [] } = useQuery({
    queryKey: ['sov-versions', id], queryFn: () => listSovVersions(id), enabled: !!id,
  });

  const [versionA, setVersionA] = useState('');
  const [versionB, setVersionB] = useState('');
  const [showInalterados, setShowInalterados] = useState(false);

  // Pré-seleciona as duas versões mais recentes
  useMemo(() => {
    if (versions.length >= 2 && !versionA && !versionB) {
      const sorted = [...versions].sort((a, b) => b.numero - a.numero);
      setVersionA(sorted[1].id);
      setVersionB(sorted[0].id);
    }
  }, [versions, versionA, versionB]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['sov-compare', versionA, versionB],
    queryFn: () => compareSovVersions(versionA, versionB),
    enabled: !!versionA && !!versionB && versionA !== versionB,
  });

  const filteredRows = showInalterados ? rows : rows.filter((r) => r.situacao !== 'inalterado');

  const totals = useMemo(() => {
    const valorA = rows.reduce((s, r) => s + Number(r.valor_a || 0), 0);
    const valorB = rows.reduce((s, r) => s + Number(r.valor_b || 0), 0);
    const incluidos = rows.filter((r) => r.situacao === 'incluido').length;
    const removidos = rows.filter((r) => r.situacao === 'removido').length;
    const alterados = rows.filter((r) => r.situacao === 'alterado').length;
    const inalterados = rows.filter((r) => r.situacao === 'inalterado').length;
    const deltaValor = valorB - valorA;
    const deltaPct = valorA > 0 ? (deltaValor / valorA) * 100 : 0;
    return { valorA, valorB, incluidos, removidos, alterados, inalterados, deltaValor, deltaPct };
  }, [rows]);

  const vA = versions.find((v) => v.id === versionA);
  const vB = versions.find((v) => v.id === versionB);

  return (
    <Layout>
      <PageHeader
        title="Comparador de versões SOV"
        subtitle="Análise comparativa item a item entre duas versões da planilha contratual"
        backTo={`/contratos/${id}/planilha`} backLabel="Planilha"
      />

      <Card className="mb-4 p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr]">
          <Field label="Versão A (base)" required>
            <Select
              value={versionA}
              onChange={(e) => setVersionA(e.target.value)}
              placeholder="— Selecionar —"
              options={versions.map((v) => ({ value: v.id, label: `v${v.numero} — ${v.status}${v.locked_at ? ' · ' + dt(v.locked_at) : ''}` }))}
            />
          </Field>
          <div className="flex items-end justify-center pb-2 text-slate-400">
            <GitCompare className="h-6 w-6" />
          </div>
          <Field label="Versão B (comparar)" required>
            <Select
              value={versionB}
              onChange={(e) => setVersionB(e.target.value)}
              placeholder="— Selecionar —"
              options={versions.map((v) => ({ value: v.id, label: `v${v.numero} — ${v.status}${v.locked_at ? ' · ' + dt(v.locked_at) : ''}` }))}
            />
          </Field>
        </div>
      </Card>

      {(!versionA || !versionB) && (
        <Empty title="Selecione duas versões" body="Escolha as versões A e B para gerar o comparativo." />
      )}

      {versionA && versionB && versionA === versionB && (
        <Empty title="Versões iguais" body="Selecione duas versões diferentes para comparar." />
      )}

      {versionA && versionB && versionA !== versionB && (
        <>
          {/* KPIs */}
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-border-dark dark:bg-card-dark">
              <div className="text-xs text-slate-500">Total versão A</div>
              <div className="mt-1 text-xl font-semibold tabular dark:text-slate-100">{brl(totals.valorA)}</div>
              {vA && <div className="text-xs text-slate-500">v{vA.numero} · {vA.status}</div>}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-border-dark dark:bg-card-dark">
              <div className="text-xs text-slate-500">Total versão B</div>
              <div className="mt-1 text-xl font-semibold tabular dark:text-slate-100">{brl(totals.valorB)}</div>
              {vB && <div className="text-xs text-slate-500">v{vB.numero} · {vB.status}</div>}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-border-dark dark:bg-card-dark">
              <div className="flex items-center gap-1 text-xs text-slate-500">
                {totals.deltaValor >= 0 ? <TrendingUp className="h-3 w-3 text-green-700 dark:text-green-300" /> : <TrendingDown className="h-3 w-3 text-error" />}
                Variação total
              </div>
              <div className={`mt-1 text-xl font-semibold tabular ${totals.deltaValor >= 0 ? 'text-green-700 dark:text-green-300' : 'text-error'}`}>
                {totals.deltaValor >= 0 ? '+' : ''}{brl(totals.deltaValor)}
              </div>
              <div className="text-xs text-slate-500">{totals.deltaPct >= 0 ? '+' : ''}{totals.deltaPct.toFixed(2)}%</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-border-dark dark:bg-card-dark">
              <div className="text-xs text-slate-500">Resumo das mudanças</div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                {totals.incluidos > 0 && <Badge tone="green">+{totals.incluidos} incluídos</Badge>}
                {totals.removidos > 0 && <Badge tone="red">-{totals.removidos} removidos</Badge>}
                {totals.alterados > 0 && <Badge tone="yellow">{totals.alterados} alterados</Badge>}
                {totals.inalterados > 0 && <Badge tone="slate">{totals.inalterados} inalterados</Badge>}
              </div>
            </div>
          </div>

          {/* Toggle */}
          <Card className="mb-4 p-3">
            <label className="flex items-center gap-2 text-sm dark:text-slate-100">
              <input type="checkbox" checked={showInalterados} onChange={(e) => setShowInalterados(e.target.checked)} />
              Mostrar itens inalterados ({totals.inalterados})
            </label>
          </Card>

          {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}

          {!isLoading && filteredRows.length === 0 && (
            <Empty title="Sem diferenças" body="As versões A e B não têm divergências (descontando inalterados)." />
          )}

          {filteredRows.length > 0 && (
            <Card className="overflow-hidden">
              <table className="table">
                <thead><tr>
                  <th>Situação</th>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Un.</th>
                  <th className="text-right">Qtd A</th>
                  <th className="text-right">Qtd B</th>
                  <th className="text-right">P.unit A</th>
                  <th className="text-right">P.unit B</th>
                  <th className="text-right">Valor A</th>
                  <th className="text-right">Valor B</th>
                  <th className="text-right">Δ Valor</th>
                  <th className="text-right">Δ %</th>
                </tr></thead>
                <tbody>
                  {filteredRows.map((r) => {
                    const meta = SITUACAO_META[r.situacao];
                    return (
                      <tr key={r.codigo} className={r.situacao === 'inalterado' ? 'opacity-60' : ''}>
                        <td>
                          <Badge tone={meta.tone}>
                            {meta.icon}
                            <span className="ml-1">{meta.label}</span>
                          </Badge>
                        </td>
                        <td className="font-mono text-xs">{r.codigo}</td>
                        <td className="max-w-xs truncate" title={r.descricao}>{r.descricao}</td>
                        <td className="text-xs text-slate-500">{r.unidade || '—'}</td>
                        <td className="text-right tabular text-xs">{r.qtd_a !== null ? num(Number(r.qtd_a), 4) : <span className="text-slate-300">—</span>}</td>
                        <td className="text-right tabular text-xs">{r.qtd_b !== null ? num(Number(r.qtd_b), 4) : <span className="text-slate-300">—</span>}</td>
                        <td className="text-right tabular text-xs">{r.preco_unit_a !== null ? brl(Number(r.preco_unit_a)) : <span className="text-slate-300">—</span>}</td>
                        <td className="text-right tabular text-xs">{r.preco_unit_b !== null ? brl(Number(r.preco_unit_b)) : <span className="text-slate-300">—</span>}</td>
                        <td className="text-right tabular text-xs">{brl(Number(r.valor_a || 0))}</td>
                        <td className="text-right tabular text-xs">{brl(Number(r.valor_b || 0))}</td>
                        <td className={`text-right tabular text-xs font-medium ${Number(r.delta_valor || 0) > 0 ? 'text-green-700 dark:text-green-300' : Number(r.delta_valor || 0) < 0 ? 'text-error' : 'text-slate-400'}`}>
                          {Number(r.delta_valor || 0) !== 0 ? `${Number(r.delta_valor) > 0 ? '+' : ''}${brl(Number(r.delta_valor))}` : '—'}
                        </td>
                        <td className="text-right tabular text-xs text-slate-500">
                          {r.delta_pct !== null ? `${Number(r.delta_pct) > 0 ? '+' : ''}${Number(r.delta_pct).toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </Layout>
  );
}
