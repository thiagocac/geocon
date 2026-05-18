-- =============================================================================
-- 032_webhook_event_queue
-- =============================================================================
-- (A) Fila genérica `webhook_event_queue` — triggers de domínio gravam aqui;
--     EF `drain-webhook-queue` processa periodicamente.
-- (B) Triggers de domínio:
--     - risk_critico_changed   (contract_risk_snapshots após INSERT/UPDATE)
--     - measurement_decided    (measurements após UPDATE de status)
--     - additive_approved      (additives após UPDATE de status)
-- (C) Retry/backoff: coluna `next_attempt_at` calculada a cada nack
--     com backoff exponencial: 5min → 30min → 2h → 12h → 24h. Max 5 tentativas.
-- (D) RPCs `drain_webhook_queue` (service_role) + `ack/nack_webhook_event` +
--     `tenant_webhook_queue_stats` + telemetria view.
-- =============================================================================

-- =============================================================================
-- (A) Tabela da fila
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.webhook_event_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event           text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       uuid NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  enqueued_at     timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  attempts        int NOT NULL DEFAULT 0,
  last_error      text
);

-- Index para o drain: ordena por next_attempt_at entre pendentes
CREATE INDEX IF NOT EXISTS idx_webhook_queue_pending_due
  ON public.webhook_event_queue (next_attempt_at)
  WHERE processed_at IS NULL AND attempts < 5;

CREATE INDEX IF NOT EXISTS idx_webhook_queue_tenant_recent
  ON public.webhook_event_queue (tenant_id, enqueued_at DESC);

-- RLS: leitura admin-only, sem write pelo client
ALTER TABLE public.webhook_event_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_queue_read ON public.webhook_event_queue;
CREATE POLICY webhook_queue_read ON public.webhook_event_queue
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin' OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  );

-- =============================================================================
-- Helper: backoff exponencial baseado em attempts
-- =============================================================================
-- Tentativas: 1=5min, 2=30min, 3=2h, 4=12h, 5=24h. Depois trava (attempts >= 5).
CREATE OR REPLACE FUNCTION public.webhook_retry_delay(p_attempts int)
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_attempts <= 1 THEN interval '5 minutes'
    WHEN p_attempts = 2  THEN interval '30 minutes'
    WHEN p_attempts = 3  THEN interval '2 hours'
    WHEN p_attempts = 4  THEN interval '12 hours'
    ELSE interval '24 hours'
  END;
$$;

