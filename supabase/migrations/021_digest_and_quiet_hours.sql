-- =============================================================================
-- 021_digest_and_quiet_hours
-- =============================================================================
-- (1) Adiciona timezone + quiet hours por usuário
-- (2) Backfill de `notifications.kind` em registros antigos cujo kind genérico
--     pode ser inferido por padrões de título
-- (3) View `v_digest_daily_data` com dados agregados por destinatário
-- (4) RPC `get_my_digest_preview` para in-app preview
-- (5) RPC `record_digest_sent` para registrar disparo (idempotência diária)

-- =============================================================================
-- (1) timezone + quiet hours em members
-- =============================================================================
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS timezone           text NOT NULL DEFAULT 'America/Sao_Paulo',
  ADD COLUMN IF NOT EXISTS quiet_hours_start  time,
  ADD COLUMN IF NOT EXISTS quiet_hours_end    time,
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.members.quiet_hours_start IS 'Início do horário de silêncio (suprime e-mails não críticos)';
COMMENT ON COLUMN public.members.quiet_hours_end   IS 'Fim do horário de silêncio';

-- =============================================================================
-- (2) Backfill kind em notifications antigas
-- =============================================================================
-- Registros pré-V11 entraram com kind='info' ou 'generic'. Aproveitamos
-- padrões no título para reclassificar como event_type específico.
UPDATE public.notifications
SET kind = 'measurement_approval_pending'
WHERE kind IN ('info', 'generic')
  AND (title ILIKE '%aprovação de medição%' OR title ILIKE '%aprovar medição%' OR title ILIKE '%step%aprovação%');

UPDATE public.notifications
SET kind = 'measurement_decided'
WHERE kind IN ('info', 'generic')
  AND (title ILIKE '%medição aprovada%' OR title ILIKE '%medição devolvida%' OR title ILIKE '%medição reprovada%' OR title ILIKE '%medição decidida%');

UPDATE public.notifications
SET kind = 'grd_received'
WHERE kind IN ('info', 'generic')
  AND (title ILIKE '%grd%recebida%' OR title ILIKE '%guia de remessa%recebida%' OR title ILIKE '%nova grd%');

UPDATE public.notifications
SET kind = 'unforeseen_decision_pending'
WHERE kind IN ('info', 'generic')
  AND (title ILIKE '%item não previsto%aprov%' OR title ILIKE '%item não previsto%decisão%' OR title ILIKE '%inp%aprovar%');

UPDATE public.notifications
SET kind = 'additive_approval_pending'
WHERE kind IN ('info', 'generic')
  AND (title ILIKE '%aditivo%aprov%' OR title ILIKE '%termo aditivo%pendente%');

UPDATE public.notifications
SET kind = 'pendency_high'
WHERE kind IN ('info', 'generic')
  AND (title ILIKE '%pendência%alta%' OR title ILIKE '%sla%estourado%' OR title ILIKE '%urgente%');

UPDATE public.notifications
SET kind = 'risk_critico'
WHERE kind IN ('info', 'generic')
  AND (title ILIKE '%risco%crítico%' OR title ILIKE '%contrato%crítico%');

-- =============================================================================
-- (3) View: v_digest_daily_data — uma linha por destinatário com agregações
-- =============================================================================
DROP VIEW IF EXISTS public.v_digest_daily_data CASCADE;

CREATE OR REPLACE VIEW public.v_digest_daily_data WITH (security_invoker = true) AS
WITH minhas_aprovacoes AS (
  SELECT
    s.tenant_id,
    s.member_id AS recipient_member_id,
    count(*) FILTER (WHERE s.status = 'pendente') AS aprovacoes_pendentes,
    count(*) FILTER (WHERE s.status = 'pendente' AND s.due_at < now()) AS aprovacoes_atrasadas
  FROM public.measurement_approval_steps s
  WHERE s.deleted_at IS NULL
  GROUP BY s.tenant_id, s.member_id
),
minhas_grds AS (
  SELECT
    rcp.tenant_id,
    rcp.recipient_id AS recipient_member_id,
    count(*) FILTER (WHERE rcp.confirmed_at IS NULL AND t.status = 'enviada') AS grds_pendentes
  FROM public.ged_receipts rcp
  JOIN public.ged_transmittals t ON t.id = rcp.transmittal_id
  WHERE rcp.recipient_id IS NOT NULL
    AND t.deleted_at IS NULL
  GROUP BY rcp.tenant_id, rcp.recipient_id
),
pendencias_high AS (
  SELECT
    tenant_id,
    count(*) AS pendencias_high
  FROM public.v_pendencias
  WHERE severidade = 'high'
  GROUP BY tenant_id
),
unread_notifications AS (
  SELECT
    n.tenant_id,
    n.recipient_id AS recipient_member_id,
    count(*) AS notif_nao_lidas
  FROM public.notifications n
  WHERE n.deleted_at IS NULL
    AND n.read_at IS NULL
    AND n.created_at >= (now() - interval '7 days')
  GROUP BY n.tenant_id, n.recipient_id
),
score_today AS (
  SELECT
    s.tenant_id,
    count(*) FILTER (WHERE s.score >= 70) AS contratos_criticos,
    count(*) FILTER (WHERE s.score >= 40 AND s.score < 70) AS contratos_atencao
  FROM public.contract_risk_snapshots s
  WHERE s.captured_date = current_date
    AND s.source = 'cron'
  GROUP BY s.tenant_id
)
SELECT
  m.tenant_id,
  m.id AS member_id,
  m.email,
  m.nome,
  m.timezone,
  COALESCE(ma.aprovacoes_pendentes, 0)  AS aprovacoes_pendentes,
  COALESCE(ma.aprovacoes_atrasadas, 0)  AS aprovacoes_atrasadas,
  COALESCE(mg.grds_pendentes, 0)        AS grds_pendentes,
  COALESCE(un.notif_nao_lidas, 0)       AS notif_nao_lidas,
  COALESCE(ph.pendencias_high, 0)       AS pendencias_high_tenant,
  COALESCE(st.contratos_criticos, 0)    AS contratos_criticos_tenant,
  COALESCE(st.contratos_atencao, 0)     AS contratos_atencao_tenant
