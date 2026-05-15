import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  ShieldAlert, Activity, AlertTriangle, AlertCircle, TrendingUp,
  Gauge, Lightbulb, ArrowRight, ShieldCheck, Banknote,
  Scale, FileWarning, FileDown, LineChart as LineChartIcon, ExternalLink,
} from 'lucide-react';
import {
  getContractRiskAnalysis, getContractRiskRecommendations,
  listRiskSnapshots, captureRiskSnapshot, generateRiskAnalysisPdf, getReportSignedUrl,
  type RiskRecommendation, type RiskSnapshot,
} from '../lib/api';
import { brl, num, dtTime } from '../lib/format';
import { humanizeError } from '../lib/errors';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Empty, ErrorState, Skeleton, Progress } from '../components/ui/Stat';

type Nivel = 'critico' | 'atencao' | 'monitorar' | 'estavel';

const NIVEL_META: Record<Nivel, { label: string; tone: 'red' | 'yellow' | 'blue' | 'green'; icon: typeof ShieldAlert; bg: string; ring: string }> = {
  critico:    { label: 'Crítico',    tone: 'red',    icon: ShieldAlert,  bg: 'bg-red-50 dark:bg-red-900/15',       ring: 'ring-error/50' },
  atencao:    { label: 'Atenção',    tone: 'yellow', icon: AlertTriangle, bg: 'bg-yellow-50 dark:bg-yellow-900/15', ring: 'ring-warning/50' },
  monitorar:  { label: 'Monitorar',  tone: 'blue',   icon: Activity,     bg: 'bg-blue-50 dark:bg-blue-900/15',      ring: 'ring-blue-400/50' },
  estavel:    { label: 'Estável',    tone: 'green',  icon: ShieldCheck,  bg: 'bg-green-50 dark:bg-green-900/15',    ring: 'ring-success/50' },
};

const PRIORIDADE_META: Record<RiskRecommendation['prioridade'], { tone: 'red' | 'yellow' | 'slate'; label: string }> = {
  alta:  { tone: 'red',    label: 'Alta' },
  media: { tone: 'yellow', label: 'Média' },
  baixa: { tone: 'slate',  label: 'Baixa' },
};

