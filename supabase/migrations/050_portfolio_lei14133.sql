-- =============================================================================
-- 049_portfolio_lei14133
-- =============================================================================
-- Estende as 3 views de carteira (programa, orgao, municipio) adicionando 5
-- KPIs agregados dos institutos Lei 14.133 (V35-V38).
--
-- Construção: 1 view auxiliar v_contract_lei14133_status normaliza counts por
-- contrato; as 3 views novas (v_portfolio_*_lei14133) fazem JOIN e agregam.
--
-- Por que views separadas (sufixo _lei14133):
--   - Mantém v_portfolio_by_program (V12) intacta — outras consumers herdam
--   - UI Portfolio pode consumir AMBAS via JOIN client-side
--   - Mais fácil deprecar/migrar no futuro sem breaking changes
--
-- KPIs por agrupamento:
--   vicios_abertos              — contract_receipt_vicios em aberto/em_saneamento
--   pars_em_curso               — PARs em workflow ativo
--   garantias_vencendo_30d      — garantias ativas com vigência ≤30 dias
--   multas_pendentes_count      — multas não pagas (qualquer valor)
--   sancoes_graves_ativas       — impedimento/inidoneidade ativos
-- =============================================================================

-- =============================================================================
-- View auxiliar: 1 linha por contrato com counts dos 5 KPIs Lei 14.133
-- =============================================================================
CREATE OR REPLACE VIEW public.v_contract_lei14133_status AS
SELECT
  c.id AS contract_id,
  c.tenant_id,
  -- Vícios abertos
  (SELECT count(*)::int
     FROM public.contract_receipt_vicios v
     JOIN public.contract_receipts r ON r.id = v.receipt_id
    WHERE r.contract_id = c.id
      AND v.status IN ('aberto','em_saneamento')
  ) AS vicios_abertos,
  -- PARs em curso (workflow ativo)
  (SELECT count(*)::int
     FROM public.contract_par_processes p
    WHERE p.contract_id = c.id
      AND p.status IN ('rascunho','instaurado','em_defesa','em_instrucao',
                       'em_julgamento','decidido','em_recurso')
  ) AS pars_em_curso,
  -- Garantias vencendo em ≤30 dias
  (SELECT count(*)::int
     FROM public.contract_guarantees g
    WHERE g.contract_id = c.id
      AND g.status IN ('ativa','estendida')
      AND g.data_vigencia_fim BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
  ) AS garantias_vencendo_30d,
  -- Multas pendentes (não pagas, ativas/suspensas)
  (SELECT count(*)::int
     FROM public.contract_sanctions s
    WHERE s.contract_id = c.id
      AND s.tipo = 'multa'
      AND s.status IN ('ativa','suspensa')
      AND s.data_pagamento_multa IS NULL
  ) AS multas_pendentes_count,
  -- Valor total de multas pendentes
  (SELECT coalesce(sum(valor_multa), 0)
     FROM public.contract_sanctions s
    WHERE s.contract_id = c.id
      AND s.tipo = 'multa'
      AND s.status IN ('ativa','suspensa')
      AND s.data_pagamento_multa IS NULL
  ) AS multas_pendentes_valor,
  -- Sanções graves ativas (impedimento + inidoneidade)
  (SELECT count(*)::int
     FROM public.contract_sanctions s
    WHERE s.contract_id = c.id
      AND s.status = 'ativa'
      AND s.tipo IN ('impedimento','inidoneidade')
  ) AS sancoes_graves_ativas
FROM public.contracts c
WHERE c.deleted_at IS NULL;

GRANT SELECT ON public.v_contract_lei14133_status TO authenticated, service_role;

-- =============================================================================
-- Portfolio por programa estendido
-- =============================================================================
CREATE OR REPLACE VIEW public.v_portfolio_by_program_lei14133 AS
SELECT
  c.tenant_id,
  c.program_id,
  count(*)::int AS contratos_count,
  coalesce(sum(s.vicios_abertos), 0)::int            AS vicios_abertos,
  coalesce(sum(s.pars_em_curso), 0)::int             AS pars_em_curso,
  coalesce(sum(s.garantias_vencendo_30d), 0)::int    AS garantias_vencendo_30d,
  coalesce(sum(s.multas_pendentes_count), 0)::int    AS multas_pendentes_count,
  coalesce(sum(s.multas_pendentes_valor), 0)         AS multas_pendentes_valor,
  coalesce(sum(s.sancoes_graves_ativas), 0)::int     AS sancoes_graves_ativas,
  -- contratos críticos: ao menos um KPI positivo
  count(*) FILTER (
    WHERE s.vicios_abertos > 0 OR s.pars_em_curso > 0
       OR s.garantias_vencendo_30d > 0 OR s.multas_pendentes_count > 0
       OR s.sancoes_graves_ativas > 0
  )::int AS contratos_criticos
FROM public.contracts c
LEFT JOIN public.v_contract_lei14133_status s ON s.contract_id = c.id
WHERE c.deleted_at IS NULL
GROUP BY c.tenant_id, c.program_id;

GRANT SELECT ON public.v_portfolio_by_program_lei14133 TO authenticated;

