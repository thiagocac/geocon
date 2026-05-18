-- =============================================================================
-- 058_contract_items_abc
-- =============================================================================
-- Curva ABC de itens contratuais (SOV).
--
-- Classifica itens por valor acumulado descendente:
--   A: items que somam até 80% do valor total do contrato (poucos, alto valor)
--   B: items 80-95% acumulado (médio)
--   C: items 95-100% acumulado (cauda longa)
--
-- Regra clássica (Pareto): ~20% dos items = ~80% do valor.
--
-- Considera apenas SOV vigente, não-títulos, ativos. Soma quantidade_contratada
-- + quantidade_aditada para refletir valor atual do contrato.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_contract_items_abc AS
WITH base AS (
  SELECT
    ci.id, ci.tenant_id, ci.contract_id, ci.sov_version_id,
    ci.codigo, ci.descricao, ci.unidade, ci.discipline_id,
    ci.quantidade_contratada, ci.quantidade_aditada, ci.preco_unitario,
    ci.quantidade_medida_acumulada,
    ci.fonte_referencia,
    ((ci.quantidade_contratada + ci.quantidade_aditada) * ci.preco_unitario)::numeric(18,2) AS valor_total
  FROM public.contract_items ci
  JOIN public.sov_versions sv ON sv.id = ci.sov_version_id
  WHERE ci.deleted_at IS NULL
    AND ci.is_title = false
    AND ci.active = true
    AND sv.status = 'vigente'
    AND sv.deleted_at IS NULL
),
with_total AS (
  SELECT *,
    SUM(valor_total) OVER (PARTITION BY contract_id) AS valor_contrato_total
  FROM base
),
with_cumulative AS (
  SELECT *,
    CASE WHEN valor_contrato_total > 0
         THEN (valor_total / valor_contrato_total) * 100
         ELSE 0
    END::numeric(8,4) AS pct_individual,
    CASE WHEN valor_contrato_total > 0
         THEN SUM(valor_total) OVER (
                PARTITION BY contract_id
                ORDER BY valor_total DESC, codigo ASC
                ROWS UNBOUNDED PRECEDING
              ) / valor_contrato_total * 100
         ELSE 0
    END::numeric(8,4) AS pct_acumulado,
    ROW_NUMBER() OVER (
      PARTITION BY contract_id
      ORDER BY valor_total DESC, codigo ASC
    ) AS rank
  FROM with_total
)
SELECT
  id, tenant_id, contract_id, sov_version_id,
  codigo, descricao, unidade, discipline_id,
  quantidade_contratada, quantidade_aditada, preco_unitario,
  quantidade_medida_acumulada,
  fonte_referencia,
  valor_total,
  valor_contrato_total,
  pct_individual,
  pct_acumulado,
  rank,
  CASE
    WHEN pct_acumulado <= 80  THEN 'A'
    WHEN pct_acumulado <= 95  THEN 'B'
    ELSE 'C'
  END AS classe
FROM with_cumulative;

GRANT SELECT ON public.v_contract_items_abc TO authenticated, service_role;

COMMENT ON VIEW public.v_contract_items_abc IS
'V55 — Curva ABC de itens contratuais. Classifica por valor acumulado descendente: ' ||
'A (≤80%), B (80-95%), C (95-100%). Considera SOV vigente, não-títulos, ativos.';

-- =============================================================================
-- RPC: resumo agregado da curva ABC por contrato
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_contract_abc_summary(p_contract_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH grouped AS (
    SELECT
      classe,
      count(*)::int          AS items_count,
      sum(valor_total)::numeric(18,2) AS valor_total,
      max(valor_contrato_total)::numeric(18,2) AS valor_contrato_total
    FROM public.v_contract_items_abc
    WHERE contract_id = p_contract_id
    GROUP BY classe
  ),
  classes AS (
    SELECT 'A' AS classe UNION ALL SELECT 'B' UNION ALL SELECT 'C'
  )
  SELECT jsonb_build_object(
    'contract_id', p_contract_id,
    'valor_contrato_total', coalesce((SELECT max(valor_contrato_total) FROM grouped), 0),
    'items_total', coalesce((SELECT sum(items_count) FROM grouped), 0),
    'A', jsonb_build_object(
      'items_count', coalesce((SELECT items_count FROM grouped WHERE classe='A'), 0),
      'valor_total', coalesce((SELECT valor_total FROM grouped WHERE classe='A'), 0),
      'pct_items',   CASE WHEN (SELECT sum(items_count) FROM grouped) > 0
                          THEN round(coalesce((SELECT items_count FROM grouped WHERE classe='A'),0) * 100.0
                                   / (SELECT sum(items_count) FROM grouped), 1)
                          ELSE 0 END,
      'pct_valor',   CASE WHEN (SELECT max(valor_contrato_total) FROM grouped) > 0
                          THEN round(coalesce((SELECT valor_total FROM grouped WHERE classe='A'),0) * 100.0
                                   / (SELECT max(valor_contrato_total) FROM grouped), 1)
                          ELSE 0 END
    ),
    'B', jsonb_build_object(
      'items_count', coalesce((SELECT items_count FROM grouped WHERE classe='B'), 0),
      'valor_total', coalesce((SELECT valor_total FROM grouped WHERE classe='B'), 0),
      'pct_items',   CASE WHEN (SELECT sum(items_count) FROM grouped) > 0
                          THEN round(coalesce((SELECT items_count FROM grouped WHERE classe='B'),0) * 100.0
                                   / (SELECT sum(items_count) FROM grouped), 1)
                          ELSE 0 END,
      'pct_valor',   CASE WHEN (SELECT max(valor_contrato_total) FROM grouped) > 0
                          THEN round(coalesce((SELECT valor_total FROM grouped WHERE classe='B'),0) * 100.0
                                   / (SELECT max(valor_contrato_total) FROM grouped), 1)
                          ELSE 0 END
    ),
    'C', jsonb_build_object(
      'items_count', coalesce((SELECT items_count FROM grouped WHERE classe='C'), 0),
      'valor_total', coalesce((SELECT valor_total FROM grouped WHERE classe='C'), 0),
      'pct_items',   CASE WHEN (SELECT sum(items_count) FROM grouped) > 0
                          THEN round(coalesce((SELECT items_count FROM grouped WHERE classe='C'),0) * 100.0
                                   / (SELECT sum(items_count) FROM grouped), 1)
                          ELSE 0 END,
      'pct_valor',   CASE WHEN (SELECT max(valor_contrato_total) FROM grouped) > 0
                          THEN round(coalesce((SELECT valor_total FROM grouped WHERE classe='C'),0) * 100.0
                                   / (SELECT max(valor_contrato_total) FROM grouped), 1)
                          ELSE 0 END
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_contract_abc_summary(uuid) TO authenticated;
