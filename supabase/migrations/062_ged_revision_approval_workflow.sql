-- =============================================================================
-- 062_ged_revision_approval_workflow
-- =============================================================================
-- Workflow de aprovação para revisões de documentos GED.
--
-- Padrão paralelo a measurement_approval_steps (V01) e additive_approval_steps:
--   - Tabela `ged_revision_approval_steps` com mesmos campos
--   - RPC `instantiate_ged_revision_workflow` análogo a instantiate_measurement_workflow
--   - RPC `decide_ged_revision_step` análogo a approve_measurement_step
--   - Magic link reusa approval_magic_links (entity_type='ged_revision')
--
-- Lifecycle da revisão:
--   1. Upload de nova revisão → ged_document_versions com status 'em_aprovacao'
--   2. instantiate_ged_revision_workflow cria steps a partir do template
--   3. Cada aprovador decide aprovar/devolver/reprovar
--   4. Todos aprovados → versão fica 'vigente', anterior fica 'obsoleta',
--      ged_documents.revisao_atual + status = 'aprovado' atualizados
--   5. Qualquer reprovado → versão fica 'reprovada', documento volta a 'em_revisao'
-- =============================================================================

-- 1) Schema
CREATE TABLE IF NOT EXISTS public.ged_revision_approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  document_id uuid NOT NULL REFERENCES public.ged_documents(id),
  version_id  uuid NOT NULL REFERENCES public.ged_document_versions(id),
  template_step_id uuid REFERENCES public.workflow_steps(id),
  ordem int NOT NULL,
  nome text NOT NULL,
  role_required text NOT NULL,
  assigned_to uuid REFERENCES public.members(id),
  status text DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','devolvido','reprovado','ignorado')),
  due_at timestamptz,
  decided_at timestamptz,
  decided_by uuid REFERENCES public.members(id),
  decided_via_delegation uuid REFERENCES public.approval_delegations(id),
  decided_for uuid REFERENCES public.members(id),
  comment text,
  signature_method text,
  signature_storage_path text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ged_revision_approval_version
  ON public.ged_revision_approval_steps (version_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ged_revision_approval_pending
  ON public.ged_revision_approval_steps (tenant_id, due_at)
  WHERE status = 'pendente' AND deleted_at IS NULL;

-- 2) Enable RLS — tenant isolation
ALTER TABLE public.ged_revision_approval_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ged_revision_approval_select ON public.ged_revision_approval_steps;
CREATE POLICY ged_revision_approval_select ON public.ged_revision_approval_steps
  FOR SELECT TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

DROP POLICY IF EXISTS ged_revision_approval_modify ON public.ged_revision_approval_steps;
CREATE POLICY ged_revision_approval_modify ON public.ged_revision_approval_steps
  FOR ALL TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  ) WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

