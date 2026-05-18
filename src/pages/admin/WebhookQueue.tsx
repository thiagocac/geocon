import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity, Clock, CheckCircle2, AlertTriangle, RefreshCw, RotateCcw,
  Inbox, Eye, ChevronRight, Send, Download,
} from 'lucide-react';
import {
  tenantWebhookQueueStats, listWebhookQueueEvents, requeueWebhookEvent,
  bulkRequeueWebhookEvents,
  enqueueWebhookTest, exportDeadLetterEvents, deadLetterRowsToCsv,
  listTenantWebhooks,
  type WebhookQueueStatus, type WebhookQueueEvent, type TenantWebhook,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { dtTime, relativeTime } from '../../lib/format';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Skeleton, Empty } from '../../components/ui/Stat';

const EVENT_LABEL: Record<string, string> = {
  broadcast_sent:       'Broadcast enviado',
  risk_critico_changed: 'Risco virou crítico',
  measurement_emitted:  'Medição emitida',
  measurement_decided:  'Medição decidida',
  additive_approved:    'Aditivo aprovado',
  unforeseen_pending:   'Item não previsto',
  digest_failed:        'Digest falhou',
};

function eventTone(ev: string): 'red' | 'purple' | 'green' | 'blue' {
  if (ev === 'risk_critico_changed') return 'red';
  if (ev === 'measurement_decided')  return 'purple';
  if (ev === 'additive_approved')    return 'green';
  return 'blue';
}