-- =============================================================================
-- Portfolio por órgão estendido
-- =============================================================================
CREATE OR REPLACE VIEW public.v_portfolio_by_orgao_lei14133 AS
SELECT
  c.tenant_id,
  coalesce(p.orgao, org.nome) AS orgao,
  count(*)::int AS contratos_count,
  coalesce(sum(s.vicios_abertos), 0)::int            AS vicios_abertos,
  coalesce(sum(s.pars_em_curso), 0)::int             AS pars_em_curso,
  coalesce(sum(s.garantias_vencendo_30d), 0)::int    AS garantias_vencendo_30d,
  coalesce(sum(s.multas_pendentes_count), 0)::int    AS multas_pendentes_count,
  coalesce(sum(s.multas_pendentes_valor), 0)         AS multas_pendentes_valor,
  coalesce(sum(s.sancoes_graves_ativas), 0)::int     AS sancoes_graves_ativas,
  count(*) FILTER (
    WHERE s.vicios_abertos > 0 OR s.pars_em_curso > 0
       OR s.garantias_vencendo_30d > 0 OR s.multas_pendentes_count > 0
       OR s.sancoes_graves_ativas > 0
  )::int AS contratos_criticos
FROM public.contracts c
LEFT JOIN public.programs p             ON p.id = c.program_id
LEFT JOIN public.contract_organizations org ON org.id = c.contratante_id
LEFT JOIN public.v_contract_lei14133_status s ON s.contract_id = c.id
WHERE c.deleted_at IS NULL
GROUP BY c.tenant_id, coalesce(p.orgao, org.nome);

GRANT SELECT ON public.v_portfolio_by_orgao_lei14133 TO authenticated;

-- =============================================================================
-- Portfolio por município estendido
-- =============================================================================
-- Município vem de contract_locations (1 contrato pode ter N localidades; sigo
-- mesmo padrão de v_portfolio_by_municipio V12: 1 linha por (contrato × local))
CREATE OR REPLACE VIEW public.v_portfolio_by_municipio_lei14133 AS
SELECT
  c.tenant_id,
  cl.uf,
  cl.municipio,
  count(DISTINCT c.id)::int AS contratos_count,
  coalesce(sum(s.vicios_abertos), 0)::int            AS vicios_abertos,
  coalesce(sum(s.pars_em_curso), 0)::int             AS pars_em_curso,
  coalesce(sum(s.garantias_vencendo_30d), 0)::int    AS garantias_vencendo_30d,
  coalesce(sum(s.multas_pendentes_count), 0)::int    AS multas_pendentes_count,
  coalesce(sum(s.multas_pendentes_valor), 0)         AS multas_pendentes_valor,
  coalesce(sum(s.sancoes_graves_ativas), 0)::int     AS sancoes_graves_ativas,
  count(DISTINCT c.id) FILTER (
    WHERE s.vicios_abertos > 0 OR s.pars_em_curso > 0
       OR s.garantias_vencendo_30d > 0 OR s.multas_pendentes_count > 0
       OR s.sancoes_graves_ativas > 0
  )::int AS contratos_criticos
FROM public.contracts c
JOIN public.contract_locations cl ON cl.contract_id = c.id
LEFT JOIN public.v_contract_lei14133_status s ON s.contract_id = c.id
WHERE c.deleted_at IS NULL
  AND cl.deleted_at IS NULL
  AND cl.uf IS NOT NULL AND cl.municipio IS NOT NULL
GROUP BY c.tenant_id, cl.uf, cl.municipio;

GRANT SELECT ON public.v_portfolio_by_municipio_lei14133 TO authenticated;

-- =============================================================================
-- RPC: get_tenant_lei14133_kpis_total
--   Totaliza todos os KPIs do tenant em 1 chamada (pra usar nos KPI cards no
--   topo da página Portfolio, agregado de todos os agrupamentos)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_tenant_lei14133_kpis()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'vicios_abertos',          coalesce(sum(vicios_abertos), 0)::int,
    'pars_em_curso',           coalesce(sum(pars_em_curso), 0)::int,
    'garantias_vencendo_30d',  coalesce(sum(garantias_vencendo_30d), 0)::int,
    'multas_pendentes_count',  coalesce(sum(multas_pendentes_count), 0)::int,
    'multas_pendentes_valor',  coalesce(sum(multas_pendentes_valor), 0),
    'sancoes_graves_ativas',   coalesce(sum(sancoes_graves_ativas), 0)::int,
    'contratos_criticos',
      coalesce(count(*) FILTER (
        WHERE vicios_abertos > 0 OR pars_em_curso > 0
           OR garantias_vencendo_30d > 0 OR multas_pendentes_count > 0
           OR sancoes_graves_ativas > 0
      ), 0)::int,
    'contratos_total',         count(*)::int
  )
  FROM public.v_contract_lei14133_status
  WHERE tenant_id = public.current_tenant_id();
$$;
GRANT EXECUTE ON FUNCTION public.get_tenant_lei14133_kpis() TO authenticated;

COMMENT ON VIEW public.v_contract_lei14133_status IS
  'Status Lei 14.133 por contrato (1 linha por contrato). 5 KPIs: '
  'vícios abertos · PARs em curso · garantias vencendo ≤30d · multas pendentes · sanções graves ativas.';
COMMENT ON VIEW public.v_portfolio_by_program_lei14133 IS
  'Carteira por programa estendida com 5 KPIs Lei 14.133 agregados + contratos_criticos.';
