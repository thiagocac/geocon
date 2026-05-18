import { useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  FileUp, FolderTree, Tag, Upload, AlertCircle, CheckCircle2,
  ArrowLeft, ArrowRight, Save, Layers,
} from 'lucide-react';
import {
  listGedCategories, listMetadataFields, listGedControlledTerms,
  listContracts, createGedDocument, uploadGedDocumentRevision,
  type GedCategory, type GedMetadataField, type GedControlledTerm,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { bytes } from '../../lib/format';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Field, Select } from '../../components/ui/FormField';
import { Skeleton } from '../../components/ui/Stat';

const MIME_ACCEPTED = '.pdf,.dwg,.dxf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.png,.jpg,.jpeg,image/*';

interface MetadataValues {
  [key: string]: string | number | boolean | null;
}

export function GedUploadWizard() {
  const nav = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [categoryId, setCategoryId] = useState('');
  const [contractId, setContractId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [revision, setRevision] = useState('0');
  const [metadata, setMetadata] = useState<MetadataValues>({});
  const [file, setFile] = useState<File | null>(null);
  const [keywords, setKeywords] = useState('');
  const [error, setError] = useState<string | null>(null);
  // V57: validade temporal opcional
  const [dataValidade, setDataValidade] = useState('');
  const [diasAlertaAntes, setDiasAlertaAntes] = useState(30);

  const { data: categories = [], isLoading: loadingCats } = useQuery({
    queryKey: ['ged-cats'], queryFn: listGedCategories,
  });
  const { data: contracts = [] } = useQuery({
    queryKey: ['contracts'], queryFn: listContracts,
  });
  const { data: fields = [] } = useQuery({
    queryKey: ['ged-fields', categoryId],
    queryFn: () => listMetadataFields(categoryId),
    enabled: !!categoryId,
  });
  const { data: terms = [] } = useQuery({
    queryKey: ['ged-terms'], queryFn: listGedControlledTerms,
  });

  const selectedCat = categories.find((c) => c.id === categoryId);

  const create = useMutation({
    mutationFn: () => createGedDocument({
      category_id: categoryId,
      contract_id: contractId || null,
      title: title.trim(),
      description: description.trim() || null,
      revision: revision.trim() || '0',
      file: file!,
      keywords: keywords.trim() ? keywords.split(',').map((k) => k.trim()).filter(Boolean) : [],
      metadata,
      data_validade: dataValidade || null,
      dias_alerta_antes: diasAlertaAntes,
    }),
    onSuccess: (docId) => nav(`/ged/documentos/${docId}`),
    onError: (e) => setError(humanizeError(e)),
  });

  function next() {
    setError(null);
    if (step === 1) {
      if (!categoryId) { setError('Selecione uma categoria'); return; }
      if (!title.trim()) { setError('Informe o título do documento'); return; }
      setStep(2);
    } else if (step === 2) {
      const missing = fields.filter((f) => f.required && (metadata[f.key] === undefined || metadata[f.key] === '' || metadata[f.key] === null));
      if (missing.length > 0) {
        setError(`Campo(s) obrigatório(s) sem valor: ${missing.map((m) => m.label).join(', ')}`);
        return;
      }
      setStep(3);
    }
  }
  function back() { setError(null); setStep((s) => (s > 1 ? ((s - 1) as 1 | 2) : 1)); }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) { setError('Selecione um arquivo'); return; }
    if (file.size > 50 * 1024 * 1024) { setError('Arquivo maior que 50 MB. Comprima antes de enviar.'); return; }
    create.mutate();
  }

  return (
    <Layout>
      <PageHeader
        title="Novo documento"
        subtitle="Cadastro de documento na GED — wizard de 3 passos"
        backTo="/ged" backLabel="GED"
      />

      <StepIndicator step={step} />

      {loadingCats && <Card className="p-6"><Skeleton className="h-32" /></Card>}

      {!loadingCats && step === 1 && (
        <Step1
          categories={categories}
          categoryId={categoryId} setCategoryId={setCategoryId}
          contracts={contracts}
          contractId={contractId} setContractId={setContractId}
          title={title} setTitle={setTitle}
        />
      )}

      {!loadingCats && step === 2 && selectedCat && (
        <Step2
          category={selectedCat}
          fields={fields}
          terms={terms}
          values={metadata}
          onChange={(k, v) => setMetadata((prev) => ({ ...prev, [k]: v }))}
          description={description} setDescription={setDescription}
        />
      )}

      {!loadingCats && step === 3 && selectedCat && (
        <Step3
          category={selectedCat}
          revision={revision} setRevision={setRevision}
          file={file} setFile={setFile}
          keywords={keywords} setKeywords={setKeywords}
          dataValidade={dataValidade} setDataValidade={setDataValidade}
          diasAlertaAntes={diasAlertaAntes} setDiasAlertaAntes={setDiasAlertaAntes}
        />
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <footer className="mt-6 flex items-center justify-between">
        <Button variant="outline" onClick={back} disabled={step === 1}>
          <ArrowLeft className="h-4 w-4" />Anterior
        </Button>
        {step < 3 && (
          <Button onClick={next}>
            Próximo<ArrowRight className="h-4 w-4" />
          </Button>
        )}
        {step === 3 && (
          <Button onClick={submit} loading={create.isPending} disabled={!file}>
            <Save className="h-4 w-4" />Cadastrar documento
          </Button>
        )}
      </footer>
    </Layout>
  );
}

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: 'Categoria & contrato', icon: FolderTree },
    { n: 2, label: 'Metadados',            icon: Tag },
    { n: 3, label: 'Arquivo',              icon: Upload },
  ];
  return (
    <div className="mb-4 flex items-center gap-2">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const done = step > s.n;
        const active = step === s.n;
        return (
          <div key={s.n} className="flex flex-1 items-center gap-2">
            <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${
              done ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200' :
              active ? 'bg-navy text-white' :
              'bg-slate-100 text-slate-500 dark:bg-muted-dark dark:text-slate-400'
            }`}>
              {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            </div>
            <div className="flex-1">
              <div className={`text-[10px] uppercase tracking-wider ${active ? 'text-navy dark:text-purple' : 'text-slate-500'}`}>Passo {s.n}</div>
              <div className={`text-sm font-medium ${active ? 'text-navy dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}`}>{s.label}</div>
            </div>
            {i < steps.length - 1 && (
              <div className={`hidden h-0.5 flex-1 sm:block ${done ? 'bg-green-200 dark:bg-green-900/50' : 'bg-slate-200 dark:bg-border-dark'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Step1({ categories, categoryId, setCategoryId, contracts, contractId, setContractId, title, setTitle }: {
  categories: GedCategory[];
  categoryId: string;
  setCategoryId: (v: string) => void;
  contracts: { id: string; numero: string; titulo?: string | null }[];
  contractId: string;
  setContractId: (v: string) => void;
  title: string;
  setTitle: (v: string) => void;
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold dark:text-slate-100">Categoria e contrato</h2>
      <p className="mb-4 text-sm text-slate-500">Escolha o tipo de documento e a qual contrato ele pertence. Documentos sem contrato ficam apenas no acervo do tenant.</p>

      <div className="space-y-4">
        <Field label="Categoria" required>
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            placeholder="— Selecionar —"
            options={categories.map((c) => ({ value: c.id, label: `${c.codigo} — ${c.nome}` }))}
          />
          {categoryId && (() => {
            const cat = categories.find((c) => c.id === categoryId);
            if (!cat) return null;
            return (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {cat.requires_physical_original && <Badge tone="yellow">Exige original físico arquivado</Badge>}
                {cat.nomenclature_pattern && (
                  <span className="text-slate-500">
                    Padrão: <code className="font-mono text-navy dark:text-purple">{cat.nomenclature_pattern}</code>
                  </span>
                )}
              </div>
            );
          })()}
        </Field>

        <Field label="Contrato (opcional)" hint="Documentos vinculados a um contrato aparecem na aba GED dele">
          <Select
            value={contractId}
            onChange={(e) => setContractId(e.target.value)}
            placeholder="— Nenhum (acervo geral) —"
            options={contracts.map((c) => ({ value: c.id, label: `${c.numero}${c.titulo ? ' — ' + c.titulo : ''}` }))}
          />
        </Field>

        <Field label="Título do documento" required>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input"
                 placeholder="Ex: Planta arquitetônica — pavimento 2" />
        </Field>
      </div>
    </Card>
  );
}

function Step2({ category, fields, terms, values, onChange, description, setDescription }: {
  category: GedCategory;
  fields: GedMetadataField[];
  terms: GedControlledTerm[];
  values: MetadataValues;
  onChange: (key: string, value: string | number | boolean | null) => void;
  description: string;
  setDescription: (v: string) => void;
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold dark:text-slate-100">Metadados de "{category.nome}"</h2>
      <p className="mb-4 text-sm text-slate-500">
        Campos definidos para esta categoria. Campos marcados com <span className="text-error">*</span> são obrigatórios.
      </p>

      {fields.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-border-dark">
          <Layers className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          Esta categoria não tem campos configurados. Você pode adicionar campos em <Link to="/ged/categorias" className="text-navy underline">Taxonomia</Link>.
        </div>
      )}

      {fields.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => <MetadataInput key={f.id} field={f} terms={terms} value={values[f.key]} onChange={(v) => onChange(f.key, v)} />)}
        </div>
      )}

      <div className="mt-4">
        <Field label="Descrição" hint="Resumo livre que ajuda na busca futura">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input min-h-[80px] resize-y"
            rows={3}
            placeholder="Resumo do conteúdo, contexto, observações relevantes…"
          />
        </Field>
      </div>
    </Card>
  );
}

function MetadataInput({ field, terms, value, onChange }: {
  field: GedMetadataField;
  terms: GedControlledTerm[];
  value: string | number | boolean | null | undefined;
  onChange: (v: string | number | boolean | null) => void;
}) {
  if (field.field_type === 'controlled_term') {
    // Sem controlled_term_id no shape exposto do field; procuramos pelo termo cuja key bate
    // (convenção do seed: a chave do campo = a key do termo). Se não bater, sem opções.
    const term = terms.find((t) => t.key === field.key);
    return (
      <Field label={field.label} required={field.required} hint={!term ? `Crie um termo controlado com a chave "${field.key}" em GED → Termos` : undefined}>
        <Select
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="— Selecionar —"
          options={(term?.values || []).filter((v) => v.active).map((v) => ({ value: v.value, label: v.label }))}
        />
      </Field>
    );
  }
  if (field.field_type === 'date') {
    return (
      <Field label={field.label} required={field.required}>
        <input type="date" value={(value as string) || ''} onChange={(e) => onChange(e.target.value || null)} className="input" />
      </Field>
    );
  }
  if (field.field_type === 'number') {
    return (
      <Field label={field.label} required={field.required}>
        <input type="number" value={(value as number | string) ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} className="input" />
      </Field>
    );
  }
  if (field.field_type === 'boolean') {
    return (
      <Field label={field.label} required={field.required}>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          Sim
        </label>
      </Field>
    );
  }
  // Tipos referenciais (member/contract/lot/discipline/item) e text caem aqui — usamos input simples por enquanto
  return (
    <Field
      label={field.label}
      required={field.required}
      hint={field.field_type !== 'text' ? `Tipo "${field.field_type}" — entrada como texto livre nesta versão` : undefined}
    >
      <input type="text" value={(value as string) || ''} onChange={(e) => onChange(e.target.value || null)} className="input" />
    </Field>
  );
}

function Step3({
  category, revision, setRevision, file, setFile, keywords, setKeywords,
  dataValidade, setDataValidade, diasAlertaAntes, setDiasAlertaAntes,
}: {
  category: GedCategory;
  revision: string;
  setRevision: (v: string) => void;
  file: File | null;
  setFile: (f: File | null) => void;
  keywords: string;
  setKeywords: (v: string) => void;
  dataValidade: string;
  setDataValidade: (v: string) => void;
  diasAlertaAntes: number;
  setDiasAlertaAntes: (v: number) => void;
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold dark:text-slate-100">Arquivo e revisão</h2>
      <p className="mb-4 text-sm text-slate-500">Envie a primeira versão. Você poderá fazer upload de revisões posteriores na página do documento.</p>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_3fr]">
          <Field label="Revisão" hint="Iniciar em 0 ou A">
            <input type="text" value={revision} onChange={(e) => setRevision(e.target.value)} className="input font-mono uppercase" maxLength={4} />
          </Field>
          <Field label="Palavras-chave" hint="Separadas por vírgula. Indexam a busca">
            <input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} className="input"
                   placeholder="arquitetura, pavimento 2, bloco cirúrgico" />
          </Field>
        </div>

        <Field label="Arquivo" required hint="Aceita PDF, DWG, DOC, XLS, PPT, ZIP, imagens. Máx 50 MB.">
          <div className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center dark:border-border-dark dark:bg-muted-dark/40">
            <input
              type="file"
              accept={MIME_ACCEPTED}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="hidden"
              id="ged-file-input"
            />
            <label htmlFor="ged-file-input" className="cursor-pointer">
              <FileUp className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                {file ? 'Arquivo selecionado:' : 'Clique para escolher um arquivo'}
              </p>
              {file && (
                <p className="mt-1 text-xs text-slate-500">
                  <span className="font-medium">{file.name}</span> · {bytes(file.size)} · {file.type || 'tipo desconhecido'}
                </p>
              )}
            </label>
          </div>
        </Field>

        {/* V57: validade temporal opcional — útil para ARTs, licenças, ASOs etc */}
        <details className="rounded-lg border border-slate-200 px-4 py-3 dark:border-border-dark">
          <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-200">
            Validade temporal (opcional) — para ARTs, licenças, ASOs, certidões
          </summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="Data de validade" hint="Deixe vazio se o documento não expira">
              <input type="date" value={dataValidade}
                     onChange={(e) => setDataValidade(e.target.value)}
                     className="input" />
            </Field>
            <Field label="Avisar X dias antes" hint="0-365 · padrão 30">
              <input type="number" min={0} max={365}
                     value={diasAlertaAntes}
                     onChange={(e) => setDiasAlertaAntes(Number(e.target.value) || 30)}
                     className="input"
                     disabled={!dataValidade} />
            </Field>
          </div>
          {dataValidade && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              O sistema gerará alertas em tempo real quando faltar ≤ {diasAlertaAntes} dias para o vencimento.
            </p>
          )}
        </details>

        {category.requires_physical_original && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-900/10 dark:text-yellow-200">
            <strong>Atenção:</strong> esta categoria exige original físico arquivado. Após o cadastro, lembre-se de gerar a etiqueta e arquivar.
          </div>
        )}
      </div>
    </Card>
  );
}

// =============================================================================
// REVISION UPLOAD (página /ged/documentos/:id/nova-revisao)
// =============================================================================
export function GedRevisionUpload() {
  const nav = useNavigate();
  const { docId = '' } = useParams();
  const [revision, setRevision] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: () => uploadGedDocumentRevision({ document_id: docId, revision: revision.trim(), file: file! }),
    onSuccess: () => nav(`/ged/documentos/${docId}`),
    onError: (e) => setError(humanizeError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!revision.trim()) { setError('Informe a nova revisão'); return; }
    if (!file) { setError('Selecione um arquivo'); return; }
    upload.mutate();
  }

  return (
    <Layout>
      <PageHeader
        title="Nova revisão"
        subtitle="A revisão anterior será marcada como obsoleta automaticamente"
        backTo={`/ged/documentos/${docId}`} backLabel="Documento"
      />

      <Card className="p-5">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Identificador da nova revisão" required hint="Ex: 1, 2, A, B">
            <input type="text" value={revision} onChange={(e) => setRevision(e.target.value)} className="input font-mono uppercase" maxLength={4} />
          </Field>

          <Field label="Arquivo" required>
            <div className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center dark:border-border-dark dark:bg-muted-dark/40">
              <input
                type="file"
                accept={MIME_ACCEPTED}
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
                id="ged-rev-file-input"
              />
              <label htmlFor="ged-rev-file-input" className="cursor-pointer">
                <FileUp className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                  {file ? 'Arquivo selecionado:' : 'Clique para escolher um arquivo'}
                </p>
                {file && <p className="mt-1 text-xs text-slate-500"><span className="font-medium">{file.name}</span> · {bytes(file.size)}</p>}
              </label>
            </div>
          </Field>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-error">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}

          <Button type="submit" loading={upload.isPending}>
            <Save className="h-4 w-4" />Enviar revisão
          </Button>
        </form>
      </Card>
    </Layout>
  );
}
