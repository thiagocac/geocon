import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, AlertCircle, CheckCircle2, Plus } from 'lucide-react';
import {
  getContract, createContract, updateContract,
  listOrganizations, createOrganization,
  type ContractInput,
} from '../lib/api';
import { humanizeError } from '../lib/errors';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Field, Select } from '../components/ui/FormField';
import { Skeleton } from '../components/ui/Stat';

const REGIMES = [
  { value: 'preco_unitario',   label: 'Preço unitário' },
  { value: 'preco_global',     label: 'Preço global' },
  { value: 'empreitada_integral', label: 'Empreitada integral' },
  { value: 'tarefa',           label: 'Tarefa' },
  { value: 'contratacao_integrada', label: 'Contratação integrada' },
];

const MODALIDADES = [
  { value: 'concorrencia',  label: 'Concorrência' },
  { value: 'pregao_eletronico', label: 'Pregão eletrônico' },
  { value: 'dispensa',      label: 'Dispensa' },
  { value: 'inexigibilidade', label: 'Inexigibilidade' },
  { value: 'rdc',           label: 'RDC' },
  { value: 'leilao',        label: 'Leilão' },
  { value: 'concurso',      label: 'Concurso' },
];

const PERIODICIDADES = [
  { value: 'mensal',     label: 'Mensal' },
  { value: 'quinzenal',  label: 'Quinzenal' },
  { value: 'semanal',    label: 'Semanal' },
  { value: 'sob_demanda', label: 'Sob demanda' },
];

const STATUS_OPTS = [
  { value: 'rascunho',    label: 'Rascunho' },
  { value: 'licitacao',   label: 'Licitação' },
  { value: 'contratado',  label: 'Contratado' },
  { value: 'em_execucao', label: 'Em execução' },
  { value: 'suspenso',    label: 'Suspenso' },
];

