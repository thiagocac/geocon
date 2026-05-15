import { useState, useMemo, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Plus, Send, FileText, AlertCircle, CheckCircle2, Save, ArrowLeft, ArrowRight,
  Download, XCircle, Eye, ChevronRight, Search,
} from 'lucide-react';
import {
  listTransmittals, getTransmittal, listTransmittalDocuments, listTransmittalReceipts,
  issueGrd, sendGrd, cancelGrd, generateGrdPdf, confirmGrdReceipt,
  listContracts, listContractOrganizations, listGedMasterList, listGedDocumentVersions,
  type GedReceipt, type GedMasterListItem, type GedDocumentVersion,
} from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { dtTime, dt } from '../../lib/format';
import { humanizeError } from '../../lib/errors';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Field, Select } from '../../components/ui/FormField';
import { Empty, Skeleton } from '../../components/ui/Stat';

const TRANSMITTAL_STATUS: Record<string, { label: string; tone: 'slate' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' }> = {
  rascunho:         { label: 'Rascunho',           tone: 'slate' },
  enviada:          { label: 'Enviada',            tone: 'blue' },
  recebida_parcial: { label: 'Recebida parcial',   tone: 'yellow' },
  recebida:         { label: 'Recebida',           tone: 'green' },
  cancelada:        { label: 'Cancelada',          tone: 'red' },
};

