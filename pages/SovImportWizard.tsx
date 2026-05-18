import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle, FileSpreadsheet,
  Check, X, Layers,
} from 'lucide-react';
import {
  readSpreadsheet, inferMapping, parseRows, summarize,
  type ColumnMapping, type ColumnKey, type ParsedItem,
} from '../lib/sov-parser';
import { createSovVersion, bulkInsertContractItems, getActiveSovVersionId } from '../lib/api';
import { humanizeError } from '../lib/errors';
import { brl, num } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Field, Select } from '../components/ui/FormField';

type Step = 1 | 2 | 3 | 4;

const COLUMN_OPTIONS: Array<{ value: ColumnKey; label: string }> = [
  { value: 'ignore',         label: '— ignorar —' },
  { value: 'codigo',         label: 'Código' },
  { value: 'descricao',      label: 'Descrição' },
  { value: 'unidade',        label: 'Unidade' },
  { value: 'quantidade',     label: 'Quantidade' },
  { value: 'preco_unitario', label: 'Preço unitário' },
  { value: 'bdi',            label: 'BDI (%)' },
  { value: 'fonte',          label: 'Fonte de referência' },
];

const STEPS: Array<{ n: Step; label: string; desc: string }> = [
  { n: 1, label: 'Arquivo',    desc: 'Selecione a planilha' },
  { n: 2, label: 'Mapeamento', desc: 'Confirme as colunas' },
  { n: 3, label: 'Validação',  desc: 'Revise os erros' },
  { n: 4, label: 'Importar',   desc: 'Crie a versão SOV' },
];