export function ContractForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [form, setForm] = useState<ContractInput>({
    numero: '', objeto: '',
    contratante_id: null, contratada_id: null, gerenciadora_id: null,
    valor_inicial: 0, data_assinatura: null, data_ordem_inicio: null,
    prazo_execucao_dias: null, prazo_vigencia_dias: null,
    regime_contratacao: 'preco_unitario', modalidade_licitatoria: 'concorrencia',
    lei_referencia: '14.133/2021', processo_administrativo: null, dotacao_orcamentaria: null,
    fonte_recurso: null, garantia_percentual: 5, retencao_padrao_percentual: 5,
    periodicidade_medicao: 'mensal', status: 'rascunho',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  // Para edição, carrega o contrato existente
  const { data: existing, isLoading } = useQuery({
    queryKey: ['contract', id],
    queryFn: () => getContract(id!),
    enabled: editing,
  });

  useEffect(() => {
    if (!editing || !existing) return;
    setForm((f) => ({
      ...f,
      numero: existing.numero,
      objeto: existing.objeto,
      valor_inicial: existing.valor_inicial,
      data_assinatura: existing.data_assinatura || null,
      data_ordem_inicio: existing.data_ordem_inicio || null,
      regime_contratacao: existing.regime_contratacao || null,
      modalidade_licitatoria: existing.modalidade_licitatoria || null,
      status: existing.status,
    }));
  }, [editing, existing]);

  const orgsQ = useQuery({ queryKey: ['organizations'], queryFn: () => listOrganizations() });
  const allOrgs = orgsQ.data || [];
  const contratantes = allOrgs.filter((o) => ['contratante', 'orgao'].includes(o.tipo));
  const contratadas  = allOrgs.filter((o) => o.tipo === 'contratada');
  const gerenciadoras = allOrgs.filter((o) => o.tipo === 'gerenciadora');

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        await updateContract(id!, form);
        return id!;
      }
      return await createContract(form);
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['contracts'] });
      qc.invalidateQueries({ queryKey: ['contract', newId] });
      navigate(`/contratos/${newId}`);
    },
    onError: (e: Error) => setServerError(humanizeError(e)),
  });

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.numero.trim()) errs.numero = 'Informe o número do contrato';
    if (!form.objeto.trim() || form.objeto.length < 10) errs.objeto = 'Descreva o objeto (≥ 10 caracteres)';
    if (form.valor_inicial <= 0) errs.valor_inicial = 'Valor inicial deve ser maior que zero';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;
    save.mutate();
  }

  function update<K extends keyof ContractInput>(k: K, v: ContractInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  if (editing && isLoading) {
    return <Layout><Skeleton className="h-96" /></Layout>;
  }

  return (
    <Layout>
      <PageHeader
        title={editing ? `Editar contrato ${form.numero || ''}` : 'Novo contrato'}
        subtitle="Dados contratuais, partes, prazos, valores e regras de medição"
        backTo={editing ? `/contratos/${id}` : '/contratos'}
        backLabel={editing ? 'Contrato' : 'Contratos'}
        actions={
          <Button form="contract-form" type="submit" loading={save.isPending}>
            <Save className="h-4 w-4" />
            {editing ? 'Salvar' : 'Criar contrato'}
          </Button>
        }
      />

      {serverError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{serverError}</span>
        </div>
      )}

      <form id="contract-form" onSubmit={handleSubmit} className="space-y-6">
        {/* Identificação */}
        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-900 dark:text-slate-100">Identificação</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Número do contrato" htmlFor="numero" required error={errors.numero}>
              <input id="numero" className="input" placeholder="ex: CT-2026/0001"
                value={form.numero} onChange={(e) => update('numero', e.target.value)} required />
            </Field>
            <Field label="Status" htmlFor="status">
              <Select id="status" options={STATUS_OPTS} value={form.status || 'rascunho'} onChange={(e) => update('status', e.target.value)} />
            </Field>
          </div>
          <Field label="Objeto" htmlFor="objeto" required error={errors.objeto} className="mt-4">
            <textarea id="objeto" rows={2} className="input"
              placeholder="Descrição completa do objeto contratado"
              value={form.objeto} onChange={(e) => update('objeto', e.target.value)} required minLength={10} />
          </Field>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Processo administrativo" htmlFor="processo">
              <input id="processo" className="input"
                value={form.processo_administrativo || ''} onChange={(e) => update('processo_administrativo', e.target.value || null)} />
            </Field>
            <Field label="Dotação orçamentária" htmlFor="dotacao">
              <input id="dotacao" className="input"
                value={form.dotacao_orcamentaria || ''} onChange={(e) => update('dotacao_orcamentaria', e.target.value || null)} />
            </Field>
          </div>
          <Field label="Fonte de recurso" htmlFor="fonte" className="mt-4">
            <input id="fonte" className="input" placeholder="próprio / convênio / BNDES / BID / BIRD"
              value={form.fonte_recurso || ''} onChange={(e) => update('fonte_recurso', e.target.value || null)} />
          </Field>
        </Card>

        {/* Partes */}
        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-900 dark:text-slate-100">Partes contratuais</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <OrgPicker label="Contratante" tipo="contratante"
              options={contratantes}
              value={form.contratante_id} onChange={(v) => update('contratante_id', v)}
              onCreated={(id) => { update('contratante_id', id); orgsQ.refetch(); }} />
            <OrgPicker label="Contratada" tipo="contratada" required
              options={contratadas}
              value={form.contratada_id} onChange={(v) => update('contratada_id', v)}
              onCreated={(id) => { update('contratada_id', id); orgsQ.refetch(); }} />
            <OrgPicker label="Gerenciadora" tipo="gerenciadora"
              options={gerenciadoras}
              value={form.gerenciadora_id} onChange={(v) => update('gerenciadora_id', v)}
              onCreated={(id) => { update('gerenciadora_id', id); orgsQ.refetch(); }} />
          </div>
        </Card>

        {/* Modalidade e regime */}
        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-900 dark:text-slate-100">Modalidade e regime</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Regime de contratação"><Select options={REGIMES} value={form.regime_contratacao || ''} onChange={(e) => update('regime_contratacao', e.target.value)} /></Field>
            <Field label="Modalidade licitatória"><Select options={MODALIDADES} value={form.modalidade_licitatoria || ''} onChange={(e) => update('modalidade_licitatoria', e.target.value)} /></Field>
            <Field label="Lei de referência" hint="Ex: 14.133/2021 ou 8.666/1993">
              <input className="input" value={form.lei_referencia || ''} onChange={(e) => update('lei_referencia', e.target.value)} />
            </Field>
          </div>
        </Card>

        {/* Valores e prazos */}
        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-900 dark:text-slate-100">Valores e prazos</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Valor inicial (R$)" required error={errors.valor_inicial}>
              <input type="number" min="0" step="0.01" className="input tabular"
                value={form.valor_inicial || ''} onChange={(e) => update('valor_inicial', Number(e.target.value))} required />
            </Field>
            <Field label="Garantia (%)" hint="Padrão 5%">
              <input type="number" min="0" max="100" step="0.01" className="input tabular"
                value={form.garantia_percentual ?? ''} onChange={(e) => update('garantia_percentual', e.target.value === '' ? null : Number(e.target.value))} />
            </Field>
            <Field label="Retenção padrão (%)" hint="Padrão 5%">
              <input type="number" min="0" max="100" step="0.01" className="input tabular"
                value={form.retencao_padrao_percentual ?? ''} onChange={(e) => update('retencao_padrao_percentual', e.target.value === '' ? null : Number(e.target.value))} />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <Field label="Assinatura">
              <input type="date" className="input" value={form.data_assinatura || ''} onChange={(e) => update('data_assinatura', e.target.value || null)} />
            </Field>
            <Field label="Ordem de início">
              <input type="date" className="input" value={form.data_ordem_inicio || ''} onChange={(e) => update('data_ordem_inicio', e.target.value || null)} />
            </Field>
            <Field label="Prazo execução (dias)">
              <input type="number" min="0" className="input tabular" value={form.prazo_execucao_dias ?? ''} onChange={(e) => update('prazo_execucao_dias', e.target.value === '' ? null : Number(e.target.value))} />
            </Field>
            <Field label="Prazo vigência (dias)">
              <input type="number" min="0" className="input tabular" value={form.prazo_vigencia_dias ?? ''} onChange={(e) => update('prazo_vigencia_dias', e.target.value === '' ? null : Number(e.target.value))} />
            </Field>
          </div>
        </Card>

        {/* Periodicidade de medição */}
        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-900 dark:text-slate-100">Medição</h2>
          <Field label="Periodicidade" hint="Sob demanda permite medições sem cronograma fixo">
            <Select options={PERIODICIDADES} value={form.periodicidade_medicao || 'mensal'} onChange={(e) => update('periodicidade_medicao', e.target.value)} />
          </Field>
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            Para gerenciar obras/lotes, partes e EAP, salve o contrato primeiro e use os submenus que aparecerão em
            <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-muted-dark">/contratos/{`{id}`}/obras</code>,
            <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-muted-dark">/partes</code>,
            <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-muted-dark">/planilha</code>.
          </p>
        </Card>
      </form>
    </Layout>
  );
}

