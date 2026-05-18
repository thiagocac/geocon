-- =============================================================================
-- 054_alert_digest_lei14133
-- =============================================================================
-- Email digest de alertas Lei 14.133. Reusa 100% da infra V20/V21:
--   - member_notification_prefs (V20) com novo event_type 'alert_digest_lei14133'
--   - digest_sends (V21) com nova coluna digest_kind (default 'daily')
--   - quiet_hours em members (V21)
--
-- Frontend (Auxiliary.tsx) já existia da sessão prévia esperando schema:
--   - frequency: daily | weekly | monthly
--   - severity_threshold: warning | danger
--   - retornos jsonb com chaves específicas (alert_count, alerts.{key}: int,
--     top_critical[], next_dates[], member_email, tenant_name, multas_total_valor)
-- Esta migration cobre exatamente esse contrato.
-- =============================================================================

-- =============================================================================
-- 1. Estende digest_sends com digest_kind
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'digest_sends'
      AND column_name = 'digest_kind'
  ) THEN
    ALTER TABLE public.digest_sends
      ADD COLUMN digest_kind text NOT NULL DEFAULT 'daily'
        CHECK (digest_kind IN ('daily', 'alert_lei14133'));
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.digest_sends'::regclass
      AND conname = 'digest_sends_member_id_sent_date_key'
  ) THEN
    ALTER TABLE public.digest_sends
      DROP CONSTRAINT digest_sends_member_id_sent_date_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.digest_sends'::regclass
      AND conname = 'digest_sends_member_kind_date_key'
  ) THEN
    ALTER TABLE public.digest_sends
      ADD CONSTRAINT digest_sends_member_kind_date_key
      UNIQUE (member_id, digest_kind, sent_date);
  END IF;
END
$$;

COMMENT ON COLUMN public.digest_sends.digest_kind IS
  'daily (digest-daily V21) ou alert_lei14133 (alert digest V47). UNIQUE inclui digest_kind para coexistência.';

