-- =============================================================================
-- 009_magic_link_consumption.sql
--
-- RPCs públicas para o fluxo /aprovar/:token (página externa, sem login).
-- O usuário recebe um token via e-mail e usa a página pública para decidir.
--
-- Inclui:
--   - get_magic_link_preview(token) — retorna dados do step + medição
--   - consume_magic_link(token, action, comment, signature_method) — decide
--     a etapa em nome do recipient. Replica a lógica de decide_approval_step
--     porque essa última depende de auth.uid() e aqui não há sessão.
--
-- Ambas são SECURITY DEFINER. A segurança vem da posse do token (hash SHA-256)
-- e da expiração curta (default 72h, definida em issue_approval_magic_link).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Preview: retorna informações sobre o step apontado pelo token, sem decidir.
-- Não revela token_hash nem dados sensíveis de outros tenants.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_magic_link_preview(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_link record;
  v_step record;
  v_measurement record;
  v_contract record;
  v_recipient_member uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RAISE EXCEPTION 'Token inválido';
  END IF;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  SELECT * INTO v_link FROM public.approval_magic_links
   WHERE token_hash = v_hash AND deleted_at IS NULL
   LIMIT 1;

  IF v_link IS NULL THEN
    RAISE EXCEPTION 'Link não encontrado';
  END IF;

  IF v_link.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'Link já utilizado em %', v_link.used_at;
  END IF;

  IF v_link.expires_at < now() THEN
    RAISE EXCEPTION 'Link expirado em %', v_link.expires_at;
  END IF;

  SELECT * INTO v_step FROM public.measurement_approval_steps WHERE id = v_link.step_id;
  IF v_step IS NULL THEN RAISE EXCEPTION 'Etapa não encontrada'; END IF;

  SELECT id, contract_id, numero, periodo_inicio, periodo_fim, valor_po, valor_liquido, status
    INTO v_measurement
    FROM public.measurements WHERE id = v_step.measurement_id;

  SELECT id, numero, objeto FROM public.contracts WHERE id = v_measurement.contract_id INTO v_contract;

  -- Tenta resolver o membro pelo email
  SELECT id INTO v_recipient_member
    FROM public.members
   WHERE tenant_id = v_link.tenant_id AND email = v_link.recipient_email AND active = true AND deleted_at IS NULL
   LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'tenant_id', v_link.tenant_id,
    'recipient_email', v_link.recipient_email,
    'recipient_member_id', v_recipient_member,
    'expires_at', v_link.expires_at,
    'step', jsonb_build_object(
      'id', v_step.id,
      'measurement_id', v_step.measurement_id,
      'ordem', v_step.ordem,
      'nome', v_step.nome,
      'role_required', v_step.role_required,
      'status', v_step.status,
      'due_at', v_step.due_at
    ),
    'measurement', jsonb_build_object(
      'id', v_measurement.id,
      'numero', v_measurement.numero,
      'periodo_inicio', v_measurement.periodo_inicio,
      'periodo_fim', v_measurement.periodo_fim,
      'valor_po', v_measurement.valor_po,
      'valor_liquido', v_measurement.valor_liquido,
      'status', v_measurement.status
    ),
    'contract', jsonb_build_object(
      'id', v_contract.id,
      'numero', v_contract.numero,
      'objeto', v_contract.objeto
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_magic_link_preview(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_magic_link_preview(text) TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- Consume: aplica a decisão e marca o link como usado.
-- Faz tudo dentro de uma transação implícita (função plpgsql).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_magic_link(
  p_token             text,
  p_action            text,                -- 'aprovar' | 'devolver' | 'reprovar'
  p_comment           text DEFAULT NULL,
  p_signature_method  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash       text;
  v_link       record;
  v_step       record;
  v_member     uuid;
  v_next_step  record;
  v_status     text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RAISE EXCEPTION 'Token inválido';
  END IF;
  IF p_action NOT IN ('aprovar','devolver','reprovar') THEN
    RAISE EXCEPTION 'Ação inválida: %', p_action;
  END IF;
  IF p_action IN ('devolver','reprovar') AND COALESCE(trim(p_comment), '') = '' THEN
    RAISE EXCEPTION 'Comentário obrigatório ao % uma etapa', p_action;
  END IF;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  SELECT * INTO v_link FROM public.approval_magic_links
   WHERE token_hash = v_hash AND deleted_at IS NULL FOR UPDATE;
  IF v_link IS NULL THEN RAISE EXCEPTION 'Link não encontrado'; END IF;
  IF v_link.used_at IS NOT NULL THEN RAISE EXCEPTION 'Link já utilizado'; END IF;
  IF v_link.expires_at < now() THEN RAISE EXCEPTION 'Link expirado'; END IF;

  SELECT * INTO v_step FROM public.measurement_approval_steps WHERE id = v_link.step_id FOR UPDATE;
  IF v_step IS NULL THEN RAISE EXCEPTION 'Etapa não encontrada'; END IF;
  IF v_step.status <> 'pendente' THEN
    RAISE EXCEPTION 'Etapa já decidida (%)', v_step.status;
  END IF;

  -- Resolve o membro pelo e-mail do recipient (pode ser nulo se for terceiro)
  SELECT id INTO v_member
    FROM public.members
   WHERE tenant_id = v_link.tenant_id AND email = v_link.recipient_email AND active = true AND deleted_at IS NULL
   LIMIT 1;

  v_status := CASE p_action
    WHEN 'aprovar'  THEN 'aprovado'
    WHEN 'devolver' THEN 'devolvido'
    WHEN 'reprovar' THEN 'reprovado'
  END;

  -- Atualiza a etapa
  UPDATE public.measurement_approval_steps
     SET status = v_status,
         decided_at = now(),
         decided_by = v_member,
         decided_for = v_step.assigned_to,
         comment = p_comment,
         signature_method = COALESCE(p_signature_method, 'magic_link'),
         updated_at = now()
   WHERE id = v_step.id;

  -- Atualiza status da medição conforme a decisão
  IF p_action = 'reprovar' THEN
    UPDATE public.measurements SET status = 'cancelada', updated_at = now() WHERE id = v_step.measurement_id;
  ELSIF p_action = 'devolver' THEN
    UPDATE public.measurements SET status = 'devolvida', updated_at = now() WHERE id = v_step.measurement_id;
  ELSIF p_action = 'aprovar' THEN
    SELECT * INTO v_next_step
      FROM public.measurement_approval_steps
     WHERE measurement_id = v_step.measurement_id AND status = 'pendente'
     ORDER BY ordem LIMIT 1;
    IF v_next_step IS NULL THEN
      UPDATE public.measurements
         SET status = 'aprovada', data_aprovacao = now(), updated_at = now()
       WHERE id = v_step.measurement_id;
    END IF;
  END IF;

  -- Consome o link
  UPDATE public.approval_magic_links
     SET used_at = now(), updated_at = now()
   WHERE id = v_link.id;

  -- Audit
  INSERT INTO public.audit_log (tenant_id, actor_id, entity_type, entity_id, action, after_value)
  VALUES (v_link.tenant_id, v_member, 'measurement_approval_step', v_step.id, p_action || '_via_magic_link',
          jsonb_build_object('status', v_status, 'comment', p_comment,
                             'recipient_email', v_link.recipient_email,
                             'signature_method', COALESCE(p_signature_method, 'magic_link')));

  RETURN jsonb_build_object(
    'ok', true,
    'step_id', v_step.id,
    'new_status', v_status,
    'measurement_id', v_step.measurement_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.consume_magic_link(text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.consume_magic_link(text, text, text, text) TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- Helper: reordenar etapas de um template em batch (mantém ordens contíguas)
-- Recebe um array de UUIDs na ordem desejada.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_workflow_steps(
  p_template_id uuid,
  p_step_ids    uuid[]
) RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  i int;
  v_count int := 0;
BEGIN
  IF p_template_id IS NULL OR array_length(p_step_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'template_id e step_ids são obrigatórios';
  END IF;

  -- Evita ordens duplicadas durante o update: deslocar tudo pro alto primeiro
  UPDATE public.workflow_steps
     SET ordem = ordem + 1000, updated_at = now()
   WHERE template_id = p_template_id AND deleted_at IS NULL;

  FOR i IN 1 .. array_length(p_step_ids, 1) LOOP
    UPDATE public.workflow_steps
       SET ordem = i, updated_at = now()
     WHERE id = p_step_ids[i] AND template_id = p_template_id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reorder_workflow_steps(uuid, uuid[]) TO authenticated;
