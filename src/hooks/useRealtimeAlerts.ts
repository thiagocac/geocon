import { useEffect, useState, useCallback } from 'react';
import {
  type RealtimeAlert,
  listUndismissedRealtimeAlerts,
  dismissRealtimeAlert,
  dismissAllRealtimeAlerts,
  subscribeToRealtimeAlerts,
} from '../lib/api';

/**
 * V52 — Hook que sincroniza alertas em tempo real Lei 14.133.
 *
 * Fluxo:
 *   1. Busca alertas iniciais (não-dismissados) na montagem
 *   2. Subscribe via Realtime channel filtrado por tenant_id
 *   3. Acumula novos alertas no array `alerts`
 *   4. Expõe ações `dismiss(id)` e `dismissAll()` que removem da lista local
 *      E persistem via RPC
 *
 * Cleanup do channel acontece automaticamente no unmount.
 */
export function useRealtimeAlerts(tenantId: string | null) {
  const [alerts, setAlerts] = useState<RealtimeAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch inicial
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    listUndismissedRealtimeAlerts()
      .then((data) => {
        if (!cancelled) {
          setAlerts(data);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  // Subscribe
  useEffect(() => {
    const unsubscribe = subscribeToRealtimeAlerts(tenantId, (alert) => {
      setAlerts((prev) => {
        // Dedupe por id (caso fetch inicial e Realtime entreguem o mesmo)
        if (prev.some((a) => a.id === alert.id)) return prev;
        return [alert, ...prev];
      });
    });
    return unsubscribe;
  }, [tenantId]);

  const dismiss = useCallback(async (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    try { await dismissRealtimeAlert(id); } catch { /* fila local já removeu; servidor falhou silenciosamente */ }
  }, []);

  const dismissAll = useCallback(async () => {
    setAlerts([]);
    try { await dismissAllRealtimeAlerts(); } catch { /* ditto */ }
  }, []);

  return { alerts, isLoading, dismiss, dismissAll };
}