-- =============================================================================
-- enqueue_webhook_event — chamado pelos triggers
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enqueue_webhook_event(
  p_tenant_id   uuid,
  p_event       text,
  p_entity_type text,
  p_entity_id   uuid,
  p_payload     jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_any_webhook boolean;
BEGIN
  -- Otimização: só enfileira se há webhooks ativos inscritos no evento.
  -- Reduz garbage rows pra tenants sem webhooks configurados.
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_webhooks
    WHERE tenant_id = p_tenant_id
      AND active = true
      AND p_event = ANY(events)
  ) INTO v_any_webhook;

  IF NOT v_any_webhook THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.webhook_event_queue (tenant_id, event, entity_type, entity_id, payload)
  VALUES (p_tenant_id, p_event, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_webhook_event(uuid, text, text, uuid, jsonb) TO authenticated, service_role;

-- =============================================================================
-- drain_webhook_queue — lock SKIP LOCKED + attempts++
-- =============================================================================
CREATE OR REPLACE FUNCTION public.drain_webhook_queue(p_limit int DEFAULT 50)
RETURNS TABLE (
  id            uuid,
  tenant_id     uuid,
  event         text,
  entity_type   text,
  entity_id     uuid,
  payload       jsonb,
  enqueued_at   timestamptz,
  attempts      int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH locked AS (
    SELECT q.id
    FROM public.webhook_event_queue q
    WHERE q.processed_at IS NULL
      AND q.attempts < 5
      AND q.next_attempt_at <= now()
    ORDER BY q.next_attempt_at ASC
    LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.webhook_event_queue q
     SET attempts = q.attempts + 1
    FROM locked l
   WHERE q.id = l.id
   RETURNING q.id, q.tenant_id, q.event, q.entity_type, q.entity_id, q.payload, q.enqueued_at, q.attempts;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.drain_webhook_queue(int) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_webhook_queue(int) TO service_role;

-- =============================================================================
-- ack_webhook_event — marca como processado (sucesso)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ack_webhook_event(p_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.webhook_event_queue
     SET processed_at = now(),
         last_error = NULL
   WHERE id = p_id
  RETURNING true;
$$;

REVOKE EXECUTE ON FUNCTION public.ack_webhook_event(uuid) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.ack_webhook_event(uuid) TO service_role;

-- =============================================================================
-- nack_webhook_event — registra erro + agenda próxima tentativa via backoff
-- =============================================================================
CREATE OR REPLACE FUNCTION public.nack_webhook_event(p_id uuid, p_error text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts int;
BEGIN
  UPDATE public.webhook_event_queue
     SET last_error = left(coalesce(p_error, ''), 500),
         next_attempt_at = now() + public.webhook_retry_delay(attempts)
   WHERE id = p_id
  RETURNING attempts INTO v_attempts;
  RETURN v_attempts IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.nack_webhook_event(uuid, text) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.nack_webhook_event(uuid, text) TO service_role;

-- =============================================================================
-- (B) Triggers de domínio
-- =============================================================================

-- Trigger: risk_critico_changed
-- Dispara quando snapshot vira nivel='critico' e o anterior não era.
CREATE OR REPLACE FUNCTION public.trg_risk_critico_to_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_nivel text;
  v_contract record;
BEGIN
  IF NEW.nivel <> 'critico' THEN
    RETURN NEW;
  END IF;

  SELECT nivel INTO v_prev_nivel
    FROM public.contract_risk_snapshots
   WHERE contract_id = NEW.contract_id
     AND id <> NEW.id
   ORDER BY captured_at DESC
   LIMIT 1;

  -- Já era crítico → não enfileira (evita ruído)
  IF v_prev_nivel = 'critico' THEN
    RETURN NEW;
  END IF;

  SELECT numero, objeto INTO v_contract
    FROM public.contracts WHERE id = NEW.contract_id;

  PERFORM public.enqueue_webhook_event(
    NEW.tenant_id,
    'risk_critico_changed',
    'contract',
    NEW.contract_id,
    jsonb_build_object(
      'contract_id',     NEW.contract_id,
      'contract_numero', coalesce(v_contract.numero, '?'),
      'contract_objeto', coalesce(v_contract.objeto, ''),
      'score',           NEW.score,
      'nivel',           NEW.nivel,
      'previous_nivel',  coalesce(v_prev_nivel, 'unknown'),
      'captured_at',     NEW.captured_at,
      'source',          NEW.source
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contract_risk_snapshots_to_queue ON public.contract_risk_snapshots;
CREATE TRIGGER trg_contract_risk_snapshots_to_queue
AFTER INSERT OR UPDATE OF nivel, score ON public.contract_risk_snapshots
FOR EACH ROW EXECUTE FUNCTION public.trg_risk_critico_to_queue();

-- =============================================================================
-- Trigger: measurement_decided
-- Dispara quando status muda para aprovada, devolvida ou paga.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_measurement_decided_to_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract record;
BEGIN
  IF NEW.status NOT IN ('aprovada', 'devolvida', 'paga') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT numero, objeto INTO v_contract
    FROM public.contracts WHERE id = NEW.contract_id;

  PERFORM public.enqueue_webhook_event(
    NEW.tenant_id,
    'measurement_decided',
    'measurement',
    NEW.id,
    jsonb_build_object(
      'measurement_id',  NEW.id,
      'contract_id',     NEW.contract_id,
      'contract_numero', coalesce(v_contract.numero, '?'),
      'numero',          NEW.numero,
      'periodo_inicio',  NEW.periodo_inicio,
      'periodo_fim',     NEW.periodo_fim,
      'status_before',   OLD.status,
      'status_after',    NEW.status,
      'valor_liquido',   NEW.valor_liquido
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_measurements_decided_to_queue ON public.measurements;
CREATE TRIGGER trg_measurements_decided_to_queue
AFTER UPDATE OF status ON public.measurements
FOR EACH ROW EXECUTE FUNCTION public.trg_measurement_decided_to_queue();

-- =============================================================================
-- Trigger: additive_approved
-- Dispara quando aditivo vira 'aprovado' ou 'incorporado' (transição entrante)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_additive_approved_to_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract record;
BEGIN
  IF NEW.status NOT IN ('aprovado', 'incorporado') THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  -- Já tinha passado por aprovado → não re-dispara
  IF OLD.status IN ('aprovado', 'incorporado') THEN RETURN NEW; END IF;

  SELECT numero, objeto INTO v_contract
    FROM public.contracts WHERE id = NEW.contract_id;

  PERFORM public.enqueue_webhook_event(
    NEW.tenant_id,
    'additive_approved',
    'additive',
    NEW.id,
    jsonb_build_object(
      'additive_id',     NEW.id,
      'contract_id',     NEW.contract_id,
      'contract_numero', coalesce(v_contract.numero, '?'),
      'numero',          NEW.numero,
      'tipo',            NEW.tipo,
      'valor_liquido',   NEW.valor_liquido,
      'data_aprovacao',  NEW.data_aprovacao,
      'status',          NEW.status
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_additives_approved_to_queue ON public.additives;
CREATE TRIGGER trg_additives_approved_to_queue
AFTER UPDATE OF status ON public.additives
FOR EACH ROW EXECUTE FUNCTION public.trg_additive_approved_to_queue();

-- =============================================================================
-- Telemetria
-- =============================================================================
CREATE OR REPLACE VIEW public.v_webhook_event_queue_stats AS
SELECT
  tenant_id,
  count(*) FILTER (WHERE processed_at IS NULL AND attempts < 5 AND next_attempt_at <= now())          AS due_now,
  count(*) FILTER (WHERE processed_at IS NULL AND attempts < 5 AND next_attempt_at >  now())          AS waiting_backoff,
  count(*) FILTER (WHERE processed_at IS NOT NULL)                                                    AS processed,
  count(*) FILTER (WHERE processed_at IS NULL AND attempts >= 5)                                      AS dead_letter,
  count(*) FILTER (WHERE event = 'risk_critico_changed')                                              AS risk_critico_total,
  count(*) FILTER (WHERE event = 'measurement_decided')                                               AS measurement_decided_total,
  count(*) FILTER (WHERE event = 'additive_approved')                                                 AS additive_approved_total
FROM public.webhook_event_queue
GROUP BY tenant_id;

GRANT SELECT ON public.v_webhook_event_queue_stats TO authenticated;

CREATE OR REPLACE FUNCTION public.tenant_webhook_queue_stats()
RETURNS TABLE (
  due_now                   bigint,
  waiting_backoff           bigint,
  processed                 bigint,
  dead_letter               bigint,
  risk_critico_total        bigint,
  measurement_decided_total bigint,
  additive_approved_total   bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT due_now, waiting_backoff, processed, dead_letter,
         risk_critico_total, measurement_decided_total, additive_approved_total
  FROM public.v_webhook_event_queue_stats
  WHERE tenant_id = public.current_tenant_id();
$$;

GRANT EXECUTE ON FUNCTION public.tenant_webhook_queue_stats() TO authenticated;

-- =============================================================================
-- list_webhook_queue_events — admin vê eventos recentes (com filtro de status)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_webhook_queue_events(
  p_status text DEFAULT NULL,   -- 'pending' | 'processed' | 'dead' | NULL=all
  p_limit  int  DEFAULT 50
)
RETURNS TABLE (
  id              uuid,
  event           text,
  entity_type     text,
  entity_id       uuid,
  enqueued_at     timestamptz,
  next_attempt_at timestamptz,
  processed_at    timestamptz,
  attempts        int,
  last_error      text,
  payload         jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, event, entity_type, entity_id, enqueued_at, next_attempt_at,
         processed_at, attempts, last_error, payload
  FROM public.webhook_event_queue
  WHERE tenant_id = public.current_tenant_id()
    AND (
      p_status IS NULL
      OR (p_status = 'pending'   AND processed_at IS NULL AND attempts < 5)
      OR (p_status = 'processed' AND processed_at IS NOT NULL)
      OR (p_status = 'dead'      AND processed_at IS NULL AND attempts >= 5)
    )
  ORDER BY enqueued_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
$$;

GRANT EXECUTE ON FUNCTION public.list_webhook_queue_events(text, int) TO authenticated;

-- =============================================================================
-- requeue_webhook_event — admin força retry de evento em dead-letter
-- =============================================================================
CREATE OR REPLACE FUNCTION public.requeue_webhook_event(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_admin  boolean;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))) INTO v_admin
    FROM public.members WHERE id = public.current_member_id();
  IF NOT v_admin THEN RAISE EXCEPTION 'Apenas administradores'; END IF;

  UPDATE public.webhook_event_queue
     SET attempts        = 0,
         next_attempt_at = now(),
         processed_at    = NULL,
         last_error      = NULL
   WHERE id = p_id AND tenant_id = v_tenant;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.requeue_webhook_event(uuid) TO authenticated;

-- =============================================================================
-- (C) Auto-agenda drain via pg_cron a cada minuto, se disponível
-- =============================================================================
DO $$
DECLARE
  v_has_cron boolean;
  v_url   text;
  v_key   text;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_cron;
  IF NOT v_has_cron THEN
    RAISE NOTICE '[032] pg_cron não disponível — drain manual via EF apenas.';
    RETURN;
  END IF;

  -- Settings ausentes? skip
  v_url := current_setting('app.settings.supabase_url',     true);
  v_key := current_setting('app.settings.service_role_key', true);
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE '[032] settings app.supabase_url/service_role_key ausentes — drain via cron desativado. Configure e re-rode.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE '[032] pg_net ausente — drain via cron desativado.';
    RETURN;
  END IF;

  BEGIN
    PERFORM cron.unschedule('drain_webhook_queue_minute');
  EXCEPTION WHEN others THEN NULL;
  END;

  PERFORM cron.schedule(
    'drain_webhook_queue_minute',
    '* * * * *',  -- a cada minuto
    $cron$
      SELECT net.http_post(
        url     := rtrim(current_setting('app.settings.supabase_url'), '/') || '/functions/v1/drain-webhook-queue',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
        ),
        body    := jsonb_build_object('limit', 100),
        timeout_milliseconds := 30000
      );
    $cron$
  );

  RAISE NOTICE '[032] drain_webhook_queue_minute agendado (cron a cada 1min).';
EXCEPTION WHEN others THEN
  RAISE WARNING '[032] erro ao agendar drain: %', SQLERRM;
END;
$$;
