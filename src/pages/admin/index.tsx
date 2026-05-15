import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Users, Briefcase, ShieldCheck, BookOpen, Edit3, Filter } from 'lucide-react';
import { supabase, hasSupabase } from '../../lib/supabase';
import { listBacklog, createBacklogItem, updateBacklogItem, type BacklogItem } from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Empty, Skeleton } from '../../components/ui/Stat';
import { Modal } from '../../components/ui/Modal';
import { Field, Select } from '../../components/ui/FormField';

export function AdminUsers() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'members'],
    queryFn: async () => {
      if (!hasSupabase) return [];
      const { data, error } = await supabase
        .from('members')
        .select('*, tenants(nome)')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  return (
    <Layout>
      <PageHeader
        kicker="Administração · Backlog"
        title="Usuários e papéis"
        subtitle="Gestão de membros do tenant, papéis e permissões por produto"
        actions={<Button><Plus className="h-4 w-4" />Convidar usuário</Button>}
      />
      {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}
      {!isLoading && data.length === 0 && <Empty title="Sem usuários" />}
      {data.length > 0 && (
        <Card className="overflow-hidden">
          <table className="table">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Tenant</th><th>Papel</th><th>Roles</th><th>Ativo</th></tr></thead>
            <tbody>
              {data.map((m: any) => (
                <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                  <td className="font-medium">{m.nome}</td>
                  <td className="text-sm text-slate-500 dark:text-slate-400">{m.email}</td>
                  <td className="text-xs">{m.tenants?.nome || '—'}</td>
                  <td><Badge tone="purple">{m.role}</Badge></td>
                  <td className="text-xs text-slate-500 dark:text-slate-400">
                    {(m.roles || []).join(', ') || '—'}
                  </td>
                  <td>{m.active ? <Badge tone="green">Sim</Badge> : <Badge tone="slate">Não</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Layout>
  );
}

export function AdminTenants() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'tenants'],
    queryFn: async () => {
      if (!hasSupabase) return [];
      const { data, error } = await supabase.from('tenants').select('*').order('nome');
      if (error) throw new Error(error.message);
      return data || [];
    },
  });
  return (
    <Layout>
      <PageHeader
        title="Tenants"
        subtitle="Espelho local dos tenants vindos do identity hub"
        actions={<Button variant="outline">Sincronizar identity</Button>}
      />
      {isLoading && <Skeleton className="h-32" />}
      {!isLoading && data.length === 0 && <Empty title="Sem tenants cadastrados" body="Sincronize com o identity hub." />}
      {data.length > 0 && (
        <Card className="overflow-hidden">
          <table className="table">
            <thead><tr><th>Nome</th><th>CNPJ</th><th>Ativo</th><th>ID</th></tr></thead>
            <tbody>
              {data.map((t: any) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.nome}</td>
                  <td className="text-xs">{t.cnpj || '—'}</td>
                  <td>{t.ativo ? <Badge tone="green">Ativo</Badge> : <Badge tone="slate">Inativo</Badge>}</td>
                  <td className="font-mono text-xs text-slate-400">{t.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Layout>
  );
}

export function Workflows() {
  return (
    <Layout>
      <PageHeader
        title="Templates de workflow"
        subtitle="Configure passos, papéis, SLA e regras de aprovação para medições, aditivos e itens não previstos"
        actions={<Button><Plus className="h-4 w-4" />Novo template</Button>}
      />
      <Empty title="Sem templates configurados" body="Cadastre um template para aplicar a contratos." />
    </Layout>
  );
}

const CATEGORIA_OPTIONS: { value: BacklogItem['categoria']; label: string }[] = [
  { value: 'autorizacao',  label: 'Autorização' },
  { value: 'ui_ux',        label: 'UI / UX' },
  { value: 'pdf',          label: 'PDF' },
  { value: 'email',        label: 'E-mail' },
  { value: 'relatorios',   label: 'Relatórios' },
  { value: 'autenticacao', label: 'Autenticação' },
  { value: 'tema',         label: 'Tema' },
  { value: 'integracao',   label: 'Integração' },
  { value: 'contratos',    label: 'Contratos' },
  { value: 'medicoes',     label: 'Medições' },
  { value: 'ged',          label: 'GED' },
  { value: 'outro',        label: 'Outro' },
];

const PRIORIDADE_OPTIONS: { value: BacklogItem['prioridade']; label: string }[] = [
  { value: 'alta',  label: 'Alta' },
  { value: 'media', label: 'Média' },
  { value: 'baixa', label: 'Baixa' },
];

const STATUS_OPTIONS: { value: BacklogItem['status']; label: string }[] = [
  { value: 'aberto',       label: 'Aberto' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'concluido',    label: 'Concluído' },
  { value: 'cancelado',    label: 'Cancelado' },
];

export function Backlog() {
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [editing, setEditing] = useState<BacklogItem | null>(null);
  const [creating, setCreating] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'backlog'],
    queryFn: listBacklog,
  });

  const filtered = filterStatus
    ? data.filter((b) => b.status === filterStatus)
    : data;

  function onSuccess() {
    qc.invalidateQueries({ queryKey: ['admin', 'backlog'] });
    setEditing(null);
    setCreating(false);
  }

  return (
    <Layout>
      <PageHeader
        title="Backlog interno"
        subtitle="Pendências, melhorias e bugs visíveis apenas para admins"
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Adicionar item</Button>}
      />

      {/* Filtros */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Filter className="h-3.5 w-3.5 text-slate-500" />
          <button
            type="button"
            onClick={() => setFilterStatus('')}
            className={`rounded-full px-3 py-1 font-medium transition ${
              filterStatus === '' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-muted-dark dark:text-slate-200'
            }`}
          >
            Todos <span className="ml-1 opacity-70">({data.length})</span>
          </button>
          {STATUS_OPTIONS.map((s) => {
            const count = data.filter((b) => b.status === s.value).length;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setFilterStatus(filterStatus === s.value ? '' : s.value)}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  filterStatus === s.value ? 'bg-navy text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-muted-dark dark:text-slate-200'
                }`}
              >
                {s.label} <span className="ml-1 opacity-70">({count})</span>
              </button>
            );
          })}
        </div>
      </Card>

      {isLoading && <Skeleton className="h-32" />}
      {!isLoading && filtered.length === 0 && (
        <Empty title={data.length === 0 ? 'Backlog vazio' : 'Sem itens para o filtro'}
               body={data.length === 0 ? 'Clique em "Adicionar item" para registrar a primeira pendência.' : 'Limpe o filtro para ver tudo.'} />
      )}
      {filtered.length > 0 && (
        <Card className="overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Título</th>
                <th>Categoria</th>
                <th>Prioridade</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                  <td className="font-mono text-xs text-slate-500">{b.numero}</td>
                  <td>
                    <p className="font-medium dark:text-slate-100">{b.titulo}</p>
                    {b.descricao && <p className="text-xs text-slate-500 dark:text-slate-400">{b.descricao}</p>}
                  </td>
                  <td className="text-xs uppercase text-slate-600 dark:text-slate-300">{b.categoria}</td>
                  <td><Badge tone={b.prioridade === 'alta' ? 'red' : b.prioridade === 'media' ? 'yellow' : 'slate'}>{b.prioridade}</Badge></td>
                  <td><Badge tone={b.status === 'concluido' ? 'green' : b.status === 'em_andamento' ? 'blue' : b.status === 'cancelado' ? 'slate' : 'yellow'}>{b.status.replace('_', ' ')}</Badge></td>
                  <td>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(b)}>
                      <Edit3 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {creating && <BacklogForm onClose={() => setCreating(false)} onSuccess={onSuccess} />}
      {editing && <BacklogForm item={editing} onClose={() => setEditing(null)} onSuccess={onSuccess} />}
    </Layout>
  );
}

function BacklogForm({ item, onClose, onSuccess }: { item?: BacklogItem; onClose: () => void; onSuccess: () => void }) {
  const [titulo,     setTitulo]     = useState(item?.titulo ?? '');
  const [descricao,  setDescricao]  = useState(item?.descricao ?? '');
  const [categoria,  setCategoria]  = useState<BacklogItem['categoria']>(item?.categoria ?? 'outro');
  const [prioridade, setPrioridade] = useState<BacklogItem['prioridade']>(item?.prioridade ?? 'media');
  const [status,     setStatus]     = useState<BacklogItem['status']>(item?.status ?? 'aberto');
  const [error,      setError]      = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!titulo.trim()) throw new Error('Título é obrigatório');
      if (item) {
        return updateBacklogItem(item.id, { titulo, descricao: descricao || null, categoria, prioridade, status });
      }
      return createBacklogItem({ titulo, descricao: descricao || null, categoria, prioridade });
    },
    onSuccess: () => { setError(null); onSuccess(); },
    onError: (e) => setError(humanizeError(e as Error)),
  });

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={item ? `Editar item #${item.numero}` : 'Novo item de backlog'}
      subtitle={item ? 'Atualize categoria, prioridade ou status' : 'Registre uma melhoria, bug ou pendência interna'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending}>
            {item ? 'Salvar alterações' : 'Criar item'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Título" required>
          <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} className="input" placeholder="Ex: Corrigir cálculo de retenção em medições complementares" />
        </Field>
        <Field label="Descrição" hint="Contexto técnico, passos pra reproduzir, links relevantes">
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={4} className="input" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Categoria" required>
            <Select value={categoria} onChange={(e) => setCategoria(e.target.value as BacklogItem['categoria'])} options={CATEGORIA_OPTIONS} />
          </Field>
          <Field label="Prioridade" required>
            <Select value={prioridade} onChange={(e) => setPrioridade(e.target.value as BacklogItem['prioridade'])} options={PRIORIDADE_OPTIONS} />
          </Field>
        </div>
        {item && (
          <Field label="Status" required>
            <Select value={status} onChange={(e) => setStatus(e.target.value as BacklogItem['status'])} options={STATUS_OPTIONS} />
          </Field>
        )}
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-error dark:bg-red-900/20">{error}</p>}
      </div>
    </Modal>
  );
}
