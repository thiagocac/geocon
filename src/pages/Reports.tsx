import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PieChart, ClipboardList, TrendingUp, Scissors, Flame, HeartPulse,
  Download, Eye, RefreshCw,
} from 'lucide-react';
import { fetchReport, downloadReportCsv, type ReportVariant } from '../lib/api';
import { brl, dtTime } from '../lib/format';
import { humanizeError } from '../lib/errors';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Empty, ErrorState, Skeleton } from '../components/ui/Stat';

interface ReportDef {
  key: ReportVariant;
  label: string;
  description: string;
  icon: typeof PieChart;
  tone: 'navy' | 'purple' | 'magenta' | 'success' | 'warning' | 'error' | 'neutral';
  /** Colunas a destacar na tabela (em ordem). Se ausente, mostra as 8 primeiras chaves. */
  columns?: string[];
  /** Função para formatar uma célula. */
  formatCell?: (col: string, value: unknown) => React.ReactNode;
}

const REPORTS: ReportDef[] = [
  {
    key: 'carteira',
    label: 'Carteira de contratos',
    description: 'KPIs por contrato: valor inicial, aditado, medido, pago, % físico e financeiro.',
    icon: PieChart,
    tone: 'navy',
    columns: ['numero', 'objeto', 'status', 'valor_atual', 'total_medido', 'total_pago', 'pct_financeiro', 'pct_fisico'],
  },
  {
    key: 'pendencias',
    label: 'Pendências consolidadas',
    description: 'Medições em aprovação, GRDs sem confirmação, aditivos parados e itens não previstos.',
    icon: ClipboardList,
    tone: 'warning',
    columns: ['pendencia_tipo', 'contract_numero', 'descricao', 'dias_aberta', 'severidade'],
  },
  {
    key: 'curva_s',
    label: 'Curva-S físico-financeira',
    description: 'Previsto × realizado por mês, com acumulados e desvio.',
    icon: TrendingUp,
    tone: 'purple',
    columns: ['contract_numero', 'periodo', 'valor_previsto_mes', 'valor_realizado_mes', 'valor_previsto_acum', 'valor_realizado_acum', 'desvio_acum'],
  },
  {
    key: 'glosas',
    label: 'Mapa de glosas',
    description: 'Todas as glosas (pendentes/aplicadas) com item, justificativa e valor.',
    icon: Scissors,
    tone: 'magenta',
    columns: ['contract_numero', 'measurement_numero', 'item_codigo', 'escopo', 'valor_glosado', 'status'],
  },
  {
    key: 'top_glosas',
    label: 'Top 50 glosas',
    description: 'Maiores glosas em valor (ordenadas decrescentemente).',
    icon: Flame,
    tone: 'error',
    columns: ['contract_numero', 'measurement_numero', 'item_codigo', 'valor_glosado', 'justificativa'],
  },
  {
    key: 'health',
    label: 'Contratos em risco',
    description: 'Carteira filtrada por risk_flags não vazias (saldo, atraso físico, glosas altas, etc.).',
    icon: HeartPulse,
    tone: 'success',
    columns: ['numero', 'objeto', 'pct_financeiro', 'pct_fisico', 'risk_flags'],
  },
];

const SEVERIDADE_TONE: Record<string, 'red' | 'yellow' | 'slate'> = {
  high: 'red', medium: 'yellow', low: 'slate',
};

const STATUS_TONE: Record<string, 'green' | 'yellow' | 'red' | 'slate'> = {
  paga: 'green', aprovada: 'green', emitida: 'slate',
  em_aprovacao: 'yellow', rascunho: 'slate', preliminar: 'slate',
  cancelada: 'red', retificada: 'slate', devolvida: 'yellow',
  pendente: 'yellow', aplicada: 'green',
};

