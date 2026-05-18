import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Save, Briefcase } from 'lucide-react';
import {
  listPrograms, upsertProgram, deleteProgram, type Program,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Field } from '../../components/ui/FormField';
import { AdminListPage } from '../../components/patterns/AdminListPage';

export function AdminPrograms() {
  const qc = useQueryClient();
  const { data: programs = [], isLoading } = useQuery({ queryKey: ['programs'], queryFn: listPrograms });
  const [editing, setEditing] = useState<Program | 'new' | null>(null);
  const [search, setSearch] = useState('');

  const remove = useMutation({
    mutationFn: deleteProgram,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['programs'] }),
  });

  const filtered = search
    ? programs.filter((p) => {
        const q = search.toLowerCase();
        return p.nome.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q) ||
               (p.orgao || '').toLowerCase().includes(q);
      })
    : programs;

  return (
    <AdminListPage
      kicker="Administração · Programas"
      title="Programas"
      subtitle="Programas governamentais ou linhas de financiamento. Contratos vinculados a um programa aparecem agrupados na Visão por programa."
      backTo="/dashboard"
      backLabel="Dashboard"
      actions={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" />Novo programa</Button>}
      searchTerm={search}
      onSearchChange={setSearch}
      searchPlaceholder="Buscar por nome, código ou órgão…"
      loading={isLoading}
      isEmpty={!isLoading && filtered.length === 0}
      emptyTitle={search ? 'Nenhum programa encontrado' : 'Nenhum programa cadastrado'}
      emptyBody={search ? 'Refine o termo da busca.' : 'Cadastre programas para agrupar contratos por linha de financiamento ou objetivo.'}
    >
      <Card className="overflow-hidden">
        <table className="table">
          <thead><tr>
            <th>Código</th><th>Nome</th><th>Órgão</th><th>Fonte</th><th>Status</th><th />
          </tr></thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td className="font-mono text-xs">{p.codigo}</td>
                <td>
                  <div className="font-medium dark:text-slate-100">{p.nome}</div>
                  {p.descricao && <div className="text-xs text-slate-500 truncate max-w-md">{p.descricao}</div>}
                </td>
                <td>{p.orgao || '—'}</td>
                <td>{p.funding_source || '—'}</td>
                <td>{p.active ? <Badge tone="green">Ativo</Badge> : <Badge tone="slate">Inativo</Badge>}</td>
                <td className="text-right">
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={() => setEditing(p)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy dark:hover:bg-muted-dark">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => { if (confirm(`Excluir programa "${p.nome}"?`)) remove.mutate(p.id); }} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-error dark:hover:bg-muted-dark">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {editing && (
        <ProgramEditModal
          program={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['programs'] }); }}
        />
      )}
    </AdminListPage>
  );
}

function ProgramEditModal({ program, onClose, onSaved }: { program: Program | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !program;
  const [codigo, setCodigo] = useState(program?.codigo || '');
  const [nome, setNome] = useState(program?.nome || '');
  const [descricao, setDescricao] = useState(program?.descricao || '');
  const [orgao, setOrgao] = useState(program?.orgao || '');
  const [fundingSource, setFundingSource] = useState(program?.funding_source || '');
  const [active, setActive] = useState(program?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => upsertProgram({
      id: program?.id,
      codigo: codigo.trim().toUpperCase(),
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      orgao: orgao.trim() || null,
      funding_source: fundingSource.trim() || null,
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

  return (
    <Modal
      open onClose={onClose}
      title={isNew ? 'Novo programa' : `Editar ${program!.codigo}`}
      subtitle="Programas agrupam contratos por linha orçamentária, financiamento ou objetivo institucional."
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
          <Field label="Código" required hint="Ex: SAU-2024, EDU-2024">
            <input type="text" value={codigo} onChange={(e) => setCodigo(e.target.value)} className="input font-mono uppercase" maxLength={20} />
          </Field>
          <Field label="Nome" required>
            <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} className="input" />
          </Field>
        </div>
        <Field label="Descrição">
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} className="input min-h-[70px] resize-y" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Órgão responsável" hint="Ex: SES/RJ, SEEDUC/RJ, Prefeitura">
            <input type="text" value={orgao} onChange={(e) => setOrgao(e.target.value)} className="input" />
          </Field>
          <Field label="Fonte de financiamento" hint="Ex: BNDES, FNDE, FNS, próprios">
            <input type="text" value={fundingSource} onChange={(e) => setFundingSource(e.target.value)} className="input" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm dark:text-slate-100">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Programa ativo
        </label>
        {error && <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">{error}</p>}
      </form>
    </Modal>
  );
}
