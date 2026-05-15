import { useState, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Camera, Calculator, AlertCircle, CheckCircle2,
  MapPin, FileImage, Upload, X, MessageSquare, Send,
} from 'lucide-react';
import {
  listCalcLines, upsertCalcLine, deleteCalcLine,
  listEvidences, uploadEvidence, deleteEvidence, getEvidenceUrl,
  listMItems, listItems,
  listItemComments, addItemComment,
  type CalcLine, type Evidence, type MeasurementItemComment,
} from '../lib/api';
import { humanizeError } from '../lib/errors';
import { num } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Field } from '../components/ui/FormField';
import { Empty, Skeleton } from '../components/ui/Stat';

const METODOS = ['geométrico', 'contagem', 'pesagem', 'área', 'volume', 'tempo'];

interface CalcRow extends Omit<CalcLine, 'id'> {
  id?: string;
}

const EMPTY_ROW: CalcRow = {
  measurement_item_id: '',
  local: '', metodo: 'geométrico', formula: '', variaveis: {},
  quantidade_calculada: 0, observacao: null,
};

/**
 * Avaliador simples e seguro de fórmulas matemáticas básicas.
 * Aceita: + - * / ( ) e nomes de variáveis. NÃO usa eval/Function diretamente
 * com input arbitrário — implementamos um shunting-yard mini para evitar XSS.
 */
function evaluateFormula(formula: string, vars: Record<string, number>): number | null {
  const f = formula.trim();
  if (!f) return null;
  // Tokens: números, variáveis, operadores, parênteses
  const tokens: string[] = [];
  let i = 0;
  while (i < f.length) {
    const c = f[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.,]/.test(c)) {
      let j = i;
      while (j < f.length && /[0-9.,]/.test(f[j])) j++;
      tokens.push(f.slice(i, j).replace(',', '.'));
      i = j;
    } else if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < f.length && /[a-zA-Z0-9_]/.test(f[j])) j++;
      tokens.push(f.slice(i, j));
      i = j;
    } else if ('+-*/()'.includes(c)) {
      tokens.push(c);
      i++;
    } else {
      return null; // caractere inválido
    }
  }

  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const out: string[] = [];
  const stack: string[] = [];
  for (const t of tokens) {
    if (/^-?[0-9.]+$/.test(t)) out.push(t);
    else if (/^[a-zA-Z_]/.test(t)) {
      const v = vars[t];
      if (v === undefined || !Number.isFinite(v)) return null;
      out.push(String(v));
    } else if (t === '(') stack.push(t);
    else if (t === ')') {
      while (stack.length && stack[stack.length - 1] !== '(') out.push(stack.pop()!);
      if (!stack.length) return null;
      stack.pop();
    } else if (prec[t] !== undefined) {
      while (stack.length && prec[stack[stack.length - 1]] !== undefined &&
             prec[stack[stack.length - 1]] >= prec[t]) {
        out.push(stack.pop()!);
      }
      stack.push(t);
    }
  }
  while (stack.length) {
    const op = stack.pop()!;
    if (op === '(' || op === ')') return null;
    out.push(op);
  }

  // Avalia RPN
  const vstack: number[] = [];
  for (const t of out) {
    if (/^-?[0-9.]+$/.test(t)) vstack.push(parseFloat(t));
    else {
      if (vstack.length < 2) return null;
      const b = vstack.pop()!;
      const a = vstack.pop()!;
      let r: number;
      if (t === '+') r = a + b;
      else if (t === '-') r = a - b;
      else if (t === '*') r = a * b;
      else if (t === '/') r = b !== 0 ? a / b : 0;
      else return null;
      vstack.push(r);
    }
  }
  return vstack.length === 1 ? vstack[0] : null;
}

/** Extrai nomes de variáveis usadas na fórmula (para gerar inputs). */
function extractVarNames(formula: string): string[] {
  const re = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  const set = new Set<string>();
  let m;
  while ((m = re.exec(formula)) !== null) set.add(m[1]);
  return Array.from(set);
}