-- 3) RPC instantiate_ged_revision_workflow
-- Análogo a instantiate_measurement_workflow (V07). Cria 1 step por
-- workflow_step do template para a versão indicada.
CREATE OR REPLACE FUNCTION public.instantiate_ged_revision_workflow(
  p_version_id uuid,
  p_template_id uuid DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tenant     uuid;
  v_document   uuid;
  v_template   uuid;
  v_count      int := 0;
  v_step       record;
  v_due        timestamptz;
  v_now        timestamptz := now();
BEGIN
  SELECT v.tenant_id, v.document_id INTO v_tenant, v_document
    FROM public.ged_document_versions v
   WHERE v.id = p_version_id AND v.deleted_at IS NULL;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Versão de documento não encontrada';
  END IF;

  -- Resolve template: param > documento (sem contract_id) > tenant default
  IF p_template_id IS NOT NULL THEN
    v_template := p_template_id;
  ELSE
    SELECT id INTO v_template
      FROM public.workflow_templates
     WHERE tenant_id = v_tenant
       AND entity_type = 'ged_document'
       AND active AND deleted_at IS NULL
     ORDER BY contract_id NULLS LAST, created_at DESC
     LIMIT 1;
  END IF;

  IF v_template IS NULL THEN
    -- Sem template: cria step único genérico "Aprovação técnica"
    INSERT INTO public.ged_revision_approval_steps (
      tenant_id, document_id, version_id, ordem, nome, role_required, due_at, status
    ) VALUES (
      v_tenant, v_document, p_version_id, 1, 'Aprovação técnica', 'gestor_contrato',
      v_now + interval '72 hours', 'pendente'
    );
    RETURN 1;
  END IF;

  FOR v_step IN
    SELECT * FROM public.workflow_steps
     WHERE template_id = v_template AND deleted_at IS NULL
     ORDER BY ordem
  LOOP
    v_due := v_now + (coalesce(v_step.sla_hours, 48) || ' hours')::interval;
    INSERT INTO public.ged_revision_approval_steps (
      tenant_id, document_id, version_id, template_step_id,
      ordem, nome, role_required, due_at, status
    ) VALUES (
      v_tenant, v_document, p_version_id, v_step.id,
      v_step.ordem, v_step.nome, v_step.role_required, v_due, 'pendente'
    );
    v_count := v_count + 1;
  END LOOP;

  -- Versão fica em_aprovacao
  UPDATE public.ged_document_versions
     SET status = 'em_aprovacao', updated_at = v_now
   WHERE id = p_version_id;

  -- Documento vai para em_revisao
  UPDATE public.ged_documents
     SET status = 'em_revisao', updated_at = v_now
   WHERE id = v_document;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.instantiate_ged_revision_workflow(uuid, uuid) TO authenticated;

-- 4) RPC decide_ged_revision_step
-- Análogo a approve_measurement_step (V02). Aprova/devolve/reprova um step.
-- Quando último step aprovado: publica revisão (versão vigente + obsoleta a anterior).
CREATE OR REPLACE FUNCTION public.decide_ged_revision_step(
  p_step_id uuid,
  p_action  text DEFAULT 'aprovar',
  p_comment text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_step            record;
  v_member          uuid;
  v_tenant          uuid;
  v_status_new      text;
  v_now             timestamptz := now();
  v_pending_count   int;
  v_reproved_count  int;
  v_doc_id          uuid;
  v_version_id      uuid;
  v_revision        text;
BEGIN
  SELECT * INTO v_step
    FROM public.ged_revision_approval_steps
   WHERE id = p_step_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Step não encontrado';
  END IF;
  IF v_step.status <> 'pendente' THEN
    RAISE EXCEPTION 'Step já foi decidido (%)', v_step.status;
  END IF;

  v_doc_id     := v_step.document_id;
  v_version_id := v_step.version_id;

  SELECT id INTO v_member
    FROM public.members
   WHERE user_id = auth.uid() AND tenant_id = v_step.tenant_id AND deleted_at IS NULL;

  v_status_new := CASE p_action
    WHEN 'aprovar'  THEN 'aprovado'
    WHEN 'devolver' THEN 'devolvido'
    WHEN 'reprovar' THEN 'reprovado'
    ELSE NULL
  END;
  IF v_status_new IS NULL THEN
    RAISE EXCEPTION 'Ação inválida (use aprovar, devolver ou reprovar)';
  END IF;

  UPDATE public.ged_revision_approval_steps
     SET status     = v_status_new,
         decided_at = v_now,
         decided_by = v_member,
         comment    = p_comment,
         updated_at = v_now
   WHERE id = p_step_id;

  -- Conta steps restantes (pendentes) e reprovados na mesma versão
  SELECT
    count(*) FILTER (WHERE status = 'pendente'),
    count(*) FILTER (WHERE status = 'reprovado')
  INTO v_pending_count, v_reproved_count
  FROM public.ged_revision_approval_steps
  WHERE version_id = v_version_id AND deleted_at IS NULL;

  -- Lifecycle final
  IF v_reproved_count > 0 THEN
    -- Qualquer reprovação → versão reprovada, doc volta a em_revisao
    UPDATE public.ged_document_versions
       SET status = 'reprovada', updated_at = v_now
     WHERE id = v_version_id;
    UPDATE public.ged_documents
       SET status = 'em_revisao', updated_at = v_now
     WHERE id = v_doc_id;
  ELSIF v_pending_count = 0 THEN
    -- Todas aprovadas → publica revisão
    SELECT revision INTO v_revision
      FROM public.ged_document_versions
     WHERE id = v_version_id;

    -- Marca anteriores como obsoleta
    UPDATE public.ged_document_versions
       SET status = 'obsoleta', updated_at = v_now
     WHERE document_id = v_doc_id
       AND id <> v_version_id
       AND status = 'vigente'
       AND deleted_at IS NULL;

    -- Esta versão vira vigente
    UPDATE public.ged_document_versions
       SET status = 'vigente', updated_at = v_now
     WHERE id = v_version_id;

    -- Documento aprovado, revisao_atual atualizada
    UPDATE public.ged_documents
       SET status = 'aprovado',
           revisao_atual = coalesce(v_revision, revisao_atual),
           updated_at = v_now
     WHERE id = v_doc_id;
  END IF;

  RETURN jsonb_build_object(
    'step_id', p_step_id,
    'status',  v_status_new,
    'pending_remaining', v_pending_count,
    'reproved_count',    v_reproved_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_ged_revision_step(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.decide_ged_revision_step(uuid, text, text) IS
'V60 — Decide um step de aprovação de revisão GED. Quando última aprovação, ' ||
'publica revisão como vigente e obsoleta a anterior; qualquer reprovação ' ||
'volta documento para em_revisao.';
