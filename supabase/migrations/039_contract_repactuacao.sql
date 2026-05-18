-- =============================================================================
-- 039_contract_repactuacao
-- =============================================================================
-- Repactuação contratual (Lei 14.133 art. 135).
--
-- Diferença de reajuste:
--   * Reajuste usa índice externo (IPCA/IGP-M) → V30-V32
--   * Repactuação usa variação REAL de custos (planilha demonstrativa baseada
--     em CCT/convenção coletiva + insumos)
--
-- Decisão de design (vs reajuste):
--   * Reajuste: NÃO altera preços, registra só delta em event
--   * Repactuação: ATUALIZA preco_unitario dos itens afetados; medições
--     futuras pegam o novo automaticamente; audit completo via events + items
--
-- Schema:
--   - contract_repactuacao_events (snapshot agregado da operação)
--   - contract_repactuacao_items  (snapshot por item: preço anterior e novo)
-- =============================================================================

-- =============================================================================
-- (A) Tabela: events agregados de repactuação
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.contract_repactuacao_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id     uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  applied_by      uuid REFERENCES public.members(id),
  reference_date  date NOT NULL,                  -- data-base do CCT/convenção
  cct_reference   text,                           -- ex: "CCT 2025 SEAC-DF"
  motivacao       text NOT NULL,                  -- justificativa (cláusula 14.133 art. 135 §2º)
  delta_total     numeric(18,2) NOT NULL,         -- soma agregada
  items_affected  int NOT NULL DEFAULT 0,
  value_before    numeric(18,2) NOT NULL,
  value_after     numeric(18,2) NOT NULL,
  variation_percent numeric(10,4) NOT NULL,
  notes           text,
  metadata        jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repact_events_contract
  ON public.contract_repactuacao_events (contract_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_repact_events_tenant
  ON public.contract_repactuacao_events (tenant_id);

ALTER TABLE public.contract_repactuacao_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repact_events_select ON public.contract_repactuacao_events;
CREATE POLICY repact_events_select ON public.contract_repactuacao_events
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS repact_events_admin_write ON public.contract_repactuacao_events;
CREATE POLICY repact_events_admin_write ON public.contract_repactuacao_events
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin'
             OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'gestor_contrato' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  );

-- =============================================================================
-- (B) Tabela: items repactuados (1 row por item alterado)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.contract_repactuacao_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                 uuid NOT NULL REFERENCES public.contract_repactuacao_events(id) ON DELETE CASCADE,
  tenant_id                uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id                  uuid NOT NULL REFERENCES public.contract_items(id) ON DELETE CASCADE,
  preco_unitario_anterior  numeric(18,6) NOT NULL,
  preco_unitario_novo      numeric(18,6) NOT NULL,
  delta_unitario           numeric(18,6) NOT NULL,
  quantidade_referencia    numeric(18,6) NOT NULL,
  delta_total_item         numeric(18,2) NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_repact_items_event ON public.contract_repactuacao_items (event_id);
CREATE INDEX IF NOT EXISTS idx_repact_items_item  ON public.contract_repactuacao_items (item_id);

ALTER TABLE public.contract_repactuacao_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repact_items_select ON public.contract_repactuacao_items;
CREATE POLICY repact_items_select ON public.contract_repactuacao_items
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS repact_items_admin_write ON public.contract_repactuacao_items;
CREATE POLICY repact_items_admin_write ON public.contract_repactuacao_items
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin'
             OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'gestor_contrato' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  );