export function MeasurementMemoryPage() {
  const { id = '', medId = '', itemId = '' } = useParams();

  // Busca o item medido para mostrar contexto (descrição, qtd lançada)
  const { data: mitems = [] } = useQuery({
    queryKey: ['mitems', medId],
    queryFn: () => listMItems(medId), enabled: !!medId,
  });
  // Itens contratuais do contrato (para resolver código/descrição do item)
  const { data: contractItems = [] } = useQuery({
    queryKey: ['items', id],
    queryFn: () => listItems(id), enabled: !!id,
  });

  // O parâmetro :itemId aqui é o contract_item_id; buscamos o measurement_item que aponta para ele
  const mitem = mitems.find((m) => m.contract_item_id === itemId);
  const ci = contractItems.find((c) => c.id === itemId);
  const measurementItemId = mitem?.id || '';

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['calc-lines', measurementItemId],
    queryFn: () => listCalcLines(measurementItemId),
    enabled: !!measurementItemId,
  });

  return (
    <Layout>
      <PageHeader
        title="Memória de cálculo"
        subtitle={ci ? `${ci.codigo} — ${ci.descricao}` : `Item ${itemId}`}
        backTo={`/contratos/${id}/medicoes/${medId}`}
        backLabel="Medição"
      />

      {/* Cabeçalho com contagem */}
      {mitem && (
        <Card className="mb-4 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Quantidade lançada</p>
              <p className="text-xl font-bold tabular text-slate-900 dark:text-slate-100">
                {num(mitem.quantidade_periodo, 6)} <span className="text-xs text-slate-500">{ci?.unidade || ''}</span>
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Soma das linhas de memória</p>
              <p className="text-xl font-bold tabular text-slate-900 dark:text-slate-100">
                {num(lines.reduce((s, l) => s + l.quantidade_calculada, 0), 6)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Diferença</p>
              <p className={`text-xl font-bold tabular ${
                Math.abs(mitem.quantidade_periodo - lines.reduce((s, l) => s + l.quantidade_calculada, 0)) < 0.01
                  ? 'text-success' : 'text-warning'
              }`}>
                {num(mitem.quantidade_periodo - lines.reduce((s, l) => s + l.quantidade_calculada, 0), 6)}
              </p>
            </div>
          </div>
        </Card>
      )}

      {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}

      {!isLoading && !measurementItemId && (
        <Empty title="Item não está nesta medição"
          body="Para lançar memória de cálculo, o item precisa ter sido medido no período. Volte à medição e adicione o item primeiro." />
      )}

      {!isLoading && measurementItemId && (
        <MemoryEditor
          measurementItemId={measurementItemId}
          measurementId={medId}
          lines={lines}
        />
      )}
    </Layout>
  );
}

// =============================================================================
// Editor de linhas + evidências
// =============================================================================
interface MemoryEditorProps {
  measurementItemId: string;
  measurementId: string;
  lines: CalcLine[];
}

