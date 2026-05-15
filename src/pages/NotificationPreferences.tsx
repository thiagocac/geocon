import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Mail, MessageSquare, ArrowLeft, ShieldCheck, Send, Moon, Clock, Eye, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  listMyNotificationPrefs, upsertNotificationPref,
  getMyDigestPreview, getMyQuietHours, updateMyQuietHours, triggerDigestPreview,
  type NotificationEventType, type NotificationChannel, type NotificationPrefRow,
  type DigestPreview, type QuietHoursPrefs,
} from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { humanizeError } from '../lib/errors';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/FormField';
import { Empty, Skeleton, ErrorState } from '../components/ui/Stat';

interface EventMeta {
  key: NotificationEventType;
  label: string;
  description: string;
}

const EVENTS: EventMeta[] = [
  { key: 'measurement_approval_pending',
    label: 'Medições aguardando minha aprovação',
    description: 'Você foi designado(a) como aprovador em um step de medição' },
  { key: 'measurement_decided',
    label: 'Decisão sobre medição que enviei',
    description: 'Sua medição foi aprovada, devolvida ou reprovada' },
  { key: 'additive_approval_pending',
    label: 'Aditivos aguardando minha aprovação',
    description: 'Aditivo em fluxo de aprovação onde você é aprovador' },
  { key: 'unforeseen_decision_pending',
    label: 'Itens não previstos para decisão',
    description: 'Item não previsto aguarda análise/decisão técnica' },
  { key: 'grd_received',
    label: 'GRD recebida para confirmação',
    description: 'Você foi listado como destinatário de uma Guia de Remessa de Documentos' },
  { key: 'pendency_high',
    label: 'Pendência de alta severidade',
    description: 'Surgiu uma pendência crítica no portfólio (SLA estourado, decisão urgente)' },
  { key: 'risk_critico',
    label: 'Contrato entrou em nível crítico',
    description: 'Score de risco subiu para 70+ em algum contrato sob sua responsabilidade' },
  { key: 'digest_daily',
    label: 'Resumo diário (opt-in)',
    description: 'E-mail diário consolidado com pendências, decisões e indicadores' },
];

const CHANNELS: Array<{ key: NotificationChannel; label: string; icon: typeof Bell; hint: string }> = [
  { key: 'in_app', label: 'No app', icon: MessageSquare, hint: 'Sino e tela /notifications' },
  { key: 'email',  label: 'E-mail', icon: Mail,          hint: 'Inbox via Resend' },
];

