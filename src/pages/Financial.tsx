import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LineChart, RefreshCw, AlertTriangle, AlertCircle, TrendingUp,
  Receipt, Scissors, Wallet, Calendar,
} from 'lucide-react';
import {
  getContract, getLatestSnapshot, recalcFinancialSnapshot, getCurvaS,
  type FinancialSnapshot,
} from '../lib/api';
import { brl, num, dtTime } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Stat, Skeleton, Progress } from '../components/ui/Stat';

export function Financial() {
  const { id = '' } = useParams();
  const qc = useQueryClient();

  const { data: contract, isLoading: loadingContract } = useQuery({
    queryKey: ['contract', id], queryFn: () => getContract(id), enabled: !!id,
  });
  const { data: snapshot, isLoading: loadingSnap } = useQuery({
    queryKey: ['fin-snapshot', id], queryFn: () => getLatestSnapshot(id), enabled: !!id,
  });
  const { data: curva = [], isLoading: loadingCurva } = useQuery({
    queryKey: ['fin-curva-s', id], queryFn: () => getCurvaS(id), enabled: !!id,
  });

  const recalc = useMutation({
    mutationFn: () => recalcFinancialSnapshot(id, true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fin-snapshot', id] });
      qc.invalidateQueries({ queryKey: ['fin-curva-s', id] });
    },
  });

  return (
    <Layout>
      <PageHeader
        kicker="Contrato · Financeiro"
        title="Painel financeiro"
        subtitle="Curva S, snapshots, retenções, glosas, pagamentos e forecasts"
        backTo={`/contratos/${id}`} backLabel="Contrato"
        actions={
          <Button variant="outline" onClick={() => recalc.mutate()} loading={recalc.isPending}>
            <RefreshCw className="h-4 w-4" />Recalcular snapshot
          </Button>
        }
      />

      {(loadingContract || loadingSnap) && <Skeleton className="h-32" />}

      {snapshot && (
        <>
          {/* KPIs principais */}
          <div className="grid gap-3 md:grid-cols-4">
            <Stat label="Total atualizado" value={brl(snapshot.valor_total_atual)} tone="navy" />
            <Stat
              label="Medido acumulado"
              value={brl(snapshot.valor_medido_acumulado)}
              sub={`${num(snapshot.percentual_financeiro)}% do contrato`}
              tone="magenta"
            />
            <Stat
              label="Pago"
              value={brl(snapshot.total_pago)}
              sub={
                snapshot.valor_medido_acumulado > 0
                  ? `${num((snapshot.total_pago / snapshot.valor_medido_acumulado) * 100)}% do medido`
                  : '—'
              }
              tone="success"
            />
            <Stat
              label="Saldo contratual"
              value={brl(snapshot.saldo_contratual)}
              sub={`Última atualização ${dtTime(snapshot.generated_at)}`}
              tone={snapshot.saldo_contratual < snapshot.valor_total_atual * 0.05 ? 'magenta' : 'navy'}
            />
          </div>

          {/* Risk flags */}
          {snapshot.risk_flags && snapshot.risk_flags.length > 0 && (
            <div className="mt-4 grid gap-2">
              {snapshot.risk_flags.map((f, i) => (
                <RiskFlagCard key={`${f.code}-${i}`} flag={f} />
              ))}
            </div>
          )}

          {/* Físico/financeiro */}
          <Card className="mt-6 p-5">
            <h2 className="font-semibold dark:text-slate-100">Avanço físico × financeiro</h2>
            <p className="mt-1 text-xs text-slate-500">Cálculo automático com base nas medições aprovadas e na quantidade executada por item.</p>
            <div className="mt-4 space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-medium dark:text-slate-100">Físico</span>
                  <span className="tabular font-mono">{num(snapshot.percentual_fisico)}%</span>
                </div>
                <Progress value={snapshot.percentual_fisico} />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-medium dark:text-slate-100">Financeiro</span>
                  <span className="tabular font-mono">{num(snapshot.percentual_financeiro)}%</span>
                </div>
                <Progress value={snapshot.percentual_financeiro} />
              </div>
            </div>
          </Card>

          {/* Forecast desembolso */}
          <Card className="mt-4 p-5">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-purple" />
              <h2 className="font-semibold dark:text-slate-100">Previsão de desembolso</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">Projeção linear baseada na média mensal histórica das medições, limitada ao saldo contratual.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <ForecastCard label="Próximos 3 meses" value={snapshot.forecast_3m} months={3} />
              <ForecastCard label="Próximos 6 meses" value={snapshot.forecast_6m} months={6} />
              <ForecastCard label="Próximos 12 meses" value={snapshot.forecast_12m} months={12} />
            </div>
          </Card>

          {/* Retenções e glosas */}
          <Card className="mt-4 p-5">
            <h2 className="font-semibold dark:text-slate-100">Retenções, glosas e reajustes</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <BreakdownCell icon={<Scissors className="h-4 w-4" />} label="Retenções acumuladas" value={snapshot.total_retencoes} tone="text-orange-700 dark:text-orange-300" />
              <BreakdownCell icon={<AlertTriangle className="h-4 w-4" />} label="Glosas acumuladas" value={snapshot.total_glosas} tone="text-error" />
              <BreakdownCell icon={<Receipt className="h-4 w-4" />} label="Reajustes aplicados" value={snapshot.valor_reajustado_acumulado} tone="text-purple-700 dark:text-purple-300" />
              <BreakdownCell icon={<Wallet className="h-4 w-4" />} label="Aditivos incorporados" value={snapshot.valor_aditado} tone="text-navy dark:text-purple-200" />
            </div>
          </Card>

          {/* Curva S */}
          <Card className="mt-4 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LineChart className="h-5 w-5 text-navy dark:text-purple-300" />
                <h2 className="font-semibold dark:text-slate-100">Curva S físico-financeira</h2>
              </div>
              <Badge tone="slate">{curva.length} período(s)</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-500">Acumulado realizado vs. previsto por mês. Use o cronograma para definir os valores previstos.</p>
            {loadingCurva && <div className="mt-4"><Skeleton className="h-64" /></div>}
            {!loadingCurva && curva.length === 0 && (
              <p className="mt-4 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-border-dark">
                Sem dados. Cadastre o cronograma e tenha pelo menos uma medição aprovada.
              </p>
            )}
            {curva.length > 0 && <CurvaSChart data={curva} valorTotal={snapshot.valor_total_atual} />}
          </Card>
        </>
      )}

      {!loadingSnap && !snapshot && (
        <Card className="p-8 text-center">
          <LineChart className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
          <h2 className="mt-3 font-semibold dark:text-slate-100">Sem snapshot financeiro</h2>
          <p className="mt-1 text-sm text-slate-500">Clique em "Recalcular snapshot" para gerar o primeiro.</p>
          <Button className="mt-4" onClick={() => recalc.mutate()} loading={recalc.isPending}>
            <RefreshCw className="h-4 w-4" />Gerar primeiro snapshot
          </Button>
        </Card>
      )}
    </Layout>
  );
}

