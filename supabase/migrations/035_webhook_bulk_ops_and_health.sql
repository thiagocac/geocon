-- =============================================================================
-- 035_webhook_bulk_ops_and_health
-- =============================================================================
-- (A) RPC bulk_requeue_webhook_events(ids[]) — admin reseta múltiplos eventos
--     dead-letter de uma vez. Útil quando o problema foi um bug temporário
--     do destinatário que afetou N eventos.
--
-- (B) View v_webhook_health computa "health score" 0-100 baseado em:
--     - error_rate (40% peso): error_count / dispatch_count
--     - recency (30% peso): quanto tempo desde last_called_at
--     - reliability (30% peso): last_status='ok' + ausência de dead-letter
--     Mais 1 RPC tenant_webhook_health() pra UI consumir.
-- =============================================================================

-- =============================================================================
-- (A) Bulk requeue
-- =============================================================================
CREATE OR REPLACE FUNCTION public.bulk_requeue_webhook_events(p_ids uuid[])
RETURNS int  -- count de eventos requeueados
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_admin  boolean;
  v_count  int := 0;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))) INTO v_admin
    FROM public.members WHERE id = public.current_member_id();
  IF NOT v_admin THEN RAISE EXCEPTION 'Apenas administradores'; END IF;

  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN 0; END IF;
  IF cardinality(p_ids) > 500 THEN
    RAISE EXCEPTION 'Máximo 500 eventos por chamada (recebido: %)', cardinality(p_ids);
  END IF;

  WITH updated AS (
    UPDATE public.webhook_event_queue
       SET attempts        = 0,
           next_attempt_at = now(),
           processed_at    = NULL,
           last_error      = NULL
     WHERE id = ANY(p_ids)
       AND tenant_id = v_tenant
       AND event NOT LIKE 'test:%'  -- não reseta test events (são one-shot)
     RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_requeue_webhook_events(uuid[]) TO authenticated;

-- =============================================================================
-- (B) Health score view
-- =============================================================================
-- Cálculo:
--   error_rate    = COALESCE(error_count, 0) / NULLIF(dispatch_count, 0)
--   recency_age   = now() - last_called_at (NULL se nunca chamado)
--   has_dead_letter = EXISTS dead-letter rows pro webhook
--
-- Score 0-100 (maior = saudável):
--   base = 100
--   - error_rate penalty: -40 * min(error_rate, 1.0)
--   - recency penalty: -30 se >7 dias sem chamada (penaliza webhook abandonado)
--   - dead_letter penalty: -30 se há dead-letter ativo (não processado, attempts>=5)
--   Min 0.
--
-- Convenções:
--   - Webhook nunca chamado: score = 100 (não há histórico ruim ainda)
--   - dispatch_count = 0: score = 100
--   - error_count > dispatch_count (impossível na prática): clipped
-- =============================================================================
CREATE OR REPLACE VIEW public.v_webhook_health AS
SELECT
  w.id,
  w.tenant_id,
  w.label,
  w.active,
  w.dispatch_count,
  w.error_count,
  w.last_called_at,
  w.last_status,
  -- Métricas raw
  CASE WHEN w.dispatch_count > 0
       THEN least(1.0, w.error_count::numeric / w.dispatch_count::numeric)
       ELSE 0
  END AS error_rate,
  EXTRACT(EPOCH FROM (now() - w.last_called_at))/86400 AS days_since_last_call,
  (
    SELECT count(*) FROM public.webhook_event_queue q
    WHERE q.tenant_id = w.tenant_id
      AND q.processed_at IS NULL
      AND q.attempts >= 5
      AND q.event NOT LIKE 'test:%'
      AND EXISTS (
        SELECT 1 FROM public.tenant_webhooks tw
        WHERE tw.id = w.id AND q.event = ANY(tw.events)
      )
  )::int AS dead_letter_for_events,
  -- Score 0-100
  greatest(0, least(100,
    100
    - CASE WHEN w.dispatch_count > 0
           THEN (40.0 * least(1.0, w.error_count::numeric / w.dispatch_count::numeric))
           ELSE 0
      END
    - CASE WHEN w.last_called_at IS NOT NULL
                AND w.last_called_at < now() - interval '7 days'
           THEN 30
           ELSE 0
      END
    - CASE WHEN EXISTS (
              SELECT 1 FROM public.webhook_event_queue q
              WHERE q.tenant_id = w.tenant_id
                AND q.processed_at IS NULL
                AND q.attempts >= 5
                AND q.event NOT LIKE 'test:%'
                AND EXISTS (
                  SELECT 1 FROM public.tenant_webhooks tw
                  WHERE tw.id = w.id AND q.event = ANY(tw.events)
                )
            )
           THEN 30
           ELSE 0
      END
  ))::int AS health_score
FROM public.tenant_webhooks w
WHERE w.tenant_id = public.current_tenant_id();

GRANT SELECT ON public.v_webhook_health TO authenticated;

-- =============================================================================
-- RPC: tenant_webhook_health — UI consome via api.ts
-- =============================================================================
CREATE OR REPLACE FUNCTION public.tenant_webhook_health()
RETURNS TABLE (
  id                     uuid,
  label                  text,
  active                 boolean,
  dispatch_count         int,
  error_count            int,
  last_called_at         timestamptz,
  last_status            text,
  error_rate             numeric,
  days_since_last_call   numeric,
  dead_letter_for_events int,
  health_score           int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, label, active, dispatch_count, error_count, last_called_at,
         last_status, error_rate, days_since_last_call,
         dead_letter_for_events, health_score
  FROM public.v_webhook_health
  ORDER BY health_score ASC, dispatch_count DESC;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_webhook_health() TO authenticated;
