-- =============================================================================
-- 036_contract_reajuste
-- =============================================================================
-- Reajuste contratual (Lei 14.133 art. 25, 92, 124-127).
--
-- Schema existente:
--   - adjustment_indices             — índices disponíveis (IPCA/IGP-M/INCC/SINAPI)
--   - contract_adjustment_rules      — regra por contrato (índice, data-base, periodicidade)
--
-- Acréscimos V30:
--   (A) adjustment_index_values      — série temporal mensal de cada índice
--   (B) contract_reajuste_events     — audit trail das aplicações de reajuste
--   (C) RPCs: list/upsert valores, compute_reajuste_factor, apply_reajuste, simulate
-- =============================================================================

-- =============================================================================
-- (A) Série temporal de valores dos índices
-- =============================================================================
-- Convenção: index_value é o ÍNDICE ACUMULADO (não a variação mensal).
-- IGP-M FGV publica como "índice base agosto/1994=100"; assumimos esse padrão.
-- Variação no período = (Ifim / Iinicio) - 1.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.adjustment_index_values (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  index_id        uuid NOT NULL REFERENCES public.adjustment_indices(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reference_month date NOT NULL,           -- 1º dia do mês (ex: 2025-03-01)
  index_value     numeric(14,6) NOT NULL CHECK (index_value > 0),
  source          text,                    -- 'manual' | 'fgv-csv' | 'ibge-api' | etc
  published_at    timestamptz,
  recorded_by     uuid REFERENCES public.members(id),
  metadata        jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (index_id, reference_month)
);

CREATE INDEX IF NOT EXISTS idx_adjustment_index_values_month
  ON public.adjustment_index_values (index_id, reference_month DESC);
CREATE INDEX IF NOT EXISTS idx_adjustment_index_values_tenant
  ON public.adjustment_index_values (tenant_id);

-- Trigger pra normalizar reference_month pro 1º dia do mês
CREATE OR REPLACE FUNCTION public.trg_normalize_index_ref_month()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.reference_month := date_trunc('month', NEW.reference_month)::date;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_index_ref_month ON public.adjustment_index_values;
CREATE TRIGGER trg_normalize_index_ref_month
BEFORE INSERT OR UPDATE ON public.adjustment_index_values
FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_index_ref_month();

-- RLS
ALTER TABLE public.adjustment_index_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS index_values_select ON public.adjustment_index_values;
CREATE POLICY index_values_select ON public.adjustment_index_values
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS index_values_admin_write ON public.adjustment_index_values;
CREATE POLICY index_values_admin_write ON public.adjustment_index_values
  FOR ALL TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin' OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin' OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  );

