-- =============================================================================
-- 016_submit_measurement_and_report_views — submit RPC + views agregadas
-- (alinhado com schema real: measurement_glosses sem campo `tipo`, additives.valor_decrescimo)
-- =============================================================================

-- RPC: submete uma medição
CREATE OR REPLACE FUNCTION public.submit_measurement(p_measurement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_m record;
  v_items_count int;
  v_pending_validations int;
  v_blocked int;
  v_steps_count int := 0;
BEGIN
  SELECT * INTO v_m FROM public.measurements WHERE id = p_measurement_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medição não encontrada'; END IF;
  IF v_m.status NOT IN ('rascunho','preliminar','devolvida') THEN
    RAISE EXCEPTION 'Medição não pode ser submetida (status: %)', v_m.status;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE validacao_status = 'pendente'),
         count(*) FILTER (WHERE validacao_status = 'bloqueado')
  INTO v_items_count, v_pending_validations, v_blocked
  FROM public.measurement_items
  WHERE measurement_id = p_measurement_id AND deleted_at IS NULL;

  IF v_items_count = 0 THEN RAISE EXCEPTION 'Medição sem itens — adicione antes de submeter'; END IF;
  IF v_blocked > 0 THEN RAISE EXCEPTION '% item(ns) bloqueado(s). Resolva antes de submeter.', v_blocked; END IF;

  -- Instancia workflow (tolerante: se não houver template, segue sem steps)
  BEGIN
    SELECT public.instantiate_measurement_workflow(p_measurement_id, NULL) INTO v_steps_count;
  EXCEPTION WHEN OTHERS THEN
    v_steps_count := 0;
  END;

  UPDATE public.measurements
  SET status = 'em_aprovacao',
      data_emissao = CURRENT_DATE,
      updated_at = now()
  WHERE id = p_measurement_id;

  RETURN jsonb_build_object(
    'measurement_id', p_measurement_id,
    'new_status', 'em_aprovacao',
    'data_emissao', CURRENT_DATE,
    'items', v_items_count,
    'pending_validations', v_pending_validations,
    'workflow_steps_created', v_steps_count
  );
END;
$$;

-- View: Carteira (1 linha por contrato com KPIs)
CREATE OR REPLACE VIEW public.v_report_portfolio AS
SELECT
  c.tenant_id, c.id AS contract_id, c.numero, c.objeto, c.status,
  c.valor_inicial,
  coalesce((SELECT sum(valor_acrescimo - valor_decrescimo)
            FROM public.additives WHERE contract_id = c.id AND status IN ('aprovado','incorporado') AND deleted_at IS NULL), 0) AS valor_aditado,
  c.valor_total_atual AS valor_atual,
  coalesce((SELECT sum(valor_liquido) FILTER (WHERE status IN ('emitida','aprovada','paga'))
            FROM public.measurements WHERE contract_id = c.id AND deleted_at IS NULL), 0) AS total_medido,
  coalesce((SELECT sum(mpe.valor_pago)
            FROM public.measurement_payment_events mpe
            JOIN public.measurements m ON m.id = mpe.measurement_id
            WHERE m.contract_id = c.id AND mpe.deleted_at IS NULL), 0) AS total_pago,
  c.data_ordem_inicio,
  coalesce(c.data_ordem_inicio + (c.prazo_execucao_dias || ' days')::interval,
           c.data_ordem_inicio + interval '12 months')::date AS data_fim_prevista,
  (SELECT percentual_fisico FROM public.contract_financial_snapshots
   WHERE contract_id = c.id AND deleted_at IS NULL ORDER BY generated_at DESC LIMIT 1) AS pct_fisico,
  (SELECT percentual_financeiro FROM public.contract_financial_snapshots
   WHERE contract_id = c.id AND deleted_at IS NULL ORDER BY generated_at DESC LIMIT 1) AS pct_financeiro,
  (SELECT risk_flags FROM public.contract_financial_snapshots
   WHERE contract_id = c.id AND deleted_at IS NULL ORDER BY generated_at DESC LIMIT 1) AS risk_flags
FROM public.contracts c
WHERE c.deleted_at IS NULL;

GRANT SELECT ON public.v_report_portfolio TO authenticated;

-- View: Pendências detalhadas (passthrough)
CREATE OR REPLACE VIEW public.v_report_pendencies AS
SELECT
  tenant_id, contract_id, contract_numero,
  pendencia_tipo, entity_id, descricao,
  desde, dias_aberta, severidade
FROM public.v_pendencias;

GRANT SELECT ON public.v_report_pendencies TO authenticated;

-- View: Curva-S com info do contrato
CREATE OR REPLACE VIEW public.v_report_curva_s AS
SELECT
  c.tenant_id,
  v.contract_id,
  c.numero AS contract_numero,
  v.mes,
  v.valor_previsto_mes,
  v.valor_previsto_acumulado,
  v.valor_realizado_mes,
  v.valor_realizado_acumulado,
  v.valor_realizado_acumulado - v.valor_previsto_acumulado AS desvio_acum
FROM public.v_curva_s v
JOIN public.contracts c ON c.id = v.contract_id
WHERE c.deleted_at IS NULL;

GRANT SELECT ON public.v_report_curva_s TO authenticated;

-- View: Glosas detalhadas (sem campo `tipo` — measurement_glosses não tem essa coluna)
CREATE OR REPLACE VIEW public.v_report_glosses AS
SELECT
  g.tenant_id,
  g.id AS gloss_id,
  m.contract_id,
  c.numero AS contract_numero,
  g.measurement_id,
  m.numero AS measurement_numero,
  m.complementar_numero,
  g.measurement_item_id,
  ci.codigo AS item_codigo,
  ci.descricao AS item_descricao,
  CASE WHEN g.measurement_item_id IS NULL THEN 'geral' ELSE 'especifica' END AS escopo,
  g.valor_glosado,
  g.quantidade_glosada,
  g.status,
  g.justificativa,
  g.decided_at,
  g.created_at
FROM public.measurement_glosses g
JOIN public.measurements m ON m.id = g.measurement_id
JOIN public.contracts c ON c.id = m.contract_id
LEFT JOIN public.measurement_items mi ON mi.id = g.measurement_item_id
LEFT JOIN public.contract_items ci ON ci.id = mi.contract_item_id
WHERE m.deleted_at IS NULL AND c.deleted_at IS NULL AND g.deleted_at IS NULL;

GRANT SELECT ON public.v_report_glosses TO authenticated;

GRANT EXECUTE ON FUNCTION public.submit_measurement(uuid) TO authenticated;
