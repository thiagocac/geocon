-- =============================================================================
-- 028_role_aliases
-- =============================================================================
-- Admin nomeia conjuntos recorrentes de papéis ("Equipe de medição",
-- "Lideranças operacionais", etc) e usa-os no compositor de broadcast no
-- lugar de marcar role-por-role.
--
-- Aliases são per-tenant. Slug auto-gerado a partir do nome para uso em
-- query-strings de hot-link (?aliases=equipe-medicao).
--
-- (1) Tabela role_aliases
-- (2) Triggers: slug + updated_at
-- (3) RPCs: list_role_aliases, upsert_role_alias, delete_role_alias
-- (4) View v_role_aliases_with_counts (com count de membros alcançáveis)
-- (5) RLS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.role_aliases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  slug            text NOT NULL CHECK (length(slug) BETWEEN 2 AND 80),
  roles           text[] NOT NULL CHECK (cardinality(roles) BETWEEN 1 AND 12),
  description     text,
  created_by      uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_role_aliases_tenant ON public.role_aliases(tenant_id);

-- =============================================================================
-- Slug helper (lowercase ASCII, hyphens, sem acentos)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.slugify_pt(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean text;
BEGIN
  IF p_text IS NULL THEN RETURN ''; END IF;
  v_clean := lower(p_text);
  -- Translit comum português
  v_clean := translate(v_clean,
    'áàâãäéèêëíìîïóòôõöúùûüçñ',
    'aaaaaeeeeiiiiooooouuuucn');
  -- Substitui não-alfanumérico por hyphen
  v_clean := regexp_replace(v_clean, '[^a-z0-9]+', '-', 'g');
  -- Remove hyphens das pontas
  v_clean := trim(both '-' from v_clean);
  -- Compacta múltiplos hyphens
  v_clean := regexp_replace(v_clean, '-+', '-', 'g');
  RETURN v_clean;
END;
$$;

-- =============================================================================
-- Trigger: slug auto + updated_at
-- =============================================================================
CREATE OR REPLACE FUNCTION public.role_aliases_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_base text;
  v_candidate text;
  v_n int := 0;
BEGIN
  IF NEW.slug IS NULL OR length(trim(NEW.slug)) = 0 THEN
    v_base := public.slugify_pt(NEW.name);
    IF length(v_base) < 2 THEN v_base := 'alias'; END IF;
    v_candidate := v_base;
    -- Resolve colisão dentro do tenant
    WHILE EXISTS (
      SELECT 1 FROM public.role_aliases
      WHERE tenant_id = NEW.tenant_id
        AND slug = v_candidate
        AND id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) LOOP
      v_n := v_n + 1;
      v_candidate := v_base || '-' || v_n;
    END LOOP;
    NEW.slug := v_candidate;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_role_aliases_before_write ON public.role_aliases;
CREATE TRIGGER trg_role_aliases_before_write
BEFORE INSERT OR UPDATE ON public.role_aliases
FOR EACH ROW EXECUTE FUNCTION public.role_aliases_before_write();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE public.role_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_aliases_read ON public.role_aliases;
CREATE POLICY role_aliases_read ON public.role_aliases
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- Apenas admins escrevem (criação/edição/delete)
DROP POLICY IF EXISTS role_aliases_write ON public.role_aliases;
CREATE POLICY role_aliases_write ON public.role_aliases
  FOR ALL TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND m.tenant_id = public.current_tenant_id()
        AND (m.role = 'admin' OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND m.tenant_id = public.current_tenant_id()
        AND (m.role = 'admin' OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  );

-- =============================================================================
-- View com count de membros alcançáveis (live)
-- =============================================================================
CREATE OR REPLACE VIEW public.v_role_aliases_with_counts AS
SELECT
  ra.id,
  ra.tenant_id,
  ra.name,
  ra.slug,
  ra.roles,
  ra.description,
  ra.created_by,
  ra.created_at,
  ra.updated_at,
  m_creator.nome AS created_by_nome,
  (
    SELECT count(DISTINCT m.id)
    FROM public.members m
    WHERE m.tenant_id = ra.tenant_id
      AND m.deleted_at IS NULL
      AND m.active = true
      AND m.role = ANY(ra.roles)
  ) AS member_count
FROM public.role_aliases ra
LEFT JOIN public.members m_creator ON m_creator.id = ra.created_by;

GRANT SELECT ON public.v_role_aliases_with_counts TO authenticated;

-- =============================================================================
-- RPC: list
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_role_aliases()
RETURNS SETOF public.v_role_aliases_with_counts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.v_role_aliases_with_counts
  WHERE tenant_id = public.current_tenant_id()
  ORDER BY name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.list_role_aliases() TO authenticated;

-- =============================================================================
-- RPC: upsert (cria ou atualiza)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_role_alias(
  p_id          uuid,
  p_name        text,
  p_roles       text[],
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   uuid;
  v_member   uuid;
  v_is_admin boolean;
  v_id       uuid;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();
  IF v_tenant IS NULL OR v_member IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))) INTO v_is_admin
    FROM public.members WHERE id = v_member;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Apenas administradores podem gerenciar aliases';
  END IF;

  IF length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Nome deve ter pelo menos 2 caracteres';
  END IF;
  IF cardinality(p_roles) = 0 THEN
    RAISE EXCEPTION 'Selecione pelo menos um papel';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.role_aliases (tenant_id, name, slug, roles, description, created_by)
    VALUES (v_tenant, trim(p_name), '', p_roles, nullif(trim(p_description), ''), v_member)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.role_aliases
       SET name = trim(p_name),
           roles = p_roles,
           description = nullif(trim(p_description), '')
     WHERE id = p_id AND tenant_id = v_tenant
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Alias não encontrado';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_role_alias(uuid, text, text[], text) TO authenticated;

-- =============================================================================
-- RPC: delete
-- =============================================================================
CREATE OR REPLACE FUNCTION public.delete_role_alias(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   uuid;
  v_is_admin boolean;
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))) INTO v_is_admin
    FROM public.members WHERE id = public.current_member_id();
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Apenas administradores podem excluir aliases';
  END IF;

  DELETE FROM public.role_aliases WHERE id = p_id AND tenant_id = v_tenant;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_role_alias(uuid) TO authenticated;
