-- =============================================================================
-- 067_ged_watermark
-- =============================================================================
-- Marca d'água "CÓPIA NÃO CONTROLADA" + audit trail de downloads marcados.
--
-- 2 tabelas:
--   1) ged_watermark_settings (1:1 tenant): configurações default da marca
--      (texto, opacidade, ângulo, tamanho, ICP-Brasil enabled).
--   2) ged_watermark_log: registra cada download com marca d'água. Inclui
--      fingerprint (uuid) que aparece no rodapé do PDF — permite rastrear
--      vazamento até o downloader específico.
--
-- A Edge Function `generate-watermarked-pdf` (V68) lê settings, aplica overlay
-- via pdf-lib, registra em log, e retorna PDF streaming (não persiste).
-- =============================================================================

-- 1) Settings por tenant
CREATE TABLE IF NOT EXISTS public.ged_watermark_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
  texto text NOT NULL DEFAULT 'CÓPIA NÃO CONTROLADA',
  texto_secundario text,                            -- ex: nome empresa, número contrato
  opacidade numeric(3,2) NOT NULL DEFAULT 0.20 CHECK (opacidade BETWEEN 0.05 AND 0.50),
  angulo_graus int NOT NULL DEFAULT 45 CHECK (angulo_graus BETWEEN -90 AND 90),
  tamanho_fonte int NOT NULL DEFAULT 48 CHECK (tamanho_fonte BETWEEN 12 AND 144),
  cor_hex text NOT NULL DEFAULT '#FF0000' CHECK (cor_hex ~ '^#[0-9A-Fa-f]{6}$'),
  incluir_timestamp boolean NOT NULL DEFAULT true,
  incluir_fingerprint boolean NOT NULL DEFAULT true,
  icp_brasil_enabled boolean NOT NULL DEFAULT false,
  icp_brasil_signer_label text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES public.members(id)
);

ALTER TABLE public.ged_watermark_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gws_select ON public.ged_watermark_settings;
CREATE POLICY gws_select ON public.ged_watermark_settings
  FOR SELECT TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

DROP POLICY IF EXISTS gws_modify ON public.ged_watermark_settings;
CREATE POLICY gws_modify ON public.ged_watermark_settings
  FOR ALL TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  ) WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

