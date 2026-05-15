-- =============================================================================
-- 011_financial_panels — adiciona coluna quantidade_medida_acumulada,
-- reimplementa recalc_financial_snapshot, cria ensure_schedule_periods e views
-- v_curva_s + v_financial_trend alinhadas com as interfaces TS.
-- =============================================================================

-- Adiciona coluna contract_items.quantidade_medida_acumulada
-- (a tabela base não tinha — antes era computada on-the-fly)
ALTER TABLE public.contract_items
  ADD COLUMN IF NOT EXISTS quantidade_medida_acumulada numeric(18,6) DEFAULT 0;

-- Garante períodos de cronograma (1 por mês entre data_ordem_inicio e fim)
CREATE OR REPLACE FUNCTION public.ensure_schedule_periods(p_contract_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_inicio date;
  v_fim date;
  v_cur date;
  v_ord int := 1;
  v_created int := 0;
BEGIN
  SELECT tenant_id, data_ordem_inicio,
         coalesce(
           data_ordem_inicio + (prazo_execucao_dias || ' days')::interval,
           data_ordem_inicio + interval '12 months'
         )::date
  INTO v_tenant, v_inicio, v_fim
  FROM public.contracts WHERE id = p_contract_id AND deleted_at IS NULL;

  IF v_tenant IS NULL OR v_inicio IS NULL THEN RETURN 0; END IF;

  v_cur := date_trunc('month', v_inicio)::date;
  WHILE v_cur <= v_fim LOOP
    INSERT INTO public.schedule_periods (
      id, tenant_id, contract_id, periodo, label, ordem, created_at, updated_at
    )
    SELECT gen_random_uuid(), v_tenant, p_contract_id, v_cur,
           to_char(v_cur, 'TMMon/YY'), v_ord, now(), now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.schedule_periods
      WHERE contract_id = p_contract_id AND periodo = v_cur AND deleted_at IS NULL
    );
    IF FOUND THEN v_created := v_created + 1; END IF;
    v_cur := (v_cur + interval '1 month')::date;
    v_ord := v_ord + 1;
  END LOOP;

  RETURN v_created;
END;
$$;

