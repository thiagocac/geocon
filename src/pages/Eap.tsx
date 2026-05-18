import { useState, useMemo, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, Save, ChevronRight, ChevronDown, Layers, AlertCircle,
} from 'lucide-react';
import {
  listWbs, upsertWbsItem, deleteWbsItem, listDisciplines, listLots, getContract,
  type WbsItem, type Discipline, type Lot,
} from '../lib/api';
import { humanizeError } from '../lib/errors';
import { dt, num } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Field, Select } from '../components/ui/FormField';
import { Empty, Skeleton } from '../components/ui/Stat';

interface WbsNode extends WbsItem {
  children: WbsNode[];
  depth: number;
}

function buildTree(items: WbsItem[]): WbsNode[] {
  const map = new Map<string, WbsNode>();
  for (const it of items) map.set(it.id, { ...it, children: [], depth: 0 });
  const roots: WbsNode[] = [];
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      const parent = map.get(node.parent_id)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (arr: WbsNode[]) => {
    arr.sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo));
    for (const n of arr) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

export function Eap() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<WbsItem | 'new' | null>(null);
  const [editingParent, setEditingParent] = useState<string | null>(null);

  const { data: contract } = useQuery({ queryKey: ['contract', id], queryFn: () => getContract(id), enabled: !!id });
  const { data: wbs = [], isLoading } = useQuery({ queryKey: ['wbs', id], queryFn: () => listWbs(id), enabled: !!id });
  const { data: disciplines = [] } = useQuery({ queryKey: ['disciplines'], queryFn: listDisciplines });
  const { data: lots = [] } = useQuery({ queryKey: ['lots', id], queryFn: () => listLots(id), enabled: !!id });

  const tree = useMemo(() => buildTree(wbs), [wbs]);

  const remove = useMutation({
    mutationFn: deleteWbsItem,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wbs', id] }),
  });

  function toggleExpand(itemId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  function flatten(nodes: WbsNode[]): WbsNode[] {
    const out: WbsNode[] = [];
    for (const n of nodes) {
      out.push(n);
      if (expanded.has(n.id) && n.children.length > 0) out.push(...flatten(n.children));
    }
    return out;
  }
  const visibleRows = flatten(tree);

  // Soma dos pesos por nível 1 (deve dar 100%)
  const pesoTotal = useMemo(() => tree.reduce((s, n) => s + Number(n.peso || 0), 0), [tree]);
  const pesoOK = pesoTotal >= 99.5 && pesoTotal <= 100.5;

  return (
    <Layout>
      <PageHeader
        title="EAP — Estrutura Analítica do Projeto"
        subtitle={`Decomposição hierárquica do contrato${contract?.numero ? ` ${contract.numero}` : ''}`}
        backTo={`/contratos/${id}`} backLabel="Contrato"
        actions={<Button onClick={() => { setEditingParent(null); setEditing('new'); }}><Plus className="h-4 w-4" />Novo item raiz</Button>}
      />

      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}

      {!isLoading && wbs.length === 0 && (
        <Empty
          title="EAP não definida"
          body="Defina a estrutura analítica para acompanhar o avanço físico por marcos hierárquicos."
        />
      )}

      {wbs.length > 0 && (
        <>
          {/* KPI de peso total */}
          {tree.length > 0 && (
            <div className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
              pesoOK
                ? 'border-green-200 bg-green-50 text-green-900 dark:border-green-900/40 dark:bg-green-900/10 dark:text-green-200'
                : 'border-yellow-400/30 bg-yellow-50 text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-900/10 dark:text-yellow-200'
            }`}>
              <AlertCircle className="h-4 w-4 shrink-0" />
              <div className="flex-1">
                <strong>Peso total nível 1:</strong> {num(pesoTotal)}%
                {!pesoOK && <span className="ml-2">— recomenda-se que a soma dos pesos de nível 1 seja 100%.</span>}
                {pesoOK && <span className="ml-2">— distribuição equilibrada.</span>}
              </div>
            </div>
          )}

          <Card className="overflow-hidden">
            <div className="overflow-x-auto scrollbar-thin">
            <table className="table">
              <thead><tr>
                <th></th>
                <th>Código</th>
                <th>Nome</th>
                <th>Disciplina</th>
                <th>Critério</th>
                <th className="text-right">Peso</th>
                <th>Período previsto</th>
                <th>Marco</th>
                <th />
              </tr></thead>
              <tbody>
                {visibleRows.map((node) => {
                  const hasChildren = node.children.length > 0;
                  return (
                    <tr key={node.id}>
                      <td style={{ paddingLeft: `${12 + node.depth * 20}px` }} className="!pl-3">
                        <button
                          type="button"
                          className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                          onClick={() => hasChildren && toggleExpand(node.id)}
                          disabled={!hasChildren}
                          aria-label="Expandir"
                        >
                          {hasChildren ? (expanded.has(node.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="inline-block h-4 w-4" />}
                        </button>
                      </td>
                      <td className="font-mono text-xs">{node.codigo}</td>
                      <td>
                        <div className="font-medium dark:text-slate-100">{node.nome}</div>
                        {node.tem_acompanhamento_fisico && <div className="text-[10px] uppercase tracking-wider text-purple">acompanhamento físico</div>}
                      </td>
                      <td className="text-xs">{node.disciplines?.nome || '—'}</td>
                      <td className="text-xs">{node.criterio_medicao || '—'}</td>
                      <td className="text-right font-mono tabular text-xs">{node.peso ? `${num(node.peso)}%` : '—'}</td>
                      <td className="text-xs text-slate-500">
                        {node.data_inicio_prevista ? dt(node.data_inicio_prevista) : '—'}
                        {' → '}
                        {node.data_fim_prevista ? dt(node.data_fim_prevista) : '—'}
                      </td>
                      <td>{node.vinculado_marco && <Badge tone="purple">marco</Badge>}</td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => { setEditingParent(node.id); setEditing('new'); }}
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy dark:hover:bg-muted-dark"
                            title="Adicionar subitem"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => setEditing(node)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy dark:hover:bg-muted-dark">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => { if (confirm(`Excluir "${node.nome}" e seus filhos?`)) remove.mutate(node.id); }} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-error dark:hover:bg-muted-dark">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </Card>
        </>
      )}

      {editing && (
        <WbsEditModal
          contractId={id}
          item={editing === 'new' ? null : editing}
          parentId={editing === 'new' ? editingParent : (editing as WbsItem).parent_id}
          parents={wbs}
          disciplines={disciplines}
          lots={lots}
          onClose={() => { setEditing(null); setEditingParent(null); }}
          onSaved={() => { setEditing(null); setEditingParent(null); qc.invalidateQueries({ queryKey: ['wbs', id] }); }}
        />
      )}
    </Layout>
  );
}

const CRITERIO_OPTIONS = [
  { value: 'volume', label: 'Volume executado' },
  { value: 'area',   label: 'Área executada' },
  { value: 'unidades', label: 'Unidades concluídas' },
  { value: 'percentual_etapa', label: 'Percentual de etapa concluída' },
  { value: 'marco_binario', label: 'Marco binário (sim/não)' },
  { value: 'preliminares', label: 'Serviços preliminares' },
  { value: 'manual', label: 'Apuração manual' },
];

function WbsEditModal({ contractId, item, parentId, parents, disciplines, lots, onClose, onSaved }: {
  contractId: string;
  item: WbsItem | null;
  parentId: string | null;
  parents: WbsItem[];
  disciplines: Discipline[];
  lots: Lot[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !item;
  const [codigo, setCodigo] = useState(item?.codigo || '');
  const [nome, setNome] = useState(item?.nome || '');
  const [parent, setParent] = useState(parentId || item?.parent_id || '');
  const [lotId, setLotId] = useState(item?.lot_id || '');
  const [disciplineId, setDisciplineId] = useState(item?.discipline_id || '');
  const [criterio, setCriterio] = useState(item?.criterio_medicao || '');
  const [peso, setPeso] = useState<number>(item?.peso ?? 0);
  const [ordem, setOrdem] = useState<number>(item?.ordem ?? 1);
  const [temFisico, setTemFisico] = useState(item?.tem_acompanhamento_fisico ?? true);
  const [marco, setMarco] = useState(item?.vinculado_marco ?? false);
  const [dataInicio, setDataInicio] = useState(item?.data_inicio_prevista?.slice(0, 10) || '');
  const [dataFim, setDataFim] = useState(item?.data_fim_prevista?.slice(0, 10) || '');
  const [active, setActive] = useState(item?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const parentNode = parents.find((p) => p.id === parent);
  const nivel = parentNode ? (parentNode.nivel + 1) : 1;

  const save = useMutation({
    mutationFn: () => upsertWbsItem({
      id: item?.id,
      contract_id: contractId,
      lot_id: lotId || null,
      discipline_id: disciplineId || null,
      parent_id: parent || null,
      codigo: codigo.trim(),
      nome: nome.trim(),
      nivel,
      ordem: Number(ordem) || 0,
      criterio_medicao: criterio || null,
      tem_acompanhamento_fisico: temFisico,
      vinculado_marco: marco,
      peso: peso || null,
      data_inicio_prevista: dataInicio || null,
      data_fim_prevista: dataFim || null,
      active,
    }),
    onSuccess: () => onSaved(),
    onError: (e) => setError(humanizeError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!codigo.trim() || !nome.trim()) { setError('Código e nome são obrigatórios'); return; }
    save.mutate();
  }

  const parentOptions = parents
    .filter((p) => p.id !== item?.id)
    .map((p) => ({ value: p.id, label: `${p.codigo} — ${p.nome}` }));

  return (
    <Modal
      open onClose={onClose}
      title={isNew ? `Novo item${parentNode ? ` (sub de ${parentNode.codigo})` : ' raiz'}` : `Editar ${item!.codigo}`}
      subtitle={`Nível ${nivel} da EAP`}
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
          <Field label="Código" required hint="Hierárquico, ex: 1.2.3">
            <input type="text" value={codigo} onChange={(e) => setCodigo(e.target.value)} className="input font-mono" maxLength={20} />
          </Field>
          <Field label="Nome" required>
            <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} className="input" placeholder="Ex: Fundações em estacas" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Item-pai" hint="Deixe vazio para criar item raiz">
            <Select value={parent} onChange={(e) => setParent(e.target.value)} placeholder="— Raiz (nível 1) —" options={parentOptions} />
          </Field>
          <Field label="Lote/obra" hint="Vincule a um lote específico se aplicável">
            <Select value={lotId} onChange={(e) => setLotId(e.target.value)} placeholder="— Todos os lotes —" options={lots.map((l) => ({ value: l.id, label: `${l.codigo || l.nome || ''} ${l.municipio ? '— ' + l.municipio : ''}`.trim() || 'Lote' }))} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Disciplina">
            <Select value={disciplineId} onChange={(e) => setDisciplineId(e.target.value)} placeholder="— Sem disciplina —" options={disciplines.map((d) => ({ value: d.id, label: `${d.codigo} — ${d.nome}` }))} />
          </Field>
          <Field label="Critério de medição">
            <Select value={criterio} onChange={(e) => setCriterio(e.target.value)} placeholder="— Selecionar —" options={CRITERIO_OPTIONS} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Peso (%)" hint="Para somar 100% no nível 1">
            <input type="number" step="0.01" min="0" max="100" value={peso} onChange={(e) => setPeso(Number(e.target.value))} className="input tabular" />
          </Field>
          <Field label="Ordem">
            <input type="number" value={ordem} onChange={(e) => setOrdem(Number(e.target.value))} className="input" />
          </Field>
          <Field label="Nível">
            <input type="text" value={nivel} disabled className="input bg-slate-50 dark:bg-muted-dark" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Início previsto">
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="input" />
          </Field>
          <Field label="Fim previsto">
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="input" />
          </Field>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm dark:text-slate-100">
            <input type="checkbox" checked={temFisico} onChange={(e) => setTemFisico(e.target.checked)} />
            Tem acompanhamento físico
          </label>
          <label className="flex items-center gap-2 text-sm dark:text-slate-100">
            <input type="checkbox" checked={marco} onChange={(e) => setMarco(e.target.checked)} />
            Vinculado a marco contratual
          </label>
          <label className="flex items-center gap-2 text-sm dark:text-slate-100">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Ativo
          </label>
        </div>

        {error && <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">{error}</p>}
      </form>
    </Modal>
  );
}