-- =============================================================================
-- (C.1) RPC list_repactuacao_candidates — itens da SOV pra UI editar preços
--
-- Retorna todos os itens NÃO-título do contrato com preço atual e quantidade.
-- UI mostra grid editável: admin altera apenas os itens que quer repactuar,
-- deixa os outros com preço novo = preço atual (delta zero).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_repactuacao_candidates(p_contract_id uuid)
RETURNS TABLE (
  item_id              uuid,
  codigo               text,
  descricao            text,
  unidade              text,
  quantidade_total     numeric,
  preco_unitario_atual numeric,
  subtotal             numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.id,
    i.codigo,
    i.descricao,
    i.unidade,
    (coalesce(i.quantidade_contratada, 0) + coalesce(i.quantidade_aditada, 0)) AS quantidade_total,
    i.preco_unitario,
    round((coalesce(i.quantidade_contratada, 0) + coalesce(i.quantidade_aditada, 0)) * i.preco_unitario, 2) AS subtotal
  FROM public.contract_items i
  WHERE i.contract_id = p_contract_id
    AND i.tenant_id = public.current_tenant_id()
    AND i.is_title = false
    AND i.active = true
  ORDER BY i.ordem, i.codigo;
$$;

GRANT EXECUTE ON FUNCTION public.list_repactuacao_candidates(uuid) TO authenticated;

-- =============================================================================
-- (C.2) RPC simulate_repactuacao — calcula impacto sem aplicar
--
-- Input: jsonb array [{item_id, preco_novo}]
-- Retorna jsonb agregado:
--   { ok, items_affected, items_unchanged, total_delta, value_before, value_after,
--     variation_percent, items:[{item_id, codigo, qty, preco_anterior, preco_novo,
--                                 delta_unitario, delta_total}] }
-- =============================================================================
CREATE OR REPLACE FUNCTION public.simulate_repactuacao(
  p_contract_id uuid,
  p_items       jsonb     -- [{item_id: uuid, preco_novo: numeric}]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant         uuid;
  v_contract       record;
  v_input          record;
  v_item           record;
  v_delta_total    numeric := 0;
  v_value_before   numeric := 0;
  v_items_affected int := 0;
  v_items_arr      jsonb := '[]'::jsonb;
  v_qty            numeric;
  v_delta_unitario numeric;
  v_delta_item     numeric;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT id, numero, valor_inicial, valor_total_atual
  INTO v_contract
  FROM public.contracts
  WHERE id = p_contract_id AND tenant_id = v_tenant;
  IF v_contract IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nenhum item informado');
  END IF;

  v_value_before := v_contract.valor_total_atual;

  -- Itera input, valida cada item, computa delta
  FOR v_input IN
    SELECT * FROM jsonb_to_recordset(p_items) AS x(item_id uuid, preco_novo numeric)
  LOOP
    SELECT id, codigo, descricao, unidade, preco_unitario,
           (coalesce(quantidade_contratada, 0) + coalesce(quantidade_aditada, 0)) AS qty
    INTO v_item
    FROM public.contract_items
    WHERE id = v_input.item_id
      AND contract_id = p_contract_id
      AND tenant_id = v_tenant
      AND is_title = false
      AND active = true;

    IF v_item IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', format('Item %s não encontrado ou inativo', v_input.item_id)
      );
    END IF;

    IF v_input.preco_novo IS NULL OR v_input.preco_novo < 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', format('Preço novo do item %s inválido', v_item.codigo)
      );
    END IF;

    v_qty            := v_item.qty;
    v_delta_unitario := v_input.preco_novo - v_item.preco_unitario;
    v_delta_item     := round(v_qty * v_delta_unitario, 2);

    IF abs(v_delta_unitario) > 0 THEN
      v_items_affected := v_items_affected + 1;
      v_delta_total    := v_delta_total + v_delta_item;

      v_items_arr := v_items_arr || jsonb_build_object(
        'item_id',          v_item.id,
        'codigo',           v_item.codigo,
        'descricao',        v_item.descricao,
        'unidade',          v_item.unidade,
        'quantidade',       v_qty,
        'preco_anterior',   v_item.preco_unitario,
        'preco_novo',       v_input.preco_novo,
        'delta_unitario',   v_delta_unitario,
        'delta_total',      v_delta_item
      );
    END IF;
  END LOOP;

  IF v_items_affected = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Nenhum item teve preço alterado',
      'value_before', v_value_before
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',                true,
    'items_affected',    v_items_affected,
    'items_unchanged',   jsonb_array_length(p_items) - v_items_affected,
    'value_before',      v_value_before,
    'value_after',       round(v_value_before + v_delta_total, 2),
    'total_delta',       v_delta_total,
    'variation_percent', CASE WHEN v_value_before > 0 THEN round((v_delta_total / v_value_before) * 100, 4) ELSE 0 END,
    'items',             v_items_arr
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.simulate_repactuacao(uuid, jsonb) TO authenticated;

