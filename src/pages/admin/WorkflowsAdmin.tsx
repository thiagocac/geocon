import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Edit2, Trash2, ShieldCheck, Clock, AlertCircle, UserCheck,
  ChevronUp, ChevronDown,
} from 'lucide-react';
import {
  listWorkflowTemplates, listMyDelegations, createDelegation, revokeDelegation,
  listAvailableMembers, listContractsLite,
  createWorkflowTemplate, updateWorkflowTemplate, deleteWorkflowTemplate,
  createWorkflowStep, updateWorkflowStep, deleteWorkflowStep, reorderWorkflowSteps,
  type WorkflowTemplate, type WorkflowStep,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { dt } from '../../lib/format';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Field, Select } from '../../components/ui/FormField';
import { Empty, Skeleton } from '../../components/ui/Stat';

const ROLE_OPTIONS = [
  { value: 'gerenciadora',    label: 'Gerenciadora' },
  { value: 'fiscal_contrato', label: 'Fiscal do contrato' },
  { value: 'fiscal_campo',    label: 'Fiscal de campo' },
  { value: 'gestor_contrato', label: 'Gestor do contrato' },
  { value: 'financeiro',      label: 'Financeiro' },
  { value: 'controle_interno', label: 'Controle interno' },
  { value: 'contratada',      label: 'Contratada' },
  { value: 'auditor',         label: 'Auditor' },
  { value: 'admin',           label: 'Administrador' },
];

const ACTION_OPTIONS = ['aprovar', 'devolver', 'reprovar'] as const;
type ActionVal = typeof ACTION_OPTIONS[number];

const ENTITY_OPTIONS = [
  { value: 'measurement',     label: 'Boletim de medição' },
  { value: 'additive',        label: 'Aditivo contratual' },
  { value: 'unforeseen_item', label: 'Item não previsto' },
  { value: 'ged_document',   label: 'Documento GED' },
  { value: 'grd',             label: 'Guia de remessa (GRD)' },
];

export function WorkflowsAdmin() {
  const [tab, setTab] = useState<'templates' | 'delegations'>('templates');

  return (
    <Layout>
      <PageHeader
        title="Workflows e delegações"
        subtitle="Templates configuráveis de aprovação + delegações temporárias"
      />

      <div className="mb-4 flex gap-2 border-b border-slate-200 dark:border-border-dark">
        <button
          onClick={() => setTab('templates')}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
            tab === 'templates' ? 'border-navy text-navy dark:border-slate-100 dark:text-slate-100' : 'border-transparent text-slate-500'
          }`}
        >
          Templates de workflow
        </button>
        <button
          onClick={() => setTab('delegations')}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
            tab === 'delegations' ? 'border-navy text-navy dark:border-slate-100 dark:text-slate-100' : 'border-transparent text-slate-500'
          }`}
        >
          Delegações ativas
        </button>
      </div>

      {tab === 'templates' && <TemplatesTab />}
      {tab === 'delegations' && <DelegationsTab />}
    </Layout>
  );
}

