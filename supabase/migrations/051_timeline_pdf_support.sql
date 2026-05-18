-- =============================================================================
-- 051_timeline_pdf_support
-- =============================================================================
-- Suporte ao Edge Function export-contract-timeline-pdf (V44).
--
-- Slot 050 ocupado por trabalho órfão (portfolio_lei14133, release-v43-prior).
-- V44 usa 051 para preservar continuidade histórica do diretório.
--
-- 1. Estende public_validation_records.entity_type CHECK para incluir
--    'contract_timeline' (novo tipo de documento publicamente validável)
-- 2. Adiciona report_type 'contract_timeline' implícito em generated_reports
--    (campo já é livre, mas documentamos)
-- 3. Garante que o bucket 'reports' existe no Storage
--
-- A EF em si não precisa de DDL adicional (já consulta v_contract_timeline
-- da V39, public.contracts, public.contract_lots, etc).
-- =============================================================================

-- =============================================================================
-- 1. Estender entity_type para incluir contract_timeline
-- =============================================================================
DO $$
BEGIN
  -- Drop e recria a check constraint com o novo valor
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'public_validation_records_entity_type_check'
      AND table_name = 'public_validation_records'
  ) THEN
    ALTER TABLE public.public_validation_records
      DROP CONSTRAINT public_validation_records_entity_type_check;
  END IF;

  ALTER TABLE public.public_validation_records
    ADD CONSTRAINT public_validation_records_entity_type_check
    CHECK (entity_type IN (
      'measurement_document',
      'additive_document',
      'ged_document_version',
      'databook_export',
      'grd',
      'contract_timeline'    -- V44
    ));
END
$$;

COMMENT ON COLUMN public.public_validation_records.entity_type IS
  'measurement_document · additive_document · ged_document_version · databook_export · grd · contract_timeline (V44)';

-- =============================================================================
-- 2. Garante bucket de storage 'reports' (idempotente)
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'reports') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'reports',
      'reports',
      false,    -- privado: requer URL assinada
      52428800, -- 50 MB
      ARRAY['application/pdf']::text[]
    );
  END IF;
END
$$;

-- =============================================================================
-- 3. RLS policies do bucket reports (idempotente)
-- =============================================================================
DO $$
BEGIN
  -- Service role tem acesso total (default Supabase, garantido aqui)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'reports_service_role_all'
  ) THEN
    CREATE POLICY reports_service_role_all
      ON storage.objects FOR ALL TO service_role
      USING (bucket_id = 'reports')
      WITH CHECK (bucket_id = 'reports');
  END IF;

  -- Authenticated users leem apenas reports do próprio tenant via path-prefix
  -- Path padrão: tenants/{tenant_id}/contracts/{contract_id}/timeline/{date}-{code}.pdf
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'reports_authenticated_select'
  ) THEN
    CREATE POLICY reports_authenticated_select
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'reports'
        AND (
          -- Path começa com tenants/{tenant_id}/...
          (storage.foldername(name))[1] = 'tenants'
          AND ((storage.foldername(name))[2])::uuid = public.current_tenant_id()
        )
      );
  END IF;
END
$$;
