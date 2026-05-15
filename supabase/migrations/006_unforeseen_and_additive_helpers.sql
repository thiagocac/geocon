-- =============================================================================
-- 006_unforeseen_and_additive_helpers.sql
--
-- RPCs auxiliares para o fluxo "modelo de 5 objetos" da spec:
--   1. Solicitação           → unforeseen_items (status=levantamento)
--   2. Análise técnica       → status=analise_tecnica
--   3. Análise de preço      → status=analise_preco, com unforeseen_item_components
--   4. Aprovação formal      → status=aprovacao_consorcio → aprovacao_orgao → aprovado
--   5. Incorporação contratual → additives + additive_items (status=aditado em unforeseen_items)
--
-- Também:
--   - Seed de origens padrão (deficiência de projeto, solicitação contratante, etc).
--   - Função para verificar limites legais (25%/50%).
--   - View consolidada do painel de aditivos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Seed de origens (vai criar para todo tenant existente)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_unforeseen_origins(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.unforeseen_item_origins (tenant_id, nome, descricao, active)
  VALUES
    (p_tenant_id, 'Deficiência de projeto',     'Projeto original incompleto ou impreciso',                true),
    (p_tenant_id, 'Solicitação do contratante', 'Alteração solicitada pelo órgão contratante',             true),
    (p_tenant_id, 'Condição de campo imprevista','Diferença entre o previsto e o real (geológico, etc.)', true),
    (p_tenant_id, 'Mudança normativa',          'Nova norma aplicável durante a execução',                 true),
    (p_tenant_id, 'Solicitação técnica fiscal', 'Sugestão técnica do fiscal/gerenciadora',                 true),
    (p_tenant_id, 'Reequilíbrio econômico',     'Quebra da equação econômica original',                    true),
    (p_tenant_id, 'Caso fortuito ou força maior','Eventos extraordinários (chuvas atípicas, sinistros)',    true),
    (p_tenant_id, 'Erro de levantamento',       'Levantamento original com erro',                          true)
  ON CONFLICT DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_unforeseen_origins(uuid) TO authenticated;

-- Roda seed para tenants existentes
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.tenants WHERE ativo = true LOOP
    PERFORM public.seed_unforeseen_origins(r.id);
  END LOOP;
END$$;


-- -----------------------------------------------------------------------------
-- RPC: criar solicitação de item não previsto (Objeto 1 — Solicitação)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_unforeseen_item(
  p_contract_id  uuid,
  p_origin_id    uuid,
  p_lot_id       uuid,
  p_discipline_id uuid,
  p_descricao    text,
  p_justificativa text,
  p_valor_estimado numeric DEFAULT 0,
  p_prazo_impacto_dias int DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_id      uuid;
  v_tenant  uuid;
  v_member  uuid;
  v_numero  int;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.contracts WHERE id = p_contract_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  -- Resolve member do usuário atual nesse tenant
  SELECT id INTO v_member
  FROM public.members WHERE auth_id = auth.uid() AND tenant_id = v_tenant AND active = true
  LIMIT 1;

  -- Próximo número sequencial no contrato
  SELECT COALESCE(MAX(numero), 0) + 1 INTO v_numero
  FROM public.unforeseen_items WHERE contract_id = p_contract_id AND deleted_at IS NULL;

  INSERT INTO public.unforeseen_items (
    tenant_id, contract_id, lot_id, discipline_id, origin_id,
    numero, descricao, justificativa, valor_estimado, prazo_impacto_dias,
    status, opened_by
  ) VALUES (
    v_tenant, p_contract_id, p_lot_id, p_discipline_id, p_origin_id,
    v_numero, p_descricao, p_justificativa, p_valor_estimado, p_prazo_impacto_dias,
    'levantamento', v_member
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_unforeseen_item(uuid, uuid, uuid, uuid, text, text, numeric, int) TO authenticated;


-- -----------------------------------------------------------------------------
-- RPC: avançar status do item não previsto (Objetos 2..4)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_unforeseen_item(
  p_id           uuid,
  p_new_status   text,
  p_comment      text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_current text;
  v_member  uuid;
  v_tenant  uuid;
BEGIN
  SELECT status, tenant_id INTO v_current, v_tenant
  FROM public.unforeseen_items WHERE id = p_id;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Item não previsto não encontrado';
  END IF;

  -- Transições válidas
  IF NOT (
    (v_current = 'levantamento'        AND p_new_status IN ('analise_tecnica', 'cancelado'))
    OR (v_current = 'analise_tecnica'  AND p_new_status IN ('analise_preco', 'recusado', 'cancelado'))
    OR (v_current = 'analise_preco'    AND p_new_status IN ('aprovacao_consorcio', 'aprovacao_orgao', 'recusado'))
    OR (v_current = 'aprovacao_consorcio' AND p_new_status IN ('aprovacao_orgao', 'recusado'))
    OR (v_current = 'aprovacao_orgao'  AND p_new_status IN ('aprovado', 'recusado'))
  ) THEN
    RAISE EXCEPTION 'Transição inválida: % → %', v_current, p_new_status;
  END IF;

  SELECT id INTO v_member
  FROM public.members WHERE auth_id = auth.uid() AND tenant_id = v_tenant AND active = true
  LIMIT 1;

  UPDATE public.unforeseen_items
  SET status = p_new_status,
      approved_by = CASE WHEN p_new_status = 'aprovado' THEN v_member ELSE approved_by END,
      approved_at = CASE WHEN p_new_status = 'aprovado' THEN now() ELSE approved_at END,
      updated_at = now()
  WHERE id = p_id;

  -- Audit log
  INSERT INTO public.audit_log (tenant_id, actor_id, entity_type, entity_id, action, before_value, after_value)
  VALUES (
    v_tenant, v_member, 'unforeseen_item', p_id, 'advance_status',
    jsonb_build_object('status', v_current),
    jsonb_build_object('status', p_new_status, 'comment', p_comment)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.advance_unforeseen_item(uuid, text, text) TO authenticated;


-- -----------------------------------------------------------------------------
-- RPC: verificar limite legal antes de incorporar aditivo (RN-036 + RN-037)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_additive_legal_limit(
  p_contract_id uuid,
  p_valor_adicional numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_valor_inicial numeric;
  v_valor_aditado numeric;
  v_novo_aditado  numeric;
  v_pct_novo      numeric;
  v_limite        numeric;
  v_zona          text;
BEGIN
  SELECT valor_inicial, valor_aditado
  INTO v_valor_inicial, v_valor_aditado
  FROM public.contracts WHERE id = p_contract_id;

  IF v_valor_inicial IS NULL OR v_valor_inicial = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Contrato sem valor inicial');
  END IF;

  v_novo_aditado := v_valor_aditado + p_valor_adicional;
  v_pct_novo := (v_novo_aditado / v_valor_inicial) * 100;

  -- Lê limite configurado no contrato (settings) ou usa padrão 25%
  SELECT COALESCE((settings->>'additive_limit_percent')::numeric, 25)
  INTO v_limite FROM public.contracts WHERE id = p_contract_id;

  v_zona := CASE
    WHEN v_pct_novo < v_limite * 0.8  THEN 'verde'    -- até 20% (se limite 25%)
    WHEN v_pct_novo < v_limite * 0.96 THEN 'amarelo'  -- entre 20% e 24%
    WHEN v_pct_novo <= v_limite       THEN 'laranja'  -- entre 24% e 25%
    ELSE 'vermelho'                                    -- ultrapassa
  END;

  RETURN jsonb_build_object(
    'ok', v_pct_novo <= v_limite,
    'valor_inicial', v_valor_inicial,
    'valor_aditado_atual', v_valor_aditado,
    'valor_adicional', p_valor_adicional,
    'valor_aditado_proposto', v_novo_aditado,
    'percentual_proposto', round(v_pct_novo, 4),
    'limite_percent', v_limite,
    'zona', v_zona,
    'bloqueio', v_pct_novo > v_limite,
    'mensagem', CASE v_zona
      WHEN 'verde'    THEN 'Dentro do limite legal'
      WHEN 'amarelo'  THEN 'Atenção: acima de 20% do contrato'
      WHEN 'laranja'  THEN 'Próximo do limite legal — requer aprovação superior'
      WHEN 'vermelho' THEN 'BLOQUEIO: ultrapassa o limite legal (' || v_limite || '%). Lei 14.133/2021 art. 125.'
    END
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_additive_legal_limit(uuid, numeric) TO authenticated;


-- -----------------------------------------------------------------------------
-- RPC: incorporar item não previsto aprovado num aditivo (Objeto 5)
-- -----------------------------------------------------------------------------
-- Cria um aditivo (se ainda não existir) com os componentes dos itens aprovados
-- e marca os itens como aditados.
CREATE OR REPLACE FUNCTION public.incorporate_unforeseen_to_additive(
  p_contract_id uuid,
  p_unforeseen_item_ids uuid[],
  p_tipo text,           -- valor / prazo / valor_prazo / supressao / reequilibrio
  p_justificativa text,
  p_legal_basis text DEFAULT 'Lei 14.133/2021 art. 125'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_id        uuid;
  v_tenant    uuid;
  v_member    uuid;
  v_numero    int;
  v_valor_acr numeric := 0;
  v_valor_dec numeric := 0;
  v_prazo     int := 0;
  v_check     jsonb;
  v_invalid_count int;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.contracts WHERE id = p_contract_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  -- Garantia: todos os itens estão no contrato e aprovados (status='aprovado')
  SELECT count(*) INTO v_invalid_count
  FROM unnest(p_unforeseen_item_ids) AS x(id)
  LEFT JOIN public.unforeseen_items ui ON ui.id = x.id
  WHERE ui.contract_id IS DISTINCT FROM p_contract_id
     OR ui.status <> 'aprovado'
     OR ui.deleted_at IS NOT NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Existem % itens inválidos (não aprovados ou de outro contrato)', v_invalid_count;
  END IF;

  SELECT id INTO v_member
  FROM public.members WHERE auth_id = auth.uid() AND tenant_id = v_tenant AND active = true
  LIMIT 1;

  -- Calcula totais a partir dos componentes
  SELECT
    COALESCE(SUM(CASE WHEN c.tipo IN ('acrescimo','extra_novo') THEN c.valor_total END), 0),
    COALESCE(SUM(CASE WHEN c.tipo = 'decrescimo' THEN c.valor_total END), 0),
    COALESCE(MAX(ui.prazo_impacto_dias), 0)
  INTO v_valor_acr, v_valor_dec, v_prazo
  FROM public.unforeseen_items ui
  JOIN public.unforeseen_item_components c ON c.unforeseen_item_id = ui.id
  WHERE ui.id = ANY(p_unforeseen_item_ids) AND c.deleted_at IS NULL;

  -- Checa limite legal
  v_check := public.check_additive_legal_limit(p_contract_id, v_valor_acr - v_valor_dec);
  IF (v_check->>'bloqueio')::boolean THEN
    RAISE EXCEPTION 'BLOQUEIO LEGAL: %', v_check->>'mensagem';
  END IF;

  -- Próximo número de aditivo
  SELECT COALESCE(MAX(numero), 0) + 1 INTO v_numero
  FROM public.additives WHERE contract_id = p_contract_id AND deleted_at IS NULL;

  -- Cria aditivo (status incorporado direto)
  INSERT INTO public.additives (
    tenant_id, contract_id, numero, tipo, status,
    data_solicitacao, data_aprovacao,
    valor_acrescimo, valor_decrescimo,
    prazo_execucao_acrescimo_dias,
    percentual_sobre_inicial,
    justificativa_valor, legal_basis,
    created_by, approved_by
  ) VALUES (
    v_tenant, p_contract_id, v_numero, p_tipo, 'incorporado',
    CURRENT_DATE, CURRENT_DATE,
    v_valor_acr, v_valor_dec, v_prazo,
    (v_check->>'percentual_proposto')::numeric,
    p_justificativa, p_legal_basis,
    v_member, v_member
  )
  RETURNING id INTO v_id;

  -- Copia componentes para additive_items
  INSERT INTO public.additive_items (
    tenant_id, additive_id, unforeseen_item_component_id, contract_item_id,
    tipo, codigo, descricao, unidade, quantidade, preco_unitario, valor_total
  )
  SELECT v_tenant, v_id, c.id, c.contract_item_id,
         c.tipo, c.codigo, c.descricao, c.unidade,
         c.quantidade, c.preco_unitario, c.valor_total
  FROM public.unforeseen_item_components c
  JOIN public.unforeseen_items ui ON ui.id = c.unforeseen_item_id
  WHERE ui.id = ANY(p_unforeseen_item_ids) AND c.deleted_at IS NULL;

  -- Atualiza saldo aditado do contrato
  UPDATE public.contracts
  SET valor_aditado = valor_aditado + (v_valor_acr - v_valor_dec),
      updated_at = now()
  WHERE id = p_contract_id;

  -- Marca itens não previstos como aditados
  UPDATE public.unforeseen_items
  SET status = 'aditado', updated_at = now()
  WHERE id = ANY(p_unforeseen_item_ids);

  -- Audit log
  INSERT INTO public.audit_log (tenant_id, actor_id, entity_type, entity_id, action, after_value)
  VALUES (v_tenant, v_member, 'additive', v_id, 'create_from_unforeseen',
          jsonb_build_object('unforeseen_ids', p_unforeseen_item_ids,
                             'valor_acrescimo', v_valor_acr,
                             'valor_decrescimo', v_valor_dec));

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.incorporate_unforeseen_to_additive(uuid, uuid[], text, text, text) TO authenticated;


-- -----------------------------------------------------------------------------
-- View consolidada: painel de aditivos por contrato
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_contract_additive_summary AS
SELECT
  c.id AS contract_id,
  c.tenant_id,
  c.valor_inicial,
  c.valor_aditado,
  c.valor_total_atual,
  COALESCE(c.valor_aditado / NULLIF(c.valor_inicial, 0), 0) * 100 AS percentual_aditado,
  COUNT(a.id) FILTER (WHERE a.status = 'incorporado') AS aditivos_incorporados,
  COUNT(a.id) FILTER (WHERE a.status IN ('em_analise','em_aprovacao')) AS aditivos_em_analise,
  COUNT(ui.id) FILTER (WHERE ui.status = 'aprovado') AS itens_aprovados_pendentes,
  COUNT(ui.id) FILTER (WHERE ui.status IN ('levantamento','analise_tecnica','analise_preco')) AS itens_em_analise
FROM public.contracts c
LEFT JOIN public.additives a ON a.contract_id = c.id AND a.deleted_at IS NULL
LEFT JOIN public.unforeseen_items ui ON ui.contract_id = c.id AND ui.deleted_at IS NULL
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.tenant_id, c.valor_inicial, c.valor_aditado, c.valor_total_atual;

GRANT SELECT ON public.v_contract_additive_summary TO authenticated;
