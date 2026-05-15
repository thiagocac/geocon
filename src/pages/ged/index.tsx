import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  Plus, Search, FolderTree, Send, Download, Tag, BookOpen,
  Pencil, Trash2, ChevronRight, ChevronDown, Layers, Save,
  FileText, History, ShieldCheck, Eye, FileUp, ScanText, Printer,
} from 'lucide-react';
import { useState, useMemo, type FormEvent } from 'react';
import {
  callFn,
  listGedCategories, upsertGedCategory, deleteGedCategory,
  listMetadataFields, upsertMetadataField, deleteMetadataField,
  listGedControlledTerms, upsertGedControlledTerm, deleteGedControlledTerm,
  upsertGedControlledTermValue, deleteGedControlledTermValue,
  listGedMasterList, getGedDocument, listGedDocumentVersions,
  listGedAccessLog, getGedDocumentUrl, logGedAccess, updateGedDocumentStatus,
  extractTextFromVersion, printGedLabels,
  type GedCategory, type GedMetadataField, type GedControlledTerm, type GedControlledTermValue,
  type GedDocument as GedDocumentType, type GedDocumentVersion,
} from '../../lib/api';
import { GED_STATUS, statusFor } from '../../lib/status';
import { dt, dtTime, bytes } from '../../lib/format';
import { humanizeError } from '../../lib/errors';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Field, Select } from '../../components/ui/FormField';
import { Empty, Skeleton } from '../../components/ui/Stat';

const GED_STATUS_OPTIONS = [
  { value: 'em_elaboracao', label: 'Em elaboração' },
  { value: 'em_revisao',    label: 'Em revisão' },
  { value: 'aprovado',      label: 'Aprovado' },
  { value: 'distribuido',   label: 'Distribuído' },
  { value: 'obsoleto',      label: 'Obsoleto' },
  { value: 'cancelado',     label: 'Cancelado' },
];

