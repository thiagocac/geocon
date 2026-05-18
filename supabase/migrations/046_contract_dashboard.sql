-- =============================================================================
-- 046_contract_dashboard
-- =============================================================================
-- RPC única que retorna um snapshot completo do dashboard executivo do contrato.
--
-- Consome todas as 9 áreas da Lei 14.133 + timeline V39 e responde a pergunta:
--   "O que precisa de atenção neste contrato AGORA?"
--
-- Estrutura do retorno (jsonb):
--   alerts: [{severity, title, body, link, count}]  -- alertas críticos no topo
--   kpis: {
--     financial:    {valor_inicial, valor_atual, valor_executado, ...}
--     pending:      {vicios_abertos, pars_em_curso, multas_pendentes, ...}
--     next_dates:   [{kind, date, days_until, label, link}]
--     recent:       {events_30d, last_event_at}
--   }
--   per_axis: {
--     reajuste, recebimento, garantia, par, sancao, ...  (1 obj por instituto)
--   }
--   recent_events: [...]  -- top 15 eventos dos últimos 30 dias
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_contract_dashboard(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_now    timestamptz := now();
  v_today  date := current_date;

  -- Contract base
  v_contract record;

  -- Financial KPIs
  v_valor_executado_garantia numeric;
  v_valor_disponivel_garantia numeric;

  -- Pending counts
  v_vicios_abertos    int;
  v_pars_em_curso     int;
  v_multas_pendentes  int;
  v_recebimentos_pendentes int;
  v_reequilibrios_pendentes int;

  -- Per-axis
  v_axis_reajuste       jsonb;
  v_axis_recebimento    jsonb;
  v_axis_garantia       jsonb;
  v_axis_par            jsonb;
  v_axis_sancao         jsonb;
  v_axis_aditivo        jsonb;
  v_axis_reequilibrio   jsonb;
  v_axis_repactuacao    jsonb;

  -- Next dates (proximos vencimentos)
  v_next_dates    jsonb;

  -- Recent events
  v_events_30d    int;
  v_last_event    timestamptz;
  v_recent_events jsonb;

  -- Alerts agregados
  v_alerts        jsonb := '[]'::jsonb;

  v_temp_count    int;
  v_temp_date     date;
  v_temp_days     int;
  v_temp_id       uuid;
  v_temp_record   record;
BEGIN
  v_tenant := public.current_tenant_id();

  -- ===========================================================================
  -- Base do contrato
  -- ===========================================================================
  SELECT id, numero, titulo, status, valor_inicial, valor_total_atual,
         valor_aditado, data_assinatura, data_inicio_prevista,
         prazo_execucao_dias, prazo_vigencia_dias
  INTO v_contract
  FROM public.contracts
  WHERE id = p_contract_id AND tenant_id = v_tenant;

  IF v_contract IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  -- ===========================================================================
  -- Garantias (V36): exposição financeira
  -- ===========================================================================
  SELECT
    coalesce(sum(valor_garantido - valor_disponivel) FILTER (WHERE status IN ('executada_parcial','executada_total')), 0),
    coalesce(sum(valor_disponivel) FILTER (WHERE status IN ('ativa','estendida','liberada_parcial','executada_parcial')), 0)
  INTO v_valor_executado_garantia, v_valor_disponivel_garantia
  FROM public.contract_guarantees
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant;

  -- ===========================================================================
  -- Recebimentos (V35): vícios abertos + recebimentos com pendência
  -- ===========================================================================
  SELECT count(*)::int INTO v_vicios_abertos
  FROM public.contract_receipt_vicios v
  JOIN public.contract_receipts r ON r.id = v.receipt_id
  WHERE r.contract_id = p_contract_id AND r.tenant_id = v_tenant
    AND v.status IN ('aberto','em_saneamento');

  SELECT count(*)::int INTO v_recebimentos_pendentes
  FROM public.contract_receipts
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant
    AND status IN ('rascunho','com_pendencias');

  -- ===========================================================================
  -- PARs (V37): em andamento
  -- ===========================================================================
  SELECT count(*)::int INTO v_pars_em_curso
  FROM public.contract_par_processes
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant
    AND status IN ('rascunho','instaurado','em_defesa','em_instrucao','em_julgamento','decidido','em_recurso');

  -- ===========================================================================
  -- Sanções (V38): multas pendentes
  -- ===========================================================================
  SELECT count(*)::int INTO v_multas_pendentes
  FROM public.contract_sanctions
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant
    AND tipo = 'multa' AND status IN ('ativa','suspensa') AND data_pagamento_multa IS NULL;

  -- ===========================================================================
  -- Reequilíbrios (V34): em andamento (não-finalizados)
  -- ===========================================================================
  SELECT count(*)::int INTO v_reequilibrios_pendentes
  FROM public.contract_reequilibrio_requests
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant
    AND status IN ('rascunho','em_analise_tecnica','em_aprovacao','aprovado');

  -- ===========================================================================
  -- Per-axis summaries (jsonb por instituto)
  -- ===========================================================================

  -- Reajuste (V30)
  SELECT jsonb_build_object(
    'rules_active',
    (SELECT count(*) FROM public.contract_adjustment_rules
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant AND active = true),
    'events_total',
    (SELECT count(*) FROM public.contract_reajuste_events
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant),
    'last_event_at',
    (SELECT max(applied_at) FROM public.contract_reajuste_events
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant),
    'delta_total',
    (SELECT coalesce(sum(delta), 0) FROM public.contract_reajuste_events
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant)
  ) INTO v_axis_reajuste;

  -- Repactuação (V33)
  SELECT jsonb_build_object(
    'events_total',
    (SELECT count(*) FROM public.contract_repactuacao_events
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant),
    'last_event_at',
    (SELECT max(applied_at) FROM public.contract_repactuacao_events
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant),
    'delta_total',
    (SELECT coalesce(sum(delta_total), 0) FROM public.contract_repactuacao_events
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant)
  ) INTO v_axis_repactuacao;

  -- Reequilíbrio (V34)
  SELECT jsonb_build_object(
    'total',
    (SELECT count(*) FROM public.contract_reequilibrio_requests
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant),
    'open',         v_reequilibrios_pendentes,
    'aplicado',
    (SELECT count(*) FROM public.contract_reequilibrio_requests
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant AND status = 'aplicado'),
    'valor_aprovado_total',
    (SELECT coalesce(sum(valor_aprovado) FILTER (WHERE status IN ('aprovado','aplicado')), 0)
       FROM public.contract_reequilibrio_requests
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant)
  ) INTO v_axis_reequilibrio;

  -- Recebimentos (V35)
  SELECT jsonb_build_object(
    'provisorios_emitidos',
    (SELECT count(*) FROM public.contract_receipts
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant
         AND tipo = 'provisorio' AND status IN ('emitido','sanado','com_pendencias')),
    'definitivos_emitidos',
    (SELECT count(*) FROM public.contract_receipts
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant
         AND tipo = 'definitivo' AND status IN ('emitido','sanado','com_pendencias')),
    'vicios_abertos',          v_vicios_abertos,
    'pendentes_total',         v_recebimentos_pendentes
  ) INTO v_axis_recebimento;

  -- Garantias (V36)
  SELECT jsonb_build_object(
    'total',
    (SELECT count(*) FROM public.contract_guarantees
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant),
    'ativas',
    (SELECT count(*) FROM public.contract_guarantees
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant
         AND status IN ('ativa','estendida')),
    'valor_disponivel',  v_valor_disponivel_garantia,
    'valor_executado',   v_valor_executado_garantia
  ) INTO v_axis_garantia;

  -- PAR (V37)
  SELECT jsonb_build_object(
    'total',
    (SELECT count(*) FROM public.contract_par_processes
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant),
    'em_andamento',  v_pars_em_curso,
    'procedentes',
    (SELECT count(*) FROM public.contract_par_processes
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant
         AND decisao_resultado IN ('procedente','parcialmente_procedente')),
    'prazo_estourado',
    (SELECT count(*) FROM public.contract_par_processes
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant
         AND status = 'em_defesa' AND defesa_prazo_limite < v_today)
  ) INTO v_axis_par;

  -- Sanções (V38)
  SELECT jsonb_build_object(
    'total',
    (SELECT count(*) FROM public.contract_sanctions
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant),
    'ativas',
    (SELECT count(*) FROM public.contract_sanctions
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant
         AND status = 'ativa'),
    'multa_pendente',
    (SELECT coalesce(sum(valor_multa), 0) FROM public.contract_sanctions
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant
         AND tipo = 'multa' AND status IN ('ativa','suspensa') AND data_pagamento_multa IS NULL),
    'impedimento_inidoneidade_ativos',
    (SELECT count(*) FROM public.contract_sanctions
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant
         AND tipo IN ('impedimento','inidoneidade') AND status = 'ativa')
  ) INTO v_axis_sancao;

  -- Aditivos (schema 001)
  SELECT jsonb_build_object(
    'total',
    (SELECT count(*) FROM public.additives
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant),
    'aprovados',
    (SELECT count(*) FROM public.additives
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant
         AND status IN ('aprovado','incorporado')),
    'em_aprovacao',
    (SELECT count(*) FROM public.additives
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant
         AND status IN ('em_analise','em_aprovacao')),
    'valor_liquido_total',
    (SELECT coalesce(sum(valor_liquido), 0) FROM public.additives
       WHERE contract_id = p_contract_id AND tenant_id = v_tenant
         AND status IN ('aprovado','incorporado'))
  ) INTO v_axis_aditivo;

  -- ===========================================================================
  -- Next dates: top 10 próximos vencimentos de qualquer eixo
  -- ===========================================================================
  WITH all_dates AS (
    -- Garantias vencendo
    SELECT
      'guarantee'::text                AS kind,
      data_vigencia_fim                AS due_date,
      (data_vigencia_fim - v_today)::int AS days_until,
      format('Garantia #%s', numero)   AS label,
      '/garantias'::text               AS link,
      id                               AS ref_id
    FROM public.contract_guarantees
    WHERE contract_id = p_contract_id AND tenant_id = v_tenant
      AND status IN ('ativa','estendida')
      AND data_vigencia_fim >= v_today

    UNION ALL

    -- Recebimentos: limite definitivo (90d após provisório)
    SELECT
      'receipt_limit'::text,
      data_limite_definitivo,
      (data_limite_definitivo - v_today)::int,
      format('Limite definitivo Recebimento #%s', numero),
      '/recebimentos',
      id
    FROM public.contract_receipts
    WHERE contract_id = p_contract_id AND tenant_id = v_tenant
      AND tipo = 'provisorio' AND status IN ('emitido','sanado')
      AND data_limite_definitivo IS NOT NULL
      AND data_limite_definitivo >= v_today
      AND NOT EXISTS (
        SELECT 1 FROM public.contract_receipts r2
        WHERE r2.provisorio_id = contract_receipts.id
          AND r2.status IN ('emitido','sanado')
      )

    UNION ALL

    -- Vícios: prazo de saneamento
    SELECT
      'vicio'::text,
      v.data_limite_saneamento,
      (v.data_limite_saneamento - v_today)::int,
      format('Saneamento de vício · Recebimento #%s', r.numero),
      '/recebimentos',
      v.id
    FROM public.contract_receipt_vicios v
    JOIN public.contract_receipts r ON r.id = v.receipt_id
    WHERE r.contract_id = p_contract_id AND r.tenant_id = v_tenant
      AND v.status IN ('aberto','em_saneamento')
      AND v.data_limite_saneamento >= v_today

    UNION ALL

    -- PAR: prazo de defesa
    SELECT
      'par_defesa'::text,
      defesa_prazo_limite,
      (defesa_prazo_limite - v_today)::int,
      format('Defesa do PAR #%s', numero),
      '/processos-administrativos',
      id
    FROM public.contract_par_processes
    WHERE contract_id = p_contract_id AND tenant_id = v_tenant
      AND status = 'em_defesa' AND defesa_prazo_limite >= v_today

    UNION ALL

    -- Sanções: fim de vigência (impedimento/inidoneidade)
    SELECT
      'sanction_vigencia'::text,
      vigencia_fim,
      (vigencia_fim - v_today)::int,
      format('Fim de vigência · Sanção #%s', numero),
      '/sancoes',
      id
    FROM public.contract_sanctions
    WHERE contract_id = p_contract_id AND tenant_id = v_tenant
      AND status = 'ativa' AND vigencia_fim IS NOT NULL
      AND vigencia_fim >= v_today

    UNION ALL

    -- Sanções: vencimento de multa
    SELECT
      'sanction_multa'::text,
      data_vencimento_multa,
      (data_vencimento_multa - v_today)::int,
      format('Vencimento multa · Sanção #%s', numero),
      '/sancoes',
      id
    FROM public.contract_sanctions
    WHERE contract_id = p_contract_id AND tenant_id = v_tenant
      AND tipo = 'multa' AND status IN ('ativa','suspensa')
      AND data_pagamento_multa IS NULL
      AND data_vencimento_multa IS NOT NULL
      AND data_vencimento_multa >= v_today
  )
  SELECT coalesce(jsonb_agg(t ORDER BY t.days_until), '[]'::jsonb)
  INTO v_next_dates
  FROM (
    SELECT * FROM all_dates ORDER BY days_until LIMIT 10
  ) t;

  -- ===========================================================================
  -- Recent events (últimos 30 dias da timeline V39)
  -- ===========================================================================
  SELECT count(*)::int, max(event_at)
  INTO v_events_30d, v_last_event
  FROM public.v_contract_timeline
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant
    AND event_date >= v_today - interval '30 days';

  SELECT coalesce(jsonb_agg(t), '[]'::jsonb)
  INTO v_recent_events
  FROM (
    SELECT event_kind, event_subtype, event_date, event_at,
           title, subtitle, severity, valor, ref_link, actor_name
    FROM public.v_contract_timeline
    WHERE contract_id = p_contract_id AND tenant_id = v_tenant
      AND event_date >= v_today - interval '30 days'
    ORDER BY event_at DESC
    LIMIT 15
  ) t;

  -- ===========================================================================
  -- Alerts: aviso crítico no topo se algo demanda atenção urgente
  -- ===========================================================================

  -- Vícios graves abertos (severidade alta/crítica)
  SELECT count(*)::int INTO v_temp_count
  FROM public.contract_receipt_vicios v
  JOIN public.contract_receipts r ON r.id = v.receipt_id
  WHERE r.contract_id = p_contract_id AND r.tenant_id = v_tenant
    AND v.status IN ('aberto','em_saneamento')
    AND v.severidade IN ('alta','critica');

  IF v_temp_count > 0 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'severity', 'danger',
      'title',    format('%s vício%s grave%s em aberto',
                         v_temp_count,
                         CASE WHEN v_temp_count = 1 THEN '' ELSE 's' END,
                         CASE WHEN v_temp_count = 1 THEN '' ELSE 's' END),
      'body',     'Vícios de severidade alta ou crítica precisam de saneamento prioritário',
      'link',     '/recebimentos',
      'count',    v_temp_count
    ));
  END IF;

  -- PARs procedentes ativos sem sanção aplicada (gap de processo)
  SELECT count(*)::int INTO v_temp_count
  FROM public.contract_par_processes p
  WHERE p.contract_id = p_contract_id AND p.tenant_id = v_tenant
    AND p.decisao_resultado IN ('procedente','parcialmente_procedente')
    AND p.status IN ('decidido','arquivado')
    AND p.sancao_proposta_tipos IS NOT NULL
    AND cardinality(p.sancao_proposta_tipos) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.contract_sanctions s
      WHERE s.par_id = p.id
        AND s.status IN ('ativa','suspensa','cumprida')
    );

  IF v_temp_count > 0 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'severity', 'warning',
      'title',    format('%s PAR procedente sem sanção aplicada', v_temp_count),
      'body',     'PARs decididos como procedentes que propuseram sanção mas ainda não foram materializadas',
      'link',     '/processos-administrativos',
      'count',    v_temp_count
    ));
  END IF;

  -- Garantias vencendo em ≤7 dias
  SELECT count(*)::int INTO v_temp_count
  FROM public.contract_guarantees
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant
    AND status IN ('ativa','estendida')
    AND data_vigencia_fim BETWEEN v_today AND v_today + interval '7 days';

  IF v_temp_count > 0 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'severity', 'danger',
      'title',    format('%s garantia%s vencendo em até 7 dias',
                         v_temp_count, CASE WHEN v_temp_count = 1 THEN '' ELSE 's' END),
      'body',     'Atue para estender ou substituir antes do vencimento',
      'link',     '/garantias',
      'count',    v_temp_count
    ));
  END IF;

  -- PARs em defesa com prazo vencido
  SELECT count(*)::int INTO v_temp_count
  FROM public.contract_par_processes
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant
    AND status = 'em_defesa' AND defesa_prazo_limite < v_today;

  IF v_temp_count > 0 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'severity', 'warning',
      'title',    format('%s PAR com prazo de defesa vencido', v_temp_count),
      'body',     'Registre a defesa (ou revelia) para destravar a instrução',
      'link',     '/processos-administrativos',
      'count',    v_temp_count
    ));
  END IF;

  -- Multas pendentes > R$ 100.000 (limiar arbitrário; UI pode customizar)
  SELECT count(*)::int INTO v_temp_count
  FROM public.contract_sanctions
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant
    AND tipo = 'multa' AND status IN ('ativa','suspensa')
    AND data_pagamento_multa IS NULL
    AND valor_multa > 100000;

  IF v_temp_count > 0 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'severity', 'warning',
      'title',    format('%s multa%s pendente%s acima de R$ 100k',
                         v_temp_count,
                         CASE WHEN v_temp_count = 1 THEN '' ELSE 's' END,
                         CASE WHEN v_temp_count = 1 THEN '' ELSE 's' END),
      'body',     'Pagamento pendente de multas com valor expressivo',
      'link',     '/sancoes',
      'count',    v_temp_count
    ));
  END IF;

  -- ===========================================================================
  -- Resultado final
  -- ===========================================================================
  RETURN jsonb_build_object(
    'contract', jsonb_build_object(
      'id',               v_contract.id,
      'numero',           v_contract.numero,
      'titulo',           v_contract.titulo,
      'status',           v_contract.status,
      'valor_inicial',    v_contract.valor_inicial,
      'valor_total_atual',v_contract.valor_total_atual,
      'valor_aditado',    v_contract.valor_aditado,
      'data_assinatura',  v_contract.data_assinatura,
      'data_inicio',      v_contract.data_inicio_prevista
    ),
    'alerts',         v_alerts,
    'kpis', jsonb_build_object(
      'financial', jsonb_build_object(
        'valor_inicial',        v_contract.valor_inicial,
        'valor_total_atual',    v_contract.valor_total_atual,
        'valor_aditado',        v_contract.valor_aditado,
        'valor_garantia_disponivel', v_valor_disponivel_garantia,
        'valor_garantia_executado',  v_valor_executado_garantia
      ),
      'pending', jsonb_build_object(
        'vicios_abertos',         v_vicios_abertos,
        'pars_em_curso',          v_pars_em_curso,
        'multas_pendentes',       v_multas_pendentes,
        'recebimentos_pendentes', v_recebimentos_pendentes,
        'reequilibrios_pendentes',v_reequilibrios_pendentes
      ),
      'recent', jsonb_build_object(
        'events_30d',   v_events_30d,
        'last_event_at',v_last_event
      )
    ),
    'per_axis', jsonb_build_object(
      'aditivo',      v_axis_aditivo,
      'reajuste',     v_axis_reajuste,
      'repactuacao',  v_axis_repactuacao,
      'reequilibrio', v_axis_reequilibrio,
      'recebimento',  v_axis_recebimento,
      'garantia',     v_axis_garantia,
      'par',          v_axis_par,
      'sancao',       v_axis_sancao
    ),
    'next_dates',     v_next_dates,
    'recent_events',  v_recent_events
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_contract_dashboard(uuid) TO authenticated;