export function SovImportWizard() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Array<Record<string, unknown>>>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [parsed, setParsed] = useState<ParsedItem[]>([]);
  const [motivo, setMotivo] = useState('Importação inicial da planilha contratual');
  const [parseError, setParseError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [done, setDone] = useState<{ items: number; sov_version_id: string } | null>(null);

  // ---- handlers --------------------------------------------------------------
  async function handleFile(f: File) {
    setParseError(null);
    setFile(f);
    try {
      const { headers, rows } = await readSpreadsheet(f);
      if (headers.length === 0 || rows.length === 0) {
        throw new Error('Planilha vazia ou sem cabeçalho detectável');
      }
      setHeaders(headers);
      setRawRows(rows);
      setMapping(inferMapping(headers));
      setStep(2);
    } catch (e) {
      setParseError(humanizeError(e));
    }
  }

  // Quando mapping muda, reprocessa (no step 3 só)
  useEffect(() => {
    if (step === 3) {
      setParsed(parseRows(rawRows, mapping));
    }
  }, [step, rawRows, mapping]);

  function goToStep3() {
    setParsed(parseRows(rawRows, mapping));
    setStep(3);
  }

  const summary = summarize(parsed);

  const importMutation = useMutation({
    mutationFn: async () => {
      // Cria nova SOV version
      const sovVersionId = await createSovVersion(id, motivo);
      // Insere itens válidos (incluindo títulos)
      const valid = parsed.filter((p) => p.errors.length === 0);
      const count = await bulkInsertContractItems(sovVersionId, id, valid);
      return { sov_version_id: sovVersionId, items: count };
    },
    onSuccess: (r) => {
      setDone(r);
      qc.invalidateQueries({ queryKey: ['items', id] });
      qc.invalidateQueries({ queryKey: ['sov-versions', id] });
    },
    onError: (e: Error) => setImportError(humanizeError(e)),
  });

  // ---- mapeamento: verifica se temos as colunas mínimas ----------------------
  const mappedKeys = new Set(Object.values(mapping));
  const missingRequired: ColumnKey[] = (['codigo', 'descricao', 'quantidade', 'preco_unitario'] as ColumnKey[])
    .filter((k) => !mappedKeys.has(k));

  return (
    <Layout>
      <PageHeader
        title="Importar planilha contratual (SOV)"
        subtitle="Excel, ODS ou CSV. O sistema cria nova versão da planilha vigente."
        backTo={`/contratos/${id}/planilha`}
        backLabel="Planilha"
      />

      {/* Stepper */}
      <Card className="mb-6 p-4">
        <ol className="flex flex-wrap items-center gap-4">
          {STEPS.map((s, i) => {
            const active = step === s.n;
            const done = step > s.n;
            return (
              <li key={s.n} className="flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full font-bold text-xs ${
                  done ? 'bg-success text-white' :
                  active ? 'bg-navy text-white' :
                  'bg-slate-200 text-slate-500 dark:bg-muted-dark dark:text-slate-400'
                }`}>
                  {done ? <Check className="h-4 w-4" /> : s.n}
                </div>
                <div>
                  <p className={`text-xs font-bold uppercase tracking-wider ${active ? 'text-navy dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>{s.label}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{s.desc}</p>
                </div>
                {i < STEPS.length - 1 && <ArrowRight className="h-4 w-4 text-slate-300 dark:text-slate-600" />}
              </li>
            );
          })}
        </ol>
      </Card>

      {/* STEP 1: arquivo */}
      {step === 1 && (
        <Card className="p-8">
          <div className="mx-auto max-w-md text-center">
            <FileSpreadsheet className="mx-auto h-12 w-12 text-navy dark:text-purple-300" />
            <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Selecione a planilha</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Aceita <code>.xlsx</code>, <code>.xls</code>, <code>.ods</code> e <code>.csv</code>. Tamanho máximo 10&nbsp;MB.
            </p>

            <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 p-8 hover:border-navy dark:border-border-dark dark:hover:border-purple">
              <Upload className="h-6 w-6 text-slate-400" />
              <span className="mt-2 text-sm font-semibold text-navy dark:text-slate-200">Escolher arquivo</span>
              <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">ou arraste aqui</span>
              <input
                type="file" className="hidden"
                accept=".xlsx,.xls,.ods,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </label>
            {parseError && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-left text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4" /><span>{parseError}</span>
              </div>
            )}
            {file && !parseError && (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                {file.name} ({Math.round(file.size / 1024)} KB)
              </p>
            )}
          </div>
        </Card>
      )}

      {/* STEP 2: mapeamento */}
      {step === 2 && (
        <>
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">Mapeamento de colunas</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Detectamos {headers.length} colunas e {rawRows.length} linhas.
                  Ajuste o destino de cada coluna abaixo.
                </p>
              </div>
              <Badge tone="purple">{rawRows.length} linhas</Badge>
            </div>

            {missingRequired.length > 0 && (
              <div className="mb-4 flex items-start gap-2 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-900 dark:bg-yellow-900/20 dark:text-yellow-200">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>
                  Faltam mapear as colunas obrigatórias:{' '}
                  {missingRequired.map((k) => <code key={k} className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/40">{k}</code>).reduce((acc, el, i) => i === 0 ? [el] : [...acc, <span key={'s' + i}>, </span>, el], [] as React.ReactNode[])}
                </span>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              {headers.map((h) => {
                const preview = rawRows.slice(0, 3).map((r) => String(r[h] ?? '')).filter(Boolean).join(' · ');
                return (
                  <div key={h} className="rounded-lg border border-slate-200 p-3 dark:border-border-dark">
                    <p className="font-mono text-xs font-bold text-slate-700 dark:text-slate-200">{h}</p>
                    {preview && <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{preview}</p>}
                    <Select
                      className="mt-2"
                      options={COLUMN_OPTIONS}
                      value={mapping[h] || 'ignore'}
                      onChange={(e) => setMapping({ ...mapping, [h]: e.target.value as ColumnKey })}
                    />
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="mt-4 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4" />Voltar</Button>
            <Button onClick={goToStep3} disabled={missingRequired.length > 0}>
              Validar dados<ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      {/* STEP 3: validação */}
      {step === 3 && (
        <>
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <Card className="px-4 py-3">
              <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Linhas</p>
              <p className="text-2xl font-bold tabular text-slate-900 dark:text-slate-100">{summary.total}</p>
            </Card>
            <Card className="px-4 py-3">
              <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Válidas</p>
              <p className="text-2xl font-bold tabular text-success">{summary.valid}</p>
            </Card>
            <Card className="px-4 py-3">
              <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Com erros</p>
              <p className="text-2xl font-bold tabular text-error">{summary.errors}</p>
            </Card>
            <Card className="px-4 py-3">
              <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Valor total</p>
              <p className="text-xl font-bold tabular text-slate-900 dark:text-slate-100">{brl(summary.valor_total)}</p>
            </Card>
          </div>

          {summary.errors > 0 && (
            <Card className="mb-4 p-5">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">Erros encontrados (primeiros {summary.errors_by_row.length})</h3>
              <div className="mt-3 max-h-60 overflow-y-auto">
                <table className="table">
                  <thead><tr><th className="w-12">Linha</th><th>Código</th><th>Descrição</th><th>Problemas</th></tr></thead>
                  <tbody>
                    {summary.errors_by_row.map((e) => (
                      <tr key={e.rowIndex}>
                        <td className="font-mono text-xs">{e.rowIndex}</td>
                        <td className="font-mono text-xs">{e.codigo || '—'}</td>
                        <td className="text-sm">{e.descricao || '—'}</td>
                        <td className="text-xs text-error">{e.errors.join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Linhas com erros não serão importadas. Você pode corrigir a planilha original e refazer o wizard, ou seguir e importar só as {summary.valid} linhas válidas.
              </p>
            </Card>
          )}

          <Card className="p-5">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">Pré-visualização hierárquica</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Níveis inferidos a partir do código (separador ".") — limite 5 níveis.
              Linhas em <strong>negrito</strong> são títulos (não recebem medição direta).
            </p>
            <div className="mt-3 max-h-96 overflow-y-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Descrição</th>
                    <th className="text-center">N</th>
                    <th className="text-center">Un.</th>
                    <th className="text-right">Qtd.</th>
                    <th className="text-right">Preço unit.</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 200).map((p) => (
                    <tr key={p.rowIndex} className={p.errors.length > 0 ? 'bg-red-50/50 dark:bg-red-900/10' : ''}>
                      <td className="font-mono text-xs">{p.codigo}</td>
                      <td className={p.is_title ? 'font-bold' : 'text-sm'} style={{ paddingLeft: `${(p.nivel - 1) * 16 + 12}px` }}>
                        {p.descricao}
                      </td>
                      <td className="text-center">
                        <Badge tone={p.nivel === 1 ? 'blue' : p.nivel === 2 ? 'purple' : 'slate'}>{p.nivel}</Badge>
                      </td>
                      <td className="text-center text-xs uppercase">{p.unidade}</td>
                      <td className="text-right tabular text-xs">{p.is_title ? '—' : num(p.quantidade_contratada, 4)}</td>
                      <td className="text-right tabular text-xs">{p.is_title ? '—' : brl(p.preco_unitario)}</td>
                      <td className="text-right tabular text-xs font-medium">{p.is_title ? '—' : brl(p.quantidade_contratada * p.preco_unitario)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.length > 200 && (
                <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
                  Mostrando 200 de {parsed.length}. O restante será importado normalmente.
                </p>
              )}
            </div>
          </Card>

          <div className="mt-4 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}><ArrowLeft className="h-4 w-4" />Voltar ao mapeamento</Button>
            <Button onClick={() => setStep(4)} disabled={summary.valid === 0}>
              Confirmar e importar<ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      {/* STEP 4: import final */}
      {step === 4 && (
        <Card className="p-8">
          {!done && (
            <>
              <Layers className="mx-auto h-10 w-10 text-navy dark:text-purple-300" />
              <h2 className="mt-4 text-center text-lg font-semibold text-slate-900 dark:text-slate-100">
                Confirmar importação
              </h2>
              <p className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">
                Vamos criar uma nova versão da planilha contratual com {summary.valid} itens.
              </p>

              <div className="mx-auto mt-6 max-w-md">
                <Field label="Motivo da nova versão" required>
                  <textarea className="input" rows={2}
                    value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                </Field>
              </div>

              {importError && (
                <div className="mx-auto mt-4 max-w-md flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4" /><span>{importError}</span>
                </div>
              )}

              <div className="mt-6 flex justify-center gap-2">
                <Button variant="ghost" onClick={() => setStep(3)}><ArrowLeft className="h-4 w-4" />Voltar</Button>
                <Button onClick={() => importMutation.mutate()} loading={importMutation.isPending}>
                  <Check className="h-4 w-4" />Importar {summary.valid} itens
                </Button>
              </div>
            </>
          )}

          {done && (
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-7 w-7 text-success" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
                Importação concluída
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {done.items} itens importados na nova versão da SOV.
              </p>
              <div className="mt-6 flex justify-center gap-2">
                <Button onClick={() => navigate(`/contratos/${id}/planilha`)}>
                  Ir para a planilha
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </Layout>
  );
}
