-- =============================================================================
-- 029_webhooks_and_scheduled_risk
-- =============================================================================
-- (A) Webhooks outgoing por tenant — Slack / Teams / payload genérico
--     - Tabela tenant_webhooks (URL armazenada em texto; secret_hint é só dica)
--     - Tabela webhook_dispatch_log (auditoria de cada disparo)
--     - RPCs CRUD + RPC list_webhooks_for_event
--     - RPC record_webhook_dispatch (chamada pela EF após POST)
--
-- (B) Helper para scheduler de risk snapshots:
--     - View v_contracts_stale_risk (contratos vigentes com snapshot >= N dias)
--     - RPC contracts_needing_risk_refresh(p_max_age_days int default 14, p_limit int)
-- =============================================================================

-- =============================================================================
-- (A.1) Tabela tenant_webhooks
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tenant_webhooks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label           text NOT NULL CHECK (length(trim(label)) BETWEEN 2 AND 80),
  kind            text NOT NULL CHECK (kind IN ('slack', 'teams', 'generic')),
  url             text NOT NULL CHECK (url ~ '^https?://'),
  secret_hint     text,           -- dica visível (últimos 4 chars do token, opcional)
  events          text[] NOT NULL DEFAULT ARRAY['broadcast_sent'],
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_called_at  timestamptz,
  last_status     text,
  last_response_code int
);

CREATE INDEX IF NOT EXISTS idx_tenant_webhooks_tenant ON public.tenant_webhooks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_webhooks_active ON public.tenant_webhooks(tenant_id, active) WHERE active = true;

