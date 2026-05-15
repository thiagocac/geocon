-- =============================================================================
-- 017_payment_workflow_status — register_payment_event + bulk_decide + workflow_status view
-- =============================================================================

-- Registra um evento de pagamento para uma medição (aprovada/paga)
CREATE OR REPLACE FUNCTION public.register_payment_event(
  p_measurement_id uuid,
  p_valor_pago numeric,
  p_data_pagamento date,
  p_numero_ordem_bancaria text DEFAULT NULL,
  p_nota_fiscal text DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_m record;
  v_event_id uuid;
  v_total_pago numeric;
BEGIN
  SELECT * INTO v_m FROM public.measurements WHERE id = p_measurement_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medição não encontrada'; END IF;
  IF v_m.status NOT IN ('aprovada','paga') THEN
    RAISE EXCEPTION 'Pagamento só pode ser registrado em medições aprovadas/pagas (atual: %)', v_m.status;
  END IF;
  IF p_valor_pago <= 0 THEN RAISE EXCEPTION 'valor_pago deve ser > 0'; END IF;

  v_event_id := gen_random_uuid();
  INSERT INTO public.measurement_payment_events (
    id, tenant_id, measurement_id, valor_pago, data_pagamento,
    numero_ordem_bancaria, nota_fiscal, observacao, created_at
  ) VALUES (
    v_event_id, v_m.tenant_id, p_measurement_id, p_valor_pago, p_data_pagamento,
    p_numero_ordem_bancaria, p_nota_fiscal, p_observacao, now()
  );

  -- Se o total pago atingir valor_liquido, marca como paga
  SELECT coalesce(sum(valor_pago), 0) INTO v_total_pago
  FROM public.measurement_payment_events
  WHERE measurement_id = p_measurement_id AND deleted_at IS NULL;

  IF v_total_pago >= coalesce(v_m.valor_liquido, 0) AND v_m.status <> 'paga' THEN
    UPDATE public.measurements SET status = 'paga', data_pagamento = p_data_pagamento, updated_at = now()
    WHERE id = p_measurement_id;
  END IF;

  RETURN v_event_id;
END;
$$;

-- Decide múltiplos steps de aprovação (mesmo membro, mesma ação)
CREATE OR REPLACE FUNCTION public.bulk_decide_approval_steps(
  p_step_ids uuid[],
  p_action text,
  p_comment text DEFAULT NULL,
  p_signature_method text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_step uuid;
  v_processed int := 0;
  v_failed int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  IF coalesce(array_length(p_step_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Nenhum step informado'; END IF;
  FOREACH v_step IN ARRAY p_step_ids LOOP
    BEGIN
      PERFORM public.decide_approval_step(v_step, p_action, p_comment, p_signature_method);
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('step_id', v_step, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'failed', v_failed, 'errors', v_errors);
END;
$$;

-- View do status do workflow de uma medição
CREATE OR REPLACE VIEW public.v_measurement_workflow_status AS
WITH steps AS (
  SELECT
    mas.measurement_id,
    count(*) AS total_steps,
    count(*) FILTER (WHERE mas.status = 'aprovado') AS approved_steps,
    count(*) FILTER (WHERE mas.status = 'pendente') AS pending_steps,
    count(*) FILTER (WHERE mas.status = 'devolvido') AS returned_steps,
    count(*) FILTER (WHERE mas.status = 'reprovado') AS rejected_steps,
    min(CASE WHEN mas.status = 'pendente' THEN mas.ordem ELSE NULL END) AS next_step_ordem,
    min(CASE WHEN mas.status = 'pendente' THEN mas.due_at ELSE NULL END) AS next_step_due_at
  FROM public.measurement_approval_steps mas
  WHERE mas.deleted_at IS NULL
  GROUP BY mas.measurement_id
)
SELECT
  m.id AS measurement_id,
  m.tenant_id,
  m.contract_id,
  m.status AS measurement_status,
  coalesce(s.total_steps, 0) AS total_steps,
  coalesce(s.approved_steps, 0) AS approved_steps,
  coalesce(s.pending_steps, 0) AS pending_steps,
  coalesce(s.returned_steps, 0) AS returned_steps,
  coalesce(s.rejected_steps, 0) AS rejected_steps,
  CASE WHEN coalesce(s.total_steps, 0) > 0
       THEN round(coalesce(s.approved_steps, 0)::numeric / s.total_steps::numeric * 100, 1)
       ELSE 0
  END AS pct_concluido,
  s.next_step_ordem,
  s.next_step_due_at,
  CASE
    WHEN s.next_step_due_at IS NULL THEN 'sem_sla'
    WHEN s.next_step_due_at < now() THEN 'atrasado'
    WHEN s.next_step_due_at < now() + interval '24 hours' THEN 'urgente'
    ELSE 'no_prazo'
  END AS proximo_step_sla
FROM public.measurements m
LEFT JOIN steps s ON s.measurement_id = m.id
WHERE m.deleted_at IS NULL;

GRANT SELECT ON public.v_measurement_workflow_status TO authenticated;

GRANT EXECUTE ON FUNCTION public.register_payment_event(uuid, numeric, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_decide_approval_steps(uuid[], text, text, text) TO authenticated;