-- =============================================================================
-- (B) Audit trail de aplicações de reajuste
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.contract_reajuste_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id         uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  rule_id             uuid NOT NULL REFERENCES public.contract_adjustment_rules(id),
  applied_at          timestamptz NOT NULL DEFAULT now(),
  applied_by          uuid REFERENCES public.members(id),
  base_date           date NOT NULL,        -- data-base do contrato (ou último reajuste)
  reference_date      date NOT NULL,        -- mês de referência usado pra Ifim
  index_value_base    numeric(14,6) NOT NULL,
  index_value_ref     numeric(14,6) NOT NULL,
  factor              numeric(14,8) NOT NULL,    -- Ifim / Iinicio
  variation_percent   numeric(10,4) NOT NULL,    -- (factor - 1) * 100
  value_before        numeric(18,2) NOT NULL,
  value_after         numeric(18,2) NOT NULL,
  delta               numeric(18,2) NOT NULL,    -- value_after - value_before
  notes               text,
  metadata            jsonb DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reajuste_events_contract
  ON public.contract_reajuste_events (contract_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_reajuste_events_tenant
  ON public.contract_reajuste_events (tenant_id);

ALTER TABLE public.contract_reajuste_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reajuste_events_select ON public.contract_reajuste_events;
CREATE POLICY reajuste_events_select ON public.contract_reajuste_events
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS reajuste_events_admin_write ON public.contract_reajuste_events;
CREATE POLICY reajuste_events_admin_write ON public.contract_reajuste_events
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
-- (C.1) RPC: list_index_values — UI consome série temporal
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_index_values(
  p_index_id uuid,
  p_from     date DEFAULT NULL,
  p_to       date DEFAULT NULL
)
RETURNS TABLE (
  id              uuid,
  reference_month date,
  index_value     numeric,
  source          text,
  published_at    timestamptz,
  recorded_by     uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, reference_month, index_value, source, published_at, recorded_by
  FROM public.adjustment_index_values
  WHERE index_id = p_index_id
    AND tenant_id = public.current_tenant_id()
    AND (p_from IS NULL OR reference_month >= p_from)
    AND (p_to   IS NULL OR reference_month <= p_to)
  ORDER BY reference_month DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_index_values(uuid, date, date) TO authenticated;

-- =============================================================================
-- (C.2) RPC: upsert_index_value
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_index_value(
  p_index_id        uuid,
  p_reference_month date,
  p_index_value     numeric,
  p_source          text DEFAULT 'manual',
  p_published_at    timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_admin  boolean;
  v_id     uuid;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))) INTO v_admin
    FROM public.members WHERE id = public.current_member_id();
  IF NOT v_admin THEN RAISE EXCEPTION 'Apenas administradores'; END IF;

  IF p_index_value <= 0 THEN
    RAISE EXCEPTION 'Valor do índice deve ser positivo';
  END IF;

  INSERT INTO public.adjustment_index_values (
    index_id, tenant_id, reference_month, index_value, source, published_at, recorded_by
  )
  VALUES (
    p_index_id, v_tenant, p_reference_month, p_index_value, coalesce(p_source, 'manual'),
    coalesce(p_published_at, now()), public.current_member_id()
  )
  ON CONFLICT (index_id, reference_month) DO UPDATE
    SET index_value  = EXCLUDED.index_value,
        source       = EXCLUDED.source,
        published_at = EXCLUDED.published_at,
        recorded_by  = EXCLUDED.recorded_by,
        updated_at   = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_index_value(uuid, date, numeric, text, timestamptz) TO authenticated;