-- =============================================================================
-- (A.2) Log de disparos
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.webhook_dispatch_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      uuid NOT NULL REFERENCES public.tenant_webhooks(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  broadcast_id    uuid REFERENCES public.notification_broadcasts(id) ON DELETE SET NULL,
  event           text NOT NULL,
  attempted_at    timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL CHECK (status IN ('ok', 'error', 'skipped')),
  response_code   int,
  error_text      text,
  payload_preview text   -- primeiros ~300 chars do payload pra debug
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_webhook ON public.webhook_dispatch_log(webhook_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_log_tenant ON public.webhook_dispatch_log(tenant_id, attempted_at DESC);

-- =============================================================================
-- RLS — tenant_webhooks
-- =============================================================================
ALTER TABLE public.tenant_webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_webhooks_read ON public.tenant_webhooks;
CREATE POLICY tenant_webhooks_read ON public.tenant_webhooks
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin' OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  );

DROP POLICY IF EXISTS tenant_webhooks_write ON public.tenant_webhooks;
CREATE POLICY tenant_webhooks_write ON public.tenant_webhooks
  FOR ALL TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin' OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  )
  WITH CHECK (tenant_id = public.current_tenant_id());

-- =============================================================================
-- RLS — webhook_dispatch_log
-- =============================================================================
ALTER TABLE public.webhook_dispatch_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_log_read ON public.webhook_dispatch_log;
CREATE POLICY webhook_log_read ON public.webhook_dispatch_log
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
-- View: webhooks com last dispatch resumido
-- =============================================================================
CREATE OR REPLACE VIEW public.v_tenant_webhooks AS
SELECT
  w.id, w.tenant_id, w.label, w.kind, w.url, w.secret_hint, w.events, w.active,
  w.created_by, w.created_at, w.last_called_at, w.last_status, w.last_response_code,
  m.nome AS created_by_nome,
  (SELECT count(*) FROM public.webhook_dispatch_log d WHERE d.webhook_id = w.id) AS dispatch_count,
  (SELECT count(*) FROM public.webhook_dispatch_log d WHERE d.webhook_id = w.id AND d.status = 'error') AS error_count
FROM public.tenant_webhooks w
LEFT JOIN public.members m ON m.id = w.created_by;

GRANT SELECT ON public.v_tenant_webhooks TO authenticated;

-- =============================================================================
-- RPC: list_tenant_webhooks
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_tenant_webhooks()
RETURNS SETOF public.v_tenant_webhooks
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.v_tenant_webhooks
  WHERE tenant_id = public.current_tenant_id()
  ORDER BY active DESC, label ASC;
$$;

GRANT EXECUTE ON FUNCTION public.list_tenant_webhooks() TO authenticated;

-- =============================================================================
-- RPC: list_webhooks_for_event — usada por EFs (não exposta no client)
-- Retorna webhooks ativos do tenant inscritos no evento.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_webhooks_for_event(
  p_tenant_id uuid,
  p_event     text
)
RETURNS SETOF public.tenant_webhooks
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.tenant_webhooks
  WHERE tenant_id = p_tenant_id
    AND active = true
    AND p_event = ANY(events);
$$;

GRANT EXECUTE ON FUNCTION public.list_webhooks_for_event(uuid, text) TO service_role;

-- =============================================================================
-- RPC: upsert_tenant_webhook
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_tenant_webhook(
  p_id          uuid,
  p_label       text,
  p_kind        text,
  p_url         text,
  p_secret_hint text,
  p_events      text[],
  p_active      boolean
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

  IF p_kind NOT IN ('slack', 'teams', 'generic') THEN
    RAISE EXCEPTION 'kind inválido (use slack, teams ou generic)';
  END IF;
  IF p_url !~ '^https?://' THEN
    RAISE EXCEPTION 'URL inválida (deve começar com http:// ou https://)';
  END IF;
  IF cardinality(coalesce(p_events, ARRAY[]::text[])) = 0 THEN
    RAISE EXCEPTION 'Selecione pelo menos um evento';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.tenant_webhooks (
      tenant_id, label, kind, url, secret_hint, events, active, created_by
    )
    VALUES (v_tenant, trim(p_label), p_kind, p_url, nullif(trim(p_secret_hint), ''), p_events, p_active, v_member)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.tenant_webhooks
       SET label = trim(p_label),
           kind = p_kind,
           url = p_url,
           secret_hint = nullif(trim(p_secret_hint), ''),
           events = p_events,
           active = p_active
     WHERE id = p_id AND tenant_id = v_tenant
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Webhook não encontrado'; END IF;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_tenant_webhook(uuid, text, text, text, text, text[], boolean) TO authenticated;

-- =============================================================================
-- RPC: delete_tenant_webhook
-- =============================================================================
CREATE OR REPLACE FUNCTION public.delete_tenant_webhook(p_id uuid)
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
  IF NOT v_admin THEN RAISE EXCEPTION 'Apenas administradores podem excluir webhooks'; END IF;
  DELETE FROM public.tenant_webhooks WHERE id = p_id AND tenant_id = v_tenant;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_tenant_webhook(uuid) TO authenticated;

-- =============================================================================
-- RPC: record_webhook_dispatch — chamada pela EF após POST
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_webhook_dispatch(
  p_webhook_id    uuid,
  p_broadcast_id  uuid,
  p_event         text,
  p_status        text,
  p_response_code int,
  p_error_text    text,
  p_payload_preview text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_log_id    uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.tenant_webhooks WHERE id = p_webhook_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Webhook não encontrado'; END IF;

  INSERT INTO public.webhook_dispatch_log (
    webhook_id, tenant_id, broadcast_id, event, status, response_code, error_text, payload_preview
  )
  VALUES (
    p_webhook_id, v_tenant_id, p_broadcast_id, p_event, p_status, p_response_code, p_error_text,
    left(coalesce(p_payload_preview, ''), 300)
  )
  RETURNING id INTO v_log_id;

  UPDATE public.tenant_webhooks
     SET last_called_at = now(),
         last_status = p_status,
         last_response_code = p_response_code
   WHERE id = p_webhook_id;

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_webhook_dispatch(uuid, uuid, text, text, int, text, text) TO service_role;

-- =============================================================================
-- RPC: list_webhook_dispatches — UI vê histórico do tenant
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_webhook_dispatches(p_limit int DEFAULT 50)
RETURNS TABLE (
  id              uuid,
  webhook_id      uuid,
  webhook_label   text,
  webhook_kind    text,
  broadcast_id    uuid,
  event           text,
  attempted_at    timestamptz,
  status          text,
  response_code   int,
  error_text      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id, d.webhook_id, w.label, w.kind, d.broadcast_id, d.event,
    d.attempted_at, d.status, d.response_code, d.error_text
  FROM public.webhook_dispatch_log d
  JOIN public.tenant_webhooks w ON w.id = d.webhook_id
  WHERE d.tenant_id = public.current_tenant_id()
  ORDER BY d.attempted_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
$$;

GRANT EXECUTE ON FUNCTION public.list_webhook_dispatches(int) TO authenticated;

-- =============================================================================
-- (B) Helper para scheduler de risk snapshots
-- =============================================================================
-- Contratos vigentes (não encerrados/cancelados) com snapshot ausente ou stale.
-- =============================================================================
CREATE OR REPLACE VIEW public.v_contracts_stale_risk AS
SELECT
  c.id           AS contract_id,
  c.tenant_id,
  c.numero,
  c.objeto,
  c.status,
  rs.captured_at AS last_snapshot_at,
  CASE
    WHEN rs.captured_at IS NULL THEN 'never'
    WHEN rs.captured_at < now() - interval '30 days' THEN 'critical'
    WHEN rs.captured_at < now() - interval '14 days' THEN 'stale'
    ELSE 'fresh'
  END AS freshness
FROM public.contracts c
LEFT JOIN LATERAL (
  SELECT captured_at FROM public.contract_risk_snapshots
  WHERE contract_id = c.id
  ORDER BY captured_at DESC LIMIT 1
) rs ON true
WHERE c.deleted_at IS NULL
  AND c.status IN ('contratado', 'em_execucao', 'suspenso');

GRANT SELECT ON public.v_contracts_stale_risk TO authenticated;

-- =============================================================================
-- RPC: contracts_needing_risk_refresh
-- =============================================================================
CREATE OR REPLACE FUNCTION public.contracts_needing_risk_refresh(
  p_max_age_days int DEFAULT 14,
  p_limit        int DEFAULT 50
)
RETURNS TABLE (
  contract_id      uuid,
  tenant_id        uuid,
  numero           text,
  objeto           text,
  last_snapshot_at timestamptz,
  freshness        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.contract_id, v.tenant_id, v.numero, v.objeto, v.last_snapshot_at, v.freshness
  FROM public.v_contracts_stale_risk v
  WHERE v.tenant_id = public.current_tenant_id()
    AND (v.last_snapshot_at IS NULL OR v.last_snapshot_at < now() - make_interval(days => p_max_age_days))
  ORDER BY v.last_snapshot_at ASC NULLS FIRST
  LIMIT greatest(1, least(coalesce(p_limit, 50), 500));
$$;

GRANT EXECUTE ON FUNCTION public.contracts_needing_risk_refresh(int, int) TO authenticated;
