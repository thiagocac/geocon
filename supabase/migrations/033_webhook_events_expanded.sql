-- =============================================================================
-- 033_webhook_events_expanded
-- =============================================================================
-- (A) 3 novos eventos de webhook + triggers:
--       - measurement_emitted   (measurements quando vira 'emitida')
--       - unforeseen_pending    (unforeseen_items entrando em aprovação)
--       - digest_failed         (digest_sends com email_status='failed')
--
-- (B) Dead-letter alerting:
--       - View v_webhook_dead_letter_alerts pra detectar tenants
--         com dead-letter persistente (>1h)
--       - RPC alert_webhook_dead_letter() emite notification in-app pros admins
--       - Idempotente: evita duplicar via metadata.dead_letter_alert
--
-- (C) RPC build_webhook_sample_payload(event, entity_id) — UI preview do JSON
--     que será enviado para cada combinação evento × entidade real.
-- =============================================================================

-- =============================================================================
-- (A.1) Trigger: measurement_emitted
-- Dispara quando status transita pra 'emitida' (status_after = emitida, before != emitida)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_measurement_emitted_to_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract record;
BEGIN
  IF NEW.status <> 'emitida' THEN RETURN NEW; END IF;
  IF OLD.status = 'emitida' THEN RETURN NEW; END IF;

  SELECT numero, objeto INTO v_contract
    FROM public.contracts WHERE id = NEW.contract_id;

  PERFORM public.enqueue_webhook_event(
    NEW.tenant_id,
    'measurement_emitted',
    'measurement',
    NEW.id,
    jsonb_build_object(
      'measurement_id',         NEW.id,
      'contract_id',            NEW.contract_id,
      'contract_numero',        coalesce(v_contract.numero, '?'),
      'numero',                 NEW.numero,
      'periodo_inicio',         NEW.periodo_inicio,
      'periodo_fim',            NEW.periodo_fim,
      'valor_liquido',          NEW.valor_liquido,
      'data_emissao',           NEW.data_emissao,
      'public_validation_code', NEW.public_validation_code
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_measurements_emitted_to_queue ON public.measurements;
CREATE TRIGGER trg_measurements_emitted_to_queue
AFTER UPDATE OF status ON public.measurements
FOR EACH ROW EXECUTE FUNCTION public.trg_measurement_emitted_to_queue();

-- =============================================================================
-- (A.2) Trigger: unforeseen_pending
-- Dispara quando unforeseen_items entra em alguma fase 'aprovacao_*'
-- (analise_tecnica, analise_preco, aprovacao_consorcio, aprovacao_orgao)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_unforeseen_pending_to_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract record;
  v_pending_statuses text[] := ARRAY['analise_tecnica','analise_preco','aprovacao_consorcio','aprovacao_orgao'];
BEGIN
  IF NOT (NEW.status = ANY(v_pending_statuses)) THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  -- Evita re-disparar dentro do mesmo conjunto de status pendentes
  IF OLD.status = ANY(v_pending_statuses) THEN RETURN NEW; END IF;

  SELECT numero, objeto INTO v_contract
    FROM public.contracts WHERE id = NEW.contract_id;

  PERFORM public.enqueue_webhook_event(
    NEW.tenant_id,
    'unforeseen_pending',
    'unforeseen_item',
    NEW.id,
    jsonb_build_object(
      'unforeseen_id',     NEW.id,
      'contract_id',       NEW.contract_id,
      'contract_numero',   coalesce(v_contract.numero, '?'),
      'numero',            NEW.numero,
      'descricao',         left(coalesce(NEW.descricao, ''), 200),
      'status_before',     OLD.status,
      'status_after',      NEW.status,
      'valor_estimado',    NEW.valor_estimado,
      'prazo_impacto_dias',NEW.prazo_impacto_dias,
      'data_abertura',     NEW.data_abertura
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_unforeseen_pending_to_queue ON public.unforeseen_items;
CREATE TRIGGER trg_unforeseen_pending_to_queue
AFTER UPDATE OF status ON public.unforeseen_items
FOR EACH ROW EXECUTE FUNCTION public.trg_unforeseen_pending_to_queue();

-- =============================================================================
-- (A.3) Trigger: digest_failed
-- Dispara quando uma linha de digest_sends é INSERT com email_status='failed'
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_digest_failed_to_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member record;
BEGIN
  IF NEW.email_status <> 'failed' THEN RETURN NEW; END IF;

  SELECT nome, email INTO v_member
    FROM public.members WHERE id = NEW.member_id;

  PERFORM public.enqueue_webhook_event(
    NEW.tenant_id,
    'digest_failed',
    'digest_send',
    NEW.id,
    jsonb_build_object(
      'digest_send_id', NEW.id,
      'member_id',      NEW.member_id,
      'member_nome',    coalesce(v_member.nome, '?'),
      'member_email',   coalesce(v_member.email, '?'),
      'sent_date',      NEW.sent_date,
      'sent_at',        NEW.sent_at,
      'error',          coalesce((NEW.metadata->>'error'), 'unknown')
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_digest_failed_to_queue ON public.digest_sends;
CREATE TRIGGER trg_digest_failed_to_queue
AFTER INSERT ON public.digest_sends
FOR EACH ROW EXECUTE FUNCTION public.trg_digest_failed_to_queue();

-- =============================================================================
-- (B.1) View: tenants com dead-letter persistente (>1h)
-- =============================================================================
CREATE OR REPLACE VIEW public.v_webhook_dead_letter_alerts AS
SELECT
  q.tenant_id,
  count(*)                                AS dead_letter_count,
  min(q.enqueued_at)                      AS oldest_dead_at,
  max(q.last_error)                       AS sample_error,
  array_agg(DISTINCT q.event) FILTER (WHERE q.event IS NOT NULL) AS events_affected
FROM public.webhook_event_queue q
WHERE q.processed_at IS NULL
  AND q.attempts >= 5
  AND q.enqueued_at < now() - interval '1 hour'
GROUP BY q.tenant_id;

GRANT SELECT ON public.v_webhook_dead_letter_alerts TO authenticated, service_role;

-- =============================================================================
-- (B.2) RPC: alert_webhook_dead_letter — emite notification pros admins
-- Idempotente: agrega marcador em notifications.metadata.dead_letter_alert_at
-- pra não duplicar dentro de 24h por tenant.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.alert_webhook_dead_letter()
RETURNS TABLE (
  tenant_id           uuid,
  admins_notified     int,
  dead_letter_count   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t       record;
  v_admin   record;
  v_already boolean;
  v_count   int;
BEGIN
  FOR v_t IN SELECT * FROM public.v_webhook_dead_letter_alerts LOOP
    v_count := 0;
    -- Itera admins do tenant
    FOR v_admin IN
      SELECT id, nome FROM public.members
      WHERE tenant_id = v_t.tenant_id
        AND active = true
        AND deleted_at IS NULL
        AND (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[])))
    LOOP
      -- Verifica se já alertamos esse admin nas últimas 24h
      SELECT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.recipient_id = v_admin.id
          AND n.kind = 'system'
          AND (n.metadata->>'dead_letter_alert') = 'true'
          AND n.created_at > now() - interval '24 hours'
      ) INTO v_already;

      IF v_already THEN CONTINUE; END IF;

      INSERT INTO public.notifications (
        tenant_id, recipient_id, kind, title, body, action_url, metadata
      )
      VALUES (
        v_t.tenant_id,
        v_admin.id,
        'system',
        format('Webhooks travados: %s eventos em dead-letter', v_t.dead_letter_count),
        format('Há %s eventos com falha persistente (mais antigo: %s). Eventos afetados: %s. Acesse a fila para diagnóstico ou requeue.',
               v_t.dead_letter_count,
               to_char(v_t.oldest_dead_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'),
               array_to_string(coalesce(v_t.events_affected, ARRAY[]::text[]), ', ')),
        '/admin/webhooks-fila',
        jsonb_build_object(
          'dead_letter_alert',    true,
          'dead_letter_count',    v_t.dead_letter_count,
          'oldest_dead_at',       v_t.oldest_dead_at,
          'sample_error',         left(coalesce(v_t.sample_error, ''), 200)
        )
      );
      v_count := v_count + 1;
    END LOOP;

    tenant_id := v_t.tenant_id;
    admins_notified := v_count;
    dead_letter_count := v_t.dead_letter_count;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.alert_webhook_dead_letter() FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_webhook_dead_letter() TO service_role;

-- =============================================================================
-- (B.3) Auto-agenda alerta via pg_cron (a cada 1h, se disponível)
-- =============================================================================
DO $$
DECLARE
  v_has_cron boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_cron;
  IF NOT v_has_cron THEN
    RAISE NOTICE '[033] pg_cron ausente — alerta de dead-letter precisa ser disparado manualmente.';
    RETURN;
  END IF;

  BEGIN
    PERFORM cron.unschedule('webhook_dead_letter_alert_hourly');
  EXCEPTION WHEN others THEN NULL;
  END;

  PERFORM cron.schedule(
    'webhook_dead_letter_alert_hourly',
    '0 * * * *',  -- de hora em hora
    $cron$SELECT * FROM public.alert_webhook_dead_letter();$cron$
  );

  RAISE NOTICE '[033] webhook_dead_letter_alert_hourly agendado (cron a cada hora).';
EXCEPTION WHEN others THEN
  RAISE WARNING '[033] erro ao agendar alerta dead-letter: %', SQLERRM;
END;
$$;

-- =============================================================================
-- (C) RPC: build_webhook_sample_payload
-- Constrói um payload de exemplo pra UI mostrar antes de salvar.
-- Aceita event + opcionalmente entity_id (resolve dados reais) ou usa
-- dados sintéticos.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.build_webhook_sample_payload(
  p_event     text,
  p_entity_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_payload jsonb;
  v_synthetic boolean := (p_entity_id IS NULL);
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  IF p_event = 'broadcast_sent' THEN
    v_payload := jsonb_build_object(
      'broadcast_id',     coalesce(p_entity_id::text, '00000000-0000-0000-0000-000000000000'),
      'title',            '[Sample] Manutenção programada',
      'body',             'Sistema ficará indisponível das 02:00 às 04:00 para manutenção planejada.',
      'kind',             'info',
      'sender_name',      'Admin de teste',
      'total_sent',       42,
      'scope',            'all',
      'filter_roles',     '[]'::jsonb,
      'filter_contract_id', null
    );

  ELSIF p_event = 'risk_critico_changed' THEN
    IF p_entity_id IS NOT NULL THEN
      SELECT to_jsonb(t) INTO v_payload
      FROM (
        SELECT
          c.id              AS contract_id,
          c.numero          AS contract_numero,
          c.objeto          AS contract_objeto,
          coalesce(s.score, 75)         AS score,
          'critico'         AS nivel,
          'atencao'         AS previous_nivel,
          coalesce(s.captured_at, now()) AS captured_at,
          'manual'          AS source
        FROM public.contracts c
        LEFT JOIN LATERAL (
          SELECT score, captured_at FROM public.contract_risk_snapshots
          WHERE contract_id = c.id ORDER BY captured_at DESC LIMIT 1
        ) s ON true
        WHERE c.id = p_entity_id AND c.tenant_id = v_tenant
      ) t;
    END IF;
    IF v_payload IS NULL THEN
      v_synthetic := true;
      v_payload := jsonb_build_object(
        'contract_id',     gen_random_uuid(),
        'contract_numero', 'CT-SAMPLE-001',
        'contract_objeto', '[Sample] Reforma de pavimentação urbana',
        'score',           78,
        'nivel',           'critico',
        'previous_nivel',  'atencao',
        'captured_at',     now(),
        'source',          'manual'
      );
    END IF;

  ELSIF p_event = 'measurement_decided' THEN
    IF p_entity_id IS NOT NULL THEN
      SELECT to_jsonb(t) INTO v_payload
      FROM (
        SELECT
          m.id              AS measurement_id,
          m.contract_id,
          c.numero          AS contract_numero,
          m.numero,
          m.periodo_inicio,
          m.periodo_fim,
          'em_aprovacao'    AS status_before,
          m.status          AS status_after,
          m.valor_liquido
        FROM public.measurements m
        JOIN public.contracts c ON c.id = m.contract_id
        WHERE m.id = p_entity_id AND m.tenant_id = v_tenant
      ) t;
    END IF;
    IF v_payload IS NULL THEN
      v_synthetic := true;
      v_payload := jsonb_build_object(
        'measurement_id',  gen_random_uuid(),
        'contract_id',     gen_random_uuid(),
        'contract_numero', 'CT-SAMPLE-001',
        'numero',          7,
        'periodo_inicio',  (current_date - interval '30 days')::date,
        'periodo_fim',     current_date,
        'status_before',   'em_aprovacao',
        'status_after',    'aprovada',
        'valor_liquido',   125430.50
      );
    END IF;

  ELSIF p_event = 'measurement_emitted' THEN
    v_synthetic := p_entity_id IS NULL;
    v_payload := jsonb_build_object(
      'measurement_id',         coalesce(p_entity_id, gen_random_uuid()),
      'contract_id',            gen_random_uuid(),
      'contract_numero',        'CT-SAMPLE-001',
      'numero',                 8,
      'periodo_inicio',         (current_date - interval '30 days')::date,
      'periodo_fim',            current_date,
      'valor_liquido',          198750.00,
      'data_emissao',           current_date,
      'public_validation_code', encode(gen_random_bytes(8), 'hex')
    );

  ELSIF p_event = 'additive_approved' THEN
    v_synthetic := p_entity_id IS NULL;
    v_payload := jsonb_build_object(
      'additive_id',     coalesce(p_entity_id, gen_random_uuid()),
      'contract_id',     gen_random_uuid(),
      'contract_numero', 'CT-SAMPLE-001',
      'numero',          3,
      'tipo',            'valor',
      'valor_liquido',   45000.00,
      'data_aprovacao',  current_date,
      'status',          'aprovado'
    );

  ELSIF p_event = 'unforeseen_pending' THEN
    v_synthetic := p_entity_id IS NULL;
    v_payload := jsonb_build_object(
      'unforeseen_id',      coalesce(p_entity_id, gen_random_uuid()),
      'contract_id',        gen_random_uuid(),
      'contract_numero',    'CT-SAMPLE-001',
      'numero',             4,
      'descricao',          '[Sample] Necessidade de reforço estrutural não previsto',
      'status_before',      'levantamento',
      'status_after',       'analise_tecnica',
      'valor_estimado',     32500.00,
      'prazo_impacto_dias', 15,
      'data_abertura',      current_date
    );

  ELSIF p_event = 'digest_failed' THEN
    v_synthetic := true;
    v_payload := jsonb_build_object(
      'digest_send_id', gen_random_uuid(),
      'member_id',      gen_random_uuid(),
      'member_nome',    'Maria Silva',
      'member_email',   'maria.silva@example.com',
      'sent_date',      current_date,
      'sent_at',        now(),
      'error',          'Resend 422: invalid recipient'
    );

  ELSE
    v_payload := jsonb_build_object('event', p_event, 'note', 'Evento desconhecido — payload genérico');
  END IF;

  RETURN jsonb_build_object(
    'event',     p_event,
    'synthetic', v_synthetic,
    'payload',   v_payload
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.build_webhook_sample_payload(text, uuid) TO authenticated;
