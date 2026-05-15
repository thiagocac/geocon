import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, AlertCircle, CheckCircle2, ArrowRight, Calendar, Trash2,
  ShieldAlert, FileWarning, Sparkles, X,
} from 'lucide-react';
import {
  listUnforeseenItems, listUnforeseenOrigins, getUnforeseenItem,
  listUnforeseenComponents, createUnforeseenItem,
  advanceUnforeseenItem, upsertUnforeseenComponent, deleteUnforeseenComponent,
  UNFORESEEN_STATUS_FLOW, type UnforeseenStatus, type UnforeseenComponent,
} from '../lib/api';
import { humanizeError } from '../lib/errors';
import { brl, num, dt } from '../lib/format';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Field, Select } from '../components/ui/FormField';
import type { BadgeTone } from '../lib/status';
import { Empty, Skeleton } from '../components/ui/Stat';

const STATUS_LABEL: Record<UnforeseenStatus, string> = {
  levantamento:         '1. Levantamento',
  analise_tecnica:      '2. Análise técnica',
  analise_preco:        '3. Análise de preço',
  aprovacao_consorcio:  '4a. Aprovação consórcio',
  aprovacao_orgao:      '4b. Aprovação órgão',
  aprovado:             '5. Aprovado',
  aditado:              'Incorporado',
  recusado:             'Recusado',
  cancelado:            'Cancelado',
};

const STATUS_TONE: Record<UnforeseenStatus, BadgeTone> = {
  levantamento: 'slate', analise_tecnica: 'blue', analise_preco: 'purple',
  aprovacao_consorcio: 'yellow', aprovacao_orgao: 'yellow',
  aprovado: 'green', aditado: 'magenta', recusado: 'red', cancelado: 'slate',
};

const NEXT_STATUS: Record<UnforeseenStatus, UnforeseenStatus[]> = {
  levantamento: ['analise_tecnica', 'cancelado'],
  analise_tecnica: ['analise_preco', 'recusado', 'cancelado'],
  analise_preco: ['aprovacao_consorcio', 'aprovacao_orgao', 'recusado'],
  aprovacao_consorcio: ['aprovacao_orgao', 'recusado'],
  aprovacao_orgao: ['aprovado', 'recusado'],
  aprovado: [], aditado: [], recusado: [], cancelado: [],
};