function MemoryEditor({ measurementItemId, measurementId, lines }: MemoryEditorProps) {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CalcRow>(EMPTY_ROW);
  const [err, setErr] = useState<string | null>(null);

  function openNew() {
    setEditing({ ...EMPTY_ROW, measurement_item_id: measurementItemId });
    setErr(null);
    setModalOpen(true);
  }
  function openEdit(l: CalcLine) {
    setEditing({ ...l });
    setErr(null);
    setModalOpen(true);
  }

  const save = useMutation({
    mutationFn: () => upsertCalcLine(editing as any),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['calc-lines', measurementItemId] }); setModalOpen(false); },
    onError: (e: Error) => setErr(humanizeError(e)),
  });
  const del = useMutation({
    mutationFn: deleteCalcLine,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calc-lines', measurementItemId] }),
  });

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-border-dark">
          <h2 className="font-semibold dark:text-slate-100">Linhas de cálculo</h2>
          <Button onClick={openNew}><Plus className="h-4 w-4" />Adicionar linha</Button>
        </div>

        {lines.length === 0 ? (
          <div className="p-8 text-center">
            <Calculator className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              Nenhuma linha cadastrada. Adicione a primeira linha de memória de cálculo.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="table">
              <thead>
                <tr>
                  <th>Local</th>
                  <th>Método</th>
                  <th>Fórmula</th>
                  <th>Variáveis</th>
                  <th className="text-right">Quantidade</th>
                  <th>Evidências</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                    <td className="text-sm">
                      <MapPin className="mr-1 inline h-3 w-3 text-slate-400" />
                      {l.local || '—'}
                    </td>
                    <td className="text-xs uppercase">{l.metodo}</td>
                    <td className="font-mono text-xs">{l.formula || '—'}</td>
                    <td className="text-xs">
                      {Object.entries(l.variaveis || {}).map(([k, v]) => (
                        <span key={k} className="mr-2 inline-block rounded bg-slate-100 px-1 dark:bg-muted-dark">
                          {k}={v}
                        </span>
                      ))}
                    </td>
                    <td className="text-right tabular font-medium">{num(l.quantidade_calculada, 6)}</td>
                    <td>
                      <EvidenceCell calcLineId={l.id} measurementItemId={measurementItemId} measurementId={measurementId} />
                    </td>
                    <td className="text-right">
                      <button onClick={() => openEdit(l)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-muted-dark" title="Editar">
                        <Calculator className="h-4 w-4" />
                      </button>
                      <button onClick={() => { if (confirm('Remover linha?')) del.mutate(l.id); }}
                        className="rounded-lg p-1 text-error hover:bg-red-50 dark:hover:bg-red-900/20" title="Remover">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold dark:border-border-dark dark:bg-muted-dark">
                  <td colSpan={4} className="text-right">Soma:</td>
                  <td className="text-right tabular">
                    {num(lines.reduce((s, l) => s + l.quantidade_calculada, 0), 6)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ItemComments measurementId={measurementId} measurementItemId={measurementItemId} />

      <CalcLineModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        row={editing}
        onChange={setEditing}
        onSave={() => save.mutate()}
        saving={save.isPending}
        err={err}
      />
    </>
  );
}

// =============================================================================
// Comentários por item da medição (RN: comentário por item, não só geral)
// =============================================================================
function ItemComments({ measurementId, measurementItemId }: { measurementId: string; measurementItemId: string }) {
  const qc = useQueryClient();
  const { data: comments = [] } = useQuery({
    queryKey: ['item-comments', measurementItemId],
    queryFn: () => listItemComments(measurementItemId),
    enabled: !!measurementItemId,
  });
  const [text, setText] = useState('');
  const add = useMutation({
    mutationFn: () => addItemComment({ measurement_id: measurementId, measurement_item_id: measurementItemId, body: text.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['item-comments', measurementItemId] }); setText(''); },
  });

  return (
    <Card className="mt-4 p-4">
      <div className="mb-3 flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold dark:text-slate-100">Comentários neste item</h3>
        {comments.length > 0 && <Badge tone="slate">{comments.length}</Badge>}
      </div>

      {comments.length === 0 && (
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Sem comentários. Use para registrar dúvidas, ressalvas ou observações específicas deste item.</p>
      )}

      {comments.length > 0 && (
        <div className="mb-3 space-y-2">
          {comments.map((c) => (
            <div key={c.id} className="rounded-lg bg-slate-50 p-3 dark:bg-muted-dark">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{c.members?.nome || 'Sistema'}</p>
                <p className="text-[10px] text-slate-500">{c.created_at.slice(0, 16).replace('T', ' ')}</p>
              </div>
              <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">{c.body}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input className="input flex-1" placeholder="Escreva um comentário..."
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) add.mutate(); }}
        />
        <Button onClick={() => add.mutate()} disabled={!text.trim()} loading={add.isPending}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

// =============================================================================
// Modal de criar/editar linha (com avaliação automática da fórmula)
// =============================================================================
interface CalcLineModalProps {
  open: boolean;
  onClose: () => void;
  row: CalcRow;
  onChange: (r: CalcRow) => void;
  onSave: () => void;
  saving: boolean;
  err: string | null;
}

function CalcLineModal({ open, onClose, row, onChange, onSave, saving, err }: CalcLineModalProps) {
  const varNames = useMemo(() => extractVarNames(row.formula || ''), [row.formula]);

  function updateVar(name: string, value: string) {
    const v = Number(value.replace(',', '.'));
    const newVars = { ...row.variaveis, [name]: Number.isFinite(v) ? v : 0 };
    onChange(autoCalc({ ...row, variaveis: newVars }));
  }
  function updateFormula(formula: string) {
    onChange(autoCalc({ ...row, formula }));
  }
  function updateQtdManual(value: string) {
    const v = Number(value.replace(',', '.'));
    onChange({ ...row, quantidade_calculada: Number.isFinite(v) ? v : 0 });
  }

  function autoCalc(r: CalcRow): CalcRow {
    if (!r.formula) return r;
    const r2 = evaluateFormula(r.formula, r.variaveis);
    if (r2 === null) return r;
    return { ...r, quantidade_calculada: r2 };
  }

  const formulaValid = !row.formula || evaluateFormula(row.formula, row.variaveis) !== null;

  return (
    <Modal
      open={open} onClose={onClose}
      title={row.id ? 'Editar linha de memória' : 'Nova linha de memória de cálculo'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={onSave} loading={saving} disabled={!row.local && !row.formula}>
            Salvar linha
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Local / frente de serviço" hint="Ex: Bloco A — pavimento térreo">
            <input className="input" autoFocus
              value={row.local} onChange={(e) => onChange({ ...row, local: e.target.value })} />
          </Field>
          <Field label="Método de medição">
            <select className="input" value={row.metodo} onChange={(e) => onChange({ ...row, metodo: e.target.value })}>
              {METODOS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Fórmula"
          hint="Use + - * / e ( ) . Variáveis ficam disponíveis abaixo. Ex: comprimento * largura * espessura"
          error={!formulaValid ? 'Fórmula inválida. Verifique parênteses e operadores.' : null}>
          <input className="input font-mono" placeholder="comprimento * altura"
            value={row.formula} onChange={(e) => updateFormula(e.target.value)} />
        </Field>

        {varNames.length > 0 && (
          <Card className="bg-slate-50 p-4 dark:bg-muted-dark">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Variáveis da fórmula
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              {varNames.map((n) => (
                <Field key={n} label={n}>
                  <input type="number" step="0.0001" className="input tabular"
                    value={row.variaveis[n] ?? ''}
                    onChange={(e) => updateVar(n, e.target.value)} />
                </Field>
              ))}
            </div>
          </Card>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Quantidade calculada" hint={row.formula ? 'Calculada automaticamente' : 'Informe manualmente'}>
            <input type="number" step="0.000001" className="input tabular"
              value={row.quantidade_calculada || ''}
              readOnly={!!row.formula}
              onChange={(e) => updateQtdManual(e.target.value)} />
          </Field>
          <Field label="Observação">
            <input className="input" value={row.observacao || ''}
              onChange={(e) => onChange({ ...row, observacao: e.target.value || null })} />
          </Field>
        </div>

        {err && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4" /><span>{err}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

// =============================================================================
// Célula de evidências (anexar fotos com geolocalização)
// =============================================================================
interface EvidenceCellProps {
  calcLineId?: string;
  measurementItemId: string;
  measurementId: string;
}

function EvidenceCell({ measurementItemId, measurementId }: EvidenceCellProps) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: evidences = [] } = useQuery({
    queryKey: ['evidences', measurementItemId],
    queryFn: () => listEvidences(measurementItemId),
    enabled: !!measurementItemId,
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true); setErr(null);
    try {
      // Captura geolocalização opcional (com timeout curto, sem bloquear)
      let lat: number | undefined, lng: number | undefined;
      if (navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => { lat = pos.coords.latitude; lng = pos.coords.longitude; resolve(); },
            () => resolve(),
            { timeout: 3000, enableHighAccuracy: false },
          );
        });
      }
      await uploadEvidence({
        measurement_id: measurementId,
        measurement_item_id: measurementItemId,
        file,
        latitude: lat, longitude: lng,
        taken_at: new Date().toISOString(),
      });
      qc.invalidateQueries({ queryKey: ['evidences', measurementItemId] });
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => evidences.length > 0 ? setPreviewOpen(true) : fileInput.current?.click()}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 dark:border-border-dark dark:hover:bg-muted-dark"
      >
        <FileImage className="h-3 w-3" />
        {evidences.length === 0 ? 'Anexar' : `${evidences.length} arquivo${evidences.length > 1 ? 's' : ''}`}
      </button>
      <input
        ref={fileInput} type="file" className="hidden"
        accept="image/*,application/pdf"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />

      <Modal
        open={previewOpen} onClose={() => setPreviewOpen(false)}
        title="Evidências anexadas" subtitle={`${evidences.length} arquivos`}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => fileInput.current?.click()} loading={uploading}>
              <Upload className="h-4 w-4" />Anexar mais
            </Button>
            <Button variant="ghost" onClick={() => setPreviewOpen(false)}>Fechar</Button>
          </>
        }
      >
        {err && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4" /><span>{err}</span>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          {evidences.map((ev) => <EvidenceCard key={ev.id} ev={ev} />)}
        </div>
        {evidences.length === 0 && <p className="text-center text-sm text-slate-500">Nenhuma evidência ainda.</p>}
      </Modal>
    </>
  );
}

function EvidenceCard({ ev }: { ev: Evidence }) {
  const qc = useQueryClient();
  const { data: url } = useQuery({
    queryKey: ['evidence-url', ev.storage_path],
    queryFn: () => getEvidenceUrl(ev.storage_path),
    staleTime: 5 * 60 * 1000,
  });

  const del = useMutation({
    mutationFn: deleteEvidence,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['evidences', ev.measurement_item_id] }),
  });

  const isImage = ev.mime_type?.startsWith('image/');

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-border-dark">
      {isImage && url ? (
        <img src={url} alt={ev.nome_arquivo} className="h-32 w-full object-cover" />
      ) : (
        <div className="flex h-32 items-center justify-center bg-slate-100 dark:bg-muted-dark">
          <FileImage className="h-8 w-8 text-slate-400" />
        </div>
      )}
      <div className="p-2">
        <p className="truncate text-xs font-medium dark:text-slate-100">{ev.nome_arquivo}</p>
        <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
          <span>{Math.round((ev.tamanho_bytes || 0) / 1024)} KB</span>
          {(ev.latitude && ev.longitude) && (
            <Badge tone="green" className="!text-[9px]">
              <MapPin className="h-2.5 w-2.5" /> GPS
            </Badge>
          )}
        </div>
        <button onClick={() => { if (confirm('Remover evidência?')) del.mutate(ev.id); }}
          className="mt-2 flex items-center gap-1 text-[10px] text-error hover:underline">
          <X className="h-2.5 w-2.5" /> Remover
        </button>
      </div>
    </div>
  );
}