-- =============================================================================
-- 2. Estende members com configuração do alert digest (frequency em inglês)
-- =============================================================================
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS alert_digest_frequency text NOT NULL DEFAULT 'weekly'
    CHECK (alert_digest_frequency IN ('daily', 'weekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS alert_digest_severity_threshold text NOT NULL DEFAULT 'warning'
    CHECK (alert_digest_severity_threshold IN ('warning', 'danger'));

COMMENT ON COLUMN public.members.alert_digest_frequency IS
  'V47 · daily (todo dia) / weekly (segundas) / monthly (dia 1). Default weekly.';
COMMENT ON COLUMN public.members.alert_digest_severity_threshold IS
  'V47 · warning (todos os 5 alertas) / danger (só vícios graves e garantias <7d). Default warning.';

-- =============================================================================
-- 3. RPC list_pending_alert_digest_recipients
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_pending_alert_digest_recipients(
  p_now timestamptz DEFAULT now(),
  p_force boolean DEFAULT false
)
RETURNS TABLE (
  member_id    uuid,
  tenant_id    uuid,
  email        text,
  nome         text,
  timezone     text,
  frequency    text,
  severity_threshold text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH today_local AS (
    SELECT m.id AS member_id, (p_now AT TIME ZONE m.timezone)::date AS local_date,
           extract(dow FROM (p_now AT TIME ZONE m.timezone))::int AS local_dow,
           extract(day FROM (p_now AT TIME ZONE m.timezone))::int AS local_dom
    FROM public.members m
    WHERE m.deleted_at IS NULL AND m.email IS NOT NULL
  )
  SELECT
    m.id, m.tenant_id, m.email, m.nome, m.timezone,
    m.alert_digest_frequency, m.alert_digest_severity_threshold
  FROM public.members m
  JOIN today_local t ON t.member_id = m.id
  JOIN public.member_notification_prefs p
       ON p.member_id = m.id
      AND p.event_type = 'alert_digest_lei14133'
      AND p.channel = 'email'
      AND p.enabled = true
  WHERE m.deleted_at IS NULL
    AND m.email IS NOT NULL
    AND (
      m.alert_digest_frequency = 'daily'
      OR (m.alert_digest_frequency = 'weekly'  AND t.local_dow = 1)
      OR (m.alert_digest_frequency = 'monthly' AND t.local_dom = 1)
    )
    AND (
      p_force
      OR NOT EXISTS (
        SELECT 1 FROM public.digest_sends ds
        WHERE ds.member_id = m.id
          AND ds.digest_kind = 'alert_lei14133'
          AND ds.sent_date >= (
            CASE m.alert_digest_frequency
              WHEN 'daily'   THEN t.local_date
              WHEN 'weekly'  THEN t.local_date - interval '6 days'
              WHEN 'monthly' THEN date_trunc('month', t.local_date)::date
            END
          )
      )
    );
$$;
REVOKE EXECUTE ON FUNCTION public.list_pending_alert_digest_recipients(timestamptz, boolean) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_alert_digest_recipients(timestamptz, boolean) TO service_role;

-- =============================================================================
-- 4. RPC get_alert_digest_data_for_member — payload pra envio (rico)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_alert_digest_data_for_member(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant         uuid;
  v_member         record;
  v_tenant_name    text;
  v_today          date := current_date;

  v_vicios_graves_n        int;
  v_garantias_7d_n         int;
  v_par_proc_sem_sanc_n    int;
  v_par_prazo_vencido_n    int;
  v_multas_grandes_n       int;
  v_multas_grandes_total   numeric;

  v_threshold      text;
  v_include_warnings boolean;
  v_alerts_count   int := 0;

  v_top_critical   jsonb;
  v_next_dates     jsonb;
BEGIN
  SELECT m.id, m.tenant_id, m.nome, m.email, m.timezone,
         m.alert_digest_frequency, m.alert_digest_severity_threshold
  INTO v_member
  FROM public.members m
  WHERE m.id = p_member_id AND m.deleted_at IS NULL;

  IF v_member IS NULL THEN
    RAISE EXCEPTION 'Member não encontrado';
  END IF;

  v_tenant := v_member.tenant_id;
  SELECT name INTO v_tenant_name FROM public.tenants WHERE id = v_tenant;

  v_threshold := v_member.alert_digest_severity_threshold;
  v_include_warnings := (v_threshold = 'warning');

  -- Alert 1 (danger): vícios graves abertos
  SELECT count(DISTINCT r.contract_id)::int
  INTO v_vicios_graves_n
  FROM public.contract_receipt_vicios v
  JOIN public.contract_receipts r ON r.id = v.receipt_id
  JOIN public.contracts c ON c.id = r.contract_id
  WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL
    AND v.status IN ('aberto','em_saneamento')
    AND v.severidade IN ('alta','critica');

  -- Alert 2 (danger): garantias vencendo ≤7d
  SELECT count(*)::int
  INTO v_garantias_7d_n
  FROM public.contract_guarantees g
  JOIN public.contracts c ON c.id = g.contract_id
  WHERE g.tenant_id = v_tenant AND c.deleted_at IS NULL
    AND g.status IN ('ativa','estendida')
    AND g.data_vigencia_fim BETWEEN v_today AND v_today + interval '7 days';

  IF v_include_warnings THEN
    SELECT count(*)::int
    INTO v_par_proc_sem_sanc_n
    FROM public.contract_par_processes p
    JOIN public.contracts c ON c.id = p.contract_id
    WHERE p.tenant_id = v_tenant AND c.deleted_at IS NULL
      AND p.decisao_resultado IN ('procedente','parcialmente_procedente')
      AND p.status IN ('decidido','arquivado')
      AND p.sancao_proposta_tipos IS NOT NULL
      AND cardinality(p.sancao_proposta_tipos) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.contract_sanctions s
        WHERE s.par_id = p.id AND s.status IN ('ativa','suspensa','cumprida')
      );

    SELECT count(*)::int
    INTO v_par_prazo_vencido_n
    FROM public.contract_par_processes p
    JOIN public.contracts c ON c.id = p.contract_id
    WHERE p.tenant_id = v_tenant AND c.deleted_at IS NULL
      AND p.status = 'em_defesa'
      AND p.defesa_prazo_limite < v_today;

    SELECT count(*)::int, coalesce(sum(s.valor_multa), 0)
    INTO v_multas_grandes_n, v_multas_grandes_total
    FROM public.contract_sanctions s
    JOIN public.contracts c ON c.id = s.contract_id
    WHERE s.tenant_id = v_tenant AND c.deleted_at IS NULL
      AND s.tipo = 'multa'
      AND s.status IN ('ativa','suspensa')
      AND s.data_pagamento_multa IS NULL
      AND s.valor_multa > 100000;
  ELSE
    v_par_proc_sem_sanc_n := 0;
    v_par_prazo_vencido_n := 0;
    v_multas_grandes_n    := 0;
    v_multas_grandes_total := 0;
  END IF;

  v_alerts_count :=
    (CASE WHEN v_vicios_graves_n      > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN v_garantias_7d_n       > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN v_par_proc_sem_sanc_n  > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN v_par_prazo_vencido_n  > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN v_multas_grandes_n     > 0 THEN 1 ELSE 0 END);

  -- Top critical contracts (mesma fórmula do V43)
  WITH contract_scores AS (
    SELECT c.id, c.numero, c.titulo,
      coalesce((SELECT 3 * count(*) FROM public.contract_receipt_vicios v
                 JOIN public.contract_receipts r ON r.id = v.receipt_id
                 WHERE r.contract_id = c.id
                   AND v.status IN ('aberto','em_saneamento')
                   AND v.severidade IN ('alta','critica')), 0) +
      coalesce((SELECT 2 * count(*) FROM public.contract_par_processes p
                 WHERE p.contract_id = c.id
                   AND p.decisao_resultado IN ('procedente','parcialmente_procedente')
                   AND p.status IN ('decidido','em_recurso')), 0) +
      coalesce((SELECT 2 * count(*) FROM public.contract_guarantees g
                 WHERE g.contract_id = c.id
                   AND g.status IN ('ativa','estendida')
                   AND g.data_vigencia_fim BETWEEN v_today AND v_today + interval '7 days'), 0) AS score
    FROM public.contracts c
    WHERE c.tenant_id = v_tenant AND c.deleted_at IS NULL
      AND c.status NOT IN ('encerrado','cancelado')
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', cs.id, 'numero', cs.numero, 'titulo', cs.titulo, 'score', cs.score
  ) ORDER BY cs.score DESC), '[]'::jsonb)
  INTO v_top_critical
  FROM (SELECT * FROM contract_scores WHERE score > 0 ORDER BY score DESC LIMIT 5) cs;

  -- Next dates (top 5)
  WITH all_dates AS (
    SELECT g.data_vigencia_fim AS due_date,
           (g.data_vigencia_fim - v_today)::int AS days_until,
           format('Garantia #%s', g.numero) AS label,
           g.contract_id, '/garantias'::text AS link
    FROM public.contract_guarantees g
    JOIN public.contracts c ON c.id = g.contract_id
    WHERE g.tenant_id = v_tenant AND c.deleted_at IS NULL
      AND g.status IN ('ativa','estendida')
      AND g.data_vigencia_fim >= v_today

    UNION ALL

    SELECT r.data_limite_definitivo, (r.data_limite_definitivo - v_today)::int,
           format('Recebimento provisório #%s — limite', r.numero),
           r.contract_id, '/recebimentos'
    FROM public.contract_receipts r
    JOIN public.contracts c ON c.id = r.contract_id
    WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL
      AND r.tipo = 'provisorio' AND r.status IN ('emitido','sanado')
      AND r.data_limite_definitivo IS NOT NULL
      AND r.data_limite_definitivo >= v_today
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'due_date', t.due_date, 'days_until', t.days_until, 'label', t.label,
    'contract_id', t.contract_id, 'link', t.link
  ) ORDER BY t.days_until), '[]'::jsonb)
  INTO v_next_dates
  FROM (SELECT * FROM all_dates ORDER BY days_until LIMIT 5) t;

  RETURN jsonb_build_object(
    'member_id',     v_member.id,
    'member_email',  v_member.email,
    'member_nome',   v_member.nome,
    'tenant_id',     v_member.tenant_id,
    'tenant_name',   coalesce(v_tenant_name, ''),
    'frequency',     v_member.alert_digest_frequency,
    'threshold',     v_threshold,
    'alert_count',   v_alerts_count,
    'alerts', jsonb_build_object(
      'vicios_graves',             v_vicios_graves_n,
      'garantias_7d',              v_garantias_7d_n,
      'par_procedente_sem_sancao', v_par_proc_sem_sanc_n,
      'par_prazo_defesa_vencido',  v_par_prazo_vencido_n,
      'multas_grandes_pendentes',  v_multas_grandes_n,
      'multas_total_valor',        v_multas_grandes_total
    ),
    'top_critical', v_top_critical,
    'next_dates',   v_next_dates,
    'generated_at', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_alert_digest_data_for_member(uuid) TO authenticated, service_role;

-- =============================================================================
-- 5. RPC record_alert_digest_sent
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_alert_digest_sent(
  p_member_id uuid,
  p_status    text DEFAULT 'sent',
  p_metadata  jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.members WHERE id = p_member_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Member não encontrado';
  END IF;

  INSERT INTO public.digest_sends (
    member_id, tenant_id, sent_date, digest_kind, email_status, metadata
  ) VALUES (
    p_member_id, v_tenant, current_date, 'alert_lei14133', p_status, p_metadata
  )
  ON CONFLICT (member_id, digest_kind, sent_date)
  DO UPDATE SET email_status = EXCLUDED.email_status,
                sent_at      = now(),
                metadata     = EXCLUDED.metadata;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_alert_digest_sent(uuid, text, jsonb) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.record_alert_digest_sent(uuid, text, jsonb) TO service_role;

-- =============================================================================
-- 6. RPC upsert_alert_digest_settings — UI salva config
-- Parâmetros alinhados ao que a UI chama: p_severity_threshold (não _min)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_alert_digest_settings(
  p_enabled            boolean,
  p_frequency          text DEFAULT 'weekly',
  p_severity_threshold text DEFAULT 'warning'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
BEGIN
  v_member_id := public.current_member_id();
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF p_frequency NOT IN ('daily','weekly','monthly') THEN
    RAISE EXCEPTION 'frequência inválida: %', p_frequency;
  END IF;
  IF p_severity_threshold NOT IN ('warning','danger') THEN
    RAISE EXCEPTION 'severity_threshold inválido: %', p_severity_threshold;
  END IF;

  UPDATE public.members
     SET alert_digest_frequency          = p_frequency,
         alert_digest_severity_threshold = p_severity_threshold,
         updated_at                      = now()
   WHERE id = v_member_id;

  INSERT INTO public.member_notification_prefs (
    tenant_id, member_id, event_type, channel, enabled
  )
  SELECT m.tenant_id, m.id, 'alert_digest_lei14133', 'email', p_enabled
  FROM public.members m WHERE m.id = v_member_id
  ON CONFLICT (member_id, event_type, channel)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();

  RETURN jsonb_build_object(
    'enabled',            p_enabled,
    'frequency',          p_frequency,
    'severity_threshold', p_severity_threshold,
    'last_sent_at',       NULL,
    'last_alert_count',   NULL
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_alert_digest_settings(boolean, text, text) TO authenticated;

-- =============================================================================
-- 7. RPC get_alert_digest_settings — carrega config + última remessa
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_alert_digest_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
  v_enabled   boolean;
  v_frequency text;
  v_threshold text;
  v_configured boolean;
  v_last_sent_at  timestamptz;
  v_last_alert_count int;
BEGIN
  v_member_id := public.current_member_id();
  IF v_member_id IS NULL THEN
    RETURN jsonb_build_object(
      'enabled', false, 'frequency', 'weekly', 'severity_threshold', 'warning',
      'last_sent_at', NULL, 'last_alert_count', NULL, 'configured', false
    );
  END IF;

  SELECT
    coalesce((SELECT enabled FROM public.member_notification_prefs
               WHERE member_id = v_member_id
                 AND event_type = 'alert_digest_lei14133'
                 AND channel = 'email'), false),
    alert_digest_frequency,
    alert_digest_severity_threshold,
    EXISTS (SELECT 1 FROM public.member_notification_prefs
            WHERE member_id = v_member_id
              AND event_type = 'alert_digest_lei14133'
              AND channel = 'email')
  INTO v_enabled, v_frequency, v_threshold, v_configured
  FROM public.members WHERE id = v_member_id;

  SELECT ds.sent_at,
         (ds.metadata->>'alert_count')::int
  INTO v_last_sent_at, v_last_alert_count
  FROM public.digest_sends ds
  WHERE ds.member_id = v_member_id
    AND ds.digest_kind = 'alert_lei14133'
    AND ds.email_status = 'sent'
  ORDER BY ds.sent_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'enabled',            coalesce(v_enabled, false),
    'frequency',          coalesce(v_frequency, 'weekly'),
    'severity_threshold', coalesce(v_threshold, 'warning'),
    'last_sent_at',       v_last_sent_at,
    'last_alert_count',   v_last_alert_count,
    'configured',         coalesce(v_configured, false)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_alert_digest_settings() TO authenticated;

-- =============================================================================
-- 8. RPC preview_alert_digest — botão "Preview" no /me
-- =============================================================================
CREATE OR REPLACE FUNCTION public.preview_alert_digest()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
BEGIN
  v_member_id := public.current_member_id();
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  RETURN public.get_alert_digest_data_for_member(v_member_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.preview_alert_digest() TO authenticated;

-- =============================================================================
-- 9. pg_cron job (idempotente)
-- =============================================================================
DO $$
DECLARE
  v_has_pg_cron boolean;
  v_existing    int;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
  INTO v_has_pg_cron;
  IF NOT v_has_pg_cron THEN
    RAISE NOTICE 'pg_cron não está instalado; agende manualmente';
    RETURN;
  END IF;

  SELECT count(*) INTO v_existing
  FROM cron.job WHERE jobname = 'dispatch-alert-digest-daily';
  IF v_existing > 0 THEN
    RAISE NOTICE 'Job já existe; ignorando';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'dispatch-alert-digest-daily',
    '0 9 * * *',
    $cron$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/dispatch-alert-digest',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object()
      );
    $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Falha ao agendar pg_cron: %', SQLERRM;
END
$$;
