-- =============================================================================
-- 030_webhook_signing_and_templates
-- =============================================================================
-- (A) Suporte a assinatura HMAC-SHA256 nos webhooks:
--     - Coluna `signing_secret` (opcional) em tenant_webhooks
--     - RPC `rotate_webhook_secret` retorna o secret em texto plano apenas
--       no momento da rotação (write-once-read-once)
--
-- (B) Payload customizável para kind='generic':
--     - Coluna `payload_template` (text, JSON com variáveis {{ … }})
--     - Helper SQL `interpolate_webhook_payload` espelha a interpolação
--       client-side e injeta os campos do broadcast
--
-- (C) Coluna metadata simples no log de disparo (foi pra audit deeper)
-- =============================================================================

-- =============================================================================
-- (A) Signing secret
-- =============================================================================
ALTER TABLE public.tenant_webhooks
  ADD COLUMN IF NOT EXISTS signing_secret    text,
  ADD COLUMN IF NOT EXISTS secret_rotated_at timestamptz,
  ADD COLUMN IF NOT EXISTS payload_template  text;

COMMENT ON COLUMN public.tenant_webhooks.signing_secret IS
  'Segredo HMAC-SHA256 opcional. EF assina o body com sha256 e envia em X-Consultegeo-Signature.';
COMMENT ON COLUMN public.tenant_webhooks.payload_template IS
  'Apenas para kind=generic. JSON com placeholders {{ … }}. Quando NULL, EF usa o payload padrão.';

