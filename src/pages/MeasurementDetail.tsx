import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Download, FileText, Send, ShieldCheck, AlertCircle, CheckCircle2, ChevronDown, ClipboardCopy, History, FilePlus, RefreshCcw, XCircle } from 'lucide-react';
import { useState } from 'react';
import { getMeasurement, listMItems, callFn, copyMeasurementBalance, copyPreviousMeasurement } from '../lib/api';
import { brl, num, dt } from '../lib/format';
import { MEASUREMENT_STATUS, statusFor } from '../lib/status';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Empty, ErrorState, Skeleton } from '../components/ui/Stat';
import { GlossesPanel } from '../components/GlossesPanel';
import { MeasurementLifecycleMenu } from '../components/MeasurementLifecycleMenu';

export function MeasurementDetail() {
  const { id = '', medId = '' } = useParams();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: m, isLoading: ml, isError: me, error: meErr } = useQuery({
    queryKey: ['measurement', medId],
    queryFn: () => getMeasurement(medId),
    enabled: !!medId,
  });
  const { data: items = [], isLoading: il } = useQuery({
    queryKey: ['mitems', medId],
    queryFn: () => listMItems(medId),
    enabled: !!medId,
  });

  const validate = useMutation({
    mutationFn: () => callFn('validate-measurement', { measurement_id: medId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['measurement', medId] }); qc.invalidateQueries({ queryKey: ['mitems', medId] }); setSuccess('Validação executada.'); setBusy(null); setErr(null); },
    onError: (e: Error) => { setErr(e.message); setBusy(null); },
  });

  const generatePdf = useMutation({
    mutationFn: (variant: string) => callFn<{ storage_path: string; validation_url: string }>('generate-measurement-pdf', { measurement_id: medId, variant }),
    onSuccess: (data) => {
      setSuccess(`PDF gerado. Validação: ${data.validation_url}`);
      setBusy(null); setErr(null);
      qc.invalidateQueries({ queryKey: ['measurement', medId] });
    },
    onError: (e: Error) => { setErr(e.message); setBusy(null); },
  });

  const copyBalance = useMutation({
    mutationFn: () => copyMeasurementBalance(medId),
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['mitems', medId] });
      setSuccess(`${count} item(ns) inseridos com o saldo restante.`);
      setBusy(null); setErr(null);
    },
    onError: (e: Error) => { setErr(e.message); setBusy(null); },
  });

  const copyPrevious = useMutation({
    mutationFn: () => copyPreviousMeasurement(medId),
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['mitems', medId] });
      setSuccess(`${count} item(ns) copiados da medição anterior.`);
      setBusy(null); setErr(null);
    },
    onError: (e: Error) => { setErr(e.message); setBusy(null); },
  });

  const [pdfMenuOpen, setPdfMenuOpen] = useState(false);
  const PDF_VARIANTS: Array<{ key: string; label: string; desc: string }> = [
    { key: 'analitico',    label: 'Analítico',        desc: 'Todos os itens, qtds e %' },
    { key: 'sintetico',    label: 'Sintético',        desc: 'Por disciplina, só medidos' },
    { key: 'complementar', label: 'Complementar',     desc: 'Só itens complementares' },
    { key: 'eap',          label: 'Por EAP',          desc: 'Execução por estrutura' },
    { key: 'mapa-glosas',  label: 'Mapa de glosas',   desc: 'Glosas + retenções' },
  ];

  if (ml || il) return <Layout><Skeleton className="h-64" /></Layout>;
  if (me) return <Layout><ErrorState message={(meErr as Error).message} /></Layout>;
  if (!m) return <Layout><Empty title="Medição não encontrada" /></Layout>;

  const status = statusFor(m.status, MEASUREMENT_STATUS);
  const isPreliminar = !['emitida', 'aprovada', 'paga'].includes(m.status);

  return (
    <Layout>
      <PageHeader
        title={`Medição n.º ${m.numero}${m.complementar_numero ? `.${m.complementar_numero}` : ''}`}
        subtitle={`${dt(m.periodo_inicio)} a ${dt(m.periodo_fim)} · ${m.tipo}`}
        backTo={`/contratos/${id}/medicoes`}
        backLabel="Medições"
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            {isPreliminar && (
              <>
                <Button variant="outline" size="sm" loading={busy === 'copy-balance'}
                        onClick={() => { setBusy('copy-balance'); copyBalance.mutate(); }}
                        title="Insere itens com o saldo restante de cada linha do contrato">
                  <ClipboardCopy className="h-4 w-4" />
                  Copiar saldo
                </Button>
                <Button variant="outline" size="sm" loading={busy === 'copy-prev'}
                        onClick={() => { setBusy('copy-prev'); copyPrevious.mutate(); }}
                        title="Copia as quantidades da medição imediatamente anterior">
                  <History className="h-4 w-4" />
                  Copiar anterior
                </Button>
              </>
            )}
            <Button variant="outline" loading={busy === 'validate'} onClick={() => { setBusy('validate'); validate.mutate(); }}>
              <ShieldCheck className="h-4 w-4" />
              Validar
            </Button>
            <MeasurementLifecycleMenu
              measurement={{
                id: m.id,
                numero: m.numero,
                complementar_numero: m.complementar_numero ?? null,
                status: m.status,
                periodo_inicio: m.periodo_inicio,
                periodo_fim: m.periodo_fim,
                contract_id: m.contract_id,
              }}
              onMutated={() => { qc.invalidateQueries({ queryKey: ['measurement', medId] }); qc.invalidateQueries({ queryKey: ['mitems', medId] }); }}
            />
            <div className="relative">
              <Button loading={busy === 'pdf'} onClick={() => setPdfMenuOpen((v) => !v)}>
                <FileText className="h-4 w-4" />
                Gerar PDF
                <ChevronDown className="h-4 w-4" />
              </Button>
              {pdfMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPdfMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-border-dark dark:bg-card-dark">
                    <div className="border-b border-slate-100 px-4 py-2 dark:border-border-dark">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Variantes do boletim</p>
                    </div>
                    {PDF_VARIANTS.map((v) => (
                      <button
                        key={v.key}
                        onClick={() => { setBusy('pdf'); setPdfMenuOpen(false); generatePdf.mutate(v.key); }}
                        className="w-full px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-muted-dark"
                      >
                        <p className="font-medium text-slate-900 dark:text-slate-100">{v.label}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{v.desc}</p>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <Link to="aprovar"><Button variant="secondary"><Send className="h-4 w-4" />Aprovar</Button></Link>
          </div>
        }
      />

      {isPreliminar && (
        <div className="mb-4 rounded-lg border-2 border-dashed border-warning bg-yellow-50 p-3 text-center text-sm font-bold uppercase tracking-wider text-yellow-900 dark:bg-yellow-900/20 dark:text-yellow-300">
          ⚠ Medição preliminar — não emitida
        </div>
      )}

      {/* Banner de linhagem (boletim originário de complementar / retificação ou já retificado) */}
      {m.snapshot?.origin === 'complementar' && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-purple-300/50 bg-purple-50 p-3 text-sm dark:border-purple-700/40 dark:bg-purple-900/10">
          <FilePlus className="mt-0.5 h-4 w-4 text-purple-700 dark:text-purple-300" />
          <div className="flex-1">
            <p className="font-semibold text-purple-900 dark:text-purple-200">Boletim complementar</p>
            <p className="text-xs text-purple-800 dark:text-purple-300">
              Originado da medição n.º {m.snapshot?.parent_numero ?? '—'}. {m.snapshot?.observacao ? <em className="block mt-1">{m.snapshot.observacao}</em> : null}
            </p>
          </div>
        </div>
      )}
      {m.snapshot?.origin === 'retificacao' && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-yellow-400/50 bg-yellow-50 p-3 text-sm dark:border-yellow-700/40 dark:bg-yellow-900/10">
          <RefreshCcw className="mt-0.5 h-4 w-4 text-yellow-700 dark:text-yellow-300" />
          <div className="flex-1">
            <p className="font-semibold text-yellow-900 dark:text-yellow-200">Retificação aberta</p>
            <p className="text-xs text-yellow-800 dark:text-yellow-300">
              {m.snapshot?.itens_copiados ?? 0} item(ns) copiados do boletim original. <em className="block mt-1">{m.snapshot.justificativa}</em>
            </p>
          </div>
        </div>
      )}
      {m.status === 'retificada' && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm dark:border-border-dark dark:bg-muted-dark">
          <RefreshCcw className="mt-0.5 h-4 w-4 text-slate-500" />
          <div className="flex-1">
            <p className="font-semibold dark:text-slate-100">Boletim retificado</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Este boletim foi substituído por uma retificação. Consulte a versão atual na listagem de medições.
            </p>
          </div>
        </div>
      )}
      {m.status === 'cancelada' && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-error/40 bg-error/5 p-3 text-sm">
          <XCircle className="mt-0.5 h-4 w-4 text-error" />
          <div className="flex-1">
            <p className="font-semibold text-error">Boletim cancelado</p>
            {m.snapshot?.cancelamento?.motivo && (
              <p className="text-xs text-error/80"><em>{m.snapshot.cancelamento.motivo}</em></p>
            )}
          </div>
        </div>
      )}

      {err && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4" /><span>{err}</span>
        </div>
      )}
      {success && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4" /><span>{success}</span>
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card className="px-4 py-3"><p className="text-xs uppercase text-slate-500 dark:text-slate-400">Valor PO</p><p className="text-xl font-bold tabular dark:text-slate-100">{brl(m.valor_po)}</p></Card>
        <Card className="px-4 py-3"><p className="text-xs uppercase text-slate-500 dark:text-slate-400">Valor líquido</p><p className="text-xl font-bold tabular dark:text-slate-100">{brl(m.valor_liquido)}</p></Card>
        <Card className="px-4 py-3"><p className="text-xs uppercase text-slate-500 dark:text-slate-400">Glosas</p><p className="text-xl font-bold tabular text-error">{brl(m.valor_glosado)}</p></Card>
        <Card className="px-4 py-3"><p className="text-xs uppercase text-slate-500 dark:text-slate-400">Retenções</p><p className="text-xl font-bold tabular text-warning">{brl(m.valor_retido)}</p></Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3 dark:border-border-dark">
          <h2 className="font-semibold dark:text-slate-100">Itens medidos</h2>
        </div>
        {items.length === 0 ? (
          <div className="p-5"><Empty title="Nenhum item medido neste período" /></div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th className="text-right">Qtd. período</th>
                  <th className="text-right">Acumulado</th>
                  <th className="text-right">Preço unit.</th>
                  <th className="text-right">Valor período</th>
                  <th className="text-right">Glosa</th>
                  <th className="text-right">Líquido</th>
                  <th>Validação</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                    <td className="font-mono text-xs">{it.codigo}</td>
                    <td className="text-sm">{it.descricao}</td>
                    <td className="text-right tabular">{num(it.quantidade_periodo, 6)}</td>
                    <td className="text-right tabular text-slate-500">{num(it.quantidade_acumulada_incl_periodo, 6)}</td>
                    <td className="text-right tabular">{brl(it.preco_unitario_snapshot)}</td>
                    <td className="text-right tabular">{brl(it.valor_periodo)}</td>
                    <td className="text-right tabular text-error">{it.valor_glosado > 0 ? brl(it.valor_glosado) : '—'}</td>
                    <td className="text-right tabular font-medium">{brl(it.valor_liquido)}</td>
                    <td>
                      <Badge tone={it.validacao_status === 'ok' ? 'green' : it.validacao_status === 'alerta' ? 'yellow' : it.validacao_status === 'bloqueado' ? 'red' : 'slate'}>
                        {it.validacao_status}
                      </Badge>
                    </td>
                    <td>
                      <Link to={`memoria/${it.contract_item_id}`} className="text-xs font-semibold text-navy hover:underline dark:text-slate-200">
                        Memória
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4">
        <GlossesPanel
          measurementId={medId}
          items={items.map((it) => ({
            id: it.id,
            codigo: it.codigo,
            descricao: it.descricao,
            valor_periodo: it.valor_periodo,
            quantidade_periodo: it.quantidade_periodo,
            preco_unitario_snapshot: it.preco_unitario_snapshot,
          }))}
          readOnly={['emitida', 'aprovada', 'paga'].includes(m.status)}
        />
      </div>

      {m.public_validation_code && (
        <Card className="mt-4 p-4">
          <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Código de validação pública</p>
          <p className="mt-1 font-mono text-lg font-bold dark:text-slate-100">{m.public_validation_code}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Validável em <code>/v/{m.public_validation_code}</code> (sem login)
          </p>
          {m.hash_documento && (
            <p className="mt-1 break-all font-mono text-xs text-slate-500 dark:text-slate-400">SHA-256: {m.hash_documento}</p>
          )}
        </Card>
      )}
    </Layout>
  );
}
