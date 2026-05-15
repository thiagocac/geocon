import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, ExternalLink, Inbox } from 'lucide-react';
import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../../lib/api';
import { relativeTime } from '../../lib/format';
import { Button } from '../ui/Button';

export function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ['notifications'], queryFn: listNotifications,
    refetchInterval: 60_000,
  });

  const unread = data.filter((n) => !n.read_at);
  const recent = unread.slice(0, 5);
  const unreadCount = unread.length;

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
        aria-label={`Notificações (${unreadCount} não lidas)`}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5 text-slate-600 dark:text-slate-300" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-magenta px-1 text-[9px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-border-dark dark:bg-card-dark">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-border-dark">
            <div>
              <p className="font-semibold dark:text-slate-100">Notificações</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {unreadCount} não {unreadCount === 1 ? 'lida' : 'lidas'} · {data.length} {data.length === 1 ? 'total' : 'totais'}
              </p>
            </div>
            {unreadCount > 0 && (
              <Button size="sm" variant="ghost" onClick={() => markAll.mutate()} loading={markAll.isPending}>
                <CheckCircle2 className="h-3.5 w-3.5" />Todas lidas
              </Button>
            )}
          </header>

          <div className="max-h-96 overflow-y-auto">
            {isLoading && <div className="p-6 text-center text-sm text-slate-500">Carregando…</div>}
            {!isLoading && recent.length === 0 && (
              <div className="px-4 py-8 text-center">
                <Inbox className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Nenhuma notificação não lida</p>
              </div>
            )}
            {recent.length > 0 && (
              <ul className="divide-y divide-slate-100 dark:divide-border-dark">
                {recent.map((n) => (
                  <li key={n.id} className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-muted-dark/40">
                    <div className="flex items-start gap-2">
                      <Bell className="mt-0.5 h-4 w-4 flex-shrink-0 text-navy dark:text-purple-300" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium dark:text-slate-100">{n.title}</p>
                        {n.body && <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{n.body}</p>}
                        <div className="mt-1 flex items-center gap-3 text-xs">
                          <span className="text-slate-400">{relativeTime(n.created_at)}</span>
                          {n.link && (
                            <Link to={n.link} onClick={() => { markOne.mutate(n.id); setOpen(false); }}
                                  className="inline-flex items-center gap-1 text-navy hover:underline dark:text-purple-300">
                              Abrir <ExternalLink className="h-3 w-3" />
                            </Link>
                          )}
                          <button type="button" onClick={() => markOne.mutate(n.id)}
                                  className="text-slate-500 hover:text-navy dark:hover:text-purple-300">
                            Marcar lida
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
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
