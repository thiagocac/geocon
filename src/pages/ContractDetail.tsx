import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  FileSpreadsheet, Calculator, PenLine, WalletCards, LineChart, FileText,
  Plus, MapPin, Calendar, Building2, Users as UsersIcon, Edit3, Layers, AlertCircle,
} from 'lucide-react';
import { getContract, getSaldoAlert } from '../lib/api';
import { brl, num, dt } from '../lib/format';
import { CONTRACT_STATUS, statusFor } from '../lib/status';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Stat, Empty, ErrorState, Skeleton, Progress } from '../components/ui/Stat';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';

export function ContractDetail() {
  const { id = '' } = useParams();
  const { data: c, isLoading, isError, error } = useQuery({
    queryKey: ['contract', id],
    queryFn: () => getContract(id),
    enabled: !!id,
  });
  const { data: saldoAlert } = useQuery({
    queryKey: ['saldo-alert', id],
    queryFn: () => getSaldoAlert(id),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <Layout>
        <Skeleton className="mb-6 h-12" />
        <div className="grid gap-4 md:grid-cols-4"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
      </Layout>
    );
  }

  if (isError) return <Layout><ErrorState message={(error as Error).message} /></Layout>;

  if (!c) return <Layout><Empty title="Contrato não encontrado" body="Verifique o identificador informado." /></Layout>;

  const status = statusFor(c.status, CONTRACT_STATUS);

  const modules: Array<[string, string, typeof FileSpreadsheet, string]> = [
    ['Planilha SOV',  'planilha',             FileSpreadsheet, 'Itens, preços, saldo'],
    ['Medições',      'medicoes',             Calculator,      'Boletins por período'],
    ['Aditivos',      'aditivos',             PenLine,         'Valor, prazo, itens'],
    ['Itens não previstos','itens-nao-previstos', Plus,        'Aprovação prévia'],
    ['Financeiro',    'financeiro',           WalletCards,     'Curva S, pagamentos'],
    ['Cronograma',    'cronograma',           LineChart,       'Físico-financeiro'],
    ['EAP',           'eap',                  Layers,          'Estrutura analítica'],
    ['Relatórios',    'relatorios',           FileText,        'Pacote auditável'],
    ['Obras / lotes', 'obras',                Building2,       'Empreendimentos físicos'],
    ['Partes',        'partes',               UsersIcon,       'Gestor, fiscal, contratada'],
  ];

  return (
    <Layout>
      <PageHeader
        title={c.numero}
        subtitle={c.objeto}
        backTo="/contratos"
        backLabel="Contratos"
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <Link to="editar"><Button variant="outline"><Edit3 className="h-4 w-4" />Editar</Button></Link>
            <Link to="planilha"><Button variant="outline">Planilha</Button></Link>
            <Link to="medicoes"><Button>Medições</Button></Link>
          </div>
        }
      />

      {saldoAlert && saldoAlert.nivel_alerta !== 'ok' && (
        <SaldoAlertBanner alert={saldoAlert} />
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Valor inicial" value={brl(c.valor_inicial)} tone="neutral" />
        <Stat label="Aditivos" value={brl(c.valor_aditado)} sub={`${num(c.valor_inicial ? (c.valor_aditado / c.valor_inicial) * 100 : 0)}% do inicial`} tone="purple" />
        <Stat label="Medido" value={brl(c.valor_medido_acumulado)} sub={`${num(c.percentual_financeiro)}% financeiro`} tone="magenta" />
        <Stat label="Saldo" value={brl(c.saldo_contratual)} tone={c.saldo_contratual <= 0 ? 'error' : 'success'} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="border-b border-slate-100 px-5 py-4 dark:border-border-dark">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Módulos do contrato</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Selecione um módulo para operar</p>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-2 lg:grid-cols-3">
            {modules.map(([label, path, Icon, sub]) => (
              <Link
                key={label}
                to={path}
                className="group flex flex-col gap-2 rounded-xl border border-slate-200 p-4 transition-all hover:border-navy hover:shadow-card dark:border-border-dark dark:hover:border-purple"
              >
                <Icon className="h-6 w-6 text-navy dark:text-purple-300" />
                <p className="font-semibold text-slate-900 dark:text-slate-100">{label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>
              </Link>
            ))}
          </div>

          <div className="border-t border-slate-100 px-5 py-3 dark:border-border-dark">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Progresso físico-financeiro</h3>
            <div className="mt-2 space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-300">Físico</span>
                  <span className="font-medium tabular">{num(c.percentual_fisico)}%</span>
                </div>
                <Progress value={c.percentual_fisico} />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-300">Financeiro</span>
                  <span className="font-medium tabular">{num(c.percentual_financeiro)}%</span>
                </div>
                <Progress value={c.percentual_financeiro} />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Dados contratuais</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase text-slate-500 dark:text-slate-400">Contratante</dt>
              <dd className="font-medium text-slate-900 dark:text-slate-100">{c.contratante_nome || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500 dark:text-slate-400">Contratada</dt>
              <dd className="font-medium text-slate-900 dark:text-slate-100">{c.contratada_nome || '—'}</dd>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-slate-400" />
              <span>{c.municipio ? `${c.municipio}/${c.uf}` : '—'}</span>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500 dark:text-slate-400">Regime / Modalidade</dt>
              <dd>{c.regime_contratacao || '—'} · {c.modalidade_licitatoria || '—'}</dd>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <span>Assinatura: <strong>{dt(c.data_assinatura)}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <span>Ordem de início: <strong>{dt(c.data_ordem_inicio)}</strong></span>
            </div>
          </dl>
        </Card>
      </div>
    </Layout>
  );
}

function SaldoAlertBanner({ alert }: { alert: { nivel_alerta: 'atencao' | 'critico' | 'esgotado' | 'ok'; pct_consumido: number; mensagem: string | null } }) {
  const styles: Record<string, { bg: string; text: string; bar: string }> = {
    atencao:  { bg: 'border-yellow-400/40 bg-yellow-50 dark:bg-yellow-900/10', text: 'text-yellow-900 dark:text-yellow-200', bar: 'bg-yellow-400' },
    critico:  { bg: 'border-orange-400/50 bg-orange-50 dark:bg-orange-900/10', text: 'text-orange-900 dark:text-orange-200', bar: 'bg-orange-500' },
    esgotado: { bg: 'border-error/50 bg-error/5',                              text: 'text-error',                            bar: 'bg-error' },
  };
  const s = styles[alert.nivel_alerta] || styles.atencao;
  return (
    <div className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 ${s.bg}`}>
      <AlertCircle className={`h-5 w-5 shrink-0 ${s.text}`} />
      <div className="flex-1">
        <div className={`text-sm font-semibold ${s.text}`}>{alert.mensagem}</div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/40">
          <div className={`h-full ${s.bar}`} style={{ width: `${Math.min(100, Number(alert.pct_consumido || 0))}%` }} />
        </div>
        <div className={`mt-1 text-xs ${s.text}`}>{Number(alert.pct_consumido || 0).toFixed(1)}% do contrato medido</div>
      </div>
    </div>
  );
}
