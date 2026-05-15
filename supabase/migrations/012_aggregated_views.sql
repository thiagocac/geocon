-- =============================================================================
-- 012_aggregated_views — Views agregadas alinhadas com src/lib/api.ts e schema 001
-- =============================================================================

-- Carteira por programa
CREATE OR REPLACE VIEW public.v_portfolio_by_program AS
WITH base AS (
  SELECT
    c.tenant_id, c.program_id,
    p.codigo AS program_codigo, p.nome AS program_nome, p.orgao AS program_orgao,
    c.id AS contract_id, c.valor_inicial,
    (SELECT coalesce(sum(valor_acrescimo - valor_decrescimo), 0)
     FROM public.additives WHERE contract_id = c.id AND status IN ('aprovado','incorporado')) AS valor_aditado_calc,
    (SELECT coalesce(sum(valor_liquido) FILTER (WHERE status IN ('emitida','aprovada','paga')), 0)
     FROM public.measurements WHERE contract_id = c.id AND deleted_at IS NULL) AS medido,
    (SELECT coalesce(sum(mpe.valor_pago), 0)
     FROM public.measurement_payment_events mpe
     JOIN public.measurements m ON m.id = mpe.measurement_id
     WHERE m.contract_id = c.id AND mpe.deleted_at IS NULL) AS pago,
    c.status
  FROM public.contracts c
  LEFT JOIN public.programs p ON p.id = c.program_id
  WHERE c.deleted_at IS NULL
)
SELECT
  program_id, program_codigo, program_nome, program_orgao,
  count(*)::int AS contratos_count,
  count(*) FILTER (WHERE status IN ('em_execucao','contratado'))::int AS contratos_ativos,
  sum(valor_inicial + valor_aditado_calc) AS valor_total,
  sum(valor_aditado_calc) AS valor_aditado_total,
  sum(medido) AS valor_medido_total,
  sum(pago) AS valor_pago_total,
  CASE WHEN sum(valor_inicial + valor_aditado_calc) > 0
       THEN round(sum(medido) / sum(valor_inicial + valor_aditado_calc) * 100, 2)
       ELSE 0
  END AS percentual_financeiro_medio
FROM base
GROUP BY program_id, program_codigo, program_nome, program_orgao
ORDER BY valor_total DESC NULLS LAST;

GRANT SELECT ON public.v_portfolio_by_program TO authenticated;

-- Carteira por órgão
CREATE OR REPLACE VIEW public.v_portfolio_by_orgao AS
WITH base AS (
  SELECT
    c.tenant_id,
    coalesce(p.orgao, org.nome) AS orgao,
    c.id AS contract_id, c.valor_inicial, c.status,
    (SELECT coalesce(sum(valor_acrescimo - valor_decrescimo), 0)
     FROM public.additives WHERE contract_id = c.id AND status IN ('aprovado','incorporado')) AS valor_aditado_calc,
    (SELECT coalesce(sum(valor_liquido) FILTER (WHERE status IN ('emitida','aprovada','paga')), 0)
     FROM public.measurements WHERE contract_id = c.id AND deleted_at IS NULL) AS medido,
    (SELECT coalesce(sum(mpe.valor_pago), 0)
     FROM public.measurement_payment_events mpe
     JOIN public.measurements m ON m.id = mpe.measurement_id
     WHERE m.contract_id = c.id AND mpe.deleted_at IS NULL) AS pago
  FROM public.contracts c
  LEFT JOIN public.programs p ON p.id = c.program_id
  LEFT JOIN public.contract_organizations org ON org.id = c.contratante_id
  WHERE c.deleted_at IS NULL
)
SELECT
  orgao,
  count(*)::int AS contratos_count,
  count(*) FILTER (WHERE status IN ('em_execucao','contratado'))::int AS contratos_ativos,
  sum(valor_inicial + valor_aditado_calc) AS valor_total,
  sum(medido) AS valor_medido_total,
  sum(pago) AS valor_pago_total,
  CASE WHEN sum(valor_inicial + valor_aditado_calc) > 0
       THEN round(sum(medido) / sum(valor_inicial + valor_aditado_calc) * 100, 2)
       ELSE 0
  END AS percentual_financeiro_medio
