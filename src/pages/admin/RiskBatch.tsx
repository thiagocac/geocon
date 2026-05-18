import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, Clock, CheckCircle2, RefreshCw, ChevronRight,
  Calendar, TrendingDown, TrendingUp,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  listStaleRiskContracts, refreshRiskSnapshots,
  type StaleRiskContract, type RefreshRiskResult,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { relativeTime, dtTime } from '../../lib/format';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Skeleton, Empty, ErrorState } from '../../components/ui/Stat';
import { Field, Select } from '../../components/ui/FormField';

const AGE_OPTIONS = [
  { value: '7',  label: 'Mais de 7 dias' },
  { value: '14', label: 'Mais de 14 dias (padrão)' },
  { value: '30', label: 'Mais de 30 dias' },
  { value: '60', label: 'Mais de 60 dias' },
];

const LIMIT_OPTIONS = [
  { value: '10',  label: 'Até 10 por execução' },
  { value: '25',  label: 'Até 25 por execução' },
  { value: '50',  label: 'Até 50 (padrão)' },
  { value: '100', label: 'Até 100' },
];

function FreshnessBadge({ f }: { f: StaleRiskContract['freshness'] }) {
  if (f === 'never')    return <Badge tone="red">Nunca capturado</Badge>;
  if (f === 'critical') return <Badge tone="red">Crítico (&gt;30d)</Badge>;
  if (f === 'stale')    return <Badge tone="yellow">Stale (&gt;14d)</Badge>;
  return <Badge tone="green">Fresco</Badge>;
}

function NivelBadge({ n }: { n: string }) {
  if (n === 'critico')   return <Badge tone="red">crítico</Badge>;
  if (n === 'atencao')   return <Badge tone="yellow">atenção</Badge>;
  if (n === 'monitorar') return <Badge tone="blue">monitorar</Badge>;
  return <Badge tone="green">estável</Badge>;
}

