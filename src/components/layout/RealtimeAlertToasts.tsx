import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, AlertOctagon, X, ExternalLink } from 'lucide-react';
import type { RealtimeAlert } from '../../lib/api';
import { REALTIME_ALERT_KIND_LABELS } from '../../lib/api';
import { useRealtimeAlerts } from '../../hooks/useRealtimeAlerts';
import { useAuth } from '../../hooks/useAuth';

/**
 * V52 — Container global de toasts para alertas Lei 14.133 em tempo real.
 *
 * Comportamento:
 *   - Stack vertical canto inferior direito (até 3 visíveis; resto fica
 *     contado em "+N mais")
 *   - Cada toast renderiza por 12s e desliza para fora (auto-dismiss visual
 *     sem dismissar no servidor — só remove da fila local)
 *   - Click no X dismissa permanentemente (chama dismissRealtimeAlert)
 *   - Click em "Ver" navega para o ref_link
 *
 * Montado uma vez em <Layout>; lê tenant_id de useAuth.
 */
export function RealtimeAlertToasts() {
  const { member } = useAuth();
  const tenantId = member?.tenant_id ?? null;
  const { alerts, dismiss, dismissAll } = useRealtimeAlerts(tenantId);

  // Auto-hide local (sem dismissar no servidor) após 12s para cada alerta
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    for (const a of alerts) {
      if (hidden.has(a.id)) continue;
      const elapsed = Date.now() - new Date(a.created_at).getTime();
      const remaining = Math.max(0, 12000 - elapsed);
      if (remaining === 0) {
        // já passou — não mostra
        setHidden((prev) => new Set(prev).add(a.id));
      } else {
        const t = setTimeout(() => {
          setHidden((prev) => new Set(prev).add(a.id));
        }, remaining);
        timers.push(t);
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [alerts, hidden]);

  const visible = alerts.filter((a) => !hidden.has(a.id));
  if (visible.length === 0) return null;

  const top = visible.slice(0, 3);
  const overflow = visible.length - top.length;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
      role="region"
      aria-label="Alertas Lei 14.133 em tempo real"
    >
      {overflow > 0 && (
        <div className="pointer-events-auto flex items-center justify-between rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur dark:border-border-dark dark:bg-card-dark/95">
          <span className="font-mono text-slate-600 dark:text-slate-300">
            +{overflow} alerta{overflow === 1 ? '' : 's'} adicional{overflow === 1 ? '' : 'is'}
          </span>
          <button
            type="button"
            onClick={() => void dismissAll()}
            className="font-mono text-[10px] uppercase tracking-display text-navy hover:underline dark:text-purple-300"
          >
            Limpar todos
          </button>
        </div>
      )}
      {top.map((a) => (
        <ToastCard
          key={a.id}
          alert={a}
          onDismiss={() => void dismiss(a.id)}
          onHide={() => setHidden((prev) => new Set(prev).add(a.id))}
        />
      ))}
    </div>
  );
}

function ToastCard({
  alert, onDismiss, onHide,
}: {
  alert: RealtimeAlert;
  onDismiss: () => void;
  onHide: () => void;
}) {
  const Icon = alert.severity === 'danger' ? AlertOctagon : AlertTriangle;
  const tone = alert.severity === 'danger'
    ? 'border-error/30 bg-error/5 dark:bg-error/10'
    : 'border-yellow-400/30 bg-yellow-50 dark:bg-yellow-900/15';
  const iconTone = alert.severity === 'danger'
    ? 'text-error'
    : 'text-yellow-700 dark:text-yellow-300';

  return (
    <div
      className={`pointer-events-auto toast-realtime-enter rounded-lg border ${tone} p-3 shadow-lg backdrop-blur-sm`}
      role="alert"
    >
      <div className="flex gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconTone}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-mono text-[9px] uppercase tracking-display text-slate-500 dark:text-slate-400">
              {REALTIME_ALERT_KIND_LABELS[alert.alert_kind]}
              {alert.contract_numero && (
                <span className="ml-1 normal-case tracking-normal">· {alert.contract_numero}</span>
              )}
            </p>
            <button
              type="button"
              onClick={onDismiss}
              className="-mr-1 -mt-1 rounded p-0.5 text-slate-400 hover:bg-slate-200/40 hover:text-slate-700 dark:hover:bg-slate-800/40 dark:hover:text-slate-200"
              aria-label="Dismissar alerta"
              title="Dismissar permanentemente"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-0.5 text-sm font-semibold leading-tight text-slate-900 dark:text-slate-100">
            {alert.title}
          </p>
          {alert.body && (
            <p className="mt-1 text-xs leading-snug text-slate-600 dark:text-slate-400 line-clamp-2">
              {alert.body}
            </p>
          )}
          {alert.ref_link && (
            <div className="mt-2 flex items-center gap-2">
              <Link
                to={alert.ref_link}
                onClick={onHide}
                className="inline-flex items-center gap-1 text-xs font-medium text-navy hover:underline dark:text-purple-300"
              >
                Ver detalhes <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
