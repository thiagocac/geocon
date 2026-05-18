import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, UserCheck, Hash, Tag } from 'lucide-react';
import {
  listRoleAliases, upsertRoleAlias, deleteRoleAlias,
  type RoleAlias,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { dtTime } from '../../lib/format';
import { AdminListPage } from '../../components/patterns/AdminListPage';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Field } from '../../components/ui/FormField';

/* Mesmo catálogo do Broadcast composer */
const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'admin',            label: 'Administradores' },
  { value: 'gestor_contrato',  label: 'Gestores de contrato' },
  { value: 'fiscal_contrato',  label: 'Fiscais de contrato' },
  { value: 'fiscal_campo',     label: 'Fiscais de campo' },
  { value: 'engenheiro_obra',  label: 'Engenheiros de obra' },
  { value: 'financeiro',       label: 'Financeiro' },
  { value: 'contratada',       label: 'Contratadas' },
  { value: 'viewer',           label: 'Somente leitura' },
];

interface FormState {
  id: string | null;
  name: string;
  description: string;
  roles: string[];
}

const EMPTY: FormState = { id: null, name: '', description: '', roles: [] };

export function AdminRoleAliases() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleAlias | null>(null);

  const { data = [], isLoading, error: queryError } = useQuery({
    queryKey: ['role-aliases'],
    queryFn: listRoleAliases,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      a.slug.toLowerCase().includes(q) ||
      (a.description || '').toLowerCase().includes(q),
    );
  }, [data, search]);

  const mUpsert = useMutation({
    mutationFn: upsertRoleAlias,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['role-aliases'] });
      setOpen(false);
      setForm(EMPTY);
      setError(null);
    },
    onError: (err) => setError(humanizeError(err)),
  });

  const mDelete = useMutation({
    mutationFn: deleteRoleAlias,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['role-aliases'] });
      setDeleteTarget(null);
    },
  });

  function openNew() {
    setForm(EMPTY);
    setError(null);
    setOpen(true);
  }

  function openEdit(a: RoleAlias) {
    setForm({
      id: a.id,
      name: a.name,
      description: a.description || '',
      roles: [...a.roles],
    });
    setError(null);
    setOpen(true);
  }

  function toggleRole(r: string) {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r],
    }));
  }

  function submit() {
    if (form.name.trim().length < 2) {
      setError('Nome precisa de pelo menos 2 caracteres');
      return;
    }
    if (form.roles.length === 0) {
      setError('Selecione pelo menos um papel');
      return;
    }
    mUpsert.mutate({
      id: form.id,
      name: form.name.trim(),
      description: form.description.trim() || null,
      roles: form.roles,
    });
  }

  return (
    <>
      <AdminListPage
        kicker="Administração · Comunicação"
        title="Aliases de papéis"
        subtitle="Conjuntos nomeados de papéis para usar rapidamente em broadcasts"
        backTo="/admin"
        backLabel="Admin"
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" />Novo alias
          </Button>
        }
        searchTerm={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por nome, slug ou descrição…"
        loading={isLoading}
        error={queryError as Error | null}
        isEmpty={!isLoading && filtered.length === 0}
        emptyTitle={search ? 'Nenhum alias casa com a busca' : 'Nenhum alias cadastrado'}
        emptyBody={search ? 'Tente outro termo ou limpe a busca.' : 'Crie aliases pra economizar cliques no compositor de broadcast.'}
        emptyAction={!search && <Button variant="outline" onClick={openNew}><Plus className="h-4 w-4" />Criar o primeiro</Button>}
      >
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Papéis</th>
                <th className="text-right">Membros</th>
                <th>Criado por</th>
                <th>Atualizado</th>
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark/40">
                  <td>
                    <div className="flex items-start gap-2">
                      <Tag className="mt-0.5 h-4 w-4 flex-shrink-0 text-magenta" />
                      <div className="min-w-0">
                        <p className="font-medium dark:text-slate-100">{a.name}</p>
                        <p className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
                          <Hash className="inline h-2.5 w-2.5" />{a.slug}
                        </p>
                        {a.description && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400" title={a.description}>
                            {a.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {a.roles.map((r) => {
                        const opt = ROLE_OPTIONS.find((o) => o.value === r);
                        return <Badge key={r} tone="purple">{opt?.label || r}</Badge>;
                      })}
                    </div>
                  </td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-1 font-mono tabular text-sm font-semibold dark:text-slate-100">
                      <UserCheck className="h-3.5 w-3.5 text-slate-400" />
                      {a.member_count}
                    </span>
                  </td>
                  <td className="text-xs text-slate-500 dark:text-slate-400">
                    {a.created_by_nome || '—'}
                  </td>
                  <td className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    {dtTime(a.updated_at)}
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(a)}
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-navy dark:hover:bg-muted-dark dark:hover:text-purple-300"
                        title="Editar"
                        aria-label={`Editar ${a.name}`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(a)}
                        className="rounded p-1.5 text-slate-500 hover:bg-error/10 hover:text-error"
                        title="Excluir"
                        aria-label={`Excluir ${a.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminListPage>

      {/* Modal de edição */}
      <Modal
        open={open}
        onClose={() => { setOpen(false); setError(null); }}
        title={form.id ? 'Editar alias' : 'Novo alias de papéis'}
        subtitle="Aliases agrupam papéis e ficam disponíveis no compositor de broadcast"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} loading={mUpsert.isPending}>
              {form.id ? 'Salvar alterações' : 'Criar alias'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Nome" required hint="Como vai aparecer no compositor (ex: 'Equipe de medição')">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              maxLength={80}
              placeholder="Equipe de medição"
              className="input"
              autoFocus
            />
          </Field>

          <Field label="Descrição" hint="Opcional — contexto pra outros admins entenderem o uso">
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Time responsável por aprovar medições"
              className="input"
            />
          </Field>

          <Field label="Papéis incluídos" required hint="Membros com qualquer um destes papéis recebem broadcasts deste alias">
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((r) => {
                const isOn = form.roles.includes(r.value);
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => toggleRole(r.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      isOn
                        ? 'border-magenta bg-magenta text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-magenta dark:border-border-dark dark:bg-card-dark dark:text-slate-200'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </Field>

          {error && (
            <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </div>
          )}
        </div>
      </Modal>

      {/* Confirmação de delete */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Excluir alias"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => deleteTarget && mDelete.mutate(deleteTarget.id)}
              loading={mDelete.isPending}
            >
              Excluir definitivamente
            </Button>
          </div>
        }
      >
        {deleteTarget && (
          <p className="text-sm text-slate-700 dark:text-slate-200">
            Confirmar exclusão do alias <strong>{deleteTarget.name}</strong>?
            Broadcasts já enviados continuam intactos — apenas o alias deixa de aparecer no compositor.
          </p>
        )}
      </Modal>
    </>
  );
}