// =============================================================================
// TEMPLATES
// =============================================================================
function TemplatesTab() {
  const qc = useQueryClient();
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['workflow-templates'], queryFn: () => listWorkflowTemplates('measurement'),
  });
  const { data: contracts = [] } = useQuery({
    queryKey: ['contracts-lite'], queryFn: listContractsLite,
  });

  const [editing, setEditing] = useState<WorkflowTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  function invalidate() { qc.invalidateQueries({ queryKey: ['workflow-templates'] }); }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Configure as etapas de aprovação. Templates específicos de contrato têm precedência sobre o padrão do tenant.
        </p>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Novo template</Button>
      </div>

      {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}
      {!isLoading && templates.length === 0 && (
        <Empty title="Sem templates" body="Crie o primeiro template clicando em 'Novo template' acima." />
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((t) => (
          <Card key={t.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold dark:text-slate-100">{t.nome}</h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  <Badge tone="purple">{t.entity_type}</Badge>
                  {' · '}
                  {t.contract_id
                    ? <>Vinculado ao contrato <code className="rounded bg-slate-100 px-1 dark:bg-card-dark">{contracts.find((c) => c.id === t.contract_id)?.numero || t.contract_id.slice(0, 8)}</code></>
                    : 'Padrão do tenant'}
                </p>

                <div className="mt-3 space-y-1.5">
                  {t.workflow_steps?.sort((a, b) => a.ordem - b.ordem).map((s) => (
                    <div key={s.id} className="flex items-center gap-2 text-xs">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-navy font-bold text-white">{s.ordem}</div>
                      <span className="font-medium dark:text-slate-200">{s.nome}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-500">{s.role_required}</span>
                      <span className="text-slate-500">·</span>
                      <span className="flex items-center gap-0.5 text-slate-500"><Clock className="h-3 w-3" />{s.sla_hours}h</span>
                      {s.assinatura_obrigatoria && (
                        <Badge tone="yellow" className="!text-[10px]"><ShieldCheck className="h-2.5 w-2.5" /> sig</Badge>
                      )}
                    </div>
                  ))}
                  {(!t.workflow_steps || t.workflow_steps.length === 0) && (
                    <p className="text-xs italic text-slate-400">Sem etapas ainda — clique em editar para adicionar.</p>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <Badge tone={t.active ? 'green' : 'slate'}>{t.active ? 'ativo' : 'inativo'}</Badge>
                <button
                  onClick={() => setEditing(t)}
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-muted-dark"
                  title="Editar"
                >
                  <Edit2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {creating && (
        <CreateTemplateModal
          contracts={contracts}
          onClose={() => setCreating(false)}
          onCreated={(t) => { setCreating(false); invalidate(); setEditing(t); }}
        />
      )}

      {editing && (
        <EditTemplateModal
          template={editing}
          contracts={contracts}
          onClose={() => { setEditing(null); invalidate(); }}
        />
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Modal: criar novo template
// -----------------------------------------------------------------------------
function CreateTemplateModal({ contracts, onClose, onCreated }: {
  contracts: Array<{ id: string; numero: string; objeto: string }>;
  onClose: () => void;
  onCreated: (t: WorkflowTemplate) => void;
}) {
  const [nome, setNome] = useState('');
  const [entityType, setEntityType] = useState<WorkflowTemplate['entity_type']>('measurement');
  const [contractId, setContractId] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createWorkflowTemplate({
      nome: nome.trim(),
      entity_type: entityType,
      contract_id: contractId || null,
    }),
    onSuccess: (id) => {
      onCreated({
        id, nome: nome.trim(), entity_type: entityType,
        contract_id: contractId || null, active: true,
        created_at: new Date().toISOString(), workflow_steps: [],
      });
    },
    onError: (e: Error) => setErr(humanizeError(e)),
  });

  return (
    <Modal
      open onClose={onClose} title="Novo template de workflow" size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!nome.trim()}>
          <Plus className="h-4 w-4" />Criar
        </Button>
      </>}
    >
      <div className="space-y-3">
        <Field label="Nome do template" required>
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus
            placeholder="ex: Workflow padrão de medição" />
        </Field>
        <Field label="Aplica-se a">
          <Select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as WorkflowTemplate['entity_type'])}
            options={ENTITY_OPTIONS}
          />
        </Field>
        <Field label="Vincular a um contrato específico" hint="Deixe em branco para padrão do tenant">
          <Select
            value={contractId}
            onChange={(e) => setContractId(e.target.value)}
            options={[
              { value: '', label: '— Padrão do tenant (sem vínculo) —' },
              ...contracts.map((c) => ({ value: c.id, label: `${c.numero} · ${c.objeto.slice(0, 50)}` })),
            ]}
          />
        </Field>
        {err && <ErrorBox msg={err} />}
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Modal: editar template + CRUD de etapas
// -----------------------------------------------------------------------------
function EditTemplateModal({ template, contracts, onClose }: {
  template: WorkflowTemplate;
  contracts: Array<{ id: string; numero: string; objeto: string }>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(template.nome);
  const [contractId, setContractId] = useState(template.contract_id || '');
  const [active, setActive] = useState(template.active);
  const [steps, setSteps] = useState<WorkflowStep[]>(
    (template.workflow_steps || []).slice().sort((a, b) => a.ordem - b.ordem),
  );
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Carrega etapas frescas em caso de cache desatualizado
  useEffect(() => {
    setSteps((template.workflow_steps || []).slice().sort((a, b) => a.ordem - b.ordem));
  }, [template]);

  function invalidate() { qc.invalidateQueries({ queryKey: ['workflow-templates'] }); }

  const saveHeader = useMutation({
    mutationFn: () => updateWorkflowTemplate(template.id, {
      nome: nome.trim(), active, contract_id: contractId || null,
    }),
    onSuccess: () => { invalidate(); setErr(null); },
    onError: (e: Error) => setErr(humanizeError(e)),
  });

  const remove = useMutation({
    mutationFn: () => deleteWorkflowTemplate(template.id),
    onSuccess: () => { invalidate(); onClose(); },
    onError: (e: Error) => setErr(humanizeError(e)),
  });

  // ----- Steps -----
  const createStep = useMutation({
    mutationFn: () => createWorkflowStep({
      template_id: template.id,
      ordem: steps.length + 1,
      nome: 'Nova etapa', role_required: 'fiscal_contrato',
      sla_hours: 48, assinatura_obrigatoria: false,
      actions: ['aprovar', 'devolver', 'reprovar'],
    }),
    onSuccess: (id) => {
      setSteps([...steps, {
        id, template_id: template.id, ordem: steps.length + 1,
        nome: 'Nova etapa', role_required: 'fiscal_contrato',
        sla_hours: 48, assinatura_obrigatoria: false,
        actions: ['aprovar', 'devolver', 'reprovar'],
      }]);
      invalidate();
    },
    onError: (e: Error) => setErr(humanizeError(e)),
  });

  function patchStep(id: string, patch: Partial<WorkflowStep>) {
    setSteps((cur) => cur.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  const persistStep = useMutation({
    mutationFn: (s: WorkflowStep) => updateWorkflowStep(s.id, {
      nome: s.nome, role_required: s.role_required, sla_hours: s.sla_hours,
      assinatura_obrigatoria: s.assinatura_obrigatoria, actions: s.actions,
    }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => setErr(humanizeError(e)),
  });

  const removeStep = useMutation({
    mutationFn: (id: string) => deleteWorkflowStep(id),
    onSuccess: (_, id) => {
      setSteps((cur) => cur.filter((s) => s.id !== id).map((s, i) => ({ ...s, ordem: i + 1 })));
      invalidate();
    },
    onError: (e: Error) => setErr(humanizeError(e)),
  });

  function moveStep(idx: number, delta: -1 | 1) {
    const j = idx + delta;
    if (j < 0 || j >= steps.length) return;
    const arr = steps.slice();
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    setSteps(arr.map((s, i) => ({ ...s, ordem: i + 1 })));
    reorderWorkflowSteps(template.id, arr.map((s) => s.id))
      .then(() => invalidate())
      .catch((e) => setErr(humanizeError(e)));
  }

  return (
    <Modal
      open onClose={onClose} title={`Editar template: ${template.nome}`} size="xl"
      footer={<>
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="h-4 w-4" />Excluir template
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" onClick={onClose}>Fechar</Button>
      </>}
    >
      <div className="space-y-4">
        {/* CABEÇALHO */}
        <Card className="bg-slate-50 p-4 dark:bg-muted-dark">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nome">
              <input className="input" value={nome} onChange={(e) => setNome(e.target.value)}
                onBlur={() => nome !== template.nome && saveHeader.mutate()} />
            </Field>
            <Field label="Contrato vinculado" hint="Vazio = padrão do tenant">
              <Select
                value={contractId}
                onChange={(e) => { setContractId(e.target.value); setTimeout(() => saveHeader.mutate(), 0); }}
                options={[
                  { value: '', label: '— Padrão do tenant —' },
                  ...contracts.map((c) => ({ value: c.id, label: `${c.numero}` })),
                ]}
              />
            </Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active}
              onChange={(e) => { setActive(e.target.checked); setTimeout(() => saveHeader.mutate(), 0); }} />
            <span className="dark:text-slate-200">Template ativo</span>
          </label>
        </Card>

        {/* ETAPAS */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Etapas de aprovação ({steps.length})
            </h3>
            <Button variant="outline" onClick={() => createStep.mutate()} loading={createStep.isPending}>
              <Plus className="h-4 w-4" />Adicionar etapa
            </Button>
          </div>

          {steps.length === 0 && (
            <Empty title="Sem etapas" body="Adicione a primeira etapa do fluxo." />
          )}

          <div className="space-y-2">
            {steps.map((s, idx) => (
              <Card key={s.id} className="p-3">
                <div className="flex items-start gap-2">
                  {/* Coluna esquerda: ordem + reorder */}
                  <div className="flex flex-col items-center gap-1 pt-1">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">
                      {s.ordem}
                    </div>
                    <button onClick={() => moveStep(idx, -1)} disabled={idx === 0}
                      className="text-slate-400 hover:text-navy disabled:opacity-30" title="Mover para cima">
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1}
                      className="text-slate-400 hover:text-navy disabled:opacity-30" title="Mover para baixo">
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Conteúdo da etapa */}
                  <div className="grid flex-1 gap-2 md:grid-cols-2">
                    <Field label="Nome da etapa">
                      <input className="input !py-1 !text-sm" value={s.nome}
                        onChange={(e) => patchStep(s.id, { nome: e.target.value })}
                        onBlur={() => persistStep.mutate(s)} />
                    </Field>
                    <Field label="Papel exigido">
                      <Select
                        value={s.role_required}
                        onChange={(e) => { patchStep(s.id, { role_required: e.target.value }); setTimeout(() => persistStep.mutate({ ...s, role_required: e.target.value }), 0); }}
                        options={ROLE_OPTIONS}
                      />
                    </Field>
                    <Field label="SLA (horas)">
                      <input type="number" min={1} max={720} className="input !py-1 !text-sm"
                        value={s.sla_hours}
                        onChange={(e) => patchStep(s.id, { sla_hours: parseInt(e.target.value) || 0 })}
                        onBlur={() => persistStep.mutate(s)} />
                    </Field>
                    <Field label="Ações permitidas">
                      <div className="flex gap-3 pt-2 text-xs">
                        {ACTION_OPTIONS.map((a) => (
                          <label key={a} className="flex items-center gap-1">
                            <input type="checkbox"
                              checked={s.actions.includes(a)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? Array.from(new Set([...s.actions, a])) as ActionVal[]
                                  : s.actions.filter((x) => x !== a);
                                patchStep(s.id, { actions: next });
                                setTimeout(() => persistStep.mutate({ ...s, actions: next }), 0);
                              }}
                            />
                            <span className="dark:text-slate-200">{a}</span>
                          </label>
                        ))}
                      </div>
                    </Field>
                    <label className="mt-1 flex items-center gap-2 text-sm md:col-span-2">
                      <input type="checkbox"
                        checked={s.assinatura_obrigatoria}
                        onChange={(e) => {
                          patchStep(s.id, { assinatura_obrigatoria: e.target.checked });
                          setTimeout(() => persistStep.mutate({ ...s, assinatura_obrigatoria: e.target.checked }), 0);
                        }} />
                      <span className="dark:text-slate-200">Requer assinatura digital (gov.br / ZapSign)</span>
                    </label>
                  </div>

                  {/* Excluir etapa */}
                  <button onClick={() => confirm(`Excluir etapa "${s.nome}"?`) && removeStep.mutate(s.id)}
                    className="rounded-lg p-1 text-error hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Excluir etapa">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {err && <ErrorBox msg={err} />}
      </div>

      {confirmDelete && (
        <Modal open onClose={() => setConfirmDelete(false)} title="Excluir template?" size="sm"
          footer={<>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
              <Trash2 className="h-4 w-4" />Excluir definitivamente
            </Button>
          </>}>
          <p className="text-sm dark:text-slate-200">
            O template <strong>{template.nome}</strong> será marcado como excluído. Workflows já instanciados
            em medições continuam funcionando, mas novas medições passarão a usar o template padrão do tenant.
          </p>
        </Modal>
      )}
    </Modal>
  );
}

// =============================================================================
// DELEGAÇÕES (mantém comportamento original)
// =============================================================================
function DelegationsTab() {
  const qc = useQueryClient();
  const { data: dlgs = [], isLoading } = useQuery({
    queryKey: ['delegations'], queryFn: listMyDelegations,
  });
  const { data: members = [] } = useQuery({
    queryKey: ['available-members'], queryFn: listAvailableMembers,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [delegatee, setDelegatee] = useState('');
  const [escopo, setEscopo] = useState('measurement_approval');
  const [ativoDe, setAtivoDe] = useState(new Date().toISOString().slice(0, 10));
  const [ativoAte, setAtivoAte] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createDelegation({
      delegatee_id: delegatee, escopo,
      ativo_de: ativoDe + 'T00:00:00Z',
      ativo_ate: ativoAte + 'T23:59:59Z',
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delegations'] }); setModalOpen(false); },
    onError: (e: Error) => setErr(humanizeError(e)),
  });

  const revoke = useMutation({
    mutationFn: revokeDelegation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delegations'] }),
  });

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Use delegações para permitir que outro membro decida em seu lugar durante férias ou afastamentos.
          A delegação é registrada em <code>decided_via_delegation</code> de cada etapa.
        </p>
        <Button onClick={() => { setErr(null); setModalOpen(true); }}>
          <Plus className="h-4 w-4" />Nova delegação
        </Button>
      </div>

      {isLoading && <Card className="p-6"><Skeleton className="h-32" /></Card>}
      {!isLoading && dlgs.length === 0 && (
        <Empty title="Sem delegações ativas" body="Você não delegou nenhuma aprovação no momento." />
      )}

      {dlgs.length > 0 && (
        <Card className="overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Quem delega</th>
                <th>Quem recebe</th>
                <th>Escopo</th>
                <th>Início</th>
                <th>Fim</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dlgs.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                  <td>
                    <p className="font-medium dark:text-slate-100">{d.delegator?.nome}</p>
                    <p className="text-xs text-slate-500">{d.delegator?.email}</p>
                  </td>
                  <td>
                    <p className="font-medium dark:text-slate-100">
                      <UserCheck className="mr-1 inline h-3 w-3 text-purple" />
                      {d.delegatee?.nome}
                    </p>
                    <p className="text-xs text-slate-500">{d.delegatee?.email}</p>
                  </td>
                  <td><Badge tone="purple">{d.escopo}</Badge></td>
                  <td className="text-sm">{dt(d.ativo_de)}</td>
                  <td className="text-sm">{dt(d.ativo_ate)}</td>
                  <td>
                    <button onClick={() => { if (confirm('Revogar delegação?')) revoke.mutate(d.id); }}
                      className="rounded-lg p-1 text-error hover:bg-red-50 dark:hover:bg-red-900/20">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title="Nova delegação de aprovação"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={() => create.mutate()} loading={create.isPending}
              disabled={!delegatee}>
              Delegar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Delegar para" required>
            <Select
              value={delegatee} onChange={(e) => setDelegatee(e.target.value)}
              options={[{ value: '', label: '— selecione —' }, ...members.map((m) => ({ value: m.id, label: `${m.nome} · ${m.email}` }))]}
            />
          </Field>
          <Field label="Escopo">
            <Select
              value={escopo} onChange={(e) => setEscopo(e.target.value)}
              options={[
                { value: 'measurement_approval', label: 'Aprovação de medição' },
                { value: 'additive_approval', label: 'Aprovação de aditivo' },
                { value: 'unforeseen_approval', label: 'Aprovação de item não previsto' },
                { value: 'ged_approval', label: 'Aprovação de documento GED' },
                { value: 'all', label: 'Todos os escopos' },
              ]}
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Ativo de" required>
              <input type="date" className="input" value={ativoDe} onChange={(e) => setAtivoDe(e.target.value)} />
            </Field>
            <Field label="Ativo até" required>
              <input type="date" className="input" value={ativoAte} onChange={(e) => setAtivoAte(e.target.value)} />
            </Field>
          </div>
          {err && <ErrorBox msg={err} />}
        </div>
      </Modal>
    </>
  );
}

// =============================================================================
// Auxiliares
// =============================================================================
function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
      <AlertCircle className="mt-0.5 h-4 w-4" /><span>{msg}</span>
    </div>
  );
}