FROM base
WHERE orgao IS NOT NULL
GROUP BY orgao
ORDER BY valor_total DESC NULLS LAST;

GRANT SELECT ON public.v_portfolio_by_orgao TO authenticated;

-- Carteira por município (campo REAL: valor_obra)
CREATE OR REPLACE VIEW public.v_portfolio_by_municipio AS
WITH base AS (
  SELECT
    c.tenant_id, c.id AS contract_id, c.status,
    cl.municipio, cl.uf, coalesce(cl.valor_obra, 0) AS valor_obra,
    (SELECT coalesce(sum(valor_liquido) FILTER (WHERE status IN ('emitida','aprovada','paga')), 0)
     FROM public.measurements WHERE contract_id = c.id AND deleted_at IS NULL) AS medido
  FROM public.contracts c
  JOIN public.contract_lots cl ON cl.contract_id = c.id
  WHERE c.deleted_at IS NULL AND cl.deleted_at IS NULL AND cl.municipio IS NOT NULL
)
SELECT
  uf, municipio,
  count(DISTINCT contract_id)::int AS contratos_count,
  count(DISTINCT contract_id) FILTER (WHERE status IN ('em_execucao','contratado'))::int AS contratos_ativos,
  sum(valor_obra) AS valor_total,
  sum(medido) AS valor_medido_total
FROM base
GROUP BY uf, municipio
ORDER BY valor_total DESC NULLS LAST;

GRANT SELECT ON public.v_portfolio_by_municipio TO authenticated;

-- Aditivos consolidados (alinhado com interface AdditiveConsolidated)
-- Campos REAIS: valor_acrescimo, valor_decrescimo, valor_liquido (GENERATED), prazo_execucao_acrescimo_dias, justificativa_valor
CREATE OR REPLACE VIEW public.v_additives_consolidated AS
SELECT
  a.tenant_id,
  a.contract_id,
  c.numero  AS contract_numero,
  c.objeto  AS contract_objeto,
  c.valor_inicial AS contract_valor_inicial,
  c.valor_total_atual AS contract_valor_atual,
  a.id              AS additive_id,
  a.numero::text    AS additive_numero,
  a.tipo            AS additive_tipo,
  a.status          AS additive_status,
  coalesce(a.valor_acrescimo, 0) AS valor_acrescimo,
  coalesce(a.valor_decrescimo, 0) AS valor_decrescimo,
  coalesce(a.valor_liquido, 0) AS valor_liquido,
  coalesce(a.prazo_execucao_acrescimo_dias, 0) AS dias_adicionais,
  CASE WHEN c.valor_inicial > 0
       THEN round(coalesce(a.valor_liquido, 0) / c.valor_inicial * 100, 2)
       ELSE 0
  END AS percentual_individual,
  a.data_aprovacao,
  a.data_solicitacao,
  a.justificativa_valor,
  a.legal_basis,
  a.created_at
FROM public.additives a
JOIN public.contracts c ON c.id = a.contract_id
WHERE c.deleted_at IS NULL AND a.deleted_at IS NULL
ORDER BY a.data_solicitacao DESC NULLS LAST;

GRANT SELECT ON public.v_additives_consolidated TO authenticated;

-- Pendências consolidadas (alinhado com interface Pendencia + status REAIS)
CREATE OR REPLACE VIEW public.v_pendencias AS
-- 1. Medições em aprovação
SELECT
  m.tenant_id, m.contract_id, c.numero AS contract_numero,
  'medicao_aprovacao'::text AS pendencia_tipo,
  m.id AS entity_id,
  'Medição n.º ' || m.numero ||
    CASE WHEN m.complementar_numero > 0 THEN '.' || m.complementar_numero ELSE '' END ||
    ' em aprovação há ' || (CURRENT_DATE - m.created_at::date) || ' dias' AS descricao,
  m.created_at::text AS desde,
  (CURRENT_DATE - m.created_at::date)::int AS dias_aberta,
  CASE
    WHEN (CURRENT_DATE - m.created_at::date) > 15 THEN 'high'
    WHEN (CURRENT_DATE - m.created_at::date) > 7  THEN 'medium'
    ELSE 'low'
  END AS severidade
