-- =============================================================================
-- 059_ged_validade_temporal
-- =============================================================================
-- Adiciona controle de validade temporal em documentos GED (ARTs, licenças,
-- ASOs, alvarás, certidões — qualquer doc que expira por lei).
--
-- Estratégia:
--   1. Colunas novas em `ged_documents`: data_validade + dias_alerta_antes
--   2. Estende `v_ged_master_list` para expor esses campos + dias_para_vencimento
--   3. Estende `alert_kind` CHECK constraint (V52) com 'documento_vencendo'
--   4. SQL function `scan_ged_documents_expiring(days_ahead, dry_run)` análoga
--      à `scan_guarantees_expiring` (V53) — idempotente, gera realtime_alerts
--   5. pg_cron job diário às 06:30 UTC (após scan_guarantees às 06:00)
-- =============================================================================

-- =============================================================================
-- Colunas novas em ged_documents
-- =============================================================================
ALTER TABLE public.ged_documents
  ADD COLUMN IF NOT EXISTS data_validade date,
  ADD COLUMN IF NOT EXISTS dias_alerta_antes int NOT NULL DEFAULT 30
    CHECK (dias_alerta_antes >= 0 AND dias_alerta_antes <= 365);

CREATE INDEX IF NOT EXISTS idx_ged_documents_validade
  ON public.ged_documents (data_validade)
  WHERE data_validade IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN public.ged_documents.data_validade IS
'V56 — Data em que o documento expira (ARTs, licenças, ASOs etc). NULL = sem validade.';
COMMENT ON COLUMN public.ged_documents.dias_alerta_antes IS
'V56 — Quantos dias antes do vencimento o cron deve gerar realtime_alert. Default 30.';

-- =============================================================================
-- Estende CHECK constraint do alert_kind (V52: 4 valores) com 'documento_vencendo'
-- =============================================================================
ALTER TABLE public.realtime_alerts DROP CONSTRAINT IF EXISTS realtime_alerts_alert_kind_check;
ALTER TABLE public.realtime_alerts ADD CONSTRAINT realtime_alerts_alert_kind_check
  CHECK (alert_kind IN (
    'vicio_grave', 'multa_grande', 'par_procedente', 'garantia_vencendo',
    'documento_vencendo'
  ));

-- =============================================================================
-- Estende v_ged_master_list com campos de validade
-- =============================================================================
CREATE OR REPLACE VIEW public.v_ged_master_list AS
SELECT
  d.id, d.tenant_id, d.contract_id,
  d.numero, d.nomenclature_code, d.title, d.description,
  d.status, d.revisao_atual, d.data_documento,
  d.data_validade, d.dias_alerta_antes,
  CASE
    WHEN d.data_validade IS NULL THEN NULL
    ELSE (d.data_validade - CURRENT_DATE)
  END AS dias_para_vencimento,
  c.id   AS category_id, c.codigo AS category_codigo, c.nome AS category_nome,
  ct.id  AS contract_internal_id, ct.numero AS contract_numero,
  m.nome AS responsavel_nome, m.email AS responsavel_email,
  v.storage_path AS current_version_path,
  v.file_size,  v.mime_type, v.hash_sha256,
  v.uploaded_at AS current_version_uploaded_at,
  (SELECT COUNT(*) FROM public.ged_document_versions WHERE document_id = d.id AND deleted_at IS NULL) AS versions_count,
  d.created_at, d.updated_at, d.fulltext
FROM public.ged_documents d
LEFT JOIN public.ged_categories c ON c.id = d.category_id
LEFT JOIN public.contracts ct     ON ct.id = d.contract_id
LEFT JOIN public.members m        ON m.id = d.responsavel_id
LEFT JOIN LATERAL (
  SELECT v.* FROM public.ged_document_versions v
  WHERE v.document_id = d.id AND v.status = 'vigente' AND v.deleted_at IS NULL
  ORDER BY v.uploaded_at DESC LIMIT 1
) v ON true
WHERE d.deleted_at IS NULL;

GRANT SELECT ON public.v_ged_master_list TO authenticated;

