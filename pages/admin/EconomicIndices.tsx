import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, TrendingUp, RefreshCw, Upload, AlertCircle, CheckCircle2, Download, History as HistoryIcon } from 'lucide-react';
import {
  listAdjustmentIndices, listIndexValues, upsertIndexValue,
  bulkUpsertIndexValues, parseIndexCsv,
  listFetchLog, triggerEconomicIndicesDownload,
  FETCH_LOG_STATUS_LABELS, fetchLogStatusTone,
  type AdjustmentIndex, type BulkUpsertIndexResult,
  type IbgeDispatchResponse, type FetchLogEntry,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { dtTime } from '../../lib/format';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Field } from '../../components/ui/FormField';
import { Skeleton, Empty } from '../../components/ui/Stat';

function fmtNum(n: number | null | undefined, digits = 4): string {
  if (n === null || n === undefined || !isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('pt-BR', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

function fmtMonth(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  return d.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

export function AdminEconomicIndices() {
  const qc = useQueryClient();
  const [selectedIndex, setSelectedIndex] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [formMonth, setFormMonth] = useState('');
  const [formValue, setFormValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: indices = [], isLoading: indicesLoading } = useQuery({
    queryKey: ['adjustment-indices'],
    queryFn: listAdjustmentIndices,
  });

  // Default: primeiro índice
  const currentIndexId = selectedIndex || indices[0]?.id || null;
  const currentIndex = indices.find((i) => i.id === currentIndexId);

  const { data: values = [], isLoading: valuesLoading } = useQuery({
    queryKey: ['index-values', currentIndexId],
    queryFn: () => currentIndexId ? listIndexValues(currentIndexId) : Promise.resolve([]),
    enabled: !!currentIndexId,
  });

  const mUpsert = useMutation({
    mutationFn: (vars: { indexId: string; month: string; value: number }) =>
      upsertIndexValue(vars.indexId, vars.month, vars.value, 'manual'),
    onSuccess: () => {
      setModalOpen(false);
      setFormMonth(''); setFormValue(''); setError(null);
      qc.invalidateQueries({ queryKey: ['index-values'] });
    },
    onError: (err) => setError(humanizeError(err)),
  });

  // V31: CSV import
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvPreview, setCsvPreview] = useState<{
    rows: Array<{ reference_month: string; index_value: number }>;
    warnings: Array<{ line: number; raw: string; error: string }>;
  } | null>(null);
  const [csvResult, setCsvResult] = useState<BulkUpsertIndexResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // V48: IBGE download
  const [ibgeModalOpen, setIbgeModalOpen] = useState(false);
  const [ibgeMonthsBack, setIbgeMonthsBack] = useState(3);
  const [ibgeResult, setIbgeResult] = useState<IbgeDispatchResponse | null>(null);

  const mIbge = useMutation({
    mutationFn: () => triggerEconomicIndicesDownload({
      codigo: currentIndex && (currentIndex.codigo === 'IPCA' || currentIndex.codigo === 'IPCA-15')
        ? currentIndex.codigo
        : undefined,
      months_back: ibgeMonthsBack,
    }),
    onSuccess: (data) => {
      setIbgeResult(data);
      qc.invalidateQueries({ queryKey: ['index-values'] });
      qc.invalidateQueries({ queryKey: ['fetch-log'] });
    },
    onError: (err) => setIbgeResult({ ok: false, dispatched: 0, message: humanizeError(err) }),
  });

  const { data: fetchLog = [] } = useQuery({
    queryKey: ['fetch-log'],
    queryFn: () => listFetchLog(20),
  });

  function handleCsvFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || '');
      setCsvText(text);
      const parsed = parseIndexCsv(text);
      setCsvPreview(parsed);
      setCsvResult(null);
    };
    reader.readAsText(file, 'utf-8');
  }

  const mBulkImport = useMutation({
    mutationFn: () => {
      if (!currentIndexId || !csvPreview) throw new Error('Sem dados');
      return bulkUpsertIndexValues(currentIndexId, csvPreview.rows, 'csv-import');
    },
    onSuccess: (result) => {
      setCsvResult(result);
      qc.invalidateQueries({ queryKey: ['index-values'] });
    },
    onError: (err) => setError(humanizeError(err)),
  });

  function closeCsvModal() {
    setCsvModalOpen(false);
    setCsvText('');
    setCsvPreview(null);
    setCsvResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function submit() {
    if (!currentIndexId) { setError('Selecione um índice'); return; }
    const month = formMonth.trim();
    if (!/^\d{4}-\d{2}/.test(month)) { setError('Mês deve ser YYYY-MM'); return; }
    const monthDate = `${month.slice(0, 7)}-01`;
    const value = parseFloat(formValue.replace(',', '.'));
    if (!isFinite(value) || value <= 0) { setError('Valor deve ser número positivo'); return; }
    mUpsert.mutate({ indexId: currentIndexId, month: monthDate, value });
  }

  // Cálculo do delta % mês-a-mês pra mostrar coluna de variação
  const valuesWithDelta = useMemo(() => {
    return values.map((v, idx) => {
      const prev = values[idx + 1];  // próximo na lista é mais antigo (ordem desc)
      const variation = prev
        ? ((Number(v.index_value) / Number(prev.index_value)) - 1) * 100
        : null;
      return { ...v, variation };
    });
  }, [values]);

  return (
    <>
      <Layout>
        <PageHeader
          kicker="Administração · Operação"
          title="Índices econômicos"
          subtitle="Série temporal mensal dos índices usados em reajustes contratuais (IPCA, IGP-M, INCC, SINAPI)"
          backTo="/admin"
          backLabel="Admin"
          actions={
            currentIndexId && (
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" onClick={() => { setIbgeModalOpen(true); }}>
                  <Download className="h-4 w-4" />Atualizar do IBGE
                </Button>
                <Button variant="outline" onClick={() => { setCsvModalOpen(true); setError(null); }}>
                  <Upload className="h-4 w-4" />Importar CSV
                </Button>
                <Button onClick={() => { setModalOpen(true); setError(null); }}>
                  <Plus className="h-4 w-4" />Registrar mensal
                </Button>
              </div>
            )
          }
        />

        {indicesLoading && <Card className="p-6"><Skeleton className="h-32" /></Card>}

        {!indicesLoading && indices.length === 0 && (
          <Empty
            title="Nenhum índice cadastrado"
            body="O tenant deveria ter sido populado com IPCA, IGP-M, INCC e SINAPI. Veja seed_adjustment_indices no schema."
          />
        )}

        {indices.length > 0 && (
          <>
            <Card className="mb-4 p-4">
              <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
                Selecione um índice
              </p>
              <div className="flex flex-wrap gap-2">
                {(indices as AdjustmentIndex[]).map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setSelectedIndex(i.id)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      currentIndexId === i.id
                        ? 'border-magenta bg-magenta text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-magenta dark:border-border-dark dark:bg-card-dark dark:text-slate-200'
                    }`}
                  >
                    <span className="font-mono text-[10px] uppercase tracking-display opacity-70">{i.codigo}</span>
                    <span className="ml-1.5">{i.nome}</span>
                  </button>
                ))}
              </div>
            </Card>

            {currentIndex && (
              <Card>
                <div className="border-b border-slate-200 px-4 py-3 dark:border-border-dark">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-magenta" />
                      <div>
                        <p className="font-semibold dark:text-slate-100">{currentIndex.nome}</p>
                        <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">
                          {currentIndex.codigo} · {currentIndex.periodicidade}
                        </p>
                      </div>
                    </div>
                    <Badge tone="blue">{values.length} {values.length === 1 ? 'ponto' : 'pontos'} registrados</Badge>
                  </div>
                </div>

                {valuesLoading && <div className="p-6"><Skeleton className="h-48" /></div>}

                {!valuesLoading && values.length === 0 && (
                  <div className="px-4 py-12 text-center">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Nenhum valor registrado pra este índice.
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Clique em "Registrar valor mensal" pra começar.
                    </p>
                  </div>
                )}

                {valuesWithDelta.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Mês ref.</th>
                          <th className="text-right">Valor do índice</th>
                          <th className="hidden md:table-cell text-right">Δ vs mês anterior</th>
                          <th className="hidden lg:table-cell">Origem</th>
                          <th className="hidden lg:table-cell">Registrado em</th>
                        </tr>
                      </thead>
                      <tbody>
                        {valuesWithDelta.map((v) => (
                          <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark/40">
                            <td className="font-mono tabular text-sm">{fmtMonth(v.reference_month)}</td>
                            <td className="text-right font-mono tabular text-sm">{fmtNum(v.index_value, 4)}</td>
                            <td className="hidden md:table-cell text-right">
                              {v.variation === null ? (
                                <span className="text-xs text-slate-400">—</span>
                              ) : (
                                <span className={`font-mono tabular text-xs ${
                                  v.variation > 0 ? 'text-success' :
                                  v.variation < 0 ? 'text-error' :
                                                    'text-slate-500'
                                }`}>
                                  {v.variation > 0 ? '+' : ''}{fmtNum(v.variation, 2)}%
                                </span>
                              )}
                            </td>
                            <td className="hidden lg:table-cell">
                              <Badge tone={v.source === 'manual' ? 'slate' : 'blue'}>{v.source || '—'}</Badge>
                            </td>
                            <td className="hidden lg:table-cell font-mono text-[10px] text-slate-500">
                              {v.published_at ? new Date(v.published_at).toLocaleDateString('pt-BR') : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {/* V48: Log de fetch automático IBGE */}
            {fetchLog.length > 0 && (
              <Card className="mt-4">
                <div className="border-b border-slate-200 px-4 py-3 dark:border-border-dark">
                  <div className="flex items-center gap-2">
                    <HistoryIcon className="h-4 w-4 text-slate-500" />
                    <p className="font-semibold dark:text-slate-200">Histórico de atualizações automáticas</p>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Últimas tentativas de fetch via API IBGE · cron mensal dia 15 às 11h UTC
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Quando</th>
                        <th>Índice</th>
                        <th>Fonte</th>
                        <th>Status</th>
                        <th className="text-right">Inseridos</th>
                        <th className="text-right">Atualizados</th>
                        <th className="text-right">Pulados</th>
                        <th>Período</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fetchLog.map((l) => (
                        <tr key={l.id}>
                          <td className="font-mono text-xs">{dtTime(l.fetched_at)}</td>
                          <td className="font-mono text-xs font-bold">{l.index_codigo}</td>
                          <td className="font-mono text-xs text-slate-500">{l.source}</td>
                          <td><Badge tone={fetchLogStatusTone(l.status)}>{FETCH_LOG_STATUS_LABELS[l.status]}</Badge></td>
                          <td className="font-mono text-xs text-right text-success">{l.rows_inserted || '—'}</td>
                          <td className="font-mono text-xs text-right text-blue-600 dark:text-blue-400">{l.rows_updated || '—'}</td>
                          <td className="font-mono text-xs text-right text-slate-500">{l.rows_skipped || '—'}</td>
                          <td className="text-[11px] text-slate-500">
                            {l.reference_month_from && l.reference_month_to ? (
                              <span className="font-mono">{l.reference_month_from.slice(0, 7)} → {l.reference_month_to.slice(0, 7)}</span>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {fetchLog.some((l) => l.error_message) && (
                  <div className="border-t border-slate-200 px-4 py-3 dark:border-border-dark">
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-display text-error">Erros recentes</p>
                    {fetchLog.filter((l) => l.error_message).slice(0, 3).map((l) => (
                      <p key={l.id} className="font-mono text-[11px] text-error">
                        {l.index_codigo} @ {dtTime(l.fetched_at)}: {l.error_message}
                      </p>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </>
        )}
      </Layout>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Registrar valor mensal do índice"
        subtitle={currentIndex ? `${currentIndex.codigo} · ${currentIndex.nome}` : ''}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={submit} loading={mUpsert.isPending}>Salvar</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Mês de referência" required hint="O 1º dia do mês. Ex: 2025-03 → valor de março/2025">
            <input
              type="month"
              value={formMonth}
              onChange={(e) => setFormMonth(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Valor do índice (acumulado)" required hint="Use o índice publicado (base 100 ago/1994 pra IGP-M, base 1993 pra IPCA, etc)">
            <input
              type="text"
              inputMode="decimal"
              value={formValue}
              onChange={(e) => setFormValue(e.target.value)}
              placeholder="1234.5678"
              className="input font-mono"
            />
          </Field>
          {error && (
            <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </div>
          )}
        </div>
      </Modal>

      {/* Modal CSV Import */}
      <Modal
        open={csvModalOpen}
        onClose={closeCsvModal}
        title="Importar CSV de valores mensais"
        subtitle={currentIndex ? `${currentIndex.codigo} · ${currentIndex.nome}` : ''}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeCsvModal}>
              {csvResult ? 'Fechar' : 'Cancelar'}
            </Button>
            {csvPreview && csvPreview.rows.length > 0 && !csvResult && (
              <Button onClick={() => mBulkImport.mutate()} loading={mBulkImport.isPending}>
                <Upload className="h-4 w-4" />Importar {csvPreview.rows.length} linha(s)
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          {/* Etapa 1: upload */}
          {!csvResult && (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-border-dark dark:bg-muted-dark">
                <p className="font-semibold dark:text-slate-200">Formato aceito</p>
                <ul className="mt-1 ml-3 list-disc space-y-0.5 text-slate-600 dark:text-slate-400">
                  <li>Colunas: <code className="font-mono">mês,valor</code> (separador <code>,</code>, <code>;</code> ou tab)</li>
                  <li>Mês: <code className="font-mono">YYYY-MM</code>, <code className="font-mono">MM/YYYY</code> ou <code className="font-mono">YYYY-MM-DD</code></li>
                  <li>Valor: ponto ou vírgula como decimal. Ex: <code className="font-mono">7325,8412</code> ou <code className="font-mono">7325.8412</code></li>
                  <li>Cabeçalho opcional (primeira linha contendo "mes/mês/month/reference/período" é ignorada)</li>
                  <li>Máximo 1000 linhas por importação</li>
                </ul>
              </div>

              <Field label="Selecione o arquivo CSV" hint="Ou cole o conteúdo abaixo">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleCsvFile(f);
                  }}
                  className="input"
                />
              </Field>

              <Field label="Ou cole o conteúdo CSV diretamente">
                <textarea
                  value={csvText}
                  onChange={(e) => {
                    setCsvText(e.target.value);
                    setCsvPreview(parseIndexCsv(e.target.value));
                  }}
                  rows={6}
                  placeholder={`2024-12,7012.5481\n2025-01,7045.2387\n2025-02,7088.1234`}
                  className="input font-mono text-xs"
                />
              </Field>

              {csvPreview && (
                <>
                  <div className="flex flex-wrap gap-3">
                    <Badge tone="green">{csvPreview.rows.length} válida(s)</Badge>
                    {csvPreview.warnings.length > 0 && (
                      <Badge tone="yellow">{csvPreview.warnings.length} ignorada(s)</Badge>
                    )}
                  </div>

                  {csvPreview.warnings.length > 0 && (
                    <details className="rounded-lg border border-amber-300/40 bg-amber-50/50 p-2 dark:border-amber-900/40 dark:bg-amber-900/15">
                      <summary className="cursor-pointer text-xs font-semibold text-amber-900 dark:text-amber-200">
                        Linhas ignoradas ({csvPreview.warnings.length})
                      </summary>
                      <ul className="mt-2 space-y-1 font-mono text-[10px] text-amber-900 dark:text-amber-200">
                        {csvPreview.warnings.slice(0, 20).map((w, i) => (
                          <li key={i}>
                            <strong>L{w.line}:</strong> {w.error} — <code>{w.raw}</code>
                          </li>
                        ))}
                        {csvPreview.warnings.length > 20 && (
                          <li className="italic">…e mais {csvPreview.warnings.length - 20}</li>
                        )}
                      </ul>
                    </details>
                  )}

                  {csvPreview.rows.length > 0 && (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-border-dark">
                      <table className="table">
                        <thead className="sticky top-0 bg-slate-50 dark:bg-muted-dark">
                          <tr>
                            <th className="text-left">Mês ref.</th>
                            <th className="text-right">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csvPreview.rows.slice(0, 50).map((r, i) => (
                            <tr key={i}>
                              <td className="font-mono text-xs">{r.reference_month.slice(0, 7)}</td>
                              <td className="text-right font-mono tabular text-xs">{r.index_value.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {csvPreview.rows.length > 50 && (
                        <p className="border-t border-slate-200 px-3 py-1 text-center text-[10px] italic text-slate-500 dark:border-border-dark">
                          …+{csvPreview.rows.length - 50} linhas serão importadas
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* Etapa 2: resultado */}
          {csvResult && (
            <div className="space-y-2">
              <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm">
                <CheckCircle2 className="mr-1 inline h-4 w-4 text-success" />
                <span className="text-success">Importação concluída</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Card className="p-3 text-center">
                  <p className="font-mono text-[10px] uppercase text-slate-500">Inseridas</p>
                  <p className="font-mono text-xl font-bold tabular text-success">{csvResult.inserted}</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="font-mono text-[10px] uppercase text-slate-500">Atualizadas</p>
                  <p className="font-mono text-xl font-bold tabular text-blue-600">{csvResult.updated}</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="font-mono text-[10px] uppercase text-slate-500">Ignoradas</p>
                  <p className={`font-mono text-xl font-bold tabular ${csvResult.skipped > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                    {csvResult.skipped}
                  </p>
                </Card>
              </div>
              {csvResult.errors.length > 0 && (
                <details className="rounded-lg border border-amber-300/40 bg-amber-50/50 p-2 dark:border-amber-900/40 dark:bg-amber-900/15">
                  <summary className="cursor-pointer text-xs font-semibold text-amber-900 dark:text-amber-200">
                    Erros do servidor ({csvResult.errors.length})
                  </summary>
                  <ul className="mt-2 space-y-1 font-mono text-[10px] text-amber-900 dark:text-amber-200">
                    {csvResult.errors.slice(0, 20).map((e, i) => (
                      <li key={i}>{e.error}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* V48: Modal IBGE download */}
      <Modal
        open={ibgeModalOpen}
        onClose={() => { setIbgeModalOpen(false); setIbgeResult(null); }}
        title="Atualizar índices do IBGE"
        subtitle="Baixa séries IPCA e IPCA-15 diretamente da API pública do IBGE/SIDRA"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setIbgeModalOpen(false); setIbgeResult(null); }}>Fechar</Button>
            {!ibgeResult && (
              <Button onClick={() => mIbge.mutate()} loading={mIbge.isPending}>
                <Download className="h-4 w-4" />Baixar agora
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/15 dark:text-blue-200">
            <p>
              <strong>Fontes suportadas:</strong> IBGE/SIDRA (IPCA · IPCA-15) via API pública.
              FGV (INCC · IGP-M) não é suportada — FGV não expõe API pública gratuita.
              Para esses índices, continue usando "Importar CSV" mensalmente.
            </p>
          </div>

          <Field label="Quantos meses pra trás buscar" hint="Default 3 · max 24">
            <input
              type="number"
              min={1}
              max={24}
              value={ibgeMonthsBack}
              onChange={(e) => setIbgeMonthsBack(Math.max(1, Math.min(24, parseInt(e.target.value) || 3)))}
              className="input"
            />
          </Field>

          {currentIndex && (currentIndex.codigo === 'IPCA' || currentIndex.codigo === 'IPCA-15') && (
            <p className="text-xs text-slate-500">
              Será atualizado: <strong>{currentIndex.codigo}</strong>. Deixe sem filtro de índice para atualizar todos os IBGE configurados.
            </p>
          )}

          {ibgeResult && (
            <div className={`rounded-lg border-2 p-3 ${
              ibgeResult.ok && ibgeResult.dispatched > 0
                ? 'border-success/30 bg-success/5'
                : 'border-yellow-300/40 bg-yellow-50 dark:border-yellow-900/40 dark:bg-yellow-900/15'
            }`}>
              {ibgeResult.ok && ibgeResult.dispatched > 0 ? (
                <>
                  <div className="flex items-center gap-2 text-success font-semibold text-sm mb-2">
                    <CheckCircle2 className="h-5 w-5" />
                    {ibgeResult.dispatched} atualização{ibgeResult.dispatched === 1 ? '' : 'ões'} processada{ibgeResult.dispatched === 1 ? '' : 's'}
                  </div>
                  {ibgeResult.results && (
                    <ul className="space-y-1.5">
                      {ibgeResult.results.map((r, i) => (
                        <li key={i} className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-border-dark dark:bg-card-dark">
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-semibold">{r.index_codigo}</span>
                            <Badge tone={fetchLogStatusTone(r.status)}>{FETCH_LOG_STATUS_LABELS[r.status]}</Badge>
                          </div>
                          <p className="font-mono text-[11px] text-slate-500 mt-0.5">
                            {r.rows_inserted}n · {r.rows_updated}m · {r.rows_unchanged}=  ·  {r.rows_skipped}s
                            {r.reference_month_from && r.reference_month_to && (
                              <span> · {r.reference_month_from.slice(0, 7)}→{r.reference_month_to.slice(0, 7)}</span>
                            )}
                          </p>
                          {r.error_message && (
                            <p className="mt-1 font-mono text-[10px] text-error">{r.error_message}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <div className="flex items-start gap-2 text-yellow-900 dark:text-yellow-200 text-sm">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                  <p>{ibgeResult.message || 'Nenhum dado retornado'}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