// =============================================================================
// LIST
// =============================================================================
export function GedDistribution() {
  const [filterStatus, setFilterStatus] = useState('');
  const { data: list = [], isLoading } = useQuery({
    queryKey: ['ged-transmittals'],
    queryFn: () => listTransmittals(),
  });

  const filtered = useMemo(() => filterStatus ? list.filter((t) => t.status === filterStatus) : list, [list, filterStatus]);

  return (
    <Layout>
      <PageHeader
        title="Distribuição documental (GRD)"
        subtitle="Guias de remessa de documentos, listas de distribuição e confirmação de recebimento"
        backTo="/ged" backLabel="GED"
        actions={<Link to="nova"><Button><Plus className="h-4 w-4" />Nova GRD</Button></Link>}
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            placeholder="Todos os status"
            options={Object.entries(TRANSMITTAL_STATUS).map(([v, c]) => ({ value: v, label: c.label }))}
          />
          <div className="flex items-center text-sm text-slate-500">
            {filtered.length} GRD{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      </Card>

      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}
      {!isLoading && filtered.length === 0 && (
        <Empty title="Nenhuma GRD emitida" body="Crie a primeira guia para distribuir documentos." />
      )}

      {filtered.length > 0 && (
        <Card className="overflow-hidden">
          <table className="table">
            <thead><tr>
              <th>Número</th><th>Assunto</th><th>Contrato</th><th>Destinatário</th>
              <th>Docs</th><th>Recebimentos</th><th>Enviada em</th><th>Status</th><th />
            </tr></thead>
            <tbody>
              {filtered.map((t) => {
                const st = TRANSMITTAL_STATUS[t.status] || { label: t.status, tone: 'slate' as const };
                const pctReceipts = t.receipts_total > 0 ? (t.receipts_confirmed / t.receipts_total) * 100 : 0;
                return (
                  <tr key={t.id}>
                    <td className="font-mono text-xs">{t.numero}</td>
                    <td className="max-w-xs truncate font-medium">{t.title}</td>
                    <td className="font-mono text-xs">{t.contract_numero || '—'}</td>
                    <td>{t.recipient_nome || '—'}</td>
                    <td className="text-center">{t.docs_count}</td>
                    <td>
                      {t.receipts_total > 0 ? (
                        <span className="text-xs">
                          {t.receipts_confirmed}/{t.receipts_total}{' '}
                          <span className="text-slate-500">({Math.round(pctReceipts)}%)</span>
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="text-xs text-slate-500">{t.sent_at ? dt(t.sent_at) : '—'}</td>
                    <td><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className="text-right">
                      <Link to={t.id} className="text-navy underline-offset-2 hover:underline">Ver</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </Layout>
  );
}

// =============================================================================
// WIZARD — Nova GRD
// =============================================================================
export function GedDistributionWizard() {
  const nav = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [contractId, setContractId] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [title, setTitle] = useState('');
  const [selectedVersions, setSelectedVersions] = useState<Map<string, { versionId: string; revision: string; title: string; finalidade: string }>>(new Map());
  const [docSearch, setDocSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: contracts = [] } = useQuery({ queryKey: ['contracts'], queryFn: listContracts });
  const { data: organizations = [] } = useQuery({
    queryKey: ['contract-orgs', contractId],
    queryFn: () => listContractOrganizations(contractId),
    enabled: !!contractId,
  });
  const { data: documents = [] } = useQuery({
    queryKey: ['ged-master', null, null, docSearch],
    queryFn: () => listGedMasterList({ query: docSearch || null, contractId }),
    enabled: !!contractId && step === 2,
  });

  const issue = useMutation({
    mutationFn: () => issueGrd({
      contract_id: contractId,
      recipient_organization_id: recipientId,
      title: title.trim(),
      document_version_ids: Array.from(selectedVersions.values()).map((s) => s.versionId),
      finalidades: Array.from(selectedVersions.values()).map((s) => s.finalidade),
    }),
    onSuccess: (id) => nav(`/ged/distribuicao/${id}`),
    onError: (e) => setError(humanizeError(e)),
  });

  function next() {
    setError(null);
    if (step === 1) {
      if (!contractId) { setError('Selecione um contrato'); return; }
      if (!recipientId) { setError('Selecione o destinatário'); return; }
      if (!title.trim()) { setError('Informe o assunto da GRD'); return; }
      setStep(2);
    } else if (step === 2) {
      if (selectedVersions.size === 0) { setError('Selecione ao menos um documento'); return; }
      setStep(3);
    }
  }
  function back() { setError(null); setStep((s) => (s > 1 ? ((s - 1) as 1 | 2) : 1)); }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    issue.mutate();
  }

  return (
    <Layout>
      <PageHeader
        title="Nova GRD"
        subtitle="Wizard de 3 passos para emitir uma guia de remessa"
        backTo="/ged/distribuicao" backLabel="Distribuição"
      />

      <WizardSteps step={step} />

      {step === 1 && (
        <Card className="p-5">
          <h2 className="mb-1 font-semibold dark:text-slate-100">Contrato, destinatário e assunto</h2>
          <p className="mb-4 text-sm text-slate-500">Defina o contrato de origem, para quem é destinada a remessa e o assunto.</p>
          <div className="space-y-4">
            <Field label="Contrato" required>
              <Select
                value={contractId}
                onChange={(e) => { setContractId(e.target.value); setRecipientId(''); setSelectedVersions(new Map()); }}
                placeholder="— Selecionar —"
                options={contracts.map((c) => ({ value: c.id, label: `${c.numero}${c.objeto ? ' — ' + String(c.objeto).slice(0, 50) : ''}` }))}
              />
            </Field>

            <Field label="Destinatário" required hint="Uma das partes do contrato (contratante, contratada ou gerenciadora)">
              <Select
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                placeholder={contractId ? '— Selecionar —' : 'Selecione o contrato primeiro'}
                disabled={!contractId}
                options={organizations.map((o) => ({ value: o.id, label: `${o.nome}${o.tipo ? ' — ' + o.tipo : ''}` }))}
              />
            </Field>

            <Field label="Assunto" required>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input"
                     placeholder="Ex: Remessa de plantas executivas — bloco cirúrgico" />
            </Field>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Step2Documents
          contractId={contractId}
          documents={documents}
          search={docSearch}
          setSearch={setDocSearch}
          selected={selectedVersions}
          onToggle={(doc, version, finalidade) => {
            setSelectedVersions((prev) => {
              const next = new Map(prev);
              const key = doc.id;
              if (next.has(key)) {
                next.delete(key);
              } else {
                next.set(key, { versionId: version.id, revision: version.revision, title: doc.title, finalidade: finalidade || 'informacao' });
              }
              return next;
            });
          }}
          onChangeFinalidade={(docId, finalidade) => {
            setSelectedVersions((prev) => {
              const next = new Map(prev);
              const cur = next.get(docId);
              if (cur) next.set(docId, { ...cur, finalidade });
              return next;
            });
          }}
        />
      )}

      {step === 3 && (
        <Card className="p-5">
          <h2 className="mb-1 font-semibold dark:text-slate-100">Revisão e confirmação</h2>
          <p className="mb-4 text-sm text-slate-500">Confira os dados antes de criar a GRD. Após a criação ela ficará em <strong>rascunho</strong> — só será enviada quando você clicar em "Enviar" na página da GRD.</p>

          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Contrato</dt>
              <dd className="font-mono dark:text-slate-100">{contracts.find((c) => c.id === contractId)?.numero}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Destinatário</dt>
              <dd className="dark:text-slate-100">{organizations.find((o) => o.id === recipientId)?.nome}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Assunto</dt>
              <dd className="dark:text-slate-100">{title}</dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-border-dark">
            <h3 className="mb-2 text-sm font-semibold dark:text-slate-100">Documentos selecionados ({selectedVersions.size})</h3>
            <ul className="divide-y divide-slate-100 dark:divide-border-dark">
              {Array.from(selectedVersions.entries()).map(([docId, s]) => (
                <li key={docId} className="flex items-center gap-3 py-2 text-sm">
                  <FileText className="h-4 w-4 text-slate-400" />
                  <span className="flex-1 dark:text-slate-100">{s.title}</span>
                  <span className="font-mono text-xs text-slate-500">Rev. {s.revision}</span>
                  <Badge tone="purple">{s.finalidade}</Badge>
                </li>
              ))}
            </ul>
          </div>
        </Card>
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
          <Button onClick={next}>Próximo<ArrowRight className="h-4 w-4" /></Button>
        )}
        {step === 3 && (
          <Button onClick={submit} loading={issue.isPending}>
            <Save className="h-4 w-4" />Criar GRD (rascunho)
          </Button>
        )}
      </footer>
    </Layout>
  );
}

function WizardSteps({ step }: { step: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: 'Contrato e destinatário' },
    { n: 2, label: 'Documentos' },
    { n: 3, label: 'Confirmação' },
  ];
  return (
    <div className="mb-4 flex items-center gap-2">
      {steps.map((s, i) => {
        const done = step > s.n;
        const active = step === s.n;
        return (
          <div key={s.n} className="flex flex-1 items-center gap-2">
            <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${
              done ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200' :
              active ? 'bg-navy text-white' :
              'bg-slate-100 text-slate-500 dark:bg-muted-dark dark:text-slate-400'
            }`}>
              {done ? <CheckCircle2 className="h-4 w-4" /> : s.n}
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

const FINALIDADE_OPTIONS = [
  { value: 'informacao',     label: 'Informação' },
  { value: 'aprovacao',      label: 'Aprovação' },
  { value: 'comentarios',    label: 'Comentários' },
  { value: 'uso_obra',       label: 'Uso em obra' },
  { value: 'arquivamento',   label: 'Arquivamento' },
  { value: 'cumprimento_legal', label: 'Cumprimento legal' },
];

function Step2Documents({ contractId, documents, search, setSearch, selected, onToggle, onChangeFinalidade }: {
  contractId: string;
  documents: GedMasterListItem[];
  search: string;
  setSearch: (s: string) => void;
  selected: Map<string, { versionId: string; revision: string; title: string; finalidade: string }>;
  onToggle: (doc: GedMasterListItem, version: GedDocumentVersion, finalidade?: string) => void;
  onChangeFinalidade: (docId: string, finalidade: string) => void;
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold dark:text-slate-100">Documentos da GRD</h2>
      <p className="mb-4 text-sm text-slate-500">
        Selecione os documentos do contrato a serem incluídos. A revisão vigente de cada um é enviada automaticamente.
      </p>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar documentos do contrato…" className="input pl-10"
        />
      </div>

      {!contractId && (
        <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-border-dark">
          Selecione um contrato no passo 1.
        </p>
      )}
      {contractId && documents.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-border-dark">
          Sem documentos cadastrados para este contrato.
        </p>
      )}
      {documents.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-border-dark">
          {documents.map((d) => (
            <DocumentPickerRow
              key={d.id}
              doc={d}
              selected={selected.get(d.id)}
              onToggle={(version) => onToggle(d, version)}
              onChangeFinalidade={(f) => onChangeFinalidade(d.id, f)}
            />
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-muted-dark">
        {selected.size} documento{selected.size !== 1 ? 's' : ''} selecionado{selected.size !== 1 ? 's' : ''}
      </div>
    </Card>
  );
}

function DocumentPickerRow({ doc, selected, onToggle, onChangeFinalidade }: {
  doc: GedMasterListItem;
  selected: { versionId: string; revision: string; title: string; finalidade: string } | undefined;
  onToggle: (version: GedDocumentVersion) => void;
  onChangeFinalidade: (f: string) => void;
}) {
  const { data: versions = [] } = useQuery({
    queryKey: ['ged-versions', doc.id],
    queryFn: () => listGedDocumentVersions(doc.id),
    enabled: !!doc.id,
  });
  const vigente = versions.find((v) => v.status === 'vigente') || versions[0];
  const isSelected = !!selected;

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={isSelected}
          disabled={!vigente}
          onChange={() => vigente && onToggle(vigente)}
          className="mt-1"
          aria-label={`Selecionar ${doc.title}`}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono text-xs text-slate-500">{doc.nomenclature_code || doc.numero || '—'}</span>
            <span className="font-medium dark:text-slate-100">{doc.title}</span>
          </div>
          <div className="text-xs text-slate-500">
            {doc.category_codigo} · {doc.category_nome} · Rev. atual {doc.revisao_atual || '0'} ({doc.versions_count} versões)
          </div>
        </div>
        {isSelected && (
          <Select
            value={selected.finalidade}
            onChange={(e) => onChangeFinalidade(e.target.value)}
            options={FINALIDADE_OPTIONS}
            className="!w-44"
          />
        )}
      </div>
    </li>
  );
}

// =============================================================================
// DETAIL
// =============================================================================
export function GedDistributionDetail() {
  const { grdId = '' } = useParams();
  const qc = useQueryClient();

  const { data: grd, isLoading } = useQuery({
    queryKey: ['ged-transmittal', grdId],
    queryFn: () => getTransmittal(grdId),
    enabled: !!grdId,
  });
  const { data: tdocs = [] } = useQuery({
    queryKey: ['ged-transmittal-docs', grdId],
    queryFn: () => listTransmittalDocuments(grdId),
    enabled: !!grdId,
  });
  const { data: receipts = [] } = useQuery({
    queryKey: ['ged-receipts', grdId],
    queryFn: () => listTransmittalReceipts(grdId),
    enabled: !!grdId,
  });

  const send = useMutation({
    mutationFn: () => sendGrd(grdId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ged-transmittal', grdId] }),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => cancelGrd(grdId, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ged-transmittal', grdId] }),
  });
  const genPdf = useMutation({
    mutationFn: () => generateGrdPdf(grdId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ged-transmittal', grdId] }),
  });

  async function downloadPdf() {
    const path = grd?.metadata?.pdf_path;
    if (!path) {
      const r = await genPdf.mutateAsync();
      if (r?.storage_path) {
        const url = await getGrdSignedUrl(r.storage_path);
        if (url) window.open(url, '_blank');
      }
      return;
    }
    const url = await getGrdSignedUrl(path);
    if (url) window.open(url, '_blank');
  }

  if (isLoading) return <Layout><Card className="p-6"><Skeleton className="h-64" /></Card></Layout>;
  if (!grd) return <Layout><Empty title="GRD não encontrada" body="A guia solicitada não existe ou foi removida." /></Layout>;

  const st = TRANSMITTAL_STATUS[grd.status] || { label: grd.status, tone: 'slate' as const };
  const isRascunho = grd.status === 'rascunho';
  const isEnviada  = grd.status === 'enviada' || grd.status === 'recebida_parcial';

  return (
    <Layout>
      <PageHeader
        title={`GRD ${grd.numero}`}
        subtitle={grd.title}
        backTo="/ged/distribuicao" backLabel="Distribuição"
        actions={
          <>
            <Button variant="outline" onClick={downloadPdf} loading={genPdf.isPending}>
              <Download className="h-4 w-4" />{grd.metadata?.pdf_path ? 'Baixar PDF' : 'Gerar PDF'}
            </Button>
            {isRascunho && (
              <Button onClick={() => send.mutate()} loading={send.isPending}>
                <Send className="h-4 w-4" />Enviar GRD
              </Button>
            )}
            {(isRascunho || isEnviada) && (
              <Button variant="danger" onClick={() => {
                const reason = prompt('Motivo do cancelamento (opcional):') || undefined;
                if (confirm(`Cancelar a GRD ${grd.numero}? Esta ação não pode ser desfeita.`)) cancel.mutate(reason || '');
              }} loading={cancel.isPending}>
                <XCircle className="h-4 w-4" />Cancelar
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          {/* Cabeçalho */}
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-mono text-slate-500">{grd.numero}</div>
                <h2 className="mt-1 text-lg font-semibold dark:text-slate-100">{grd.title}</h2>
                {grd.contract_numero && (
                  <p className="mt-1 text-sm text-slate-500">
                    Contrato <Link to={`/contratos/${grd.contract_id}`} className="font-mono text-navy hover:underline">{grd.contract_numero}</Link>
                  </p>
                )}
              </div>
              <Badge tone={st.tone}>{st.label}</Badge>
            </div>

            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">Remetente</dt>
                <dd className="dark:text-slate-100">{grd.sender_nome || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Destinatário</dt>
                <dd className="dark:text-slate-100">
                  {grd.recipient_nome || '—'}
                  {grd.recipient_cnpj && <div className="text-xs text-slate-500">CNPJ {grd.recipient_cnpj}</div>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Criada em</dt>
                <dd className="dark:text-slate-100">{dtTime(grd.created_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Enviada em</dt>
                <dd className="dark:text-slate-100">{grd.sent_at ? dtTime(grd.sent_at) : '—'}</dd>
              </div>
            </dl>
          </Card>

          {/* Documentos */}
          <Card className="overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-border-dark">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" />
                <h3 className="font-semibold dark:text-slate-100">Documentos ({tdocs.length})</h3>
              </div>
            </header>
            {tdocs.length === 0 && (
              <p className="px-5 py-6 text-center text-sm text-slate-500">Sem documentos.</p>
            )}
            {tdocs.length > 0 && (
              <ul className="divide-y divide-slate-100 dark:divide-border-dark">
                {tdocs.map((td, i) => {
                  const v = td.ged_document_versions;
                  const d = v?.ged_documents;
                  return (
                    <li key={td.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                      <span className="font-mono text-xs text-slate-400 w-6">#{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Link to={`/ged/documentos/${d?.id}`} className="font-medium text-navy hover:underline">
                            {d?.title || '—'}
                          </Link>
                          <Badge tone="slate">{d?.ged_categories?.codigo}</Badge>
                        </div>
                        <div className="text-xs text-slate-500">
                          {d?.nomenclature_code || d?.numero || '—'} · Rev. {v?.revision || '0'}
                          {td.finalidade && <> · finalidade: <span className="font-medium">{td.finalidade}</span></>}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* Sidebar: confirmações */}
        <Card className="overflow-hidden">
          <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 dark:border-border-dark">
            <Eye className="h-4 w-4 text-slate-500" />
            <h3 className="font-semibold text-sm dark:text-slate-100">Recebimentos ({receipts.length})</h3>
          </header>
          {receipts.length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-slate-500">
              {isRascunho ? 'GRD ainda não foi enviada.' : 'Sem registros de confirmação.'}
            </p>
          )}
          {receipts.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-border-dark">
              {receipts.map((r) => (
                <ReceiptRow key={r.id} receipt={r} transmittalId={grdId} onChange={() => qc.invalidateQueries({ queryKey: ['ged-receipts', grdId] })} />
              ))}
            </ul>
          )}
          {isEnviada && (
            <div className="border-t border-slate-100 px-5 py-3 dark:border-border-dark">
              <ConfirmReceiptButton transmittalId={grdId} onChange={() => qc.invalidateQueries({ queryKey: ['ged-receipts', grdId] })} />
            </div>
          )}
        </Card>
      </div>
    </Layout>
  );
}

function ReceiptRow({ receipt }: { receipt: GedReceipt; transmittalId: string; onChange: () => void }) {
  const isPending = receipt.status === 'pendente';
  return (
    <li className="px-5 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="dark:text-slate-100">{receipt.member?.nome || 'Destinatário'}</span>
        <Badge tone={isPending ? 'yellow' : receipt.status === 'recebida' ? 'green' : 'red'}>
          {receipt.status}
        </Badge>
      </div>
      {receipt.confirmed_at && (
        <div className="mt-0.5 text-xs text-slate-500">Confirmado em {dtTime(receipt.confirmed_at)}</div>
      )}
      {receipt.comment && (
        <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs italic text-slate-700 dark:bg-muted-dark dark:text-slate-300">
          "{receipt.comment}"
        </p>
      )}
    </li>
  );
}

function ConfirmReceiptButton({ transmittalId, onChange }: { transmittalId: string; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const confirm = useMutation({
    mutationFn: () => confirmGrdReceipt(transmittalId, comment.trim() || undefined),
    onSuccess: () => { setOpen(false); setComment(''); onChange(); },
  });

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="w-full">
        <CheckCircle2 className="h-4 w-4" />Confirmar recebimento
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Observação (opcional)…"
        rows={2}
        className="input text-sm"
      />
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
        <Button size="sm" onClick={() => confirm.mutate()} loading={confirm.isPending}>Confirmar</Button>
      </div>
    </div>
  );
}

async function getGrdSignedUrl(storagePath: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.storage.from('reports').createSignedUrl(storagePath, 300);
  return data?.signedUrl || null;
}