// =============================================================================
// LISTA
// =============================================================================
export function UnforeseenList() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['unforeseen', id], queryFn: () => listUnforeseenItems(id), enabled: !!id,
  });
  const { data: origins = [] } = useQuery({
    queryKey: ['unforeseen-origins'], queryFn: listUnforeseenOrigins,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    descricao: '', justificativa: '', origin_id: '', valor_estimado: 0, prazo_impacto_dias: 0,
  });
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createUnforeseenItem({
      contract_id: id,
      origin_id: form.origin_id || null,
      descricao: form.descricao, justificativa: form.justificativa,
      valor_estimado: form.valor_estimado, prazo_impacto_dias: form.prazo_impacto_dias,
    }),
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['unforeseen', id] });
      setModalOpen(false);
      navigate(`/contratos/${id}/itens-nao-previstos/${newId}`);
    },
    onError: (e: Error) => setErr(humanizeError(e)),
  });

  function openCreate() {
    setForm({ descricao: '', justificativa: '', origin_id: '', valor_estimado: 0, prazo_impacto_dias: 0 });
    setErr(null); setModalOpen(true);
  }

  // Agrupamento por status para mostrar pipeline
  const groups: Array<{ key: UnforeseenStatus; label: string; items: typeof items }> = [];
  ([...UNFORESEEN_STATUS_FLOW, 'aditado', 'recusado'] as UnforeseenStatus[]).forEach((s) => {
    const list = items.filter((i) => i.status === s);
    if (list.length > 0) groups.push({ key: s, label: STATUS_LABEL[s], items: list });
  });

  return (
    <Layout>
      <PageHeader
        title="Itens não previstos"
        subtitle="Pleitos, variações e itens extras — modelo de 5 objetos (solicitação → análise → aprovação → aditivo)"
        backTo={`/contratos/${id}`}
        backLabel="Contrato"
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4" />Nova solicitação</Button>}
      />

      {/* Pipeline visual */}
      <Card className="mb-4 overflow-hidden p-4">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Pipeline (5 objetos da spec)
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {UNFORESEEN_STATUS_FLOW.map((s, i) => {
            const count = items.filter((it) => it.status === s).length;
            return (
              <div key={s} className="flex items-center gap-2">
                <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${
                  count > 0 ? 'bg-navy text-white' : 'bg-slate-100 text-slate-500 dark:bg-muted-dark dark:text-slate-400'
                }`}>
                  <span className="font-bold">{i + 1}</span>
                  <span>{STATUS_LABEL[s].replace(/^\d+[ab]?\. /, '')}</span>
                  {count > 0 && <span className="rounded-full bg-white/20 px-1.5 text-[10px] font-bold">{count}</span>}
                </div>
                {i < UNFORESEEN_STATUS_FLOW.length - 1 && <ArrowRight className="h-3 w-3 text-slate-400" />}
              </div>
            );
          })}
        </div>
      </Card>

      {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}
      {!isLoading && items.length === 0 && (
        <Empty title="Sem itens não previstos"
          body="Cadastre o primeiro item para iniciar o fluxo de análise técnica → aprovação → aditivo."
          action={<Button onClick={openCreate}><Plus className="h-4 w-4" />Nova solicitação</Button>} />
      )}

      {groups.map((g) => (
        <Card key={g.key} className="mb-3 overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 dark:border-border-dark">
            <h3 className="font-semibold dark:text-slate-100">
              <Badge tone={STATUS_TONE[g.key]} className="mr-2">{g.items.length}</Badge>
              {g.label}
            </h3>
          </div>
          <table className="table">
            <thead><tr><th>#</th><th>Descrição</th><th>Origem</th><th>Aberto em</th><th className="text-right">Valor estimado</th><th className="text-right">Prazo (dias)</th><th /></tr></thead>
            <tbody>
              {g.items.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                  <td className="font-mono font-bold">{u.numero}</td>
                  <td>
                    <Link to={u.id} className="font-medium text-navy hover:underline dark:text-slate-200">{u.descricao}</Link>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{u.justificativa.slice(0, 80)}...</p>
                  </td>
                  <td className="text-xs">{u.unforeseen_item_origins?.nome || '—'}</td>
                  <td className="text-xs">{dt(u.data_abertura)}</td>
                  <td className="text-right tabular">{brl(u.valor_estimado)}</td>
                  <td className="text-right tabular">{u.prazo_impacto_dias || '—'}</td>
                  <td><Link to={u.id} className="text-xs font-semibold text-navy hover:underline dark:text-slate-200">Abrir</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {/* Modal nova solicitação */}
      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title="Nova solicitação de item não previsto"
        subtitle="Objeto 1: Solicitação. Após criar, você avança para análise técnica."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={() => create.mutate()} loading={create.isPending}
              disabled={!form.descricao.trim() || !form.justificativa.trim()}>
              Criar e abrir
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Descrição" required>
            <textarea className="input" rows={2}
              value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="Descrição clara do item ou alteração proposta" autoFocus />
          </Field>
          <Field label="Justificativa / motivo" required hint="Por que esse item não constava no escopo original?">
            <textarea className="input" rows={3}
              value={form.justificativa} onChange={(e) => setForm({ ...form, justificativa: e.target.value })} />
          </Field>
          <Field label="Origem" required hint="Categoria padronizada do motivo">
            <Select options={[{ value: '', label: '— selecione —' }, ...origins.map((o) => ({ value: o.id, label: o.nome }))]}
              value={form.origin_id} onChange={(e) => setForm({ ...form, origin_id: e.target.value })} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Valor estimado (R$)" hint="Pode ser refinado na análise de preço">
              <input type="number" min="0" step="0.01" className="input tabular"
                value={form.valor_estimado || ''} onChange={(e) => setForm({ ...form, valor_estimado: Number(e.target.value) })} />
            </Field>
            <Field label="Impacto no prazo (dias)">
              <input type="number" min="0" className="input tabular"
                value={form.prazo_impacto_dias || ''} onChange={(e) => setForm({ ...form, prazo_impacto_dias: Number(e.target.value) })} />
            </Field>
          </div>
          {err && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4" /><span>{err}</span>
            </div>
          )}
        </div>
      </Modal>
    </Layout>
  );
}

// =============================================================================
// DETALHE
// =============================================================================
export function UnforeseenDetail() {
  const { id = '', itemId = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: item } = useQuery({
    queryKey: ['unforeseen-item', itemId], queryFn: () => getUnforeseenItem(itemId), enabled: !!itemId,
  });
  const { data: components = [] } = useQuery({
    queryKey: ['unforeseen-components', itemId], queryFn: () => listUnforeseenComponents(itemId), enabled: !!itemId,
  });

  const [advanceErr, setAdvanceErr] = useState<string | null>(null);
  const [advanceTarget, setAdvanceTarget] = useState<UnforeseenStatus | null>(null);
  const [advanceComment, setAdvanceComment] = useState('');

  const advance = useMutation({
    mutationFn: () => advanceUnforeseenItem(itemId, advanceTarget!, advanceComment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['unforeseen-item', itemId] });
      qc.invalidateQueries({ queryKey: ['unforeseen', id] });
      setAdvanceTarget(null); setAdvanceComment(''); setAdvanceErr(null);
    },
    onError: (e: Error) => setAdvanceErr(humanizeError(e)),
  });

  // Composição (Objeto 3): modal para criar componente
  const [compModalOpen, setCompModalOpen] = useState(false);
  const [compForm, setCompForm] = useState<Omit<UnforeseenComponent, 'id'>>({
    unforeseen_item_id: itemId,
    contract_item_id: null,
    tipo: 'extra_novo',
    codigo: null, descricao: '', unidade: null,
    quantidade: 0, preco_unitario: 0, valor_total: 0,
    fonte_referencia: 'proprio', codigo_referencia: null, composicao: {},
  });
  const [compErr, setCompErr] = useState<string | null>(null);

  const upsertComp = useMutation({
    mutationFn: () => upsertUnforeseenComponent({ ...compForm, unforeseen_item_id: itemId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['unforeseen-components', itemId] }); setCompModalOpen(false); },
    onError: (e: Error) => setCompErr(humanizeError(e)),
  });
  const delComp = useMutation({
    mutationFn: deleteUnforeseenComponent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['unforeseen-components', itemId] }),
  });

  function openNewComponent() {
    setCompForm({
      unforeseen_item_id: itemId, contract_item_id: null,
      tipo: 'extra_novo', codigo: null, descricao: '', unidade: null,
      quantidade: 0, preco_unitario: 0, valor_total: 0,
      fonte_referencia: 'proprio', codigo_referencia: null, composicao: {},
    });
    setCompErr(null); setCompModalOpen(true);
  }

  if (!item) return <Layout><Skeleton className="h-96" /></Layout>;

  const totalComp = components.reduce((s, c) => {
    if (c.tipo === 'decrescimo') return s - c.valor_total;
    if (c.tipo === 'titulo') return s;
    return s + c.valor_total;
  }, 0);

  const allowedNext = NEXT_STATUS[item.status] || [];

  return (
    <Layout>
      <PageHeader
        title={`Item não previsto #${item.numero}`}
        subtitle={item.descricao}
        backTo={`/contratos/${id}/itens-nao-previstos`}
        backLabel="Itens não previstos"
        actions={
          <Badge tone={STATUS_TONE[item.status]}>
            {STATUS_LABEL[item.status]}
          </Badge>
        }
      />

      {/* Pipeline horizontal mostrando onde está */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-1">
          {UNFORESEEN_STATUS_FLOW.map((s, i) => {
            const idx = UNFORESEEN_STATUS_FLOW.indexOf(item.status as any);
            const passed = idx >= i;
            const current = item.status === s;
            return (
              <div key={s} className="flex items-center gap-1">
                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  current ? 'bg-navy text-white ring-2 ring-navy ring-offset-2' :
                  passed ? 'bg-success text-white' :
                  'bg-slate-200 text-slate-500 dark:bg-muted-dark'
                }`}>
                  {passed && !current ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>
                {i < UNFORESEEN_STATUS_FLOW.length - 1 && (
                  <div className={`h-0.5 w-8 ${idx > i ? 'bg-success' : 'bg-slate-200 dark:bg-muted-dark'}`} />
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {STATUS_LABEL[item.status]} · etapa {Math.min(UNFORESEEN_STATUS_FLOW.indexOf(item.status as any) + 1, 6)} de 6
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* OBJETO 2: análise técnica */}
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-semibold dark:text-slate-100">Análise técnica</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Objeto 2 · descrição e justificativa</p>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase text-slate-500 dark:text-slate-400">Descrição</dt>
              <dd className="font-medium">{item.descricao}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500 dark:text-slate-400">Justificativa</dt>
              <dd>{item.justificativa}</dd>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <dt className="text-xs uppercase text-slate-500 dark:text-slate-400">Origem</dt>
                <dd className="font-medium">{item.unforeseen_item_origins?.nome || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-500 dark:text-slate-400">Valor estimado</dt>
                <dd className="font-medium tabular">{brl(item.valor_estimado)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-500 dark:text-slate-400">Impacto no prazo</dt>
                <dd className="font-medium tabular">{item.prazo_impacto_dias || 0} dias</dd>
              </div>
            </div>
            <p className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <Calendar className="h-3 w-3" /> Aberto em {dt(item.data_abertura)}
              {item.approved_at && <> · aprovado em {dt(item.approved_at)}</>}
            </p>
          </dl>
        </Card>

        {/* Ações de workflow */}
        <Card className="p-5">
          <h2 className="font-semibold dark:text-slate-100">Avançar etapa</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {allowedNext.length > 0 ? 'Próximas transições válidas:' : 'Sem transições disponíveis.'}
          </p>
          {allowedNext.length === 0 && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-muted-dark">
              {item.status === 'aprovado' && (
                <>
                  <CheckCircle2 className="mb-2 h-5 w-5 text-success" />
                  <p className="font-medium">Item aprovado e pronto para aditivo.</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Vá em "Aditivos" para incorporar este item num aditivo formal.
                  </p>
                  <Button onClick={() => navigate(`/contratos/${id}/aditivos`)} className="mt-3 w-full">
                    Ir para aditivos
                  </Button>
                </>
              )}
              {item.status === 'aditado' && (
                <>
                  <Sparkles className="mb-2 h-5 w-5 text-magenta" />
                  <p className="font-medium">Item incorporado em aditivo.</p>
                </>
              )}
              {(item.status === 'recusado' || item.status === 'cancelado') && (
                <>
                  <X className="mb-2 h-5 w-5 text-error" />
                  <p className="font-medium capitalize">{item.status}.</p>
                </>
              )}
            </div>
          )}

          {allowedNext.length > 0 && (
            <div className="mt-4 space-y-2">
              {allowedNext.map((next) => (
                <Button
                  key={next} variant={next === 'recusado' || next === 'cancelado' ? 'danger' : next === 'aprovado' ? 'primary' : 'outline'}
                  className="w-full justify-start"
                  onClick={() => setAdvanceTarget(next)}
                >
                  <ArrowRight className="h-4 w-4" />
                  {STATUS_LABEL[next]}
                </Button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* OBJETO 3: análise de preço (composição) */}
      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-border-dark">
          <div>
            <h2 className="font-semibold dark:text-slate-100">Análise de preço · composição</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Objeto 3 · acréscimo de itens existentes, decréscimo ou item extra novo
            </p>
          </div>
          {item.status === 'analise_preco' && (
            <Button onClick={openNewComponent}><Plus className="h-4 w-4" />Componente</Button>
          )}
        </div>

        {components.length === 0 ? (
          <div className="p-8 text-center">
            <FileWarning className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              {item.status === 'analise_preco'
                ? 'Adicione componentes (acréscimo, decréscimo ou item extra) para compor o preço.'
                : 'Componentes serão adicionados na fase de análise de preço.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Código / descrição</th>
                  <th className="text-center">Un.</th>
                  <th className="text-right">Qtd.</th>
                  <th className="text-right">Preço unit.</th>
                  <th className="text-right">Valor total</th>
                  <th>Fonte</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {components.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                    <td>
                      <Badge tone={c.tipo === 'acrescimo' ? 'green' : c.tipo === 'decrescimo' ? 'red' : c.tipo === 'extra_novo' ? 'purple' : 'slate'}>
                        {c.tipo}
                      </Badge>
                    </td>
                    <td>
                      {c.codigo && <p className="font-mono text-xs">{c.codigo}</p>}
                      <p className="text-sm">{c.descricao}</p>
                    </td>
                    <td className="text-center text-xs uppercase">{c.unidade || '—'}</td>
                    <td className="text-right tabular">{num(c.quantidade, 4)}</td>
                    <td className="text-right tabular">{brl(c.preco_unitario)}</td>
                    <td className="text-right tabular font-medium">
                      <span className={c.tipo === 'decrescimo' ? 'text-error' : ''}>
                        {c.tipo === 'decrescimo' ? '-' : ''}{brl(c.valor_total)}
                      </span>
                    </td>
                    <td className="text-xs">{c.fonte_referencia}{c.codigo_referencia ? ` ${c.codigo_referencia}` : ''}</td>
                    <td>
                      {item.status === 'analise_preco' && (
                        <button onClick={() => { if (confirm('Remover componente?')) delComp.mutate(c.id); }}
                          className="rounded-lg p-1 text-error hover:bg-red-50 dark:hover:bg-red-900/20">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold dark:border-border-dark dark:bg-muted-dark">
                  <td colSpan={5} className="text-right">Valor líquido:</td>
                  <td className="text-right tabular">{brl(totalComp)}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal: confirmar transição */}
      <Modal
        open={!!advanceTarget} onClose={() => setAdvanceTarget(null)}
        title={`Avançar para: ${advanceTarget ? STATUS_LABEL[advanceTarget] : ''}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdvanceTarget(null)}>Cancelar</Button>
            <Button
              variant={advanceTarget === 'recusado' || advanceTarget === 'cancelado' ? 'danger' : 'primary'}
              onClick={() => advance.mutate()}
              loading={advance.isPending}
            >
              Confirmar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Confirma a transição de <strong>{STATUS_LABEL[item.status]}</strong> para <strong>{advanceTarget ? STATUS_LABEL[advanceTarget] : ''}</strong>?
          </p>
          {(advanceTarget === 'recusado' || advanceTarget === 'cancelado') && (
            <div className="rounded-lg bg-yellow-50 p-3 text-xs text-yellow-900 dark:bg-yellow-900/20 dark:text-yellow-200">
              <ShieldAlert className="mb-1 inline h-3 w-3" /> Esta ação é final.
            </div>
          )}
          <Field label="Comentário (opcional)">
            <textarea className="input" rows={2}
              value={advanceComment} onChange={(e) => setAdvanceComment(e.target.value)}
              placeholder="Justificativa, parecer técnico, etc." />
          </Field>
          {advanceErr && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4" /><span>{advanceErr}</span>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal: novo componente */}
      <Modal
        open={compModalOpen} onClose={() => setCompModalOpen(false)}
        title="Novo componente"
        subtitle="Acréscimo de item existente, decréscimo ou item extra novo"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCompModalOpen(false)}>Cancelar</Button>
            <Button onClick={() => upsertComp.mutate()} loading={upsertComp.isPending}
              disabled={!compForm.descricao.trim() || compForm.quantidade <= 0}>
              Salvar componente
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Tipo" required>
            <Select
              options={[
                { value: 'acrescimo',  label: 'Acréscimo (item existente)' },
                { value: 'decrescimo', label: 'Decréscimo (item existente)' },
                { value: 'extra_novo', label: 'Item extra novo' },
              ]}
              value={compForm.tipo} onChange={(e) => setCompForm({ ...compForm, tipo: e.target.value as any })}
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Código">
              <input className="input" value={compForm.codigo || ''} onChange={(e) => setCompForm({ ...compForm, codigo: e.target.value || null })} />
            </Field>
            <Field label="Descrição" required className="md:col-span-2">
              <input className="input" value={compForm.descricao} onChange={(e) => setCompForm({ ...compForm, descricao: e.target.value })} autoFocus />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Unidade">
              <input className="input" value={compForm.unidade || ''} onChange={(e) => setCompForm({ ...compForm, unidade: e.target.value || null })} />
            </Field>
            <Field label="Quantidade" required>
              <input type="number" min="0" step="0.000001" className="input tabular"
                value={compForm.quantidade || ''} onChange={(e) => setCompForm({ ...compForm, quantidade: Number(e.target.value) })} />
            </Field>
            <Field label="Preço unitário (R$)" required>
              <input type="number" min="0" step="0.01" className="input tabular"
                value={compForm.preco_unitario || ''} onChange={(e) => setCompForm({ ...compForm, preco_unitario: Number(e.target.value) })} />
            </Field>
            <Field label="Total (calculado)">
              <input readOnly className="input bg-slate-50 tabular dark:bg-muted-dark"
                value={brl(compForm.quantidade * compForm.preco_unitario)} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Fonte de referência">
              <Select
                options={[
                  { value: 'SINAPI', label: 'SINAPI' },
                  { value: 'SICRO', label: 'SICRO' },
                  { value: 'ORSE', label: 'ORSE' },
                  { value: 'SEDOP', label: 'SEDOP' },
                  { value: 'proprio', label: 'Composição própria' },
                ]}
                value={compForm.fonte_referencia || 'proprio'}
                onChange={(e) => setCompForm({ ...compForm, fonte_referencia: e.target.value })}
              />
            </Field>
            <Field label="Código de referência" hint="Ex: SINAPI 92479">
              <input className="input" value={compForm.codigo_referencia || ''}
                onChange={(e) => setCompForm({ ...compForm, codigo_referencia: e.target.value || null })} />
            </Field>
          </div>
          {compErr && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4" /><span>{compErr}</span>
            </div>
          )}
        </div>
      </Modal>
    </Layout>
  );
}