function RiskFlagCard({ flag }: { flag: FinancialSnapshot['risk_flags'][number] }) {
  const styles: Record<string, { bg: string; icon: JSX.Element; text: string }> = {
    high:   { bg: 'border-error/40 bg-error/5',   icon: <AlertCircle    className="h-4 w-4 text-error" />, text: 'text-error' },
    medium: { bg: 'border-yellow-400/40 bg-yellow-50 dark:bg-yellow-900/10', icon: <AlertTriangle  className="h-4 w-4 text-yellow-700 dark:text-yellow-300" />, text: 'text-yellow-900 dark:text-yellow-200' },
    low:    { bg: 'border-slate-200 bg-slate-50 dark:bg-muted-dark',         icon: <AlertCircle    className="h-4 w-4 text-slate-500" />, text: 'text-slate-700 dark:text-slate-200' },
  };
  const s = styles[flag.severity] || styles.low;
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${s.bg}`}>
      {s.icon}
      <div className="flex-1">
        <div className={`text-xs font-mono uppercase tracking-wider ${s.text}`}>{flag.code}</div>
        <div className={`text-sm ${s.text}`}>{flag.message}</div>
      </div>
    </div>
  );
}

function ForecastCard({ label, value, months }: { label: string; value: number; months: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-border-dark dark:bg-card-dark">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Calendar className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular dark:text-slate-100">{brl(value)}</div>
      <div className="mt-0.5 text-xs text-slate-500">{months > 0 ? `${brl(value / months)}/mês em média` : ''}</div>
    </div>
  );
}

function BreakdownCell({ icon, label, value, tone }: { icon: JSX.Element; label: string; value: number; tone: string }) {
  return (
    <div>
      <div className={`flex items-center gap-1.5 text-xs ${tone}`}>
        {icon}
        <span className="font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold tabular dark:text-slate-100">{brl(value)}</div>
    </div>
  );
}

// =============================================================================
// CURVA S — SVG inline (sem dependência externa, paleta navy/magenta/slate)
// =============================================================================

interface CurvaSPoint {
  mes: string;
  valor_realizado_acumulado: number;
  valor_previsto_acumulado: number;
}

function CurvaSChart({ data, valorTotal }: { data: CurvaSPoint[]; valorTotal: number }) {
  const W = 900;
  const H = 360;
  const PAD = { top: 20, right: 30, bottom: 50, left: 80 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const series = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.mes.localeCompare(b.mes));
    const maxY = Math.max(
      ...sorted.map((d) => Math.max(d.valor_realizado_acumulado, d.valor_previsto_acumulado)),
      valorTotal,
      1,
    );
    const xStep = innerW / Math.max(sorted.length - 1, 1);
    return sorted.map((d, i) => ({
      ...d,
      x: PAD.left + i * xStep,
      yRealizado: PAD.top + innerH - (d.valor_realizado_acumulado / maxY) * innerH,
      yPrevisto: PAD.top + innerH - (d.valor_previsto_acumulado / maxY) * innerH,
      maxY,
    }));
  }, [data, valorTotal, innerW, innerH]);

  if (series.length === 0) return null;
  const maxY = series[0].maxY;

  const pathRealizado = series.filter((s) => s.valor_realizado_acumulado > 0)
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${s.x.toFixed(1)} ${s.yRealizado.toFixed(1)}`).join(' ');
  const pathPrevisto = series.filter((s) => s.valor_previsto_acumulado > 0)
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${s.x.toFixed(1)} ${s.yPrevisto.toFixed(1)}`).join(' ');

  const yTicks = 5;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) => (maxY / yTicks) * i);

  return (
    <div className="mt-4 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[600px]" role="img" aria-label="Curva S físico-financeira">
        {/* Grid */}
        {tickValues.map((v) => {
          const y = PAD.top + innerH - (v / maxY) * innerH;
          return (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={0.5} />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize={10} fill="#64748b">
                {brl(v)}
              </text>
            </g>
          );
        })}

        {/* Eixo X — labels */}
        {series.map((s, i) => {
          // Mostra só a cada 2 labels para evitar sobreposição
          if (series.length > 6 && i % 2 !== 0 && i !== series.length - 1) return null;
          return (
            <g key={s.mes}>
              <line x1={s.x} x2={s.x} y1={PAD.top + innerH} y2={PAD.top + innerH + 4} stroke="#94a3b8" />
              <text x={s.x} y={PAD.top + innerH + 18} textAnchor="middle" fontSize={9} fill="#64748b">
                {new Date(s.mes).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })}
              </text>
            </g>
          );
        })}

        {/* Linha do total contratual */}
        {valorTotal > 0 && (
          <>
            <line
              x1={PAD.left} x2={W - PAD.right}
              y1={PAD.top + innerH - (valorTotal / maxY) * innerH}
              y2={PAD.top + innerH - (valorTotal / maxY) * innerH}
              stroke="#cbd5e1" strokeWidth={1} strokeDasharray="4,4"
            />
            <text
              x={W - PAD.right - 4}
              y={PAD.top + innerH - (valorTotal / maxY) * innerH - 4}
              textAnchor="end" fontSize={9} fill="#64748b"
            >
              Total contratual
            </text>
          </>
        )}

        {/* Linha previsto */}
        {pathPrevisto && (
          <path d={pathPrevisto} fill="none" stroke="#7c5ddc" strokeWidth={2} strokeDasharray="6,4" />
        )}

        {/* Linha realizado */}
        {pathRealizado && (
          <path d={pathRealizado} fill="none" stroke="#18285f" strokeWidth={2.5} />
        )}

        {/* Pontos realizado */}
        {series.filter((s) => s.valor_realizado_acumulado > 0).map((s) => (
          <circle key={`r-${s.mes}`} cx={s.x} cy={s.yRealizado} r={3.5} fill="#18285f">
            <title>{`${new Date(s.mes).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}\nRealizado: ${brl(s.valor_realizado_acumulado)}`}</title>
          </circle>
        ))}

        {/* Pontos previsto */}
        {series.filter((s) => s.valor_previsto_acumulado > 0).map((s) => (
          <circle key={`p-${s.mes}`} cx={s.x} cy={s.yPrevisto} r={3} fill="#7c5ddc" opacity={0.8}>
            <title>{`${new Date(s.mes).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}\nPrevisto: ${brl(s.valor_previsto_acumulado)}`}</title>
          </circle>
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
        <div className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-6 rounded bg-navy"></span>Realizado acumulado
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-6 rounded bg-purple" style={{ borderTop: '2px dashed', borderColor: '#7c5ddc' }}></span>Previsto acumulado
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-6 rounded" style={{ borderTop: '1px dashed #cbd5e1' }}></span>Total contratual
        </div>
      </div>
    </div>
  );
}
