import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, MapPin, Plus, ShieldCheck, WalletCards, LineChart, ClipboardList, Briefcase, PieChart, TrendingUp } from 'lucide-react';
import { listContracts, getPendencias, getTenantSummary, getPortfolioByProgram } from '../lib/api';
import { brl, num } from '../lib/format';
import { CONTRACT_STATUS, statusFor } from '../lib/status';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Stat, Empty, ErrorState, Progress, Skeleton } from '../components/ui/Stat';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';

export function Dashboard() {
  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: ['contracts'],
    queryFn: listContracts,
  });
  const { data: pendencias = [] } = useQuery({
    queryKey: ['pendencias'], queryFn: () => getPendencias(),
  });
  const { data: summary } = useQuery({
    queryKey: ['tenant-summary'], queryFn: getTenantSummary,
  });
  const { data: portfolio = [] } = useQuery({
    queryKey: ['portfolio-by-program'], queryFn: getPortfolioByProgram,
  });

  const total = data.reduce((s, c) => s + c.valor_atual, 0);
  const medido = data.reduce((s, c) => s + c.valor_medido_acumulado, 0);
  const saldo = data.reduce((s, c) => s + c.saldo_contratual, 0);
  const totalAlertas = data.reduce((s, c) => s + c.alertas.length, 0);
  const pendHigh = pendencias.filter((p) => p.severidade === 'high').length;
  const pendMedium = pendencias.filter((p) => p.severidade === 'medium').length;
  const topPrograms = portfolio.slice(0, 3);

  return (
    <Layout>
      <PageHeader
        title="Carteira de contratos"
        subtitle="Visão executiva consolidada por órgão, programa e município"
        actions={
          <>
            <Link to="/carteira"><Button variant="outline"><Briefcase className="h-4 w-4" />Carteira agregada</Button></Link>
            <Link to="/pendencias"><Button variant="outline"><ClipboardList className="h-4 w-4" />Pendências{pendHigh > 0 ? <Badge tone="red" className="ml-1">{pendHigh}</Badge> : null}</Button></Link>
            <Link to="/contratos">
              <Button>
                <Plus className="h-4 w-4" />
                Novo contrato
              </Button>
            </Link>
          </>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Stat
          label="Contratos ativos"
          value={isLoading ? '…' : String(data.length)}
          sub="multi-tenant com RLS"
          tone="navy"
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <Stat
          label="Valor atualizado"
          value={isLoading ? '…' : brl(total)}
          sub="inicial + aditivos"
          tone="purple"
          icon={<WalletCards className="h-5 w-5" />}
        />
        <Stat
          label="Medido acumulado"
          value={isLoading ? '…' : brl(medido)}
          sub={`${num(total ? (medido / total) * 100 : 0)}% financeiro`}
          tone="magenta"
          icon={<LineChart className="h-5 w-5" />}
        />
        <Link to="/pendencias" className="contents">
          <Stat
            label="Pendências"
            value={isLoading ? '…' : String(summary?.pendencias_total ?? pendencias.length)}
            sub={pendHigh > 0 ? `${pendHigh} de alta severidade` : (totalAlertas > 0 ? `Alertas: ${totalAlertas}` : `Saldo geral ${brl(saldo)}`)}
            tone={pendHigh > 0 ? 'warning' : (totalAlertas > 0 ? 'warning' : 'success')}
            icon={<AlertTriangle className="h-5 w-5" />}
          />
        </Link>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="border-b border-slate-100 px-5 py-4 dark:border-border-dark">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Contratos críticos</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Ordenados pela necessidade de atenção</p>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-border-dark">
            {isLoading && (
              <div className="space-y-3 p-5">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
            )}
            {isError && (
              <div className="p-5">
                <ErrorState message={(error as Error).message} />
              </div>
            )}
            {!isLoading && !isError && data.length === 0 && (
              <div className="p-5">
                <Empty title="Nenhum contrato cadastrado" body="Comece criando seu primeiro contrato." />
              </div>
            )}
            {data.slice(0, 6).map((c) => {
              const status = statusFor(c.status, CONTRACT_STATUS);
              return (
                <Link
                  key={c.id}
                  to={`/contratos/${c.id}`}
                  className="flex flex-col gap-3 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-muted-dark"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{c.numero}</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">{c.objeto}</p>
                      <p className="mt-2 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                        <MapPin className="h-3 w-3" />
                        {c.municipio}/{c.uf} · {c.contratada_nome}
                      </p>
                    </div>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <div>
                    <Progress value={c.percentual_financeiro} />
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {num(c.percentual_financeiro)}% financeiro · saldo {brl(c.saldo_contratual)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Alertas de risco</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Atenção legal e contratual</p>
          <div className="mt-4 space-y-3">
            {data.flatMap((c) =>
              c.alertas.map((a, i) => (
                <div
                  key={`${c.id}-${i}`}
                  className="flex gap-3 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-900 dark:bg-yellow-900/20 dark:text-yellow-200"
                >
                  <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">{c.numero}</p>
                    <p className="text-xs">{a}</p>
                  </div>
                </div>
              )),
            )}
            {!isLoading && totalAlertas === 0 && (
              <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
                Nenhum alerta ativo. Carteira saudável.
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Painel V3: Top programas + Distribuição de pendências */}
      {(topPrograms.length > 0 || pendencias.length > 0) && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <header className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">Top programas</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Maior valor agregado por programa</p>
              </div>
              <Link to="/carteira">
                <Button variant="ghost" size="sm"><PieChart className="h-3.5 w-3.5" />Ver tudo</Button>
              </Link>
            </header>
            {topPrograms.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Sem programas configurados.</p>
            ) : (
              <div className="space-y-3">
                {topPrograms.map((p) => (
                  <div key={p.program_id ?? 'no-prog'} className="rounded-lg border border-slate-200 p-3 dark:border-border-dark">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium dark:text-slate-100">
                          {p.program_codigo && <span className="font-mono text-xs text-slate-500">{p.program_codigo} · </span>}
                          {p.program_nome || 'Sem programa'}
                        </p>
                        {p.program_orgao && <p className="text-xs text-slate-500">{p.program_orgao}</p>}
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm font-semibold tabular dark:text-slate-100">{brl(p.valor_total)}</p>
                        <p className="text-xs text-slate-500">{p.contratos_count} contrato(s)</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex-1">
                        <Progress value={Number(p.percentual_financeiro_medio) || 0} />
                      </div>
                      <span className="font-mono text-xs tabular text-slate-600 dark:text-slate-300">
                        {Number(p.percentual_financeiro_medio || 0).toFixed(1)}% medido
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <header className="mb-3">
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">Pendências</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Distribuição por severidade</p>
            </header>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 dark:bg-red-900/20">
                <span className="font-medium text-red-900 dark:text-red-200">Alta</span>
                <Badge tone="red">{pendHigh}</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-yellow-50 px-3 py-2 dark:bg-yellow-900/20">
                <span className="font-medium text-yellow-900 dark:text-yellow-200">Média</span>
                <Badge tone="yellow">{pendMedium}</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-muted-dark">
                <span className="font-medium dark:text-slate-200">Baixa</span>
                <Badge tone="slate">{Math.max(pendencias.length - pendHigh - pendMedium, 0)}</Badge>
              </div>
            </div>
            <Link to="/pendencias" className="mt-3 block">
              <Button variant="outline" size="sm" className="w-full">
                <TrendingUp className="h-3.5 w-3.5" />
                Ver todas
              </Button>
            </Link>
          </Card>
        </div>
      )}
    </Layout>
  );
}
