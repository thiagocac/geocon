import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Megaphone, Send, Users, Filter, CheckCircle2, AlertCircle, Info, Mail,
  ChevronDown, History, ExternalLink, X, Building2, Download, UserCheck, BookMarked, Link2, Copy,
  Tag, Webhook as WebhookIcon,
} from 'lucide-react';
import {
  previewBroadcastRecipients, bulkSendNotification, listBroadcastsHistory, dispatchBroadcastEmails,
  listContractsLite, listAvailableMembers, recordBroadcastTemplateUse,
  listRoleAliases, dispatchBroadcastWebhooks,
  type BroadcastPreview, type BroadcastHistoryRow, type BroadcastEmailStats, type BroadcastTemplate,
  type WebhookDispatchResult,
} from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { humanizeError } from '../../lib/errors';
import { dtTime } from '../../lib/format';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Field, Select } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { Skeleton, Empty } from '../../components/ui/Stat';
import { Badge } from '../../components/ui/Badge';
import { MemberPicker } from '../../components/ui/MemberPicker';
import { BroadcastTemplatesPanel } from '../../components/notifications/BroadcastTemplatesPanel';
import { BroadcastRenderedPreview } from '../../components/notifications/BroadcastRenderedPreview';

/* Catálogo de papéis do produto — usado no filtro */
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

const KIND_OPTIONS = [
  { value: 'info',    label: 'Informativo' },
  { value: 'warning', label: 'Atenção' },
  { value: 'system',  label: 'Sistema (urgente)' },
];

type Scope = 'all' | 'role' | 'contract' | 'members';

/* Variáveis disponíveis no template. Documentadas inline na UI. */
const TEMPLATE_VARS: Array<{ token: string; label: string; scope: 'global' | 'email' | 'contract' }> = [
  { token: '{{tenant_name}}',     label: 'Nome do tenant',                 scope: 'global' },
  { token: '{{sender_name}}',     label: 'Nome do admin que envia',        scope: 'global' },
  { token: '{{sender_first}}',    label: 'Primeiro nome do admin',         scope: 'global' },
  { token: '{{today}}',           label: 'Data atual (DD/MM/AAAA)',        scope: 'global' },
  { token: '{{today_long}}',      label: 'Data por extenso em pt-BR',      scope: 'global' },
  { token: '{{contract_numero}}', label: 'Número do contrato',             scope: 'contract' },
  { token: '{{contract_objeto}}', label: 'Objeto do contrato',             scope: 'contract' },
  { token: '{{user_name}}',       label: 'Nome do destinatário (só e-mail)', scope: 'email' },
  { token: '{{user_first}}',      label: 'Primeiro nome do destinatário',  scope: 'email' },
];

