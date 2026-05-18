-- =============================================================================
-- 053_api_keys
-- =============================================================================
-- Superfície de entrada externa: tokens de API para integração com sistemas
-- terceiros (licitação, ERPs, controles externos).
--
-- Formato da chave: gck_live_<8-hex-prefix>_<32-hex-secret>
--   - gck   = GeoCon
--   - live  = ambiente (pode ter 'test' no futuro)
--   - 8-hex prefix: indexado, identifica a chave sem precisar do secret
--   - 32-hex secret: hash com bcrypt (cost 10)
--
-- A chave completa é mostrada APENAS UMA VEZ no momento da criação. Depois,
-- só o prefix é visível. Verificação usa pgcrypto `crypt()` em constant-time.
--
-- Escopos (text[]) controlam o que cada chave pode fazer:
--   suppliers:check  — POST /public-api/suppliers/check
--   suppliers:read   — GET  /public-api/suppliers/sanctioned
--
-- Endpoints adicionais podem ser introduzidos com novos escopos em V47+.
-- =============================================================================

-- =============================================================================
-- Tabela api_keys
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  key_prefix      text NOT NULL UNIQUE,
  key_hash        text NOT NULL,
  scopes          text[] NOT NULL DEFAULT '{}'::text[],
  created_by      uuid REFERENCES public.members(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid REFERENCES public.members(id),
  metadata        jsonb DEFAULT '{}'::jsonb,
  CHECK (length(name) BETWEEN 1 AND 200),
  CHECK (length(key_prefix) = 8),
  CHECK (array_length(scopes, 1) IS NULL OR array_length(scopes, 1) <= 20)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON public.api_keys (tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON public.api_keys (key_prefix)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.api_keys IS
  'V46 — Tokens de API para integração externa. Formato gck_live_<prefix>_<secret>. '
  'Hash bcrypt (cost 10). Prefix indexado para lookup; secret nunca armazenado em claro.';

-- =============================================================================
-- RLS — apenas admin do tenant gerencia
-- =============================================================================
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_keys_select ON public.api_keys;
CREATE POLICY api_keys_select ON public.api_keys
  FOR SELECT TO authenticated USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin' OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  );

-- Insert/update/delete só via RPC (não direto)
DROP POLICY IF EXISTS api_keys_no_direct_write ON public.api_keys;
CREATE POLICY api_keys_no_direct_write ON public.api_keys
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- =============================================================================
-- RPC: create_api_key
-- Gera prefix + secret server-side. Retorna a chave COMPLETA uma única vez.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_api_key(
  p_name       text,
  p_scopes     text[],
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   uuid;
  v_member   uuid;
  v_admin    boolean;
  v_id       uuid;
  v_prefix   text;
  v_secret   text;
  v_full     text;
  v_hash     text;
  v_valid_scopes text[] := ARRAY['suppliers:check', 'suppliers:read'];
  v_s        text;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();

  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_admin FROM public.members WHERE id = v_member;
  IF NOT v_admin THEN
    RAISE EXCEPTION 'Apenas admin pode criar chaves de API';
  END IF;

  IF length(trim(coalesce(p_name, ''))) < 1 OR length(p_name) > 200 THEN
    RAISE EXCEPTION 'Nome obrigatório (1-200 caracteres)';
  END IF;
  IF p_scopes IS NULL OR array_length(p_scopes, 1) IS NULL THEN
    RAISE EXCEPTION 'Pelo menos um escopo deve ser informado';
  END IF;

  -- Valida cada escopo
  FOREACH v_s IN ARRAY p_scopes LOOP
    IF NOT (v_s = ANY(v_valid_scopes)) THEN
      RAISE EXCEPTION 'Escopo inválido: %. Válidos: %', v_s,
        array_to_string(v_valid_scopes, ', ');
    END IF;
  END LOOP;

  -- Gera prefix (8 hex) e secret (32 hex)
  v_prefix := encode(gen_random_bytes(4), 'hex');
  v_secret := encode(gen_random_bytes(16), 'hex');
  v_full   := 'gck_live_' || v_prefix || '_' || v_secret;
  v_hash   := crypt(v_secret, gen_salt('bf', 10));

  INSERT INTO public.api_keys (
    tenant_id, name, key_prefix, key_hash, scopes,
    created_by, expires_at
  )
  VALUES (
    v_tenant, trim(p_name), v_prefix, v_hash, p_scopes,
    v_member, p_expires_at
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id',         v_id,
    'name',       trim(p_name),
    'key_prefix', v_prefix,
    'scopes',     p_scopes,
    'expires_at', p_expires_at,
    'full_key',   v_full,      -- ÚNICA VEZ — não fica no banco
    'created_at', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_api_key(text, text[], timestamptz) TO authenticated;

-- =============================================================================
-- RPC: list_api_keys (admin only)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_api_keys()
RETURNS TABLE (
  id           uuid,
  name         text,
  key_prefix   text,
  scopes       text[],
  created_by   uuid,
  created_by_nome text,
  created_at   timestamptz,
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  revoked_by_nome text,
  status       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    k.id, k.name, k.key_prefix, k.scopes,
    k.created_by, mc.nome AS created_by_nome,
    k.created_at, k.last_used_at, k.expires_at,
    k.revoked_at, mr.nome AS revoked_by_nome,
    CASE
      WHEN k.revoked_at IS NOT NULL                THEN 'revogada'
      WHEN k.expires_at IS NOT NULL
       AND k.expires_at < now()                    THEN 'expirada'
      ELSE                                              'ativa'
    END AS status
  FROM public.api_keys k
  LEFT JOIN public.members mc ON mc.id = k.created_by
  LEFT JOIN public.members mr ON mr.id = k.revoked_by
  WHERE k.tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin' OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  ORDER BY
    -- Ativas primeiro
    CASE WHEN k.revoked_at IS NULL
              AND (k.expires_at IS NULL OR k.expires_at > now())
         THEN 0 ELSE 1 END,
    k.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_api_keys() TO authenticated;

-- =============================================================================
-- RPC: revoke_api_key
-- =============================================================================
CREATE OR REPLACE FUNCTION public.revoke_api_key(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
  v_admin  boolean;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();

  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_admin FROM public.members WHERE id = v_member;
  IF NOT v_admin THEN
    RAISE EXCEPTION 'Apenas admin pode revogar chaves de API';
  END IF;

  UPDATE public.api_keys
     SET revoked_at = now(),
         revoked_by = v_member
   WHERE id = p_id
     AND tenant_id = v_tenant
     AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chave não encontrada ou já revogada';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.revoke_api_key(uuid) TO authenticated;

-- =============================================================================
-- RPC: verify_api_key (chamada pela EF public-api com service_role)
-- Constant-time verification via crypt() do pgcrypto
-- =============================================================================
CREATE OR REPLACE FUNCTION public.verify_api_key(
  p_prefix text,
  p_secret text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  IF p_prefix IS NULL OR length(p_prefix) <> 8 THEN
    RETURN NULL;
  END IF;
  IF p_secret IS NULL OR length(p_secret) <> 32 THEN
    RETURN NULL;
  END IF;

  SELECT id, tenant_id, name, scopes, key_hash, expires_at, revoked_at
  INTO v_row
  FROM public.api_keys
  WHERE key_prefix = p_prefix;

  -- Não existe
  IF v_row IS NULL THEN
    RETURN NULL;
  END IF;

  -- Revogada
  IF v_row.revoked_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- Expirada
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN
    RETURN NULL;
  END IF;

  -- Verifica hash (constant-time)
  IF v_row.key_hash <> crypt(p_secret, v_row.key_hash) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id',        v_row.id,
    'tenant_id', v_row.tenant_id,
    'name',      v_row.name,
    'scopes',    v_row.scopes
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.verify_api_key(text, text) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_api_key(text, text) TO service_role;

-- =============================================================================
-- RPC: touch_api_key_last_used (chamada pela EF após uso bem-sucedido)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.touch_api_key_last_used(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.api_keys SET last_used_at = now() WHERE id = p_id;
$$;
REVOKE EXECUTE ON FUNCTION public.touch_api_key_last_used(uuid) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_api_key_last_used(uuid) TO service_role;

-- =============================================================================
-- RPCs paralelas com tenant_id explícito (para uso pela EF)
-- =============================================================================

-- check_cnpj_sanctioned_external — variante de check_cnpj_sanctioned (V45)
-- que aceita tenant_id como parâmetro em vez de usar current_tenant_id()
CREATE OR REPLACE FUNCTION public.check_cnpj_sanctioned_external(
  p_tenant_id uuid,
  p_cnpj      text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_v_row record;
BEGIN
  IF p_cnpj IS NULL OR trim(p_cnpj) = '' THEN
    RAISE EXCEPTION 'CNPJ é obrigatório';
  END IF;

  SELECT
    cnpj, nome, status_agregado, severidade_atual,
    impedimento_ativo, inidoneidade_ativa, sancoes_ativas,
    vigencia_fim_ativa, ultima_sancao
  INTO v_v_row
  FROM public.v_sanctioned_suppliers
  WHERE tenant_id = p_tenant_id AND cnpj = trim(p_cnpj);

  IF v_v_row IS NULL THEN
    RETURN jsonb_build_object(
      'cnpj',           trim(p_cnpj),
      'found',          false,
      'pode_contratar', true,
      'severidade',     'nenhuma'
    );
  END IF;

  RETURN jsonb_build_object(
    'cnpj',                 v_v_row.cnpj,
    'nome',                 v_v_row.nome,
    'found',                true,
    'pode_contratar',
      (v_v_row.impedimento_ativo = 0 AND v_v_row.inidoneidade_ativa = 0),
    'severidade',           v_v_row.severidade_atual,
    'status_agregado',      v_v_row.status_agregado,
    'sancoes_ativas',       v_v_row.sancoes_ativas,
    'impedimento_ativo',    v_v_row.impedimento_ativo,
    'inidoneidade_ativa',   v_v_row.inidoneidade_ativa,
    'vigencia_fim_ativa',   v_v_row.vigencia_fim_ativa,
    'ultima_sancao',        v_v_row.ultima_sancao,
    'motivo_bloqueio',
      CASE
        WHEN v_v_row.inidoneidade_ativa > 0 THEN
          format('Declaração de inidoneidade ativa%s',
            CASE WHEN v_v_row.vigencia_fim_ativa IS NOT NULL
                 THEN ' até ' || to_char(v_v_row.vigencia_fim_ativa, 'DD/MM/YYYY')
                 ELSE '' END)
        WHEN v_v_row.impedimento_ativo > 0 THEN
          format('Impedimento de licitar/contratar ativo%s',
            CASE WHEN v_v_row.vigencia_fim_ativa IS NOT NULL
                 THEN ' até ' || to_char(v_v_row.vigencia_fim_ativa, 'DD/MM/YYYY')
                 ELSE '' END)
        ELSE NULL
      END
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_cnpj_sanctioned_external(uuid, text) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.check_cnpj_sanctioned_external(uuid, text) TO service_role;

-- list_sanctioned_suppliers_external — variante de list_sanctioned_suppliers (V45)
CREATE OR REPLACE FUNCTION public.list_sanctioned_suppliers_external(
  p_tenant_id        uuid,
  p_severidade       text[] DEFAULT NULL,
  p_status           text[] DEFAULT NULL,
  p_only_with_active boolean DEFAULT false,
  p_limit            int    DEFAULT 200
)
RETURNS TABLE (
  cnpj                  text,
  nome                  text,
  status_agregado       text,
  severidade_atual      text,
  sancoes_total         int,
  sancoes_ativas        int,
  qt_advertencia        int,
  qt_multa              int,
  qt_impedimento        int,
  qt_inidoneidade       int,
  impedimento_ativo     int,
  inidoneidade_ativa    int,
  multa_pendente        numeric,
  primeira_sancao       date,
  ultima_sancao         date,
  vigencia_fim_ativa    date,
  contratos_distintos   int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.cnpj, v.nome,
    v.status_agregado, v.severidade_atual,
    v.sancoes_total, v.sancoes_ativas,
    v.qt_advertencia, v.qt_multa, v.qt_impedimento, v.qt_inidoneidade,
    v.impedimento_ativo, v.inidoneidade_ativa,
    v.multa_pendente,
    v.primeira_sancao, v.ultima_sancao, v.vigencia_fim_ativa,
    v.contratos_distintos
  FROM public.v_sanctioned_suppliers v
  WHERE v.tenant_id = p_tenant_id
    AND (p_severidade IS NULL OR v.severidade_atual = ANY(p_severidade))
    AND (p_status     IS NULL OR v.status_agregado  = ANY(p_status))
    AND (NOT p_only_with_active OR v.sancoes_ativas > 0)
  ORDER BY
    CASE v.severidade_atual
      WHEN 'critica' THEN 1
      WHEN 'alta'    THEN 2
      WHEN 'media'   THEN 3
      WHEN 'baixa'   THEN 4
      ELSE 5
    END,
    v.ultima_sancao DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(p_limit, 200), 500));
$$;
REVOKE EXECUTE ON FUNCTION public.list_sanctioned_suppliers_external(uuid, text[], text[], boolean, int) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.list_sanctioned_suppliers_external(uuid, text[], text[], boolean, int) TO service_role;
