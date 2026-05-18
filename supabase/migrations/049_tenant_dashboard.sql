-- =============================================================================
-- 049_tenant_dashboard
-- =============================================================================
-- Dashboard executivo do tenant: agregação cross-contract dos 9 institutos da
-- Lei 14.133 + financeiro consolidado + alertas globais + próximos vencimentos
-- da carteira.
--
-- Espelha a estrutura da RPC V41 (get_contract_dashboard) mas tenant-wide:
--   * alerts agregam contagens em vez de uma única decisão
--   * top_critical_contracts substitui o próprio contract (apex executivo)
--   * next_dates inclui contract_numero/titulo em cada linha
--   * per_axis tem somas/contagens cross-contract
--
-- Single RPC, retorna jsonb único pra round-trip mínimo.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_tenant_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_today  date := current_date;
  v_now    timestamptz := now();

  -- Totals
  v_contracts_total       int;
  v_contracts_ativos      int;
  v_valor_inicial_total   numeric;
  v_valor_atual_total     numeric;
  v_valor_aditado_total   numeric;
  v_garantia_disp_total   numeric;
  v_garantia_exec_total   numeric;

  -- Alert counts (contratos afetados por tipo)
  v_vicios_graves_n           int;
  v_vicios_graves_contracts   jsonb;
  v_garantias_7d_n            int;
  v_garantias_7d_contracts    jsonb;
  v_par_proc_sem_sanc_n       int;
  v_par_proc_sem_sanc_contracts jsonb;
  v_par_prazo_vencido_n       int;
  v_par_prazo_vencido_contracts jsonb;
  v_multas_grandes_n          int;
  v_multas_grandes_total      numeric;

  -- Per axis totals
  v_axis jsonb;

  -- Top critical contracts
  v_top_critical jsonb;

  -- Next dates
  v_next_dates jsonb;

  -- Recent events
  v_recent_events  jsonb;
  v_events_30d     int;
  v_events_7d      int;
