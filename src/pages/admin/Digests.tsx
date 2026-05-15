import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Mail, CheckCircle2, XCircle, MinusCircle, Send, RefreshCw, AlertCircle, Calendar,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { listDigestsHistory, listDigestsDailyStats, triggerDigestPreview, type DigestHistoryRow } from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { dtTime, dt } from '../../lib/format';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Empty, Skeleton, Stat } from '../../components/ui/Stat';
import { Field, Select } from '../../components/ui/FormField';

const STATUS_META: Record<DigestHistoryRow['email_status'], { icon: typeof Mail; tone: 'green' | 'slate' | 'red'; label: string }> = {
  sent:    { icon: CheckCircle2, tone: 'green', label: 'Enviado' },
  skipped: { icon: MinusCircle,  tone: 'slate', label: 'Pulado' },
  failed:  { icon: XCircle,      tone: 'red',   label: 'Falhou' },
};

const DATE_OPTIONS = [
  { value: '7',  label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
];

export function AdminDigests() {
  const [days, setDays] = useState('30');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<{ processed: number; sent: number; failed: number; skipped: number } | null>(null);

  const dateFromIso = useMemo(() => {
    const d = new Date(Date.now() - parseInt(days, 10) * 86400_000);
    return d.toISOString().slice(0, 10);
  }, [days]);

  const { data: history = [], isLoading, refetch } = useQuery({
    queryKey: ['admin-digests-history', dateFromIso],
    queryFn: () => listDigestsHistory(200, dateFromIso),
  });

  const { data: dailyStats = [], refetch: refetchStats } = useQuery({
    queryKey: ['admin-digests-stats', days],
    queryFn: () => listDigestsDailyStats(parseInt(days, 10)),
  });

  const filtered = filterStatus
    ? history.filter((h) => h.email_status === filterStatus)
    : history;

  const stats = useMemo(() => ({
    total: history.length,
    sent: history.filter((h) => h.email_status === 'sent').length,
    skipped: history.filter((h) => h.email_status === 'skipped').length,
    failed: history.filter((h) => h.email_status === 'failed').length,
  }), [history]);

  const trigger = useMutation({
    mutationFn: async ({ force }: { force: boolean }) => triggerDigestPreview(!force),
    onSuccess: (data) => {
      setTriggerError(null);
      setTriggerResult({ processed: data.processed, sent: data.sent, failed: 0, skipped: 0 });
      refetch();
      refetchStats();
    },
    onError: (e) => setTriggerError(humanizeError(e as Error)),
  });

  return (
    <Layout>
      <PageHeader
        kicker="Administração · Notificações"
        title="Histórico de digests"
        subtitle="Envios do resumo diário (digest_daily) — últimos 90 dias"
        backTo="/admin/users"
        backLabel="Admin"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => trigger.mutate({ force: false })} loading={trigger.isPending && !trigger.variables?.force}>
              <Send className="h-4 w-4" />Dry-run agora
            </Button>
            <Button onClick={() => {
              if (confirm('Disparar digest real (force=true)? Isso ignora a idempotência diária e re-envia.')) {
                trigger.mutate({ force: true });
              }
            }} loading={trigger.isPending && trigger.variables?.force}>
              <Send className="h-4 w-4" />Forçar envio
            </Button>
          </div>
        }
      />

      {triggerResult && (
        <Card className="mb-4 flex items-start gap-3 border-success/30 bg-success/5 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <div className="flex-1">
            <p className="text-sm font-medium text-success">Digest disparado com sucesso</p>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {triggerResult.processed} processados, {triggerResult.sent} enviado(s)
            </p>
          </div>
          <button onClick={() => setTriggerResult(null)} className="text-slate-400 hover:text-slate-600"><XCircle className="h-4 w-4" /></button>
        </Card>
      )}
      {triggerError && (
        <Card className="mb-4 flex items-start gap-3 border-error/30 bg-error/5 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-error" />
          <div className="flex-1">
            <p className="text-sm text-error">{triggerError}</p>
          </div>
          <button onClick={() => setTriggerError(null)} className="text-slate-400"><XCircle className="h-4 w-4" /></button>
        </Card>
      )}

      {/* KPIs */}
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Stat label="Total" value={String(stats.total)} sub={`em ${days} dias`} tone="navy" icon={<Mail className="h-5 w-5" />} />
        <Stat label="Enviados" value={String(stats.sent)} tone="success" icon={<CheckCircle2 className="h-5 w-5" />} />
        <Stat label="Pulados" value={String(stats.skipped)} sub="quiet hours, vazios, idempotência" tone="neutral" icon={<MinusCircle className="h-5 w-5" />} />
        <Stat label="Falharam" value={String(stats.failed)} tone={stats.failed > 0 ? 'error' : 'neutral'} icon={<XCircle className="h-5 w-5" />} />
      </div>

      {/* Stats por dia (sparkline) */}
      {dailyStats.length > 1 && (
        <Card className="mb-4 p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Distribuição diária</h3>
            <button onClick={() => { refetch(); refetchStats(); }} className="flex items-center gap-1 text-xs text-slate-500 hover:text-navy">
              <RefreshCw className="h-3 w-3" />Atualizar
            </button>
          </div>
          <DigestsDailyChart data={dailyStats} />
        </Card>
      )}

      {/* Filtros */}
      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Field label="Período">
            <Select value={days} onChange={(e) => setDays(e.target.value)} options={DATE_OPTIONS} />
          </Field>
          <Field label="Status">
            <Select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              placeholder="Todos"
              options={[
                { value: 'sent',    label: 'Enviado' },
                { value: 'skipped', label: 'Pulado' },
                { value: 'failed',  label: 'Falhou' },
              ]}
            />
          </Field>
          <div className="self-end text-xs text-slate-500 dark:text-slate-400">
            <Calendar className="mr-1 inline h-3.5 w-3.5" />
            Desde {dt(dateFromIso)}
          </div>
        </div>
      </Card>

      {isLoading && <Card className="p-6"><Skeleton className="h-64" /></Card>}
      {!isLoading && filtered.length === 0 && (
        <Empty title="Sem envios no período" body="Nenhum digest_daily foi processado nesse intervalo." />
      )}

      {filtered.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Data/hora</th>
                  <th>Destinatário</th>
                  <th>Status</th>
                  <th className="text-right">Aprovações</th>
                  <th className="text-right">GRDs</th>
                  <th className="text-right">Pendências high</th>
                  <th className="text-right">Críticos</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((h) => {
                  const meta = STATUS_META[h.email_status];
                  const Icon = meta.icon;
                  return (
                    <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark">
                      <td className="text-xs">
                        <p className="font-mono dark:text-slate-200">{dt(h.sent_date)}</p>
                        <p className="text-slate-500">{dtTime(h.sent_at)}</p>
                      </td>
                      <td>
                        <p className="font-medium dark:text-slate-100">{h.member_nome || '—'}</p>
                        <p className="text-xs text-slate-500">{h.member_email}</p>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1">
                          <Icon className={`h-3.5 w-3.5 ${meta.tone === 'green' ? 'text-success' : meta.tone === 'red' ? 'text-error' : 'text-slate-500'}`} />
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </span>
                      </td>
                      <td className="text-right font-mono tabular text-sm">{h.aprovacoes}</td>
                      <td className="text-right font-mono tabular text-sm">{h.grds}</td>
                      <td className={`text-right font-mono tabular text-sm ${h.pendencias_high > 0 ? 'text-error' : ''}`}>{h.pendencias_high}</td>
                      <td className={`text-right font-mono tabular text-sm ${h.criticos > 0 ? 'text-error' : ''}`}>{h.criticos}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Layout>
  );
}

function DigestsDailyChart({ data }: { data: Array<{ sent_date: string; total: number; enviados: number; pulados: number; falharam: number }> }) {
  if (data.length < 2) return null;
  const W = 720;
  const H = 100;
  const PAD = { top: 8, right: 8, bottom: 22, left: 28 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const maxV = Math.max(1, ...data.map((d) => d.total));
  const barW = innerW / data.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-full" style={{ minWidth: 480 }}>
      {[0, Math.round(maxV / 2), maxV].map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH - (v / maxV) * innerH} y2={PAD.top + innerH - (v / maxV) * innerH} stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeWidth={0.5} strokeDasharray="2 3" />
          <text x={PAD.left - 4} y={PAD.top + innerH - (v / maxV) * innerH + 3} textAnchor="end" fontSize="8" className="fill-slate-500 dark:fill-slate-400">{v}</text>
        </g>
      ))}

      {data.map((d, i) => {
        const x = PAD.left + i * barW;
        const sentH = (d.enviados / maxV) * innerH;
        const skipH = (d.pulados / maxV)  * innerH;
        const failH = (d.falharam / maxV) * innerH;
        const baseY = PAD.top + innerH;
        return (
          <g key={d.sent_date}>
            <rect x={x + barW * 0.15} y={baseY - sentH} width={barW * 0.7} height={sentH} fill="#16a34a">
              <title>{`${d.sent_date}: ${d.enviados} enviado(s)`}</title>
            </rect>
            {skipH > 0 && (
              <rect x={x + barW * 0.15} y={baseY - sentH - skipH} width={barW * 0.7} height={skipH} fill="#94a3b8" opacity={0.7}>
                <title>{`${d.pulados} pulado(s)`}</title>
              </rect>
            )}
            {failH > 0 && (
              <rect x={x + barW * 0.15} y={baseY - sentH - skipH - failH} width={barW * 0.7} height={failH} fill="#ef4444">
                <title>{`${d.falharam} falha(s)`}</title>
              </rect>
            )}
          </g>
        );
      })}

      {data.map((d, i) => {
        if (data.length > 8 && i % Math.ceil(data.length / 6) !== 0) return null;
        const dtObj = new Date(d.sent_date + 'T00:00:00');
        const label = `${String(dtObj.getDate()).padStart(2, '0')}/${String(dtObj.getMonth() + 1).padStart(2, '0')}`;
        return (
          <text key={d.sent_date} x={PAD.left + i * barW + barW / 2} y={H - 6} textAnchor="middle" fontSize="8" className="fill-slate-500 dark:fill-slate-400">{label}</text>
        );
      })}

      {/* Legenda */}
      <g transform={`translate(${W - 180}, 6)`}>
        <rect x={0}  y={0} width={8} height={8} fill="#16a34a" /><text x={12} y={7} fontSize="8" className="fill-slate-600 dark:fill-slate-300">Enviado</text>
        <rect x={56} y={0} width={8} height={8} fill="#94a3b8" /><text x={68} y={7} fontSize="8" className="fill-slate-600 dark:fill-slate-300">Pulado</text>
        <rect x={108} y={0} width={8} height={8} fill="#ef4444" /><text x={120} y={7} fontSize="8" className="fill-slate-600 dark:fill-slate-300">Falhou</text>
      </g>
    </svg>
  );
}
