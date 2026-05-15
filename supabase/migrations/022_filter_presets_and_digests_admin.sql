-- =============================================================================
-- 022_filter_presets_and_digests_admin
-- =============================================================================
-- (1) Tabela user_filter_presets — usuário salva combinações de filtros
-- (2) View v_digests_history — histórico do digest diário com agregações

-- =============================================================================
-- (1) user_filter_presets — presets de filtros nomeados, por usuário e página
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_filter_presets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  page_key    text NOT NULL CHECK (page_key IN ('pendencias', 'audit_log', 'contracts', 'measurements')),
  nome        text NOT NULL,
  filters     jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  UNIQUE (member_id, page_key, nome)
);

CREATE INDEX IF NOT EXISTS idx_user_filter_presets_member_page
  ON public.user_filter_presets (member_id, page_key) WHERE deleted_at IS NULL;

ALTER TABLE public.user_filter_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_filter_presets_select ON public.user_filter_presets;
CREATE POLICY user_filter_presets_select ON public.user_filter_presets
  FOR SELECT USING (member_id = public.current_member_id() AND deleted_at IS NULL);

DROP POLICY IF EXISTS user_filter_presets_write ON public.user_filter_presets;
CREATE POLICY user_filter_presets_write ON public.user_filter_presets
  FOR ALL USING (member_id = public.current_member_id())
  WITH CHECK (member_id = public.current_member_id() AND tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_filter_presets TO authenticated;

-- =============================================================================
-- RPC: save_filter_preset — cria ou atualiza preset pelo nome
-- =============================================================================
CREATE OR REPLACE FUNCTION public.save_filter_preset(
  p_page_key text,
  p_nome text,
  p_filters jsonb,
  p_is_default boolean DEFAULT false
)
RETURNS public.user_filter_presets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member uuid;
  v_tenant uuid;
  out_row public.user_filter_presets;
BEGIN
  v_member := public.current_member_id();
  v_tenant := public.current_tenant_id();
  IF v_member IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF p_page_key NOT IN ('pendencias', 'audit_log', 'contracts', 'measurements') THEN
    RAISE EXCEPTION 'page_key inválida: %', p_page_key;
  END IF;
  IF length(trim(p_nome)) = 0 THEN
    RAISE EXCEPTION 'Nome do preset não pode ser vazio';
  END IF;

  -- Se for default, desmarca os demais defaults da mesma página
  IF p_is_default THEN
    UPDATE public.user_filter_presets
       SET is_default = false, updated_at = now()
     WHERE member_id = v_member
       AND page_key = p_page_key
       AND is_default = true
       AND deleted_at IS NULL;
  END IF;

  INSERT INTO public.user_filter_presets (tenant_id, member_id, page_key, nome, filters, is_default)
  VALUES (v_tenant, v_member, p_page_key, p_nome, p_filters, p_is_default)
  ON CONFLICT (member_id, page_key, nome) DO UPDATE
    SET filters = excluded.filters,
        is_default = excluded.is_default,
        updated_at = now(),
        deleted_at = NULL
  RETURNING * INTO out_row;

  RETURN out_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_filter_preset(text, text, jsonb, boolean) TO authenticated;

-- =============================================================================
-- RPC: delete_filter_preset — soft delete por id
-- =============================================================================
CREATE OR REPLACE FUNCTION public.delete_filter_preset(p_id uuid)
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

  UPDATE public.user_filter_presets
     SET deleted_at = now()
   WHERE id = p_id AND member_id = v_member;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_filter_preset(uuid) TO authenticated;

-- =============================================================================
-- (2) v_digests_history — histórico de envios para admin
-- =============================================================================
CREATE OR REPLACE VIEW public.v_digests_history WITH (security_invoker = true) AS
SELECT
  d.id,
  d.tenant_id,
  d.member_id,
  m.nome  AS member_nome,
  m.email AS member_email,
  d.sent_date,
  d.sent_at,
  d.email_status,
  d.metadata,
  COALESCE((d.metadata->>'aprovacoes')::int, 0)        AS aprovacoes,
  COALESCE((d.metadata->>'grds')::int, 0)              AS grds,
  COALESCE((d.metadata->>'pendencias_high')::int, 0)   AS pendencias_high,
  COALESCE((d.metadata->>'criticos')::int, 0)          AS criticos
FROM public.digest_sends d
LEFT JOIN public.members m ON m.id = d.member_id
ORDER BY d.sent_at DESC;

GRANT SELECT ON public.v_digests_history TO authenticated;

-- =============================================================================
-- View de estatísticas agregadas por dia
-- =============================================================================
CREATE OR REPLACE VIEW public.v_digests_daily_stats WITH (security_invoker = true) AS
SELECT
  tenant_id,
  sent_date,
  count(*)                                            AS total,
  count(*) FILTER (WHERE email_status = 'sent')       AS enviados,
  count(*) FILTER (WHERE email_status = 'skipped')    AS pulados,
  count(*) FILTER (WHERE email_status = 'failed')     AS falharam
FROM public.digest_sends
GROUP BY tenant_id, sent_date
ORDER BY sent_date DESC;

GRANT SELECT ON public.v_digests_daily_stats TO authenticated;
