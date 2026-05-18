-- =============================================================================
-- 034_webhook_operability
-- =============================================================================
-- (A) Auto-rotate de signing secrets:
--     - Coluna `auto_rotate_after_days` (int, NULL = manual only)
--     - View v_webhooks_due_rotation pra detectar quem rotacionar
--     - RPC rotate_webhook_secret_silent (não retorna o secret — usado pelo
--       cron, mas gera notification pro admin com o secret novo)
--
-- (B) Entity search pra preview real:
--     - RPC search_entities_for_webhook(event, query) com 5 strategies
--       por tipo de evento (contract / measurement / additive / unforeseen / digest)
--
-- (C) Re-dispatch isolado:
--     - RPC dispatch_single_webhook_test(queue_event_id, webhook_id) marca
--       evento pra re-tentativa em UM webhook específico (não loop pelos webhooks
--       do tenant). EF dispatch-single-event consome.
-- =============================================================================

-- =============================================================================
-- (A) Auto-rotate
-- =============================================================================
ALTER TABLE public.tenant_webhooks
  ADD COLUMN IF NOT EXISTS auto_rotate_after_days int
    CHECK (auto_rotate_after_days IS NULL OR (auto_rotate_after_days BETWEEN 7 AND 365));

COMMENT ON COLUMN public.tenant_webhooks.auto_rotate_after_days IS
  'Rotação automática do signing_secret após N dias da última rotação. NULL=desativado.';

-- =============================================================================
-- View: webhooks elegíveis para rotação automática
-- =============================================================================
CREATE OR REPLACE VIEW public.v_webhooks_due_rotation AS
SELECT
  w.id,
  w.tenant_id,
  w.label,
  w.kind,
  w.auto_rotate_after_days,
  w.secret_rotated_at,
  w.signing_secret IS NOT NULL                                  AS has_secret,
  (now() - coalesce(w.secret_rotated_at, w.created_at))         AS age_since_rotation,
  (coalesce(w.secret_rotated_at, w.created_at)
    + make_interval(days => w.auto_rotate_after_days))          AS due_at
FROM public.tenant_webhooks w
WHERE w.active = true
  AND w.signing_secret IS NOT NULL
  AND w.auto_rotate_after_days IS NOT NULL
  AND coalesce(w.secret_rotated_at, w.created_at)
      + make_interval(days => w.auto_rotate_after_days) < now();

GRANT SELECT ON public.v_webhooks_due_rotation TO authenticated, service_role;

