-- =============================================================================
-- 027_broadcast_template_variables
-- =============================================================================
-- Suporte a variáveis interpoladas em broadcasts:
--
--   GLOBAIS (resolvidas no RPC, persistidas na notification):
--     {{tenant_name}}       — nome do tenant
--     {{sender_name}}       — nome do admin que disparou
--     {{sender_first}}      — primeiro nome do sender
--     {{contract_numero}}   — número do contrato (se filter_contract_id)
--     {{contract_objeto}}   — objeto do contrato
--     {{today}}             — data atual DD/MM/YYYY (America/Sao_Paulo)
--     {{today_long}}        — "Segunda-feira, 15 de janeiro de 2026"
--
--   PER-USER (resolvidas na EF de e-mail, não in-app):
--     {{user_name}}, {{user_first}}, {{user_email}}
-- =============================================================================

-- =============================================================================
-- Helper: interpola variáveis globais num texto
-- =============================================================================
CREATE OR REPLACE FUNCTION public.interpolate_broadcast_text(
  p_text        text,
  p_tenant_id   uuid,
  p_sender_id   uuid,
  p_contract_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_text text := p_text;
  v_tenant_name      text;
  v_sender_name      text;
  v_sender_first     text;
  v_contract_numero  text;
  v_contract_objeto  text;
  v_today            text;
  v_today_long       text;
BEGIN
  IF v_text IS NULL OR position('{{' in v_text) = 0 THEN
    RETURN v_text;
  END IF;

  SELECT nome INTO v_tenant_name FROM public.tenants WHERE id = p_tenant_id;
  SELECT nome INTO v_sender_name FROM public.members WHERE id = p_sender_id;
  v_sender_first := split_part(coalesce(v_sender_name, ''), ' ', 1);

  IF p_contract_id IS NOT NULL THEN
    SELECT numero, objeto INTO v_contract_numero, v_contract_objeto
      FROM public.contracts WHERE id = p_contract_id;
  END IF;

  -- Datas em America/Sao_Paulo
  v_today      := to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'DD/MM/YYYY');
  v_today_long := to_char((now() AT TIME ZONE 'America/Sao_Paulo')::timestamp,
                          'TMDay", "DD" de "TMMonth" de "YYYY');

  v_text := replace(v_text, '{{tenant_name}}',     coalesce(v_tenant_name, ''));
  v_text := replace(v_text, '{{sender_name}}',     coalesce(v_sender_name, ''));
  v_text := replace(v_text, '{{sender_first}}',    coalesce(v_sender_first, ''));
  v_text := replace(v_text, '{{contract_numero}}', coalesce(v_contract_numero, ''));
  v_text := replace(v_text, '{{contract_objeto}}', coalesce(v_contract_objeto, ''));
  v_text := replace(v_text, '{{today}}',           v_today);
  v_text := replace(v_text, '{{today_long}}',      v_today_long);

  RETURN v_text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.interpolate_broadcast_text(text, uuid, uuid, uuid) TO authenticated, service_role;

-- =============================================================================
-- Reescrever bulk_send_notification com interpolação
-- =============================================================================
DROP FUNCTION IF EXISTS public.bulk_send_notification(text, text, text, text, text[], uuid[], uuid);

