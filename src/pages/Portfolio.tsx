import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Building2, MapPin, Briefcase, TrendingUp, FileText, AlertCircle,
} from 'lucide-react';
import {
  getPortfolioByProgram, getPortfolioByOrgao, getPortfolioByMunicipio,
  getAdditivesConsolidated, getTenantSummary,
  type PortfolioByProgram, type PortfolioByOrgao, type PortfolioByMunicipio,
  type AdditiveConsolidated,
} from '../lib/api';
import { brl } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Empty, Skeleton, Stat } from '../components/ui/Stat';

type ViewMode = 'programa' | 'orgao' | 'municipio';

export function Portfolio() {
  const [view, setView] = useState<ViewMode>('programa');

  const { data: summary } = useQuery({ queryKey: ['tenant-summary'], queryFn: getTenantSummary });
  const { data: byProgram = [], isLoading: lp } = useQuery({ queryKey: ['portfolio-program'], queryFn: getPortfolioByProgram });
  const { data: byOrgao = [], isLoading: lo } = useQuery({ queryKey: ['portfolio-orgao'], queryFn: getPortfolioByOrgao });
  const { data: byMuni = [], isLoading: lm } = useQuery({ queryKey: ['portfolio-municipio'], queryFn: getPortfolioByMunicipio });
  const { data: additives = [], isLoading: la } = useQuery({ queryKey: ['additives-cons'], queryFn: getAdditivesConsolidated });

  const isLoading = lp || lo || lm || la;
  const maxValue = useMemo(() => {
    const arr = view === 'programa' ? byProgram : view === 'orgao' ? byOrgao : byMuni;
    return Math.max(...arr.map((x) => Number(x.valor_total || 0)), 1);
  }, [view, byProgram, byOrgao, byMuni]);

  // Stats de aditivos
  const additiveStats = useMemo(() => {
    const total = additives.reduce((s, a) => s + Number(a.valor_liquido || 0), 0);
    const aprovados = additives.filter((a) => a.additive_status === 'aprovado').length;
    const pendentes = additives.filter((a) => a.additive_status !== 'aprovado' && a.additive_status !== 'cancelado').length;
    return { total, aprovados, pendentes };
  }, [additives]);

  return (
    <Layout>
      <PageHeader
        kicker="Visão executiva · Programas"
        title="Carteira de contratos"
        subtitle="Visão consolidada por programa, órgão e município. Painel de aditivos consolidados."
      />

      {summary && (
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <Stat label="Contratos ativos" value={String(summary.contratos_ativos)} sub={`de ${summary.contratos_total} no total`} tone="navy" />
          <Stat label="Carteira total" value={brl(summary.valor_carteira_total)} tone="magenta" />
          <Stat label="Medido acumulado" value={brl(summary.valor_medido_total)} sub={summary.valor_carteira_total > 0 ? `${((summary.valor_medido_total / summary.valor_carteira_total) * 100).toFixed(1)}% da carteira` : '—'} tone="success" />
          <Stat label="Pago" value={brl(summary.valor_pago_total)} sub={summary.valor_glosado_total > 0 ? `Glosas ${brl(summary.valor_glosado_total)}` : 'Sem glosas'} tone="navy" />
        </div>
      )}

      {/* Tabs */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Agrupar por:</span>
          <ViewTab active={view === 'programa'} onClick={() => setView('programa')} icon={<Briefcase className="h-3.5 w-3.5" />}>Programa</ViewTab>
          <ViewTab active={view === 'orgao'} onClick={() => setView('orgao')} icon={<Building2 className="h-3.5 w-3.5" />}>Órgão</ViewTab>
          <ViewTab active={view === 'municipio'} onClick={() => setView('municipio')} icon={<MapPin className="h-3.5 w-3.5" />}>Município</ViewTab>
        </div>
      </Card>

      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}

      {!isLoading && view === 'programa' && (
        <ProgramaTable rows={byProgram} maxValue={maxValue} />
      )}
      {!isLoading && view === 'orgao' && (
        <OrgaoTable rows={byOrgao} maxValue={maxValue} />
      )}
      {!isLoading && view === 'municipio' && (
        <MunicipioTable rows={byMuni} maxValue={maxValue} />
      )}

      {/* Painel de aditivos */}
      <Card className="mt-6 overflow-hidden">
        <header className="border-b border-slate-100 px-5 py-3 dark:border-border-dark">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold dark:text-slate-100">Aditivos consolidados</h2>
              <p className="text-xs text-slate-500">Todos os aditivos da carteira em uma visão unificada</p>
            </div>
            <div className="flex gap-2 text-xs">
              <Badge tone="green">{additiveStats.aprovados} aprovados</Badge>
              {additiveStats.pendentes > 0 && <Badge tone="yellow">{additiveStats.pendentes} pendentes</Badge>}
              <Badge tone="purple">{brl(additiveStats.total)} total</Badge>
            </div>
          </div>
        </header>

        {additives.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Sem aditivos cadastrados.</p>
        )}
        {additives.length > 0 && (
          <table className="table">
            <thead><tr>
              <th>Contrato</th><th>Aditivo</th><th>Tipo</th><th>Status</th>
              <th className="text-right">Valor líquido</th>
              <th className="text-right">% indiv.</th>
              <th>Dias adic.</th>
              <th>Aprovação</th>
              <th />
            </tr></thead>
            <tbody>
              {additives.map((a) => <AditivoRow key={a.additive_id} a={a} />)}
            </tbody>
          </table>
        )}
      </Card>
    </Layout>
  );
}

function ViewTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: JSX.Element; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
        active
          ? 'bg-navy text-white'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-muted-dark dark:text-slate-200 dark:hover:bg-slate-800'
      }`}
    >
      {icon}{children}
    </button>
  );
}

function BarRow({ label, sublabel, value, maxValue, suffix }: { label: string; sublabel?: string; value: number; maxValue: number; suffix?: React.ReactNode }) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span>
          <span className="font-medium dark:text-slate-100">{label}</span>
          {sublabel && <span className="ml-1 text-xs text-slate-500">{sublabel}</span>}
        </span>
        <span className="tabular font-mono text-sm dark:text-slate-100">{brl(value)}</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-muted-dark">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-navy to-purple"
          style={{ width: `${pct}%` }}
        />
      </div>
      {suffix && <div className="mt-1 text-xs text-slate-500">{suffix}</div>}
    </div>
  );
}

function ProgramaTable({ rows, maxValue }: { rows: PortfolioByProgram[]; maxValue: number }) {
  if (rows.length === 0) return <Empty title="Sem programas" body="Cadastre programas e vincule contratos a eles para ver a carteira agregada." />;
  return (
    <Card className="p-5">
      <div className="space-y-5">
        {rows.map((r) => (
          <div key={r.program_id || 'no-program'} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0 dark:border-border-dark">
            <BarRow
              label={r.program_codigo ? `${r.program_codigo} — ${r.program_nome}` : (r.program_nome || 'Sem programa')}
              sublabel={r.program_orgao || undefined}
              value={Number(r.valor_total || 0)}
              maxValue={maxValue}
              suffix={
                <span>
                  {r.contratos_ativos}/{r.contratos_count} contrato(s) ativo(s) ·{' '}
                  Medido <span className="font-medium">{brl(Number(r.valor_medido_total || 0))}</span> ({Number(r.percentual_financeiro_medio || 0).toFixed(1)}%) ·{' '}
                  Pago <span className="font-medium">{brl(Number(r.valor_pago_total || 0))}</span>
                  {r.valor_aditado_total > 0 && <> · Aditivos <span className="font-medium text-purple">{brl(Number(r.valor_aditado_total))}</span></>}
                </span>
              }
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

function OrgaoTable({ rows, maxValue }: { rows: PortfolioByOrgao[]; maxValue: number }) {
  if (rows.length === 0) return <Empty title="Sem dados" body="Sem contratos cadastrados para gerar a visão por órgão." />;
  return (
    <Card className="p-5">
      <div className="space-y-5">
        {rows.map((r) => (
          <div key={r.orgao} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0 dark:border-border-dark">
            <BarRow
              label={r.orgao}
              value={Number(r.valor_total || 0)}
              maxValue={maxValue}
              suffix={
                <span>
                  {r.contratos_ativos}/{r.contratos_count} contrato(s) ativo(s) ·{' '}
                  Medido <span className="font-medium">{brl(Number(r.valor_medido_total || 0))}</span> ({Number(r.percentual_financeiro_medio || 0).toFixed(1)}%) ·{' '}
                  Pago <span className="font-medium">{brl(Number(r.valor_pago_total || 0))}</span>
                </span>
              }
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

function MunicipioTable({ rows, maxValue }: { rows: PortfolioByMunicipio[]; maxValue: number }) {
  if (rows.length === 0) return <Empty title="Sem dados de localização" body="Cadastre os lotes/obras dos contratos com município e UF." />;
  // Agrupa por UF
  const byUf = new Map<string, PortfolioByMunicipio[]>();
  for (const r of rows) {
    const arr = byUf.get(r.uf) || [];
    arr.push(r);
    byUf.set(r.uf, arr);
  }

  return (
    <div className="space-y-4">
      {Array.from(byUf.entries()).map(([uf, items]) => {
        const ufTotal = items.reduce((s, x) => s + Number(x.valor_total || 0), 0);
        return (
          <Card key={uf} className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold dark:text-slate-100">{uf === 'XX' ? 'Sem UF' : `${uf} — ${items.length} município(s)`}</h3>
              <span className="font-mono text-sm tabular text-slate-700 dark:text-slate-200">{brl(ufTotal)}</span>
            </div>
            <div className="space-y-3">
              {items.map((r) => (
                <BarRow
                  key={`${r.uf}-${r.municipio}`}
                  label={r.municipio}
                  value={Number(r.valor_total || 0)}
                  maxValue={maxValue}
                  suffix={
                    <span>
                      {r.contratos_ativos}/{r.contratos_count} contrato(s) ativo(s) ·{' '}
                      Medido <span className="font-medium">{brl(Number(r.valor_medido_total || 0))}</span>
                    </span>
                  }
                />
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

const ADITIVO_TIPO_LABEL: Record<string, string> = {
  acrescimo: 'Acréscimo',
  decrescimo: 'Decréscimo',
  prazo: 'Prazo',
  misto: 'Misto',
  reequilibrio: 'Reequilíbrio',
};

const ADITIVO_STATUS_TONE: Record<string, 'slate' | 'blue' | 'green' | 'yellow' | 'red'> = {
  rascunho:    'slate',
  em_analise:  'yellow',
  aprovado:    'green',
  rejeitado:   'red',
  cancelado:   'red',
  assinado:    'green',
};

function AditivoRow({ a }: { a: AdditiveConsolidated }) {
  const tone = ADITIVO_STATUS_TONE[a.additive_status] || 'slate';
  return (
    <tr>
      <td>
        <Link to={`/contratos/${a.contract_id}`} className="font-mono text-xs text-navy hover:underline dark:text-purple">
          {a.contract_numero}
        </Link>
        <div className="text-xs text-slate-500 truncate max-w-[180px]" title={a.contract_objeto || ''}>
          {a.contract_objeto || ''}
        </div>
      </td>
      <td className="font-mono text-xs">{a.additive_numero}</td>
      <td className="text-xs">{ADITIVO_TIPO_LABEL[a.additive_tipo] || a.additive_tipo}</td>
      <td><Badge tone={tone}>{a.additive_status}</Badge></td>
      <td className="text-right font-mono tabular">{brl(Number(a.valor_liquido || 0))}</td>
      <td className="text-right">
        <Badge tone={Math.abs(Number(a.percentual_individual || 0)) > 24 ? 'red' : Math.abs(Number(a.percentual_individual || 0)) > 15 ? 'yellow' : 'slate'}>
          {Number(a.percentual_individual || 0).toFixed(1)}%
        </Badge>
      </td>
      <td className="text-xs">{a.dias_adicionais > 0 ? `+${a.dias_adicionais} dias` : '—'}</td>
      <td className="text-xs text-slate-500">{a.data_aprovacao ? new Date(a.data_aprovacao).toLocaleDateString('pt-BR') : '—'}</td>
      <td className="text-right">
        <Link to={`/contratos/${a.contract_id}/aditivos/${a.additive_id}`} className="text-navy text-xs hover:underline">Ver</Link>
      </td>
    </tr>
  );
}
