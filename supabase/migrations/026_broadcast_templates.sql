-- =============================================================================
-- 026_broadcast_templates
-- =============================================================================
-- Templates reutilizáveis de broadcast — admin salva uma mensagem recorrente
-- (aviso de manutenção, lembrete de medição, treinamento, etc) com filtros
-- pré-configurados e carrega rapidamente no compositor.
--
-- Templates podem ser:
--   - privados (só o owner vê)
--   - compartilhados (visíveis para todos admins do mesmo tenant)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.notification_broadcast_templates (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_id                   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  nome                       text NOT NULL,
  title                      text NOT NULL,
  body                       text NOT NULL,
  kind                       text NOT NULL DEFAULT 'info' CHECK (kind IN ('info', 'warning', 'system')),
  action_url                 text,
  default_filter_roles       text[],
  default_filter_contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  default_filter_member_ids  uuid[],
  default_email_also         boolean NOT NULL DEFAULT false,
  is_shared                  boolean NOT NULL DEFAULT false,
  uses_count                 int NOT NULL DEFAULT 0,
  last_used_at               timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  deleted_at                 timestamptz,
  CONSTRAINT broadcast_templates_nome_min CHECK (length(trim(nome)) >= 2),
  CONSTRAINT broadcast_templates_title_min CHECK (length(trim(title)) >= 3),
  CONSTRAINT broadcast_templates_body_min CHECK (length(trim(body)) >= 5)
);

-- Unique: owner não pode ter 2 templates com mesmo nome
CREATE UNIQUE INDEX IF NOT EXISTS uq_broadcast_templates_owner_nome
  ON public.notification_broadcast_templates (owner_id, lower(trim(nome)))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_broadcast_templates_tenant_shared
  ON public.notification_broadcast_templates (tenant_id, is_shared, last_used_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

ALTER TABLE public.notification_broadcast_templates ENABLE ROW LEVEL SECURITY;

-- Owner sempre vê os próprios; admins do tenant veem os shared
DROP POLICY IF EXISTS broadcast_templates_select ON public.notification_broadcast_templates;
CREATE POLICY broadcast_templates_select ON public.notification_broadcast_templates
  FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    AND deleted_at IS NULL
    AND (
      owner_id = public.current_member_id()
      OR (is_shared = true AND EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.id = public.current_member_id()
          AND (m.role = 'admin' OR 'admin' = ANY(m.roles))
      ))
    )
  );

-- Mutações via RPC (SECURITY DEFINER) abaixo, não direta
GRANT SELECT ON public.notification_broadcast_templates TO authenticated;

-- =============================================================================
-- RPC: upsert_broadcast_template
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_broadcast_template(
  p_id                         uuid,
  p_nome                       text,
  p_title                      text,
  p_body                       text,
  p_kind                       text DEFAULT 'info',
  p_action_url                 text DEFAULT NULL,
  p_default_filter_roles       text[] DEFAULT NULL,
  p_default_filter_contract_id uuid DEFAULT NULL,
  p_default_filter_member_ids  uuid[] DEFAULT NULL,
  p_default_email_also         boolean DEFAULT false,
  p_is_shared                  boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
  v_is_admin boolean;
  v_id uuid;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();
  IF v_tenant IS NULL OR v_member IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT (role = 'admin' OR 'admin' = ANY(roles)) INTO v_is_admin
    FROM public.members WHERE id = v_member;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Apenas administradores podem gerenciar templates de broadcast';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.notification_broadcast_templates (
      tenant_id, owner_id, nome, title, body, kind, action_url,
      default_filter_roles, default_filter_contract_id, default_filter_member_ids,
      default_email_also, is_shared
    )
    VALUES (
      v_tenant, v_member, p_nome, p_title, p_body, p_kind, p_action_url,
      p_default_filter_roles, p_default_filter_contract_id, p_default_filter_member_ids,
      p_default_email_also, p_is_shared
    )
    RETURNING id INTO v_id;
  ELSE
    -- só owner pode editar
    UPDATE public.notification_broadcast_templates
       SET nome = p_nome, title = p_title, body = p_body, kind = p_kind,
           action_url = p_action_url,
           default_filter_roles = p_default_filter_roles,
           default_filter_contract_id = p_default_filter_contract_id,
           default_filter_member_ids = p_default_filter_member_ids,
           default_email_also = p_default_email_also,
           is_shared = p_is_shared,
           updated_at = now()
     WHERE id = p_id AND owner_id = v_member AND tenant_id = v_tenant
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Template não encontrado ou não pertence a você';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_broadcast_template(uuid, text, text, text, text, text, text[], uuid, uuid[], boolean, boolean) TO authenticated;

-- =============================================================================
-- RPC: delete_broadcast_template (soft)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.delete_broadcast_template(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member uuid;
BEGIN
  v_member := public.current_member_id();
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  UPDATE public.notification_broadcast_templates
     SET deleted_at = now(), updated_at = now()
   WHERE id = p_id AND owner_id = v_member AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_broadcast_template(uuid) TO authenticated;

-- =============================================================================
-- RPC: record_broadcast_template_use — chamada quando admin envia broadcast
-- carregado de um template
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_broadcast_template_use(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notification_broadcast_templates
     SET uses_count = uses_count + 1,
         last_used_at = now()
   WHERE id = p_id
     AND tenant_id = public.current_tenant_id()
     AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_broadcast_template_use(uuid) TO authenticated;

-- =============================================================================
-- View: v_broadcast_templates_list — own + shared, ordenada por last_used
-- =============================================================================
CREATE OR REPLACE VIEW public.v_broadcast_templates_list WITH (security_invoker = true) AS
SELECT
  t.id,
  t.tenant_id,
  t.owner_id,
  o.nome  AS owner_nome,
  o.email AS owner_email,
  (t.owner_id = public.current_member_id()) AS is_owner,
  t.nome,
  t.title,
  t.body,
  t.kind,
  t.action_url,
  t.default_filter_roles,
  t.default_filter_contract_id,
  c.numero AS default_contract_numero,
  t.default_filter_member_ids,
  t.default_email_also,
  t.is_shared,
  t.uses_count,
  t.last_used_at,
  t.created_at,
  t.updated_at
FROM public.notification_broadcast_templates t
LEFT JOIN public.members o ON o.id = t.owner_id
LEFT JOIN public.contracts c ON c.id = t.default_filter_contract_id
WHERE t.deleted_at IS NULL
ORDER BY t.last_used_at DESC NULLS LAST, t.created_at DESC;

GRANT SELECT ON public.v_broadcast_templates_list TO authenticated;
