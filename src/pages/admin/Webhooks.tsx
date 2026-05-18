import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Edit2, Trash2, Webhook as WebhookIcon, Send, History, Check, X,
  Slack as SlackIcon, MessageSquare, Globe, AlertTriangle, CheckCircle2,
  KeyRound, Copy, ShieldCheck, ShieldOff, Code2,
} from 'lucide-react';
import {
  listTenantWebhooks, upsertTenantWebhook, deleteTenantWebhook,
  listWebhookDispatches, testTenantWebhook,
  rotateWebhookSecret, clearWebhookSecret,
  tenantWebhookHealth, healthBucket,
  WEBHOOK_DOMAIN_EVENT_OPTIONS,
  type TenantWebhook, type WebhookKind, type RotateSecretResult, type WebhookEvent,
  type WebhookHealthRow,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { dtTime, relativeTime } from '../../lib/format';
import { AdminListPage } from '../../components/patterns/AdminListPage';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Field, Select } from '../../components/ui/FormField';
import { Card } from '../../components/ui/Card';
import { WebhookPayloadPreview } from '../../components/webhooks/WebhookPayloadPreview';

const KIND_OPTIONS: Array<{ value: WebhookKind; label: string; icon: typeof SlackIcon; hint: string }> = [
  { value: 'slack',   label: 'Slack',    icon: SlackIcon,      hint: 'Incoming Webhook URL (api.slack.com/messaging/webhooks)' },
  { value: 'teams',   label: 'MS Teams', icon: MessageSquare,  hint: 'Connector URL ou Workflows trigger (Office365)' },
  { value: 'generic', label: 'Genérico', icon: Globe,          hint: 'Endpoint HTTP qualquer aceitando POST JSON' },
];

/* Template padrão pra kind=generic — admin pode customizar */
const DEFAULT_GENERIC_TEMPLATE = `{
  "event": "{{event}}",
  "broadcast": {
    "title": "{{broadcast_title}}",
    "body": "{{broadcast_body}}",
    "kind": "{{broadcast_kind}}",
    "total_sent": "{{broadcast_total}}",
    "action": "{{broadcast_action}}"
  },
  "tenant": "{{tenant_name}}",
  "sender": "{{sender_name}}"
}`;

const AVAILABLE_VARS: Array<{ token: string; label: string }> = [
  { token: '{{event}}',            label: "Sempre 'broadcast_sent'" },
  { token: '{{broadcast_id}}',     label: 'UUID do broadcast' },
  { token: '{{broadcast_title}}',  label: 'Título renderizado' },
  { token: '{{broadcast_body}}',   label: 'Corpo renderizado' },
  { token: '{{broadcast_kind}}',   label: 'info / warning / system' },
  { token: '{{broadcast_action}}', label: 'URL absoluta de ação' },
  { token: '{{broadcast_total}}',  label: 'Quantos receberam' },
  { token: '{{broadcast_scope}}',  label: 'Escopo legível' },
  { token: '{{broadcast_created}}', label: 'ISO timestamp' },
  { token: '{{tenant_id}}',        label: 'UUID do tenant' },
  { token: '{{tenant_name}}',      label: 'Nome do tenant' },
  { token: '{{sender_id}}',        label: 'UUID do remetente' },
  { token: '{{sender_name}}',      label: 'Nome do admin' },
];

function KindIcon({ kind }: { kind: WebhookKind }) {
  const def = KIND_OPTIONS.find((o) => o.value === kind);
  const Icon = def?.icon || Globe;
  return <Icon className="h-4 w-4" />;
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30
      ? u.pathname.slice(0, 12) + '…' + u.pathname.slice(-10)
      : u.pathname;
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return url.length > 50 ? url.slice(0, 40) + '…' : url;
  }
}

/* Valida JSON template + retorna lista de unknown tokens */
function validateTemplate(t: string): { valid: boolean; error: string | null; unknownTokens: string[] } {
  if (!t || !t.trim()) return { valid: true, error: null, unknownTokens: [] };
  const known = new Set(AVAILABLE_VARS.map((v) => v.token.slice(2, -2)));
  const tokens = new Set<string>();
  for (const m of t.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g)) {
    if (!known.has(m[1])) tokens.add(m[1]);
  }
  try {
    JSON.parse(t);
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'JSON inválido', unknownTokens: [...tokens] };
  }
  return { valid: true, error: null, unknownTokens: [...tokens] };
}