function formatCell(col: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') return <span className="text-slate-400">—</span>;
  if (col.startsWith('valor_') || col === 'desvio_acum' || col === 'total_medido' || col === 'total_pago' || col === 'valor_atual') {
    const n = Number(value);
    return Number.isFinite(n) ? brl(n) : String(value);
  }
  if (col.startsWith('pct_')) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toFixed(1)}%` : String(value);
  }
  if (col === 'severidade') {
    const s = String(value);
    return <Badge tone={SEVERIDADE_TONE[s] || 'slate'}>{s}</Badge>;
  }
  if (col === 'status') {
    const s = String(value);
    return <Badge tone={STATUS_TONE[s] || 'slate'}>{s}</Badge>;
  }
  if (col === 'risk_flags') {
    try {
      const arr = Array.isArray(value) ? value : JSON.parse(String(value));
      if (!Array.isArray(arr) || arr.length === 0) return <span className="text-slate-400">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {arr.map((f: { code?: string; severity?: string }, i: number) => (
            <Badge key={i} tone={SEVERIDADE_TONE[f.severity || ''] || 'slate'}>{f.code || 'flag'}</Badge>
          ))}
        </div>
      );
    } catch {
      return String(value).slice(0, 40);
    }
  }
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 60);
  return String(value);
}

export function Reports() {
  const [selected, setSelected] = useState<ReportVariant | null>(null);
  const [csvBusy, setCsvBusy] = useState<ReportVariant | null>(null);
  const [csvErr, setCsvErr] = useState<string | null>(null);

  async function handleCsv(v: ReportVariant) {
    setCsvErr(null);
    setCsvBusy(v);
    try {
      await downloadReportCsv(v, null);
    } catch (e) {
      setCsvErr(humanizeError(e));
    } finally {
      setCsvBusy(null);
    }
  }

  return (
    <Layout>
      <PageHeader
        kicker="Análise · Relatórios"
        title="Relatórios"
        subtitle="6 relatórios operacionais consolidados — visualização inline ou download em CSV (compatível Excel)."
      />

      {csvErr && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
          {csvErr}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          const active = selected === r.key;
          return (
            <Card key={r.key} className={`p-5 transition-colors ${active ? 'ring-2 ring-navy dark:ring-purple' : ''}`}>
              <div className="flex items-start gap-3">
                <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-${r.tone === 'success' ? 'green' : r.tone === 'warning' ? 'yellow' : r.tone === 'error' ? 'red' : 'slate'}-100 dark:bg-muted-dark`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold dark:text-slate-100">{r.label}</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{r.description}</p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant={active ? 'primary' : 'outline'} onClick={() => setSelected(active ? null : r.key)}>
                  <Eye className="h-3.5 w-3.5" />
                  {active ? 'Ocultar' : 'Visualizar'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleCsv(r.key)} loading={csvBusy === r.key}>
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {selected && (
        <div className="mt-6">
          <ReportTable variant={selected} def={REPORTS.find((r) => r.key === selected)!} />
        </div>
      )}
    </Layout>
  );
}

function ReportTable({ variant, def }: { variant: ReportVariant; def: ReportDef }) {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['report', variant],
    queryFn: () => fetchReport(variant, null),
  });

  if (isLoading) return <Card className="p-5"><Skeleton className="h-64" /></Card>;
  if (isError) return <ErrorState message={(error as Error).message} />;
  if (!data) return <Empty title="Sem dados" />;

  const rows = data.data || [];
  const cols = def.columns || (rows.length > 0 ? Object.keys(rows[0]).slice(0, 8) : []);
  const totalRows = data.meta.total_rows;
  const displayedRows = rows.slice(0, 100);

  return (
    <Card className="overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-border-dark">
        <div>
          <h2 className="font-semibold dark:text-slate-100">{def.label}</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {totalRows} linha(s){totalRows > 100 ? ` · mostrando primeiras 100` : ''} · gerado em {dtTime(data.meta.generated_at)}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => refetch()} loading={isFetching}>
          <RefreshCw className="h-3.5 w-3.5" />Atualizar
        </Button>
      </header>

      {rows.length === 0 ? (
        <Empty title="Sem registros para este relatório" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 dark:bg-muted-dark dark:text-slate-400">
              <tr>
                {cols.map((c) => (
                  <th key={c} className="px-3 py-2 text-left font-semibold">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-border-dark">
              {displayedRows.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-muted-dark/40">
                  {cols.map((c) => (
                    <td key={c} className="px-3 py-2 align-top dark:text-slate-200">
                      {formatCell(c, (row as Record<string, unknown>)[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
