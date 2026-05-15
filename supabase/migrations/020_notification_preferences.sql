-- =============================================================================
-- 020_notification_preferences — preferências de notificação por usuário
-- =============================================================================
-- Modelo: linha por (member_id, event_type, channel). Se a linha não existe,
-- a função `should_send_notification` retorna o default (true para todos os
-- canais conhecidos, exceto digest_daily que é opt-in).
--
-- Eventos previstos (campo livre — não enforced, pra permitir extensão):
--   measurement_approval_pending  — você tem medição para aprovar
--   measurement_decided           — sua medição foi aprovada/devolvida/reprovada
--   grd_received                  — GRD enviada para você confirmar
--   unforeseen_decision_pending   — item não previsto aguarda decisão
--   additive_approval_pending     — aditivo aguarda aprovação
--   pendency_high                 — pendência de alta severidade no portfólio
--   risk_critico                  — contrato entrou em nível crítico
--   digest_daily                  — resumo diário (opt-in)
--   system                        — alertas críticos do sistema (não desligável)
--
-- Canais: 'in_app', 'email'

CREATE TABLE IF NOT EXISTS public.member_notification_prefs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  event_type  text NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('in_app', 'email')),
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, event_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_member_notif_prefs_member
  ON public.member_notification_prefs (member_id);

ALTER TABLE public.member_notification_prefs ENABLE ROW LEVEL SECURITY;

-- O usuário só vê/edita suas próprias prefs
DROP POLICY IF EXISTS member_notif_prefs_select ON public.member_notification_prefs;
CREATE POLICY member_notif_prefs_select ON public.member_notification_prefs
  FOR SELECT USING (member_id = public.current_member_id());

DROP POLICY IF EXISTS member_notif_prefs_upsert ON public.member_notification_prefs;
CREATE POLICY member_notif_prefs_upsert ON public.member_notification_prefs
  FOR ALL USING (member_id = public.current_member_id())
  WITH CHECK (member_id = public.current_member_id() AND tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_notification_prefs TO authenticated;

-- =============================================================================
-- RPC: should_send_notification — consulta preferências (com defaults)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.should_send_notification(
  p_member_id uuid,
  p_event_type text,
  p_channel text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  -- Evento 'system' é sempre enviado
  IF p_event_type = 'system' THEN
    RETURN true;
  END IF;

  SELECT enabled INTO v_enabled
  FROM public.member_notification_prefs
  WHERE member_id = p_member_id
    AND event_type = p_event_type
    AND channel = p_channel
  LIMIT 1;

  IF FOUND THEN
    RETURN v_enabled;
  END IF;

  -- Defaults: digest_daily é opt-in (false), os demais são opt-out (true)
  IF p_event_type = 'digest_daily' THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.should_send_notification(uuid, text, text) TO authenticated, service_role;

-- =============================================================================
-- RPC: upsert_notification_pref — atualiza uma preferência
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_notification_pref(
  p_event_type text,
  p_channel text,
  p_enabled boolean
)
RETURNS public.member_notification_prefs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member uuid;
  v_tenant uuid;
  out_row public.member_notification_prefs;
BEGIN
  v_member := public.current_member_id();
  v_tenant := public.current_tenant_id();
  IF v_member IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;
  IF p_channel NOT IN ('in_app', 'email') THEN
    RAISE EXCEPTION 'channel inválido: %', p_channel;
  END IF;

  INSERT INTO public.member_notification_prefs (tenant_id, member_id, event_type, channel, enabled)
  VALUES (v_tenant, v_member, p_event_type, p_channel, p_enabled)
  ON CONFLICT (member_id, event_type, channel) DO UPDATE
    SET enabled = excluded.enabled, updated_at = now()
  RETURNING * INTO out_row;

  RETURN out_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_notification_pref(text, text, boolean) TO authenticated;

-- =============================================================================
-- View: v_my_notification_prefs — todas as combinações de evento×canal
-- =============================================================================
-- Para a UI montar a matriz: retorna 1 linha por evento×canal, com pref efetiva.
CREATE OR REPLACE VIEW public.v_my_notification_prefs AS
WITH events AS (
  SELECT unnest(ARRAY[
    'measurement_approval_pending',
    'measurement_decided',
    'grd_received',
    'unforeseen_decision_pending',
    'additive_approval_pending',
    'pendency_high',
    'risk_critico',
    'digest_daily'
  ]) AS event_type
),
channels AS (
  SELECT unnest(ARRAY['in_app','email']) AS channel
),
combos AS (
  SELECT e.event_type, c.channel FROM events e CROSS JOIN channels c
)
SELECT
  combos.event_type,
  combos.channel,
  COALESCE(p.enabled,
    CASE WHEN combos.event_type = 'digest_daily' THEN false ELSE true END
  ) AS enabled,
  p.id AS pref_id,
  p.updated_at
FROM combos
LEFT JOIN public.member_notification_prefs p
  ON p.event_type = combos.event_type
 AND p.channel = combos.channel
 AND p.member_id = public.current_member_id();

GRANT SELECT ON public.v_my_notification_prefs TO authenticated;