FROM public.measurements m
JOIN public.contracts c ON c.id = m.contract_id
WHERE m.deleted_at IS NULL AND m.status = 'em_aprovacao'
  AND (CURRENT_DATE - m.created_at::date) > 3

UNION ALL

-- 2. GRDs enviadas sem confirmação
SELECT
  t.tenant_id, t.contract_id, c.numero AS contract_numero,
  'grd_recebimento'::text AS pendencia_tipo,
  t.id AS entity_id,
  'GRD ' || t.numero || ' sem confirmação há ' || (CURRENT_DATE - t.sent_at::date) || ' dias' AS descricao,
  t.sent_at::text AS desde,
  (CURRENT_DATE - t.sent_at::date)::int AS dias_aberta,
  CASE
    WHEN (CURRENT_DATE - t.sent_at::date) > 14 THEN 'high'
    WHEN (CURRENT_DATE - t.sent_at::date) > 5  THEN 'medium'
    ELSE 'low'
  END AS severidade
FROM public.ged_transmittals t
LEFT JOIN public.contracts c ON c.id = t.contract_id
WHERE t.deleted_at IS NULL AND t.status = 'enviada'
  AND NOT EXISTS (
    SELECT 1 FROM public.ged_receipts r
    WHERE r.transmittal_id = t.id AND r.status = 'confirmado' AND r.deleted_at IS NULL
  )
  AND (CURRENT_DATE - t.sent_at::date) > 5

UNION ALL

-- 3. Itens não previstos em análise (status REAIS: levantamento|analise_tecnica|analise_preco|aprovacao_consorcio|aprovacao_orgao)
SELECT
  u.tenant_id, u.contract_id, c.numero AS contract_numero,
  'unforeseen_analise'::text AS pendencia_tipo,
  u.id AS entity_id,
  'Item não previsto "' || coalesce(u.descricao, '—') || '" em ' || u.status || ' há ' || (CURRENT_DATE - u.created_at::date) || ' dias' AS descricao,
  u.created_at::text AS desde,
  (CURRENT_DATE - u.created_at::date)::int AS dias_aberta,
  CASE
    WHEN (CURRENT_DATE - u.created_at::date) > 20 THEN 'high'
    WHEN (CURRENT_DATE - u.created_at::date) > 10 THEN 'medium'
    ELSE 'low'
  END AS severidade
FROM public.unforeseen_items u
JOIN public.contracts c ON c.id = u.contract_id
WHERE u.deleted_at IS NULL
  AND u.status IN ('levantamento','analise_tecnica','analise_preco','aprovacao_consorcio','aprovacao_orgao')
  AND (CURRENT_DATE - u.created_at::date) > 5

UNION ALL

-- 4. Contratos com risk_flags high (snapshot mais recente)
SELECT
  fs.tenant_id, fs.contract_id, c.numero AS contract_numero,
  'risco_alto'::text AS pendencia_tipo,
  fs.id AS entity_id,
  'Contrato ' || c.numero || ': ' ||
    coalesce((SELECT string_agg(flag->>'message', ' · ')
              FROM jsonb_array_elements(fs.risk_flags) AS flag
              WHERE flag->>'severity' = 'high'), 'Risco elevado') AS descricao,
  fs.generated_at::text AS desde,
  GREATEST((CURRENT_DATE - fs.generated_at::date), 0)::int AS dias_aberta,
  'high'::text AS severidade
FROM public.contract_financial_snapshots fs
JOIN public.contracts c ON c.id = fs.contract_id
WHERE fs.deleted_at IS NULL
  AND c.deleted_at IS NULL
  AND fs.id = (
    SELECT id FROM public.contract_financial_snapshots
    WHERE contract_id = fs.contract_id AND deleted_at IS NULL
    ORDER BY generated_at DESC LIMIT 1
  )
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(fs.risk_flags) AS f
    WHERE f->>'severity' = 'high'
  );

GRANT SELECT ON public.v_pendencias TO authenticated;