export function NotificationPreferences() {
  const qc = useQueryClient();
  const { member } = useAuth();

  const { data: prefs = [], isLoading, isError, error } = useQuery({
    queryKey: ['my-notification-prefs'],
    queryFn: listMyNotificationPrefs,
  });

  const mutate = useMutation({
    mutationFn: (input: { event_type: NotificationEventType; channel: NotificationChannel; enabled: boolean }) =>
      upsertNotificationPref(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['my-notification-prefs'] });
      const prev = qc.getQueryData<NotificationPrefRow[]>(['my-notification-prefs']);
      qc.setQueryData<NotificationPrefRow[]>(['my-notification-prefs'], (cur) =>
        (cur || []).map((p) =>
          p.event_type === input.event_type && p.channel === input.channel
            ? { ...p, enabled: input.enabled, updated_at: new Date().toISOString() }
            : p
        )
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['my-notification-prefs'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['my-notification-prefs'] }),
  });

  function getPref(event: NotificationEventType, channel: NotificationChannel): boolean {
    const p = prefs.find((x) => x.event_type === event && x.channel === channel);
    return p?.enabled ?? true;
  }

  function toggle(event: NotificationEventType, channel: NotificationChannel) {
    const cur = getPref(event, channel);
    mutate.mutate({ event_type: event, channel, enabled: !cur });
  }

  return (
    <Layout>
      <PageHeader
        kicker="Conta · Preferências"
        title="Notificações"
        subtitle="Escolha quais eventos você quer receber, e por onde"
        backTo="/me"
        backLabel="Perfil"
      />

      <Card className="mb-4 flex items-start gap-3 border-blue-200 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-900/15">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700 dark:text-blue-300" />
        <div className="text-sm text-blue-900 dark:text-blue-100">
          <p>Alertas críticos do sistema (autenticação, segurança, falhas) <strong>não podem ser desligados</strong>.</p>
          <p className="mt-1 text-xs opacity-80">As preferências valem apenas para você e são aplicadas em tempo real.</p>
        </div>
      </Card>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <QuietHoursPanel memberId={member?.id || null} />
        <DigestPreviewPanel />
      </div>

      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}
      {isError && <ErrorState message={(error as Error).message} />}

      {!isLoading && !isError && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-muted-dark">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Evento
                  </th>
                  {CHANNELS.map((c) => {
                    const Icon = c.icon;
                    return (
                      <th key={c.key} className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <div className="flex flex-col items-center gap-1">
                          <Icon className="h-4 w-4" />
                          <span>{c.label}</span>
                          <span className="text-[10px] font-normal normal-case opacity-70">{c.hint}</span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-border-dark">
                {EVENTS.map((evt) => (
                  <tr key={evt.key} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{evt.label}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{evt.description}</p>
                    </td>
                    {CHANNELS.map((c) => {
                      const checked = getPref(evt.key, c.key);
                      return (
                        <td key={c.key} className="px-4 py-3 text-center">
                          <Toggle
                            checked={checked}
                            onChange={() => toggle(evt.key, c.key)}
                            disabled={mutate.isPending}
                            label={`${evt.label} via ${c.label}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {prefs.length === 0 && !isLoading && (
        <Empty title="Nenhuma preferência configurada"
               body="Use os toggles acima para personalizar quais eventos você quer receber em cada canal." />
      )}

      <div className="mt-4">
        <Link to="/notifications" className="inline-flex items-center gap-1 text-sm text-navy hover:underline dark:text-purple-300">
          <ArrowLeft className="h-4 w-4" />Ver minhas notificações
        </Link>
      </div>
    </Layout>
  );
}

function Toggle({ checked, onChange, disabled, label }: {
  checked: boolean; onChange: () => void; disabled?: boolean; label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-navy dark:bg-purple' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

const TZ_OPTIONS = [
  'America/Sao_Paulo', 'America/Bahia', 'America/Manaus', 'America/Cuiaba',
  'America/Belem', 'America/Recife', 'America/Fortaleza', 'America/Maceio',
  'America/Rio_Branco', 'America/Noronha',
];

function QuietHoursPanel({ memberId }: { memberId: string | null }) {
  const qc = useQueryClient();
  const { data: qh, isLoading } = useQuery({
    queryKey: ['my-quiet-hours'],
    queryFn: getMyQuietHours,
  });

  const [draft, setDraft] = useState<QuietHoursPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sincroniza draft com server
  useEffect(() => {
    if (qh) setDraft(qh);
  }, [qh]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft || !memberId) throw new Error('Member não identificado');
      await updateMyQuietHours({ ...draft, member_id: memberId });
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['my-quiet-hours'] });
    },
    onError: (e) => setError(humanizeError(e as Error)),
  });

  const d = draft || qh;

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
        <Moon className="h-5 w-5 text-purple" />
        Horário de silêncio
      </h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Suprime e-mails (e digest) dentro da faixa horária. Notificações no app continuam normais.
      </p>

      {isLoading && <Skeleton className="mt-3 h-32" />}

      {d && !isLoading && (
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={d.quiet_hours_enabled}
              onChange={(e) => setDraft({ ...d, quiet_hours_enabled: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span className="font-medium dark:text-slate-200">Ativar horário de silêncio</span>
          </label>

          <div className={`grid gap-3 sm:grid-cols-2 ${!d.quiet_hours_enabled ? 'opacity-50' : ''}`}>
            <Field label="De">
              <input
                type="time"
                disabled={!d.quiet_hours_enabled}
                value={(d.quiet_hours_start || '').slice(0, 5)}
                onChange={(e) => setDraft({ ...d, quiet_hours_start: e.target.value ? `${e.target.value}:00` : null })}
                className="input"
              />
            </Field>
            <Field label="Até">
              <input
                type="time"
                disabled={!d.quiet_hours_enabled}
                value={(d.quiet_hours_end || '').slice(0, 5)}
                onChange={(e) => setDraft({ ...d, quiet_hours_end: e.target.value ? `${e.target.value}:00` : null })}
                className="input"
              />
            </Field>
          </div>

          <Field label="Fuso horário" hint="Usado para calcular o horário de silêncio">
            <select
              value={d.timezone}
              onChange={(e) => setDraft({ ...d, timezone: e.target.value })}
              className="input"
            >
              {TZ_OPTIONS.map((tz) => (<option key={tz} value={tz}>{tz}</option>))}
            </select>
          </Field>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            <span>Faixas que cruzam meia-noite (ex: 22:00–06:00) são suportadas.</span>
          </div>

          {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-error dark:bg-red-900/20">{error}</p>}

          <div>
            <Button onClick={() => save.mutate()} loading={save.isPending} size="sm">
              Salvar horário de silêncio
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DigestPreviewPanel() {
  const { data: preview, isLoading, refetch } = useQuery({
    queryKey: ['digest-preview'],
    queryFn: getMyDigestPreview,
  });

  const trigger = useMutation({
    mutationFn: () => triggerDigestPreview(true),
  });

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
            <Eye className="h-5 w-5 text-navy dark:text-purple-300" />
            Prévia do resumo diário
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            O que seria enviado agora se você assinasse o digest_daily/email
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />Atualizar
        </Button>
      </div>

      {isLoading && <Skeleton className="mt-3 h-32" />}

      {preview && !preview.empty && !isLoading && (
        <>
          <ul className="mt-4 space-y-1.5 text-sm">
            <DigestRow label="Aprovações pendentes" value={preview.aprovacoes_pendentes} highlight={preview.aprovacoes_atrasadas > 0} highlightSuffix={preview.aprovacoes_atrasadas > 0 ? `${preview.aprovacoes_atrasadas} fora do prazo` : undefined} />
            <DigestRow label="GRDs aguardando recebimento" value={preview.grds_pendentes} />
            <DigestRow label="Pendências alta severidade" value={preview.pendencias_high_tenant} tone="red" />
            <DigestRow label="Contratos críticos no tenant" value={preview.contratos_criticos_tenant} tone="red" />
            <DigestRow label="Contratos em atenção" value={preview.contratos_atencao_tenant} tone="yellow" />
            <DigestRow label="Notificações não lidas (7d)" value={preview.notif_nao_lidas} tone="slate" />
          </ul>

          <div className="mt-4 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => trigger.mutate()} loading={trigger.isPending}>
              <Send className="h-3.5 w-3.5" />Simular disparo (dry-run)
            </Button>
          </div>
          {trigger.data && (
            <p className="mt-2 text-xs text-slate-500">
              Resultado: {trigger.data.processed} processado(s), {trigger.data.sent} enviaria(m)
            </p>
          )}
        </>
      )}

      {preview?.empty && !isLoading && (
        <Empty title="Sem dados ainda" body="Volte depois que o tenant tiver atividade." />
      )}
    </Card>
  );
}

function DigestRow({ label, value, highlight, highlightSuffix, tone }: {
  label: string; value: number; highlight?: boolean; highlightSuffix?: string;
  tone?: 'slate' | 'red' | 'yellow' | 'green';
}) {
  const cls = value === 0 ? 'text-slate-400' :
              tone === 'red' ? 'text-error' :
              tone === 'yellow' ? 'text-warning' :
              tone === 'green' ? 'text-success' :
              'text-slate-900 dark:text-slate-100';
  return (
    <li className="flex items-center justify-between gap-3 py-1">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className={`font-mono font-semibold tabular ${cls}`}>{value}</span>
        {highlight && highlightSuffix && (
          <span className="rounded-full bg-error/10 px-1.5 py-0.5 text-[10px] font-medium text-error">{highlightSuffix}</span>
        )}
      </span>
    </li>
  );
}
