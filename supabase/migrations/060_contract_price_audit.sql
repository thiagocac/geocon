-- =============================================================================
-- 060_contract_price_audit
-- =============================================================================
-- Auditoria de divergência entre preços contratados e fontes oficiais
-- (SINAPI/SICRO/ORSE/SEDOP). Complementa:
--   - V54: validate-measurement (regra preco_divergente_referencia por item/medição)
--   - V55: curva ABC (concentração de valor)
--
-- Terceira dimensão analítica: olha O CONTRATO INTEIRO, não item-a-item nem
-- medição-a-medição. Para cada item, pega a referência MAIS RECENTE
-- (DISTINCT ON ORDER BY data_base DESC) e calcula divergência real
-- (recalculada, não lida do campo armazenado que pode estar desatualizado).
-- =============================================================================

CREATE OR REPLACE VIEW public.v_contract_price_audit AS
WITH latest_refs AS (
  -- Para cada contract_item, pega a referência mais recente
  SELECT DISTINCT ON (r.contract_item_id)
    r.contract_item_id,
    r.base, r.codigo AS ref_codigo, r.descricao AS ref_descricao,
    r.uf, r.data_base, r.preco_referencia
  FROM public.contract_item_price_references r
  WHERE r.deleted_at IS NULL
    AND r.preco_referencia IS NOT NULL
    AND r.preco_referencia > 0
  ORDER BY r.contract_item_id, r.data_base DESC NULLS LAST, r.created_at DESC
),
audit AS (
  SELECT
    ci.id, ci.tenant_id, ci.contract_id, ci.sov_version_id,
    ci.codigo, ci.descricao, ci.unidade,
    ci.quantidade_contratada, ci.quantidade_aditada,
    ci.preco_unitario AS preco_contrato,
    ci.fonte_referencia AS fonte_contrato,
    lr.base AS ref_base, lr.ref_codigo, lr.ref_descricao,
    lr.uf AS ref_uf, lr.data_base AS ref_data_base,
    lr.preco_referencia,
    -- Recalcula divergência sempre (não confia no campo armazenado)
    ((ci.preco_unitario - lr.preco_referencia) / lr.preco_referencia * 100)::numeric(10,4)
      AS divergencia_pct,
    -- Impacto financeiro: divergência × quantidade total contratada
    ((ci.preco_unitario - lr.preco_referencia) * (ci.quantidade_contratada + ci.quantidade_aditada))::numeric(18,2)
      AS impacto_valor
  FROM public.contract_items ci
  JOIN public.sov_versions sv ON sv.id = ci.sov_version_id
  JOIN latest_refs lr ON lr.contract_item_id = ci.id
  WHERE ci.deleted_at IS NULL
    AND ci.is_title = false
    AND ci.active = true
    AND sv.status = 'vigente'
    AND sv.deleted_at IS NULL
)
SELECT
  id, tenant_id, contract_id, sov_version_id,
  codigo, descricao, unidade,
  quantidade_contratada, quantidade_aditada,
  preco_contrato, fonte_contrato,
  ref_base, ref_codigo, ref_descricao, ref_uf, ref_data_base,
  preco_referencia, divergencia_pct, impacto_valor,
  -- Magnitude: pequena (≤5%), média (5-15%), alta (15-30%), crítica (>30%)
  CASE
    WHEN abs(divergencia_pct) <= 5  THEN 'pequena'
    WHEN abs(divergencia_pct) <= 15 THEN 'media'
    WHEN abs(divergencia_pct) <= 30 THEN 'alta'
    ELSE                                'critica'
  END AS magnitude,
  -- Sinal: caro (preço contrato > referência) vs barato (contrato < ref)
  CASE WHEN divergencia_pct > 0 THEN 'caro' ELSE 'barato' END AS sinal
FROM audit;

GRANT SELECT ON public.v_contract_price_audit TO authenticated, service_role;

COMMENT ON VIEW public.v_contract_price_audit IS
'V57 — Auditoria de divergência preços contrato vs referência oficial. ' ||
'Usa DISTINCT ON para pegar a referência mais recente por item.';

-- =============================================================================
-- RPC: resumo agregado da auditoria por contrato
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_contract_price_audit_summary(p_contract_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT * FROM public.v_contract_price_audit WHERE contract_id = p_contract_id
  ),
  agg AS (
    SELECT
      count(*)::int                       AS items_auditados,
      count(*) FILTER (WHERE magnitude = 'pequena')::int  AS pequena,
      count(*) FILTER (WHERE magnitude = 'media')::int    AS media,
      count(*) FILTER (WHERE magnitude = 'alta')::int     AS alta,
      count(*) FILTER (WHERE magnitude = 'critica')::int  AS critica,
      count(*) FILTER (WHERE sinal = 'caro')::int         AS caros,
      count(*) FILTER (WHERE sinal = 'barato')::int       AS baratos,
      sum(impacto_valor) FILTER (WHERE divergencia_pct > 0)::numeric(18,2) AS impacto_acima,
      sum(impacto_valor) FILTER (WHERE divergencia_pct < 0)::numeric(18,2) AS impacto_abaixo
    FROM base
  ),
  total_contract AS (
    SELECT count(*)::int AS items_total
    FROM public.contract_items ci
    JOIN public.sov_versions sv ON sv.id = ci.sov_version_id
    WHERE ci.contract_id = p_contract_id
      AND ci.deleted_at IS NULL AND ci.is_title = false AND ci.active = true
      AND sv.status = 'vigente' AND sv.deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'contract_id', p_contract_id,
    'items_auditados', coalesce((SELECT items_auditados FROM agg), 0),
    'items_total',     coalesce((SELECT items_total FROM total_contract), 0),
    'cobertura_pct',   CASE WHEN (SELECT items_total FROM total_contract) > 0
                            THEN round((SELECT items_auditados FROM agg)::numeric * 100
                                     / (SELECT items_total FROM total_contract), 1)
                            ELSE 0 END,
    'magnitudes', jsonb_build_object(
      'pequena', coalesce((SELECT pequena FROM agg), 0),
      'media',   coalesce((SELECT media   FROM agg), 0),
      'alta',    coalesce((SELECT alta    FROM agg), 0),
      'critica', coalesce((SELECT critica FROM agg), 0)
    ),
    'sinais', jsonb_build_object(
      'caros',   coalesce((SELECT caros   FROM agg), 0),
      'baratos', coalesce((SELECT baratos FROM agg), 0)
    ),
    'impacto', jsonb_build_object(
      'acima',  coalesce((SELECT impacto_acima  FROM agg), 0),
      'abaixo', coalesce((SELECT impacto_abaixo FROM agg), 0),
      'liquido', coalesce((SELECT impacto_acima FROM agg), 0) + coalesce((SELECT impacto_abaixo FROM agg), 0)
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_contract_price_audit_summary(uuid) TO authenticated;
