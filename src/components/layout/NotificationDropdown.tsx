import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, ExternalLink, Inbox, Megaphone, AlertCircle, Info, ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { listNotifications, markNotificationRead, markAllNotificationsRead, REALTIME_ALERT_KIND_LABELS } from '../../lib/api';
import type { RealtimeAlert } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeAlerts } from '../../hooks/useRealtimeAlerts';
import { relativeTime } from '../../lib/format';
import { Button } from '../ui/Button';

const KIND_LABEL: Record<string, string> = {
  info:                          'Informativos',
  warning:                       'Atenção',
  system:                        'Urgentes do sistema',
  measurement_approval_pending:  'Medições aguardando',
  measurement_decided:           'Medições decididas',
  grd_received:                  'GRDs recebidos',
  unforeseen_decision_pending:   'Itens não previstos',
  additive_approval_pending:     'Aditivos aguardando',
  pendency_high:                 'Pendências altas',
  risk_critico:                  'Riscos críticos',
  digest_daily:                  'Resumos diários',
};

const COLLAPSE_KEY = 'geocon:bell:collapsed';

function loadCollapsed(): Set<string> {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(COLLAPSE_KEY) : null;
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsed(s: Set<string>) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...s]));
  } catch { /* no-op */ }
}

function kindIcon(kind: string) {
  if (kind === 'system')  return <AlertCircle className="h-3.5 w-3.5 text-error" />;
  if (kind === 'warning') return <AlertCircle className="h-3.5 w-3.5 text-amber-500" />;
  return <Info className="h-3.5 w-3.5 text-purple dark:text-purple-300" />;
}

function kindRank(k: string): number {
  if (k === 'system')  return 0;
  if (k === 'warning') return 1;
  if (k === 'info')    return 2;
  return 3;
}