export function AdminBroadcast() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { member } = useAuth();

  // Form state
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('info');
  const [actionUrl, setActionUrl] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [roles, setRoles] = useState<string[]>([]);
  const [contractId, setContractId] = useState<string>('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [emailAlso, setEmailAlso] = useState(false);
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null);

  // UI state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentResult, setSentResult] = useState<{
    total: number;
    emailStats?: BroadcastEmailStats;
    emailError?: string;
    webhookResult?: WebhookDispatchResult;
  } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [varsHelpOpen, setVarsHelpOpen] = useState(false);
  const [aliasResolved, setAliasResolved] = useState(false);

  // Hot-link: pré-popula a partir de query string (?title=...&scope=role&roles=admin,gestor_contrato)
  useEffect(() => {
    const t = searchParams.get('title');
    const b = searchParams.get('body');
    const k = searchParams.get('kind');
    const url = searchParams.get('url');
    const sc = searchParams.get('scope') as Scope | null;
    const rl = searchParams.get('roles');
    const cId = searchParams.get('contract');
    const mIds = searchParams.get('members');
    const em = searchParams.get('email_also');
    const aliasParam = searchParams.get('alias');
    if (t) setTitle(t);
    if (b) setBody(b);
    if (k && ['info', 'warning', 'system'].includes(k)) setKind(k);
    if (url) setActionUrl(url);
    if (sc && ['all', 'role', 'contract', 'members'].includes(sc)) setScope(sc);
    if (rl) setRoles(rl.split(',').filter(Boolean));
    if (cId) setContractId(cId);
    if (mIds) setMemberIds(mIds.split(',').filter(Boolean));
    if (em === '1' || em === 'true') setEmailAlso(true);
    // ?alias=foo,bar → forçar scope=role, mas aguardar load (resolvido em outro effect)
    if (aliasParam) {
      setScope('role');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyTemplate(t: BroadcastTemplate) {
    setTitle(t.title);
    setBody(t.body);
    setKind(t.kind);
    setActionUrl(t.action_url || '');
    setEmailAlso(t.default_email_also);
    setAppliedTemplateId(t.id);
    // Decide scope baseado nos filtros do template
    if (t.default_filter_contract_id) {
      setScope('contract');
      setContractId(t.default_filter_contract_id);
      setRoles([]); setMemberIds([]);
    } else if (t.default_filter_member_ids && t.default_filter_member_ids.length > 0) {
      setScope('members');
      setMemberIds(t.default_filter_member_ids);
      setRoles([]); setContractId('');
    } else if (t.default_filter_roles && t.default_filter_roles.length > 0) {
      setScope('role');
      setRoles(t.default_filter_roles);
      setMemberIds([]); setContractId('');
    } else {
      setScope('all');
      setRoles([]); setMemberIds([]); setContractId('');
    }
  }

  function copyShareableLink() {
    const params = new URLSearchParams();
    if (title.trim())     params.set('title', title.trim());
    if (body.trim())      params.set('body', body.trim());
    if (kind !== 'info')  params.set('kind', kind);
    if (actionUrl.trim()) params.set('url', actionUrl.trim());
    if (scope !== 'all')  params.set('scope', scope);
    if (scope === 'role' && roles.length > 0)              params.set('roles', roles.join(','));
    if (scope === 'contract' && contractId)                params.set('contract', contractId);
    if (scope === 'members' && memberIds.length > 0)       params.set('members', memberIds.join(','));
    if (emailAlso)        params.set('email_also', '1');
    const url = `${window.location.origin}/admin/broadcast?${params.toString()}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  // Filter computed
  const filterArg = useMemo(() => ({
    filter_roles:        scope === 'role' && roles.length > 0 ? roles : undefined,
    filter_contract_id:  scope === 'contract' && contractId ? contractId : undefined,
    filter_member_ids:   scope === 'members' && memberIds.length > 0 ? memberIds : undefined,
  }), [scope, roles, contractId, memberIds]);

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['broadcast-preview', filterArg],
    queryFn: () => previewBroadcastRecipients(filterArg),
  });

  const { data: contractsList = [] } = useQuery({
    queryKey: ['contracts-lite'],
    queryFn: listContractsLite,
    enabled: scope === 'contract',
  });
  const { data: membersList = [], isLoading: membersLoading } = useQuery({
    queryKey: ['available-members'],
    queryFn: listAvailableMembers,
    enabled: scope === 'members',
  });

  const { data: roleAliases = [] } = useQuery({
    queryKey: ['role-aliases'],
    queryFn: listRoleAliases,
    enabled: scope === 'role' || !!searchParams.get('alias'),
  });

  // Resolve ?alias=slug-a,slug-b → adicionar roles dos aliases (1× só)
  useEffect(() => {
    if (aliasResolved) return;
    const aliasParam = searchParams.get('alias');
    if (!aliasParam || roleAliases.length === 0) return;
    const slugs = aliasParam.split(',').map((s) => s.trim()).filter(Boolean);
    const matched = roleAliases.filter((a) => slugs.includes(a.slug));
    if (matched.length > 0) {
      const allRoles = new Set<string>();
      matched.forEach((a) => a.roles.forEach((r) => allRoles.add(r)));
      setRoles((prev) => [...new Set([...prev, ...allRoles])]);
      setAliasResolved(true);
    }
  }, [searchParams, roleAliases, aliasResolved]);

  const selectedContract = useMemo(
    () => contractsList.find((c) => c.id === contractId),
    [contractsList, contractId],
  );

  const { data: history = [], refetch: refetchHistory } = useQuery({
    queryKey: ['broadcast-history'],
    queryFn: () => listBroadcastsHistory(20),
  });

  const send = useMutation({
    mutationFn: async () => {
      const r = await bulkSendNotification({
        title: title.trim(),
        body: body.trim(),
        kind,
        action_url: actionUrl.trim() || undefined,
        filter_roles:       scope === 'role' && roles.length > 0 ? roles : undefined,
        filter_contract_id: scope === 'contract' && contractId ? contractId : undefined,
        filter_member_ids:  scope === 'members' && memberIds.length > 0 ? memberIds : undefined,
      });
      let emailStats: BroadcastEmailStats | undefined;
      let emailError: string | undefined;
      if (emailAlso && r.total_sent > 0) {
        try {
          const dispatch = await dispatchBroadcastEmails(r.broadcast_id);
          emailStats = dispatch.email_stats;
        } catch (e) {
          emailError = humanizeError(e as Error);
        }
      }
      // Dispara webhooks externos (silencioso — não bloqueia retorno em erro)
      let webhookResult: WebhookDispatchResult | undefined;
      if (r.total_sent > 0) {
        try {
          webhookResult = await dispatchBroadcastWebhooks(r.broadcast_id);
        } catch (e) {
          // Log silencioso — webhooks são best-effort
          // eslint-disable-next-line no-console
          console.warn('[broadcast] falha ao despachar webhooks:', humanizeError(e as Error));
        }
      }
      return { ...r, emailStats, emailError, webhookResult };
    },
    onSuccess: (r) => {
      setSentResult({
        total: r.total_sent,
        emailStats: r.emailStats,
        emailError: r.emailError,
        webhookResult: r.webhookResult,
      });
      setResultOpen(true);
      setConfirmOpen(false);
      // Registra uso do template se foi aplicado
      if (appliedTemplateId) {
        recordBroadcastTemplateUse(appliedTemplateId).catch(() => {});
      }
      setTitle(''); setBody(''); setActionUrl('');
      setRoles([]); setContractId(''); setMemberIds([]);
      setScope('all'); setEmailAlso(false);
      setAppliedTemplateId(null);
      setSearchParams({}, { replace: true });   // limpa querystring
      qc.invalidateQueries({ queryKey: ['broadcast-history'] });
      refetchHistory();
    },
    onError: (e) => {
      setError(humanizeError(e as Error));
      setConfirmOpen(false);
    },
  });

  const canSend =
    title.trim().length >= 3 &&
    body.trim().length >= 5 &&
    (preview?.total ?? 0) > 0 &&
    (scope !== 'contract' || contractId.length > 0) &&
    (scope !== 'members'  || memberIds.length > 0);

  function toggleRole(r: string) {
    setRoles((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]);
  }

  return (
    <Layout>
      <PageHeader
        kicker="Administração · Comunicação"
        title="Broadcast de notificações"
        subtitle="Envie comunicados in-app para grupos de membros do tenant"
        backTo="/admin/users"
        backLabel="Admin"
      />

      {error && (
        <Card className="mb-4 flex items-start gap-3 border-error/30 bg-error/5 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-error" />
          <div className="flex-1">
            <p className="text-sm text-error">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        {/* Compositor */}
        <Card className="p-5">
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
            <Megaphone className="h-5 w-5 text-magenta" />
            Compor mensagem
          </h2>

          <div className="mb-3">
            <BroadcastTemplatesPanel
              currentDraft={{
                title, body, kind,
                action_url: actionUrl,
                filter_roles: scope === 'role' ? roles : undefined,
                filter_contract_id: scope === 'contract' ? contractId : undefined,
                filter_member_ids: scope === 'members' ? memberIds : undefined,
                email_also: emailAlso,
              }}
              onApply={applyTemplate}
            />
          </div>

          {appliedTemplateId && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs text-purple-800 dark:border-purple-900/40 dark:bg-purple-900/15 dark:text-purple-200">
              <BookMarked className="h-3.5 w-3.5" />
              Template aplicado · campos pré-preenchidos · você pode editá-los livremente
              <button
                type="button"
                onClick={() => setAppliedTemplateId(null)}
                className="ml-auto opacity-60 hover:opacity-100"
                aria-label="Descartar referência ao template"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <div className="space-y-3">
            <Field label="Tipo" hint="Define o ícone visual da notificação">
              <Select value={kind} onChange={(e) => setKind(e.target.value)} options={KIND_OPTIONS} />
            </Field>

            <Field label="Título" required hint="Mín 3 caracteres">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Manutenção programada do sistema"
                maxLength={120}
                className="input"
              />
              <p className="mt-1 text-right text-[10px] text-slate-400">{title.length}/120</p>
            </Field>

            <Field label="Mensagem" required hint="Mín 5 caracteres">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder="Detalhes da comunicação. Use frases curtas e objetivas."
                className="input"
              />
              <div className="mt-1 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setVarsHelpOpen((v) => !v)}
                  className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-display text-slate-500 hover:text-magenta dark:text-slate-400 dark:hover:text-magenta"
                >
                  <Info className="h-3 w-3" />
                  {varsHelpOpen ? 'Esconder variáveis' : 'Variáveis disponíveis'}
                </button>
                <p className="text-[10px] text-slate-400">{body.length}/500</p>
              </div>

              {varsHelpOpen && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-border-dark dark:bg-muted-dark">
                  <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-600 dark:text-slate-300">
                    Cole no título ou corpo — será substituído ao enviar
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {TEMPLATE_VARS.map((v) => (
                      <button
                        key={v.token}
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(v.token);
                        }}
                        title="Clique para copiar"
                        className="flex items-start gap-2 rounded px-2 py-1 text-left hover:bg-white dark:hover:bg-card-dark"
                      >
                        <code className="font-mono text-[11px] text-magenta-700 dark:text-magenta-200">
                          {v.token}
                        </code>
                        <span className="flex-1 text-[11px] text-slate-600 dark:text-slate-300">
                          {v.label}
                          {v.scope === 'email' && <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">e-mail</span>}
                          {v.scope === 'contract' && <span className="ml-1 rounded bg-purple-100 px-1 text-[9px] uppercase text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">contrato</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
                    <span className="rounded bg-amber-100 px-1 text-[9px] uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">e-mail</span> só funciona no envio por e-mail —
                    <span className="ml-1 rounded bg-purple-100 px-1 text-[9px] uppercase text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">contrato</span> só com escopo "Por contrato"
                  </p>
                </div>
              )}
            </Field>

            <Field label="Link de ação (opcional)" hint="URL relativa (/contratos/123) ou completa">
              <input
                type="text"
                value={actionUrl}
                onChange={(e) => setActionUrl(e.target.value)}
                placeholder="/contratos/abc-123"
                className="input"
              />
            </Field>

            <Field label="Destinatários">
              <div className="flex flex-wrap gap-2">
                {[
                  { v: 'all',      label: 'Todos do tenant' },
                  { v: 'role',     label: 'Por papel' },
                  { v: 'contract', label: 'Por contrato' },
                  { v: 'members',  label: 'Membros específicos' },
                ].map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setScope(o.v as Scope)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      scope === o.v
                        ? 'border-navy bg-navy text-white dark:border-purple dark:bg-purple'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-navy dark:border-border-dark dark:bg-card-dark dark:text-slate-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </Field>

            {scope === 'role' && (
              <>
                {roleAliases.length > 0 && (
                  <Field
                    label="Aliases de papéis"
                    hint="Clique para aplicar — expande os papéis do alias. Você pode combinar vários e ajustar abaixo."
                  >
                    <div className="flex flex-wrap gap-2">
                      {roleAliases.map((a) => {
                        // alias "ativo" quando todos os roles dele estão marcados
                        const isApplied = a.roles.every((r) => roles.includes(r));
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => {
                              // Toggle: se aplicado, remove os roles; se não, adiciona (sem duplicar)
                              if (isApplied) {
                                setRoles((prev) => prev.filter((r) => !a.roles.includes(r)));
                              } else {
                                setRoles((prev) => [...new Set([...prev, ...a.roles])]);
                              }
                            }}
                            title={`${a.roles.length} ${a.roles.length === 1 ? 'papel' : 'papéis'} · ${a.member_count} ${a.member_count === 1 ? 'membro' : 'membros'}`}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                              isApplied
                                ? 'border-purple bg-purple text-white'
                                : 'border-slate-300 bg-white text-slate-700 hover:border-purple dark:border-border-dark dark:bg-card-dark dark:text-slate-200'
                            }`}
                          >
                            <Tag className="h-3 w-3" />
                            {a.name}
                            <span className={`font-mono text-[10px] ${isApplied ? 'opacity-80' : 'opacity-60'}`}>
                              {a.member_count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                )}

                <Field label="Papéis" hint="Selecione 1 ou mais — recipientes precisam ter pelo menos um deles">
                  <div className="flex flex-wrap gap-2">
                    {ROLE_OPTIONS.map((r) => {
                      const isOn = roles.includes(r.value);
                      return (
                        <button
                          key={r.value}
                          type="button"
                          onClick={() => toggleRole(r.value)}
                          className={`rounded-full border px-3 py-1 text-xs font-medium ${
                            isOn
                              ? 'border-magenta bg-magenta text-white'
                              : 'border-slate-300 bg-white text-slate-600 hover:border-magenta dark:border-border-dark dark:bg-card-dark dark:text-slate-300'
                          }`}
                        >
                          {r.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </>
            )}

            {scope === 'contract' && (
              <Field label="Contrato" required hint="Membros vinculados a este contrato (via contract_members) receberão a notificação">
                <Select
                  value={contractId}
                  onChange={(e) => setContractId(e.target.value)}
                  placeholder="Selecione um contrato…"
                  options={contractsList.map((c) => ({
                    value: c.id,
                    label: `${c.numero} — ${c.objeto.slice(0, 60)}${c.objeto.length > 60 ? '…' : ''}`,
                  }))}
                />
                {contractsList.length === 0 && (
                  <p className="mt-1 text-xs text-slate-500">Carregando contratos…</p>
                )}
              </Field>
            )}

            {scope === 'members' && (
              <Field
                label="Membros específicos"
                required
                hint="Busque por nome, e-mail ou cargo. Clique para selecionar — clique no chip para remover."
              >
                <MemberPicker
                  options={membersList}
                  selectedIds={memberIds}
                  onChange={setMemberIds}
                  loading={membersLoading}
                  placeholder="Selecionar membros para o broadcast…"
                />
              </Field>
            )}

            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-border-dark dark:bg-muted-dark">
              <div className="flex items-start gap-2.5">
                <Mail className="mt-0.5 h-4 w-4 text-slate-500" />
                <div>
                  <p className="text-sm font-medium dark:text-slate-200">Enviar também por e-mail</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    E-mail respeita prefs individuais e quiet hours. Recomendado para comunicados importantes.
                  </p>
                </div>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={emailAlso}
                  onChange={(e) => setEmailAlso(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-magenta dark:bg-slate-600" />
                <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={copyShareableLink} disabled={!title.trim() && !body.trim()}>
                {linkCopied ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Link2 className="h-4 w-4" />}
                {linkCopied ? 'Link copiado!' : 'Copiar como link'}
              </Button>
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={!canSend}
                title={canSend ? '' : 'Preencha título e mensagem; destinatários > 0'}
              >
                <Send className="h-4 w-4" />Continuar
              </Button>
            </div>
          </div>
        </Card>

        {/* Coluna direita: prévia renderizada + destinatários */}
        <div className="space-y-4">
          <Card className="p-5">
            <BroadcastRenderedPreview
              title={title}
              body={body}
              kind={kind}
              actionUrl={actionUrl}
              tenantName={member?.tenants?.nome}
              senderName={member?.nome}
              contractNumero={selectedContract?.numero}
              contractObjeto={selectedContract?.objeto}
              emailAlso={emailAlso}
            />
          </Card>

          {/* Preview de destinatários */}
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
              <Users className="h-5 w-5 text-navy dark:text-purple-300" />
              Destinatários (prévia)
            </h2>

          {previewLoading && <Skeleton className="h-24" />}

          {preview && !previewLoading && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-border-dark dark:bg-muted-dark">
                <p className="text-xs text-slate-500 dark:text-slate-400">Total alcançável</p>
                <p className="mt-0.5 text-2xl font-bold tabular text-slate-900 dark:text-slate-100">{preview.total}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  <Mail className="mr-1 inline h-3 w-3" />
                  {preview.with_email} com e-mail cadastrado
                </p>
              </div>

              {Object.keys(preview.by_role).length > 0 && (
                <div className="space-y-1">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                    Por papel
                  </p>
                  {Object.entries(preview.by_role).map(([role, count]) => (
                    <div key={role} className="flex items-center justify-between border-b border-slate-100 py-1 last:border-0 dark:border-border-dark">
                      <span className="text-xs text-slate-700 dark:text-slate-300">
                        {ROLE_OPTIONS.find((r) => r.value === role)?.label || role}
                      </span>
                      <span className="font-mono text-xs font-semibold tabular dark:text-slate-100">{count}</span>
                    </div>
                  ))}
                </div>
              )}

              {preview.total === 0 && (
                <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                  Nenhum destinatário casa com o filtro atual.
                </p>
              )}

              <p className="text-[10px] text-slate-400">
                Você não recebe a própria notificação. Apenas in-app por padrão (e-mail respeita preferências individuais).
              </p>
            </div>
          )}
        </Card>
        </div>
      </div>

      {/* Histórico */}
      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-border-dark">
          <div>
            <p className="mb-0.5 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
              Histórico
            </p>
            <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
              <History className="h-4 w-4 text-slate-500" />Broadcasts recentes
            </h2>
          </div>
          {history.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => exportBroadcastsCsv(history)}>
              <Download className="h-3.5 w-3.5" />Exportar CSV
            </Button>
          )}
        </div>

        {history.length === 0 ? (
          <Empty title="Nenhum broadcast disparado ainda" body="Use o compositor acima para enviar o primeiro." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Disparado por</th>
                  <th>Título</th>
                  <th>Escopo</th>
                  <th className="text-right">Alcançou</th>
                  <th className="text-center">E-mail</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                    <td className="text-xs">
                      <p className="font-mono dark:text-slate-200">{dtTime(b.created_at)}</p>
                    </td>
                    <td className="text-sm">
                      <p className="font-medium dark:text-slate-200">{b.sender_nome || '—'}</p>
                      <p className="text-xs text-slate-500">{b.sender_email}</p>
                    </td>
                    <td className="max-w-md">
                      <p className="line-clamp-1 font-medium dark:text-slate-100">{b.title}</p>
                      <p className="line-clamp-1 text-xs text-slate-500 dark:text-slate-400">{b.body}</p>
                    </td>
                    <td>
                      {b.scope === 'all' && <Badge tone="blue">Todos</Badge>}
                      {b.scope === 'role' && (
                        <div className="flex flex-wrap gap-1">
                          {(b.filter_roles || []).map((r) => (
                            <Badge key={r} tone="purple">{ROLE_OPTIONS.find((o) => o.value === r)?.label || r}</Badge>
                          ))}
                        </div>
                      )}
                      {b.scope === 'contract' && (
                        <div className="flex items-center gap-1" title={b.contract_objeto || ''}>
                          <Building2 className="h-3 w-3 text-slate-500" />
                          <Badge tone="magenta">{b.contract_numero || 'Contrato'}</Badge>
                        </div>
                      )}
                      {b.scope === 'specific' && (
                        <div className="flex items-center gap-1">
                          <UserCheck className="h-3 w-3 text-slate-500" />
                          <Badge tone="magenta">
                            {(b.filter_member_ids || []).length} {(b.filter_member_ids || []).length === 1 ? 'membro' : 'membros'}
                          </Badge>
                        </div>
                      )}
                    </td>
                    <td className="text-right font-mono tabular text-sm font-semibold dark:text-slate-100">{b.total_sent}</td>
                    <td className="text-center">
                      {b.email_also ? <Mail className="inline h-3.5 w-3.5 text-success" /> : <span className="text-xs text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Confirmação */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirmar envio em massa"
        subtitle={`A mensagem será enviada para ${preview?.total ?? 0} ${preview?.total === 1 ? 'membro' : 'membros'}`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button onClick={() => send.mutate()} loading={send.isPending}>
              <Send className="h-4 w-4" />Disparar agora
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-border-dark dark:bg-muted-dark">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">Título</p>
            <p className="mt-1 font-medium dark:text-slate-100">{title}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-border-dark dark:bg-muted-dark">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">Mensagem</p>
            <p className="mt-1 whitespace-pre-wrap text-sm dark:text-slate-200">{body}</p>
          </div>
          <p className="text-xs text-slate-500">
            Esta ação é registrada na auditoria. Notificações enviadas não podem ser apagadas após o envio.
          </p>
        </div>
      </Modal>

      <Modal
        open={resultOpen}
        onClose={() => setResultOpen(false)}
        title="Broadcast enviado"
        size="sm"
        footer={<Button onClick={() => setResultOpen(false)}>OK</Button>}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg bg-success/10 p-4">
            <CheckCircle2 className="h-8 w-8 shrink-0 text-success" />
            <div>
              <p className="font-semibold text-success">{sentResult?.total ?? 0} {sentResult?.total === 1 ? 'membro recebeu' : 'membros receberam'} a notificação</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">Eles verão a mensagem no sino e na página /notifications</p>
            </div>
          </div>

          {sentResult?.emailStats && (
            <div className="rounded-lg border border-slate-200 p-3 dark:border-border-dark">
              <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                <Mail className="h-3 w-3" />Disparo de e-mail
              </p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Enviados</dt>
                  <dd className="font-mono font-semibold tabular text-success">{sentResult.emailStats.sent}</dd>
                </div>
                {sentResult.emailStats.skipped_pref > 0 && (
                  <div>
                    <dt className="text-xs text-slate-500">Pulados (pref)</dt>
                    <dd className="font-mono font-semibold tabular text-slate-500">{sentResult.emailStats.skipped_pref}</dd>
                  </div>
                )}
                {sentResult.emailStats.skipped_quiet > 0 && (
                  <div>
                    <dt className="text-xs text-slate-500">Quiet hours</dt>
                    <dd className="font-mono font-semibold tabular text-slate-500">{sentResult.emailStats.skipped_quiet}</dd>
                  </div>
                )}
                {sentResult.emailStats.failed > 0 && (
                  <div>
                    <dt className="text-xs text-slate-500">Falharam</dt>
                    <dd className="font-mono font-semibold tabular text-error">{sentResult.emailStats.failed}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {sentResult?.emailError && (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              ⚠ Notification in-app foi enviada com sucesso, mas o disparo de e-mail falhou: {sentResult.emailError}
            </p>
          )}

          {sentResult?.webhookResult && sentResult.webhookResult.dispatched > 0 && (
            <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-3 dark:border-purple-900/40 dark:bg-purple-900/15">
              <div className="mb-2 flex items-center gap-2">
                <WebhookIcon className="h-4 w-4 text-purple-700 dark:text-purple-200" />
                <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-purple-700 dark:text-purple-200">
                  Webhooks externos
                </p>
              </div>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Disparados</dt>
                  <dd className="font-mono font-semibold tabular text-purple-700 dark:text-purple-200">
                    {sentResult.webhookResult.dispatched}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Sucesso</dt>
                  <dd className="font-mono font-semibold tabular text-success">
                    {sentResult.webhookResult.ok_count}
                  </dd>
                </div>
                {sentResult.webhookResult.error_count > 0 && (
                  <div>
                    <dt className="text-xs text-slate-500">Erros</dt>
                    <dd className="font-mono font-semibold tabular text-error">
                      {sentResult.webhookResult.error_count}
                    </dd>
                  </div>
                )}
              </dl>
              {sentResult.webhookResult.results.some((r) => r.status === 'error') && (
                <ul className="mt-2 space-y-0.5 text-[11px]">
                  {sentResult.webhookResult.results
                    .filter((r) => r.status === 'error')
                    .map((r, i) => (
                      <li key={i} className="text-error">
                        <strong>{r.label}</strong>: {r.error || 'erro desconhecido'}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Modal>
    </Layout>
  );
}

function exportBroadcastsCsv(rows: BroadcastHistoryRow[]) {
  const cols = [
    'created_at', 'sender_nome', 'sender_email', 'title', 'body',
    'kind', 'scope', 'filter_roles', 'contract_numero', 'total_sent', 'email_also',
  ];
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n;]/.test(s) ? `"${s}"` : s;
  };
  const lines = [
    cols.join(','),
    ...rows.map((r) => cols.map((c) => {
      if (c === 'filter_roles') return esc((r.filter_roles || []).join(' | '));
      const v = (r as unknown as Record<string, unknown>)[c];
      return esc(v);
    }).join(',')),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `broadcasts-historico-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