// =============================================================================
// Picker de organização com opção "criar nova" inline
// =============================================================================
interface OrgPickerProps {
  label: string;
  tipo: string;
  options: Array<{ id: string; nome: string; cnpj: string | null; tipo: string }>;
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  onCreated: (id: string) => void;
  required?: boolean;
}

function OrgPicker({ label, tipo, options, value, onChange, onCreated, required }: OrgPickerProps) {
  const [openModal, setOpenModal] = useState(false);
  const [newNome, setNewNome] = useState('');
  const [newCnpj, setNewCnpj] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleCreate() {
    if (!newNome.trim()) return;
    setCreating(true); setErr(null);
    try {
      const id = await createOrganization({ nome: newNome.trim(), cnpj: newCnpj.trim() || null, tipo });
      onCreated(id);
      setNewNome(''); setNewCnpj('');
      setOpenModal(false);
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Field label={label} required={required}>
        <div className="flex gap-2">
          <select className="input" value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">— selecione —</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}{o.cnpj ? ` · ${o.cnpj}` : ''}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setOpenModal(true)}
            className="rounded-lg border border-slate-300 px-3 hover:bg-slate-50 dark:border-border-dark dark:hover:bg-muted-dark"
            title="Criar nova">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </Field>

      <Modal
        open={openModal} onClose={() => setOpenModal(false)}
        title={`Nova ${label.toLowerCase()}`}
        subtitle={`Tipo: ${tipo}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpenModal(false)}>Cancelar</Button>
            <Button onClick={handleCreate} loading={creating} disabled={!newNome.trim()}>
              <CheckCircle2 className="h-4 w-4" />Criar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Nome / razão social" required>
            <input className="input" value={newNome} onChange={(e) => setNewNome(e.target.value)} autoFocus />
          </Field>
          <Field label="CNPJ">
            <input className="input" placeholder="00.000.000/0001-00" value={newCnpj} onChange={(e) => setNewCnpj(e.target.value)} />
          </Field>
          {err && <p className="text-sm text-error">{err}</p>}
        </div>
      </Modal>
    </>
  );
}
