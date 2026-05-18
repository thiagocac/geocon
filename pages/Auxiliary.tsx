import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { User, Bell, CheckCircle2, ExternalLink, ShieldCheck, AlertCircle, Briefcase, Megaphone, Mail, Eye, AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  listNotifications, markNotificationRead, markAllNotificationsRead,
  getAlertDigestSettings, upsertAlertDigestSettings, previewAlertDigest,
  ALERT_DIGEST_FREQUENCY_LABELS, ALERT_DIGEST_THRESHOLD_LABELS,
  type AlertDigestFrequency, type AlertDigestSeverityThreshold, type AlertDigestPreview,
} from '../lib/api';
import { supabase, hasSupabase, SITE_URL, PRODUCT_LONG_NAME } from '../lib/supabase';
import { humanizeError } from '../lib/errors';
import { dt, dtTime, relativeTime } from '../lib/format';
import { useAuth } from '../hooks/useAuth';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Empty, Skeleton, ErrorState } from '../components/ui/Stat';
import type { PublicValidationRecord } from '../lib/types';

const ENTITY_TYPE_LABEL: Record<string, string> = {
  measurement: 'Boletim de medição',
  additive: 'Termo aditivo',
  grd: 'Guia de remessa de documentos',
  ged_document: 'Documento do GED',
  unforeseen_item: 'Item não previsto',
  risk_analysis: 'Análise de risco contratual',
  audit_package: 'Pacote de auditoria',
  contract: 'Contrato',
  contract_timeline: 'Linha do tempo do contrato',
};