-- Recalcula snapshot financeiro com cálculos efetivos
CREATE OR REPLACE FUNCTION public.recalc_financial_snapshot(p_contract_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_inicio date;
  v_fim date;
  v_valor_inicial numeric;
  v_valor_aditado numeric;
  v_valor_atual numeric;
  v_total_medido_acum numeric;
  v_total_medido_mes numeric;
  v_total_pago numeric;
  v_total_retencoes numeric;
  v_total_glosas numeric;
  v_total_reajustes numeric;
  v_pct_financeiro numeric;
  v_pct_fisico numeric;
  v_pct_temporal numeric;
  v_media_mensal numeric;
  v_meses_decorridos numeric;
  v_forecast_3 numeric;
  v_forecast_6 numeric;
  v_forecast_12 numeric;
  v_risk_flags jsonb := '[]'::jsonb;
  v_saldo numeric;
  v_aprov_pendentes int;
  v_snap_id uuid;
BEGIN
  SELECT tenant_id, data_ordem_inicio,
         coalesce(data_ordem_inicio + (prazo_execucao_dias || ' days')::interval,
                  data_ordem_inicio + interval '12 months')::date,
         coalesce(valor_inicial, 0)
  INTO v_tenant, v_inicio, v_fim, v_valor_inicial
  FROM public.contracts WHERE id = p_contract_id AND deleted_at IS NULL;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;

  -- Aditivos aprovados (campos REAIS: valor_acrescimo, valor_decrescimo)
  SELECT coalesce(sum(valor_acrescimo - valor_decrescimo), 0)
  INTO v_valor_aditado
  FROM public.additives
  WHERE contract_id = p_contract_id AND status IN ('aprovado','incorporado');

  v_valor_atual := v_valor_inicial + coalesce(v_valor_aditado, 0);

  -- Agregados das medições (campos REAIS: valor_liquido, valor_retido, valor_glosado, valor_reajustado)
  SELECT
    coalesce(sum(CASE WHEN status IN ('emitida','aprovada','paga') THEN valor_liquido ELSE 0 END), 0),
    coalesce(sum(CASE WHEN status IN ('emitida','aprovada','paga')
                       AND date_trunc('month', periodo_fim) = date_trunc('month', CURRENT_DATE)
                      THEN valor_liquido ELSE 0 END), 0),
    coalesce(sum(valor_retido), 0),
    coalesce(sum(valor_glosado), 0),
    coalesce(sum(valor_reajustado), 0)
  INTO v_total_medido_acum, v_total_medido_mes, v_total_retencoes, v_total_glosas, v_total_reajustes
  FROM public.measurements
  WHERE contract_id = p_contract_id AND deleted_at IS NULL AND status <> 'cancelada';

  -- Total pago
  SELECT coalesce(sum(valor_pago), 0) INTO v_total_pago
  FROM public.measurement_payment_events mpe
  JOIN public.measurements m ON m.id = mpe.measurement_id
  WHERE m.contract_id = p_contract_id AND mpe.deleted_at IS NULL;

  -- % físico ponderado por preço × qtd executada (usa coluna recém-criada)
  WITH it AS (
    SELECT
      coalesce(ci.preco_unitario, 0) AS pu,
      coalesce(ci.quantidade_contratada, 0) + coalesce(ci.quantidade_aditada, 0) AS qtd_total,
      coalesce(ci.quantidade_medida_acumulada, 0) AS qtd_acum
    FROM public.contract_items ci
    WHERE ci.contract_id = p_contract_id AND ci.deleted_at IS NULL
  )
  SELECT
    CASE WHEN sum(pu * qtd_total) > 0
         THEN sum(pu * qtd_acum) / sum(pu * qtd_total) * 100
         ELSE 0
    END
  INTO v_pct_fisico FROM it;

  v_pct_financeiro := CASE WHEN v_valor_atual > 0 THEN v_total_medido_acum / v_valor_atual * 100 ELSE 0 END;
  v_pct_temporal := CASE
    WHEN v_fim > v_inicio AND CURRENT_DATE BETWEEN v_inicio AND v_fim THEN
      (CURRENT_DATE - v_inicio)::numeric / GREATEST((v_fim - v_inicio), 1)::numeric * 100
    WHEN CURRENT_DATE > v_fim THEN 100
    ELSE 0
  END;

  v_saldo := v_valor_atual - v_total_medido_acum;
  v_meses_decorridos := GREATEST(
    EXTRACT(EPOCH FROM (CURRENT_DATE - v_inicio)::interval) / (30.4375 * 86400),
    1
  );
  v_media_mensal := v_total_medido_acum / v_meses_decorridos;
  v_forecast_3  := LEAST(v_media_mensal * 3,  GREATEST(v_saldo, 0));
  v_forecast_6  := LEAST(v_media_mensal * 6,  GREATEST(v_saldo, 0));
  v_forecast_12 := LEAST(v_media_mensal * 12, GREATEST(v_saldo, 0));

  -- Risk flags estruturadas
  IF v_pct_financeiro >= 100 THEN
    v_risk_flags := v_risk_flags || jsonb_build_object('code','saldo_zerado','severity','high','message','Saldo contratual esgotado');
  ELSIF v_pct_financeiro >= 95 THEN
    v_risk_flags := v_risk_flags || jsonb_build_object('code','saldo_critico','severity','high','message','Saldo abaixo de 5%');
  ELSIF v_pct_financeiro >= 80 THEN
    v_risk_flags := v_risk_flags || jsonb_build_object('code','saldo_atencao','severity','medium','message','Saldo abaixo de 20%');
  END IF;
  IF v_pct_temporal - v_pct_fisico > 20 THEN
    v_risk_flags := v_risk_flags || jsonb_build_object('code','atraso_fisico','severity','high','message','Atraso físico > 20pp do cronograma');
  ELSIF v_pct_temporal - v_pct_fisico > 10 THEN
    v_risk_flags := v_risk_flags || jsonb_build_object('code','desaceleracao','severity','medium','message','Tendência de desaceleração física');
  END IF;
  SELECT count(*) INTO v_aprov_pendentes
  FROM public.measurements m
  JOIN public.measurement_approval_steps mas ON mas.measurement_id = m.id
  WHERE m.contract_id = p_contract_id AND mas.status = 'pendente'
    AND mas.created_at < now() - interval '15 days';
  IF v_aprov_pendentes > 0 THEN
    v_risk_flags := v_risk_flags || jsonb_build_object('code','aprovacao_pendente','severity','medium',
      'message','Existem ' || v_aprov_pendentes || ' aprovações pendentes > 15 dias');
  END IF;
  IF v_total_medido_acum > 0 AND v_total_glosas / v_total_medido_acum > 0.10 THEN
    v_risk_flags := v_risk_flags || jsonb_build_object('code','glosas_altas','severity','medium','message','Glosas > 10% do medido');
  END IF;

  -- Soft-delete snapshot do mesmo mês
  UPDATE public.contract_financial_snapshots
  SET deleted_at = now()
  WHERE contract_id = p_contract_id
    AND deleted_at IS NULL
    AND date_trunc('month', generated_at) = date_trunc('month', now());

  v_snap_id := gen_random_uuid();
  INSERT INTO public.contract_financial_snapshots (
    id, tenant_id, contract_id, reference_date,
    valor_inicial, valor_aditado, valor_total_atual,
    valor_medido_mes, valor_medido_acumulado, valor_reajustado_acumulado,
    total_retencoes, total_glosas, total_pago, saldo_contratual,
    percentual_fisico, percentual_financeiro,
    forecast_3m, forecast_6m, forecast_12m,
    risk_flags, generated_at, created_at, updated_at
  ) VALUES (
    v_snap_id, v_tenant, p_contract_id, CURRENT_DATE,
    v_valor_inicial, v_valor_aditado, v_valor_atual,
    v_total_medido_mes, v_total_medido_acum, v_total_reajustes,
    v_total_retencoes, v_total_glosas, v_total_pago, v_saldo,
    coalesce(v_pct_fisico, 0), coalesce(v_pct_financeiro, 0),
    v_forecast_3, v_forecast_6, v_forecast_12,
    v_risk_flags, now(), now(), now()
  );

  RETURN v_snap_id;
END;
$$;

-- View Curva S — campos: contract_id, mes, valor_realizado_mes/acumulado, valor_previsto_mes/acumulado
CREATE OR REPLACE VIEW public.v_curva_s AS
WITH realizado AS (
  SELECT
    m.contract_id,
    date_trunc('month', m.periodo_fim)::date AS mes,
    sum(m.valor_liquido) FILTER (WHERE m.status IN ('emitida','aprovada','paga')) AS valor_mes
  FROM public.measurements m
  WHERE m.deleted_at IS NULL AND m.status <> 'cancelada'
  GROUP BY m.contract_id, date_trunc('month', m.periodo_fim)
),
realizado_acc AS (
  SELECT
    contract_id, mes, coalesce(valor_mes, 0) AS valor_realizado_mes,
    sum(coalesce(valor_mes, 0)) OVER (PARTITION BY contract_id ORDER BY mes) AS valor_realizado_acumulado
  FROM realizado
),
previsto AS (
  SELECT
    sp.contract_id,
    sp.periodo AS mes,
    coalesce(sum(pfs.valor_previsto), 0) AS valor_previsto_mes
  FROM public.schedule_periods sp
  LEFT JOIN public.physical_financial_schedule pfs
         ON pfs.schedule_period_id = sp.id AND pfs.deleted_at IS NULL
  WHERE sp.deleted_at IS NULL
  GROUP BY sp.contract_id, sp.periodo
),
previsto_acc AS (
  SELECT
    contract_id, mes, valor_previsto_mes,
    sum(valor_previsto_mes) OVER (PARTITION BY contract_id ORDER BY mes) AS valor_previsto_acumulado
  FROM previsto
)
SELECT
  coalesce(r.contract_id, p.contract_id) AS contract_id,
  coalesce(r.mes, p.mes)::text AS mes,
  coalesce(r.valor_realizado_mes, 0) AS valor_realizado_mes,
  coalesce(r.valor_realizado_acumulado, 0) AS valor_realizado_acumulado,
  coalesce(p.valor_previsto_mes, 0) AS valor_previsto_mes,
  coalesce(p.valor_previsto_acumulado, 0) AS valor_previsto_acumulado
FROM realizado_acc r
FULL OUTER JOIN previsto_acc p
  ON p.contract_id = r.contract_id AND p.mes = r.mes
ORDER BY contract_id, mes;

GRANT SELECT ON public.v_curva_s TO authenticated;

-- View tendência financeira — passthrough do snapshot com sort
CREATE OR REPLACE VIEW public.v_financial_trend AS
SELECT
  id, tenant_id, contract_id, reference_date,
  valor_inicial, valor_aditado, valor_total_atual,
  valor_medido_mes, valor_medido_acumulado, valor_reajustado_acumulado,
  total_retencoes, total_glosas, total_pago, saldo_contratual,
  percentual_fisico, percentual_financeiro,
  forecast_3m, forecast_6m, forecast_12m,
  risk_flags, generated_at, created_at
FROM public.contract_financial_snapshots
WHERE deleted_at IS NULL
ORDER BY contract_id, reference_date;

GRANT SELECT ON public.v_financial_trend TO authenticated;

GRANT EXECUTE ON FUNCTION public.ensure_schedule_periods(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_financial_snapshot(uuid) TO authenticated;