export function AdminRiskBatch() {
  const qc = useQueryClient();
  const [maxAge, setMaxAge] = useState('14');
  const [maxContracts, setMaxContracts] = useState('50');
  const [result, setResult] = useState<RefreshRiskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data = [], isLoading, error: queryError, refetch } = useQuery({
    queryKey: ['stale-risk', maxAge, maxContracts],
    queryFn: () => listStaleRiskContracts(Number(maxAge), Number(maxContracts)),
  });

  const mRefresh = useMutation({
    mutationFn: () => refreshRiskSnapshots(Number(maxAge), Number(maxContracts)),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ['stale-risk'] });
    },
    onError: (err) => {
      setError(humanizeError(err));
      setConfirmOpen(false);
    },
  });

  const counts = {
    total: data.length,
    never: data.filter((c) => c.freshness === 'never').length,
    critical: data.filter((c) => c.freshness === 'critical').length,
    stale: data.filter((c) => c.freshness === 'stale').length,
  };

  return (
    <>
      <Layout>
        <PageHeader
          kicker="Administração · Análise de risco"
          title="Atualização em batch"
          subtitle="Recalcula snapshots de risco de contratos com captura ausente ou desatualizada"
          backTo="/admin"
          backLabel="Admin"
          actions={
            <Button
              variant="outline"
              onClick={() => refetch()}
              loading={isLoading}
              title="Recarregar lista"
            >
              <RefreshCw className="h-4 w-4" />Recarregar
            </Button>
          }
        />

        {/* KPIs */}
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <Card densityAware className="p-4">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
              Pendentes
            </p>
            <p className="mt-1 text-2xl font-bold tabular dark:text-slate-100">{counts.total}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">contratos no filtro</p>
          </Card>
          <Card densityAware className="p-4">
            <div className="flex items-start justify-between">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Nunca capturados
              </p>
              {counts.never > 0 && <AlertTriangle className="h-4 w-4 text-error" />}
            </div>
            <p className="mt-1 text-2xl font-bold tabular text-error">{counts.never}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">sem snapshot histórico</p>
          </Card>
          <Card densityAware className="p-4">
            <div className="flex items-start justify-between">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Críticos
              </p>
              {counts.critical > 0 && <Clock className="h-4 w-4 text-error" />}
            </div>
            <p className="mt-1 text-2xl font-bold tabular text-error">{counts.critical}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">snapshot &gt;30 dias</p>
          </Card>
          <Card densityAware className="p-4">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
              Stale
            </p>
            <p className="mt-1 text-2xl font-bold tabular text-amber-600 dark:text-amber-300">{counts.stale}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">snapshot 14-30 dias</p>
          </Card>
        </div>

        {/* Controles + ação */}
        <Card className="mb-4 p-4">
          <div className="grid gap-3 md:grid-cols-3 md:items-end">
            <Field label="Idade mínima" hint="Inclui também contratos sem nenhum snapshot">
              <Select
                value={maxAge}
                onChange={(e) => setMaxAge(e.target.value)}
                options={AGE_OPTIONS}
              />
            </Field>
            <Field label="Limite por execução" hint="Cada captura roda em sequência via Edge Function">
              <Select
                value={maxContracts}
                onChange={(e) => setMaxContracts(e.target.value)}
                options={LIMIT_OPTIONS}
              />
            </Field>
            <div>
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={counts.total === 0 || mRefresh.isPending}
                className="w-full"
              >
                <Activity className="h-4 w-4" />
                {mRefresh.isPending ? 'Atualizando…' : `Atualizar ${Math.min(counts.total, Number(maxContracts))} agora`}
              </Button>
            </div>
          </div>
        </Card>

        {queryError && <ErrorState message={(queryError as Error).message} />}
        {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}

        {!isLoading && !queryError && data.length === 0 && (
          <Empty
            title="Tudo em dia"
            body={`Nenhum contrato com snapshot mais antigo que ${maxAge} dias. A análise de risco está fresca.`}
          />
        )}

        {data.length > 0 && (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Contrato</th>
                    <th>Status do snapshot</th>
                    <th>Último capturado</th>
                    <th>Status do contrato</th>
                    <th className="w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((c) => (
                    <tr key={c.contract_id} className="hover:bg-slate-50 dark:hover:bg-muted-dark/40">
                      <td>
                        <Link to={`/contratos/${c.contract_id}`} className="block hover:underline">
                          <p className="font-medium dark:text-slate-100">{c.numero}</p>
                          <p className="line-clamp-1 text-xs text-slate-500 dark:text-slate-400">{c.objeto}</p>
                        </Link>
                      </td>
                      <td><FreshnessBadge f={c.freshness} /></td>
                      <td>
                        {c.last_snapshot_at ? (
                          <div className="text-xs">
                            <p className="dark:text-slate-200">{relativeTime(c.last_snapshot_at)}</p>
                            <p className="font-mono text-[10px] text-slate-400">{dtTime(c.last_snapshot_at)}</p>
                          </div>
                        ) : (
                          <span className="text-xs text-error">Nunca</span>
                        )}
                      </td>
                      <td className="text-xs font-mono uppercase tracking-display text-slate-600 dark:text-slate-300">
                        {c.tenant_id ? 'em execução' : '—'}
                      </td>
                      <td>
                        <Link
                          to={`/contratos/${c.contract_id}/risco`}
                          className="inline-flex items-center gap-1 rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-navy dark:hover:bg-muted-dark dark:hover:text-purple-300"
                          title="Abrir análise"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Doc agendamento */}
        <Card className="mt-6 p-4">
          <div className="flex items-start gap-3">
            <Calendar className="mt-0.5 h-5 w-5 text-slate-500" />
            <div className="flex-1 text-sm">
              <p className="font-semibold dark:text-slate-200">Como rodar isso automaticamente</p>
              <p className="mt-1 text-slate-600 dark:text-slate-400">
                Esta página dispara manualmente. Pra rodar diariamente sem intervenção, use Supabase
                Scheduled Functions chamando a Edge Function <code className="font-mono text-xs">refresh-risk-snapshots</code>
                {' '}com body <code className="font-mono text-xs">{`{ "all_tenants": true, "max_age_days": 14 }`}</code>
                {' '}e header <code className="font-mono text-xs">Authorization: Bearer $SERVICE_ROLE_KEY</code>.
              </p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Recomendação: 03:00 UTC (00:00 America/Sao_Paulo) — fora do horário de trabalho.
              </p>
            </div>
          </div>
        </Card>
      </Layout>

      {/* Confirmação de execução */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Atualizar snapshots de risco?"
        subtitle={`${Math.min(counts.total, Number(maxContracts))} contratos serão processados em sequência`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button onClick={() => mRefresh.mutate()} loading={mRefresh.isPending}>
              Atualizar agora
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-slate-700 dark:text-slate-200">
            Cada contrato terá <strong>1 captura de snapshot</strong> rodada agora, gravada com source <code className="font-mono text-xs">manual</code>.
          </p>
          <p className="text-slate-500 dark:text-slate-400">
            Operação síncrona — a página fica aguardando. Pode levar alguns segundos por contrato.
          </p>
        </div>
      </Modal>

      {/* Resultado */}
      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        title="Atualização concluída"
        subtitle={`${result?.total ?? 0} contratos atualizados${result && result.errors.length > 0 ? ` · ${result.errors.length} erros` : ''}`}
        size="lg"
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setResult(null)}>Fechar</Button>
          </div>
        }
      >
        {result && (
          <div className="space-y-4">
            {result.refreshed.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-display text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Atualizados · {result.refreshed.length}
                </p>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-border-dark">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Contrato</th>
                        <th className="text-right">Score</th>
                        <th>Nível</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.refreshed.map((r) => (
                        <tr key={r.contract_id}>
                          <td className="text-sm">{r.numero || r.contract_id.slice(0, 8)}</td>
                          <td className="text-right font-mono tabular text-sm font-semibold">
                            <span className="inline-flex items-center gap-1">
                              {r.score >= 50 ? <TrendingUp className="h-3 w-3 text-error" />
                                             : <TrendingDown className="h-3 w-3 text-success" />}
                              {r.score}
                            </span>
                          </td>
                          <td><NivelBadge n={r.nivel} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {result.errors.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-display text-error">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Erros · {result.errors.length}
                </p>
                <div className="space-y-1 rounded-lg border border-error/30 bg-error/5 p-3">
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs">
                      <strong className="font-mono">{e.numero || e.contract_id.slice(0, 8)}:</strong>
                      <span className="ml-1 text-error">{e.message}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Toast de erro geral */}
      {error && !confirmOpen && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error shadow-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="font-semibold">Falha ao atualizar</p>
              <p className="text-xs">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-error/70 hover:text-error">×</button>
          </div>
        </div>
      )}
    </>
  );
}