interface FormState {
  id: string | null;
  label: string;
  kind: WebhookKind;
  url: string;
  secret_hint: string;
  active: boolean;
  payload_template: string;
  events: string[];
  /** V28: 0 = manual (NULL no banco), 30/60/90/180 = rotaciona após N dias */
  auto_rotate_after_days: number;
}

const EMPTY: FormState = {
  id: null, label: '', kind: 'slack', url: '', secret_hint: '', active: true, payload_template: '',
  events: ['broadcast_sent'],
  auto_rotate_after_days: 0,
};

export function AdminWebhooks() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TenantWebhook | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; status: 'ok' | 'error'; message: string } | null>(null);
  const [rotateTarget, setRotateTarget] = useState<TenantWebhook | null>(null);
  const [rotateResult, setRotateResult] = useState<RotateSecretResult | null>(null);
  const [showTemplateHelp, setShowTemplateHelp] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const { data: webhooks = [], isLoading, error: queryError } = useQuery({
    queryKey: ['tenant-webhooks'],
    queryFn: listTenantWebhooks,
  });

  const { data: dispatches = [] } = useQuery({
    queryKey: ['webhook-dispatches'],
    queryFn: () => listWebhookDispatches(50),
  });

  // V29: health score por webhook
  const { data: healthRows = [] } = useQuery({
    queryKey: ['webhook-health'],
    queryFn: tenantWebhookHealth,
    refetchInterval: 60_000,
  });
  const healthById = useMemo(() => {
    const map = new Map<string, WebhookHealthRow>();
    healthRows.forEach((h) => map.set(h.id, h));
    return map;
  }, [healthRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return webhooks;
    return webhooks.filter((w) =>
      w.label.toLowerCase().includes(q) ||
      w.url.toLowerCase().includes(q) ||
      w.kind.toLowerCase().includes(q),
    );
  }, [webhooks, search]);

  const templateValidation = useMemo(
    () => validateTemplate(form.payload_template),
    [form.payload_template],
  );

  const mRotate = useMutation({
    mutationFn: rotateWebhookSecret,
    onSuccess: (data) => {
      setRotateResult(data);
      setRotateTarget(null);
      qc.invalidateQueries({ queryKey: ['tenant-webhooks'] });
    },
    onError: (err) => setError(humanizeError(err)),
  });

  const mClearSecret = useMutation({
    mutationFn: clearWebhookSecret,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-webhooks'] });
    },
  });

  const mUpsert = useMutation({
    mutationFn: upsertTenantWebhook,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-webhooks'] });
      setOpen(false);
      setForm(EMPTY);
      setError(null);
    },
    onError: (err) => setError(humanizeError(err)),
  });

  const mDelete = useMutation({
    mutationFn: deleteTenantWebhook,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-webhooks'] });
      setDeleteTarget(null);
    },
  });

  const mTest = useMutation({
    mutationFn: testTenantWebhook,
    onSuccess: (res, webhook_id) => {
      setTestResult({
        id: webhook_id,
        status: res.status,
        message: res.status === 'ok'
          ? `Resposta HTTP ${res.response_code} — payload entregue.`
          : res.error || 'Falha ao entregar payload',
      });
      qc.invalidateQueries({ queryKey: ['tenant-webhooks'] });
      qc.invalidateQueries({ queryKey: ['webhook-dispatches'] });
    },
    onError: (err) => setTestResult({ id: '', status: 'error', message: humanizeError(err) }),
  });

  function openNew() {
    setForm(EMPTY);
    setError(null);
    setOpen(true);
  }

  function openEdit(w: TenantWebhook) {
    setForm({
      id: w.id,
      label: w.label,
      kind: w.kind,
      url: w.url,
      secret_hint: w.secret_hint || '',
      active: w.active,
      payload_template: w.payload_template || '',
      events: (w.events && w.events.length > 0) ? w.events : ['broadcast_sent'],
      auto_rotate_after_days: w.auto_rotate_after_days ?? 0,
    });
    setError(null);
    setOpen(true);
  }

  function submit() {
    if (form.label.trim().length < 2) { setError('Rótulo precisa de pelo menos 2 caracteres'); return; }
    if (!/^https?:\/\//.test(form.url.trim())) { setError('URL deve começar com http:// ou https://'); return; }
    if (form.events.length === 0) { setError('Selecione pelo menos um evento'); return; }
    if (form.kind === 'generic' && form.payload_template.trim() && !templateValidation.valid) {
      setError(`Template JSON inválido: ${templateValidation.error}`);
      return;
    }
    mUpsert.mutate({
      id: form.id,
      label: form.label.trim(),
      kind: form.kind,
      url: form.url.trim(),
      secret_hint: form.secret_hint.trim() || null,
      events: form.events as WebhookEvent[],
      active: form.active,
      payload_template: form.kind === 'generic' ? (form.payload_template.trim() || null) : null,
      auto_rotate_after_days: form.auto_rotate_after_days > 0 ? form.auto_rotate_after_days : null,
    });
  }

  function toggleEvent(ev: string) {
    setForm((f) => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter((x) => x !== ev) : [...f.events, ev],
    }));
  }

  return (
    <>
      <AdminListPage
        kicker="Administração · Integrações"
        title="Webhooks de saída"
        subtitle="Encaminhe broadcasts para Slack, Microsoft Teams ou qualquer endpoint HTTP"
        backTo="/admin"
        backLabel="Admin"
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" />Novo webhook
          </Button>
        }
        searchTerm={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por rótulo, URL ou tipo…"
        loading={isLoading}
        error={queryError as Error | null}
        isEmpty={!isLoading && filtered.length === 0}
        emptyTitle={search ? 'Nenhum webhook casa com a busca' : 'Nenhum webhook configurado'}
        emptyBody={search ? 'Tente outro termo.' : 'Configure webhooks pra mirror broadcasts em canais externos.'}
        emptyAction={!search && <Button variant="outline" onClick={openNew}><Plus className="h-4 w-4" />Criar o primeiro</Button>}
      >
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Rótulo</th>
                <th className="hidden md:table-cell">Destino</th>
                <th className="hidden lg:table-cell text-center">Assinatura</th>
                <th className="text-center">Status</th>
                <th className="hidden lg:table-cell">Último disparo</th>
                <th className="w-40">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr key={w.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark/40">
                  <td>
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full ${
                        w.kind === 'slack' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-200' :
                        w.kind === 'teams' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200' :
                                              'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                      }`}>
                        <KindIcon kind={w.kind} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate font-medium dark:text-slate-100">{w.label}</p>
                          {(() => {
                            const h = healthById.get(w.id);
                            if (!h) return null;
                            const bucket = healthBucket(h.health_score);
                            const toneClass =
                              bucket.tone === 'green'  ? 'bg-success/15 text-success' :
                              bucket.tone === 'yellow' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200' :
                                                          'bg-error/15 text-error';
                            const tip =
                              h.dispatch_count === 0 ? 'Nunca disparado' :
                              `${h.dispatch_count} disparos · ${h.error_count} erros · ${(h.error_rate * 100).toFixed(0)}% erro` +
                              (h.dead_letter_for_events > 0 ? ` · ${h.dead_letter_for_events} em dead-letter` : '');
                            return (
                              <span
                                className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-display ${toneClass}`}
                                title={tip}
                              >
                                {h.health_score}
                              </span>
                            );
                          })()}
                        </div>
                        <p className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
                          {KIND_OPTIONS.find((o) => o.value === w.kind)?.label}
                          {w.kind === 'generic' && w.payload_template && (
                            <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-purple-100 px-1 text-[9px] uppercase text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">
                              <Code2 className="h-2 w-2" />Custom
                            </span>
                          )}
                        </p>
                        {/* V29 mobile: surfacing URL + último disparo pois colunas estão escondidas */}
                        <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500 md:hidden" title={w.url}>
                          {maskUrl(w.url)}
                        </p>
                        {w.last_called_at && (
                          <p className="font-mono text-[10px] text-slate-500 lg:hidden">
                            Último: {relativeTime(w.last_called_at)} ·{' '}
                            {w.last_status === 'ok' ? (
                              <span className="text-success">HTTP {w.last_response_code}</span>
                            ) : (
                              <span className="text-error">{w.last_status}</span>
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="hidden md:table-cell max-w-md">
                    <code className="font-mono text-xs text-slate-600 dark:text-slate-300" title={w.url}>
                      {maskUrl(w.url)}
                    </code>
                    <p className="font-mono text-[10px] text-slate-400">
                      {w.events.join(' · ')}
                    </p>
                  </td>
                  <td className="hidden lg:table-cell text-center">
                    {w.has_signing_secret ? (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success"
                        title={w.secret_rotated_at ? `Rotacionado ${relativeTime(w.secret_rotated_at)}` : 'HMAC ativo'}
                      >
                        <ShieldCheck className="h-3 w-3" />Assinado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400">
                        <ShieldOff className="h-3 w-3" />sem HMAC
                      </span>
                    )}
                  </td>
                  <td className="text-center">
                    {w.active
                      ? <Badge tone="green"><Check className="mr-0.5 inline h-3 w-3" />Ativo</Badge>
                      : <Badge tone="slate"><X className="mr-0.5 inline h-3 w-3" />Pausado</Badge>}
                  </td>
                  <td className="hidden lg:table-cell">
                    {w.last_called_at ? (
                      <div className="text-xs">
                        <p className="dark:text-slate-200">{relativeTime(w.last_called_at)}</p>
                        <p className="font-mono text-[10px] text-slate-500">
                          {w.last_status === 'ok' ? (
                            <span className="text-success">HTTP {w.last_response_code}</span>
                          ) : (
                            <span className="text-error">{w.last_status} {w.last_response_code || ''}</span>
                          )}
                          {' · '}
                          {w.dispatch_count} total · {w.error_count} erros
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">Nunca disparado</span>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => mTest.mutate(w.id)}
                        disabled={mTest.isPending}
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-magenta dark:hover:bg-muted-dark"
                        title="Enviar payload de teste"
                        aria-label={`Testar ${w.label}`}
                      >
                        <Send className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRotateTarget(w)}
                        className="rounded p-1.5 text-slate-500 hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-900/30"
                        title={w.has_signing_secret ? 'Rotacionar segredo HMAC' : 'Gerar segredo HMAC'}
                        aria-label={`Rotacionar segredo de ${w.label}`}
                      >
                        <KeyRound className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(w)}
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-navy dark:hover:bg-muted-dark dark:hover:text-purple-300"
                        title="Editar"
                        aria-label={`Editar ${w.label}`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(w)}
                        className="rounded p-1.5 text-slate-500 hover:bg-error/10 hover:text-error"
                        title="Excluir"
                        aria-label={`Excluir ${w.label}`}
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

        {/* Histórico de disparos */}
        {dispatches.length > 0 && (
          <Card className="mt-4 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 dark:border-border-dark">
              <History className="h-4 w-4 text-slate-500" />
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                  Histórico
                </p>
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">Disparos recentes</h2>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Webhook</th>
                    <th>Evento</th>
                    <th>Status</th>
                    <th className="max-w-md">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatches.slice(0, 30).map((d) => (
                    <tr key={d.id}>
                      <td className="font-mono text-xs text-slate-500 dark:text-slate-400">{dtTime(d.attempted_at)}</td>
                      <td>
                        <p className="text-sm dark:text-slate-200">{d.webhook_label}</p>
                        <p className="font-mono text-[10px] uppercase tracking-display text-slate-400">{d.webhook_kind}</p>
                      </td>
                      <td><Badge tone={d.event.includes('test') ? 'slate' : 'blue'}>{d.event}</Badge></td>
                      <td>
                        {d.status === 'ok' ? (
                          <Badge tone="green">HTTP {d.response_code}</Badge>
                        ) : (
                          <Badge tone="red">{d.status} {d.response_code || ''}</Badge>
                        )}
                      </td>
                      <td className="max-w-md">
                        {d.error_text && (
                          <p className="line-clamp-1 font-mono text-xs text-error" title={d.error_text}>
                            {d.error_text}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </AdminListPage>

      {/* Modal Edit */}
      <Modal
        open={open}
        onClose={() => { setOpen(false); setError(null); }}
        title={form.id ? 'Editar webhook' : 'Novo webhook'}
        subtitle="Encaminha broadcasts disparados pelos admins do tenant"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} loading={mUpsert.isPending}>
              {form.id ? 'Salvar' : 'Criar webhook'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Rótulo" required hint="Apenas para identificação interna (ex: 'Slack #operações')">
            <input
              type="text"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              maxLength={80}
              placeholder="Slack #operações"
              className="input"
              autoFocus
            />
          </Field>

          <Field label="Destino" required>
            <Select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as WebhookKind })}
              options={KIND_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {KIND_OPTIONS.find((o) => o.value === form.kind)?.hint}
            </p>
          </Field>

          <Field label="URL do webhook" required hint="Será mascarada após salvar — guarde em local seguro se precisar consultar depois">
            <input
              type="url"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder={form.kind === 'slack' ? 'https://hooks.slack.com/services/T0000/B0000/abc' :
                          form.kind === 'teams' ? 'https://outlook.office.com/webhook/...' :
                                                  'https://exemplo.com/webhook'}
              className="input font-mono text-xs"
            />
          </Field>

          <Field label="Eventos inscritos" required hint="Webhook recebe POST quando estes eventos acontecem no tenant">
            <div className="space-y-3">
              {(['communication', 'risk', 'contract', 'operations'] as const).map((group) => {
                const items = WEBHOOK_DOMAIN_EVENT_OPTIONS.filter((o) => o.group === group);
                if (items.length === 0) return null;
                const groupLabel =
                  group === 'communication' ? 'Comunicação' :
                  group === 'risk'          ? 'Risco' :
                  group === 'contract'      ? 'Contrato (operação)' :
                                              'Operação interna';
                return (
                  <div key={group}>
                    <p className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                      {groupLabel}
                    </p>
                    <div className="space-y-1.5">
                      {items.map((opt) => {
                        const isOn = form.events.includes(opt.value);
                        return (
                          <label
                            key={opt.value}
                            className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition ${
                              isOn
                                ? 'border-magenta/50 bg-magenta/5 dark:border-magenta/40'
                                : 'border-slate-200 hover:border-slate-300 dark:border-border-dark dark:hover:border-slate-600'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isOn}
                              onChange={() => toggleEvent(opt.value)}
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-magenta focus:ring-magenta"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium dark:text-slate-200">{opt.label}</p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">{opt.description}</p>
                              <code className="font-mono text-[9px] uppercase tracking-display text-slate-400">{opt.value}</code>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Field>

          {/* Preview do payload de exemplo (V27) */}
          {form.events.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-3 dark:border-border-dark dark:bg-muted-dark/30">
              <WebhookPayloadPreview
                selectedEvents={form.events}
                kind={form.kind}
                hasCustomTemplate={form.kind === 'generic' && form.payload_template.trim().length > 0}
              />
            </div>
          )}

          <Field label="Dica de identificação" hint="Opcional — últimos chars do token ou nome do canal (ex: '…abc · #ops')">
            <input
              type="text"
              value={form.secret_hint}
              onChange={(e) => setForm({ ...form, secret_hint: e.target.value })}
              maxLength={60}
              placeholder="#operacoes"
              className="input"
            />
          </Field>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-border-dark dark:bg-muted-dark">
            <div>
              <p className="text-sm font-medium dark:text-slate-200">Webhook ativo</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Pausado: não recebe novos disparos (configuração preservada)
              </p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                className="peer sr-only"
              />
              <div className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-magenta dark:bg-slate-600" />
              <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
            </label>
          </div>

          {/* V28: rotação automática de signing secret */}
          <Field
            label="Rotação automática do signing secret"
            hint="Quando há signing_secret, rotaciona após N dias. Admin recebe notificação com o novo secret (uma única vez)."
          >
            <Select
              value={String(form.auto_rotate_after_days)}
              onChange={(e) => setForm({ ...form, auto_rotate_after_days: Number(e.target.value) })}
              options={[
                { value: '0',   label: 'Manual apenas (sem rotação automática)' },
                { value: '30',  label: 'A cada 30 dias' },
                { value: '60',  label: 'A cada 60 dias' },
                { value: '90',  label: 'A cada 90 dias' },
                { value: '180', label: 'A cada 180 dias' },
              ]}
            />
          </Field>

          {/* Payload template (kind=generic only) */}
          {form.kind === 'generic' && (
            <Field
              label="Payload customizado (opcional)"
              hint="JSON com placeholders. Deixe vazio para usar o payload padrão."
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowTemplateHelp((v) => !v)}
                    className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-display text-slate-500 hover:text-magenta"
                  >
                    <Code2 className="h-3 w-3" />
                    {showTemplateHelp ? 'Esconder' : 'Variáveis disponíveis'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, payload_template: DEFAULT_GENERIC_TEMPLATE })}
                    className="font-mono text-[10px] uppercase tracking-display text-slate-500 hover:text-navy"
                  >
                    Inserir exemplo
                  </button>
                </div>

                {showTemplateHelp && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-border-dark dark:bg-muted-dark">
                    <div className="grid gap-1 sm:grid-cols-2">
                      {AVAILABLE_VARS.map((v) => (
                        <button
                          key={v.token}
                          type="button"
                          onClick={() => navigator.clipboard.writeText(v.token)}
                          title="Clique para copiar"
                          className="flex items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-white dark:hover:bg-card-dark"
                        >
                          <code className="font-mono text-[10px] text-magenta-700 dark:text-magenta-200">
                            {v.token}
                          </code>
                          <span className="flex-1 text-[10px] text-slate-600 dark:text-slate-300">{v.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <textarea
                  value={form.payload_template}
                  onChange={(e) => setForm({ ...form, payload_template: e.target.value })}
                  rows={8}
                  spellCheck={false}
                  placeholder='{"event": "{{event}}", "title": "{{broadcast_title}}"}'
                  className="input font-mono text-xs"
                />

                {form.payload_template.trim() && !templateValidation.valid && (
                  <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[11px] text-error">
                    <AlertTriangle className="mr-1 inline h-3 w-3" />
                    JSON inválido: <span className="font-mono">{templateValidation.error}</span>
                  </div>
                )}
                {form.payload_template.trim() && templateValidation.valid && templateValidation.unknownTokens.length > 0 && (
                  <div className="rounded-lg border border-amber-300/40 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/15 dark:text-amber-100">
                    <AlertTriangle className="mr-1 inline h-3 w-3" />
                    Variáveis desconhecidas (ficarão vazias):{' '}
                    <span className="font-mono">{templateValidation.unknownTokens.map((t) => `{{${t}}}`).join(' · ')}</span>
                  </div>
                )}
                {form.payload_template.trim() && templateValidation.valid && templateValidation.unknownTokens.length === 0 && (
                  <p className="font-mono text-[10px] uppercase tracking-display text-success">
                    <CheckCircle2 className="mr-0.5 inline h-3 w-3" />JSON válido
                  </p>
                )}
              </div>
            </Field>
          )}

          {error && (
            <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </div>
          )}
        </div>
      </Modal>

      {/* Confirma delete */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Excluir webhook"
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
            Confirmar exclusão de <strong>{deleteTarget.label}</strong>?
            O histórico de disparos também será apagado.
          </p>
        )}
      </Modal>

      {/* Resultado do teste */}
      <Modal
        open={!!testResult}
        onClose={() => setTestResult(null)}
        title="Resultado do teste"
        size="sm"
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setTestResult(null)}>Entendi</Button>
          </div>
        }
      >
        {testResult && (
          <div className={`rounded-lg border px-3 py-3 text-sm ${
            testResult.status === 'ok'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-error/30 bg-error/10 text-error'
          }`}>
            <div className="flex items-start gap-2">
              {testResult.status === 'ok'
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
                : <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />}
              <div>
                <p className="font-semibold">
                  {testResult.status === 'ok' ? 'Payload entregue' : 'Falha no envio'}
                </p>
                <p className="mt-0.5 text-xs">{testResult.message}</p>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirma rotação de segredo */}
      <Modal
        open={!!rotateTarget}
        onClose={() => setRotateTarget(null)}
        title={rotateTarget?.has_signing_secret ? 'Rotacionar segredo HMAC' : 'Ativar assinatura HMAC'}
        subtitle={rotateTarget?.label}
        size="md"
        footer={
          <div className="flex justify-between gap-2">
            <div>
              {rotateTarget?.has_signing_secret && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (rotateTarget) mClearSecret.mutate(rotateTarget.id);
                    setRotateTarget(null);
                  }}
                >
                  <ShieldOff className="h-4 w-4" />Remover assinatura
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setRotateTarget(null)}>Cancelar</Button>
              <Button
                onClick={() => rotateTarget && mRotate.mutate(rotateTarget.id)}
                loading={mRotate.isPending}
              >
                {rotateTarget?.has_signing_secret ? 'Gerar novo segredo' : 'Ativar assinatura'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          {rotateTarget?.has_signing_secret && (
            <div className="rounded-lg border border-amber-300/40 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/15 dark:text-amber-100">
              <AlertTriangle className="mr-1 inline h-3 w-3" />
              Ao rotacionar, o segredo anterior <strong>deixa de funcionar imediatamente</strong>.
              Atualize seu consumidor com o novo valor antes dos próximos disparos.
            </div>
          )}
          <p className="text-slate-700 dark:text-slate-200">
            geoCon enviará header <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-muted-dark">X-Consultegeo-Signature: sha256=&lt;hex&gt;</code>{' '}
            calculado como HMAC-SHA256 do body JSON usando o segredo.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            O segredo será mostrado <strong>uma única vez</strong> — copie pra um lugar seguro logo após gerar.
            Persistimos apenas a dica (últimos 4 chars) pra identificação visual.
          </p>
          <p className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
            Exemplo de verificação (Node.js):
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-2 font-mono text-[10px] leading-relaxed text-slate-100">
{`const expected = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
const received = req.headers['x-consultegeo-signature'].replace('sha256=', '');
if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received)))
  throw new Error('Bad signature');`}
          </pre>
        </div>
      </Modal>

      {/* Segredo recém-rotacionado (write-once-read-once) */}
      <Modal
        open={!!rotateResult}
        onClose={() => setRotateResult(null)}
        title="Segredo gerado — copie agora"
        subtitle="Após fechar este modal, o segredo não poderá ser visto novamente"
        size="md"
        footer={
          <div className="flex justify-end">
            <Button
              onClick={() => setRotateResult(null)}
              variant={copiedSecret ? 'primary' : 'outline'}
            >
              {copiedSecret ? 'Já copiei e armazenei' : 'Fechar sem copiar'}
            </Button>
          </div>
        }
      >
        {rotateResult && (
          <div className="space-y-3">
            <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
              <AlertTriangle className="mr-1 inline h-3 w-3" />
              <strong>Cole agora.</strong> Não persistimos o valor — só uma dica (últimos chars).
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2.5">
              <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-emerald-300">
                {rotateResult.secret}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(rotateResult.secret);
                  setCopiedSecret(true);
                  setTimeout(() => setCopiedSecret(false), 3000);
                }}
                className="rounded p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
                title="Copiar"
                aria-label="Copiar segredo"
              >
                {copiedSecret ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
              Dica persistida: <span className="text-slate-700 dark:text-slate-300">{rotateResult.hint}</span>
            </p>

            {/* V27: Replay protection guidance */}
            <details className="rounded-lg border border-slate-200 bg-slate-50/60 dark:border-border-dark dark:bg-muted-dark/40">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                Como verificar no destinatário (replay protection)
              </summary>
              <div className="space-y-2 border-t border-slate-200 px-3 py-3 dark:border-border-dark">
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  Cada request inclui dois headers:
                </p>
                <ul className="ml-3 list-disc space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <li><code className="font-mono">X-Consultegeo-Signature: sha256=&lt;hex&gt;</code></li>
                  <li><code className="font-mono">X-Consultegeo-Timestamp: &lt;ISO 8601&gt;</code></li>
                </ul>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  Para mitigar replay attacks, rejeite requests onde o timestamp está fora de uma janela de tolerância
                  (recomendado: <strong>±5 minutos</strong>). Exemplo em Node.js:
                </p>
                <pre className="overflow-x-auto rounded-md border border-slate-300 bg-slate-900 p-2 font-mono text-[10px] text-emerald-300 dark:border-slate-700">
{`const sig = req.headers['x-consultegeo-signature'];
const ts  = req.headers['x-consultegeo-timestamp'];

// 1. Janela de timestamp (replay protection)
const ageMs = Date.now() - new Date(ts).getTime();
if (Math.abs(ageMs) > 5 * 60 * 1000) {
  return res.status(401).send('Timestamp fora da janela');
}

// 2. Verificar HMAC
const expected = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(rawBody)   // body cru, antes de parsing JSON
  .digest('hex');

const provided = (sig || '').replace(/^sha256=/, '');
const ok = crypto.timingSafeEqual(
  Buffer.from(provided, 'hex'),
  Buffer.from(expected, 'hex'),
);
if (!ok) return res.status(401).send('Assinatura inválida');`}
                </pre>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  Use <code className="font-mono">timingSafeEqual</code> em vez de <code className="font-mono">===</code> pra evitar timing attacks.
                </p>
              </div>
            </details>
          </div>
        )}
      </Modal>
    </>
  );
}