-- =============================================================================
-- RPC: rotate_webhook_secret_silent — chamada pelo cron de auto-rotate
-- Gera novo secret, atualiza tudo, e cria notification pro admin do tenant
-- com o secret novo (única forma de admin pegá-lo, já que não retornamos pra
-- esse cron sem nenhum admin presente na conexão).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.rotate_webhook_secret_silent(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   uuid;
  v_label    text;
  v_secret   text;
  v_hint     text;
  v_admin_id uuid;
  v_count    int := 0;
BEGIN
  SELECT tenant_id, label INTO v_tenant, v_label
    FROM public.tenant_webhooks WHERE id = p_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Webhook não encontrado';
  END IF;

  v_secret := public.gen_webhook_secret();
  v_hint   := '…' || right(v_secret, 4);

  UPDATE public.tenant_webhooks
     SET signing_secret    = v_secret,
         secret_hint       = v_hint,
         secret_rotated_at = now()
   WHERE id = p_id;

  -- Notification pra cada admin do tenant — secret cru sai no body uma vez
  FOR v_admin_id IN
    SELECT id FROM public.members
    WHERE tenant_id = v_tenant
      AND active = true
      AND deleted_at IS NULL
      AND (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[])))
  LOOP
    INSERT INTO public.notifications (
      tenant_id, recipient_id, kind, title, body, action_url, metadata
    )
    VALUES (
      v_tenant,
      v_admin_id,
      'system',
      format('Secret de webhook "%s" foi rotacionado automaticamente', v_label),
      format('Novo secret (copie agora — não fica visível depois): %s · Hint persistido: %s', v_secret, v_hint),
      '/admin/webhooks',
      jsonb_build_object(
        'auto_rotated_secret', true,
        'webhook_id',          p_id,
        'webhook_label',       v_label,
        'rotated_at',          now()
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'webhook_id', p_id,
    'admins_notified', v_count,
    'rotated_at', now(),
    'hint', v_hint
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rotate_webhook_secret_silent(uuid) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_webhook_secret_silent(uuid) TO service_role;

-- =============================================================================
-- RPC: auto_rotate_due_webhooks — iterates view, calls silent rotate
-- =============================================================================
CREATE OR REPLACE FUNCTION public.auto_rotate_due_webhooks()
RETURNS TABLE (
  webhook_id      uuid,
  tenant_id       uuid,
  label           text,
  rotated_at      timestamptz,
  admins_notified int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_due record;
  v_res jsonb;
BEGIN
  FOR v_due IN SELECT * FROM public.v_webhooks_due_rotation LOOP
    v_res := public.rotate_webhook_secret_silent(v_due.id);
    webhook_id      := v_due.id;
    tenant_id       := v_due.tenant_id;
    label           := v_due.label;
    rotated_at      := (v_res->>'rotated_at')::timestamptz;
    admins_notified := (v_res->>'admins_notified')::int;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_rotate_due_webhooks() FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_rotate_due_webhooks() TO service_role;

-- =============================================================================
-- Auto-agenda no pg_cron a cada dia às 04:00 UTC
-- =============================================================================
DO $$
DECLARE
  v_has_cron boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_cron;
  IF NOT v_has_cron THEN
    RAISE NOTICE '[034] pg_cron ausente — auto-rotate precisa ser disparado manualmente.';
    RETURN;
  END IF;

  BEGIN
    PERFORM cron.unschedule('webhook_auto_rotate_daily');
  EXCEPTION WHEN others THEN NULL;
  END;

  PERFORM cron.schedule(
    'webhook_auto_rotate_daily',
    '0 4 * * *',
    $cron$SELECT * FROM public.auto_rotate_due_webhooks();$cron$
  );

  RAISE NOTICE '[034] webhook_auto_rotate_daily agendado para 04:00 UTC.';
EXCEPTION WHEN others THEN
  RAISE WARNING '[034] erro ao agendar auto-rotate: %', SQLERRM;
END;
$$;

-- =============================================================================
-- (B) Entity search pra preview
-- =============================================================================
-- Retorna candidatos (id, label, hint) pra cada tipo de evento.
-- 'label' é exibido no combobox; 'hint' é texto secundário (numero, status).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.search_entities_for_webhook(
  p_event text,
  p_query text DEFAULT '',
  p_limit int  DEFAULT 10
)
RETURNS TABLE (
  id    uuid,
  label text,
  hint  text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_q      text;
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  v_q := '%' || coalesce(p_query, '') || '%';

  IF p_event IN ('risk_critico_changed', 'broadcast_sent') THEN
    -- Contratos do tenant
    RETURN QUERY
    SELECT c.id, c.numero AS label, left(c.objeto, 80) AS hint
    FROM public.contracts c
    WHERE c.tenant_id = v_tenant
      AND c.deleted_at IS NULL
      AND (c.numero ILIKE v_q OR c.objeto ILIKE v_q)
    ORDER BY c.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 10), 50));

  ELSIF p_event IN ('measurement_emitted', 'measurement_decided') THEN
    -- Medições com número do contrato
    RETURN QUERY
    SELECT m.id, format('Med. #%s · %s', m.numero, c.numero) AS label, format('Status: %s · Período %s a %s', m.status, m.periodo_inicio, m.periodo_fim) AS hint
    FROM public.measurements m
    JOIN public.contracts c ON c.id = m.contract_id
    WHERE m.tenant_id = v_tenant
      AND m.deleted_at IS NULL
      AND (c.numero ILIKE v_q OR m.status ILIKE v_q)
    ORDER BY m.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 10), 50));

  ELSIF p_event = 'additive_approved' THEN
    -- Aditivos
    RETURN QUERY
    SELECT a.id, format('Aditivo #%s · %s', a.numero, c.numero) AS label, format('Tipo: %s · Status: %s', a.tipo, a.status) AS hint
    FROM public.additives a
    JOIN public.contracts c ON c.id = a.contract_id
    WHERE a.tenant_id = v_tenant
      AND a.deleted_at IS NULL
      AND (c.numero ILIKE v_q OR a.tipo ILIKE v_q OR a.status ILIKE v_q)
    ORDER BY a.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 10), 50));

  ELSIF p_event = 'unforeseen_pending' THEN
    -- Itens não previstos
    RETURN QUERY
    SELECT u.id, format('#%s · %s', u.numero, c.numero) AS label, format('Status: %s · %s', u.status, left(u.descricao, 60)) AS hint
    FROM public.unforeseen_items u
    JOIN public.contracts c ON c.id = u.contract_id
    WHERE u.tenant_id = v_tenant
      AND u.deleted_at IS NULL
      AND (c.numero ILIKE v_q OR u.descricao ILIKE v_q OR u.status ILIKE v_q)
    ORDER BY u.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 10), 50));

  ELSIF p_event = 'digest_failed' THEN
    -- Digest sends que falharam
    RETURN QUERY
    SELECT d.id, m.email AS label, format('Date %s · %s', d.sent_date, d.email_status) AS hint
    FROM public.digest_sends d
    JOIN public.members m ON m.id = d.member_id
    WHERE d.tenant_id = v_tenant
      AND d.email_status = 'failed'
      AND (m.email ILIKE v_q OR m.nome ILIKE v_q)
    ORDER BY d.sent_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 10), 50));

  ELSE
    -- Evento sem estratégia conhecida → nada
    RETURN;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_entities_for_webhook(text, text, int) TO authenticated;