-- =============================================================================
-- RPC: update_ged_document_validity — set/clear validade + dias_alerta
-- =============================================================================
CREATE OR REPLACE FUNCTION public.update_ged_document_validity(
  p_document_id     uuid,
  p_data_validade   date,
  p_dias_alerta     int DEFAULT 30
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_dias_alerta IS NOT NULL AND (p_dias_alerta < 0 OR p_dias_alerta > 365) THEN
    RAISE EXCEPTION 'dias_alerta_antes deve estar entre 0 e 365';
  END IF;

  UPDATE public.ged_documents
     SET data_validade     = p_data_validade,
         dias_alerta_antes = coalesce(p_dias_alerta, 30),
         updated_at        = now()
   WHERE id = p_document_id
     AND deleted_at IS NULL
     AND tenant_id IN (SELECT tenant_id FROM public.members WHERE auth_id = auth.uid());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento não encontrado ou sem permissão';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_ged_document_validity(uuid, date, int) TO authenticated;

-- =============================================================================
-- SQL function: scan_ged_documents_expiring
-- =============================================================================
CREATE OR REPLACE FUNCTION public.scan_ged_documents_expiring(
  p_days_ahead int DEFAULT 30,
  p_dry_run    boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alerts_created      int := 0;
  v_skipped_idempotent  int := 0;
  v_errors              int := 0;
  v_processed           int := 0;
  v_rec                 record;
  v_existing_id         uuid;
  v_severity            text;
  v_title               text;
  v_body                text;
  v_ref_link            text;
  v_dias                int;
  v_cutoff_ts           timestamptz;
BEGIN
  IF p_days_ahead < 1 THEN p_days_ahead := 1; END IF;
  IF p_days_ahead > 365 THEN p_days_ahead := 365; END IF;

  -- Janela de idempotência: 7d (mesmo padrão V53 garantias).
  v_cutoff_ts := now() - interval '7 days';

  FOR v_rec IN
    SELECT d.id, d.tenant_id, d.contract_id, d.title, d.numero,
           d.data_validade, d.dias_alerta_antes,
           c.codigo AS category_codigo, c.nome AS category_nome,
           ct.numero AS contract_numero,
           (d.data_validade - CURRENT_DATE) AS dias
      FROM public.ged_documents d
      LEFT JOIN public.ged_categories c ON c.id = d.category_id
      LEFT JOIN public.contracts     ct ON ct.id = d.contract_id
     WHERE d.deleted_at IS NULL
       AND d.data_validade IS NOT NULL
       AND d.status NOT IN ('obsoleto','cancelado')
       AND (d.data_validade - CURRENT_DATE) BETWEEN -7 AND least(d.dias_alerta_antes, p_days_ahead)
  LOOP
    v_processed := v_processed + 1;
    v_dias := v_rec.dias;

    -- Idempotência: alerta para esse doc nos últimos 7d?
    SELECT id INTO v_existing_id
      FROM public.realtime_alerts
     WHERE tenant_id  = v_rec.tenant_id
       AND alert_kind = 'documento_vencendo'
       AND metadata->>'document_id' = v_rec.id::text
       AND created_at  > v_cutoff_ts
       AND dismissed_at IS NULL
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      v_skipped_idempotent := v_skipped_idempotent + 1;
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      v_alerts_created := v_alerts_created + 1;
      CONTINUE;
    END IF;

    -- Severity: vencido ou <= 7d = danger; senão warning
    v_severity := CASE WHEN v_dias <= 7 THEN 'danger' ELSE 'warning' END;

    IF v_dias < 0 THEN
      v_title := 'Documento vencido há ' || abs(v_dias)::text
              || ' dia' || CASE WHEN abs(v_dias) = 1 THEN '' ELSE 's' END
              || ' · ' || coalesce(v_rec.category_codigo, 'doc');
    ELSE
      v_title := 'Documento vence em ' || v_dias::text
              || ' dia' || CASE WHEN v_dias = 1 THEN '' ELSE 's' END
              || ' · ' || coalesce(v_rec.category_codigo, 'doc');
    END IF;

    v_body := v_rec.title
           || CASE WHEN v_rec.contract_numero IS NOT NULL
                   THEN ' · contrato ' || v_rec.contract_numero
                   ELSE '' END
           || ' · vencimento ' || to_char(v_rec.data_validade, 'DD/MM/YYYY');

    v_ref_link := '/ged/documentos/' || v_rec.id::text;

    BEGIN
      PERFORM public._insert_realtime_alert(
        v_rec.tenant_id,
        v_rec.contract_id,
        'documento_vencendo',
        v_severity,
        v_title,
        v_body,
        v_ref_link,
        jsonb_build_object(
          'document_id',          v_rec.id,
          'document_title',       v_rec.title,
          'category_codigo',      v_rec.category_codigo,
          'data_validade',        v_rec.data_validade,
          'dias_para_vencimento', v_dias,
          'dias_alerta_antes',    v_rec.dias_alerta_antes
        )
      );
      v_alerts_created := v_alerts_created + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed',          v_processed,
    'alerts_created',     v_alerts_created,
    'skipped_idempotent', v_skipped_idempotent,
    'errors',             v_errors,
    'dry_run',            p_dry_run,
    'days_ahead',         p_days_ahead,
    'executed_at',        now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.scan_ged_documents_expiring(int, boolean) TO service_role;

-- =============================================================================
-- pg_cron schedule (diário 06:30 UTC ≈ 03:30 BRT, 30min depois das garantias)
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scan_ged_documents_expiring_daily') THEN
      PERFORM cron.unschedule('scan_ged_documents_expiring_daily');
    END IF;

    PERFORM cron.schedule(
      'scan_ged_documents_expiring_daily',
      '30 6 * * *',
      $cron$ SELECT public.scan_ged_documents_expiring(30, false); $cron$
    );
  END IF;
EXCEPTION
  WHEN undefined_table OR undefined_function THEN
    NULL;
END;
$$;

COMMENT ON FUNCTION public.scan_ged_documents_expiring(int, boolean) IS
'V56 — Scan diário de documentos GED vencendo. Janela: data_validade BETWEEN -7d AND least(dias_alerta_antes, p_days_ahead). Idempotência 7d via metadata->>document_id.';
