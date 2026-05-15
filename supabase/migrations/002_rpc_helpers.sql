-- geoCon RPCs, views e helpers operacionais

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE notifications SET read_at = now()
  WHERE id = p_id AND recipient_id = public.current_member_id();
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE notifications SET read_at = now()
  WHERE recipient_id = public.current_member_id() AND read_at IS NULL AND deleted_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_contract_balance(p_contract_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  SELECT jsonb_build_object(
    'contract_id', c.id,
    'valor_inicial', c.valor_inicial,
    'valor_aditado', c.valor_aditado,
    'valor_total_atual', c.valor_total_atual,
    'valor_medido_acumulado', COALESCE(SUM(m.valor_liquido) FILTER (WHERE m.status <> 'cancelada'),0),
    'valor_pago', COALESCE(SUM(p.valor_pago),0),
    'saldo_contratual', c.valor_total_atual - COALESCE(SUM(m.valor_liquido) FILTER (WHERE m.status <> 'cancelada'),0)
  ) INTO r
  FROM contracts c
  LEFT JOIN measurements m ON m.contract_id = c.id AND m.deleted_at IS NULL
  LEFT JOIN measurement_payment_events p ON p.measurement_id = m.id AND p.deleted_at IS NULL
  WHERE c.id = p_contract_id AND c.deleted_at IS NULL
  GROUP BY c.id;
  RETURN COALESCE(r,'{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_measurement_period(
  p_contract_id uuid,
  p_periodo_inicio date DEFAULT CURRENT_DATE,
  p_periodo_fim date DEFAULT (CURRENT_DATE + interval '30 days')::date,
  p_tipo text DEFAULT 'mensal_quantitativo'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_contract contracts%ROWTYPE;
  v_sov sov_versions%ROWTYPE;
  v_id uuid;
  v_num int;
  v_step record;
BEGIN
  SELECT * INTO v_contract FROM contracts WHERE id = p_contract_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;

  SELECT * INTO v_sov FROM sov_versions
  WHERE contract_id = p_contract_id AND deleted_at IS NULL AND status IN ('vigente','em_revisao','rascunho')
  ORDER BY CASE status WHEN 'vigente' THEN 0 WHEN 'em_revisao' THEN 1 WHEN 'rascunho' THEN 2 ELSE 3 END, numero DESC
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato sem planilha SOV'; END IF;

  SELECT COALESCE(MAX(numero),0)+1 INTO v_num FROM measurements WHERE contract_id = p_contract_id AND deleted_at IS NULL;

  INSERT INTO measurements(tenant_id, contract_id, sov_version_id, numero, tipo, periodo_inicio, periodo_fim, status, snapshot, created_by)
  VALUES(v_contract.tenant_id, p_contract_id, v_sov.id, v_num, p_tipo, p_periodo_inicio, p_periodo_fim, 'rascunho', jsonb_build_object('sov_version_id',v_sov.id,'sov_numero',v_sov.numero), public.current_member_id())
  RETURNING id INTO v_id;

  INSERT INTO measurement_items(tenant_id, measurement_id, contract_item_id, quantidade_periodo, quantidade_acumulada_antes, quantidade_acumulada_incl_periodo, preco_unitario_snapshot, valor_periodo, valor_liquido, saldo_disponivel_snapshot)
  SELECT ci.tenant_id, v_id, ci.id, 0,
         COALESCE(prev.qtd,0), COALESCE(prev.qtd,0), ci.preco_unitario, 0, 0,
         (ci.quantidade_contratada + ci.quantidade_aditada - COALESCE(prev.qtd,0))
  FROM contract_items ci
  LEFT JOIN LATERAL (
    SELECT SUM(mi.quantidade_periodo) AS qtd
    FROM measurement_items mi
    JOIN measurements m ON m.id = mi.measurement_id
    WHERE mi.contract_item_id = ci.id AND mi.deleted_at IS NULL AND m.deleted_at IS NULL AND m.status <> 'cancelada'
  ) prev ON true
  WHERE ci.sov_version_id = v_sov.id AND ci.deleted_at IS NULL AND ci.active = true AND ci.is_title = false;

  FOR v_step IN
    SELECT ws.* FROM workflow_templates wt JOIN workflow_steps ws ON ws.template_id = wt.id
    WHERE wt.tenant_id = v_contract.tenant_id AND wt.entity_type = 'measurement' AND wt.active = true AND wt.deleted_at IS NULL AND ws.deleted_at IS NULL
      AND (wt.contract_id = p_contract_id OR wt.contract_id IS NULL)
    ORDER BY CASE WHEN wt.contract_id = p_contract_id THEN 0 ELSE 1 END, ws.ordem
  LOOP
    INSERT INTO measurement_approval_steps(tenant_id, measurement_id, template_step_id, ordem, nome, role_required, due_at)
    VALUES(v_contract.tenant_id, v_id, v_step.id, v_step.ordem, v_step.nome, v_step.role_required, now() + make_interval(hours => COALESCE(v_step.sla_hours,48)));
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM measurement_approval_steps WHERE measurement_id = v_id) THEN
    INSERT INTO measurement_approval_steps(tenant_id, measurement_id, ordem, nome, role_required, due_at) VALUES
      (v_contract.tenant_id, v_id, 1, 'Fiscal de campo', 'fiscal_campo', now()+interval '48 hours'),
      (v_contract.tenant_id, v_id, 2, 'Fiscal do contrato', 'fiscal_contrato', now()+interval '96 hours'),
      (v_contract.tenant_id, v_id, 3, 'Gestor do contrato', 'gestor_contrato', now()+interval '144 hours');
  END IF;

  INSERT INTO audit_log(tenant_id, actor_id, entity_type, entity_id, action, source, after_value)
  VALUES(v_contract.tenant_id, public.current_member_id(), 'measurement', v_id, 'create_period', 'rpc', jsonb_build_object('numero', v_num));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_measurement(p_measurement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_errors int; v_alerts int; v_blocked int; v_payload jsonb;
BEGIN
  UPDATE measurement_items mi
  SET quantidade_acumulada_incl_periodo = quantidade_acumulada_antes + quantidade_periodo,
      valor_periodo = quantidade_periodo * preco_unitario_snapshot,
      valor_liquido = GREATEST((quantidade_periodo * preco_unitario_snapshot) - COALESCE(valor_glosado,0), 0),
      validacao_erros = CASE
        WHEN quantidade_periodo < 0 THEN jsonb_build_array('Quantidade negativa')
        WHEN quantidade_acumulada_antes + quantidade_periodo > quantidade_acumulada_antes + saldo_disponivel_snapshot THEN jsonb_build_array('Quantidade excede saldo contratual')
        WHEN preco_unitario_snapshot < 0 THEN jsonb_build_array('Preço unitário inválido')
        ELSE '[]'::jsonb END,
      validacao_status = CASE
        WHEN quantidade_periodo < 0 THEN 'bloqueado'
        WHEN quantidade_acumulada_antes + quantidade_periodo > quantidade_acumulada_antes + saldo_disponivel_snapshot THEN 'bloqueado'
        WHEN quantidade_periodo = 0 THEN 'pendente'
        ELSE 'ok' END,
      updated_at = now()
  WHERE mi.measurement_id = p_measurement_id AND mi.deleted_at IS NULL;

  SELECT COUNT(*) FILTER (WHERE validacao_status='alerta'), COUNT(*) FILTER (WHERE validacao_status='bloqueado')
  INTO v_alerts, v_blocked FROM measurement_items WHERE measurement_id = p_measurement_id AND deleted_at IS NULL;


  UPDATE measurements m
  SET valor_po = x.valor_periodo, valor_glosado = x.valor_glosado, valor_liquido = x.valor_liquido, valor_reajustado = x.valor_liquido, updated_at = now()
  FROM (
    SELECT COALESCE(SUM(valor_periodo),0) AS valor_periodo, COALESCE(SUM(valor_glosado),0) AS valor_glosado, COALESCE(SUM(valor_liquido),0) AS valor_liquido
    FROM measurement_items WHERE measurement_id = p_measurement_id AND deleted_at IS NULL
  ) x
  WHERE m.id = p_measurement_id;

  SELECT jsonb_build_object('measurement_id',p_measurement_id,'alertas',v_alerts,'bloqueios',v_blocked,'ok',v_blocked=0) INTO v_payload;
  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_measurement_step(p_step_id uuid, p_action text DEFAULT 'aprovar', p_comment text DEFAULT NULL, p_glosses jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_step measurement_approval_steps%ROWTYPE; v_next uuid; v_status text; v_measurement_id uuid;
BEGIN
  SELECT * INTO v_step FROM measurement_approval_steps WHERE id=p_step_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Etapa não encontrada'; END IF;
  IF v_step.status <> 'pendente' THEN RAISE EXCEPTION 'Etapa já decidida'; END IF;

  v_status := CASE p_action WHEN 'aprovar' THEN 'aprovado' WHEN 'aprovar_parcial' THEN 'aprovado' WHEN 'devolver' THEN 'devolvido' WHEN 'reprovar' THEN 'reprovado' ELSE 'aprovado' END;
  UPDATE measurement_approval_steps SET status=v_status, decided_at=now(), decided_by=public.current_member_id(), comment=p_comment WHERE id=p_step_id;
  v_measurement_id := v_step.measurement_id;

  IF p_action = 'devolver' THEN
    UPDATE measurements SET status='devolvida' WHERE id=v_measurement_id;
  ELSIF p_action = 'reprovar' THEN
    UPDATE measurements SET status='cancelada' WHERE id=v_measurement_id;
  ELSE
    SELECT id INTO v_next FROM measurement_approval_steps WHERE measurement_id=v_measurement_id AND status='pendente' AND deleted_at IS NULL ORDER BY ordem LIMIT 1;
    IF v_next IS NULL THEN UPDATE measurements SET status='aprovada', data_aprovacao=CURRENT_DATE WHERE id=v_measurement_id; ELSE UPDATE measurements SET status='em_aprovacao' WHERE id=v_measurement_id; END IF;
  END IF;

  INSERT INTO audit_log(tenant_id, actor_id, entity_type, entity_id, action, source, metadata)
  VALUES(v_step.tenant_id, public.current_member_id(), 'measurement_approval_step', p_step_id, p_action, 'rpc', jsonb_build_object('comment',p_comment));
  RETURN jsonb_build_object('ok',true,'measurement_id',v_measurement_id,'step_status',v_status,'next_step_id',v_next);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_additive(p_contract_id uuid, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_contract contracts%ROWTYPE; v_id uuid; v_num int; v_acr numeric; v_dec numeric; v_tipo text; item jsonb;
BEGIN
  SELECT * INTO v_contract FROM contracts WHERE id=p_contract_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  SELECT COALESCE(MAX(numero),0)+1 INTO v_num FROM additives WHERE contract_id=p_contract_id AND deleted_at IS NULL;
  v_acr := COALESCE((p_payload->>'valor_acrescimo')::numeric,0);
  v_dec := COALESCE((p_payload->>'valor_decrescimo')::numeric,0);
  v_tipo := COALESCE(p_payload->>'tipo','valor');
  INSERT INTO additives(tenant_id,contract_id,numero,tipo,status,valor_acrescimo,valor_decrescimo,prazo_execucao_acrescimo_dias,prazo_vigencia_acrescimo_dias,percentual_sobre_inicial,justificativa_valor,justificativa_prazo,created_by,metadata)
  VALUES(v_contract.tenant_id,p_contract_id,v_num,v_tipo,'aprovado',v_acr,v_dec,COALESCE((p_payload->>'prazo_execucao_dias')::int,0),COALESCE((p_payload->>'prazo_vigencia_dias')::int,0),CASE WHEN v_contract.valor_inicial=0 THEN 0 ELSE ((v_acr-v_dec)/v_contract.valor_inicial)*100 END,p_payload->>'justificativa_valor',p_payload->>'justificativa_prazo',public.current_member_id(),p_payload)
  RETURNING id INTO v_id;
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items','[]'::jsonb)) LOOP
    INSERT INTO additive_items(tenant_id,additive_id,tipo,codigo,descricao,unidade,quantidade,preco_unitario,valor_total)
    VALUES(v_contract.tenant_id,v_id,COALESCE(item->>'tipo','extra_novo'),item->>'codigo',COALESCE(item->>'descricao','Item aditivo'),item->>'unidade',COALESCE((item->>'quantidade')::numeric,0),COALESCE((item->>'preco_unitario')::numeric,0),COALESCE((item->>'valor_total')::numeric,0));
  END LOOP;
  UPDATE contracts SET valor_aditado = valor_aditado + (v_acr - v_dec), updated_at=now() WHERE id=p_contract_id;
  INSERT INTO audit_log(tenant_id, actor_id, entity_type, entity_id, action, source, after_value) VALUES(v_contract.tenant_id, public.current_member_id(), 'additive', v_id, 'register', 'rpc', p_payload);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalc_financial_snapshot(p_contract_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_contract contracts%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO v_contract FROM contracts WHERE id=p_contract_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  INSERT INTO contract_financial_snapshots(tenant_id, contract_id, reference_date, valor_inicial, valor_aditado, valor_total_atual, valor_medido_mes, valor_medido_acumulado, valor_reajustado_acumulado, total_retencoes, total_glosas, total_pago, saldo_contratual, percentual_financeiro)
  SELECT v_contract.tenant_id, v_contract.id, CURRENT_DATE, v_contract.valor_inicial, v_contract.valor_aditado, v_contract.valor_total_atual,
    COALESCE(SUM(m.valor_liquido) FILTER (WHERE date_trunc('month',m.periodo_fim)=date_trunc('month',CURRENT_DATE)),0),
    COALESCE(SUM(m.valor_liquido),0), COALESCE(SUM(m.valor_reajustado),0), COALESCE(SUM(m.valor_retido),0), COALESCE(SUM(m.valor_glosado),0),
    COALESCE((SELECT SUM(p.valor_pago) FROM measurement_payment_events p JOIN measurements mp ON mp.id=p.measurement_id WHERE mp.contract_id=v_contract.id AND p.deleted_at IS NULL),0),
    v_contract.valor_total_atual - COALESCE(SUM(m.valor_liquido),0),
    CASE WHEN v_contract.valor_total_atual=0 THEN 0 ELSE (COALESCE(SUM(m.valor_liquido),0)/v_contract.valor_total_atual)*100 END
  FROM measurements m WHERE m.contract_id=v_contract.id AND m.deleted_at IS NULL AND m.status <> 'cancelada'
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE VIEW public.v_contract_dashboard WITH (security_invoker = true) AS
WITH agg_measurements AS (
  SELECT contract_id, COALESCE(SUM(valor_liquido) FILTER (WHERE status <> 'cancelada'),0) AS valor_medido_acumulado,
         COALESCE(SUM(valor_glosado) FILTER (WHERE status <> 'cancelada'),0) AS valor_glosado,
         COALESCE(SUM(valor_retido) FILTER (WHERE status <> 'cancelada'),0) AS valor_retido
  FROM measurements WHERE deleted_at IS NULL GROUP BY contract_id
), agg_payments AS (
  SELECT m.contract_id, COALESCE(SUM(p.valor_pago),0) AS valor_pago
  FROM measurement_payment_events p JOIN measurements m ON m.id=p.measurement_id
  WHERE p.deleted_at IS NULL AND m.deleted_at IS NULL GROUP BY m.contract_id
), latest_snapshot AS (
  SELECT DISTINCT ON (contract_id) contract_id, percentual_fisico, percentual_financeiro, valor_medido_acumulado AS snapshot_valor_medido, total_pago AS snapshot_valor_pago
  FROM contract_financial_snapshots WHERE deleted_at IS NULL ORDER BY contract_id, reference_date DESC, generated_at DESC
)
SELECT c.id, c.tenant_id, c.numero, c.objeto, COALESCE(contratante.nome, orgao.nome, '') AS contratante_nome,
       COALESCE(contratada.nome, '') AS contratada_nome, COALESCE(lot.municipio,'') AS municipio, COALESCE(lot.uf,'') AS uf,
       c.valor_inicial::float8 AS valor_inicial, c.valor_aditado::float8 AS valor_aditado, c.valor_total_atual::float8 AS valor_atual,
       COALESCE(fs.snapshot_valor_medido, am.valor_medido_acumulado, 0)::float8 AS valor_medido_acumulado,
       COALESCE(fs.snapshot_valor_pago, ap.valor_pago, 0)::float8 AS valor_pago,
       (c.valor_total_atual - COALESCE(fs.snapshot_valor_medido, am.valor_medido_acumulado, 0))::float8 AS saldo_contratual,
       COALESCE(fs.percentual_fisico,0)::float8 AS percentual_fisico,
       COALESCE(fs.percentual_financeiro, CASE WHEN c.valor_total_atual=0 THEN 0 ELSE ROUND((COALESCE(am.valor_medido_acumulado,0)/c.valor_total_atual)*100,6) END,0)::float8 AS percentual_financeiro,
       c.data_assinatura, c.data_ordem_inicio, c.regime_contratacao, c.modalidade_licitatoria, c.status,
       ARRAY_REMOVE(ARRAY[
         CASE WHEN c.valor_inicial > 0 AND (c.valor_aditado / c.valor_inicial) * 100 >= 20 THEN 'Aditivos acima de 20% do valor inicial' END,
         CASE WHEN c.prazo_execucao_dias IS NOT NULL AND c.data_ordem_inicio IS NOT NULL AND CURRENT_DATE > c.data_ordem_inicio + c.prazo_execucao_dias THEN 'Prazo de execução vencido' END
       ], NULL)::text[] AS alertas
FROM contracts c
LEFT JOIN contract_organizations orgao ON orgao.id=c.orgao_id
LEFT JOIN contract_organizations contratante ON contratante.id=c.contratante_id
LEFT JOIN contract_organizations contratada ON contratada.id=c.contratada_id
LEFT JOIN LATERAL (SELECT municipio, uf FROM contract_lots l WHERE l.contract_id=c.id AND l.deleted_at IS NULL ORDER BY l.created_at ASC LIMIT 1) lot ON true
LEFT JOIN agg_measurements am ON am.contract_id=c.id
LEFT JOIN agg_payments ap ON ap.contract_id=c.id
LEFT JOIN latest_snapshot fs ON fs.contract_id=c.id
WHERE c.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.v_contract_items_balance WITH (security_invoker = true) AS
SELECT ci.id, ci.tenant_id, ci.contract_id, ci.codigo, ci.descricao, COALESCE(d.nome,'') AS disciplina, ci.unidade,
       ci.quantidade_contratada::float8 AS quantidade_contratada, ci.quantidade_aditada::float8 AS quantidade_aditada,
       COALESCE(SUM(mi.quantidade_periodo) FILTER (WHERE m.status <> 'cancelada'),0)::float8 AS quantidade_medida_acumulada,
       ci.preco_unitario::float8 AS preco_unitario, ci.bdi_percentual::float8 AS bdi, ci.fonte_referencia, ci.locked, ci.deleted_at
FROM contract_items ci
LEFT JOIN disciplines d ON d.id=ci.discipline_id
LEFT JOIN measurement_items mi ON mi.contract_item_id=ci.id AND mi.deleted_at IS NULL
LEFT JOIN measurements m ON m.id=mi.measurement_id AND m.deleted_at IS NULL
WHERE ci.deleted_at IS NULL
GROUP BY ci.id, d.nome;

CREATE OR REPLACE VIEW public.v_measurement_items_detail WITH (security_invoker = true) AS
SELECT mi.id, mi.tenant_id, mi.measurement_id, mi.contract_item_id, ci.codigo, ci.descricao, COALESCE(ci.unidade,'') AS unidade,
       mi.quantidade_periodo::float8 AS quantidade_periodo, mi.quantidade_acumulada_antes::float8 AS quantidade_acumulada_antes,
       mi.quantidade_acumulada_incl_periodo::float8 AS quantidade_acumulada_incl_periodo, mi.preco_unitario_snapshot::float8 AS preco_unitario_snapshot,
       mi.valor_periodo::float8 AS valor_periodo, mi.valor_glosado::float8 AS valor_glosado, mi.valor_liquido::float8 AS valor_liquido,
       mi.saldo_disponivel_snapshot::float8 AS saldo_disponivel_snapshot, COALESCE(mi.memoria_resumo,'') AS memoria_resumo, mi.validacao_status, mi.validacao_erros, mi.deleted_at
FROM measurement_items mi JOIN contract_items ci ON ci.id=mi.contract_item_id
WHERE mi.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.v_ged_documents WITH (security_invoker = true) AS
SELECT gd.id, gd.tenant_id, COALESCE(gd.nomenclature_code, gd.numero, gd.id::text) AS codigo, gd.title AS titulo,
       COALESCE(gc.nome,'') AS categoria, COALESCE(gd.revisao_atual,'') AS revisao, gd.status, COALESCE(c.numero,'') AS contrato,
       COALESCE(d.nome,'') AS disciplina, COALESCE(m.nome,'') AS responsavel, gd.data_documento,
       (SELECT COUNT(*) FROM ged_document_versions v WHERE v.document_id=gd.id AND v.deleted_at IS NULL)::int AS versoes
FROM ged_documents gd JOIN ged_categories gc ON gc.id=gd.category_id
LEFT JOIN contracts c ON c.id=gd.contract_id
LEFT JOIN disciplines d ON d.id=gd.discipline_id
LEFT JOIN members m ON m.id=gd.responsavel_id
WHERE gd.deleted_at IS NULL;