-- =============================================================================
-- (C) Re-dispatch isolado
-- =============================================================================
-- Para um evento já enfileirado, permite admin re-enviar PRA UM webhook
-- específico (útil quando 1 webhook falhou mas outros tiveram sucesso, e admin
-- quer testar o webhook quebrado isoladamente sem afetar a fila).
--
-- Cria uma row nova em webhook_event_queue com metadata.test_target = webhook_id
-- e prefixo de event "test:<original_event>". EF drain-webhook-queue já existente
-- precisa NÃO processar essas (filtra por prefixo).
-- Em vez disso, expomos RPC dedicada `claim_test_dispatch` + nova EF
-- `dispatch-single-event` que processa só esse target.
-- =============================================================================

-- Helper: marca um evento histórico pra teste isolado
CREATE OR REPLACE FUNCTION public.enqueue_webhook_test(
  p_source_event_id uuid,
  p_target_webhook  uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   uuid;
  v_admin    boolean;
  v_source   record;
  v_target   record;
  v_new_id   uuid;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))) INTO v_admin
    FROM public.members WHERE id = public.current_member_id();
  IF NOT v_admin THEN RAISE EXCEPTION 'Apenas administradores'; END IF;

  -- Valida que o evento fonte existe e pertence ao tenant
  SELECT * INTO v_source FROM public.webhook_event_queue
   WHERE id = p_source_event_id AND tenant_id = v_tenant;
  IF v_source IS NULL THEN
    RAISE EXCEPTION 'Evento fonte não encontrado';
  END IF;

  -- Valida o webhook alvo
  SELECT * INTO v_target FROM public.tenant_webhooks
   WHERE id = p_target_webhook AND tenant_id = v_tenant;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'Webhook alvo não encontrado';
  END IF;

  -- Cria nova entry de teste com metadata.test_target
  INSERT INTO public.webhook_event_queue (
    tenant_id, event, entity_type, entity_id, payload,
    enqueued_at, next_attempt_at
  )
  VALUES (
    v_tenant,
    'test:' || v_source.event,
    v_source.entity_type,
    v_source.entity_id,
    v_source.payload || jsonb_build_object(
      '_test',          true,
      '_test_target',   p_target_webhook,
      '_test_source',   p_source_event_id,
      '_test_by',       public.current_member_id(),
      '_test_label',    v_target.label
    ),
    now(),
    now()
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_webhook_test(uuid, uuid) TO authenticated;

-- =============================================================================
-- Drain modificado para PULAR eventos test: (event começa com 'test:')
-- Como reaproveitamos o drain_webhook_queue da migration 032, vamos
-- substituí-lo aqui pra filtrar test events.
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
      AND q.event NOT LIKE 'test:%'           -- skip test events (V28)
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

-- Mantém GRANTs do original
REVOKE EXECUTE ON FUNCTION public.drain_webhook_queue(int) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_webhook_queue(int) TO service_role;

-- =============================================================================
-- claim_test_dispatch — drena PRÓXIMO test event (consumido pela EF dispatch-single-event)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.claim_test_dispatch()
RETURNS TABLE (
  id            uuid,
  tenant_id     uuid,
  event         text,
  entity_type   text,
  entity_id     uuid,
  payload       jsonb,
  enqueued_at   timestamptz,
  attempts      int,
  target_webhook uuid
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
      AND q.attempts < 3                  -- test tem cap menor
      AND q.event LIKE 'test:%'
      AND q.next_attempt_at <= now()
    ORDER BY q.next_attempt_at ASC
    LIMIT 5
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.webhook_event_queue q
     SET attempts = q.attempts + 1
    FROM locked l
   WHERE q.id = l.id
   RETURNING q.id, q.tenant_id, q.event, q.entity_type, q.entity_id, q.payload, q.enqueued_at, q.attempts,
             (q.payload->>'_test_target')::uuid AS target_webhook;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_test_dispatch() FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_test_dispatch() TO service_role;

-- =============================================================================
-- (D) CSV-friendly export of dead-letter (admin)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.export_dead_letter_events()
RETURNS TABLE (
  enqueued_at       timestamptz,
  event             text,
  entity_type       text,
  entity_id         uuid,
  attempts          int,
  last_error        text,
  payload_json      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    q.enqueued_at,
    q.event,
    q.entity_type,
    q.entity_id,
    q.attempts,
    coalesce(q.last_error, ''),
    q.payload::text
  FROM public.webhook_event_queue q
  WHERE q.tenant_id = public.current_tenant_id()
    AND q.processed_at IS NULL
    AND q.attempts >= 5
    AND q.event NOT LIKE 'test:%'
  ORDER BY q.enqueued_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.export_dead_letter_events() TO authenticated;

-- =============================================================================
-- Auto-schedule do dispatcher de testes (cron a cada minuto também)
-- =============================================================================
DO $$
DECLARE
  v_has_cron boolean;
  v_url text;
  v_key text;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_cron;
  IF NOT v_has_cron THEN RETURN; END IF;

  v_url := current_setting('app.settings.supabase_url',     true);
  v_key := current_setting('app.settings.service_role_key', true);
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN RETURN; END IF;

  BEGIN
    PERFORM cron.unschedule('dispatch_single_event_minute');
  EXCEPTION WHEN others THEN NULL;
  END;

  PERFORM cron.schedule(
    'dispatch_single_event_minute',
    '* * * * *',
    $cron$
      SELECT net.http_post(
        url     := rtrim(current_setting('app.settings.supabase_url'), '/') || '/functions/v1/dispatch-single-event',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 20000
      );
    $cron$
  );
  RAISE NOTICE '[034] dispatch_single_event_minute agendado.';
EXCEPTION WHEN others THEN
  RAISE WARNING '[034] erro ao agendar test dispatcher: %', SQLERRM;
END;
$$;

-- =============================================================================
-- Upsert ampliado: aceita auto_rotate_after_days. Reescreve a função pra evitar
-- DROP de função com GRANT existente.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_tenant_webhook(
  p_id              uuid,
  p_label           text,
  p_kind            text,
  p_url             text,
  p_secret_hint     text,
  p_events          text[],
  p_active          boolean,
  p_payload_template text DEFAULT NULL,
  p_auto_rotate_after_days int DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
  v_admin  boolean;
  v_id     uuid;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();
  IF v_tenant IS NULL OR v_member IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))) INTO v_admin
    FROM public.members WHERE id = v_member;
  IF NOT v_admin THEN RAISE EXCEPTION 'Apenas administradores podem gerenciar webhooks'; END IF;

  IF p_label IS NULL OR length(trim(p_label)) < 2 THEN
    RAISE EXCEPTION 'Rótulo precisa de pelo menos 2 caracteres';
  END IF;
  IF p_kind NOT IN ('slack','teams','generic') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_kind;
  END IF;
  IF p_url IS NULL OR p_url !~* '^https?://' THEN
    RAISE EXCEPTION 'URL deve começar com http:// ou https://';
  END IF;
  IF cardinality(coalesce(p_events, ARRAY[]::text[])) = 0 THEN
    RAISE EXCEPTION 'Selecione pelo menos um evento';
  END IF;

  -- Valida template JSON quando fornecido
  IF p_payload_template IS NOT NULL AND length(trim(p_payload_template)) > 0 THEN
    BEGIN
      PERFORM nullif(trim(p_payload_template), '')::jsonb;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'payload_template não é JSON válido: %', SQLERRM;
    END;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.tenant_webhooks (
      tenant_id, label, kind, url, secret_hint, events, active, created_by,
      payload_template, auto_rotate_after_days
    )
    VALUES (
      v_tenant, trim(p_label), p_kind, p_url, nullif(trim(p_secret_hint), ''),
      p_events, p_active, v_member,
      nullif(trim(p_payload_template), ''),
      p_auto_rotate_after_days
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.tenant_webhooks
       SET label = trim(p_label),
           kind = p_kind,
           url = p_url,
           secret_hint = nullif(trim(p_secret_hint), ''),
           events = p_events,
           active = p_active,
           payload_template = nullif(trim(p_payload_template), ''),
           auto_rotate_after_days = p_auto_rotate_after_days
     WHERE id = p_id AND tenant_id = v_tenant
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Webhook não encontrado'; END IF;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_tenant_webhook(uuid, text, text, text, text, text[], boolean, text, int) TO authenticated;

-- =============================================================================
-- View v_tenant_webhooks: incluir auto_rotate_after_days
-- =============================================================================
DROP VIEW IF EXISTS public.v_tenant_webhooks CASCADE;
CREATE OR REPLACE VIEW public.v_tenant_webhooks AS
SELECT
  w.id, w.tenant_id, w.label, w.kind, w.url, w.secret_hint, w.events, w.active,
  w.payload_template, w.auto_rotate_after_days,
  w.signing_secret IS NOT NULL AS has_signing_secret,
  w.secret_rotated_at,
  w.created_at, w.created_by, w.last_called_at, w.last_status, w.last_response_code,
  w.dispatch_count, w.error_count,
  (
    SELECT count(*) FROM public.webhook_dispatch_log d
    WHERE d.webhook_id = w.id AND d.signed = true
  ) AS signed_dispatch_count
FROM public.tenant_webhooks w
WHERE w.tenant_id = public.current_tenant_id();

GRANT SELECT ON public.v_tenant_webhooks TO authenticated;

-- Recria list_tenant_webhooks pra retornar auto_rotate_after_days
CREATE OR REPLACE FUNCTION public.list_tenant_webhooks()
RETURNS SETOF public.v_tenant_webhooks
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.v_tenant_webhooks;
$$;

GRANT EXECUTE ON FUNCTION public.list_tenant_webhooks() TO authenticated;
