import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookMarked, Plus, Pencil, Trash2, Share2, Lock, Save, ChevronDown, Check, X,
} from 'lucide-react';
import {
  listBroadcastTemplates, upsertBroadcastTemplate, deleteBroadcastTemplate,
  type BroadcastTemplate,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/FormField';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Skeleton, Empty } from '../ui/Stat';

/* Snapshot serializável do estado atual do compositor (passado pelo pai) */
export interface BroadcastDraft {
  title: string;
  body: string;
  kind: string;
  action_url?: string;
  filter_roles?: string[];
  filter_contract_id?: string;
  filter_member_ids?: string[];
  email_also: boolean;
}

interface Props {
  /** Estado atual do compositor — usado pelo botão "Salvar como template" */
  currentDraft: BroadcastDraft;
  /** Chamado quando admin clica para aplicar um template */
  onApply: (t: BroadcastTemplate) => void;
}

export function BroadcastTemplatesPanel({ currentDraft, onApply }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BroadcastTemplate | 'new' | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['broadcast-templates'],
    queryFn: listBroadcastTemplates,
  });

  const remove = useMutation({
    mutationFn: deleteBroadcastTemplate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['broadcast-templates'] }),
  });

  const recentTemplates = templates.slice(0, 8);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-border-dark dark:bg-muted-dark">
        <div className="flex items-center gap-2">
          <BookMarked className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-medium dark:text-slate-200">Templates</span>
          <span className="text-xs text-slate-500">
            {templates.length} {templates.length === 1 ? 'salvo' : 'salvos'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            Carregar
            <ChevronDown className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Save className="h-3.5 w-3.5" />Salvar como template
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-border-dark dark:bg-card-dark">
          {isLoading && <Skeleton className="m-3 h-24" />}
          {!isLoading && templates.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              Nenhum template salvo. Use "Salvar como template" após compor uma mensagem.
            </p>
          )}
          {!isLoading && templates.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-border-dark">
              {recentTemplates.map((t) => (
                <li key={t.id} className="group flex items-start gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-muted-dark/40">
                  <button
                    type="button"
                    onClick={() => { onApply(t); setOpen(false); }}
                    className="flex-1 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium dark:text-slate-100">{t.nome}</span>
                      {t.is_shared
                        ? <Share2 className="h-3 w-3 text-purple-500" aria-label="Compartilhado" />
                        : <Lock className="h-3 w-3 text-slate-400" aria-label="Privado" />}
                      {t.kind !== 'info' && (
                        <Badge tone={t.kind === 'system' ? 'red' : 'yellow'}>
                          {t.kind === 'system' ? 'Urgente' : 'Atenção'}
                        </Badge>
                      )}
                      {!t.is_owner && (
                        <span className="font-mono text-[10px] uppercase tracking-display text-slate-400">
                          por {t.owner_nome?.split(' ')[0] || 'outro admin'}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                      {t.title}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-display text-slate-400">
                      {t.uses_count > 0 ? `${t.uses_count} usos` : 'nunca usado'}
                      {t.default_contract_numero && ` · contrato ${t.default_contract_numero}`}
                      {t.default_filter_roles?.length ? ` · ${t.default_filter_roles.length} papéis` : ''}
                    </p>
                  </button>
                  {t.is_owner && (
                    <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => setEditing(t)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-navy dark:hover:bg-muted-dark"
                        aria-label="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Excluir template "${t.nome}"?`)) remove.mutate(t.id);
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-error dark:hover:bg-muted-dark"
                        aria-label="Excluir"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && (
        <TemplateEditModal
          template={editing === 'new' ? null : editing}
          currentDraft={currentDraft}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['broadcast-templates'] }); }}
        />
      )}
    </>
  );
}

function TemplateEditModal({
  template, currentDraft, onClose, onSaved,
}: {
  template: BroadcastTemplate | null;
  currentDraft: BroadcastDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !template;
  // Quando criando novo: pré-preenche título/body do compositor; nome em branco
  const initial = template || {
    nome: '',
    title: currentDraft.title || '',
    body: currentDraft.body || '',
    kind: currentDraft.kind || 'info',
    action_url: currentDraft.action_url || '',
    default_filter_roles: currentDraft.filter_roles || null,
    default_filter_contract_id: currentDraft.filter_contract_id || null,
    default_filter_member_ids: currentDraft.filter_member_ids || null,
    default_email_also: currentDraft.email_also || false,
    is_shared: false,
  };

  const [nome, setNome] = useState(initial.nome);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [kind, setKind] = useState(initial.kind);
  const [actionUrl, setActionUrl] = useState(initial.action_url || '');
  const [isShared, setIsShared] = useState(initial.is_shared);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => upsertBroadcastTemplate({
      id: template?.id || null,
      nome: nome.trim(),
      title: title.trim(),
      body: body.trim(),
      kind,
      action_url: actionUrl.trim() || null,
      default_filter_roles: template?.default_filter_roles || initial.default_filter_roles,
      default_filter_contract_id: template?.default_filter_contract_id || initial.default_filter_contract_id,
      default_filter_member_ids: template?.default_filter_member_ids || initial.default_filter_member_ids,
      default_email_also: template?.default_email_also ?? initial.default_email_also,
      is_shared: isShared,
    }),
    onSuccess: onSaved,
    onError: (e) => setError(humanizeError(e as Error)),
  });

  const canSave = nome.trim().length >= 2 && title.trim().length >= 3 && body.trim().length >= 5;

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Salvar como template' : 'Editar template'}
      subtitle={isNew ? 'O template guarda título, mensagem, filtros atuais e flag de e-mail' : undefined}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!canSave}>
            <Save className="h-4 w-4" />{isNew ? 'Salvar' : 'Atualizar'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Nome do template" required hint="Como vai aparecer na lista. Ex: 'Aviso de manutenção'">
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={80}
            className="input"
            placeholder="Aviso de manutenção"
          />
        </Field>

        <Field label="Título da mensagem" required>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            className="input"
          />
        </Field>

        <Field label="Corpo da mensagem" required>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={500}
            className="input"
          />
        </Field>

        <Field label="Link de ação (opcional)">
          <input
            type="text"
            value={actionUrl}
            onChange={(e) => setActionUrl(e.target.value)}
            className="input"
            placeholder="/contratos/abc-123"
          />
        </Field>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-border-dark dark:bg-muted-dark">
          <div className="flex items-start gap-2.5">
            {isShared ? <Share2 className="mt-0.5 h-4 w-4 text-purple-500" /> : <Lock className="mt-0.5 h-4 w-4 text-slate-500" />}
            <div>
              <p className="text-sm font-medium dark:text-slate-200">
                {isShared ? 'Compartilhado com outros admins' : 'Privado (só você)'}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Templates compartilhados aparecem para todos os administradores do tenant.
              </p>
            </div>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="peer sr-only"
            />
            <div className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-purple dark:bg-slate-600" />
            <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
          </label>
        </div>

        {isNew && (
          <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            <Check className="mr-1 inline h-3 w-3" />
            Os filtros atuais (papéis, contrato, membros) e o flag "enviar por e-mail" serão salvos junto com o template.
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 p-2 text-sm text-error dark:bg-red-900/20">{error}</p>
        )}
      </div>
    </Modal>
  );
}
