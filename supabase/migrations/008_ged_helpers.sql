-- =============================================================================
-- 008_ged_helpers.sql
--
-- Módulo GED — Gestão Eletrônica de Documentos
--
-- Inclui:
--   - Seed de taxonomia padrão (10 categorias raiz típicas de obra pública)
--   - Seed de termos controlados (status, finalidades, tipos)
--   - Trigger para atualizar fulltext tsvector automaticamente
--   - RPC para upload de nova versão de documento
--   - RPC para emitir GRD (transmittal) com numeração automática
--   - RPC para confirmar recebimento de GRD
--   - RPC para registrar acesso ao documento (audit trail)
--   - View consolidada da lista mestra
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Seed: taxonomia padrão por tenant
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_default_ged_taxonomy(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_root_count int;
BEGIN
  SELECT COUNT(*) INTO v_root_count
  FROM public.ged_categories
  WHERE tenant_id = p_tenant_id AND parent_id IS NULL AND deleted_at IS NULL;

  IF v_root_count > 0 THEN RETURN; END IF;

  INSERT INTO public.ged_categories (tenant_id, parent_id, codigo, nome, ordem, nomenclature_pattern, requires_physical_original, active) VALUES
    (p_tenant_id, NULL, 'CON', 'Contratual',              1, '{contrato}-CON-{numero}',         true,  true),
    (p_tenant_id, NULL, 'PRJ', 'Projetos',                2, '{contrato}-PRJ-{disciplina}-{numero}-R{revisao}', false, true),
    (p_tenant_id, NULL, 'MEM', 'Memoriais descritivos',   3, '{contrato}-MEM-{disciplina}',     false, true),
    (p_tenant_id, NULL, 'PLN', 'Planilhas e orçamentos',  4, '{contrato}-PLN-{tipo}',           false, true),
    (p_tenant_id, NULL, 'CRO', 'Cronogramas',             5, '{contrato}-CRO-{tipo}',           false, true),
    (p_tenant_id, NULL, 'MED', 'Medições',                6, '{contrato}-MED-{numero}',         false, true),
    (p_tenant_id, NULL, 'ADT', 'Aditivos contratuais',    7, '{contrato}-ADT-{numero}',         true,  true),
    (p_tenant_id, NULL, 'COR', 'Correspondências',        8, '{contrato}-COR-{numero}',         false, true),
    (p_tenant_id, NULL, 'REL', 'Relatórios técnicos',     9, '{contrato}-REL-{tipo}-{numero}',  false, true),
    (p_tenant_id, NULL, 'OBR', 'Obra (as-built, RDO)',   10, '{contrato}-OBR-{tipo}-{numero}',  false, true);

  -- Termos controlados de exemplo
  INSERT INTO public.ged_controlled_terms (tenant_id, key, nome, active) VALUES
    (p_tenant_id, 'document_finality', 'Finalidade do documento', true),
    (p_tenant_id, 'document_status',   'Status do documento',     true),
    (p_tenant_id, 'engineering_disciplines', 'Disciplinas de engenharia', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_default_ged_taxonomy(uuid) TO authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.tenants WHERE ativo = true LOOP
    PERFORM public.seed_default_ged_taxonomy(r.id);
  END LOOP;
END$$;


-- -----------------------------------------------------------------------------
-- Trigger: atualiza fulltext tsvector automaticamente
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ged_documents_update_fulltext()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.fulltext :=
    setweight(to_tsvector('portuguese', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('portuguese', coalesce(NEW.numero, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(NEW.nomenclature_code, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(array_to_string(NEW.keywords, ' '), '')), 'B') ||
    setweight(to_tsvector('portuguese', coalesce(NEW.metadata::text, '')), 'C');
  RETURN NEW;
END;
$$;

-- Legacy 001 já cria um trigger chamado ged_documents_fulltext; precisa dropar antes
DROP TRIGGER IF EXISTS ged_documents_fulltext ON public.ged_documents;
DROP TRIGGER IF EXISTS trg_ged_documents_fulltext ON public.ged_documents;
CREATE TRIGGER trg_ged_documents_fulltext
BEFORE INSERT OR UPDATE OF title, description, numero, nomenclature_code, keywords, metadata
ON public.ged_documents
FOR EACH ROW EXECUTE FUNCTION public.ged_documents_update_fulltext();

-- Reindex fulltext em documentos existentes
UPDATE public.ged_documents SET updated_at = updated_at;

CREATE INDEX IF NOT EXISTS idx_ged_documents_fulltext ON public.ged_documents USING gin(fulltext);


-- -----------------------------------------------------------------------------
-- RPC: criar documento + versão inicial
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_ged_document(
  p_category_id   uuid,
  p_contract_id   uuid,
  p_title         text,
  p_description   text,
  p_revision      text,
  p_storage_path  text,
  p_mime_type     text,
  p_file_size     bigint,
  p_hash_sha256   text,
  p_keywords      text[] DEFAULT NULL,
  p_metadata      jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_doc_id    uuid;
  v_ver_id    uuid;
  v_tenant    uuid;
  v_member    uuid;
  v_seq       int;
  v_numero    text;
BEGIN
  SELECT tenant_id INTO v_tenant
  FROM public.ged_categories WHERE id = p_category_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Categoria não encontrada'; END IF;

  SELECT id INTO v_member
  FROM public.members WHERE auth_id = auth.uid() AND tenant_id = v_tenant AND active = true LIMIT 1;

  -- Numeração sequencial por categoria+contrato
  SELECT COALESCE(MAX(NULLIF(regexp_replace(numero, '\D', '', 'g'), '')::int), 0) + 1
  INTO v_seq
  FROM public.ged_documents
  WHERE category_id = p_category_id
    AND (contract_id IS NOT DISTINCT FROM p_contract_id)
    AND deleted_at IS NULL;

  v_numero := lpad(v_seq::text, 5, '0');

  INSERT INTO public.ged_documents (
    tenant_id, category_id, contract_id, numero, title, description,
    revisao_atual, status, responsavel_id, keywords, metadata, created_by
  ) VALUES (
    v_tenant, p_category_id, p_contract_id, v_numero, p_title, p_description,
    p_revision, 'em_elaboracao', v_member, p_keywords, p_metadata, v_member
  )
  RETURNING id INTO v_doc_id;

  INSERT INTO public.ged_document_versions (
    tenant_id, document_id, revision, storage_path, mime_type, file_size, hash_sha256,
    status, uploaded_by
  ) VALUES (
    v_tenant, v_doc_id, p_revision, p_storage_path, p_mime_type, p_file_size, p_hash_sha256,
    'vigente', v_member
  )
  RETURNING id INTO v_ver_id;

  -- Audit
  INSERT INTO public.audit_log (tenant_id, actor_id, entity_type, entity_id, action, after_value)
  VALUES (v_tenant, v_member, 'ged_document', v_doc_id, 'create',
          jsonb_build_object('numero', v_numero, 'revision', p_revision));

  RETURN v_doc_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_ged_document(uuid, uuid, text, text, text, text, text, bigint, text, text[], jsonb) TO authenticated;


-- -----------------------------------------------------------------------------
-- RPC: upload de nova revisão (versão posterior)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upload_ged_document_revision(
  p_document_id   uuid,
  p_revision      text,
  p_storage_path  text,
  p_mime_type     text,
  p_file_size     bigint,
  p_hash_sha256   text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_ver_id  uuid;
  v_tenant  uuid;
  v_member  uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.ged_documents WHERE id = p_document_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Documento não encontrado'; END IF;

  SELECT id INTO v_member
  FROM public.members WHERE auth_id = auth.uid() AND tenant_id = v_tenant AND active = true LIMIT 1;

  -- Marca versões anteriores como obsoletas
  UPDATE public.ged_document_versions
  SET status = 'obsoleta', updated_at = now()
  WHERE document_id = p_document_id AND deleted_at IS NULL;

  INSERT INTO public.ged_document_versions (
    tenant_id, document_id, revision, storage_path, mime_type, file_size, hash_sha256,
    status, uploaded_by
  ) VALUES (
    v_tenant, p_document_id, p_revision, p_storage_path, p_mime_type, p_file_size, p_hash_sha256,
    'vigente', v_member
  )
  RETURNING id INTO v_ver_id;

  UPDATE public.ged_documents
  SET revisao_atual = p_revision,
      status = CASE WHEN status = 'aprovado' THEN 'em_revisao' ELSE status END,
      updated_at = now()
  WHERE id = p_document_id;

  INSERT INTO public.audit_log (tenant_id, actor_id, entity_type, entity_id, action, after_value)
  VALUES (v_tenant, v_member, 'ged_document_version', v_ver_id, 'upload_revision',
          jsonb_build_object('document_id', p_document_id, 'revision', p_revision));

  RETURN v_ver_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upload_ged_document_revision(uuid, text, text, text, bigint, text) TO authenticated;


-- -----------------------------------------------------------------------------
-- RPC: registrar acesso ao documento (audit trail GED)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_ged_access(
  p_document_id uuid,
  p_action      text DEFAULT 'view'   -- 'view' | 'download' | 'print'
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.ged_documents WHERE id = p_document_id;
  IF v_tenant IS NULL THEN RETURN; END IF;

  SELECT id INTO v_member
  FROM public.members WHERE auth_id = auth.uid() AND tenant_id = v_tenant AND active = true LIMIT 1;

  INSERT INTO public.ged_access_log (tenant_id, document_id, member_id, action)
  VALUES (v_tenant, p_document_id, v_member, p_action);
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_ged_access(uuid, text) TO authenticated;


-- -----------------------------------------------------------------------------
-- RPC: emitir GRD (Guia de Remessa de Documentos)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_grd(
  p_contract_id              uuid,
  p_recipient_organization_id uuid,
  p_title                    text,
  p_document_version_ids     uuid[],
  p_finalidade               text DEFAULT 'informacao'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_id      uuid;
  v_tenant  uuid;
  v_member  uuid;
  v_seq     int;
  v_numero  text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.contracts WHERE id = p_contract_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;

  IF p_document_version_ids IS NULL OR cardinality(p_document_version_ids) = 0 THEN
    RAISE EXCEPTION 'A GRD precisa de pelo menos um documento';
  END IF;

  SELECT id INTO v_member
  FROM public.members WHERE auth_id = auth.uid() AND tenant_id = v_tenant AND active = true LIMIT 1;

  -- Numeração sequencial por contrato
  SELECT COALESCE(MAX(NULLIF(regexp_replace(numero, '\D', '', 'g'), '')::int), 0) + 1
  INTO v_seq
  FROM public.ged_transmittals
  WHERE contract_id = p_contract_id AND deleted_at IS NULL;
  v_numero := 'GRD-' || lpad(v_seq::text, 4, '0');

  INSERT INTO public.ged_transmittals (
    tenant_id, contract_id, numero, title, status,
    sender_id, recipient_organization_id, sent_at
  ) VALUES (
    v_tenant, p_contract_id, v_numero, p_title, 'enviada',
    v_member, p_recipient_organization_id, now()
  )
  RETURNING id INTO v_id;

  INSERT INTO public.ged_transmittal_documents (tenant_id, transmittal_id, document_version_id, finalidade)
  SELECT v_tenant, v_id, vid, p_finalidade
  FROM unnest(p_document_version_ids) AS t(vid);

  -- Marca documentos como distribuídos
  UPDATE public.ged_documents
  SET status = 'distribuido', updated_at = now()
  WHERE id IN (
    SELECT document_id FROM public.ged_document_versions WHERE id = ANY(p_document_version_ids)
  );

  -- Audit
  INSERT INTO public.audit_log (tenant_id, actor_id, entity_type, entity_id, action, after_value)
  VALUES (v_tenant, v_member, 'ged_transmittal', v_id, 'issue',
          jsonb_build_object('numero', v_numero, 'doc_count', cardinality(p_document_version_ids)));

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.issue_grd(uuid, uuid, text, uuid[], text) TO authenticated;


-- -----------------------------------------------------------------------------
-- RPC: confirmar recebimento de GRD
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_grd_receipt(
  p_transmittal_id uuid,
  p_observacao text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.ged_transmittals WHERE id = p_transmittal_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Transmittal não encontrado'; END IF;

  SELECT id INTO v_member
  FROM public.members WHERE auth_id = auth.uid() AND tenant_id = v_tenant AND active = true LIMIT 1;

  UPDATE public.ged_transmittals
  SET status = 'recebida', updated_at = now()
  WHERE id = p_transmittal_id;

  -- ged_receipts schema: recipient_id, status, comment, confirmed_at
  INSERT INTO public.ged_receipts (id, tenant_id, transmittal_id, recipient_id, status, comment, confirmed_at)
  VALUES (gen_random_uuid(), v_tenant, p_transmittal_id, v_member, 'recebida', p_observacao, now())
  ON CONFLICT DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION public.confirm_grd_receipt(uuid, text) TO authenticated;


-- -----------------------------------------------------------------------------
-- View: lista mestra GED
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_ged_master_list AS
SELECT
  d.id, d.tenant_id, d.contract_id,
  d.numero, d.nomenclature_code, d.title, d.description,
  d.status, d.revisao_atual, d.data_documento,
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