BEGIN
  v_tenant := public.current_tenant_id();

  -- ===========================================================================
  -- Totals da carteira
  -- ===========================================================================
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status NOT IN ('encerrado','cancelado'))::int,
    coalesce(sum(valor_inicial), 0),
    coalesce(sum(valor_total_atual), 0),
    coalesce(sum(valor_aditado), 0)
  INTO v_contracts_total, v_contracts_ativos,
       v_valor_inicial_total, v_valor_atual_total, v_valor_aditado_total
  FROM public.contracts
  WHERE tenant_id = v_tenant AND deleted_at IS NULL;

  SELECT
    coalesce(sum(valor_disponivel) FILTER (WHERE status IN ('ativa','estendida','liberada_parcial','executada_parcial')), 0),
    coalesce(sum(valor_garantido - valor_disponivel) FILTER (WHERE status IN ('executada_parcial','executada_total')), 0)
  INTO v_garantia_disp_total, v_garantia_exec_total
  FROM public.contract_guarantees g
  JOIN public.contracts c ON c.id = g.contract_id
  WHERE g.tenant_id = v_tenant AND c.deleted_at IS NULL;

  -- ===========================================================================
  -- Alertas tenant-wide (contagens + amostra de contratos afetados)
  -- ===========================================================================

  -- Alert 1: vícios graves abertos
  SELECT
    count(DISTINCT r.contract_id)::int,
    coalesce(jsonb_agg(DISTINCT jsonb_build_object(
      'id',     r.contract_id,
      'numero', c.numero,
      'titulo', c.titulo
    )) FILTER (WHERE r.contract_id IS NOT NULL), '[]'::jsonb)
  INTO v_vicios_graves_n, v_vicios_graves_contracts
  FROM public.contract_receipt_vicios v
  JOIN public.contract_receipts r ON r.id = v.receipt_id
  JOIN public.contracts c ON c.id = r.contract_id
  WHERE r.tenant_id = v_tenant
    AND c.deleted_at IS NULL
    AND v.status IN ('aberto','em_saneamento')
    AND v.severidade IN ('alta','critica');

  -- Alert 2: garantias vencendo em ≤7d
  SELECT
    count(*)::int,
    coalesce(jsonb_agg(DISTINCT jsonb_build_object(
      'id',     g.contract_id,
      'numero', c.numero,
      'titulo', c.titulo
    )) FILTER (WHERE g.contract_id IS NOT NULL), '[]'::jsonb)
  INTO v_garantias_7d_n, v_garantias_7d_contracts
  FROM public.contract_guarantees g
  JOIN public.contracts c ON c.id = g.contract_id
  WHERE g.tenant_id = v_tenant
    AND c.deleted_at IS NULL
    AND g.status IN ('ativa','estendida')
    AND g.data_vigencia_fim BETWEEN v_today AND v_today + interval '7 days';

  -- Alert 3: PARs procedentes sem sanção materializada
  SELECT
    count(*)::int,
    coalesce(jsonb_agg(DISTINCT jsonb_build_object(
      'id',     p.contract_id,
      'numero', c.numero,
      'titulo', c.titulo
    )) FILTER (WHERE p.contract_id IS NOT NULL), '[]'::jsonb)
  INTO v_par_proc_sem_sanc_n, v_par_proc_sem_sanc_contracts
  FROM public.contract_par_processes p
  JOIN public.contracts c ON c.id = p.contract_id
  WHERE p.tenant_id = v_tenant
    AND c.deleted_at IS NULL
    AND p.decisao_resultado IN ('procedente','parcialmente_procedente')
    AND p.status IN ('decidido','arquivado')
    AND p.sancao_proposta_tipos IS NOT NULL
    AND cardinality(p.sancao_proposta_tipos) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.contract_sanctions s
      WHERE s.par_id = p.id
        AND s.status IN ('ativa','suspensa','cumprida')
    );

  -- Alert 4: PARs em defesa com prazo vencido
  SELECT
    count(*)::int,
    coalesce(jsonb_agg(DISTINCT jsonb_build_object(
      'id',     p.contract_id,
      'numero', c.numero,
      'titulo', c.titulo
    )) FILTER (WHERE p.contract_id IS NOT NULL), '[]'::jsonb)
  INTO v_par_prazo_vencido_n, v_par_prazo_vencido_contracts
  FROM public.contract_par_processes p
  JOIN public.contracts c ON c.id = p.contract_id
  WHERE p.tenant_id = v_tenant
    AND c.deleted_at IS NULL
    AND p.status = 'em_defesa'
    AND p.defesa_prazo_limite < v_today;

  -- Alert 5: multas grandes pendentes (> R$ 100k)
  SELECT
    count(*)::int,
    coalesce(sum(s.valor_multa), 0)
  INTO v_multas_grandes_n, v_multas_grandes_total
  FROM public.contract_sanctions s
  JOIN public.contracts c ON c.id = s.contract_id
  WHERE s.tenant_id = v_tenant
    AND c.deleted_at IS NULL
    AND s.tipo = 'multa'
    AND s.status IN ('ativa','suspensa')
    AND s.data_pagamento_multa IS NULL
    AND s.valor_multa > 100000;

  -- ===========================================================================
  -- Per axis totals (cross-contract)
  -- ===========================================================================
  v_axis := jsonb_build_object(
    'aditivo', (
      SELECT jsonb_build_object(
        'total',
          (SELECT count(*) FROM public.additives a
             JOIN public.contracts c ON c.id = a.contract_id
             WHERE a.tenant_id = v_tenant AND c.deleted_at IS NULL),
        'aprovados',
          (SELECT count(*) FROM public.additives a
             JOIN public.contracts c ON c.id = a.contract_id
             WHERE a.tenant_id = v_tenant AND c.deleted_at IS NULL
               AND a.status IN ('aprovado','incorporado')),
        'em_aprovacao',
          (SELECT count(*) FROM public.additives a
             JOIN public.contracts c ON c.id = a.contract_id
             WHERE a.tenant_id = v_tenant AND c.deleted_at IS NULL
               AND a.status IN ('em_analise','em_aprovacao')),
        'valor_liquido_total',
          (SELECT coalesce(sum(a.valor_liquido), 0) FROM public.additives a
             JOIN public.contracts c ON c.id = a.contract_id
             WHERE a.tenant_id = v_tenant AND c.deleted_at IS NULL
               AND a.status IN ('aprovado','incorporado'))
      )
    ),
    'reajuste', (
      SELECT jsonb_build_object(
        'rules_active',
          (SELECT count(*) FROM public.contract_adjustment_rules r
             JOIN public.contracts c ON c.id = r.contract_id
             WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL AND r.active = true),
        'events_total',
          (SELECT count(*) FROM public.contract_reajuste_events r
             JOIN public.contracts c ON c.id = r.contract_id
             WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL),
        'delta_total',
          (SELECT coalesce(sum(r.delta), 0) FROM public.contract_reajuste_events r
             JOIN public.contracts c ON c.id = r.contract_id
             WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL)
      )
    ),
    'repactuacao', (
      SELECT jsonb_build_object(
        'events_total',
          (SELECT count(*) FROM public.contract_repactuacao_events r
             JOIN public.contracts c ON c.id = r.contract_id
             WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL),
        'delta_total',
          (SELECT coalesce(sum(r.delta_total), 0) FROM public.contract_repactuacao_events r
             JOIN public.contracts c ON c.id = r.contract_id
             WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL)
      )
    ),
    'reequilibrio', (
      SELECT jsonb_build_object(
        'total',
          (SELECT count(*) FROM public.contract_reequilibrio_requests r
             JOIN public.contracts c ON c.id = r.contract_id
             WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL),
        'open',
          (SELECT count(*) FROM public.contract_reequilibrio_requests r
             JOIN public.contracts c ON c.id = r.contract_id
             WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL
               AND r.status IN ('rascunho','em_analise_tecnica','em_aprovacao','aprovado')),
        'aplicado',
          (SELECT count(*) FROM public.contract_reequilibrio_requests r
             JOIN public.contracts c ON c.id = r.contract_id
             WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL
               AND r.status = 'aplicado'),
        'valor_aprovado_total',
          (SELECT coalesce(sum(r.valor_aprovado) FILTER (WHERE r.status IN ('aprovado','aplicado')), 0)
             FROM public.contract_reequilibrio_requests r
             JOIN public.contracts c ON c.id = r.contract_id
             WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL)
      )
    ),
    'recebimento', (
      SELECT jsonb_build_object(
        'provisorios_emitidos',
          (SELECT count(*) FROM public.contract_receipts r
             JOIN public.contracts c ON c.id = r.contract_id
             WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL
               AND r.tipo = 'provisorio' AND r.status IN ('emitido','sanado','com_pendencias')),
        'definitivos_emitidos',
          (SELECT count(*) FROM public.contract_receipts r
             JOIN public.contracts c ON c.id = r.contract_id
             WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL
               AND r.tipo = 'definitivo' AND r.status IN ('emitido','sanado','com_pendencias')),
        'vicios_abertos',
          (SELECT count(*) FROM public.contract_receipt_vicios v
             JOIN public.contract_receipts r ON r.id = v.receipt_id
             JOIN public.contracts c ON c.id = r.contract_id
             WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL
               AND v.status IN ('aberto','em_saneamento'))
      )
    ),
    'garantia', (
      SELECT jsonb_build_object(
        'total',
          (SELECT count(*) FROM public.contract_guarantees g
             JOIN public.contracts c ON c.id = g.contract_id
             WHERE g.tenant_id = v_tenant AND c.deleted_at IS NULL),
        'ativas',
          (SELECT count(*) FROM public.contract_guarantees g
             JOIN public.contracts c ON c.id = g.contract_id
             WHERE g.tenant_id = v_tenant AND c.deleted_at IS NULL
               AND g.status IN ('ativa','estendida')),
        'valor_disponivel', v_garantia_disp_total,
        'valor_executado',  v_garantia_exec_total
      )
    ),
    'par', (
      SELECT jsonb_build_object(
        'total',
          (SELECT count(*) FROM public.contract_par_processes p
             JOIN public.contracts c ON c.id = p.contract_id
             WHERE p.tenant_id = v_tenant AND c.deleted_at IS NULL),
        'em_andamento',
          (SELECT count(*) FROM public.contract_par_processes p
             JOIN public.contracts c ON c.id = p.contract_id
             WHERE p.tenant_id = v_tenant AND c.deleted_at IS NULL
               AND p.status IN ('rascunho','instaurado','em_defesa','em_instrucao','em_julgamento','decidido','em_recurso')),
        'procedentes',
          (SELECT count(*) FROM public.contract_par_processes p
             JOIN public.contracts c ON c.id = p.contract_id
             WHERE p.tenant_id = v_tenant AND c.deleted_at IS NULL
               AND p.decisao_resultado IN ('procedente','parcialmente_procedente')),
        'prazo_estourado', v_par_prazo_vencido_n
      )
    ),
    'sancao', (
      SELECT jsonb_build_object(
        'total',
          (SELECT count(*) FROM public.contract_sanctions s
             JOIN public.contracts c ON c.id = s.contract_id
             WHERE s.tenant_id = v_tenant AND c.deleted_at IS NULL),
        'ativas',
          (SELECT count(*) FROM public.contract_sanctions s
             JOIN public.contracts c ON c.id = s.contract_id
             WHERE s.tenant_id = v_tenant AND c.deleted_at IS NULL
               AND s.status = 'ativa'),
        'multa_pendente',
          (SELECT coalesce(sum(s.valor_multa), 0) FROM public.contract_sanctions s
             JOIN public.contracts c ON c.id = s.contract_id
             WHERE s.tenant_id = v_tenant AND c.deleted_at IS NULL
               AND s.tipo = 'multa' AND s.status IN ('ativa','suspensa') AND s.data_pagamento_multa IS NULL),
        'impedimento_inidoneidade_ativos',
          (SELECT count(*) FROM public.contract_sanctions s
             JOIN public.contracts c ON c.id = s.contract_id
             WHERE s.tenant_id = v_tenant AND c.deleted_at IS NULL
               AND s.tipo IN ('impedimento','inidoneidade') AND s.status = 'ativa')
      )
    )
  );

  -- ===========================================================================
  -- Top critical contracts (top 8 com mais "pontos de atenção")
  -- ===========================================================================
  -- Pontuação: soma de pendências críticas em cada eixo
  WITH contract_scores AS (
    SELECT
      c.id,
      c.numero,
      c.titulo,
      c.status,
      c.valor_total_atual,
      -- Pontos: 3x vícios graves + 2x PARs procedentes ativos + 2x garantias <7d
      --       + 1x multas pendentes + 1x PARs em curso
      coalesce((SELECT 3 * count(*)
                  FROM public.contract_receipt_vicios v
                  JOIN public.contract_receipts r ON r.id = v.receipt_id
                  WHERE r.contract_id = c.id
                    AND v.status IN ('aberto','em_saneamento')
                    AND v.severidade IN ('alta','critica')
               ), 0) +
      coalesce((SELECT 2 * count(*)
                  FROM public.contract_par_processes p
                  WHERE p.contract_id = c.id
                    AND p.decisao_resultado IN ('procedente','parcialmente_procedente')
                    AND p.status IN ('decidido','em_recurso')
               ), 0) +
      coalesce((SELECT 2 * count(*)
                  FROM public.contract_guarantees g
                  WHERE g.contract_id = c.id
                    AND g.status IN ('ativa','estendida')
                    AND g.data_vigencia_fim BETWEEN v_today AND v_today + interval '7 days'
               ), 0) +
      coalesce((SELECT count(*)
                  FROM public.contract_sanctions s
                  WHERE s.contract_id = c.id
                    AND s.tipo = 'multa' AND s.status IN ('ativa','suspensa')
                    AND s.data_pagamento_multa IS NULL
               ), 0) +
      coalesce((SELECT count(*)
                  FROM public.contract_par_processes p
                  WHERE p.contract_id = c.id
                    AND p.status IN ('em_defesa','em_instrucao','em_julgamento','em_recurso')
               ), 0) AS score
    FROM public.contracts c
    WHERE c.tenant_id = v_tenant AND c.deleted_at IS NULL
      AND c.status NOT IN ('encerrado','cancelado')
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id',                cs.id,
      'numero',            cs.numero,
      'titulo',            cs.titulo,
      'status',            cs.status,
      'valor_total_atual', cs.valor_total_atual,
      'score',             cs.score
    ) ORDER BY cs.score DESC
  ), '[]'::jsonb)
  INTO v_top_critical
  FROM (
    SELECT * FROM contract_scores WHERE score > 0 ORDER BY score DESC LIMIT 8
  ) cs;

  -- ===========================================================================
  -- Próximos vencimentos da carteira (top 10 cross-contract)
  -- ===========================================================================
  WITH all_dates AS (
    SELECT
      'guarantee'::text          AS kind,
      g.data_vigencia_fim        AS due_date,
      (g.data_vigencia_fim - v_today)::int AS days_until,
      format('Garantia #%s', g.numero) AS label,
      '/garantias'::text         AS link,
      g.contract_id,
      c.numero  AS contract_numero,
      c.titulo  AS contract_titulo
    FROM public.contract_guarantees g
    JOIN public.contracts c ON c.id = g.contract_id
    WHERE g.tenant_id = v_tenant AND c.deleted_at IS NULL
      AND g.status IN ('ativa','estendida')
      AND g.data_vigencia_fim >= v_today

    UNION ALL

    SELECT 'receipt_limit'::text, r.data_limite_definitivo,
           (r.data_limite_definitivo - v_today)::int,
           format('Limite definitivo Recebimento #%s', r.numero),
           '/recebimentos',
           r.contract_id, c.numero, c.titulo
    FROM public.contract_receipts r
    JOIN public.contracts c ON c.id = r.contract_id
    WHERE r.tenant_id = v_tenant AND c.deleted_at IS NULL
      AND r.tipo = 'provisorio' AND r.status IN ('emitido','sanado')
      AND r.data_limite_definitivo IS NOT NULL
      AND r.data_limite_definitivo >= v_today
      AND NOT EXISTS (
        SELECT 1 FROM public.contract_receipts r2
        WHERE r2.provisorio_id = r.id AND r2.status IN ('emitido','sanado')
      )

    UNION ALL

    SELECT 'par_defesa'::text, p.defesa_prazo_limite,
           (p.defesa_prazo_limite - v_today)::int,
           format('Defesa do PAR #%s', p.numero),
           '/processos-administrativos',
           p.contract_id, c.numero, c.titulo
    FROM public.contract_par_processes p
    JOIN public.contracts c ON c.id = p.contract_id
    WHERE p.tenant_id = v_tenant AND c.deleted_at IS NULL
      AND p.status = 'em_defesa' AND p.defesa_prazo_limite >= v_today

    UNION ALL

    SELECT 'sanction_vigencia'::text, s.vigencia_fim,
           (s.vigencia_fim - v_today)::int,
           format('Fim de vigência · Sanção #%s', s.numero),
           '/sancoes',
           s.contract_id, c.numero, c.titulo
    FROM public.contract_sanctions s
    JOIN public.contracts c ON c.id = s.contract_id
    WHERE s.tenant_id = v_tenant AND c.deleted_at IS NULL
      AND s.status = 'ativa' AND s.vigencia_fim IS NOT NULL
      AND s.vigencia_fim >= v_today
  )
  SELECT coalesce(jsonb_agg(t ORDER BY t.days_until), '[]'::jsonb)
  INTO v_next_dates
  FROM (
    SELECT * FROM all_dates ORDER BY days_until LIMIT 10
  ) t;

  -- ===========================================================================
  -- Recent events do tenant (top 12 dos últimos 30 dias)
  -- ===========================================================================
  SELECT count(*)::int FILTER (WHERE event_date >= v_today - interval '30 days'),
         count(*)::int FILTER (WHERE event_date >= v_today - interval '7 days')
  INTO v_events_30d, v_events_7d
  FROM public.v_contract_timeline v
  JOIN public.contracts c ON c.id = v.contract_id
  WHERE v.tenant_id = v_tenant AND c.deleted_at IS NULL;

  SELECT coalesce(jsonb_agg(t), '[]'::jsonb)
  INTO v_recent_events
  FROM (
    SELECT v.event_kind, v.event_subtype, v.event_date, v.event_at,
           v.title, v.subtitle, v.severity, v.valor, v.ref_link, v.actor_name,
           v.contract_id, c.numero AS contract_numero, c.titulo AS contract_titulo
    FROM public.v_contract_timeline v
    JOIN public.contracts c ON c.id = v.contract_id
    WHERE v.tenant_id = v_tenant AND c.deleted_at IS NULL
      AND v.event_date >= v_today - interval '30 days'
    ORDER BY v.event_at DESC
    LIMIT 12
  ) t;

  -- ===========================================================================
  -- Resultado
  -- ===========================================================================
  RETURN jsonb_build_object(
    'totals', jsonb_build_object(
      'contracts_total',     v_contracts_total,
      'contracts_ativos',    v_contracts_ativos,
      'valor_inicial_total', v_valor_inicial_total,
      'valor_atual_total',   v_valor_atual_total,
      'valor_aditado_total', v_valor_aditado_total
    ),
    'alerts', jsonb_build_object(
      'vicios_graves',              jsonb_build_object('count', v_vicios_graves_n,         'contracts', v_vicios_graves_contracts),
      'garantias_7d',               jsonb_build_object('count', v_garantias_7d_n,          'contracts', v_garantias_7d_contracts),
      'par_procedente_sem_sancao',  jsonb_build_object('count', v_par_proc_sem_sanc_n,     'contracts', v_par_proc_sem_sanc_contracts),
      'par_prazo_defesa_vencido',   jsonb_build_object('count', v_par_prazo_vencido_n,     'contracts', v_par_prazo_vencido_contracts),
      'multas_grandes_pendentes',   jsonb_build_object('count', v_multas_grandes_n,        'total_valor', v_multas_grandes_total)
    ),
    'per_axis',               v_axis,
    'top_critical_contracts', v_top_critical,
    'next_dates',             v_next_dates,
    'recent_events',          v_recent_events,
    'recent_activity',        jsonb_build_object(
      'events_30d', v_events_30d,
      'events_7d',  v_events_7d
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_tenant_dashboard() TO authenticated;