function StatusFilter({ value, onChange, counts }: {
  value: WebhookQueueStatus | 'all';
  onChange: (v: WebhookQueueStatus | 'all') => void;
  counts: { pending: number; processed: number; dead: number };
}) {
  const opts: Array<{ v: WebhookQueueStatus | 'all'; label: string; n?: number; tone?: string }> = [
    { v: 'all',       label: 'Todos' },
    { v: 'pending',   label: 'Pendentes', n: counts.pending,   tone: 'text-amber-600 dark:text-amber-300' },
    { v: 'processed', label: 'Processados', n: counts.processed, tone: 'text-success' },
    { v: 'dead',      label: 'Dead letter', n: counts.dead,    tone: 'text-error' },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
            value === o.v
              ? 'border-magenta bg-magenta text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:border-magenta dark:border-border-dark dark:bg-card-dark dark:text-slate-200'
          }`}
        >
          {o.label}
          {typeof o.n === 'number' && (
            <span className={`font-mono text-[10px] ${value === o.v ? 'opacity-80' : o.tone || 'text-slate-400'}`}>
              {o.n}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function AdminWebhookQueue() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<WebhookQueueStatus | 'all'>('pending');
  const [inspectEvent, setInspectEvent] = useState<WebhookQueueEvent | null>(null);
  // V28: test-against-webhook flow
  const [testSource, setTestSource] = useState<WebhookQueueEvent | null>(null);
  const [testTargetId, setTestTargetId] = useState<string>('');
  const [testFeedback, setTestFeedback] = useState<{ status: 'ok' | 'error'; message: string } | null>(null);

  const { data: stats } = useQuery({
    queryKey: ['webhook-queue-stats'],
    queryFn: tenantWebhookQueueStats,
    refetchInterval: 15_000,
  });

  const { data: events = [], isLoading, error, refetch } = useQuery({
    queryKey: ['webhook-queue-events', statusFilter],
    queryFn: () => listWebhookQueueEvents(
      statusFilter === 'all' ? undefined : statusFilter,
      100,
    ),
    refetchInterval: 15_000,
  });

  // V28: lista de webhooks ativos do tenant (pra picker do test dispatch)
  const { data: webhooks = [] } = useQuery({
    queryKey: ['tenant-webhooks'],
    queryFn: listTenantWebhooks,
    enabled: !!testSource,  // só carrega quando admin abre o modal
  });

  const mRequeue = useMutation({
    mutationFn: requeueWebhookEvent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhook-queue-events'] });
      qc.invalidateQueries({ queryKey: ['webhook-queue-stats'] });
    },
  });

  // V29: bulk requeue
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const mBulkRequeue = useMutation({
    mutationFn: bulkRequeueWebhookEvents,
    onSuccess: (count) => {
      setTestFeedback({
        status: 'ok',
        message: `${count} ${count === 1 ? 'evento re-enfileirado' : 'eventos re-enfileirados'}.`,
      });
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ['webhook-queue-events'] });
      qc.invalidateQueries({ queryKey: ['webhook-queue-stats'] });
    },
    onError: (err) => setTestFeedback({ status: 'error', message: humanizeError(err) }),
  });

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllInPage(deadIds: string[]) {
    setSelectedIds((prev) => {
      const allSelected = deadIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) deadIds.forEach((id) => next.delete(id));
      else deadIds.forEach((id) => next.add(id));
      return next;
    });
  }

  const mTestDispatch = useMutation({
    mutationFn: ({ source, target }: { source: string; target: string }) =>
      enqueueWebhookTest(source, target),
    onSuccess: () => {
      setTestFeedback({
        status: 'ok',
        message: 'Re-envio enfileirado. EF dispatch-single-event processa no próximo minuto.',
      });
      qc.invalidateQueries({ queryKey: ['webhook-queue-events'] });
      qc.invalidateQueries({ queryKey: ['webhook-queue-stats'] });
    },
    onError: (err) => setTestFeedback({ status: 'error', message: humanizeError(err) }),
  });

  async function handleExportCsv() {
    try {
      const rows = await exportDeadLetterEvents();
      if (rows.length === 0) {
        setTestFeedback({ status: 'error', message: 'Nenhum evento em dead-letter para exportar.' });
        return;
      }
      const csv = deadLetterRowsToCsv(rows);
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `webhook-dead-letter-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setTestFeedback({ status: 'error', message: humanizeError(err as Error) });
    }
  }

  const counts = {
    pending: (stats?.due_now ?? 0) + (stats?.waiting_backoff ?? 0),
    processed: stats?.processed ?? 0,
    dead: stats?.dead_letter ?? 0,
  };

  return (
    <>
      <Layout>
        <PageHeader
          kicker="Administração · Integrações"
          title="Fila de eventos"
          subtitle="Eventos de domínio (risco, medições, aditivos) aguardando entrega via webhook"
          backTo="/admin"
          backLabel="Admin"
          actions={
            <div className="flex gap-2">
              {(stats?.dead_letter ?? 0) > 0 && (
                <Button variant="outline" onClick={handleExportCsv}>
                  <Download className="h-4 w-4" />Exportar dead-letter
                </Button>
              )}
              <Button variant="outline" onClick={() => refetch()} loading={isLoading}>
                <RefreshCw className="h-4 w-4" />Recarregar
              </Button>
            </div>
          }
        />

        {/* KPIs */}
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <Card densityAware className="p-4">
            <div className="flex items-start justify-between">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Prontos pra disparo
              </p>
              {stats && stats.due_now > 0 && <Clock className="h-4 w-4 text-amber-500" />}
            </div>
            <p className="mt-1 text-2xl font-bold tabular dark:text-slate-100">
              {stats?.due_now ?? 0}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">aguardando próximo drain</p>
          </Card>
          <Card densityAware className="p-4">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
              Em backoff
            </p>
            <p className="mt-1 text-2xl font-bold tabular text-amber-600 dark:text-amber-300">
              {stats?.waiting_backoff ?? 0}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">falharam — vão re-tentar</p>
          </Card>
          <Card densityAware className="p-4">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
              Processados
            </p>
            <p className="mt-1 text-2xl font-bold tabular text-success">{stats?.processed ?? 0}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">entregues com sucesso</p>
          </Card>
          <Card densityAware className="p-4">
            <div className="flex items-start justify-between">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
                Dead letter
              </p>
              {stats && stats.dead_letter > 0 && <AlertTriangle className="h-4 w-4 text-error" />}
            </div>
            <p className={`mt-1 text-2xl font-bold tabular ${(stats?.dead_letter ?? 0) > 0 ? 'text-error' : 'text-slate-500'}`}>
              {stats?.dead_letter ?? 0}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">5 falhas — exige requeue</p>
          </Card>
        </div>

        {/* Stats por tipo de evento */}
        {stats && (stats.risk_critico_total > 0 || stats.measurement_decided_total > 0 || stats.additive_approved_total > 0) && (
          <Card className="mb-4 p-4">
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500 dark:text-slate-400">
              Total histórico por evento
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 dark:bg-red-900/15">
                <span className="text-xs font-medium text-red-700 dark:text-red-200">Riscos críticos</span>
                <span className="font-mono text-sm font-bold tabular text-red-700 dark:text-red-200">
                  {stats.risk_critico_total}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-purple-50 px-3 py-2 dark:bg-purple-900/15">
                <span className="text-xs font-medium text-purple-700 dark:text-purple-200">Medições decididas</span>
                <span className="font-mono text-sm font-bold tabular text-purple-700 dark:text-purple-200">
                  {stats.measurement_decided_total}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2 dark:bg-green-900/15">
                <span className="text-xs font-medium text-green-700 dark:text-green-200">Aditivos aprovados</span>
                <span className="font-mono text-sm font-bold tabular text-green-700 dark:text-green-200">
                  {stats.additive_approved_total}
                </span>
              </div>
            </div>
          </Card>
        )}

        {/* Filtros + lista */}
        <Card className="mb-3 p-4">
          <StatusFilter value={statusFilter} onChange={setStatusFilter} counts={counts} />
        </Card>

        {isLoading && <Card className="p-6"><Skeleton className="h-48" /></Card>}
        {error && (
          <Card className="border-error/30 bg-error/5 p-4 text-sm text-error">
            {humanizeError(error as Error)}
          </Card>
        )}
        {!isLoading && !error && events.length === 0 && (
          <Empty
            title={statusFilter === 'pending' ? 'Sem eventos pendentes' : 'Nenhum evento'}
            body={statusFilter === 'pending'
              ? 'A fila está vazia. Triggers de domínio gravam aqui quando algo acontece (risk_critico, measurement_decided, additive_approved).'
              : 'Refine o filtro pra ver outros estados.'}
          />
        )}

        {events.length > 0 && (() => {
          const deadIdsOnPage = events.filter((e) => !e.processed_at && e.attempts >= 5).map((e) => e.id);
          const allDeadSelected = deadIdsOnPage.length > 0 && deadIdsOnPage.every((id) => selectedIds.has(id));
          const someDeadSelected = deadIdsOnPage.length > 0 && deadIdsOnPage.some((id) => selectedIds.has(id));
          return (
            <>
              {/* V29: toolbar de bulk requeue */}
              {selectedIds.size > 0 && (
                <Card className="mb-3 border-magenta/30 bg-magenta/5 p-3 dark:bg-magenta/10">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium dark:text-slate-200">
                      {selectedIds.size} {selectedIds.size === 1 ? 'selecionado' : 'selecionados'}
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>
                        Limpar
                      </Button>
                      <Button
                        size="sm"
                        loading={mBulkRequeue.isPending}
                        onClick={() => mBulkRequeue.mutate([...selectedIds])}
                      >
                        <RotateCcw className="h-4 w-4" />Re-enfileirar {selectedIds.size}
                      </Button>
                    </div>
                  </div>
                </Card>
              )}

              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="w-8">
                          {deadIdsOnPage.length > 0 && (
                            <input
                              type="checkbox"
                              checked={allDeadSelected}
                              ref={(el) => { if (el) el.indeterminate = someDeadSelected && !allDeadSelected; }}
                              onChange={() => toggleAllInPage(deadIdsOnPage)}
                              className="h-4 w-4 rounded border-slate-300 text-magenta focus:ring-magenta"
                              aria-label={`Selecionar todos os ${deadIdsOnPage.length} eventos em dead-letter da página`}
                              title="Selecionar todos os dead-letter da página"
                            />
                          )}
                        </th>
                        <th>Evento</th>
                        <th className="hidden md:table-cell">Entidade</th>
                        <th>Enfileirado</th>
                        <th>Status</th>
                        <th className="hidden md:table-cell">Tentativas</th>
                        <th className="hidden lg:table-cell">Próximo retry</th>
                        <th className="w-24"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((e) => {
                        const isProcessed = !!e.processed_at;
                        const isDead = !isProcessed && e.attempts >= 5;
                        const isBackoff = !isProcessed && e.attempts > 0 && new Date(e.next_attempt_at) > new Date();
                        return (
                          <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-muted-dark/40">
                            <td>
                              {isDead && (
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(e.id)}
                                  onChange={() => toggleSelected(e.id)}
                                  className="h-4 w-4 rounded border-slate-300 text-magenta focus:ring-magenta"
                                  aria-label={`Selecionar evento ${e.event}`}
                                />
                              )}
                            </td>
                            <td>
                              <Badge tone={eventTone(e.event)}>{EVENT_LABEL[e.event] || e.event}</Badge>
                            </td>
                            <td className="hidden md:table-cell text-xs text-slate-600 dark:text-slate-300">
                              <code className="font-mono">{e.entity_type}/{e.entity_id.slice(0, 8)}</code>
                            </td>
                        <td>
                          <div className="text-xs">
                            <p className="dark:text-slate-200">{relativeTime(e.enqueued_at)}</p>
                            <p className="font-mono text-[10px] text-slate-400">{dtTime(e.enqueued_at)}</p>
                          </div>
                        </td>
                        <td>
                          {isProcessed && <Badge tone="green">✓ Processado</Badge>}
                          {isDead && <Badge tone="red">Dead letter</Badge>}
                          {isBackoff && <Badge tone="yellow">Em backoff</Badge>}
                          {!isProcessed && !isDead && !isBackoff && <Badge tone="blue">Pendente</Badge>}
                          {e.last_error && (
                            <p className="mt-1 line-clamp-1 font-mono text-[10px] text-error" title={e.last_error}>
                              {e.last_error}
                            </p>
                          )}
                        </td>
                        <td className="hidden md:table-cell text-center">
                          <span className={`font-mono tabular text-sm font-semibold ${e.attempts >= 5 ? 'text-error' : e.attempts > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-slate-500'}`}>
                            {e.attempts}/5
                          </span>
                        </td>
                        <td className="hidden lg:table-cell">
                          {isProcessed ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : isDead ? (
                            <span className="text-xs text-error">travado</span>
                          ) : (
                            <div className="text-xs">
                              <p className="dark:text-slate-300">{relativeTime(e.next_attempt_at)}</p>
                              <p className="font-mono text-[10px] text-slate-400">{dtTime(e.next_attempt_at)}</p>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setInspectEvent(e)}
                              className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-navy dark:hover:bg-muted-dark dark:hover:text-purple-300"
                              title="Inspecionar payload"
                              aria-label={`Inspecionar evento ${e.event}`}
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            {(isProcessed || isDead) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setTestSource(e);
                                  setTestTargetId('');
                                  setTestFeedback(null);
                                }}
                                className="rounded p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/15 dark:hover:text-blue-300"
                                title="Re-enviar pra um webhook específico (teste isolado)"
                                aria-label={`Re-enviar evento ${e.event} pra teste`}
                              >
                                <Send className="h-4 w-4" />
                              </button>
                            )}
                            {isDead && (
                              <button
                                type="button"
                                onClick={() => mRequeue.mutate(e.id)}
                                disabled={mRequeue.isPending}
                                className="rounded p-1.5 text-slate-500 hover:bg-magenta/10 hover:text-magenta"
                                title="Re-enfileirar pra todos os webhooks subscritos (reseta tentativas)"
                                aria-label={`Re-enfileirar evento ${e.event}`}
                              >
                                <RotateCcw className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
            </>
          );
        })()}

        {/* Doc do backoff */}
        <Card className="mt-6 p-4">
          <div className="flex items-start gap-3">
            <Activity className="mt-0.5 h-5 w-5 text-slate-500" />
            <div className="flex-1 text-sm">
              <p className="font-semibold dark:text-slate-200">Como funciona</p>
              <p className="mt-1 text-slate-600 dark:text-slate-400">
                Triggers de domínio gravam eventos aqui quando algo relevante acontece (snapshot de risco vira crítico,
                medição é decidida, aditivo é aprovado). A EF <code className="font-mono text-xs">drain-webhook-queue</code> roda
                a cada 1 minuto via pg_cron e processa eventos prontos.
              </p>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                <strong>Backoff exponencial:</strong> falhas re-tentam em 5min → 30min → 2h → 12h → 24h.
                Após 5 tentativas sem sucesso, o evento vai pra <strong>dead letter</strong> e exige requeue manual.
              </p>
            </div>
          </div>
        </Card>
      </Layout>

      {/* Modal de inspeção */}
      <Modal
        open={!!inspectEvent}
        onClose={() => setInspectEvent(null)}
        title={inspectEvent ? `Evento: ${EVENT_LABEL[inspectEvent.event] || inspectEvent.event}` : ''}
        subtitle={inspectEvent ? `${inspectEvent.entity_type}/${inspectEvent.entity_id}` : ''}
        size="lg"
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setInspectEvent(null)}>Fechar</Button>
          </div>
        }
      >
        {inspectEvent && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">Enfileirado</p>
                <p className="dark:text-slate-200">{dtTime(inspectEvent.enqueued_at)}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">Próximo retry</p>
                <p className="dark:text-slate-200">{inspectEvent.processed_at ? '—' : dtTime(inspectEvent.next_attempt_at)}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">Tentativas</p>
                <p className="dark:text-slate-200">{inspectEvent.attempts}/5</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">Processado em</p>
                <p className="dark:text-slate-200">{inspectEvent.processed_at ? dtTime(inspectEvent.processed_at) : '—'}</p>
              </div>
            </div>
            {inspectEvent.last_error && (
              <div className="rounded-lg border border-error/30 bg-error/5 p-3">
                <p className="font-mono text-[10px] uppercase tracking-display text-error">Último erro</p>
                <p className="mt-1 font-mono text-xs text-error">{inspectEvent.last_error}</p>
              </div>
            )}
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-display text-slate-500">Payload</p>
              <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] dark:border-border-dark dark:bg-muted-dark">
                {JSON.stringify(inspectEvent.payload, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>

      {/* V28: modal de teste isolado contra webhook específico */}
      <Modal
        open={!!testSource}
        onClose={() => { setTestSource(null); setTestTargetId(''); }}
        title="Re-enviar evento pra webhook específico"
        subtitle={testSource ? `Evento original: ${EVENT_LABEL[testSource.event] || testSource.event}` : ''}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setTestSource(null); setTestTargetId(''); }}>
              Cancelar
            </Button>
            <Button
              disabled={!testTargetId || mTestDispatch.isPending}
              loading={mTestDispatch.isPending}
              onClick={() => {
                if (testSource && testTargetId) {
                  mTestDispatch.mutate({ source: testSource.id, target: testTargetId });
                  setTestSource(null);
                  setTestTargetId('');
                }
              }}
            >
              <Send className="h-4 w-4" />Enfileirar re-envio
            </Button>
          </div>
        }
      >
        {testSource && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/15 dark:text-blue-200">
              Este re-envio vai pra <strong>um único webhook</strong> que você escolher, não pros outros
              subscritos. O payload original é mantido; uma nota <code>_test=true</code> é adicionada.
              Max 3 tentativas (sem backoff longo).
            </div>

            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-display text-slate-500">
                Webhook alvo
              </label>
              {webhooks.length === 0 ? (
                <p className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-border-dark">
                  Carregando webhooks…
                </p>
              ) : (
                <select
                  value={testTargetId}
                  onChange={(e) => setTestTargetId(e.target.value)}
                  className="input"
                >
                  <option value="">— Escolha um webhook —</option>
                  {(webhooks as TenantWebhook[]).filter((w) => w.active).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label} ({w.kind}) {(w.events as string[]).includes(testSource.event) ? '✓ subscrito' : '⚠ não subscrito'}
                    </option>
                  ))}
                </select>
              )}
              {testTargetId && (() => {
                const target = (webhooks as TenantWebhook[]).find((w) => w.id === testTargetId);
                if (target && !(target.events as string[]).includes(testSource.event)) {
                  return (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                      ⚠ Este webhook não está subscrito em <code>{testSource.event}</code>. O teste vai disparar
                      mesmo assim, mas em produção esse webhook não receberia esse tipo de evento.
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          </div>
        )}
      </Modal>

      {/* V28: feedback de test/export */}
      <Modal
        open={!!testFeedback}
        onClose={() => setTestFeedback(null)}
        title="Status"
        size="sm"
        footer={<div className="flex justify-end"><Button onClick={() => setTestFeedback(null)}>OK</Button></div>}
      >
        {testFeedback && (
          <div className={`rounded-lg border px-3 py-3 text-sm ${
            testFeedback.status === 'ok'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-error/30 bg-error/10 text-error'
          }`}>
            <div className="flex items-start gap-2">
              {testFeedback.status === 'ok'
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
                : <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />}
              <p>{testFeedback.message}</p>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
