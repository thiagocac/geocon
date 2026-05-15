-- =============================================================================
-- 013_sov_compare_and_copy_helpers — compare_sov_versions, copy_measurement_balance, copy_previous_measurement
-- (campos REAIS: measurement_items.quantidade_acumulada_antes / quantidade_acumulada_incl_periodo)
-- =============================================================================

-- Comparador item-a-item entre duas versões SOV (snapshot é jsonb array)
CREATE OR REPLACE FUNCTION public.compare_sov_versions(p_version_a uuid, p_version_b uuid)
RETURNS TABLE (
  codigo text,
  descricao text,
  unidade text,
  preco_unit_a numeric,
  preco_unit_b numeric,
  qtd_a numeric,
  qtd_b numeric,
  valor_a numeric,
  valor_b numeric,
  delta_valor numeric,
  delta_pct numeric,
  situacao text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_snap_a jsonb;
  v_snap_b jsonb;
BEGIN
  SELECT snapshot INTO v_snap_a FROM sov_versions WHERE id = p_version_a AND deleted_at IS NULL;
  SELECT snapshot INTO v_snap_b FROM sov_versions WHERE id = p_version_b AND deleted_at IS NULL;
  IF v_snap_a IS NULL OR v_snap_b IS NULL THEN
    RAISE EXCEPTION 'Versão A ou B não encontrada ou sem snapshot';
  END IF;

  RETURN QUERY
  WITH a AS (
    SELECT
      (i->>'codigo')::text AS codigo,
      (i->>'descricao')::text AS descricao,
      (i->>'unidade')::text AS unidade,
      NULLIF(i->>'quantidade', '')::numeric AS quantidade,
      NULLIF(i->>'preco_unitario', '')::numeric AS preco_unitario
    FROM jsonb_array_elements(v_snap_a) AS i
  ),
  b AS (
    SELECT
      (i->>'codigo')::text AS codigo,
      (i->>'descricao')::text AS descricao,
      (i->>'unidade')::text AS unidade,
      NULLIF(i->>'quantidade', '')::numeric AS quantidade,
      NULLIF(i->>'preco_unitario', '')::numeric AS preco_unitario
    FROM jsonb_array_elements(v_snap_b) AS i
  )
  SELECT
    coalesce(a.codigo, b.codigo),
    coalesce(a.descricao, b.descricao),
    coalesce(a.unidade, b.unidade),
    a.preco_unitario, b.preco_unitario,
    a.quantidade, b.quantidade,
    coalesce(a.quantidade * a.preco_unitario, 0) AS valor_a,
    coalesce(b.quantidade * b.preco_unitario, 0) AS valor_b,
    coalesce(b.quantidade * b.preco_unitario, 0) - coalesce(a.quantidade * a.preco_unitario, 0) AS delta_valor,
    CASE
      WHEN coalesce(a.quantidade * a.preco_unitario, 0) > 0
        THEN ((coalesce(b.quantidade * b.preco_unitario, 0) - coalesce(a.quantidade * a.preco_unitario, 0))
              / (a.quantidade * a.preco_unitario)) * 100
      ELSE NULL
    END AS delta_pct,
    CASE
      WHEN a.codigo IS NULL AND b.codigo IS NOT NULL THEN 'incluido'
      WHEN a.codigo IS NOT NULL AND b.codigo IS NULL THEN 'removido'
      WHEN coalesce(a.quantidade, 0) = coalesce(b.quantidade, 0)
       AND coalesce(a.preco_unitario, 0) = coalesce(b.preco_unitario, 0)
       THEN 'inalterado'
      ELSE 'alterado'
    END AS situacao
  FROM a
  FULL OUTER JOIN b ON a.codigo = b.codigo
  ORDER BY coalesce(a.codigo, b.codigo);
END;
$$;

-- Copia para a medição o saldo restante de cada item contratual
CREATE OR REPLACE FUNCTION public.copy_measurement_balance(p_measurement_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_contract_id uuid;
  v_status text;
  v_count int := 0;
BEGIN
  SELECT tenant_id, contract_id, status
  INTO v_tenant, v_contract_id, v_status
  FROM public.measurements WHERE id = p_measurement_id AND deleted_at IS NULL;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Medição não encontrada'; END IF;
  IF v_status NOT IN ('rascunho','preliminar','devolvida') THEN
    RAISE EXCEPTION 'Medição não permite edição (status: %)', v_status;
  END IF;

  INSERT INTO public.measurement_items (
    id, tenant_id, measurement_id, contract_item_id,
    quantidade_periodo, quantidade_acumulada_antes, quantidade_acumulada_incl_periodo,
    preco_unitario_snapshot, valor_periodo, validacao_status, created_at, updated_at
  )
  SELECT
    gen_random_uuid(), v_tenant, p_measurement_id, ci.id,
    GREATEST(coalesce(ci.quantidade_contratada, 0) + coalesce(ci.quantidade_aditada, 0) - coalesce(ci.quantidade_medida_acumulada, 0), 0) AS saldo,
    coalesce(ci.quantidade_medida_acumulada, 0),
    coalesce(ci.quantidade_medida_acumulada, 0) +
      GREATEST(coalesce(ci.quantidade_contratada, 0) + coalesce(ci.quantidade_aditada, 0) - coalesce(ci.quantidade_medida_acumulada, 0), 0),
    ci.preco_unitario,
    GREATEST(coalesce(ci.quantidade_contratada, 0) + coalesce(ci.quantidade_aditada, 0) - coalesce(ci.quantidade_medida_acumulada, 0), 0) * coalesce(ci.preco_unitario, 0),
    'pendente', now(), now()
  FROM public.contract_items ci
  WHERE ci.contract_id = v_contract_id
    AND ci.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.measurement_items mi
      WHERE mi.measurement_id = p_measurement_id AND mi.contract_item_id = ci.id
        AND mi.deleted_at IS NULL
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Copia para a medição as quantidades da medição imediatamente anterior
CREATE OR REPLACE FUNCTION public.copy_previous_measurement(p_measurement_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_contract_id uuid;
  v_status text;
  v_periodo_inicio date;
  v_prev_id uuid;
  v_count int := 0;
BEGIN
  SELECT tenant_id, contract_id, status, periodo_inicio
  INTO v_tenant, v_contract_id, v_status, v_periodo_inicio
  FROM public.measurements WHERE id = p_measurement_id AND deleted_at IS NULL;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Medição não encontrada'; END IF;
  IF v_status NOT IN ('rascunho','preliminar','devolvida') THEN
    RAISE EXCEPTION 'Medição não permite edição (status: %)', v_status;
  END IF;

  SELECT id INTO v_prev_id FROM public.measurements
  WHERE contract_id = v_contract_id
    AND deleted_at IS NULL
    AND status <> 'cancelada'
    AND periodo_fim < v_periodo_inicio
    AND id <> p_measurement_id
  ORDER BY periodo_fim DESC
  LIMIT 1;

  IF v_prev_id IS NULL THEN RAISE EXCEPTION 'Não há medição anterior para copiar'; END IF;

  INSERT INTO public.measurement_items (
    id, tenant_id, measurement_id, contract_item_id,
    quantidade_periodo, quantidade_acumulada_antes, quantidade_acumulada_incl_periodo,
    preco_unitario_snapshot, valor_periodo, validacao_status, created_at, updated_at
  )
  SELECT
    gen_random_uuid(), v_tenant, p_measurement_id, mi_prev.contract_item_id,
    mi_prev.quantidade_periodo,
    coalesce(mi_prev.quantidade_acumulada_incl_periodo, 0),
    coalesce(mi_prev.quantidade_acumulada_incl_periodo, 0) + coalesce(mi_prev.quantidade_periodo, 0),
    mi_prev.preco_unitario_snapshot,
    coalesce(mi_prev.quantidade_periodo, 0) * coalesce(mi_prev.preco_unitario_snapshot, 0),
    'pendente', now(), now()
  FROM public.measurement_items mi_prev
  WHERE mi_prev.measurement_id = v_prev_id
    AND mi_prev.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.measurement_items mi_curr
      WHERE mi_curr.measurement_id = p_measurement_id
        AND mi_curr.contract_item_id = mi_prev.contract_item_id
        AND mi_curr.deleted_at IS NULL
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compare_sov_versions(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copy_measurement_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copy_previous_measurement(uuid) TO authenticated;