-- =============================================================================
-- (C.3) RPC: get_index_value_for_month — pega o valor M-1 (mês anterior fechado)
-- pra ser usado na fórmula de reajuste. Em práticas brasileiras, o índice de
-- aniversário é o do MÊS ANTERIOR ao aniversário (data-base).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_index_value_for_month(
  p_index_id uuid,
  p_target   date
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value numeric;
  v_month date;
BEGIN
  -- Mês anterior ao alvo (convenção: índice publicado no mês X reflete movimento de X-1)
  v_month := (date_trunc('month', p_target) - interval '1 month')::date;

  SELECT index_value INTO v_value
  FROM public.adjustment_index_values
  WHERE index_id = p_index_id
    AND tenant_id = public.current_tenant_id()
    AND reference_month = v_month
  LIMIT 1;

  RETURN v_value;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_index_value_for_month(uuid, date) TO authenticated;

-- =============================================================================
-- (C.4) RPC: simulate_contract_reajuste — calcula sem aplicar
-- Usa a regra ativa do contrato; falha se não houver regra ou se faltar
-- valor do índice em algum dos meses-chave.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.simulate_contract_reajuste(
  p_contract_id uuid,
  p_target_date date DEFAULT NULL  -- default = today
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant       uuid;
  v_contract     record;
  v_rule         record;
  v_last_event   record;
  v_base_date    date;
  v_target       date;
  v_value_base   numeric;
  v_value_ref    numeric;
  v_factor       numeric;
  v_variation    numeric;
  v_value_before numeric;
  v_value_after  numeric;
  v_ok           boolean := true;
  v_error        text;
BEGIN
  v_tenant := public.current_tenant_id();
  v_target := coalesce(p_target_date, current_date);

  SELECT id, numero, valor_total_atual, data_inicio_prevista, data_assinatura
  INTO v_contract
  FROM public.contracts
  WHERE id = p_contract_id AND tenant_id = v_tenant AND deleted_at IS NULL;
  IF v_contract IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  SELECT r.*, i.codigo AS index_codigo, i.nome AS index_nome
  INTO v_rule
  FROM public.contract_adjustment_rules r
  JOIN public.adjustment_indices i ON i.id = r.index_id
  WHERE r.contract_id = p_contract_id
    AND r.tenant_id = v_tenant
    AND r.active = true
    AND r.deleted_at IS NULL
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_rule IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Nenhuma regra de reajuste ativa pra este contrato',
      'value_before', v_contract.valor_total_atual
    );
  END IF;

  -- Base date: último reajuste OU data-base da regra OU data_inicio do contrato
  SELECT * INTO v_last_event
  FROM public.contract_reajuste_events
  WHERE contract_id = p_contract_id
    AND tenant_id = v_tenant
  ORDER BY applied_at DESC
  LIMIT 1;

  v_base_date := coalesce(
    v_last_event.reference_date,
    v_rule.data_base,
    v_contract.data_inicio_prevista,
    v_contract.data_assinatura
  );

  IF v_base_date IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Data-base do contrato não definida (preencha data_base na regra ou data_inicio_prevista)',
      'value_before', v_contract.valor_total_atual
    );
  END IF;

  -- Verifica periodicidade: alvo precisa estar >= base + periodicidade_meses
  IF v_target < (v_base_date + (v_rule.periodicidade_meses || ' months')::interval)::date THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format(
        'Reajuste ainda não cumpre interregno mínimo de %s meses (data-base: %s, próximo aniversário: %s)',
        v_rule.periodicidade_meses,
        v_base_date,
        (v_base_date + (v_rule.periodicidade_meses || ' months')::interval)::date
      ),
      'value_before', v_contract.valor_total_atual,
      'base_date', v_base_date,
      'next_anniversary', (v_base_date + (v_rule.periodicidade_meses || ' months')::interval)::date
    );
  END IF;

  -- Resolve valores do índice
  v_value_base := public.get_index_value_for_month(v_rule.index_id, v_base_date);
  v_value_ref  := public.get_index_value_for_month(v_rule.index_id, v_target);

  IF v_value_base IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Valor do índice %s não cadastrado para o mês anterior a %s', v_rule.index_codigo, v_base_date),
      'base_date', v_base_date,
      'reference_date', v_target,
      'value_before', v_contract.valor_total_atual
    );
  END IF;
  IF v_value_ref IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Valor do índice %s não cadastrado para o mês anterior a %s', v_rule.index_codigo, v_target),
      'base_date', v_base_date,
      'reference_date', v_target,
      'value_before', v_contract.valor_total_atual
    );
  END IF;

  v_factor       := v_value_ref / v_value_base;
  v_variation    := (v_factor - 1) * 100;
  v_value_before := v_contract.valor_total_atual;
  v_value_after  := round(v_value_before * v_factor, 2);

  RETURN jsonb_build_object(
    'ok',                true,
    'rule_id',           v_rule.id,
    'index_codigo',      v_rule.index_codigo,
    'index_nome',        v_rule.index_nome,
    'formula',           v_rule.formula,
    'periodicidade_meses', v_rule.periodicidade_meses,
    'base_date',         v_base_date,
    'reference_date',    v_target,
    'index_value_base',  v_value_base,
    'index_value_ref',   v_value_ref,
    'factor',            v_factor,
    'variation_percent', v_variation,
    'value_before',      v_value_before,
    'value_after',       v_value_after,
    'delta',             v_value_after - v_value_before
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.simulate_contract_reajuste(uuid, date) TO authenticated;

-- =============================================================================
-- (C.5) RPC: apply_contract_reajuste — grava evento + atualiza valor_inicial
--
-- DESIGN DECISION: gravar como evento de auditoria + NÃO mexer em valor_inicial
-- (que é o valor da assinatura original, imutável). O valor_total_atual já é
-- generated (valor_inicial + valor_aditado). Reajuste vai ser tratado como
-- AJUSTE separado — adicionado a valor_aditado via um aditivo automático ou
-- mantido apenas como informação em contract_reajuste_events.
--
-- V30 MVP: apenas grava o evento. UI mostra valor_total_atual + soma dos
-- reajustes aplicados como "valor reajustado". Cria aditivo automático fica
-- como V31+.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.apply_contract_reajuste(
  p_contract_id uuid,
  p_target_date date DEFAULT NULL,
  p_notes       text DEFAULT NULL
)
RETURNS uuid  -- event_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   uuid;
  v_member   uuid;
  v_admin    boolean;
  v_sim      jsonb;
  v_event_id uuid;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();
  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_admin
  FROM public.members WHERE id = v_member;
  IF NOT v_admin THEN RAISE EXCEPTION 'Apenas administradores ou gestor de contrato'; END IF;

  -- Simula primeiro (reusa a lógica)
  v_sim := public.simulate_contract_reajuste(p_contract_id, p_target_date);

  IF NOT (v_sim->>'ok')::boolean THEN
    RAISE EXCEPTION 'Reajuste não pode ser aplicado: %', v_sim->>'error';
  END IF;

  INSERT INTO public.contract_reajuste_events (
    tenant_id, contract_id, rule_id, applied_at, applied_by,
    base_date, reference_date,
    index_value_base, index_value_ref,
    factor, variation_percent,
    value_before, value_after, delta, notes
  )
  VALUES (
    v_tenant, p_contract_id, (v_sim->>'rule_id')::uuid, now(), v_member,
    (v_sim->>'base_date')::date, (v_sim->>'reference_date')::date,
    (v_sim->>'index_value_base')::numeric, (v_sim->>'index_value_ref')::numeric,
    (v_sim->>'factor')::numeric, (v_sim->>'variation_percent')::numeric,
    (v_sim->>'value_before')::numeric, (v_sim->>'value_after')::numeric,
    (v_sim->>'delta')::numeric, p_notes
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_contract_reajuste(uuid, date, text) TO authenticated;

-- =============================================================================
-- (C.6) RPC: list_contract_reajustes — histórico do contrato
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_contract_reajustes(p_contract_id uuid)
RETURNS TABLE (
  id                 uuid,
  applied_at         timestamptz,
  applied_by         uuid,
  applied_by_nome    text,
  base_date          date,
  reference_date     date,
  index_codigo       text,
  factor             numeric,
  variation_percent  numeric,
  value_before       numeric,
  value_after        numeric,
  delta              numeric,
  notes              text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id, e.applied_at, e.applied_by,
    m.nome AS applied_by_nome,
    e.base_date, e.reference_date,
    i.codigo AS index_codigo,
    e.factor, e.variation_percent,
    e.value_before, e.value_after, e.delta,
    e.notes
  FROM public.contract_reajuste_events e
  JOIN public.contract_adjustment_rules r ON r.id = e.rule_id
  JOIN public.adjustment_indices i ON i.id = r.index_id
  LEFT JOIN public.members m ON m.id = e.applied_by
  WHERE e.contract_id = p_contract_id
    AND e.tenant_id = public.current_tenant_id()
  ORDER BY e.applied_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_contract_reajustes(uuid) TO authenticated;

-- =============================================================================
-- (C.7) RPC: upsert_contract_adjustment_rule — UI configura regra
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_contract_adjustment_rule(
  p_id                  uuid,        -- NULL pra create
  p_contract_id         uuid,
  p_index_id            uuid,
  p_formula             text,
  p_data_base           date,
  p_periodicidade_meses int  DEFAULT 12,
  p_carencia_meses      int  DEFAULT 12,
  p_active              boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_admin  boolean;
  v_id     uuid;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_admin
  FROM public.members WHERE id = public.current_member_id();
  IF NOT v_admin THEN RAISE EXCEPTION 'Apenas administradores ou gestor de contrato'; END IF;

  IF p_periodicidade_meses < 1 OR p_periodicidade_meses > 60 THEN
    RAISE EXCEPTION 'Periodicidade deve estar entre 1 e 60 meses';
  END IF;
  IF p_formula IS NULL OR length(trim(p_formula)) < 3 THEN
    RAISE EXCEPTION 'Fórmula é obrigatória (cláusula contratual)';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.contract_adjustment_rules (
      tenant_id, contract_id, index_id, formula, data_base,
      periodicidade_meses, carencia_meses, active
    )
    VALUES (
      v_tenant, p_contract_id, p_index_id, trim(p_formula), p_data_base,
      p_periodicidade_meses, p_carencia_meses, p_active
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.contract_adjustment_rules
       SET index_id            = p_index_id,
           formula             = trim(p_formula),
           data_base           = p_data_base,
           periodicidade_meses = p_periodicidade_meses,
           carencia_meses      = p_carencia_meses,
           active              = p_active,
           updated_at          = now()
     WHERE id = p_id
       AND tenant_id = v_tenant
       AND deleted_at IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Regra não encontrada'; END IF;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_contract_adjustment_rule(uuid, uuid, uuid, text, date, int, int, boolean) TO authenticated;

-- =============================================================================
-- (C.8) RPC: get_contract_reajuste_summary — UI consume na aba Reajustes
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_contract_reajuste_summary(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant      uuid;
  v_contract    record;
  v_rule        record;
  v_count       int;
  v_total_delta numeric;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT id, numero, valor_inicial, valor_total_atual, data_inicio_prevista, data_assinatura
  INTO v_contract
  FROM public.contracts
  WHERE id = p_contract_id AND tenant_id = v_tenant;
  IF v_contract IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;

  SELECT r.id, r.formula, r.data_base, r.periodicidade_meses, r.carencia_meses, r.active,
         i.id AS index_id, i.codigo AS index_codigo, i.nome AS index_nome
  INTO v_rule
  FROM public.contract_adjustment_rules r
  JOIN public.adjustment_indices i ON i.id = r.index_id
  WHERE r.contract_id = p_contract_id
    AND r.tenant_id = v_tenant
    AND r.active = true
    AND r.deleted_at IS NULL
  ORDER BY r.created_at DESC
  LIMIT 1;

  SELECT count(*), coalesce(sum(delta), 0)
  INTO v_count, v_total_delta
  FROM public.contract_reajuste_events
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant;

  RETURN jsonb_build_object(
    'contract_id',        p_contract_id,
    'contract_numero',    v_contract.numero,
    'valor_inicial',      v_contract.valor_inicial,
    'valor_total_atual',  v_contract.valor_total_atual,
    'total_reajustado',   v_total_delta,
    'events_count',       v_count,
    'rule', CASE
      WHEN v_rule IS NULL THEN NULL::jsonb
      ELSE jsonb_build_object(
        'id',                  v_rule.id,
        'formula',             v_rule.formula,
        'data_base',           v_rule.data_base,
        'periodicidade_meses', v_rule.periodicidade_meses,
        'carencia_meses',      v_rule.carencia_meses,
        'active',              v_rule.active,
        'index_id',            v_rule.index_id,
        'index_codigo',        v_rule.index_codigo,
        'index_nome',          v_rule.index_nome
      )
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_contract_reajuste_summary(uuid) TO authenticated;