// =============================================================================
// ME
// =============================================================================
export function Me() {
  const { member, members, switchMember, signOut } = useAuth();

  if (!member) return <Layout><Empty title="Carregando perfil…" /></Layout>;

  return (
    <Layout>
      <PageHeader title="Meu perfil" subtitle="Conta, tenants e papéis" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-navy text-white">
              <User className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">{member.nome}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{member.email}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge tone="purple">{member.role}</Badge>
                {(member.roles || []).map((r) => (<Badge key={r} tone="slate">{r}</Badge>))}
              </div>
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            {member.cargo && (<div><dt className="text-xs uppercase text-slate-500 dark:text-slate-400">Cargo</dt><dd>{member.cargo}</dd></div>)}
            {member.empresa && (<div><dt className="text-xs uppercase text-slate-500 dark:text-slate-400">Empresa</dt><dd>{member.empresa}</dd></div>)}
            {member.crea_numero && (<div><dt className="text-xs uppercase text-slate-500 dark:text-slate-400">CREA</dt><dd>{member.crea_numero}/{member.crea_uf}</dd></div>)}
          </dl>
          <div className="mt-5 flex gap-2">
            <Link to="/me/notificacoes">
              <Button variant="outline"><Bell className="h-4 w-4" />Notificações</Button>
            </Link>
            <Button variant="outline" onClick={() => signOut()}>Sair</Button>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100"><Briefcase className="mr-1 inline h-4 w-4" />Tenants disponíveis</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Você está em <strong>{member.tenants?.nome}</strong></p>
          <div className="mt-4 space-y-2">
            {members.map((m) => (
              <button
                key={m.id}
                disabled={m.id === member.id}
                onClick={() => switchMember(m.id)}
                className={`flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm transition-colors ${
                  m.id === member.id
                    ? 'border-navy bg-navy/5 dark:border-purple dark:bg-purple/10'
                    : 'border-slate-200 hover:border-navy hover:bg-slate-50 dark:border-border-dark dark:hover:bg-muted-dark'
                }`}
              >
                <div>
                  <p className="font-medium">{m.tenants?.nome || m.tenant_id}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{m.role}</p>
                </div>
                {m.id === member.id && <CheckCircle2 className="h-4 w-4 text-success" />}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* V47: Alert digest Lei 14.133 */}
      <AlertDigestSection />
    </Layout>
  );
}

// =============================================================================
// NOTIFICATIONS
// =============================================================================
export function Notifications() {
  const qc = useQueryClient();
  const { data = [], isLoading, isError, error } = useQuery({ queryKey: ['notifications'], queryFn: listNotifications });

  const markOne = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = data.filter((n) => !n.read_at).length;

  // Agrupar por kind preservando ordem temporal dentro de cada grupo
  const grouped = data.reduce((acc, n) => {
    const k = (n.kind || 'info') as string;
    (acc[k] = acc[k] || []).push(n);
    return acc;
  }, {} as Record<string, typeof data>);
  const groupOrder = Object.keys(grouped).sort((a, b) => {
    // kind=system primeiro, depois warning, depois info, depois resto
    const rank = (k: string) => k === 'system' ? 0 : k === 'warning' ? 1 : k === 'info' ? 2 : 3;
    return rank(a) - rank(b);
  });

  const KIND_LABEL: Record<string, string> = {
    info:    'Informativos',
    warning: 'Atenção',
    system:  'Urgentes do sistema',
    measurement_approval_pending: 'Medições aguardando aprovação',
    measurement_decided:          'Medições decididas',
    grd_received:                 'GRDs recebidos',
    unforeseen_decision_pending:  'Itens não previstos',
    additive_approval_pending:    'Aditivos aguardando aprovação',
    pendency_high:                'Pendências altas',
    risk_critico:                 'Riscos críticos',
    digest_daily:                 'Resumos diários',
  };

  return (
    <Layout>
      <PageHeader
        kicker="Sua caixa"
        title="Notificações"
        subtitle={`${unread} não lidas · ${data.length} totais`}
        actions={
          <>
            <Link to="/me/notificacoes">
              <Button variant="outline">Preferências</Button>
            </Link>
            {unread > 0 && (
              <Button variant="outline" onClick={() => markAll.mutate()} loading={markAll.isPending}>
                <CheckCircle2 className="h-4 w-4" />
                <span className="hidden sm:inline">Marcar todas como lidas</span>
                <span className="sm:hidden">Marcar lidas</span>
              </Button>
            )}
          </>
        }
      />
      {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}
      {isError && <ErrorState message={(error as Error).message} />}
      {!isLoading && !isError && data.length === 0 && <Empty title="Sem notificações" body="Quando surgirem pendências, elas aparecerão aqui." />}
      {data.length > 0 && (
        <div className="space-y-3">
          {groupOrder.map((kind) => {
            const items = grouped[kind];
            const unreadInGroup = items.filter((n) => !n.read_at).length;
            return (
              <Card key={kind} className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-2 dark:border-border-dark dark:bg-muted-dark/40">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-600 dark:text-slate-400">
                    {KIND_LABEL[kind] || kind}
                    <span className="ml-1 normal-case tracking-normal text-slate-400">· {items.length}</span>
                  </p>
                  {unreadInGroup > 0 && (
                    <span className="inline-flex items-center rounded-full bg-magenta px-2 py-0.5 font-mono text-[10px] font-bold text-white">
                      {unreadInGroup} novas
                    </span>
                  )}
                </div>
                <div className="divide-y divide-slate-100 dark:divide-border-dark">
                  {items.map((n) => {
                    const isBroadcast = n.metadata && (n.metadata as Record<string, unknown>).broadcast === true;
                    return (
                      <div
                        key={n.id}
                        className={`flex items-start gap-3 p-4 ${!n.read_at ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''}`}
                      >
                        <Bell className={`mt-0.5 h-5 w-5 flex-shrink-0 ${!n.read_at ? 'text-navy' : 'text-slate-400'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-slate-900 dark:text-slate-100">{n.title}</p>
                            {isBroadcast && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">
                                <Megaphone className="h-2.5 w-2.5" />Broadcast
                              </span>
                            )}
                          </div>
                          {n.body && <p className="text-sm text-slate-500 dark:text-slate-400">{n.body}</p>}
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{relativeTime(n.created_at)}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {n.link && (
                            <a href={n.link} className="text-xs font-semibold text-navy hover:underline dark:text-slate-200">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {!n.read_at && (
                            <button onClick={() => markOne.mutate(n.id)} className="text-xs text-slate-500 hover:text-navy dark:text-slate-400">
                              Marcar lida
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Layout>
  );
}

// =============================================================================
// PUBLIC VALIDATION (sem auth)
// =============================================================================
export function PublicValidation() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<PublicValidationRecord | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!code) {
        setLoading(false);
        setErr('Código não informado.');
        return;
      }
      if (!hasSupabase) {
        setLoading(false);
        setErr('Backend não configurado.');
        return;
      }
      try {
        // Tenta via Edge Function pública
        const { data: out, error: fnErr } = await supabase.functions.invoke('public-validation', { body: { code } });
        if (fnErr) throw new Error(humanizeError(fnErr));
        if (!mounted) return;
        if (!out?.ok) throw new Error(out?.error || 'Registro não encontrado');
        setData(out.record);
        setSignedUrl(out.signed_url || null);
      } catch (e) {
        if (mounted) setErr((e as Error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [code]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy via-purple to-magenta">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="mb-6 flex items-center gap-2 text-white">
          <img
            src="/logos/logo-white.png"
            srcSet="/logos/logo-white.png 1x, /logos/logo-white@2x.png 2x"
            alt="geoCon"
            className="h-10 w-auto"
          />
          <div>
            <h1 className="text-xl font-bold"><span className="text-magenta-200">°</span>geoCon</h1>
            <p className="text-xs text-white/70">{PRODUCT_LONG_NAME}</p>
          </div>
        </div>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-4 dark:border-border-dark">
            <h2 className="text-lg font-semibold dark:text-slate-100"><ShieldCheck className="mr-2 inline h-5 w-5 text-success" />Validação pública</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Código: <span className="font-mono">{code}</span></p>
          </div>

          <div className="p-6">
            {loading && <Skeleton className="h-32" />}
            {err && (
              <div className="flex items-start gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Não foi possível validar este código.</p>
                  <p>{err}</p>
                </div>
              </div>
            )}

            {data && (
              <>
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">{data.title}</h3>
                {data.entity_type === 'risk_analysis' && (
                  <RiskSummaryBadge metadata={data.metadata} />
                )}
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase text-slate-500 dark:text-slate-400">Tipo</dt>
                    <dd className="font-medium">{ENTITY_TYPE_LABEL[data.entity_type] || data.entity_type}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500 dark:text-slate-400">Emitido em</dt>
                    <dd>{dt(data.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500 dark:text-slate-400">Hash SHA-256</dt>
                    <dd className="break-all font-mono text-xs">{data.hash_sha256}</dd>
                  </div>
                </dl>

                {signedUrl && (
                  <a href={signedUrl} target="_blank" rel="noopener noreferrer"
                     className="mt-6 inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-900">
                    <ExternalLink className="h-4 w-4" />
                    Abrir documento original
                  </a>
                )}

                <div className="mt-6 rounded-lg bg-green-50 p-3 text-xs text-green-800 dark:bg-green-900/20 dark:text-green-200">
                  ✓ Este registro é íntegro: o hash acima foi calculado pelo sistema no momento da emissão. Qualquer alteração no arquivo invalida o hash.
                </div>
              </>
            )}
          </div>
        </Card>

        <p className="mt-6 text-center text-xs text-white/70">
          Site oficial: <a className="underline" href={SITE_URL}>{SITE_URL}</a>
        </p>
      </div>
    </div>
  );
}

const RISK_NIVEL_CLS: Record<string, string> = {
  critico:   'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200',
  atencao:   'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200',
  monitorar: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
  estavel:   'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
};

const RISK_NIVEL_LABEL: Record<string, string> = {
  critico: 'CRÍTICO', atencao: 'ATENÇÃO', monitorar: 'MONITORAR', estavel: 'ESTÁVEL',
};

function RiskSummaryBadge({ metadata }: { metadata: Record<string, unknown> }) {
  const score = typeof metadata?.score === 'number' ? metadata.score : null;
  const nivel = typeof metadata?.nivel === 'string' ? metadata.nivel : null;
  if (score === null && !nivel) return null;
  const cls = nivel ? RISK_NIVEL_CLS[nivel] || RISK_NIVEL_CLS.estavel : RISK_NIVEL_CLS.estavel;
  return (
    <div className={`mt-3 inline-flex items-center gap-3 rounded-lg px-4 py-2 ${cls}`}>
      {score !== null && <span className="font-mono text-2xl font-bold tabular">{score}</span>}
      {nivel && <span className="text-sm font-bold uppercase tracking-wider">{RISK_NIVEL_LABEL[nivel] || nivel}</span>}
      <span className="text-xs opacity-70">no momento da emissão</span>
    </div>
  );
}

// =============================================================================
// V47 — Alert Digest Settings (seção dentro do /me)
// =============================================================================
function AlertDigestSection() {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<AlertDigestFrequency>('weekly');
  const [threshold, setThreshold] = useState<AlertDigestSeverityThreshold>('warning');
  const [hydrated, setHydrated] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['alert-digest-settings'],
    queryFn: getAlertDigestSettings,
  });

  useEffect(() => {
    if (settings && !hydrated) {
      setEnabled(settings.enabled);
      setFrequency(settings.frequency);
      setThreshold(settings.severity_threshold);
      setHydrated(true);
    }
  }, [settings, hydrated]);

  const mSave = useMutation({
    mutationFn: () => upsertAlertDigestSettings({ enabled, frequency, severity_threshold: threshold }),
    onSuccess: () => {
      setFeedback({ tone: 'ok', message: 'Preferências salvas com sucesso' });
      qc.invalidateQueries({ queryKey: ['alert-digest-settings'] });
    },
    onError: (e) => setFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  const dirty = !!settings && (
    enabled !== settings.enabled ||
    frequency !== settings.frequency ||
    threshold !== settings.severity_threshold
  );

  return (
    <>
      <Card className="mt-6 p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-magenta/10 text-magenta">
            <Mail className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Digest de alertas Lei 14.133</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Receba periodicamente um email + notificação com os alertas críticos da carteira
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Toggle enabled */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-medium dark:text-slate-200">Habilitar digest periódico</p>
              <p className="text-xs text-slate-500">
                Você só recebe email quando há alertas; sem alertas, nenhuma mensagem é enviada (sem inbox poluído).
              </p>
            </div>
          </label>

          {/* Frequência */}
          <div className={enabled ? '' : 'opacity-40 pointer-events-none'}>
            <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
              Frequência
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(['daily', 'weekly', 'monthly'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFrequency(f)}
                  className={[
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    frequency === f
                      ? 'border-magenta bg-magenta/10 text-magenta dark:border-magenta dark:bg-magenta/20'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-border-dark dark:bg-card-dark dark:text-slate-300 dark:hover:bg-muted-dark',
                  ].join(' ')}
                >
                  {ALERT_DIGEST_FREQUENCY_LABELS[f]}
                </button>
              ))}
            </div>
          </div>

          {/* Limiar de severidade */}
          <div className={enabled ? '' : 'opacity-40 pointer-events-none'}>
            <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
              Limiar de severidade
            </p>
            <div className="space-y-1.5">
              {(['warning', 'danger'] as const).map((s) => (
                <label key={s} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="radio"
                    checked={threshold === s}
                    onChange={() => setThreshold(s)}
                  />
                  <span className="dark:text-slate-200">{ALERT_DIGEST_THRESHOLD_LABELS[s]}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              <strong>Todos</strong>: inclui PARs sem sanção, prazo vencido, multas grandes. <br/>
              <strong>Apenas críticos</strong>: vícios graves + garantias vencendo ≤7d.
            </p>
          </div>

          {/* Última remessa */}
          {settings?.last_sent_at && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-border-dark dark:bg-muted-dark/30">
              <p className="text-slate-500">
                Último envio: <strong className="dark:text-slate-200">{dtTime(settings.last_sent_at)}</strong>
                {settings.last_alert_count !== null && (
                  <span> · {settings.last_alert_count} alerta{settings.last_alert_count === 1 ? '' : 's'}</span>
                )}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-border-dark">
            <Button onClick={() => mSave.mutate()} loading={mSave.isPending} disabled={!dirty}>
              <CheckCircle2 className="h-4 w-4" />Salvar preferências
            </Button>
            <Button variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye className="h-4 w-4" />Preview
            </Button>
            {dirty && <span className="text-xs text-yellow-700 dark:text-yellow-300">· alterações não salvas</span>}
          </div>
        </div>
      </Card>

      {/* Preview modal */}
      <AlertDigestPreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} />

      {/* Feedback */}
      <Modal
        open={!!feedback}
        onClose={() => setFeedback(null)}
        title="Status"
        size="sm"
        footer={<div className="flex justify-end"><Button onClick={() => setFeedback(null)}>OK</Button></div>}
      >
        {feedback && (
          <div className={`rounded-lg border px-3 py-3 text-sm ${
            feedback.tone === 'ok'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-error/30 bg-error/10 text-error'
          }`}>
            <div className="flex items-start gap-2">
              {feedback.tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-5 w-5" /> : <AlertTriangle className="mt-0.5 h-5 w-5" />}
              <p>{feedback.message}</p>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function AlertDigestPreviewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['alert-digest-preview'],
    queryFn: previewAlertDigest,
    enabled: open,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Preview do digest"
      subtitle="Visão do que seria enviado agora baseado nos seus dados atuais"
      size="lg"
      footer={<div className="flex justify-end"><Button variant="outline" onClick={onClose}>Fechar</Button></div>}
    >
      {isLoading && <p className="text-sm text-slate-500">Carregando…</p>}
      {error && <p className="text-sm text-error">Erro: {humanizeError(error)}</p>}
      {data && <AlertDigestPreviewContent data={data} />}
    </Modal>
  );
}

function AlertDigestPreviewContent({ data }: { data: AlertDigestPreview }) {
  if (data.alert_count === 0) {
    return (
      <div className="rounded-lg border-2 border-success/30 bg-success/5 p-6 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
        <p className="mt-2 text-sm font-semibold text-success">Carteira saudável</p>
        <p className="mt-1 text-xs text-slate-500">
          Nenhum alerta no momento. Você não receberia email neste período.
        </p>
      </div>
    );
  }

  const alerts = [
    { key: 'vicios_graves',              count: data.alerts.vicios_graves,             label: 'contratos com vícios graves',                tone: 'danger' as const },
    { key: 'garantias_7d',               count: data.alerts.garantias_7d,              label: 'garantias vencendo em ≤7 dias',              tone: 'danger' as const },
    { key: 'par_procedente_sem_sancao',  count: data.alerts.par_procedente_sem_sancao, label: 'PARs procedentes sem sanção',                tone: 'warning' as const },
    { key: 'par_prazo_defesa_vencido',   count: data.alerts.par_prazo_defesa_vencido,  label: 'PARs com prazo de defesa vencido',           tone: 'warning' as const },
    { key: 'multas_grandes_pendentes',   count: data.alerts.multas_grandes_pendentes,  label: 'multas grandes pendentes',                   tone: 'warning' as const },
  ].filter((a) => a.count > 0);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border-2 border-magenta/30 bg-magenta/5 p-3">
        <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">Resumo</p>
        <p className="mt-1 text-2xl font-bold text-magenta">
          {data.alert_count} alerta{data.alert_count === 1 ? '' : 's'}
        </p>
        <p className="text-xs text-slate-500">limiar: {data.threshold}</p>
      </div>

      <div className="space-y-1.5">
        {alerts.map((a) => (
          <div
            key={a.key}
            className={`rounded-lg border px-3 py-2 text-sm ${
              a.tone === 'danger'
                ? 'border-error/30 bg-error/5 text-error'
                : 'border-yellow-300/40 bg-yellow-50 text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-900/15 dark:text-yellow-200'
            }`}
          >
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            <strong>{a.count}</strong> {a.label}
          </div>
        ))}
      </div>

      {data.top_critical.length > 0 && (
        <div>
          <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
            Contratos críticos · top {data.top_critical.length}
          </p>
          <Card>
            <ul className="divide-y divide-slate-100 dark:divide-border-dark">
              {data.top_critical.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-mono text-xs font-bold text-magenta">#{c.numero}</span>
                  <span className="dark:text-slate-200 line-clamp-1 flex-1">{c.titulo}</span>
                  <span className="font-mono text-[10px] text-slate-500">score {c.score}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {data.next_dates.length > 0 && (
        <div>
          <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
            Próximos vencimentos
          </p>
          <Card>
            <ul className="divide-y divide-slate-100 dark:divide-border-dark">
              {data.next_dates.map((n, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className={`font-mono text-xs font-bold ${
                    n.days_until <= 7 ? 'text-error' :
                    n.days_until <= 30 ? 'text-yellow-700 dark:text-yellow-300' :
                                         'text-slate-500'
                  }`}>{n.days_until}d</span>
                  <span className="dark:text-slate-200 line-clamp-1 flex-1">{n.label}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