export function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());
  const wrapRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  function toggleCollapsed(kind: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      saveCollapsed(next);
      return next;
    });
  }

  const { data = [], isLoading } = useQuery({
    queryKey: ['notifications'], queryFn: listNotifications,
    refetchInterval: 60_000,
  });

  // V53: realtime alerts integration
  const { member } = useAuth();
  const tenantId = member?.tenant_id ?? null;
  const { alerts: realtimeAlerts, dismiss: dismissRealtime, dismissAll: dismissAllRealtime } = useRealtimeAlerts(tenantId);

  const unread = data.filter((n) => !n.read_at);
  const unreadCount = unread.length;
  const realtimeCount = realtimeAlerts.length;
  const totalCount = unreadCount + realtimeCount;
  // Top-N de não-lidas com cap, agrupadas por kind
  const MAX = 8;
  const recentUnread = unread.slice(0, MAX);

  const grouped = useMemo(() => {
    const map = recentUnread.reduce((acc, n) => {
      const k = (n.kind || 'info') as string;
      (acc[k] = acc[k] || []).push(n);
      return acc;
    }, {} as Record<string, typeof recentUnread>);
    const order = Object.keys(map).sort((a, b) => kindRank(a) - kindRank(b));
    return { map, order };
  }, [recentUnread]);

  const markOne = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Fechar ao clicar fora
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-2 hover:bg-slate-100 dark:hover:bg-muted-dark"
        aria-label={`Notificações (${totalCount} pendentes${realtimeCount > 0 ? ', ' + realtimeCount + ' em tempo real' : ''})`}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5 text-slate-600 dark:text-slate-300" />
        {totalCount > 0 && (
          <span
            className={`absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white ${
              realtimeCount > 0 ? 'bg-error animate-pulse' : 'bg-magenta'
            }`}
          >
            {totalCount > 9 ? '9+' : totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-border-dark dark:bg-card-dark">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-border-dark">
            <div>
              <p className="font-semibold dark:text-slate-100">Notificações</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {realtimeCount > 0 && (
                  <span className="font-mono text-error">{realtimeCount} ao vivo · </span>
                )}
                {unreadCount} não {unreadCount === 1 ? 'lida' : 'lidas'} · {data.length} {data.length === 1 ? 'total' : 'totais'}
              </p>
            </div>
            {unreadCount > 0 && (
              <Button size="sm" variant="ghost" onClick={() => markAll.mutate()} loading={markAll.isPending}>
                <CheckCircle2 className="h-3.5 w-3.5" />Todas lidas
              </Button>
            )}
          </header>

          <div className="max-h-[28rem] overflow-y-auto">
            {/* V53: Realtime alerts section — sempre no topo, separada das notifications */}
            {realtimeCount > 0 && (
              <section>
                <div className="flex items-center justify-between border-b border-error/20 bg-error/5 px-3 py-1.5 dark:bg-error/10">
                  <div className="flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-error" />
                    <span className="text-[10px] font-mono font-bold uppercase tracking-display text-error">
                      Lei 14.133 · ao vivo · {realtimeCount}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void dismissAllRealtime()}
                    className="font-mono text-[10px] uppercase tracking-display text-error/80 hover:text-error hover:underline"
                  >
                    Dismissar todos
                  </button>
                </div>
                <ul className="divide-y divide-error/10">
                  {realtimeAlerts.map((a) => (
                    <RealtimeAlertRow
                      key={a.id}
                      alert={a}
                      onDismiss={() => void dismissRealtime(a.id)}
                      onNavigate={() => setOpen(false)}
                    />
                  ))}
                </ul>
              </section>
            )}
            {isLoading && <div className="p-6 text-center text-sm text-slate-500">Carregando…</div>}
            {!isLoading && recentUnread.length === 0 && realtimeCount === 0 && (
              <div className="px-4 py-8 text-center">
                <Inbox className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Nenhuma notificação não lida</p>
              </div>
            )}

            {recentUnread.length > 0 && grouped.order.map((kind) => {
              const items = grouped.map[kind];
              const isCollapsed = collapsed.has(kind);
              return (
                <section key={kind}>
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(kind)}
                    className="flex w-full items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-1.5 text-left hover:bg-slate-100 dark:border-border-dark dark:bg-muted-dark/40 dark:hover:bg-muted-dark/70"
                    aria-expanded={!isCollapsed}
                  >
                    <div className="flex items-center gap-1.5">
                      {isCollapsed
                        ? <ChevronRight className="h-3 w-3 text-slate-400" />
                        : <ChevronDown  className="h-3 w-3 text-slate-400" />}
                      {kindIcon(kind)}
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-600 dark:text-slate-300">
                        {KIND_LABEL[kind] || kind}
                      </p>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-magenta px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">
                      {items.length} {items.length === 1 ? 'nova' : 'novas'}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <ul className="divide-y divide-slate-100 dark:divide-border-dark">
                      {items.map((n) => {
                        const isBroadcast = n.metadata && (n.metadata as Record<string, unknown>).broadcast === true;
                        return (
                          <li key={n.id} className="px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-muted-dark/40">
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <p className="truncate text-sm font-medium dark:text-slate-100">{n.title}</p>
                                  {isBroadcast && (
                                    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-purple-100 px-1 py-0.5 text-[9px] font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">
                                      <Megaphone className="h-2 w-2" />Broadcast
                                    </span>
                                  )}
                                </div>
                                {n.body && <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{n.body}</p>}
                                <div className="mt-1 flex items-center gap-3 text-xs">
                                  <span className="text-slate-400">{relativeTime(n.created_at)}</span>
                                  {n.link && (
                                    <Link
                                      to={n.link}
                                      onClick={() => { markOne.mutate(n.id); setOpen(false); }}
                                      className="inline-flex items-center gap-1 text-navy hover:underline dark:text-purple-300"
                                    >
                                      Abrir <ExternalLink className="h-3 w-3" />
                                    </Link>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => markOne.mutate(n.id)}
                                    className="text-slate-500 hover:text-navy dark:hover:text-purple-300"
                                  >
                                    Marcar lida
                                  </button>
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}

            {unread.length > MAX && (
              <div className="border-t border-slate-100 px-4 py-2 text-center text-[11px] text-slate-500 dark:border-border-dark dark:text-slate-400">
                +{unread.length - MAX} outras não lidas
              </div>
            )}
          </div>

          <footer className="border-t border-slate-100 px-4 py-2 text-center dark:border-border-dark">
            <Link to="/notifications" onClick={() => setOpen(false)}
                  className="text-xs font-medium text-navy hover:underline dark:text-purple-300">
              Ver todas
            </Link>
          </footer>
        </div>
      )}
    </div>
  );
}

// V53: linha individual de realtime alert no dropdown
function RealtimeAlertRow({
  alert, onDismiss, onNavigate,
}: {
  alert: RealtimeAlert;
  onDismiss: () => void;
  onNavigate: () => void;
}) {
  const dotTone = alert.severity === 'danger' ? 'bg-error' : 'bg-yellow-500';
  return (
    <li className="px-3 py-2 hover:bg-error/5 dark:hover:bg-error/10">
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotTone}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[9px] uppercase tracking-display text-error/80">
              {REALTIME_ALERT_KIND_LABELS[alert.alert_kind]}
              {alert.contract_numero && (
                <span className="ml-1 normal-case tracking-normal text-slate-500 dark:text-slate-400">
                  · {alert.contract_numero}
                </span>
              )}
            </p>
            <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
              {relativeTime(alert.created_at)}
            </span>
          </div>
          <p className="mt-0.5 text-sm font-medium leading-tight text-slate-900 dark:text-slate-100">
            {alert.title}
          </p>
          {alert.body && (
            <p className="mt-0.5 text-xs leading-snug text-slate-600 dark:text-slate-400 line-clamp-2">
              {alert.body}
            </p>
          )}
          <div className="mt-1 flex items-center gap-2">
            {alert.ref_link && (
              <Link
                to={alert.ref_link}
                onClick={() => { onNavigate(); onDismiss(); }}
                className="inline-flex items-center gap-1 text-xs font-medium text-navy hover:underline dark:text-purple-300"
              >
                Ver <ExternalLink className="h-3 w-3" />
              </Link>
            )}
            <button
              type="button"
              onClick={onDismiss}
              className="ml-auto font-mono text-[10px] uppercase tracking-display text-slate-500 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
            >
              Dismissar
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
