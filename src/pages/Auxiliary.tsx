import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { User, Bell, CheckCircle2, ExternalLink, ShieldCheck, AlertCircle, Briefcase } from 'lucide-react';
import { useEffect, useState } from 'react';
import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../lib/api';
import { supabase, hasSupabase, SITE_URL, PRODUCT_LONG_NAME } from '../lib/supabase';
import { humanizeError } from '../lib/errors';
import { dt, relativeTime } from '../lib/format';
import { useAuth } from '../hooks/useAuth';
import { Layout } from '../components/layout/Layout';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
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

  return (
    <Layout>
      <PageHeader
        title="Notificações"
        subtitle={`${unread} não lidas · ${data.length} totais`}
        actions={
          <>
            <Link to="/me/notificacoes">
              <Button variant="outline">Preferências</Button>
            </Link>
            {unread > 0 && <Button variant="outline" onClick={() => markAll.mutate()} loading={markAll.isPending}>Marcar todas como lidas</Button>}
          </>
        }
      />
      {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}
      {isError && <ErrorState message={(error as Error).message} />}
      {!isLoading && !isError && data.length === 0 && <Empty title="Sem notificações" body="Quando surgirem pendências, elas aparecerão aqui." />}
      {data.length > 0 && (
        <Card className="divide-y divide-slate-100 dark:divide-border-dark">
          {data.map((n) => (
            <div
              key={n.id}
              className={`flex items-start gap-3 p-4 ${!n.read_at ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''}`}
            >
              <Bell className={`mt-0.5 h-5 w-5 flex-shrink-0 ${!n.read_at ? 'text-navy' : 'text-slate-400'}`} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900 dark:text-slate-100">{n.title}</p>
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
          ))}
        </Card>
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