export function ContractRiskAnalysis() {
  const { id = '' } = useParams();
  const [pdfResult, setPdfResult] = useState<{ url: string; code: string } | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const { data: analysis, isLoading, isError, error } = useQuery({
    queryKey: ['risk-analysis', id],
    queryFn: () => getContractRiskAnalysis(id),
    enabled: !!id,
  });

  const { data: recs } = useQuery({
    queryKey: ['risk-recs', id],
    queryFn: () => getContractRiskRecommendations(id),
    enabled: !!id,
  });

  const { data: history = [], refetch: refetchHistory } = useQuery({
    queryKey: ['risk-history', id],
    queryFn: () => listRiskSnapshots(id, 30),
    enabled: !!id,
  });

  // Auto-snapshot 'auto_view' ao abrir a página — idempotente por dia
  useEffect(() => {
    if (!id || !analysis) return;
    captureRiskSnapshot(id, 'auto_view')
      .then(() => refetchHistory())
      .catch(() => { /* ignora — apenas analytics */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, analysis?.contract_id]);

  const exportPdf = useMutation({
    mutationFn: async () => {
      const out = await generateRiskAnalysisPdf(id);
      const url = await getReportSignedUrl(out.storage_path, 600);
      return { url, code: out.public_validation_code };
    },
    onSuccess: (data) => {
      setPdfResult(data);
      setPdfError(null);
      refetchHistory();
    },
    onError: (e) => setPdfError(humanizeError(e as Error)),
  });


  if (isLoading) {
    return (
      <Layout>
        <Skeleton className="mb-6 h-16" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </Layout>
    );
  }
  if (isError) return <Layout><ErrorState message={(error as Error).message} /></Layout>;
  if (!analysis) return <Layout><Empty title="Sem análise" body="Contrato não encontrado ou ainda sem snapshot financeiro." /></Layout>;

  const nivel: Nivel = recs?.nivel || (
    analysis.score >= 70 ? 'critico' :
    analysis.score >= 40 ? 'atencao' :
    analysis.score >= 20 ? 'monitorar' : 'estavel'
  );
  const nivelMeta = NIVEL_META[nivel];
  const NivelIcon = nivelMeta.icon;

  return (
    <Layout>
      <PageHeader
        title="Análise de risco"
        subtitle={`${analysis.numero} — ${analysis.objeto.slice(0, 80)}${analysis.objeto.length > 80 ? '…' : ''}`}
        backTo={`/contratos/${id}`}
        backLabel="Contrato"
        actions={
          <Button variant="outline" onClick={() => exportPdf.mutate()} loading={exportPdf.isPending}>
            <FileDown className="h-4 w-4" />Exportar PDF
          </Button>
        }
      />

      {pdfResult && (
        <Card className="mb-4 flex items-center justify-between gap-3 border-success/40 bg-success/5 p-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-success" />
            <div>
              <p className="text-sm font-medium text-success">PDF gerado com sucesso</p>
              <p className="text-xs text-slate-600 dark:text-slate-300">Código de validação pública: <span className="font-mono">{pdfResult.code}</span></p>
            </div>
          </div>
          <a href={pdfResult.url} target="_blank" rel="noopener noreferrer">
            <Button size="sm"><ExternalLink className="h-3.5 w-3.5" />Abrir PDF</Button>
          </a>
        </Card>
      )}
      {pdfError && (
        <Card className="mb-4 flex items-center gap-3 border-error/40 bg-error/5 p-4">
          <AlertCircle className="h-5 w-5 text-error" />
          <p className="text-sm text-error">{pdfError}</p>
        </Card>
      )}

      {/* Score header */}
      <Card className={`mb-4 overflow-hidden p-6 ring-1 ${nivelMeta.bg} ${nivelMeta.ring}`}>
        <div className="flex items-center gap-5">
          <div className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl ${nivelMeta.bg} ring-2 ${nivelMeta.ring}`}>
            <NivelIcon className="h-10 w-10" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Badge tone={nivelMeta.tone}>{nivelMeta.label}</Badge>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {analysis.snapshot_at ? `Último snapshot: ${new Date(analysis.snapshot_at).toLocaleDateString('pt-BR')}` : 'Score calculado on-demand'}
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-5xl font-bold tabular text-slate-900 dark:text-slate-100">{analysis.score}</span>
              <span className="text-sm text-slate-500 dark:text-slate-400">/ 100</span>
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Composto por avanço, alertas legais, gap físico-financeiro e saldo restante
            </p>
          </div>
          <div className="hidden md:block">
            <div className="text-right">
              <p className="text-xs uppercase text-slate-500">Valor atual</p>
              <p className="font-mono text-xl font-semibold tabular dark:text-slate-100">{brl(analysis.valor_atual)}</p>
              <p className="mt-2 text-xs uppercase text-slate-500">Saldo</p>
              <p className="font-mono text-sm tabular dark:text-slate-100">{brl(analysis.saldo_contratual)} <span className="text-slate-500">({num(analysis.pct_saldo)}%)</span></p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Breakdown do score */}
        <Card className="p-5 lg:col-span-2">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
            <Gauge className="h-5 w-5 text-navy dark:text-purple-300" />
            Composição do score
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Cada componente contribui de forma independente. Componentes em zero não aparecem como problema.
          </p>

          <div className="mt-5 space-y-4">
            <ScoreComponent
              icon={<TrendingUp className="h-4 w-4" />}
              label="Avanço financeiro"
              detail={`${num(analysis.percentual_financeiro)}% medido / ${num(analysis.percentual_fisico)}% físico`}
              score={analysis.score_avanco}
              maxScore={30}
              hint={
                analysis.score_avanco === 30 ? 'Próximo do encerramento (≥ 95%)'
                : analysis.score_avanco === 15 ? 'Avanço alto (≥ 80%) — planejar pré-fechamento'
                : 'Em ritmo normal'
              }
            />
            <ScoreComponent
              icon={<FileWarning className="h-4 w-4" />}
              label="Alertas legais"
              detail={analysis.alertas.length > 0 ? analysis.alertas.join('; ') : 'Nenhum alerta legal ativo'}
              score={analysis.score_alertas_legais}
              maxScore={25}
              hint={analysis.score_alertas_legais > 0 ? 'Requer revisão contratual/jurídica' : 'OK'}
            />
            <ScoreComponent
              icon={<Scale className="h-4 w-4" />}
              label="Gap físico-financeiro"
              detail={`${num(analysis.gap_fis_fin)}pp ${analysis.gap_fis_fin >= 0 ? 'à frente' : 'atrás'}`}
              score={analysis.score_gap}
              maxScore={25}
              hint={analysis.score_gap > 0 ? 'Financeiro descolado — risco de antecipação indevida' : 'Avanços alinhados'}
            />
            <ScoreComponent
              icon={<Banknote className="h-4 w-4" />}
              label="Saldo remanescente"
              detail={`${brl(analysis.saldo_contratual)} (${num(analysis.pct_saldo)}% do valor atual)`}
              score={analysis.score_saldo}
              maxScore={20}
              hint={analysis.score_saldo > 0 ? 'Saldo crítico (≤ 5%) — decisão urgente' : 'Saldo adequado'}
            />
          </div>
        </Card>

        {/* Sinais operacionais */}
        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
            <Activity className="h-5 w-5 text-navy dark:text-purple-300" />
            Sinais operacionais
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Adicionais ao score, mas relevantes</p>

          <div className="mt-4 space-y-3">
            <SignalRow
              label="Pendências de alta severidade"
              value={String(analysis.pendencias_high)}
              tone={analysis.pendencias_high > 0 ? 'error' : 'slate'}
              sub={analysis.pendencias_high > 0
                ? `mais antiga: ${analysis.pendencia_mais_antiga_dias} dia(s)`
                : 'sem pendências críticas'}
            />
            <SignalRow
              label="Pendências de média"
              value={String(analysis.pendencias_medium)}
              tone={analysis.pendencias_medium > 0 ? 'warning' : 'slate'}
            />
            <SignalRow
              label="Medições em aprovação > 7d"
              value={String(analysis.medicoes_em_aprovacao_atrasadas)}
              tone={analysis.medicoes_em_aprovacao_atrasadas > 0 ? 'warning' : 'slate'}
              sub={analysis.medicoes_em_aprovacao_atrasadas > 0 ? 'ciclo de aprovação estagnado' : 'em dia'}
            />
            <SignalRow
              label="Aditivos vs. valor inicial"
              value={`${num(analysis.pct_aditivos_sobre_inicial)}%`}
              tone={
                analysis.pct_aditivos_sobre_inicial > 24 ? 'error' :
                analysis.pct_aditivos_sobre_inicial > 15 ? 'warning' : 'slate'
              }
              sub={
                analysis.pct_aditivos_sobre_inicial > 24 ? 'limite legal próximo ou excedido' :
                analysis.pct_aditivos_sobre_inicial > 15 ? 'monitorar — próximo do limite (25%)' :
                'dentro de margem confortável'
              }
            />
          </div>
        </Card>
      </div>

      {/* Forecast desembolso */}
      {(analysis.forecast_3m != null || analysis.forecast_6m != null || analysis.forecast_12m != null) && (
        <Card className="mt-4 p-5">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
            <TrendingUp className="h-5 w-5 text-purple" />
            Forecast vs. saldo
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Estimativa de desembolso projetado (do último snapshot financeiro) confrontada com saldo restante
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <ForecastCard label="Próximos 3 meses" forecast={analysis.forecast_3m} saldo={analysis.saldo_contratual} />
            <ForecastCard label="Próximos 6 meses" forecast={analysis.forecast_6m} saldo={analysis.saldo_contratual} />
            <ForecastCard label="Próximos 12 meses" forecast={analysis.forecast_12m} saldo={analysis.saldo_contratual} />
          </div>
        </Card>
      )}

      {/* Histórico do score */}
      {history.length > 1 && (
        <Card className="mt-4 p-5">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
            <LineChartIcon className="h-5 w-5 text-purple" />
            Evolução do score
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Últimas {history.length} captura(s). Cada visita a esta página gera um snapshot 'auto_view' (1 por dia).
          </p>
          <RiskTrendChart snapshots={history} />
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <TrendStat label="Último score" value={String(history[0]?.score ?? '—')} tone={history[0] ? nivelToTone(history[0].nivel) : 'slate'} />
            <TrendStat label="Pico (período)" value={String(Math.max(...history.map((s) => s.score)))} tone="red" />
            <TrendStat label="Mínimo" value={String(Math.min(...history.map((s) => s.score)))} tone="green" />
            <TrendStat label="Média" value={String(Math.round(history.reduce((a, s) => a + s.score, 0) / history.length))} tone="slate" />
          </div>
        </Card>
      )}

      {/* Recomendações */}
      <Card className="mt-4 p-5">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
          <Lightbulb className="h-5 w-5 text-yellow-500" />
          Recomendações
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Ações sugeridas com base no perfil de risco. Cada recomendação aponta para o módulo correspondente.
        </p>

        {(!recs || recs.recommendations.length === 0) && (
          <p className="mt-4 text-sm text-slate-500">Sem recomendações no momento.</p>
        )}

        <ul className="mt-4 space-y-2">
          {recs?.recommendations.map((rec, i) => {
            const meta = PRIORIDADE_META[rec.prioridade];
            return (
              <li key={`${rec.tipo}-${i}`} className="flex items-start gap-3 rounded-lg border border-slate-200 p-4 dark:border-border-dark">
                <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  rec.prioridade === 'alta' ? 'bg-red-100 dark:bg-red-900/30' :
                  rec.prioridade === 'media' ? 'bg-yellow-100 dark:bg-yellow-900/30' :
                  'bg-slate-100 dark:bg-muted-dark'
                }`}>
                  {rec.prioridade === 'alta' ? <AlertCircle className="h-4 w-4 text-error" /> :
                   rec.prioridade === 'media' ? <AlertTriangle className="h-4 w-4 text-warning" /> :
                   <ShieldCheck className="h-4 w-4 text-success" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-slate-900 dark:text-slate-100">{rec.titulo}</h3>
                    <Badge tone={meta.tone} className="text-[10px]">{meta.label}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{rec.descricao}</p>
                </div>
                <Link to={rec.acao_href} className="shrink-0">
                  <Button variant="outline" size="sm">{rec.acao_label}<ArrowRight className="h-3.5 w-3.5" /></Button>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </Layout>
  );
}

function ScoreComponent({ icon, label, detail, score, maxScore, hint }: {
  icon: JSX.Element; label: string; detail: string; score: number; maxScore: number; hint: string;
}) {
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  const isProblematic = score > 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={isProblematic ? 'text-error' : 'text-slate-500 dark:text-slate-400'}>{icon}</span>
          <span className="font-medium text-slate-700 dark:text-slate-200">{label}</span>
        </div>
        <span className={`font-mono text-xs ${isProblematic ? 'text-error' : 'text-slate-500'}`}>
          {score}<span className="text-slate-400"> / {maxScore}</span>
        </span>
      </div>
      <Progress value={pct} />
      <p className="mt-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>{detail}</span>
        <span className={isProblematic ? 'italic text-error' : 'italic'}>{hint}</span>
      </p>
    </div>
  );
}

function SignalRow({ label, value, tone, sub }: {
  label: string; value: string; tone: 'error' | 'warning' | 'slate'; sub?: string;
}) {
  const cls = tone === 'error' ? 'text-error border-error/30 bg-error/5' :
              tone === 'warning' ? 'text-warning border-warning/30 bg-warning/5' :
              'text-slate-700 dark:text-slate-200 border-slate-200 dark:border-border-dark';
  return (
    <div className={`flex items-center justify-between rounded-lg border p-3 ${cls}`}>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wider">{label}</p>
        {sub && <p className="mt-0.5 text-xs italic opacity-80">{sub}</p>}
      </div>
      <span className="font-mono text-xl font-semibold tabular">{value}</span>
    </div>
  );
}

function ForecastCard({ label, forecast, saldo }: { label: string; forecast: number | null; saldo: number }) {
  const f = Number(forecast || 0);
  const excede = f > saldo;
  const pct = saldo > 0 ? Math.min(100, (f / saldo) * 100) : 0;
  return (
    <div className={`rounded-lg border p-3 ${excede ? 'border-error/40 bg-error/5' : 'border-slate-200 dark:border-border-dark'}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold tabular dark:text-slate-100">{brl(f)}</p>
      <Progress value={pct} />
      <p className="mt-1 text-xs">
        {excede ? <span className="text-error">excede o saldo em {brl(f - saldo)}</span> :
         <span className="text-slate-500">{num(pct)}% do saldo</span>}
      </p>
    </div>
  );
}

function nivelToTone(nivel: RiskSnapshot['nivel']): 'red' | 'yellow' | 'blue' | 'green' | 'slate' {
  if (nivel === 'critico') return 'red';
  if (nivel === 'atencao') return 'yellow';
  if (nivel === 'monitorar') return 'blue';
  return 'green';
}

function TrendStat({ label, value, tone }: { label: string; value: string; tone: 'red' | 'yellow' | 'blue' | 'green' | 'slate' }) {
  const toneCls: Record<string, string> = {
    red:    'border-error/30 bg-error/5 text-error',
    yellow: 'border-warning/30 bg-warning/5 text-warning',
    blue:   'border-blue-400/30 bg-blue-50 text-blue-700 dark:bg-blue-900/15 dark:text-blue-200',
    green:  'border-success/30 bg-success/5 text-success',
    slate:  'border-slate-200 bg-slate-50 text-slate-700 dark:border-border-dark dark:bg-muted-dark dark:text-slate-200',
  };
  return (
    <div className={`rounded-lg border p-2 ${toneCls[tone]}`}>
      <p className="text-[10px] font-medium uppercase tracking-wider opacity-80">{label}</p>
      <p className="font-mono text-xl font-semibold tabular">{value}</p>
    </div>
  );
}

function RiskTrendChart({ snapshots }: { snapshots: RiskSnapshot[] }) {
  // snapshots vem ordenado por captured_at DESC; revertemos para timeline natural
  const series = snapshots.slice().reverse();
  if (series.length < 2) return null;

  const W = 600;
  const H = 180;
  const PAD = { top: 20, right: 16, bottom: 28, left: 36 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const maxScore = 100;

  const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;
  const yAt = (s: number) => PAD.top + innerH - (s / maxScore) * innerH;
  const xAt = (i: number) => PAD.left + i * stepX;

  const points = series.map((s, i) => `${xAt(i)},${yAt(s.score)}`).join(' ');

  // limiares horizontais
  const thresholds = [
    { v: 70, label: 'Crítico', stroke: '#ef4444' },
    { v: 40, label: 'Atenção', stroke: '#f59e0b' },
    { v: 20, label: 'Monitorar', stroke: '#3b82f6' },
  ];

  return (
    <div className="mt-4 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-full" style={{ minWidth: 480 }}>
        {/* Eixo Y - grid */}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yAt(v)} y2={yAt(v)} stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeWidth={0.5} strokeDasharray="2 3" />
            <text x={PAD.left - 6} y={yAt(v) + 3} textAnchor="end" fontSize="9" className="fill-slate-500 dark:fill-slate-400">{v}</text>
          </g>
        ))}

        {/* Limiares */}
        {thresholds.map((t) => (
          <line key={t.v} x1={PAD.left} x2={W - PAD.right} y1={yAt(t.v)} y2={yAt(t.v)} stroke={t.stroke} strokeWidth={0.5} strokeDasharray="4 2" opacity={0.4} />
        ))}

        {/* Linha do score */}
        <polyline fill="none" stroke="#7e22ce" strokeWidth={2} points={points} strokeLinejoin="round" strokeLinecap="round" />

        {/* Área sob a curva */}
        <polygon
          fill="url(#riskGradient)"
          opacity={0.15}
          points={`${PAD.left},${PAD.top + innerH} ${points} ${PAD.left + (series.length - 1) * stepX},${PAD.top + innerH}`}
        />
        <defs>
          <linearGradient id="riskGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7e22ce" stopOpacity={0.6} />
            <stop offset="100%" stopColor="#7e22ce" stopOpacity={0.05} />
          </linearGradient>
        </defs>

        {/* Pontos */}
        {series.map((s, i) => {
          const cx = xAt(i);
          const cy = yAt(s.score);
          const color = s.nivel === 'critico' ? '#ef4444' :
                        s.nivel === 'atencao' ? '#f59e0b' :
                        s.nivel === 'monitorar' ? '#3b82f6' : '#16a34a';
          return (
            <g key={s.id}>
              <circle cx={cx} cy={cy} r={3} fill={color} stroke="white" strokeWidth={1}>
                <title>{`${dtTime(s.captured_at)} — Score ${s.score} (${s.nivel}) · origem: ${s.source}`}</title>
              </circle>
            </g>
          );
        })}

        {/* Eixo X - rótulos de data (apenas alguns) */}
        {series.map((s, i) => {
          if (series.length <= 6 || i === 0 || i === series.length - 1 || i % Math.ceil(series.length / 5) === 0) {
            const d = new Date(s.captured_at);
            const label = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
            return (
              <text key={`x-${s.id}`} x={xAt(i)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize="9" className="fill-slate-500 dark:fill-slate-400">
                {label}
              </text>
            );
          }
          return null;
        })}

        {/* Labels dos limiares */}
        <text x={W - PAD.right + 2} y={yAt(70) + 3} fontSize="8" className="fill-error" textAnchor="start">70</text>
        <text x={W - PAD.right + 2} y={yAt(40) + 3} fontSize="8" className="fill-warning" textAnchor="start">40</text>
      </svg>
    </div>
  );
}
