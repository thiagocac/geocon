import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  Plus, Send, CheckCircle2, Calendar, Calculator, FileText, History, Archive,
  WalletCards, LineChart, BookOpen,
} from 'lucide-react';
import {
  listAdditives, getContract, callFn,
  getContractItem, listMeasurementItemsByContractItem,
  getAdditive, listAdditiveItems,
  fetchReport, downloadReportCsv,
  listGeneratedReports, getGeneratedReportUrl,
  type ReportVariant,
} from '../../lib/api';
import { brl, num, dt } from '../../lib/format';
import { ADDITIVE_STATUS, statusFor } from '../../lib/status';
import { humanizeError } from '../../lib/errors';
import { useRecentItems } from '../../hooks/useRecentItems';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Empty, Skeleton, Stat, Progress } from '../../components/ui/Stat';

// MeasurementApprove agora em pages/MeasurementApprovePage.tsx

// =============================================================================
// ADDITIVES — agora em pages/Additives.tsx; AdditiveDetail aqui (implementação real)
// =============================================================================
export function AdditiveDetail() {
  const { id = '', adId = '' } = useParams();
  const { push: pushRecent } = useRecentItems();
  const { data: ad, isLoading: al } = useQuery({
    queryKey: ['additive', adId], queryFn: () => getAdditive(adId), enabled: !!adId,
  });
  const { data: items = [], isLoading: il } = useQuery({
    queryKey: ['additive-items', adId], queryFn: () => listAdditiveItems(adId), enabled: !!adId,
  });

  useEffect(() => {
    if (ad?.id) {
      pushRecent({
        id: ad.id,
        type: 'additive',
        label: `Aditivo n.º ${ad.numero}`,
        hint: `${ad.tipo} · ${ad.status}`,
        to: `/contratos/${id}/aditivos/${ad.id}`,
      });
    }
  }, [ad?.id, ad?.numero, ad?.tipo, ad?.status, id, pushRecent]);

  if (al || il) return <Layout><Skeleton className="h-64" /></Layout>;
  if (!ad) return <Layout><Empty title="Aditivo não encontrado" /></Layout>;

  const ITEM_TIPO_TONE: Record<string, 'green' | 'red' | 'purple'> = {
    acrescimo:   'green',
    decrescimo:  'red',
    extra_novo:  'purple',
  };
  const STATUS_TONE: Record<string, 'green' | 'yellow' | 'red' | 'slate'> = {
    rascunho:     'slate',
    em_analise:   'yellow',
    em_aprovacao: 'yellow',
    aprovado:     'green',
    incorporado:  'green',
    reprovado:    'red',
    cancelado:    'red',
  };
  const totalAcrescimo  = items.filter((i) => i.tipo === 'acrescimo' || i.tipo === 'extra_novo')
                               .reduce((s, i) => s + i.valor_total, 0);
  const totalDecrescimo = items.filter((i) => i.tipo === 'decrescimo')
                               .reduce((s, i) => s + i.valor_total, 0);

  return (
    <Layout>
      <PageHeader
        title={`Aditivo n.º ${ad.numero} — ${ad.tipo}`}
        subtitle={`Solicitado em ${dt(ad.data_solicitacao)}${ad.data_aprovacao ? ` · Aprovado em ${dt(ad.data_aprovacao)}` : ''}`}
        backTo={`/contratos/${id}/aditivos`}
        backLabel="Aditivos"
        actions={<Badge tone={STATUS_TONE[ad.status] || 'slate'}>{ad.status}</Badge>}
      />

      {/* KPIs */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Valor de acréscimo" value={brl(ad.valor_acrescimo)} tone="success"
              sub={`${items.filter((i) => i.tipo !== 'decrescimo').length} item(ns)`} />
        <Stat label="Valor de decréscimo" value={brl(ad.valor_decrescimo)} tone="error"
              sub={`${items.filter((i) => i.tipo === 'decrescimo').length} item(ns)`} />
        <Stat label="Valor líquido" value={brl(ad.valor_liquido)} tone="purple"
              sub={ad.percentual_sobre_inicial != null ? `${num(ad.percentual_sobre_inicial)}% do contrato` : '—'} />
        <Stat label="Prazo adicional" value={`${num(ad.prazo_execucao_acrescimo_dias || 0)} dia(s)`} tone="navy"
              sub={ad.prazo_vigencia_acrescimo_dias ? `+ ${ad.prazo_vigencia_acrescimo_dias}d vigência` : 'Sem extensão de vigência'} />
      </div>

      {/* Limites legais */}
      {ad.percentual_sobre_inicial != null && (
        <Card className={`mb-4 p-4 ${ad.percentual_sobre_inicial > 25 ? 'border-warning bg-yellow-50 dark:bg-yellow-900/10' : ''}`}>
          <div className="flex items-start gap-3">
            <WalletCards className={`h-5 w-5 ${ad.percentual_sobre_inicial > 25 ? 'text-warning' : 'text-slate-500'}`} />
            <div className="text-sm">
              <p className="font-medium dark:text-slate-100">
                Percentual sobre valor inicial: <strong className="font-mono">{num(ad.percentual_sobre_inicial)}%</strong>
              </p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {ad.percentual_sobre_inicial > 25
                  ? '⚠ Acima de 25% — só permitido em reforma de edifício/equipamento (Lei 14.133/2021, art. 125, §1º).'
                  : 'Dentro do limite de 25% para acréscimo/supressão ordinária (Lei 14.133/2021, art. 125).'}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Itens do aditivo */}
      <Card className="overflow-hidden">
        <header className="border-b border-slate-100 px-5 py-3 dark:border-border-dark">
          <h2 className="font-semibold dark:text-slate-100">Itens do aditivo</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {items.length} item(ns) · Acréscimos: {brl(totalAcrescimo)} · Decréscimos: {brl(totalDecrescimo)}
          </p>
        </header>
        {items.length === 0 ? (
          <Empty title="Sem itens" body="Este aditivo ainda não possui itens lançados." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 dark:bg-muted-dark dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-left">Código</th>
                  <th className="px-3 py-2 text-left">Descrição</th>
                  <th className="px-3 py-2 text-right">Qtd.</th>
                  <th className="px-3 py-2 text-left">Unid.</th>
                  <th className="px-3 py-2 text-right">Preço unit.</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-border-dark">
                {items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50/50 dark:hover:bg-muted-dark/40">
                    <td className="px-3 py-2"><Badge tone={ITEM_TIPO_TONE[it.tipo]}>{it.tipo}</Badge></td>
                    <td className="px-3 py-2 font-mono text-xs dark:text-slate-300">{it.codigo || '—'}</td>
                    <td className="px-3 py-2 dark:text-slate-200">{it.descricao}</td>
                    <td className="px-3 py-2 text-right font-mono tabular dark:text-slate-200">{num(it.quantidade)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{it.unidade || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono tabular text-slate-600 dark:text-slate-300">{brl(it.preco_unitario)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular dark:text-slate-100">{brl(it.valor_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Justificativas + base legal */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {ad.justificativa_valor && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Justificativa — valor</h3>
            <p className="mt-2 text-sm leading-relaxed dark:text-slate-200">{ad.justificativa_valor}</p>
          </Card>
        )}
        {ad.justificativa_prazo && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Justificativa — prazo</h3>
            <p className="mt-2 text-sm leading-relaxed dark:text-slate-200">{ad.justificativa_prazo}</p>
          </Card>
        )}
        {ad.legal_basis && (
          <Card className="p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Base legal</h3>
            <p className="mt-2 font-mono text-sm dark:text-slate-200">{ad.legal_basis}</p>
          </Card>
        )}
      </div>
    </Layout>
  );
}

// Unforeseen e UnforeseenDetail agora em pages/UnforeseenItems.tsx

// =============================================================================
// TRACKING — rastreamento completo de um contract_item
// =============================================================================
export function Tracking() {
  const { id = '', itemContratualId = '' } = useParams();
  const { data: item, isLoading: il } = useQuery({
    queryKey: ['contract-item', itemContratualId],
    queryFn: () => getContractItem(itemContratualId),
    enabled: !!itemContratualId,
  });
  const { data: history = [], isLoading: hl } = useQuery({
    queryKey: ['contract-item-history', itemContratualId],
    queryFn: () => listMeasurementItemsByContractItem(itemContratualId),
    enabled: !!itemContratualId,
  });

  if (il || hl) return <Layout><Skeleton className="h-64" /></Layout>;
  if (!item) return <Layout><Empty title="Item contratual não encontrado" /></Layout>;

  const qtdTotal = item.quantidade_contratada + item.quantidade_aditada;
  const qtdAcum = item.quantidade_medida_acumulada;
  const saldo = Math.max(qtdTotal - qtdAcum, 0);
  const pctExec = qtdTotal > 0 ? (qtdAcum / qtdTotal) * 100 : 0;
  const valorContratado = qtdTotal * item.preco_unitario;
  const valorAcumExec = history.reduce((s, h) => s + h.valor_periodo, 0);
  const valorGlosadoTotal = history.reduce((s, h) => s + h.valor_glosado, 0);
  const valorLiquidoTotal = history.reduce((s, h) => s + h.valor_liquido, 0);

  return (
    <Layout>
      <PageHeader
        title={`Rastreamento — ${item.codigo}`}
        subtitle={item.descricao}
        backTo={`/contratos/${id}/planilha`}
        backLabel="Planilha"
      />

      {/* KPIs do item */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Qtd. contratada" value={`${num(item.quantidade_contratada)} ${item.unidade || ''}`}
              sub={item.quantidade_aditada > 0 ? `+ ${num(item.quantidade_aditada)} aditado` : 'Sem aditivo'} tone="navy" />
        <Stat label="Qtd. executada" value={`${num(qtdAcum)} ${item.unidade || ''}`}
              sub={`${num(pctExec)}% executado`} tone="purple" />
        <Stat label="Saldo restante" value={`${num(saldo)} ${item.unidade || ''}`}
              sub={`${num(100 - pctExec)}% disponível`}
              tone={pctExec >= 95 ? 'error' : pctExec >= 80 ? 'warning' : 'success'} />
        <Stat label="Valor líquido executado" value={brl(valorLiquidoTotal)}
              sub={`de ${brl(valorContratado)} contratados`} tone="magenta" />
      </div>

      {/* Composição do contrato */}
      <Card className="mb-4 p-5">
        <h2 className="font-semibold dark:text-slate-100">Composição contratual</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Como o item está parametrizado no contrato</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <div>
            <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Preço unitário</p>
            <p className="mt-1 font-mono font-semibold tabular dark:text-slate-100">{brl(item.preco_unitario)} / {item.unidade || 'un'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500 dark:text-slate-400">BDI</p>
            <p className="mt-1 font-mono font-semibold tabular dark:text-slate-100">{num(item.bdi_percentual)}%</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Fonte de referência</p>
            <p className="mt-1 font-medium dark:text-slate-100">
              {item.fonte_referencia || '—'}
              {item.codigo_referencia && <span className="ml-1 font-mono text-xs text-slate-500">({item.codigo_referencia})</span>}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Nível EAP</p>
            <p className="mt-1 font-mono font-semibold dark:text-slate-100">{item.nivel}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Item extra?</p>
            <p className="mt-1 font-medium dark:text-slate-100">{item.is_extra ? 'Sim — incluído por aditivo' : 'Não — original SOV'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Liberação medição</p>
            <p className="mt-1 font-medium dark:text-slate-100">{item.data_liberacao_medicao ? dt(item.data_liberacao_medicao) : '—'}</p>
          </div>
        </div>
      </Card>

      {/* Histórico de medições */}
      <Card className="overflow-hidden">
        <header className="border-b border-slate-100 px-5 py-3 dark:border-border-dark">
          <h2 className="font-semibold dark:text-slate-100">Histórico de medições</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {history.length} medição(ões) executaram este item
            {valorGlosadoTotal > 0 ? ` · ${brl(valorGlosadoTotal)} em glosas` : ''}
          </p>
        </header>
        {history.length === 0 ? (
          <Empty title="Sem medições" body="Este item ainda não apareceu em nenhuma medição." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 dark:bg-muted-dark dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Medição</th>
                  <th className="px-3 py-2 text-left">Período</th>
                  <th className="px-3 py-2 text-right">Qtd. período</th>
                  <th className="px-3 py-2 text-right">Acumulado</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2 text-right">Glosa</th>
                  <th className="px-3 py-2 text-right">Líquido</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-border-dark">
                {history.map((h) => (
                  <tr key={h.measurement_item_id} className="hover:bg-slate-50/50 dark:hover:bg-muted-dark/40">
                    <td className="px-3 py-2">
                      <Link to={`/contratos/${id}/medicoes/${h.measurement_id}`}
                            className="font-mono text-navy hover:underline dark:text-purple-300">
                        #{h.measurement_numero}{h.complementar_numero > 0 ? `.${h.complementar_numero}` : ''}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {dt(h.periodo_inicio)} → {dt(h.periodo_fim)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular dark:text-slate-200">
                      {num(h.quantidade_periodo)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular text-slate-500 dark:text-slate-400">
                      {num(h.quantidade_acumulada_incl_periodo)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular dark:text-slate-200">
                      {brl(h.valor_periodo)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular text-error">
                      {h.valor_glosado > 0 ? `-${brl(h.valor_glosado)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular dark:text-slate-100">
                      {brl(h.valor_liquido)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={
                        h.measurement_status === 'paga' || h.measurement_status === 'aprovada' ? 'green' :
                        h.measurement_status === 'cancelada' || h.measurement_status === 'retificada' ? 'red' :
                        h.measurement_status === 'em_aprovacao' ? 'yellow' : 'slate'
                      }>{h.measurement_status}</Badge>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold dark:border-slate-700 dark:bg-muted-dark">
                  <td className="px-3 py-2" colSpan={2}>Total</td>
                  <td className="px-3 py-2 text-right font-mono tabular dark:text-slate-100">{num(qtdAcum)}</td>
                  <td />
                  <td className="px-3 py-2 text-right font-mono tabular dark:text-slate-100">{brl(valorAcumExec)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular text-error">
                    {valorGlosadoTotal > 0 ? `-${brl(valorGlosadoTotal)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular dark:text-slate-100">{brl(valorLiquidoTotal)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Layout>
  );
}

// =============================================================================
// FINANCIAL — implementação completa em ./Financial.tsx
// =============================================================================
// export { Financial } from '../Financial'; // movido para /pages/Financial.tsx

// =============================================================================
// SCHEDULE — implementação completa em ./Schedule.tsx
// =============================================================================
// export { Schedule } from '../Schedule'; // movido para /pages/Schedule.tsx

// =============================================================================
// REPORTS (contrato) — wired to V3/V4 generate-report + audit-package + databook
// =============================================================================
export function Reports() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: contract } = useQuery({
    queryKey: ['contract', id], queryFn: () => getContract(id), enabled: !!id,
  });
  const { data: generated = [], isLoading: lg } = useQuery({
    queryKey: ['generated-reports', id], queryFn: () => listGeneratedReports(id), enabled: !!id,
  });

  function notifyOk(msg: string) { setSuccess(msg); setError(null); setBusy(null); setTimeout(() => setSuccess(null), 5000); }
  function notifyErr(e: unknown) { setError(humanizeError(e)); setSuccess(null); setBusy(null); }

  async function handleVariantCsv(variant: ReportVariant) {
    setBusy(`csv-${variant}`);
    try { await downloadReportCsv(variant, id); notifyOk(`CSV gerado para ${variant}.`); }
    catch (e) { notifyErr(e); }
  }
  async function handleVariantView(variant: ReportVariant) {
    setBusy(`view-${variant}`);
    try {
      const r = await fetchReport(variant, id);
      notifyOk(`${r.meta.total_rows} linha(s) carregada(s).`);
    } catch (e) { notifyErr(e); }
  }
  const auditPkg = useMutation({
    mutationFn: () => callFn('generate-audit-package', { contract_id: id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['generated-reports', id] }); notifyOk('Pacote auditável solicitado — confira o histórico abaixo.'); },
    onError: (e: Error) => notifyErr(e),
  });
  const databook = useMutation({
    mutationFn: () => callFn('generate-databook-export', { contract_id: id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['generated-reports', id] }); notifyOk('DataBook GED solicitado.'); },
    onError: (e: Error) => notifyErr(e),
  });

  const CARDS: Array<{ variant: ReportVariant; title: string; desc: string; tone: string }> = [
    { variant: 'carteira',   title: 'Carteira',     desc: 'KPIs do contrato (medido, pago, %)',     tone: 'navy' },
    { variant: 'pendencias', title: 'Pendências',   desc: 'Medições, GRDs, aditivos, riscos',        tone: 'warning' },
    { variant: 'curva_s',    title: 'Curva-S',      desc: 'Previsto × realizado por mês',            tone: 'purple' },
    { variant: 'glosas',     title: 'Mapa de glosas', desc: 'Todas as glosas com justificativa',     tone: 'magenta' },
    { variant: 'top_glosas', title: 'Top glosas',   desc: 'Top 50 maiores por valor',                tone: 'error' },
    { variant: 'health',    title: 'Saúde contratual', desc: 'Risk flags ativas (atraso, saldo)',    tone: 'success' },
  ];

  return (
    <Layout>
      <PageHeader
        title="Relatórios e pacote auditável"
        subtitle={contract ? `${contract.numero} — ${contract.objeto}` : 'Carregando…'}
        backTo={`/contratos/${id}`} backLabel="Contrato"
        actions={
          <>
            <Button variant="outline" onClick={() => databook.mutate()} loading={databook.isPending}>
              <FileText className="h-4 w-4" />DataBook GED
            </Button>
            <Button onClick={() => auditPkg.mutate()} loading={auditPkg.isPending}>
              <Archive className="h-4 w-4" />Pacote ZIP auditável
            </Button>
          </>
        }
      />

      {success && <div className="mb-4 rounded-lg border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">✓ {success}</div>}
      {error && <div className="mb-4 rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">{error}</div>}

      {/* 6 variantes operacionais */}
      <h2 className="mb-3 mt-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Relatórios operacionais</h2>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => (
          <Card key={c.variant} className="p-4">
            <FileText className="h-6 w-6 text-navy dark:text-purple-300" />
            <p className="mt-2 font-semibold dark:text-slate-100">{c.title}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{c.desc}</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => handleVariantView(c.variant)}
                      loading={busy === `view-${c.variant}`}>
                Pré-visualizar
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleVariantCsv(c.variant)}
                      loading={busy === `csv-${c.variant}`}>
                CSV
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Histórico de relatórios já gerados */}
      <h2 className="mb-3 mt-8 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Histórico ({generated.length})</h2>
      {lg ? <Skeleton className="h-32" /> : generated.length === 0 ? (
        <Empty title="Nenhum relatório gerado ainda" body="Use as ações acima para gerar pacotes auditáveis, DataBook ou variantes de relatório." />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 dark:bg-muted-dark dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Título</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Gerado em</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-border-dark">
              {generated.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-muted-dark/40">
                  <td className="px-3 py-2 font-mono text-xs dark:text-slate-300">{r.report_type}</td>
                  <td className="px-3 py-2 dark:text-slate-100">{r.title}</td>
                  <td className="px-3 py-2">
                    <Badge tone={r.status === 'gerado' ? 'green' : r.status === 'erro' ? 'red' : 'yellow'}>{r.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{dt(r.generated_at)}</td>
                  <td className="px-3 py-2 text-right">
                    {r.storage_path && r.status === 'gerado' ? (
                      <button
                        className="text-navy underline-offset-2 hover:underline dark:text-purple-300"
                        onClick={async () => {
                          const url = await getGeneratedReportUrl(r.storage_path!);
                          if (url) window.open(url, '_blank');
                        }}
                      >
                        Baixar
                      </button>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Layout>
  );
}
