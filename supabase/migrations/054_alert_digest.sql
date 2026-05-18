-- =============================================================================
-- 054_alert_digest
-- =============================================================================
-- Email digest de alertas Lei 14.133 (V41/V43 agregados num cron).
--
-- Cada admin/gestor pode optar por receber resumo periódico dos alertas
-- críticos da carteira:
--   * frequency: diário / semanal / mensal
--   * severity_threshold: warning (todos) ou danger (só críticos)
--
-- O dispatch é feito pela EF dispatch-alert-digest agendada via pg_cron.
-- Idempotência: usa tabela digest_sends V21 (compartilhada com digest-daily).
--
-- Tabela própria (não reutiliza member_notification_prefs) porque precisa de
-- mais do que enabled — frequency e severity são opcoes per-user.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.member_alert_digest_settings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  member_id           uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  enabled             boolean NOT NULL DEFAULT true,
  frequency           text NOT NULL DEFAULT 'weekly'
                        CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  severity_threshold  text NOT NULL DEFAULT 'warning'
                        CHECK (severity_threshold IN ('warning', 'danger')),
  last_sent_at        timestamptz,
  last_alert_count    int,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id)
);

CREATE INDEX IF NOT EXISTS idx_alert_digest_settings_tenant
  ON public.member_alert_digest_settings (tenant_id) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_alert_digest_settings_due
  ON public.member_alert_digest_settings (last_sent_at) WHERE enabled = true;

ALTER TABLE public.member_alert_digest_settings ENABLE ROW LEVEL SECURITY;

-- Usuário só vê/edita as próprias settings
DROP POLICY IF EXISTS alert_digest_settings_select ON public.member_alert_digest_settings;
CREATE POLICY alert_digest_settings_select ON public.member_alert_digest_settings
  FOR SELECT TO authenticated
  USING (member_id = public.current_member_id());

