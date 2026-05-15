-- =============================================================================
-- 015_measurement_lifecycle_rpcs — boletim complementar, retificação e cancelamento
-- (schema REAL: complementar_numero default 0 — sem nullability)
-- =============================================================================
-- Nota: o índice unique measurements_contract_numero_unique já existe em 001
-- com (contract_id, numero, complementar_numero) WHERE deleted_at IS NULL.

-- 1) create_complementar_measurement
CREATE OR REPLACE FUNCTION public.create_complementar_measurement(
  p_parent_id uuid,
  p_periodo_inicio date,
  p_periodo_fim date,
  p_observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_parent record;
  v_max_compl int;
  v_new_id uuid;
BEGIN
  SELECT * INTO v_parent FROM public.measurements WHERE id = p_parent_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medição pai não encontrada'; END IF;
  IF v_parent.status NOT IN ('emitida','aprovada','paga') THEN
    RAISE EXCEPTION 'Apenas medições emitidas/aprovadas/pagas podem gerar complementar (atual: %)', v_parent.status;
  END IF;
  IF p_periodo_fim < p_periodo_inicio THEN
    RAISE EXCEPTION 'Período fim deve ser maior ou igual ao início';
  END IF;

  SELECT coalesce(max(complementar_numero), 0)
  INTO v_max_compl
  FROM public.measurements
  WHERE contract_id = v_parent.contract_id AND numero = v_parent.numero AND deleted_at IS NULL;

  v_new_id := gen_random_uuid();
  INSERT INTO public.measurements (
    id, tenant_id, contract_id, sov_version_id,
    numero, complementar_numero,
    tipo, status, periodo_inicio, periodo_fim,
    parent_measurement_id, snapshot,
    created_at, updated_at
  ) VALUES (
    v_new_id, v_parent.tenant_id, v_parent.contract_id, v_parent.sov_version_id,
    v_parent.numero, v_max_compl + 1,
    v_parent.tipo, 'rascunho', p_periodo_inicio, p_periodo_fim,
    p_parent_id,
    jsonb_build_object(
      'origin', 'complementar',
      'parent_numero', v_parent.numero,
      'parent_id', p_parent_id,
      'observacao', p_observacao,
      'created_at', now()
    ),
    now(), now()
  );

  RETURN v_new_id;
END;
$$;

-- 2) create_retificacao_measurement (campos REAIS: quantidade_acumulada_antes/incl_periodo)
CREATE OR REPLACE FUNCTION public.create_retificacao_measurement(
  p_parent_id uuid,
  p_justificativa text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_parent record;
  v_max_compl int;
  v_new_id uuid;
  v_itens_copiados int;
BEGIN
  SELECT * INTO v_parent FROM public.measurements WHERE id = p_parent_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medição pai não encontrada'; END IF;
  IF v_parent.status NOT IN ('emitida','aprovada','paga') THEN
    RAISE EXCEPTION 'Apenas medições emitidas/aprovadas/pagas podem ser retificadas (atual: %)', v_parent.status;
  END IF;
  IF coalesce(length(trim(p_justificativa)), 0) < 10 THEN
    RAISE EXCEPTION 'Justificativa obrigatória (mínimo 10 caracteres)';
  END IF;

  SELECT coalesce(max(complementar_numero), 0)
  INTO v_max_compl
  FROM public.measurements
  WHERE contract_id = v_parent.contract_id AND numero = v_parent.numero AND deleted_at IS NULL;

  v_new_id := gen_random_uuid();
  INSERT INTO public.measurements (
    id, tenant_id, contract_id, sov_version_id,
    numero, complementar_numero,
    tipo, status, periodo_inicio, periodo_fim,
    parent_measurement_id, snapshot,
    created_at, updated_at
  ) VALUES (
    v_new_id, v_parent.tenant_id, v_parent.contract_id, v_parent.sov_version_id,
    v_parent.numero, v_max_compl + 1,
    v_parent.tipo, 'rascunho', v_parent.periodo_inicio, v_parent.periodo_fim,
    p_parent_id,
    jsonb_build_object(
      'origin', 'retificacao',
      'parent_numero', v_parent.numero,
      'parent_id', p_parent_id,
      'justificativa', trim(p_justificativa),
      'created_at', now()
    ),
    now(), now()
  );

  -- Copia todos os items do pai zerando glosas e validação
  INSERT INTO public.measurement_items (
    id, tenant_id, measurement_id, contract_item_id,
    quantidade_periodo, quantidade_acumulada_antes, quantidade_acumulada_incl_periodo,
    preco_unitario_snapshot, valor_periodo, valor_glosado, valor_liquido,
    validacao_status, created_at, updated_at
  )
  SELECT
    gen_random_uuid(), v_parent.tenant_id, v_new_id, mi.contract_item_id,
    mi.quantidade_periodo,
    coalesce(mi.quantidade_acumulada_antes, 0),
    coalesce(mi.quantidade_acumulada_incl_periodo, mi.quantidade_periodo),
    mi.preco_unitario_snapshot,
    coalesce(mi.quantidade_periodo, 0) * coalesce(mi.preco_unitario_snapshot, 0),
    0,
    coalesce(mi.quantidade_periodo, 0) * coalesce(mi.preco_unitario_snapshot, 0),
    'pendente', now(), now()
  FROM public.measurement_items mi
  WHERE mi.measurement_id = p_parent_id AND mi.deleted_at IS NULL;

  GET DIAGNOSTICS v_itens_copiados = ROW_COUNT;

  -- Marca pai como retificada
  UPDATE public.measurements
  SET status = 'retificada',
      snapshot = coalesce(snapshot, '{}'::jsonb) || jsonb_build_object('retificada_por', v_new_id, 'retificada_em', now()),
      updated_at = now()
  WHERE id = p_parent_id;

  -- Snapshot da filha com a contagem
  UPDATE public.measurements
  SET snapshot = snapshot || jsonb_build_object('itens_copiados', v_itens_copiados)
  WHERE id = v_new_id;

  RETURN v_new_id;
END;
$$;

-- 3) cancel_measurement
CREATE OR REPLACE FUNCTION public.cancel_measurement(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.measurements WHERE id = p_id AND deleted_at IS NULL;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Medição não encontrada'; END IF;
  IF v_status IN ('aprovada','paga','cancelada','retificada') THEN
    RAISE EXCEPTION 'Medição não pode ser cancelada (status: %)', v_status;
  END IF;
  IF coalesce(length(trim(p_motivo)), 0) < 5 THEN
    RAISE EXCEPTION 'Motivo obrigatório (mínimo 5 caracteres)';
  END IF;

  UPDATE public.measurements
  SET status = 'cancelada',
      snapshot = coalesce(snapshot, '{}'::jsonb) || jsonb_build_object(
        'cancelamento', jsonb_build_object('motivo', trim(p_motivo), 'cancelled_at', now())
      ),
      updated_at = now()
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_complementar_measurement(uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_retificacao_measurement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_measurement(uuid, text) TO authenticated;
