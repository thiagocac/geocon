-- =============================================================================
-- 038_bulk_reajuste
-- =============================================================================
-- (A) RPC list_reajuste_candidates — UI lista contratos elegíveis com simulação inline
-- (B) RPC bulk_simulate_reajuste — simula N contratos sem aplicar (preview agregado)
-- (C) RPC bulk_apply_reajuste — aplica em lote com flag global create_additive
-- =============================================================================

-- =============================================================================
-- (A) Candidatos elegíveis (extensão da v_contracts_due_reajuste pra ser mais flexível)
-- =============================================================================
-- Aceita filtros: window_days (próximos N dias), only_due (already eligible now),
-- index_id (restringe por índice), status (lista de status).
-- Retorna também valor_atual pra UI calcular impacto bruto sem N round-trips.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_reajuste_candidates(
  p_window_days int     DEFAULT 30,
  p_only_due    boolean DEFAULT false,    -- true = apenas vencidos hoje
  p_index_id    uuid    DEFAULT NULL
)
RETURNS TABLE (
  contract_id        uuid,
  contract_numero    text,
  objeto             text,
  status             text,
  valor_total_atual  numeric,
  rule_id            uuid,
  index_id           uuid,
  index_codigo       text,
  periodicidade_meses int,
  last_reference_date date,
  next_anniversary   date,
  is_due             boolean,
  events_count       int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      c.id                         AS contract_id,
      c.numero                     AS contract_numero,
      c.objeto,
      c.status::text               AS status,
      c.valor_total_atual,
      r.id                         AS rule_id,
      r.index_id,
      i.codigo                     AS index_codigo,
      r.periodicidade_meses,
      coalesce(
        (SELECT max(e.reference_date) FROM public.contract_reajuste_events e WHERE e.contract_id = c.id),
        r.data_base,
        c.data_inicio_prevista,
        c.data_assinatura
      ) AS last_reference_date,
      (SELECT count(*)::int FROM public.contract_reajuste_events e WHERE e.contract_id = c.id) AS events_count
    FROM public.contracts c
    JOIN public.contract_adjustment_rules r ON r.contract_id = c.id AND r.active = true AND r.deleted_at IS NULL
    JOIN public.adjustment_indices i ON i.id = r.index_id
    WHERE c.tenant_id = public.current_tenant_id()
      AND c.deleted_at IS NULL
      AND c.status IN ('contratado', 'em_execucao')
      AND (p_index_id IS NULL OR r.index_id = p_index_id)
  )
  SELECT
    b.contract_id, b.contract_numero, b.objeto, b.status, b.valor_total_atual,
    b.rule_id, b.index_id, b.index_codigo, b.periodicidade_meses,
    b.last_reference_date,
    (b.last_reference_date + make_interval(months => b.periodicidade_meses)::interval)::date AS next_anniversary,
    ((b.last_reference_date + make_interval(months => b.periodicidade_meses)::interval) <= now())::boolean AS is_due,
    b.events_count
  FROM base b
  WHERE
    -- Sem janela = só os que JÁ venceram. Com janela = vencidos OU vencendo em N dias.
    (
      (p_only_due AND (b.last_reference_date + make_interval(months => b.periodicidade_meses)::interval) <= now())
      OR
      (NOT p_only_due AND (b.last_reference_date + make_interval(months => b.periodicidade_meses)::interval)
         BETWEEN (now() - interval '30 days')::date AND (now() + (p_window_days || ' days')::interval)::date)
    )
  ORDER BY next_anniversary ASC;
$$;

GRANT EXECUTE ON FUNCTION public.list_reajuste_candidates(int, boolean, uuid) TO authenticated;