FROM public.members m
LEFT JOIN minhas_aprovacoes ma     ON ma.recipient_member_id = m.id
LEFT JOIN minhas_grds mg           ON mg.recipient_member_id = m.id
LEFT JOIN unread_notifications un  ON un.recipient_member_id = m.id
LEFT JOIN pendencias_high ph       ON ph.tenant_id = m.tenant_id
LEFT JOIN score_today st           ON st.tenant_id = m.tenant_id
WHERE m.deleted_at IS NULL AND m.active = true;

GRANT SELECT ON public.v_digest_daily_data TO authenticated, service_role;

-- =============================================================================
-- (4) RPC: get_my_digest_preview — dados do meu digest agora
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_my_digest_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member uuid;
  r record;
BEGIN
  v_member := public.current_member_id();
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT * INTO r FROM public.v_digest_daily_data WHERE member_id = v_member;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('member_id', v_member, 'empty', true);
  END IF;

  RETURN jsonb_build_object(
    'member_id',                 r.member_id,
    'email',                     r.email,
    'nome',                      r.nome,
    'aprovacoes_pendentes',      r.aprovacoes_pendentes,
    'aprovacoes_atrasadas',      r.aprovacoes_atrasadas,
    'grds_pendentes',            r.grds_pendentes,
    'notif_nao_lidas',           r.notif_nao_lidas,
    'pendencias_high_tenant',    r.pendencias_high_tenant,
    'contratos_criticos_tenant', r.contratos_criticos_tenant,
    'contratos_atencao_tenant',  r.contratos_atencao_tenant,
    'computed_at',               now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_digest_preview() TO authenticated;

-- =============================================================================
-- (5) Tabela digest_sends + RPC para idempotência diária
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.digest_sends (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sent_date   date NOT NULL DEFAULT current_date,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  email_status text NOT NULL DEFAULT 'sent' CHECK (email_status IN ('sent', 'failed', 'skipped')),
  metadata    jsonb DEFAULT '{}'::jsonb,
  UNIQUE (member_id, sent_date)
);

CREATE INDEX IF NOT EXISTS idx_digest_sends_member_date
  ON public.digest_sends (member_id, sent_date DESC);

ALTER TABLE public.digest_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS digest_sends_select ON public.digest_sends;
CREATE POLICY digest_sends_select ON public.digest_sends
  FOR SELECT USING (tenant_id = public.current_tenant_id());

GRANT SELECT ON public.digest_sends TO authenticated;
GRANT INSERT ON public.digest_sends TO service_role;

-- =============================================================================
-- (6) Função helper: is_in_quiet_hours
-- =============================================================================
-- Retorna true se o horário atual (no tz do member) cai dentro da faixa de
-- silêncio. Suporta intervalos cruzando meia-noite (ex: 22:00–06:00).
CREATE OR REPLACE FUNCTION public.is_in_quiet_hours(p_member_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_start time;
  v_end time;
  v_enabled boolean;
  v_now_t time;
BEGIN
  SELECT timezone, quiet_hours_start, quiet_hours_end, quiet_hours_enabled
    INTO v_tz, v_start, v_end, v_enabled
  FROM public.members WHERE id = p_member_id;

  IF NOT FOUND OR NOT v_enabled OR v_start IS NULL OR v_end IS NULL THEN
    RETURN false;
  END IF;

  v_now_t := (now() AT TIME ZONE v_tz)::time;

  IF v_start <= v_end THEN
    RETURN v_now_t >= v_start AND v_now_t < v_end;
  ELSE
    -- Intervalo cruza meia-noite (ex: 22:00–06:00)
    RETURN v_now_t >= v_start OR v_now_t < v_end;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_in_quiet_hours(uuid) TO authenticated, service_role;
