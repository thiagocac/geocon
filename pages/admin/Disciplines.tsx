import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Save, Library } from 'lucide-react';
import {
  listDisciplines, upsertDiscipline, deleteDiscipline, type Discipline,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Field } from '../../components/ui/FormField';
import { Empty, Skeleton } from '../../components/ui/Stat';

export function AdminDisciplines() {
  const qc = useQueryClient();
  const { data: disciplines = [], isLoading } = useQuery({ queryKey: ['disciplines'], queryFn: listDisciplines });
  const [editing, setEditing] = useState<Discipline | 'new' | null>(null);

  const remove = useMutation({
    mutationFn: deleteDiscipline,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['disciplines'] }),
  });

  const corporativas = disciplines.filter((d) => d.corporativa);
  const locais = disciplines.filter((d) => !d.corporativa);

  return (
    <Layout>
      <PageHeader
        kicker="Administração · Disciplinas"
        title="Disciplinas"
        subtitle="Biblioteca corporativa de disciplinas reutilizáveis em contratos, planilhas SOV, EAP e GED."
        backTo="/dashboard" backLabel="Dashboard"
        actions={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" />Nova disciplina</Button>}
      />

      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}
      {!isLoading && disciplines.length === 0 && (
        <Empty title="Nenhuma disciplina cadastrada" body="Cadastre as disciplinas que serão usadas nos contratos." />
      )}

      {disciplines.length > 0 && (
        <div className="space-y-4">
          {corporativas.length > 0 && (
            <DisciplineSection
              title="Corporativas"
              subtitle="Disciplinas reutilizadas em toda a organização. Mude o status para tornar uma disciplina apenas local de um contrato específico."
              disciplines={corporativas}
              onEdit={setEditing}
              onRemove={(id, nome) => { if (confirm(`Excluir disciplina "${nome}"?`)) remove.mutate(id); }}
            />
          )}
          {locais.length > 0 && (
            <DisciplineSection
              title="Locais"
              subtitle="Disciplinas específicas (não corporativas)."
              disciplines={locais}
              onEdit={setEditing}
              onRemove={(id, nome) => { if (confirm(`Excluir disciplina "${nome}"?`)) remove.mutate(id); }}
            />
          )}
        </div>
      )}

      {editing && (
        <DisciplineEditModal
          discipline={editing === 'new' ? null : editing}
          nextOrdem={(disciplines[disciplines.length - 1]?.ordem || 0) + 1}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['disciplines'] }); }}
        />
      )}
    </Layout>
  );
}

function DisciplineSection({ title, subtitle, disciplines, onEdit, onRemove }: {
  title: string;
  subtitle?: string;
  disciplines: Discipline[];
  onEdit: (d: Discipline) => void;
  onRemove: (id: string, nome: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <header className="border-b border-slate-100 px-5 py-3 dark:border-border-dark">
        <h2 className="font-semibold dark:text-slate-100">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </header>
      <ul className="divide-y divide-slate-100 dark:divide-border-dark">
        {disciplines.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-5 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple/10 dark:bg-purple/20">
              <span className="font-mono text-xs font-bold text-purple dark:text-purple-300">{d.codigo}</span>
            </div>
            <div className="flex-1">
              <div className="font-medium dark:text-slate-100">{d.nome}</div>
              <div className="text-xs text-slate-500">
                Ordem {d.ordem} · {d.corporativa ? 'corporativa' : 'local'}
              </div>
            </div>
            <button type="button" onClick={() => onEdit(d)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy dark:hover:bg-muted-dark">
              <Pencil className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => onRemove(d.id, d.nome)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-error dark:hover:bg-muted-dark">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DisciplineEditModal({ discipline, nextOrdem, onClose, onSaved }: {
  discipline: Discipline | null;
  nextOrdem: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !discipline;
  const [codigo, setCodigo] = useState(discipline?.codigo || '');
  const [nome, setNome] = useState(discipline?.nome || '');
  const [corporativa, setCorporativa] = useState(discipline?.corporativa ?? true);
  const [ordem, setOrdem] = useState<number>(discipline?.ordem ?? nextOrdem);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => upsertDiscipline({
      id: discipline?.id,
      codigo: codigo.trim().toUpperCase(),
      nome: nome.trim(),
      corporativa,
      ordem: Number(ordem) || 0,
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
      title={isNew ? 'Nova disciplina' : `Editar ${discipline!.nome}`}
      subtitle="Disciplinas são categorias técnicas reutilizáveis."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={save.isPending}><Save className="h-4 w-4" />Salvar</Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <Field label="Código" required hint="3-4 letras maiúsculas">
            <input type="text" value={codigo} onChange={(e) => setCodigo(e.target.value)} className="input font-mono uppercase" maxLength={5} />
          </Field>
          <Field label="Nome" required>
            <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} className="input" placeholder="Ex: Arquitetura" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ordem">
            <input type="number" value={ordem} onChange={(e) => setOrdem(Number(e.target.value))} className="input" min={0} />
          </Field>
          <label className="mt-7 flex items-center gap-2 text-sm dark:text-slate-100">
            <input type="checkbox" checked={corporativa} onChange={(e) => setCorporativa(e.target.checked)} />
            Disciplina corporativa
          </label>
        </div>
        {error && <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">{error}</p>}
      </form>
    </Modal>
  );
}