-- =============================================================================
-- RPC: rotate_webhook_secret — gera secret e retorna apenas uma vez
-- =============================================================================
-- O secret é armazenado em texto plano (similar a webhook signing secrets do
-- Stripe/GitHub). Em produção pode-se cifrar via pgcrypto — fica como TODO.
-- O retorno textual é a única forma de o admin ver o secret; depois disso só
-- vê o "hint" (últimos 4 chars).
CREATE OR REPLACE FUNCTION public.rotate_webhook_secret(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   uuid;
  v_admin    boolean;
  v_secret   text;
  v_hint     text;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))) INTO v_admin
    FROM public.members WHERE id = public.current_member_id();
  IF NOT v_admin THEN RAISE EXCEPTION 'Apenas administradores podem girar segredos'; END IF;

  -- Gera segredo de 48 chars base64url-ish via gen_random_bytes
  v_secret := 'whsec_' || replace(replace(encode(gen_random_bytes(32), 'base64'), '/', '_'), '+', '-');
  v_secret := rtrim(v_secret, '=');
  v_hint   := '…' || right(v_secret, 4);

  UPDATE public.tenant_webhooks
     SET signing_secret = v_secret,
         secret_hint = v_hint,
         secret_rotated_at = now()
   WHERE id = p_id AND tenant_id = v_tenant
  RETURNING signing_secret INTO v_secret;

  IF v_secret IS NULL THEN RAISE EXCEPTION 'Webhook não encontrado'; END IF;

  -- Audit (não persiste o secret no log)
  INSERT INTO public.audit_log (tenant_id, member_id, entity_type, entity_id, action, metadata)
  VALUES (v_tenant, public.current_member_id(), 'tenant_webhook', p_id, 'rotate_secret',
          jsonb_build_object('hint', v_hint));

  RETURN jsonb_build_object('secret', v_secret, 'hint', v_hint, 'rotated_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.rotate_webhook_secret(uuid) TO authenticated;

-- =============================================================================
-- RPC: clear_webhook_secret — desativa assinatura HMAC
-- =============================================================================
CREATE OR REPLACE FUNCTION public.clear_webhook_secret(p_id uuid)
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

  UPDATE public.tenant_webhooks
     SET signing_secret = NULL,
         secret_rotated_at = NULL,
         secret_hint = NULL
   WHERE id = p_id AND tenant_id = v_tenant;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_webhook_secret(uuid) TO authenticated;

-- =============================================================================
-- (B) Update da view e RPCs pra expor `has_signing_secret` (mas nunca o valor)
-- =============================================================================
DROP VIEW IF EXISTS public.v_tenant_webhooks;
CREATE OR REPLACE VIEW public.v_tenant_webhooks AS
SELECT
  w.id, w.tenant_id, w.label, w.kind, w.url, w.secret_hint, w.events, w.active,
  w.created_by, w.created_at, w.last_called_at, w.last_status, w.last_response_code,
  m.nome AS created_by_nome,
  (w.signing_secret IS NOT NULL) AS has_signing_secret,
  w.secret_rotated_at,
  w.payload_template,
  (SELECT count(*) FROM public.webhook_dispatch_log d WHERE d.webhook_id = w.id) AS dispatch_count,
  (SELECT count(*) FROM public.webhook_dispatch_log d WHERE d.webhook_id = w.id AND d.status = 'error') AS error_count
FROM public.tenant_webhooks w
LEFT JOIN public.members m ON m.id = w.created_by;

GRANT SELECT ON public.v_tenant_webhooks TO authenticated;

-- Recreate list_tenant_webhooks pra retornar a nova view
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
-- Payload template: upsert ganha p_payload_template
-- =============================================================================
DROP FUNCTION IF EXISTS public.upsert_tenant_webhook(uuid, text, text, text, text, text[], boolean);

CREATE OR REPLACE FUNCTION public.upsert_tenant_webhook(
  p_id              uuid,
  p_label           text,
  p_kind            text,
  p_url             text,
  p_secret_hint     text,
  p_events          text[],
  p_active          boolean,
  p_payload_template text DEFAULT NULL
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

  -- Valida que payload_template é JSON parseável (se fornecido)
  IF p_payload_template IS NOT NULL AND length(trim(p_payload_template)) > 0 THEN
    IF p_kind <> 'generic' THEN
      RAISE EXCEPTION 'Payload customizado só é suportado em kind=generic';
    END IF;
    BEGIN
      PERFORM p_payload_template::jsonb;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'payload_template não é JSON válido: %', SQLERRM;
    END;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.tenant_webhooks (
      tenant_id, label, kind, url, secret_hint, events, active, created_by, payload_template
    )
    VALUES (
      v_tenant, trim(p_label), p_kind, p_url, nullif(trim(p_secret_hint), ''),
      p_events, p_active, v_member, nullif(trim(p_payload_template), '')
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
           payload_template = nullif(trim(p_payload_template), '')
     WHERE id = p_id AND tenant_id = v_tenant
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Webhook não encontrado'; END IF;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_tenant_webhook(uuid, text, text, text, text, text[], boolean, text) TO authenticated;

-- =============================================================================
-- (C) Audit deeper no dispatch log
-- =============================================================================
ALTER TABLE public.webhook_dispatch_log
  ADD COLUMN IF NOT EXISTS signed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.webhook_dispatch_log.signed IS
  'True quando o payload foi enviado com header X-Consultegeo-Signature';

-- Reescreve record_webhook_dispatch pra aceitar p_signed
DROP FUNCTION IF EXISTS public.record_webhook_dispatch(uuid, uuid, text, text, int, text, text);

CREATE OR REPLACE FUNCTION public.record_webhook_dispatch(
  p_webhook_id      uuid,
  p_broadcast_id    uuid,
  p_event           text,
  p_status          text,
  p_response_code   int,
  p_error_text      text,
  p_payload_preview text,
  p_signed          boolean DEFAULT false
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
    webhook_id, tenant_id, broadcast_id, event, status, response_code, error_text, payload_preview, signed
  )
  VALUES (
    p_webhook_id, v_tenant_id, p_broadcast_id, p_event, p_status, p_response_code, p_error_text,
    left(coalesce(p_payload_preview, ''), 300), coalesce(p_signed, false)
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

GRANT EXECUTE ON FUNCTION public.record_webhook_dispatch(uuid, uuid, text, text, int, text, text, boolean) TO service_role;

-- =============================================================================
-- Update list_webhook_dispatches pra incluir flag signed
-- =============================================================================
DROP FUNCTION IF EXISTS public.list_webhook_dispatches(int);

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
  error_text      text,
  signed          boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id, d.webhook_id, w.label, w.kind, d.broadcast_id, d.event,
    d.attempted_at, d.status, d.response_code, d.error_text, d.signed
  FROM public.webhook_dispatch_log d
  JOIN public.tenant_webhooks w ON w.id = d.webhook_id
  WHERE d.tenant_id = public.current_tenant_id()
  ORDER BY d.attempted_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
$$;

GRANT EXECUTE ON FUNCTION public.list_webhook_dispatches(int) TO authenticated;