-- 2) Log de downloads marcados
CREATE TABLE IF NOT EXISTS public.ged_watermark_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  document_id uuid NOT NULL REFERENCES public.ged_documents(id),
  version_id uuid NOT NULL REFERENCES public.ged_document_versions(id),
  downloader_id uuid REFERENCES public.members(id),
  downloader_nome text,           -- snapshot — preservar mesmo se membro for removido
  downloader_email text,
  recipient_label text,           -- "Para: Eng. João Silva (cliente XYZ)"
  fingerprint text NOT NULL,      -- short uuid impresso no rodapé do PDF
  ip_addr inet,
  user_agent text,
  icp_brasil_signed boolean DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gwl_document      ON public.ged_watermark_log (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gwl_downloader    ON public.ged_watermark_log (downloader_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gwl_fingerprint   ON public.ged_watermark_log (fingerprint);
CREATE INDEX IF NOT EXISTS idx_gwl_tenant_period ON public.ged_watermark_log (tenant_id, created_at DESC);

ALTER TABLE public.ged_watermark_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gwl_select ON public.ged_watermark_log;
CREATE POLICY gwl_select ON public.ged_watermark_log
  FOR SELECT TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

-- INSERT só via service_role (Edge Function)
DROP POLICY IF EXISTS gwl_insert_service ON public.ged_watermark_log;
CREATE POLICY gwl_insert_service ON public.ged_watermark_log
  FOR INSERT TO service_role WITH CHECK (true);

-- 3) RPC: get_watermark_settings — retorna config ativa ou defaults
CREATE OR REPLACE FUNCTION public.get_ged_watermark_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_settings jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant
    FROM public.members
   WHERE user_id = auth.uid() AND deleted_at IS NULL
   LIMIT 1;

  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('error', 'sem tenant');
  END IF;

  SELECT to_jsonb(s.*) INTO v_settings
    FROM public.ged_watermark_settings s
   WHERE s.tenant_id = v_tenant;

  IF v_settings IS NULL THEN
    -- Defaults se nunca configurado
    v_settings := jsonb_build_object(
      'tenant_id', v_tenant,
      'texto', 'CÓPIA NÃO CONTROLADA',
      'texto_secundario', null,
      'opacidade', 0.20,
      'angulo_graus', 45,
      'tamanho_fonte', 48,
      'cor_hex', '#FF0000',
      'incluir_timestamp', true,
      'incluir_fingerprint', true,
      'icp_brasil_enabled', false,
      'icp_brasil_signer_label', null
    );
  END IF;

  RETURN v_settings;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ged_watermark_settings() TO authenticated;

-- 4) RPC: upsert_watermark_settings — gestor atualiza config do tenant
CREATE OR REPLACE FUNCTION public.upsert_ged_watermark_settings(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
BEGIN
  SELECT id, tenant_id INTO v_member, v_tenant
    FROM public.members
   WHERE user_id = auth.uid() AND deleted_at IS NULL
   LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sem tenant';
  END IF;

  INSERT INTO public.ged_watermark_settings (
    tenant_id, texto, texto_secundario, opacidade, angulo_graus, tamanho_fonte,
    cor_hex, incluir_timestamp, incluir_fingerprint,
    icp_brasil_enabled, icp_brasil_signer_label,
    updated_at, updated_by
  )
  VALUES (
    v_tenant,
    coalesce(p_settings->>'texto', 'CÓPIA NÃO CONTROLADA'),
    p_settings->>'texto_secundario',
    coalesce((p_settings->>'opacidade')::numeric, 0.20),
    coalesce((p_settings->>'angulo_graus')::int, 45),
    coalesce((p_settings->>'tamanho_fonte')::int, 48),
    coalesce(p_settings->>'cor_hex', '#FF0000'),
    coalesce((p_settings->>'incluir_timestamp')::boolean, true),
    coalesce((p_settings->>'incluir_fingerprint')::boolean, true),
    coalesce((p_settings->>'icp_brasil_enabled')::boolean, false),
    p_settings->>'icp_brasil_signer_label',
    now(), v_member
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    texto = EXCLUDED.texto,
    texto_secundario = EXCLUDED.texto_secundario,
    opacidade = EXCLUDED.opacidade,
    angulo_graus = EXCLUDED.angulo_graus,
    tamanho_fonte = EXCLUDED.tamanho_fonte,
    cor_hex = EXCLUDED.cor_hex,
    incluir_timestamp = EXCLUDED.incluir_timestamp,
    incluir_fingerprint = EXCLUDED.incluir_fingerprint,
    icp_brasil_enabled = EXCLUDED.icp_brasil_enabled,
    icp_brasil_signer_label = EXCLUDED.icp_brasil_signer_label,
    updated_at = now(),
    updated_by = v_member;

  RETURN public.get_ged_watermark_settings();
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_ged_watermark_settings(jsonb) TO authenticated;

-- 5) RPC: list_watermark_log — histórico de downloads marcados de um documento
CREATE OR REPLACE FUNCTION public.list_ged_watermark_log(p_document_id uuid)
RETURNS TABLE (
  id uuid, version_id uuid, version_revision text,
  downloader_nome text, downloader_email text,
  recipient_label text, fingerprint text,
  icp_brasil_signed boolean, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id, l.version_id, v.revision AS version_revision,
    l.downloader_nome, l.downloader_email,
    l.recipient_label, l.fingerprint,
    l.icp_brasil_signed, l.created_at
  FROM public.ged_watermark_log l
  LEFT JOIN public.ged_document_versions v ON v.id = l.version_id
  WHERE l.document_id = p_document_id
  ORDER BY l.created_at DESC
  LIMIT 500;
$$;

GRANT EXECUTE ON FUNCTION public.list_ged_watermark_log(uuid) TO authenticated;

COMMENT ON TABLE public.ged_watermark_log IS
'V68 — Audit trail de downloads de PDF com marca d''água. Cada entrada tem ' ||
'fingerprint único impresso no rodapé do PDF — permite rastrear vazamentos.';