-- =============================================================================
-- (B) Simulação em lote — usado pelo modal de confirmação
-- =============================================================================
CREATE OR REPLACE FUNCTION public.bulk_simulate_reajuste(
  p_contract_ids uuid[],
  p_target_date  date DEFAULT NULL
)
RETURNS TABLE (
  contract_id      uuid,
  contract_numero  text,
  ok               boolean,
  error            text,
  factor           numeric,
  variation_percent numeric,
  value_before     numeric,
  value_after      numeric,
  delta            numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id   uuid;
  v_sim  jsonb;
  v_num  text;
BEGIN
  IF p_contract_ids IS NULL OR cardinality(p_contract_ids) = 0 THEN RETURN; END IF;
  IF cardinality(p_contract_ids) > 200 THEN
    RAISE EXCEPTION 'Máximo 200 contratos por simulação (recebido: %)', cardinality(p_contract_ids);
  END IF;

  FOREACH v_id IN ARRAY p_contract_ids LOOP
    SELECT numero INTO v_num FROM public.contracts WHERE id = v_id;

    BEGIN
      v_sim := public.simulate_contract_reajuste(v_id, p_target_date);
    EXCEPTION WHEN others THEN
      contract_id := v_id; contract_numero := v_num; ok := false; error := SQLERRM;
      factor := NULL; variation_percent := NULL; value_before := NULL; value_after := NULL; delta := NULL;
      RETURN NEXT;
      CONTINUE;
    END;

    contract_id       := v_id;
    contract_numero   := v_num;
    ok                := (v_sim->>'ok')::boolean;
    error             := v_sim->>'error';
    factor            := nullif(v_sim->>'factor', '')::numeric;
    variation_percent := nullif(v_sim->>'variation_percent', '')::numeric;
    value_before      := nullif(v_sim->>'value_before', '')::numeric;
    value_after       := nullif(v_sim->>'value_after', '')::numeric;
    delta             := nullif(v_sim->>'delta', '')::numeric;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_simulate_reajuste(uuid[], date) TO authenticated;

-- =============================================================================
-- (C) Aplicação em lote
-- =============================================================================
-- Cada contrato é independente — falha de um não bloqueia os outros.
-- Retorna lista detalhada do que aconteceu por contrato.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.bulk_apply_reajuste(
  p_contract_ids    uuid[],
  p_target_date     date    DEFAULT NULL,
  p_notes           text    DEFAULT NULL,
  p_create_additive boolean DEFAULT false
)
RETURNS TABLE (
  contract_id     uuid,
  contract_numero text,
  ok              boolean,
  error           text,
  event_id        uuid,
  additive_id     uuid,
  delta           numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     uuid;
  v_admin  boolean;
  v_result jsonb;
  v_num    text;
BEGIN
  SELECT (role = 'admin'
          OR 'admin'           = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_admin
  FROM public.members WHERE id = public.current_member_id();
  IF NOT v_admin THEN RAISE EXCEPTION 'Apenas administradores ou gestor de contrato'; END IF;

  IF p_contract_ids IS NULL OR cardinality(p_contract_ids) = 0 THEN RETURN; END IF;
  IF cardinality(p_contract_ids) > 100 THEN
    RAISE EXCEPTION 'Máximo 100 contratos por aplicação em lote (recebido: %)', cardinality(p_contract_ids);
  END IF;

  FOREACH v_id IN ARRAY p_contract_ids LOOP
    SELECT numero INTO v_num FROM public.contracts WHERE id = v_id;

    BEGIN
      v_result := public.apply_contract_reajuste(v_id, p_target_date, p_notes, p_create_additive);
      contract_id     := v_id;
      contract_numero := v_num;
      ok              := true;
      error           := NULL;
      event_id        := (v_result->>'event_id')::uuid;
      additive_id     := nullif(v_result->>'additive_id', '')::uuid;
      delta           := (v_result->>'delta')::numeric;
    EXCEPTION WHEN others THEN
      contract_id     := v_id;
      contract_numero := v_num;
      ok              := false;
      error           := SQLERRM;
      event_id        := NULL;
      additive_id     := NULL;
      delta           := NULL;
    END;

    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_apply_reajuste(uuid[], date, text, boolean) TO authenticated;
