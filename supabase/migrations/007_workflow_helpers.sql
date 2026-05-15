-- =============================================================================
-- 007_workflow_helpers.sql
--
-- RPCs auxiliares para o módulo de aprovação:
--   - seed_default_workflow_template: cria template padrão de 4 etapas
--     (Gerenciadora → Fiscal → Gestor → Financeiro)
--   - instantiate_measurement_workflow: cria measurement_approval_steps a partir
--     do template ativo para o contrato (ou padrão do tenant)
--   - approve_measurement_step: chama a EF approve-measurement-step
--     com tratamento de delegação ativa
--   - issue_approval_magic_link: gera token de aprovação por email
--   - active_delegation_for_member: retorna delegação ativa que cobre o usuário
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Seed: cria 1 template padrão por tenant + entity_type='measurement'
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_default_workflow_template(p_tenant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_template_id uuid;
BEGIN
  -- Evita duplicar
  SELECT id INTO v_template_id
  FROM public.workflow_templates
  WHERE tenant_id = p_tenant_id
    AND entity_type = 'measurement'
    AND nome = 'Workflow padrão de medição'
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_template_id IS NOT NULL THEN RETURN v_template_id; END IF;

  INSERT INTO public.workflow_templates (tenant_id, nome, entity_type, active)
  VALUES (p_tenant_id, 'Workflow padrão de medição', 'measurement', true)
  RETURNING id INTO v_template_id;

  -- 4 etapas sequenciais
  INSERT INTO public.workflow_steps (tenant_id, template_id, ordem, nome, role_required, sla_hours, assinatura_obrigatoria, actions) VALUES
    (p_tenant_id, v_template_id, 1, 'Análise gerenciadora',    'gerenciadora',     48, false, ARRAY['aprovar','devolver']),
    (p_tenant_id, v_template_id, 2, 'Fiscal do contrato',      'fiscal_contrato',  72, true,  ARRAY['aprovar','devolver','reprovar']),
    (p_tenant_id, v_template_id, 3, 'Gestor do contrato',      'gestor_contrato',  72, true,  ARRAY['aprovar','devolver','reprovar']),
    (p_tenant_id, v_template_id, 4, 'Setor financeiro',        'financeiro',       48, false, ARRAY['aprovar','devolver']);

  RETURN v_template_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_default_workflow_template(uuid) TO authenticated;

-- Roda para tenants existentes
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.tenants WHERE ativo = true LOOP
    PERFORM public.seed_default_workflow_template(r.id);
  END LOOP;
END$$;


-- -----------------------------------------------------------------------------
-- RPC: instanciar workflow numa medição
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.instantiate_measurement_workflow(
  p_measurement_id uuid,
  p_template_id    uuid DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_tenant     uuid;
  v_contract   uuid;
  v_template   uuid;
  v_count      int := 0;
  v_step       record;
  v_due        timestamptz;
  v_now        timestamptz := now();
  v_assignee   uuid;
BEGIN
  SELECT tenant_id, contract_id INTO v_tenant, v_contract
  FROM public.measurements WHERE id = p_measurement_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Medição não encontrada';
  END IF;

  -- Resolve template: prioridade param > específico do contrato > padrão do tenant
  IF p_template_id IS NOT NULL THEN
    v_template := p_template_id;
  ELSE
    SELECT id INTO v_template
    FROM public.workflow_templates
    WHERE tenant_id = v_tenant AND entity_type = 'measurement' AND contract_id = v_contract
      AND active AND deleted_at IS NULL
    ORDER BY created_at DESC LIMIT 1;

    IF v_template IS NULL THEN
      SELECT id INTO v_template
      FROM public.workflow_templates
      WHERE tenant_id = v_tenant AND entity_type = 'measurement' AND contract_id IS NULL
        AND active AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1;
    END IF;
  END IF;

  IF v_template IS NULL THEN
    -- Auto-seed se nenhum template existe
    v_template := public.seed_default_workflow_template(v_tenant);
  END IF;

  -- Remove etapas existentes (re-instanciação)
  DELETE FROM public.measurement_approval_steps WHERE measurement_id = p_measurement_id;

  v_due := v_now;
  FOR v_step IN
    SELECT * FROM public.workflow_steps
    WHERE template_id = v_template AND deleted_at IS NULL
    ORDER BY ordem
  LOOP
    v_due := v_due + (v_step.sla_hours || ' hours')::interval;

    -- Tenta resolver assignee: primeiro contract_members com o papel
    SELECT cm.member_id INTO v_assignee
    FROM public.contract_members cm
    WHERE cm.contract_id = v_contract
      AND cm.papel = v_step.role_required
      AND cm.active = true
      AND cm.deleted_at IS NULL
      AND cm.can_approve = true
    ORDER BY cm.created_at LIMIT 1;

    INSERT INTO public.measurement_approval_steps (
      tenant_id, measurement_id, template_step_id, ordem, nome,
      role_required, assigned_to, status, due_at
    ) VALUES (
      v_tenant, p_measurement_id, v_step.id, v_step.ordem, v_step.nome,
      v_step.role_required, v_assignee, 'pendente', v_due
    );
    v_count := v_count + 1;
    v_assignee := NULL;
  END LOOP;

  -- Marca medição como em aprovação
  UPDATE public.measurements
  SET status = 'em_aprovacao', updated_at = v_now
  WHERE id = p_measurement_id;

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.instantiate_measurement_workflow(uuid, uuid) TO authenticated;


-- -----------------------------------------------------------------------------
-- Helper: delegação ativa que cobre um delegatee num escopo
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.active_delegation_for_member(
  p_delegator_id uuid,
  p_escopo       text DEFAULT 'measurement_approval'
) RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id FROM public.approval_delegations
  WHERE delegator_id = p_delegator_id
    AND escopo = p_escopo
    AND active = true
    AND now() BETWEEN ativo_de AND ativo_ate
    AND deleted_at IS NULL
  ORDER BY created_at DESC LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.active_delegation_for_member(uuid, text) TO authenticated;


-- -----------------------------------------------------------------------------
-- RPC: decidir uma etapa de aprovação (aprovar / devolver / reprovar)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_approval_step(
  p_step_id  uuid,
  p_action   text,             -- 'aprovar' | 'devolver' | 'reprovar'
  p_comment  text DEFAULT NULL,
  p_signature_method text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_step      record;
  v_member    uuid;
  v_tenant    uuid;
  v_meas      record;
  v_next_step record;
  v_status    text;
  v_delegation uuid;
BEGIN
  SELECT * INTO v_step FROM public.measurement_approval_steps WHERE id = p_step_id;
  IF v_step IS NULL THEN RAISE EXCEPTION 'Etapa não encontrada'; END IF;
  IF v_step.status <> 'pendente' THEN
    RAISE EXCEPTION 'Etapa já decidida (%) — não pode ser alterada', v_step.status;
  END IF;

  v_tenant := v_step.tenant_id;

  SELECT id INTO v_member FROM public.members
  WHERE auth_id = auth.uid() AND tenant_id = v_tenant AND active = true LIMIT 1;
  IF v_member IS NULL THEN RAISE EXCEPTION 'Usuário não autorizado'; END IF;

  -- Permissão: o assigned_to ou alguém com delegação ativa do assigned_to
  IF v_step.assigned_to IS NOT NULL AND v_member <> v_step.assigned_to THEN
    SELECT public.active_delegation_for_member(v_step.assigned_to, 'measurement_approval')
    INTO v_delegation;
    IF v_delegation IS NULL THEN
      RAISE EXCEPTION 'Usuário não é o responsável pela etapa e não há delegação ativa';
    END IF;
  END IF;

  -- Comentário obrigatório em devolver/reprovar (RN-018)
  IF p_action IN ('devolver','reprovar') AND COALESCE(trim(p_comment), '') = '' THEN
    RAISE EXCEPTION 'Comentário obrigatório ao % uma etapa', p_action;
  END IF;

  v_status := CASE p_action
    WHEN 'aprovar'  THEN 'aprovado'
    WHEN 'devolver' THEN 'devolvido'
    WHEN 'reprovar' THEN 'reprovado'
    ELSE NULL
  END;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Ação inválida: %', p_action; END IF;

  UPDATE public.measurement_approval_steps
  SET status = v_status,
      decided_at = now(),
      decided_by = v_member,
      decided_via_delegation = v_delegation,
      decided_for = CASE WHEN v_delegation IS NOT NULL THEN v_step.assigned_to ELSE NULL END,
      comment = p_comment,
      signature_method = p_signature_method,
      updated_at = now()
  WHERE id = p_step_id;

  -- Atualiza status da medição conforme decisão
  IF p_action = 'reprovar' THEN
    UPDATE public.measurements SET status = 'cancelada', updated_at = now() WHERE id = v_step.measurement_id;
  ELSIF p_action = 'devolver' THEN
    UPDATE public.measurements SET status = 'devolvida', updated_at = now() WHERE id = v_step.measurement_id;
    -- Marca etapas posteriores como ignoradas (workflow reinicia se re-submetida)
  ELSIF p_action = 'aprovar' THEN
    -- Verifica se é a última etapa
    SELECT * INTO v_next_step
    FROM public.measurement_approval_steps
    WHERE measurement_id = v_step.measurement_id AND status = 'pendente'
    ORDER BY ordem LIMIT 1;

    IF v_next_step IS NULL THEN
      -- Todas as etapas aprovadas
      UPDATE public.measurements
      SET status = 'aprovada', data_aprovacao = now(), updated_at = now()
      WHERE id = v_step.measurement_id;
    END IF;
  END IF;

  -- Audit
  INSERT INTO public.audit_log (tenant_id, actor_id, entity_type, entity_id, action, after_value)
  VALUES (v_tenant, v_member, 'measurement_approval_step', p_step_id, p_action,
          jsonb_build_object('status', v_status, 'comment', p_comment,
                             'via_delegation', v_delegation IS NOT NULL));

  RETURN jsonb_build_object(
    'ok', true,
    'step_id', p_step_id,
    'new_status', v_status,
    'via_delegation', v_delegation IS NOT NULL
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.decide_approval_step(uuid, text, text, text) TO authenticated;


-- -----------------------------------------------------------------------------
-- RPC: emitir magic link de aprovação (token de uso único)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_approval_magic_link(
  p_step_id uuid,
  p_recipient_email text,
  p_ttl_hours int DEFAULT 72
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_step record;
  v_token text;
  v_token_hash text;
BEGIN
  SELECT * INTO v_step FROM public.measurement_approval_steps WHERE id = p_step_id;
  IF v_step IS NULL THEN RAISE EXCEPTION 'Etapa não encontrada'; END IF;
  IF v_step.status <> 'pendente' THEN RAISE EXCEPTION 'Etapa não está pendente'; END IF;

  -- Token de 32 bytes aleatórios → hex
  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.approval_magic_links (
    tenant_id, entity_type, entity_id, step_id,
    recipient_email, token_hash, expires_at, metadata
  ) VALUES (
    v_step.tenant_id, 'measurement', v_step.measurement_id, p_step_id,
    p_recipient_email, v_token_hash, now() + (p_ttl_hours || ' hours')::interval,
    jsonb_build_object('step_nome', v_step.nome, 'ordem', v_step.ordem)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'token', v_token,    -- só retornado uma vez
    'expires_in_hours', p_ttl_hours,
    'recipient_email', p_recipient_email
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.issue_approval_magic_link(uuid, text, int) TO authenticated;


-- -----------------------------------------------------------------------------
-- View: workflow ativo de uma medição com badge de progresso
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_measurement_workflow AS
SELECT
  m.id AS measurement_id,
  m.tenant_id,
  m.contract_id,
  m.numero,
  m.status AS measurement_status,
  COUNT(s.id) FILTER (WHERE s.status = 'aprovado')  AS steps_aprovados,
  COUNT(s.id) FILTER (WHERE s.status = 'pendente')  AS steps_pendentes,
  COUNT(s.id) FILTER (WHERE s.status = 'devolvido') AS steps_devolvidos,
  COUNT(s.id) FILTER (WHERE s.status = 'reprovado') AS steps_reprovados,
  COUNT(s.id) AS steps_total,
  MIN(CASE WHEN s.status = 'pendente' THEN s.due_at END) AS proxima_sla
FROM public.measurements m
LEFT JOIN public.measurement_approval_steps s ON s.measurement_id = m.id AND s.deleted_at IS NULL
WHERE m.deleted_at IS NULL
GROUP BY m.id, m.tenant_id, m.contract_id, m.numero, m.status;
GRANT SELECT ON public.v_measurement_workflow TO authenticated;
