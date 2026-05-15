-- =============================================================================
-- 025_broadcast_filter_by_contract
-- =============================================================================
-- Adiciona filter_contract_id em notification_broadcasts. Permite envios
-- direcionados a membros de um contrato específico (via contract_members)
-- combinados opcionalmente com filter_roles dentro do mesmo contrato.

ALTER TABLE public.notification_broadcasts
  ADD COLUMN IF NOT EXISTS filter_contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL;

-- =============================================================================
-- Update RPC: preview_broadcast_recipients
-- =============================================================================
DROP FUNCTION IF EXISTS public.preview_broadcast_recipients(text[], uuid[]);

CREATE OR REPLACE FUNCTION public.preview_broadcast_recipients(
  p_filter_roles      text[] DEFAULT NULL,
  p_filter_member_ids uuid[] DEFAULT NULL,
  p_filter_contract_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_total int := 0;
  v_with_email int := 0;
  v_role_breakdown jsonb;
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  WITH eligible AS (
    SELECT DISTINCT m.id, m.email, m.role
    FROM public.members m
    LEFT JOIN public.contract_members cm ON cm.member_id = m.id AND cm.active = true
    WHERE m.tenant_id = v_tenant
      AND m.deleted_at IS NULL
      AND m.active = true
      AND (p_filter_roles IS NULL OR p_filter_roles = '{}' OR m.role = ANY(p_filter_roles))
      AND (p_filter_member_ids IS NULL OR p_filter_member_ids = '{}' OR m.id = ANY(p_filter_member_ids))
      AND (p_filter_contract_id IS NULL OR cm.contract_id = p_filter_contract_id)
  )
  SELECT count(*), count(*) FILTER (WHERE email IS NOT NULL AND email <> ''),
         jsonb_object_agg(role, role_count)
    INTO v_total, v_with_email, v_role_breakdown
    FROM (
      SELECT id, email, role,
             count(*) OVER (PARTITION BY role) AS role_count
      FROM eligible
    ) e;

  RETURN jsonb_build_object(
    'total', COALESCE(v_total, 0),
    'with_email', COALESCE(v_with_email, 0),
    'by_role', COALESCE(v_role_breakdown, '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_broadcast_recipients(text[], uuid[], uuid) TO authenticated;

-- =============================================================================
-- Update RPC: bulk_send_notification
-- =============================================================================
DROP FUNCTION IF EXISTS public.bulk_send_notification(text, text, text, text, text[], uuid[]);

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
  v_tenant   uuid;
  v_sender   uuid;
  v_is_admin boolean;
  v_broadcast_id uuid;
  v_total    int := 0;
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

  -- Valida contrato (se informado)
  IF p_filter_contract_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = p_filter_contract_id AND c.tenant_id = v_tenant AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Contrato inválido ou não pertence ao tenant';
  END IF;

  -- Registro do broadcast
  INSERT INTO public.notification_broadcasts (
    tenant_id, sender_id, title, body, kind, action_url,
    filter_roles, filter_member_ids, filter_contract_id, total_sent, total_failed
  )
  VALUES (
    v_tenant, v_sender, p_title, p_body, p_kind, p_action_url,
    p_filter_roles, p_filter_member_ids, p_filter_contract_id, 0, 0
  )
  RETURNING id INTO v_broadcast_id;

  -- Notifications via batch insert
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
      v_tenant, e.member_id, p_kind, p_title, p_body, p_action_url,
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
          jsonb_build_object('title', p_title, 'total_sent', v_total),
          jsonb_build_object('filter_roles', p_filter_roles,
                             'filter_member_ids', p_filter_member_ids,
                             'filter_contract_id', p_filter_contract_id,
                             'kind', p_kind));

  RETURN jsonb_build_object(
    'broadcast_id', v_broadcast_id,
    'total_sent', v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_send_notification(text, text, text, text, text[], uuid[], uuid) TO authenticated;

-- =============================================================================
-- Update view com contract_numero quando filter_contract_id setado
-- =============================================================================
CREATE OR REPLACE VIEW public.v_notification_broadcasts_history WITH (security_invoker = true) AS
SELECT
  b.id,
  b.tenant_id,
  b.sender_id,
  s.nome   AS sender_nome,
  s.email  AS sender_email,
  b.title,
  b.body,
  b.kind,
  b.action_url,
  b.filter_roles,
  b.filter_member_ids,
  b.filter_contract_id,
  c.numero AS contract_numero,
  c.objeto AS contract_objeto,
  CASE
    WHEN b.filter_contract_id IS NOT NULL THEN 'contract'
    WHEN b.filter_roles IS NOT NULL AND array_length(b.filter_roles, 1) > 0 THEN 'role'
    WHEN b.filter_member_ids IS NOT NULL AND array_length(b.filter_member_ids, 1) > 0 THEN 'specific'
    ELSE 'all'
  END AS scope,
  b.total_sent,
  b.total_failed,
  b.email_also,
  b.created_at
FROM public.notification_broadcasts b
LEFT JOIN public.members s ON s.id = b.sender_id
LEFT JOIN public.contracts c ON c.id = b.filter_contract_id
ORDER BY b.created_at DESC;

GRANT SELECT ON public.v_notification_broadcasts_history TO authenticated;
