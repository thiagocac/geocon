import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Building2, MapPin, Briefcase, TrendingUp, FileText, AlertCircle,
  FileCheck, Gavel, Shield, Hammer, ShieldAlert, Filter,
} from 'lucide-react';
import {
  getPortfolioByProgram, getPortfolioByOrgao, getPortfolioByMunicipio,
  getAdditivesConsolidated, getTenantSummary,
  getPortfolioByProgramLei14133, getPortfolioByOrgaoLei14133, getPortfolioByMunicipioLei14133,
  getTenantLei14133Kpis,
  type PortfolioByProgram, type PortfolioByOrgao, type PortfolioByMunicipio,
  type AdditiveConsolidated,
  type PortfolioByProgramLei14133, type PortfolioByOrgaoLei14133, type PortfolioByMunicipioLei14133,
  type PortfolioLei14133Base,
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
  const [onlyCritical, setOnlyCritical] = useState(false);

  const { data: summary } = useQuery({ queryKey: ['tenant-summary'], queryFn: getTenantSummary });
  const { data: byProgram = [], isLoading: lp } = useQuery({ queryKey: ['portfolio-program'], queryFn: getPortfolioByProgram });
  const { data: byOrgao = [], isLoading: lo } = useQuery({ queryKey: ['portfolio-orgao'], queryFn: getPortfolioByOrgao });
  const { data: byMuni = [], isLoading: lm } = useQuery({ queryKey: ['portfolio-municipio'], queryFn: getPortfolioByMunicipio });
  const { data: additives = [], isLoading: la } = useQuery({ queryKey: ['additives-cons'], queryFn: getAdditivesConsolidated });

  // V43: KPIs Lei 14.133
  const { data: kpisLei } = useQuery({ queryKey: ['tenant-lei14133-kpis'], queryFn: getTenantLei14133Kpis });
  const { data: leiByProgram = [] }   = useQuery({ queryKey: ['portfolio-program-lei'],   queryFn: getPortfolioByProgramLei14133 });
  const { data: leiByOrgao = [] }     = useQuery({ queryKey: ['portfolio-orgao-lei'],     queryFn: getPortfolioByOrgaoLei14133 });
  const { data: leiByMunicipio = [] } = useQuery({ queryKey: ['portfolio-municipio-lei'], queryFn: getPortfolioByMunicipioLei14133 });

  // Indexes para lookup rápido por chave do agrupamento
  const leiByProgramMap = useMemo(() => {
    const m = new Map<string, PortfolioByProgramLei14133>();
    for (const row of leiByProgram) m.set(row.program_id || '__no_program__', row);
    return m;
  }, [leiByProgram]);
  const leiByOrgaoMap = useMemo(() => {
    const m = new Map<string, PortfolioByOrgaoLei14133>();
    for (const row of leiByOrgao) m.set(row.orgao, row);
    return m;
  }, [leiByOrgao]);
  const leiByMunicipioMap = useMemo(() => {
    const m = new Map<string, PortfolioByMunicipioLei14133>();
    for (const row of leiByMunicipio) m.set(`${row.uf}|${row.municipio}`, row);
    return m;
  }, [leiByMunicipio]);

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
        <div className="mb-3 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
          <Stat label="Contratos ativos" value={String(summary.contratos_ativos)} sub={`de ${summary.contratos_total} no total`} tone="navy" />
          <Stat label="Carteira total" value={brl(summary.valor_carteira_total)} tone="magenta" />
          <Stat label="Medido acumulado" value={brl(summary.valor_medido_total)} sub={summary.valor_carteira_total > 0 ? `${((summary.valor_medido_total / summary.valor_carteira_total) * 100).toFixed(1)}% da carteira` : '—'} tone="success" />
          <Stat label="Pago" value={brl(summary.valor_pago_total)} sub={summary.valor_glosado_total > 0 ? `Glosas ${brl(summary.valor_glosado_total)}` : 'Sem glosas'} tone="navy" />
        </div>
      )}

      {/* V43: KPIs Lei 14.133 — só renderiza se houver algum problema */}
      {kpisLei && (kpisLei.vicios_abertos + kpisLei.pars_em_curso + kpisLei.garantias_vencendo_30d + kpisLei.multas_pendentes_count + kpisLei.sancoes_graves_ativas) > 0 && (
        <Card className="mb-4 p-3 sm:p-4 border-yellow-300/40 bg-yellow-50/50 dark:border-yellow-900/40 dark:bg-yellow-900/10">
          <div className="mb-2 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-yellow-700 dark:text-yellow-300" />
            <p className="text-xs font-mono font-bold uppercase tracking-display text-yellow-900 dark:text-yellow-200">
              Lei 14.133 · pendências distribuídas na carteira
            </p>
            <span className="ml-auto text-[10px] font-mono text-yellow-700 dark:text-yellow-400">
              {kpisLei.contratos_criticos}/{kpisLei.contratos_total} contratos críticos
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Lei14133KpiCell icon={FileCheck}    label="Vícios abertos"      value={kpisLei.vicios_abertos} tone="error" />
            <Lei14133KpiCell icon={Gavel}        label="PARs em curso"        value={kpisLei.pars_em_curso} tone="purple" />
            <Lei14133KpiCell icon={Shield}       label="Garantias ≤30d"       value={kpisLei.garantias_vencendo_30d} tone="warning" />
            <Lei14133KpiCell icon={Hammer}       label="Multas pendentes"     value={kpisLei.multas_pendentes_count}
                             sub={kpisLei.multas_pendentes_valor > 0 ? brl(kpisLei.multas_pendentes_valor) : undefined}
                             tone="warning" />
            <Lei14133KpiCell icon={AlertCircle}  label="Impedimento/inido."   value={kpisLei.sancoes_graves_ativas} tone="error" />
          </div>
        </Card>
      )}

      {/* Tabs */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Agrupar por:</span>
          <ViewTab active={view === 'programa'} onClick={() => setView('programa')} icon={<Briefcase className="h-3.5 w-3.5" />}>Programa</ViewTab>
          <ViewTab active={view === 'orgao'} onClick={() => setView('orgao')} icon={<Building2 className="h-3.5 w-3.5" />}>Órgão</ViewTab>
          <ViewTab active={view === 'municipio'} onClick={() => setView('municipio')} icon={<MapPin className="h-3.5 w-3.5" />}>Município</ViewTab>
          {kpisLei && kpisLei.contratos_criticos > 0 && (
            <button
              type="button"
              onClick={() => setOnlyCritical(!onlyCritical)}
              className={`ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition ${
                onlyCritical
                  ? 'bg-error/15 text-error border border-error/40'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-muted-dark dark:text-slate-200'
              }`}
              title="Filtrar apenas agrupamentos com contratos críticos Lei 14.133"
            >
              <Filter className="h-3 w-3" />
              {onlyCritical ? 'Mostrando críticos' : 'Apenas críticos'}
            </button>
          )}
        </div>
      </Card>

      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}

      {!isLoading && view === 'programa' && (
        <ProgramaTable rows={byProgram} maxValue={maxValue} leiMap={leiByProgramMap} onlyCritical={onlyCritical} />
      )}
      {!isLoading && view === 'orgao' && (
        <OrgaoTable rows={byOrgao} maxValue={maxValue} leiMap={leiByOrgaoMap} onlyCritical={onlyCritical} />
      )}
      {!isLoading && view === 'municipio' && (
        <MunicipioTable rows={byMuni} maxValue={maxValue} leiMap={leiByMunicipioMap} onlyCritical={onlyCritical} />
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
          <div className="overflow-x-auto scrollbar-thin">
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
          </div>
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

function ProgramaTable({ rows, maxValue, leiMap, onlyCritical }: { rows: PortfolioByProgram[]; maxValue: number; leiMap: Map<string, PortfolioByProgramLei14133>; onlyCritical: boolean }) {
  const filteredRows = onlyCritical
    ? rows.filter((r) => {
        const lei = leiMap.get(r.program_id || '__no_program__');
        return lei && lei.contratos_criticos > 0;
      })
    : rows;
  if (filteredRows.length === 0 && onlyCritical) return <Empty title="Nenhum programa crítico" body="Nenhum programa tem contratos com pendências Lei 14.133 no momento." />;
  if (filteredRows.length === 0) return <Empty title="Sem programas" body="Cadastre programas e vincule contratos a eles para ver a carteira agregada." />;
  return (
    <Card className="p-5">
      <div className="space-y-5">
        {filteredRows.map((r) => {
          const lei = leiMap.get(r.program_id || '__no_program__');
          return (
            <div key={r.program_id || 'no-program'} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0 dark:border-border-dark">
              <BarRow
                label={r.program_codigo ? `${r.program_codigo} — ${r.program_nome}` : (r.program_nome || 'Sem programa')}
                sublabel={r.program_orgao || undefined}
                value={Number(r.valor_total || 0)}
                maxValue={maxValue}
                suffix={
                  <>
                    <span>
                      {r.contratos_ativos}/{r.contratos_count} contrato(s) ativo(s) ·{' '}
                      Medido <span className="font-medium">{brl(Number(r.valor_medido_total || 0))}</span> ({Number(r.percentual_financeiro_medio || 0).toFixed(1)}%) ·{' '}
                      Pago <span className="font-medium">{brl(Number(r.valor_pago_total || 0))}</span>
                      {r.valor_aditado_total > 0 && <> · Aditivos <span className="font-medium text-purple">{brl(Number(r.valor_aditado_total))}</span></>}
                    </span>
                    {lei && <Lei14133Badges lei={lei} />}
                  </>
                }
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function OrgaoTable({ rows, maxValue, leiMap, onlyCritical }: { rows: PortfolioByOrgao[]; maxValue: number; leiMap: Map<string, PortfolioByOrgaoLei14133>; onlyCritical: boolean }) {
  const filteredRows = onlyCritical
    ? rows.filter((r) => {
        const lei = leiMap.get(r.orgao);
        return lei && lei.contratos_criticos > 0;
      })
    : rows;
  if (filteredRows.length === 0 && onlyCritical) return <Empty title="Nenhum órgão crítico" body="Nenhum órgão tem contratos com pendências Lei 14.133 no momento." />;
  if (filteredRows.length === 0) return <Empty title="Sem dados" body="Sem contratos cadastrados para gerar a visão por órgão." />;
  return (
    <Card className="p-5">
      <div className="space-y-5">
        {filteredRows.map((r) => {
          const lei = leiMap.get(r.orgao);
          return (
            <div key={r.orgao} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0 dark:border-border-dark">
              <BarRow
                label={r.orgao}
                value={Number(r.valor_total || 0)}
                maxValue={maxValue}
                suffix={
                  <>
                    <span>
                      {r.contratos_ativos}/{r.contratos_count} contrato(s) ativo(s) ·{' '}
                      Medido <span className="font-medium">{brl(Number(r.valor_medido_total || 0))}</span> ({Number(r.percentual_financeiro_medio || 0).toFixed(1)}%) ·{' '}
                      Pago <span className="font-medium">{brl(Number(r.valor_pago_total || 0))}</span>
                    </span>
                    {lei && <Lei14133Badges lei={lei} />}
                  </>
                }
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function MunicipioTable({ rows, maxValue, leiMap, onlyCritical }: { rows: PortfolioByMunicipio[]; maxValue: number; leiMap: Map<string, PortfolioByMunicipioLei14133>; onlyCritical: boolean }) {
  const filteredRows = onlyCritical
    ? rows.filter((r) => {
        const lei = leiMap.get(`${r.uf}|${r.municipio}`);
        return lei && lei.contratos_criticos > 0;
      })
    : rows;
  if (filteredRows.length === 0 && onlyCritical) return <Empty title="Nenhum município crítico" body="Nenhum município tem contratos com pendências Lei 14.133 no momento." />;
  if (filteredRows.length === 0) return <Empty title="Sem dados de localização" body="Cadastre os lotes/obras dos contratos com município e UF." />;
  // Agrupa por UF
  const byUf = new Map<string, PortfolioByMunicipio[]>();
  for (const r of filteredRows) {
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
              {items.map((r) => {
                const lei = leiMap.get(`${r.uf}|${r.municipio}`);
                return (
                  <BarRow
                    key={`${r.uf}-${r.municipio}`}
                    label={r.municipio}
                    value={Number(r.valor_total || 0)}
                    maxValue={maxValue}
                    suffix={
                      <>
                        <span>
                          {r.contratos_ativos}/{r.contratos_count} contrato(s) ativo(s) ·{' '}
                          Medido <span className="font-medium">{brl(Number(r.valor_medido_total || 0))}</span>
                        </span>
                        {lei && <Lei14133Badges lei={lei} />}
                      </>
                    }
                  />
                );
              })}
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

// =============================================================================
// V43 — KPIs Lei 14.133 e badges por agrupamento
// =============================================================================

const KPI_TONE_CLS: Record<'error' | 'warning' | 'purple', string> = {
  error:   'text-error border-error/30',
  warning: 'text-yellow-700 dark:text-yellow-300 border-yellow-500/30',
  purple:  'text-purple-700 dark:text-purple-300 border-purple-500/30',
};

function Lei14133KpiCell({
  icon: Icon, label, value, sub, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  sub?: string;
  tone: 'error' | 'warning' | 'purple';
}) {
  return (
    <div className={`rounded-lg border bg-white/60 dark:bg-card-dark/60 p-2 ${value > 0 ? KPI_TONE_CLS[tone] : 'border-slate-200 dark:border-border-dark text-slate-600 dark:text-slate-400'}`}>
      <div className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        <p className="text-[9px] sm:text-[10px] font-mono uppercase tracking-display truncate flex-1">{label}</p>
      </div>
      <p className={`mt-0.5 font-mono tabular text-base sm:text-lg font-bold ${value === 0 ? 'opacity-50' : ''}`}>{value}</p>
      {sub && <p className="font-mono text-[9px] text-slate-500 truncate">{sub}</p>}
    </div>
  );
}

/**
 * Renderiza badges discretos com os 5 KPIs Lei 14.133 quando >0.
 * Aparece como linha extra abaixo do suffix da BarRow.
 */
function Lei14133Badges({ lei }: { lei: PortfolioLei14133Base }) {
  type BadgeTone = 'red' | 'yellow' | 'purple';
  const items = ([
    { label: 'vícios',         value: lei.vicios_abertos,         tone: 'red'    as BadgeTone },
    { label: 'PARs',           value: lei.pars_em_curso,          tone: 'purple' as BadgeTone },
    { label: 'garantias ≤30d', value: lei.garantias_vencendo_30d, tone: 'yellow' as BadgeTone },
    { label: 'multas',         value: lei.multas_pendentes_count, tone: 'yellow' as BadgeTone },
    { label: 'graves',         value: lei.sancoes_graves_ativas,  tone: 'red'    as BadgeTone },
  ]).filter((b) => b.value > 0);

  if (items.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-mono uppercase tracking-display text-slate-400">Lei 14.133:</span>
      {items.map((b) => (
        <Badge key={b.label} tone={b.tone}>
          {b.value} {b.label}
        </Badge>
      ))}
      {lei.contratos_criticos > 0 && (
        <span className="text-[10px] font-mono text-slate-500">
          em {lei.contratos_criticos} contrato{lei.contratos_criticos === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );
}