-- =============================================================================
-- (C.3) RPC apply_repactuacao — efetiva (event + items + UPDATE preços)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.apply_repactuacao(
  p_contract_id    uuid,
  p_items          jsonb,    -- [{item_id, preco_novo}]
  p_reference_date date,
  p_motivacao      text,
  p_cct_reference  text DEFAULT NULL,
  p_notes          text DEFAULT NULL
)
RETURNS jsonb     -- { event_id, items_affected, delta_total, value_after }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant       uuid;
  v_member       uuid;
  v_can_write    boolean;
  v_sim          jsonb;
  v_event_id     uuid;
  v_item         jsonb;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();

  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_can_write
  FROM public.members WHERE id = v_member;
  IF NOT v_can_write THEN
    RAISE EXCEPTION 'Apenas administradores ou gestor de contrato podem aplicar repactuação';
  END IF;

  IF p_motivacao IS NULL OR length(trim(p_motivacao)) < 10 THEN
    RAISE EXCEPTION 'Motivação obrigatória (mínimo 10 caracteres) — Lei 14.133 art. 135 §2º';
  END IF;
  IF p_reference_date IS NULL THEN
    RAISE EXCEPTION 'Data-base de referência obrigatória (data do CCT/convenção)';
  END IF;

  -- Simula (reaproveita validação completa)
  v_sim := public.simulate_repactuacao(p_contract_id, p_items);
  IF NOT (v_sim->>'ok')::boolean THEN
    RAISE EXCEPTION 'Repactuação não pode ser aplicada: %', v_sim->>'error';
  END IF;

  -- Cria event agregado
  INSERT INTO public.contract_repactuacao_events (
    tenant_id, contract_id, applied_by, reference_date, cct_reference,
    motivacao, delta_total, items_affected, value_before, value_after,
    variation_percent, notes
  )
  VALUES (
    v_tenant, p_contract_id, v_member, p_reference_date, p_cct_reference,
    trim(p_motivacao),
    (v_sim->>'total_delta')::numeric,
    (v_sim->>'items_affected')::int,
    (v_sim->>'value_before')::numeric,
    (v_sim->>'value_after')::numeric,
    (v_sim->>'variation_percent')::numeric,
    p_notes
  )
  RETURNING id INTO v_event_id;

  -- Cria rows de items + atualiza preços
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_sim->'items')
  LOOP
    INSERT INTO public.contract_repactuacao_items (
      event_id, tenant_id, item_id,
      preco_unitario_anterior, preco_unitario_novo,
      delta_unitario, quantidade_referencia, delta_total_item
    )
    VALUES (
      v_event_id, v_tenant, (v_item->>'item_id')::uuid,
      (v_item->>'preco_anterior')::numeric, (v_item->>'preco_novo')::numeric,
      (v_item->>'delta_unitario')::numeric, (v_item->>'quantidade')::numeric,
      (v_item->>'delta_total')::numeric
    );

    -- ATUALIZA preço unitário do item (medições futuras pegam o novo)
    UPDATE public.contract_items
       SET preco_unitario = (v_item->>'preco_novo')::numeric,
           metadata = coalesce(metadata, '{}'::jsonb) ||
                      jsonb_build_object(
                        'last_repactuacao_at', now(),
                        'last_repactuacao_event_id', v_event_id
                      ),
           updated_at = now()
     WHERE id = (v_item->>'item_id')::uuid
       AND tenant_id = v_tenant;
  END LOOP;

  RETURN jsonb_build_object(
    'event_id',       v_event_id,
    'items_affected', (v_sim->>'items_affected')::int,
    'delta_total',    (v_sim->>'total_delta')::numeric,
    'value_after',    (v_sim->>'value_after')::numeric
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_repactuacao(uuid, jsonb, date, text, text, text) TO authenticated;

-- =============================================================================
-- (C.4) RPC list_contract_repactuacoes — histórico
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_contract_repactuacoes(p_contract_id uuid)
RETURNS TABLE (
  id                uuid,
  applied_at        timestamptz,
  applied_by        uuid,
  applied_by_nome   text,
  reference_date    date,
  cct_reference     text,
  motivacao         text,
  delta_total       numeric,
  items_affected    int,
  value_before      numeric,
  value_after       numeric,
  variation_percent numeric,
  notes             text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id, e.applied_at, e.applied_by,
    m.nome AS applied_by_nome,
    e.reference_date, e.cct_reference, e.motivacao,
    e.delta_total, e.items_affected,
    e.value_before, e.value_after, e.variation_percent,
    e.notes
  FROM public.contract_repactuacao_events e
  LEFT JOIN public.members m ON m.id = e.applied_by
  WHERE e.contract_id = p_contract_id
    AND e.tenant_id = public.current_tenant_id()
  ORDER BY e.applied_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_contract_repactuacoes(uuid) TO authenticated;

-- =============================================================================
-- (C.5) RPC get_repactuacao_event_items — detalhe expandido de 1 event
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_repactuacao_event_items(p_event_id uuid)
RETURNS TABLE (
  item_id                 uuid,
  codigo                  text,
  descricao               text,
  unidade                 text,
  preco_unitario_anterior numeric,
  preco_unitario_novo     numeric,
  delta_unitario          numeric,
  quantidade_referencia   numeric,
  delta_total_item        numeric,
  variation_percent       numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ri.item_id,
    ci.codigo,
    ci.descricao,
    ci.unidade,
    ri.preco_unitario_anterior,
    ri.preco_unitario_novo,
    ri.delta_unitario,
    ri.quantidade_referencia,
    ri.delta_total_item,
    CASE WHEN ri.preco_unitario_anterior > 0
         THEN round((ri.delta_unitario / ri.preco_unitario_anterior) * 100, 4)
         ELSE 0
    END AS variation_percent
  FROM public.contract_repactuacao_items ri
  JOIN public.contract_items ci ON ci.id = ri.item_id
  WHERE ri.event_id = p_event_id
    AND ri.tenant_id = public.current_tenant_id()
  ORDER BY ci.ordem, ci.codigo;
$$;

GRANT EXECUTE ON FUNCTION public.get_repactuacao_event_items(uuid) TO authenticated;

-- =============================================================================
-- (C.6) RPC get_contract_repactuacao_summary — KPIs pra aba
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_contract_repactuacao_summary(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant     uuid;
  v_contract   record;
  v_count      int;
  v_total      numeric;
  v_last_at    timestamptz;
  v_last_delta numeric;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT id, numero, valor_inicial, valor_total_atual
  INTO v_contract
  FROM public.contracts
  WHERE id = p_contract_id AND tenant_id = v_tenant;
  IF v_contract IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  SELECT count(*), coalesce(sum(delta_total), 0)
  INTO v_count, v_total
  FROM public.contract_repactuacao_events
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant;

  SELECT applied_at, delta_total
  INTO v_last_at, v_last_delta
  FROM public.contract_repactuacao_events
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant
  ORDER BY applied_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'contract_id',         p_contract_id,
    'contract_numero',     v_contract.numero,
    'valor_inicial',       v_contract.valor_inicial,
    'valor_total_atual',   v_contract.valor_total_atual,
    'events_count',        v_count,
    'total_repactuado',    v_total,
    'last_applied_at',     v_last_at,
    'last_delta',          v_last_delta,
    'percent_sobre_inicial', CASE
      WHEN v_contract.valor_inicial > 0
      THEN round((v_total / v_contract.valor_inicial) * 100, 4)
      ELSE 0
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_contract_repactuacao_summary(uuid) TO authenticated;