CREATE OR REPLACE FUNCTION public.bulk_send_notification(
  p_title         text,
  p_body          text,
  p_kind          text DEFAULT 'info',
  p_action_url    text DEFAULT NULL,
  p_filter_roles  text[] DEFAULT NULL,
  p_filter_member_ids uuid[] DEFAULT NULL,
  p_filter_contract_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant       uuid;
  v_sender       uuid;
  v_is_admin     boolean;
  v_broadcast_id uuid;
  v_total        int := 0;
  -- versões interpoladas
  v_title_rendered      text;
  v_body_rendered       text;
  v_action_url_rendered text;
BEGIN
  v_tenant := public.current_tenant_id();
  v_sender := public.current_member_id();
  IF v_tenant IS NULL OR v_sender IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT (role = 'admin' OR 'admin' = ANY(roles)) INTO v_is_admin
    FROM public.members WHERE id = v_sender;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Apenas administradores podem disparar broadcasts';
  END IF;

  IF length(trim(p_title)) < 3 THEN
    RAISE EXCEPTION 'Título deve ter pelo menos 3 caracteres';
  END IF;
  IF length(trim(p_body)) < 5 THEN
    RAISE EXCEPTION 'Mensagem deve ter pelo menos 5 caracteres';
  END IF;

  IF p_filter_contract_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = p_filter_contract_id AND c.tenant_id = v_tenant AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Contrato inválido ou não pertence ao tenant';
  END IF;

  -- Interpola variáveis globais (tenant, sender, contract, today) ANTES
  -- do insert. Variáveis per-user ({{user_name}}) ficam intactas para
  -- a EF de e-mail processar.
  v_title_rendered      := public.interpolate_broadcast_text(p_title, v_tenant, v_sender, p_filter_contract_id);
  v_body_rendered       := public.interpolate_broadcast_text(p_body,  v_tenant, v_sender, p_filter_contract_id);
  v_action_url_rendered := public.interpolate_broadcast_text(p_action_url, v_tenant, v_sender, p_filter_contract_id);

  INSERT INTO public.notification_broadcasts (
    tenant_id, sender_id, title, body, kind, action_url,
    filter_roles, filter_member_ids, filter_contract_id, total_sent, total_failed,
    metadata
  )
  VALUES (
    v_tenant, v_sender, v_title_rendered, v_body_rendered, p_kind, v_action_url_rendered,
    p_filter_roles, p_filter_member_ids, p_filter_contract_id, 0, 0,
    jsonb_build_object(
      'raw_title', p_title,
      'raw_body',  p_body,
      'raw_action_url', p_action_url
    )
  )
  RETURNING id INTO v_broadcast_id;

  WITH eligible AS (
    SELECT DISTINCT m.id AS member_id
    FROM public.members m
    LEFT JOIN public.contract_members cm ON cm.member_id = m.id AND cm.active = true
    WHERE m.tenant_id = v_tenant
      AND m.deleted_at IS NULL
      AND m.active = true
      AND m.id <> v_sender
      AND (p_filter_roles IS NULL OR p_filter_roles = '{}' OR m.role = ANY(p_filter_roles))
      AND (p_filter_member_ids IS NULL OR p_filter_member_ids = '{}' OR m.id = ANY(p_filter_member_ids))
      AND (p_filter_contract_id IS NULL OR cm.contract_id = p_filter_contract_id)
  ),
  inserted AS (
    INSERT INTO public.notifications (
      tenant_id, recipient_id, kind, title, body, action_url, metadata
    )
    SELECT
      v_tenant, e.member_id, p_kind, v_title_rendered, v_body_rendered, v_action_url_rendered,
      jsonb_build_object(
        'broadcast_id', v_broadcast_id,
        'sender_id',    v_sender,
        'broadcast',    true,
        'contract_id',  p_filter_contract_id
      )
    FROM eligible e
    RETURNING id
  )
  SELECT count(*) INTO v_total FROM inserted;

  UPDATE public.notification_broadcasts
     SET total_sent = v_total
   WHERE id = v_broadcast_id;

  INSERT INTO public.audit_log (tenant_id, member_id, entity_type, entity_id, action, after_value, metadata)
  VALUES (v_tenant, v_sender, 'notification_broadcast', v_broadcast_id, 'broadcast_sent',
          jsonb_build_object('title', v_title_rendered, 'total_sent', v_total),
          jsonb_build_object('filter_roles', p_filter_roles,
                             'filter_member_ids', p_filter_member_ids,
                             'filter_contract_id', p_filter_contract_id,
                             'kind', p_kind,
                             'has_variables', position('{{' in p_title || ' ' || p_body) > 0));

  RETURN jsonb_build_object(
    'broadcast_id', v_broadcast_id,
    'total_sent', v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_send_notification(text, text, text, text, text[], uuid[], uuid) TO authenticated;