DROP POLICY IF EXISTS alert_digest_settings_upsert ON public.member_alert_digest_settings;
CREATE POLICY alert_digest_settings_upsert ON public.member_alert_digest_settings
  FOR ALL TO authenticated
  USING (member_id = public.current_member_id())
  WITH CHECK (member_id = public.current_member_id()
              AND tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_alert_digest_settings TO authenticated;

-- =============================================================================
-- RPC: upsert_alert_digest_settings — self-management
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_alert_digest_settings(
  p_enabled            boolean,
  p_frequency          text,
  p_severity_threshold text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
  v_row    record;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();

  IF v_member IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF p_frequency NOT IN ('daily', 'weekly', 'monthly') THEN
    RAISE EXCEPTION 'frequency deve ser daily, weekly ou monthly';
  END IF;
  IF p_severity_threshold NOT IN ('warning', 'danger') THEN
    RAISE EXCEPTION 'severity_threshold deve ser warning ou danger';
  END IF;

  INSERT INTO public.member_alert_digest_settings (
    tenant_id, member_id, enabled, frequency, severity_threshold
  )
  VALUES (v_tenant, v_member, p_enabled, p_frequency, p_severity_threshold)
  ON CONFLICT (member_id) DO UPDATE
    SET enabled            = EXCLUDED.enabled,
        frequency          = EXCLUDED.frequency,
        severity_threshold = EXCLUDED.severity_threshold,
        updated_at         = now()
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_alert_digest_settings(boolean, text, text) TO authenticated;

-- =============================================================================
-- RPC: get_alert_digest_settings — leitura das próprias settings
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_alert_digest_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member uuid;
  v_row    record;
BEGIN
  v_member := public.current_member_id();
  IF v_member IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_row FROM public.member_alert_digest_settings WHERE member_id = v_member;

  IF NOT FOUND THEN
    -- Retorna defaults (settings ainda não criadas)
    RETURN jsonb_build_object(
      'enabled',            false,
      'frequency',          'weekly',
      'severity_threshold', 'warning',
      'last_sent_at',       null,
      'last_alert_count',   null,
      'configured',         false
    );
  END IF;

  RETURN jsonb_build_object(
    'id',                 v_row.id,
    'enabled',            v_row.enabled,
    'frequency',          v_row.frequency,
    'severity_threshold', v_row.severity_threshold,
    'last_sent_at',       v_row.last_sent_at,
    'last_alert_count',   v_row.last_alert_count,
    'configured',         true,
    'updated_at',         v_row.updated_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_alert_digest_settings() TO authenticated;

-- =============================================================================
-- RPC: get_alert_digest_data_for_member — gera o conteúdo do digest
-- Filtra alertas do tenant pelo limiar do member
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_alert_digest_data_for_member(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member      record;
  v_tenant_name text;
  v_today       date := current_date;
  v_threshold   text;
  v_include_warning boolean;

  v_vicios_n    int;
  v_garantias_n int;
  v_par_sem_sanc_n int;
  v_par_prazo_n int;
  v_multas_n    int;
  v_multas_total numeric;
  v_alert_count int := 0;

  v_top_critical jsonb;
  v_next_dates   jsonb;
BEGIN
  -- Resolve member + tenant
  SELECT m.id, m.tenant_id, m.email, m.nome,
         t.name AS tenant_name
  INTO v_member
  FROM public.members m
  JOIN public.tenants t ON t.id = m.tenant_id
  WHERE m.id = p_member_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Threshold do member
  SELECT severity_threshold INTO v_threshold
  FROM public.member_alert_digest_settings WHERE member_id = p_member_id;
  v_threshold := coalesce(v_threshold, 'warning');
  v_include_warning := (v_threshold = 'warning');

  -- Alert 1: vícios graves (sempre danger)
  SELECT count(DISTINCT r.contract_id)::int
  INTO v_vicios_n
  FROM public.contract_receipt_vicios v
  JOIN public.contract_receipts r ON r.id = v.receipt_id
  JOIN public.contracts c ON c.id = r.contract_id
  WHERE r.tenant_id = v_member.tenant_id
    AND c.deleted_at IS NULL
    AND v.status IN ('aberto','em_saneamento')
    AND v.severidade IN ('alta','critica');

  -- Alert 2: garantias <=7d (sempre danger)
  SELECT count(*)::int
  INTO v_garantias_n
  FROM public.contract_guarantees g
  JOIN public.contracts c ON c.id = g.contract_id
  WHERE g.tenant_id = v_member.tenant_id
    AND c.deleted_at IS NULL
    AND g.status IN ('ativa','estendida')
    AND g.data_vigencia_fim BETWEEN v_today AND v_today + interval '7 days';

  -- Alert 3: PARs procedentes sem sanção (warning)
  IF v_include_warning THEN
    SELECT count(*)::int
    INTO v_par_sem_sanc_n
    FROM public.contract_par_processes p
    JOIN public.contracts c ON c.id = p.contract_id
    WHERE p.tenant_id = v_member.tenant_id
      AND c.deleted_at IS NULL
      AND p.decisao_resultado IN ('procedente','parcialmente_procedente')
      AND p.status IN ('decidido','arquivado')
      AND p.sancao_proposta_tipos IS NOT NULL
      AND cardinality(p.sancao_proposta_tipos) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.contract_sanctions s
        WHERE s.par_id = p.id
          AND s.status IN ('ativa','suspensa','cumprida')
      );
  ELSE v_par_sem_sanc_n := 0; END IF;

  -- Alert 4: PARs prazo defesa vencido (warning)
  IF v_include_warning THEN
    SELECT count(*)::int
    INTO v_par_prazo_n
    FROM public.contract_par_processes p
    JOIN public.contracts c ON c.id = p.contract_id
    WHERE p.tenant_id = v_member.tenant_id
      AND c.deleted_at IS NULL
      AND p.status = 'em_defesa'
      AND p.defesa_prazo_limite < v_today;
  ELSE v_par_prazo_n := 0; END IF;

  -- Alert 5: multas grandes pendentes (warning)
  IF v_include_warning THEN
    SELECT count(*)::int, coalesce(sum(s.valor_multa), 0)
    INTO v_multas_n, v_multas_total
    FROM public.contract_sanctions s
    JOIN public.contracts c ON c.id = s.contract_id
    WHERE s.tenant_id = v_member.tenant_id
      AND c.deleted_at IS NULL
      AND s.tipo = 'multa'
      AND s.status IN ('ativa','suspensa')
      AND s.data_pagamento_multa IS NULL
      AND s.valor_multa > 100000;
  ELSE v_multas_n := 0; v_multas_total := 0; END IF;

  v_alert_count := v_vicios_n + v_garantias_n + v_par_sem_sanc_n + v_par_prazo_n + v_multas_n;

  -- Top 5 contratos críticos (mesmo score do V43, limitado)
  WITH contract_scores AS (
    SELECT
      c.id, c.numero, c.titulo,
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
    WHERE c.tenant_id = v_member.tenant_id AND c.deleted_at IS NULL
      AND c.status NOT IN ('encerrado','cancelado')
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', cs.id, 'numero', cs.numero, 'titulo', cs.titulo, 'score', cs.score)
                            ORDER BY cs.score DESC), '[]'::jsonb)
  INTO v_top_critical
  FROM (SELECT * FROM contract_scores WHERE score > 0 ORDER BY score DESC LIMIT 5) cs;

  -- Próximos 5 vencimentos
  WITH all_dates AS (
    SELECT g.data_vigencia_fim AS due_date, (g.data_vigencia_fim - v_today)::int AS days_until,
           format('Garantia #%s · contrato #%s', g.numero, c.numero) AS label, c.id AS contract_id, '/garantias'::text AS link
    FROM public.contract_guarantees g JOIN public.contracts c ON c.id = g.contract_id
    WHERE g.tenant_id = v_member.tenant_id AND c.deleted_at IS NULL
      AND g.status IN ('ativa','estendida') AND g.data_vigencia_fim >= v_today
    UNION ALL
    SELECT p.defesa_prazo_limite, (p.defesa_prazo_limite - v_today)::int,
           format('Defesa do PAR #%s · contrato #%s', p.numero, c.numero), c.id, '/processos-administrativos'
    FROM public.contract_par_processes p JOIN public.contracts c ON c.id = p.contract_id
    WHERE p.tenant_id = v_member.tenant_id AND c.deleted_at IS NULL
      AND p.status = 'em_defesa' AND p.defesa_prazo_limite >= v_today
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'due_date', t.due_date, 'days_until', t.days_until, 'label', t.label,
    'contract_id', t.contract_id, 'link', t.link
  ) ORDER BY t.days_until), '[]'::jsonb)
  INTO v_next_dates
  FROM (SELECT * FROM all_dates ORDER BY days_until LIMIT 5) t;

  RETURN jsonb_build_object(
    'member_id',        v_member.id,
    'member_email',     v_member.email,
    'member_nome',      v_member.nome,
    'tenant_id',        v_member.tenant_id,
    'tenant_name',      v_tenant_name,
    'alert_count',      v_alert_count,
    'threshold',        v_threshold,
    'alerts', jsonb_build_object(
      'vicios_graves',              v_vicios_n,
      'garantias_7d',               v_garantias_n,
      'par_procedente_sem_sancao',  v_par_sem_sanc_n,
      'par_prazo_defesa_vencido',   v_par_prazo_n,
      'multas_grandes_pendentes',   v_multas_n,
      'multas_total_valor',         v_multas_total
    ),
    'top_critical',     v_top_critical,
    'next_dates',       v_next_dates,
    'generated_at',     now()
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_alert_digest_data_for_member(uuid) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.get_alert_digest_data_for_member(uuid) TO service_role;

-- Versão para preview pelo próprio user (sem aceitar member_id arbitrário)
CREATE OR REPLACE FUNCTION public.preview_alert_digest()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.get_alert_digest_data_for_member(public.current_member_id());
END;
$$;
GRANT EXECUTE ON FUNCTION public.preview_alert_digest() TO authenticated;

-- =============================================================================
-- RPC: list_pending_alert_digest_recipients — chamada pela EF
-- Retorna members opted-in com janela de frequência cumprida
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_pending_alert_digest_recipients()
RETURNS TABLE (
  member_id            uuid,
  tenant_id            uuid,
  email                text,
  nome                 text,
  frequency            text,
  severity_threshold   text,
  last_sent_at         timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.member_id, s.tenant_id,
    m.email, m.nome,
    s.frequency, s.severity_threshold,
    s.last_sent_at
  FROM public.member_alert_digest_settings s
  JOIN public.members m ON m.id = s.member_id
  WHERE s.enabled = true
    AND m.email IS NOT NULL
    AND m.deleted_at IS NULL
    AND (
      s.last_sent_at IS NULL
      OR (s.frequency = 'daily'   AND s.last_sent_at < now() - interval '22 hours')
      OR (s.frequency = 'weekly'  AND s.last_sent_at < now() - interval '6 days')
      OR (s.frequency = 'monthly' AND s.last_sent_at < now() - interval '28 days')
    );
$$;
REVOKE EXECUTE ON FUNCTION public.list_pending_alert_digest_recipients() FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_alert_digest_recipients() TO service_role;

-- =============================================================================
-- RPC: record_alert_digest_sent — chamada pela EF após sucesso
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_alert_digest_sent(
  p_member_id    uuid,
  p_alert_count  int,
  p_email_status text DEFAULT 'sent'
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.member_alert_digest_settings
     SET last_sent_at     = now(),
         last_alert_count = p_alert_count,
         updated_at       = now()
   WHERE member_id = p_member_id;
$$;
REVOKE EXECUTE ON FUNCTION public.record_alert_digest_sent(uuid, int, text) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.record_alert_digest_sent(uuid, int, text) TO service_role;

-- =============================================================================
-- pg_cron: agenda diária às 9h UTC
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron não disponível, agendamento manual necessário';
    RETURN;
  END IF;

  -- Remove job anterior se existir (idempotente)
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dispatch-alert-digest-daily';

  -- Schedule novo (9h UTC = 6h Brasília)
  PERFORM cron.schedule(
    'dispatch-alert-digest-daily',
    '0 9 * * *',
    $cron$
    SELECT net.http_post(
      url := current_setting('app.supabase_url', true) || '/functions/v1/dispatch-alert-digest',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule falhou: %. Agende manualmente após deploy.', SQLERRM;
END
$$;