// =============================================================================
// MAIN GED LIST — busca FTS + filtros
// =============================================================================
export function Ged() {
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [labelsBusy, setLabelsBusy] = useState(false);
  const [labelsErr, setLabelsErr] = useState<string | null>(null);

  // Debounce para não pingar backend a cada tecla
  useMemo(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: cats = [] } = useQuery({ queryKey: ['ged-cats'], queryFn: listGedCategories });
  const { data = [], isLoading } = useQuery({
    queryKey: ['ged-master', filterCategory, filterStatus, debouncedSearch],
    queryFn: () => listGedMasterList({
      categoryId: filterCategory || null,
      status: filterStatus || null,
      query: debouncedSearch || null,
    }),
  });

  function toggleOne(id: string) {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selectedIds.size === data.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.map((d) => d.id)));
    }
  }
  async function handlePrintLabels() {
    setLabelsErr(null);
    setLabelsBusy(true);
    try {
      await printGedLabels(Array.from(selectedIds));
      setSelectedIds(new Set());
    } catch (e) {
      setLabelsErr(humanizeError(e));
    } finally {
      setLabelsBusy(false);
    }
  }

  const allChecked = data.length > 0 && selectedIds.size === data.length;
  const someChecked = selectedIds.size > 0 && selectedIds.size < data.length;

  return (
    <Layout>
      <PageHeader
        title="GED / DataBook"
        subtitle="Documentos do contrato, versionamento, distribuição (GRD) e exportação"
        actions={
          <>
            <Link to="categorias"><Button variant="outline"><FolderTree className="h-4 w-4" />Taxonomia</Button></Link>
            <Link to="termos"><Button variant="outline"><BookOpen className="h-4 w-4" />Termos</Button></Link>
            <Link to="distribuicao"><Button variant="outline"><Send className="h-4 w-4" />GRDs</Button></Link>
            <Link to="documentos/novo"><Button><Plus className="h-4 w-4" />Novo documento</Button></Link>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título, descrição, palavras-chave, nomenclatura…"
              className="input pl-10"
            />
          </div>
          <Select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            placeholder="Todas as categorias"
            options={cats.map((c) => ({ value: c.id, label: `${c.codigo} — ${c.nome}` }))}
          />
          <Select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            placeholder="Todos os status"
            options={GED_STATUS_OPTIONS}
          />
          <Button variant="outline" onClick={() => callFn('generate-databook-export', {})}>
            <Download className="h-4 w-4" />Exportar
          </Button>
        </div>
        {debouncedSearch && (
          <p className="mt-2 text-xs text-slate-500">
            Busca full-text em português. Suporta múltiplos termos separados por espaço (combinados com AND).
          </p>
        )}
      </Card>

      {selectedIds.size > 0 && (
        <Card className="mb-4 flex items-center justify-between gap-3 border-navy/30 bg-navy/5 px-4 py-3 dark:border-purple/30 dark:bg-purple/10">
          <p className="text-sm font-medium dark:text-slate-100">
            {selectedIds.size} documento(s) selecionado(s) — até 48 por impressão
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Limpar</Button>
            <Button size="sm" onClick={handlePrintLabels}
                    loading={labelsBusy} disabled={selectedIds.size > 48}>
              <Printer className="h-3.5 w-3.5" />
              Imprimir etiquetas ({selectedIds.size})
            </Button>
          </div>
        </Card>
      )}
      {labelsErr && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
          {labelsErr}
        </div>
      )}

      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}
      {!isLoading && data.length === 0 && (
        <Empty
          title="Nenhum documento"
          body={debouncedSearch || filterCategory || filterStatus
            ? 'Nenhum resultado para os filtros aplicados.'
            : 'Cadastre o primeiro documento da GED.'}
        />
      )}

      {data.length > 0 && (
        <Card className="overflow-hidden">
          <table className="table">
            <thead><tr>
              <th className="w-10">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={toggleAll}
                  aria-label="Selecionar todos"
                />
              </th>
              <th>Código</th><th>Título</th><th>Categoria</th><th>Contrato</th>
              <th>Rev.</th><th>Versões</th><th>Tamanho</th><th>Status</th><th />
            </tr></thead>
            <tbody>
              {data.map((d) => {
                const st = statusFor(d.status || 'em_elaboracao', GED_STATUS);
                const isSel = selectedIds.has(d.id);
                return (
                  <tr key={d.id} className={isSel ? 'bg-navy/5 dark:bg-purple/10' : ''}>
                    <td>
                      <input type="checkbox" checked={isSel}
                             onChange={() => toggleOne(d.id)}
                             aria-label={`Selecionar ${d.title}`} />
                    </td>
                    <td className="font-mono text-xs">{d.nomenclature_code || d.numero || '—'}</td>
                    <td className="max-w-xs">
                      <div className="truncate font-medium">{d.title}</div>
                      {d.description && <div className="truncate text-xs text-slate-500">{d.description}</div>}
                    </td>
                    <td>
                      <span className="font-mono text-xs text-slate-500">{d.category_codigo}</span>{' '}
                      {d.category_nome}
                    </td>
                    <td className="font-mono text-xs">{d.contract_numero || '—'}</td>
                    <td>{d.revisao_atual || '0'}</td>
                    <td>{d.versions_count}</td>
                    <td>{d.file_size ? bytes(d.file_size) : '—'}</td>
                    <td><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className="text-right">
                      <Link to={`documentos/${d.id}`} className="text-navy underline-offset-2 hover:underline">Ver</Link>
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
// CATEGORIES — tree view + metadata fields editor
// =============================================================================

interface CategoryNode extends GedCategory {
  children: CategoryNode[];
  depth: number;
}

function buildTree(cats: GedCategory[]): CategoryNode[] {
  const map = new Map<string, CategoryNode>();
  for (const c of cats) map.set(c.id, { ...c, children: [], depth: 0 });
  const roots: CategoryNode[] = [];
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      const parent = map.get(node.parent_id)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (arr: CategoryNode[]) => {
    arr.sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo));
    for (const n of arr) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

export function GedCategories() {
  const qc = useQueryClient();
  const { data: cats = [], isLoading } = useQuery({ queryKey: ['ged-cats'], queryFn: listGedCategories });

  const tree = useMemo(() => buildTree(cats), [cats]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<GedCategory | 'new' | null>(null);

  const remove = useMutation({
    mutationFn: deleteGedCategory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ged-cats'] }),
  });

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function flatten(nodes: CategoryNode[]): CategoryNode[] {
    const out: CategoryNode[] = [];
    for (const n of nodes) {
      out.push(n);
      if (expanded.has(n.id) && n.children.length > 0) out.push(...flatten(n.children));
    }
    return out;
  }
  const visibleRows = flatten(tree);
  const selectedCat = cats.find((c) => c.id === selected) || null;

  return (
    <Layout>
      <PageHeader
        title="Taxonomia da GED"
        subtitle="Categorias hierárquicas, padrão de nomenclatura e campos de metadados obrigatórios por categoria"
        backTo="/ged" backLabel="GED"
        actions={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" />Nova categoria</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card className="overflow-hidden">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-border-dark">
            <h2 className="font-semibold text-sm dark:text-slate-100">Árvore de categorias</h2>
            <span className="text-xs text-slate-500">{cats.length} categoria(s)</span>
          </header>
          {isLoading && <div className="p-4"><Skeleton className="h-32" /></div>}
          {!isLoading && tree.length === 0 && (
            <div className="px-4 py-8 text-center">
              <FolderTree className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
              <p className="mt-2 text-sm text-slate-500">Nenhuma categoria configurada. Crie a primeira.</p>
            </div>
          )}
          {!isLoading && visibleRows.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-border-dark">
              {visibleRows.map((node) => {
                const isSel = selected === node.id;
                const hasChildren = node.children.length > 0;
                return (
                  <li
                    key={node.id}
                    className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-muted-dark ${isSel ? 'bg-navy/5 dark:bg-navy/10' : ''}`}
                    style={{ paddingLeft: `${12 + node.depth * 20}px` }}
                    onClick={() => setSelected(node.id)}
                  >
                    <button
                      type="button"
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleExpand(node.id); }}
                      aria-label="Expandir"
                      disabled={!hasChildren}
                    >
                      {hasChildren ? (expanded.has(node.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="inline-block h-4 w-4" />}
                    </button>
                    <FolderTree className="h-4 w-4 text-purple" />
                    <span className="font-mono text-xs text-slate-500">{node.codigo}</span>
                    <span className="flex-1 truncate dark:text-slate-100">{node.nome}</span>
                    {node.requires_physical_original && <Badge tone="yellow">Físico</Badge>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden">
          {!selectedCat ? (
            <div className="px-6 py-10 text-center">
              <Layers className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
              <p className="mt-2 text-sm text-slate-500">Selecione uma categoria à esquerda para ver detalhes e campos de metadados.</p>
            </div>
          ) : (
            <CategoryDetailPanel
              cat={selectedCat}
              cats={cats}
              onEdit={() => setEditing(selectedCat)}
              onDelete={() => {
                if (confirm(`Excluir categoria "${selectedCat.nome}"? Esta operação é soft-delete e pode ser revertida.`)) {
                  remove.mutate(selectedCat.id, { onSuccess: () => setSelected(null) });
                }
              }}
            />
          )}
        </Card>
      </div>

      {editing && (
        <CategoryEditModal
          category={editing === 'new' ? null : editing}
          parents={cats}
          onClose={() => setEditing(null)}
          onSaved={(id) => { setEditing(null); setSelected(id); qc.invalidateQueries({ queryKey: ['ged-cats'] }); }}
        />
      )}
    </Layout>
  );
}

function CategoryDetailPanel({ cat, cats, onEdit, onDelete }: { cat: GedCategory; cats: GedCategory[]; onEdit: () => void; onDelete: () => void }) {
  const qc = useQueryClient();
  const { data: fields = [], isLoading } = useQuery({
    queryKey: ['ged-fields', cat.id],
    queryFn: () => listMetadataFields(cat.id),
  });
  const [editingField, setEditingField] = useState<GedMetadataField | 'new' | null>(null);

  const removeField = useMutation({
    mutationFn: deleteMetadataField,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ged-fields', cat.id] }),
  });

  const parentName = cat.parent_id ? cats.find((c) => c.id === cat.parent_id)?.nome : null;

  return (
    <>
      <header className="border-b border-slate-100 px-5 py-4 dark:border-border-dark">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-mono">{cat.codigo}</span>
              {parentName && <><ChevronRight className="h-3 w-3" /><span>↑ {parentName}</span></>}
            </div>
            <h2 className="mt-1 text-lg font-semibold dark:text-slate-100">{cat.nome}</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {cat.requires_physical_original && <Badge tone="yellow">Original físico obrigatório</Badge>}
              {!cat.active && <Badge tone="red">Inativa</Badge>}
              <Badge tone="slate">Ordem {cat.ordem}</Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="h-3.5 w-3.5" />Editar</Button>
            <Button variant="danger" size="sm" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" />Excluir</Button>
          </div>
        </div>
        {cat.nomenclature_pattern && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-border-dark dark:bg-muted-dark">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Padrão de nomenclatura</div>
            <code className="text-xs font-mono text-navy dark:text-purple">{cat.nomenclature_pattern}</code>
          </div>
        )}
      </header>

      <section className="px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold dark:text-slate-100">Campos de metadados</h3>
            <p className="text-xs text-slate-500">Definem que informações o documento precisa ter ao ser cadastrado.</p>
          </div>
          <Button size="sm" onClick={() => setEditingField('new')}><Plus className="h-3.5 w-3.5" />Novo campo</Button>
        </div>

        {isLoading && <Skeleton className="h-20" />}
        {!isLoading && fields.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-border-dark">
            Nenhum campo configurado. Adicione campos como "Disciplina", "Número da folha", "Data de emissão".
          </p>
        )}
        {!isLoading && fields.length > 0 && (
          <ul className="divide-y divide-slate-100 dark:divide-border-dark">
            {fields.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2.5">
                <span className="flex-1">
                  <div className="flex items-center gap-2 text-sm dark:text-slate-100">
                    <span className="font-medium">{f.label}</span>
                    {f.required && <Badge tone="red">obrigatório</Badge>}
                  </div>
                  <div className="text-xs text-slate-500">
                    <span className="font-mono">{f.key}</span> · tipo <span className="font-medium">{f.field_type}</span>
                  </div>
                </span>
                <button
                  type="button"
                  onClick={() => setEditingField(f)}
                  className="text-slate-400 hover:text-navy"
                  aria-label="Editar campo"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => { if (confirm(`Remover campo "${f.label}"?`)) removeField.mutate(f.id); }}
                  className="text-slate-400 hover:text-error"
                  aria-label="Remover campo"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editingField && (
        <MetadataFieldEditModal
          field={editingField === 'new' ? null : editingField}
          categoryId={cat.id}
          nextOrdem={(fields[fields.length - 1]?.ordem || 0) + 1}
          onClose={() => setEditingField(null)}
          onSaved={() => { setEditingField(null); qc.invalidateQueries({ queryKey: ['ged-fields', cat.id] }); }}
        />
      )}
    </>
  );
}

function CategoryEditModal({ category, parents, onClose, onSaved }: {
  category: GedCategory | null;
  parents: GedCategory[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const isNew = !category;
  const [codigo, setCodigo] = useState(category?.codigo || '');
  const [nome, setNome] = useState(category?.nome || '');
  const [parentId, setParentId] = useState<string>(category?.parent_id || '');
  const [ordem, setOrdem] = useState<number>(category?.ordem ?? 1);
  const [nomenclaturePattern, setNomenclaturePattern] = useState(category?.nomenclature_pattern || '');
  const [requiresPhysical, setRequiresPhysical] = useState(category?.requires_physical_original ?? false);
  const [active, setActive] = useState(category?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => upsertGedCategory({
      id: category?.id,
      parent_id: parentId || null,
      codigo: codigo.trim().toUpperCase(),
      nome: nome.trim(),
      ordem: Number(ordem) || 0,
      nomenclature_pattern: nomenclaturePattern.trim() || null,
      requires_physical_original: requiresPhysical,
      active,
    }),
    onSuccess: (id) => onSaved(id),
    onError: (e) => setError(humanizeError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!codigo.trim() || !nome.trim()) {
      setError('Código e nome são obrigatórios');
      return;
    }
    save.mutate();
  }

  const parentOptions = parents
    .filter((p) => p.id !== category?.id)
    .map((p) => ({ value: p.id, label: `${p.codigo} — ${p.nome}` }));

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Nova categoria' : `Editar categoria ${category!.codigo}`}
      subtitle="Categorias organizam documentos por tipo. Use subcategorias para hierarquias."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={save.isPending}><Save className="h-4 w-4" />Salvar</Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_3fr]">
          <Field label="Código" required hint="3-5 letras maiúsculas">
            <input type="text" value={codigo} onChange={(e) => setCodigo(e.target.value)} className="input font-mono uppercase" maxLength={8} />
          </Field>
          <Field label="Nome" required>
            <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} className="input" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoria-mãe" hint="Deixe vazio para criar uma categoria raiz">
            <Select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              placeholder="— Raiz —"
              options={parentOptions}
            />
          </Field>
          <Field label="Ordem" hint="Posição na listagem (menor primeiro)">
            <input type="number" value={ordem} onChange={(e) => setOrdem(Number(e.target.value))} className="input" min={0} />
          </Field>
        </div>

        <Field
          label="Padrão de nomenclatura"
          hint="Tokens disponíveis: {contrato} {numero} {disciplina} {revisao} {tipo} {data}. Ex: {contrato}-PRJ-{disciplina}-{numero}-R{revisao}"
        >
          <input
            type="text"
            value={nomenclaturePattern}
            onChange={(e) => setNomenclaturePattern(e.target.value)}
            className="input font-mono text-sm"
            placeholder="{contrato}-{codigo}-{numero}"
          />
        </Field>

        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm dark:text-slate-100">
            <input type="checkbox" checked={requiresPhysical} onChange={(e) => setRequiresPhysical(e.target.checked)} />
            Exige original físico arquivado
          </label>
          <label className="flex items-center gap-2 text-sm dark:text-slate-100">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Ativa
          </label>
        </div>

        {error && <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">{error}</p>}
      </form>
    </Modal>
  );
}

function MetadataFieldEditModal({ field, categoryId, nextOrdem, onClose, onSaved }: {
  field: GedMetadataField | null;
  categoryId: string;
  nextOrdem: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !field;
  const [key, setKey] = useState(field?.key || '');
  const [label, setLabel] = useState(field?.label || '');
  const [fieldType, setFieldType] = useState<GedMetadataField['field_type']>(field?.field_type || 'text');
  const [required, setRequired] = useState(field?.required ?? false);
  const [ordem, setOrdem] = useState<number>(field?.ordem ?? nextOrdem);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => upsertMetadataField({
      id: field?.id,
      category_id: categoryId,
      key: key.trim().toLowerCase().replace(/\s+/g, '_'),
      label: label.trim(),
      field_type: fieldType,
      required,
      ordem: Number(ordem) || 0,
    }),
    onSuccess: onSaved,
    onError: (e) => setError(humanizeError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!key.trim() || !label.trim()) {
      setError('Chave e rótulo são obrigatórios');
      return;
    }
    save.mutate();
  }

  const TYPE_OPTIONS = [
    { value: 'text',            label: 'Texto livre' },
    { value: 'number',          label: 'Número' },
    { value: 'date',            label: 'Data' },
    { value: 'boolean',         label: 'Sim/Não' },
    { value: 'controlled_term', label: 'Termo controlado (vocabulário)' },
    { value: 'member',          label: 'Pessoa (membro do tenant)' },
    { value: 'contract',        label: 'Contrato' },
    { value: 'lot',             label: 'Obra/lote' },
    { value: 'discipline',      label: 'Disciplina' },
    { value: 'item',            label: 'Item contratual' },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Novo campo de metadado' : `Editar campo ${field!.label}`}
      subtitle="Define um atributo que esta categoria de documento precisa preencher."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={save.isPending}><Save className="h-4 w-4" />Salvar</Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Rótulo (visível ao usuário)" required>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className="input" placeholder="Ex: Número da folha" />
        </Field>

        <Field label="Chave técnica" required hint="snake_case, único na categoria. Ex: numero_folha">
          <input type="text" value={key} onChange={(e) => setKey(e.target.value)} className="input font-mono" placeholder="numero_folha" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo do campo">
            <Select value={fieldType} onChange={(e) => setFieldType(e.target.value as GedMetadataField['field_type'])} options={TYPE_OPTIONS} />
          </Field>
          <Field label="Ordem">
            <input type="number" value={ordem} onChange={(e) => setOrdem(Number(e.target.value))} className="input" min={0} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm dark:text-slate-100">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Preenchimento obrigatório
        </label>

        {error && <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">{error}</p>}
      </form>
    </Modal>
  );
}

// =============================================================================
// CONTROLLED TERMS — vocabulários reutilizáveis
// =============================================================================

export function GedTerms() {
  const qc = useQueryClient();
  const { data: terms = [], isLoading } = useQuery({ queryKey: ['ged-terms'], queryFn: listGedControlledTerms });
  const [editing, setEditing] = useState<GedControlledTerm | 'new' | null>(null);
  const [editingValue, setEditingValue] = useState<{ termId: string; value: GedControlledTermValue | null } | null>(null);

  const removeTerm = useMutation({
    mutationFn: deleteGedControlledTerm,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ged-terms'] }),
  });
  const removeValue = useMutation({
    mutationFn: deleteGedControlledTermValue,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ged-terms'] }),
  });

  return (
    <Layout>
      <PageHeader
        title="Termos controlados"
        subtitle="Vocabulários reutilizáveis para campos de metadados — ex: lista fechada de disciplinas, fases, status"
        backTo="/ged" backLabel="GED"
        actions={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" />Novo termo</Button>}
      />

      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}
      {!isLoading && terms.length === 0 && (
        <Empty title="Nenhum termo cadastrado" body="Crie listas fechadas de valores para usar em campos do tipo 'termo controlado'." />
      )}

      {!isLoading && terms.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {terms.map((t) => (
            <Card key={t.id} className="overflow-hidden">
              <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-border-dark">
                <div>
                  <div className="text-xs font-mono text-slate-500">{t.key}</div>
                  <h3 className="font-semibold dark:text-slate-100">{t.nome}</h3>
                  <p className="text-xs text-slate-500">{t.values?.length || 0} valor(es)</p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy dark:hover:bg-muted-dark"
                    aria-label="Editar termo"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (confirm(`Excluir termo "${t.nome}"?`)) removeTerm.mutate(t.id); }}
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-error dark:hover:bg-muted-dark"
                    aria-label="Excluir termo"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </header>

              <ul className="divide-y divide-slate-100 dark:divide-border-dark">
                {(t.values || []).map((v) => (
                  <li key={v.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                    <span className="font-mono text-xs text-slate-500 w-12">{v.value}</span>
                    <span className="flex-1 dark:text-slate-100">{v.label}</span>
                    {!v.active && <Badge tone="slate">inativo</Badge>}
                    <button
                      type="button"
                      onClick={() => setEditingValue({ termId: t.id, value: v })}
                      className="text-slate-400 hover:text-navy"
                      aria-label="Editar valor"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { if (confirm(`Remover valor "${v.label}"?`)) removeValue.mutate(v.id); }}
                      className="text-slate-400 hover:text-error"
                      aria-label="Remover valor"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
                {(!t.values || t.values.length === 0) && (
                  <li className="px-4 py-3 text-center text-xs text-slate-500">Sem valores. Adicione o primeiro.</li>
                )}
              </ul>

              <footer className="border-t border-slate-100 px-4 py-2 dark:border-border-dark">
                <Button variant="ghost" size="sm" onClick={() => setEditingValue({ termId: t.id, value: null })}>
                  <Plus className="h-3.5 w-3.5" />Adicionar valor
                </Button>
              </footer>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <ControlledTermEditModal
          term={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['ged-terms'] }); }}
        />
      )}

      {editingValue && (
        <ControlledTermValueEditModal
          termId={editingValue.termId}
          value={editingValue.value}
          nextOrdem={(terms.find((t) => t.id === editingValue.termId)?.values?.length || 0) + 1}
          onClose={() => setEditingValue(null)}
          onSaved={() => { setEditingValue(null); qc.invalidateQueries({ queryKey: ['ged-terms'] }); }}
        />
      )}
    </Layout>
  );
}

function ControlledTermEditModal({ term, onClose, onSaved }: { term: GedControlledTerm | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !term;
  const [key, setKey] = useState(term?.key || '');
  const [nome, setNome] = useState(term?.nome || '');
  const [active, setActive] = useState(term?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => upsertGedControlledTerm({
      id: term?.id,
      key: key.trim().toLowerCase().replace(/\s+/g, '_'),
      nome: nome.trim(),
      active,
    }),
    onSuccess: () => onSaved(),
    onError: (e) => setError(humanizeError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!key.trim() || !nome.trim()) {
      setError('Chave e nome são obrigatórios');
      return;
    }
    save.mutate();
  }

  return (
    <Modal
      open onClose={onClose}
      title={isNew ? 'Novo termo controlado' : `Editar ${term!.nome}`}
      subtitle="Um termo é uma lista fechada de valores (ex: disciplinas) que pode ser reutilizada em vários campos."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={save.isPending}><Save className="h-4 w-4" />Salvar</Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Chave técnica" required hint="snake_case, único no tenant. Ex: discipline, drawing_status">
          <input type="text" value={key} onChange={(e) => setKey(e.target.value)} className="input font-mono" placeholder="discipline" />
        </Field>
        <Field label="Nome visível" required>
          <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} className="input" placeholder="Disciplina" />
        </Field>
        <label className="flex items-center gap-2 text-sm dark:text-slate-100">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Ativo
        </label>
        {error && <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">{error}</p>}
      </form>
    </Modal>
  );
}

function ControlledTermValueEditModal({ termId, value, nextOrdem, onClose, onSaved }: {
  termId: string;
  value: GedControlledTermValue | null;
  nextOrdem: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !value;
  const [valueStr, setValueStr] = useState(value?.value || '');
  const [label, setLabel] = useState(value?.label || '');
  const [ordem, setOrdem] = useState<number>(value?.ordem ?? nextOrdem);
  const [active, setActive] = useState(value?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => upsertGedControlledTermValue({
      id: value?.id,
      term_id: termId,
      value: valueStr.trim().toUpperCase(),
      label: label.trim(),
      ordem: Number(ordem) || 0,
      active,
    }),
    onSuccess: () => onSaved(),
    onError: (e) => setError(humanizeError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!valueStr.trim() || !label.trim()) {
      setError('Valor e rótulo são obrigatórios');
      return;
    }
    save.mutate();
  }

  return (
    <Modal
      open onClose={onClose}
      title={isNew ? 'Novo valor' : `Editar ${value!.label}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={save.isPending}><Save className="h-4 w-4" />Salvar</Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_3fr]">
          <Field label="Valor" required hint="código curto">
            <input type="text" value={valueStr} onChange={(e) => setValueStr(e.target.value)} className="input font-mono uppercase" maxLength={20} />
          </Field>
          <Field label="Rótulo" required>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className="input" placeholder="Arquitetura" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ordem">
            <input type="number" value={ordem} onChange={(e) => setOrdem(Number(e.target.value))} className="input" min={0} />
          </Field>
          <label className="mt-7 flex items-center gap-2 text-sm dark:text-slate-100">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Ativo
          </label>
        </div>
        {error && <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">{error}</p>}
      </form>
    </Modal>
  );
}

// =============================================================================
// DOCUMENT DETAIL — versões, metadata, trilha de acesso
// =============================================================================
export function GedDocument() {
  const { docId = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data: doc, isLoading } = useQuery({
    queryKey: ['ged-doc', docId],
    queryFn: () => getGedDocument(docId),
    enabled: !!docId,
  });
  const { data: versions = [] } = useQuery({
    queryKey: ['ged-versions', docId],
    queryFn: () => listGedDocumentVersions(docId),
    enabled: !!docId,
  });
  const { data: accessLog = [] } = useQuery({
    queryKey: ['ged-access', docId],
    queryFn: () => listGedAccessLog(docId),
    enabled: !!docId,
  });
  const { data: fields = [] } = useQuery({
    queryKey: ['ged-fields', doc?.category_id],
    queryFn: () => listMetadataFields(doc!.category_id),
    enabled: !!doc?.category_id,
  });

  const changeStatus = useMutation({
    mutationFn: (status: GedDocumentType['status']) => updateGedDocumentStatus(docId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ged-doc', docId] }),
  });

  async function downloadVersion(version: GedDocumentVersion) {
    const url = await getGedDocumentUrl(version.storage_path);
    if (!url) { alert('Não foi possível gerar URL de download'); return; }
    await logGedAccess(docId, 'download');
    qc.invalidateQueries({ queryKey: ['ged-access', docId] });
    window.open(url, '_blank');
  }

  if (isLoading) return <Layout><Card className="p-6"><Skeleton className="h-64" /></Card></Layout>;
  if (!doc) return <Layout><Empty title="Documento não encontrado" body="O documento solicitado não existe ou foi removido." /></Layout>;

  const st = statusFor(doc.status, GED_STATUS);

  return (
    <Layout>
      <PageHeader
        title={doc.title}
        subtitle={`${doc.ged_categories?.codigo} · ${doc.ged_categories?.nome} · Revisão atual ${doc.revisao_atual || '0'}`}
        backTo="/ged" backLabel="GED"
        actions={
          <>
            <Link to="nova-revisao"><Button variant="outline"><FileUp className="h-4 w-4" />Nova revisão</Button></Link>
            {doc.status === 'em_elaboracao' && (
              <Button onClick={() => changeStatus.mutate('em_revisao')} loading={changeStatus.isPending}>
                Enviar para revisão
              </Button>
            )}
            {doc.status === 'em_revisao' && (
              <Button onClick={() => changeStatus.mutate('aprovado')} loading={changeStatus.isPending}>
                <ShieldCheck className="h-4 w-4" />Aprovar
              </Button>
            )}
            {doc.status === 'aprovado' && (
              <Button variant="outline" onClick={() => changeStatus.mutate('obsoleto')} loading={changeStatus.isPending}>
                Marcar obsoleto
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          {/* Cabeçalho com metadados */}
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-mono text-slate-500">
                  {doc.nomenclature_code || doc.numero || 'sem nomenclatura'}
                </div>
                <h2 className="mt-1 text-lg font-semibold dark:text-slate-100">{doc.title}</h2>
                {doc.description && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{doc.description}</p>}
              </div>
              <Badge tone={st.tone}>{st.label}</Badge>
            </div>

            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              {doc.contracts && (
                <div>
                  <dt className="text-xs text-slate-500">Contrato</dt>
                  <dd className="dark:text-slate-100">
                    <Link to={`/contratos/${doc.contracts.id}`} className="font-mono text-navy hover:underline">
                      {doc.contracts.numero}
                    </Link>
                    {doc.contracts.titulo && <span className="ml-1 text-slate-500">— {doc.contracts.titulo}</span>}
                  </dd>
                </div>
              )}
              {doc.responsavel && (
                <div>
                  <dt className="text-xs text-slate-500">Responsável</dt>
                  <dd className="dark:text-slate-100">{doc.responsavel.nome}</dd>
                </div>
              )}
              {doc.data_documento && (
                <div>
                  <dt className="text-xs text-slate-500">Data do documento</dt>
                  <dd className="dark:text-slate-100">{dt(doc.data_documento)}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-slate-500">Cadastrado em</dt>
                <dd className="dark:text-slate-100">{dtTime(doc.created_at)}</dd>
              </div>
              {doc.ged_categories?.requires_physical_original && (
                <div className="sm:col-span-2">
                  <Badge tone="yellow">Exige original físico arquivado</Badge>
                </div>
              )}
            </dl>

            {doc.keywords && doc.keywords.length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-slate-500">Palavras-chave</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {doc.keywords.map((k) => (
                    <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-muted-dark dark:text-slate-200">
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Metadados dinâmicos */}
            {fields.length > 0 && Object.keys(doc.metadata || {}).length > 0 && (
              <div className="mt-5 border-t border-slate-100 pt-4 dark:border-border-dark">
                <h3 className="mb-2 text-sm font-semibold dark:text-slate-100">Metadados</h3>
                <dl className="grid gap-2 sm:grid-cols-2">
                  {fields.map((f) => {
                    const v = doc.metadata?.[f.key];
                    if (v === undefined || v === null || v === '') return null;
                    return (
                      <div key={f.id}>
                        <dt className="text-xs text-slate-500">{f.label}</dt>
                        <dd className="text-sm dark:text-slate-100">{String(v)}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            )}
          </Card>

          {/* Versões */}
          <Card className="overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-border-dark">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-slate-500" />
                <h3 className="font-semibold dark:text-slate-100">Versões ({versions.length})</h3>
              </div>
            </header>
            {versions.length === 0 && (
              <p className="px-5 py-6 text-center text-sm text-slate-500">Sem versões.</p>
            )}
            {versions.length > 0 && (
              <ul className="divide-y divide-slate-100 dark:divide-border-dark">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-100 dark:bg-muted-dark">
                      <FileText className="h-5 w-5 text-slate-500" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium dark:text-slate-100">Rev. {v.revision}</span>
                        <Badge tone={v.status === 'vigente' ? 'green' : 'slate'}>{v.status}</Badge>
                      </div>
                      <div className="text-xs text-slate-500">
                        {dtTime(v.uploaded_at)} por {v.uploader?.nome || '—'} ·
                        {' '}{v.file_size ? bytes(v.file_size) : '—'} · {v.mime_type || 'tipo desconhecido'}
                      </div>
                      {v.hash_sha256 && (
                        <div className="mt-0.5 truncate font-mono text-[10px] text-slate-400" title={v.hash_sha256}>
                          SHA-256: {v.hash_sha256.slice(0, 32)}…
                        </div>
                      )}
                      {v.extracted_text && (
                        <div className="mt-1 text-[10px] text-green-700 dark:text-green-400">
                          ✓ Texto extraído ({v.extracted_text.length} caracteres) — indexado na busca
                        </div>
                      )}
                    </div>
                    {v.mime_type === 'application/pdf' && !v.extracted_text && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          try {
                            await extractTextFromVersion(v.id, v.storage_path);
                            qc.invalidateQueries({ queryKey: ['ged-versions', docId] });
                          } catch (e) {
                            alert('Falha ao extrair texto: ' + humanizeError(e));
                          }
                        }}
                        title="Extrair texto do PDF para a busca"
                      >
                        <ScanText className="h-3.5 w-3.5" />Indexar
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => downloadVersion(v)}>
                      <Download className="h-3.5 w-3.5" />Baixar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Sidebar: trilha de acesso */}
        <Card className="overflow-hidden">
          <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 dark:border-border-dark">
            <Eye className="h-4 w-4 text-slate-500" />
            <h3 className="font-semibold text-sm dark:text-slate-100">Trilha de acesso</h3>
          </header>
          {accessLog.length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-slate-500">Sem acessos registrados.</p>
          )}
          {accessLog.length > 0 && (
            <ul className="max-h-[600px] divide-y divide-slate-100 overflow-y-auto dark:divide-border-dark">
              {accessLog.map((entry) => {
                const tone = entry.action === 'download' ? 'purple' : entry.action === 'print' ? 'magenta' : 'slate';
                return (
                  <li key={entry.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="dark:text-slate-100">{entry.member?.nome || '—'}</span>
                      <Badge tone={tone}>{entry.action}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{dtTime(entry.occurred_at)}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </Layout>
  );
}

// =============================================================================
// DISTRIBUTION — implementação completa em ./Distribution.tsx
// =============================================================================
export { GedDistribution, GedDistributionWizard, GedDistributionDetail } from './Distribution';
