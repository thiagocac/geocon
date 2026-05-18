-- =============================================================================
-- 052_sanctioned_suppliers
-- =============================================================================
-- Cadastro de fornecedores sancionados (cross-contract).
--
-- Agrega contract_sanctions (V38) por CNPJ da contratada (contract_organizations),
-- permitindo consulta única do histórico de sanções de um fornecedor em todo
-- o tenant. Útil para próximas licitações, due diligence e exportação para
-- cadastros nacionais (CEIS/CNEP).
--
-- View principal: v_sanctioned_suppliers
--   - 1 linha por CNPJ contratada com sanção registrada
--   - Agrega contagens por tipo (adv, multa, imped, inid), status e severity
--   - Inclui status atual: "ativo" se há sanção ativa, "histórico" caso contrário
--
-- RPCs:
--   list_sanctioned_suppliers(filtros) — para tabela principal
--   get_sanctioned_supplier_detail(cnpj) — detalhe expandido por CNPJ
--   check_cnpj_sanctioned(cnpj) — verificação rápida (sim/não) para licitações
-- =============================================================================

-- =============================================================================
-- View principal: v_sanctioned_suppliers
-- =============================================================================
CREATE OR REPLACE VIEW public.v_sanctioned_suppliers AS
WITH supplier_base AS (
  -- Toma o NOME mais recente para cada CNPJ (CNPJ pode aparecer com nomes
  -- ligeiramente diferentes em contratos distintos)
  SELECT DISTINCT ON (o.tenant_id, o.cnpj)
    o.tenant_id,
    o.cnpj,
    o.nome     AS nome_recente,
    o.id       AS organization_id,
    o.email,
    o.telefone
  FROM public.contract_organizations o
  WHERE o.cnpj IS NOT NULL
    AND trim(o.cnpj) <> ''
    AND o.deleted_at IS NULL
  ORDER BY o.tenant_id, o.cnpj, o.updated_at DESC
),
sanction_agg AS (
  SELECT
    c.tenant_id,
    o.cnpj,
    -- Contagens totais
    count(s.*)::int                                            AS sancoes_total,
    count(s.*) FILTER (WHERE s.status = 'ativa')::int          AS sancoes_ativas,
    count(s.*) FILTER (WHERE s.status = 'cumprida')::int       AS sancoes_cumpridas,
    count(s.*) FILTER (WHERE s.status = 'suspensa')::int       AS sancoes_suspensas,
    count(s.*) FILTER (WHERE s.status = 'revogada')::int       AS sancoes_revogadas,
    -- Contagens por tipo
    count(s.*) FILTER (WHERE s.tipo = 'advertencia')::int      AS qt_advertencia,
    count(s.*) FILTER (WHERE s.tipo = 'multa')::int            AS qt_multa,
    count(s.*) FILTER (WHERE s.tipo = 'impedimento')::int      AS qt_impedimento,
    count(s.*) FILTER (WHERE s.tipo = 'inidoneidade')::int     AS qt_inidoneidade,
    -- Ativos por gravidade (mais relevante pra licitações)
    count(s.*) FILTER (WHERE s.tipo = 'impedimento'  AND s.status = 'ativa')::int AS impedimento_ativo,
    count(s.*) FILTER (WHERE s.tipo = 'inidoneidade' AND s.status = 'ativa')::int AS inidoneidade_ativa,
    -- Financeiro (multas)
    coalesce(sum(s.valor_multa) FILTER (WHERE s.tipo = 'multa'), 0)
                                                              AS multa_total,
    coalesce(sum(s.valor_multa) FILTER (WHERE s.tipo = 'multa' AND s.data_pagamento_multa IS NOT NULL), 0)
                                                              AS multa_paga,
    coalesce(sum(s.valor_multa) FILTER (WHERE s.tipo = 'multa' AND s.status IN ('ativa','suspensa') AND s.data_pagamento_multa IS NULL), 0)
                                                              AS multa_pendente,
    -- Temporal
    min(s.data_aplicacao)                                      AS primeira_sancao,
    max(s.data_aplicacao)                                      AS ultima_sancao,
    -- Vigência ativa: maior vigencia_fim entre sanções ativas com vigência
    max(s.vigencia_fim) FILTER (WHERE s.status = 'ativa' AND s.vigencia_fim IS NOT NULL)
                                                              AS vigencia_fim_ativa,
    -- Contratos distintos afetados
    count(DISTINCT s.contract_id)::int                         AS contratos_distintos
  FROM public.contract_sanctions s
  JOIN public.contracts c ON c.id = s.contract_id
  JOIN public.contract_organizations o ON o.id = c.contratada_id
  WHERE c.deleted_at IS NULL
    AND o.deleted_at IS NULL
    AND o.cnpj IS NOT NULL
    AND trim(o.cnpj) <> ''
  GROUP BY c.tenant_id, o.cnpj
)
SELECT
  sa.tenant_id,
  sa.cnpj,
  sb.nome_recente                AS nome,
  sb.organization_id,
  sb.email,
  sb.telefone,
  -- Status agregado: "ativo" se tem qualquer sanção ativa, senão "histórico"
  CASE
    WHEN sa.sancoes_ativas > 0 THEN 'ativo'
    ELSE 'historico'
  END                            AS status_agregado,
  -- Severidade máxima: impedimento/inidoneidade > multa > advertência
  CASE
    WHEN sa.inidoneidade_ativa > 0 THEN 'critica'
    WHEN sa.impedimento_ativo > 0  THEN 'alta'
    WHEN sa.sancoes_ativas > 0 AND sa.qt_multa > 0 THEN 'media'
    WHEN sa.sancoes_ativas > 0     THEN 'baixa'
    ELSE 'nenhuma'
  END                            AS severidade_atual,
  sa.sancoes_total,
  sa.sancoes_ativas,
  sa.sancoes_cumpridas,
  sa.sancoes_suspensas,
  sa.sancoes_revogadas,
  sa.qt_advertencia,
  sa.qt_multa,
  sa.qt_impedimento,
  sa.qt_inidoneidade,
  sa.impedimento_ativo,
  sa.inidoneidade_ativa,
  sa.multa_total,
  sa.multa_paga,
  sa.multa_pendente,
  sa.primeira_sancao,
  sa.ultima_sancao,
  sa.vigencia_fim_ativa,
  sa.contratos_distintos
FROM sanction_agg sa
JOIN supplier_base sb ON sb.tenant_id = sa.tenant_id AND sb.cnpj = sa.cnpj;

GRANT SELECT ON public.v_sanctioned_suppliers TO authenticated, service_role;

COMMENT ON VIEW public.v_sanctioned_suppliers IS
  'Cadastro de fornecedores sancionados (cross-contract). 1 linha por CNPJ '
  'contratada com sanção registrada. Agrega counts por tipo/status/severity. '
  'V45 · feed para próximas licitações e exportação CEIS/CNEP.';

-- =============================================================================
-- RPC: list_sanctioned_suppliers
-- Filtros: severidade · status_agregado · q (busca por nome/cnpj) · only_active
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_sanctioned_suppliers(
  p_severidade      text[] DEFAULT NULL,  -- 'critica','alta','media','baixa'
  p_status          text[] DEFAULT NULL,  -- 'ativo','historico'
  p_q               text   DEFAULT NULL,  -- busca CNPJ ou nome (ILIKE)
  p_only_with_active boolean DEFAULT false,
  p_limit           int    DEFAULT 200
)
RETURNS TABLE (
  cnpj                  text,
  nome                  text,
  organization_id       uuid,
  email                 text,
  telefone              text,
  status_agregado       text,
  severidade_atual      text,
  sancoes_total         int,
  sancoes_ativas        int,
  qt_advertencia        int,
  qt_multa              int,
  qt_impedimento        int,
  qt_inidoneidade       int,
  impedimento_ativo     int,
  inidoneidade_ativa    int,
  multa_pendente        numeric,
  primeira_sancao       date,
  ultima_sancao         date,
  vigencia_fim_ativa    date,
  dias_ate_vencimento   int,
  contratos_distintos   int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.cnpj, v.nome, v.organization_id, v.email, v.telefone,
    v.status_agregado, v.severidade_atual,
    v.sancoes_total, v.sancoes_ativas,
    v.qt_advertencia, v.qt_multa, v.qt_impedimento, v.qt_inidoneidade,
    v.impedimento_ativo, v.inidoneidade_ativa,
    v.multa_pendente,
    v.primeira_sancao, v.ultima_sancao, v.vigencia_fim_ativa,
    CASE WHEN v.vigencia_fim_ativa IS NULL THEN NULL
         ELSE (v.vigencia_fim_ativa - current_date)::int
    END AS dias_ate_vencimento,
    v.contratos_distintos
  FROM public.v_sanctioned_suppliers v
  WHERE v.tenant_id = public.current_tenant_id()
    AND (p_severidade IS NULL OR v.severidade_atual = ANY(p_severidade))
    AND (p_status     IS NULL OR v.status_agregado  = ANY(p_status))
    AND (NOT p_only_with_active OR v.sancoes_ativas > 0)
    AND (
      p_q IS NULL OR trim(p_q) = ''
      OR v.cnpj ILIKE '%' || trim(p_q) || '%'
      OR v.nome ILIKE '%' || trim(p_q) || '%'
    )
  ORDER BY
    -- Ordena críticos primeiro
    CASE v.severidade_atual
      WHEN 'critica' THEN 1
      WHEN 'alta'    THEN 2
      WHEN 'media'   THEN 3
      WHEN 'baixa'   THEN 4
      ELSE 5
    END,
    v.ultima_sancao DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(p_limit, 200), 500));
$$;
GRANT EXECUTE ON FUNCTION public.list_sanctioned_suppliers(text[], text[], text, boolean, int) TO authenticated;

-- =============================================================================
-- RPC: get_sanctioned_supplier_detail(cnpj)
-- Retorna detalhe expandido: agregação + sanções individuais + contratos
-- afetados
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_sanctioned_supplier_detail(p_cnpj text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_summary jsonb;
  v_sanctions jsonb;
  v_contracts jsonb;
BEGIN
  v_tenant := public.current_tenant_id();

  IF p_cnpj IS NULL OR trim(p_cnpj) = '' THEN
    RAISE EXCEPTION 'CNPJ é obrigatório';
  END IF;

  -- Summary da view
  SELECT to_jsonb(v) INTO v_summary
  FROM public.v_sanctioned_suppliers v
  WHERE v.tenant_id = v_tenant AND v.cnpj = trim(p_cnpj);

  IF v_summary IS NULL THEN
    RAISE EXCEPTION 'Fornecedor não encontrado ou sem sanções registradas';
  END IF;

  -- Sanções individuais (ordenadas por data_aplicacao DESC)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',                  s.id,
    'numero',              s.numero,
    'contract_id',         s.contract_id,
    'contract_numero',     c.numero,
    'contract_titulo',     c.titulo,
    'tipo',                s.tipo,
    'status',              s.status,
    'data_aplicacao',      s.data_aplicacao,
    'documento_aplicacao', s.documento_aplicacao,
    'fundamentacao',       s.fundamentacao,
    'par_id',              s.par_id,
    'valor_multa',         s.valor_multa,
    'data_pagamento_multa',s.data_pagamento_multa,
    'vigencia_inicio',     s.vigencia_inicio,
    'vigencia_fim',        s.vigencia_fim,
    'duracao_meses',       s.duracao_meses,
    'dias_ate_vencimento', CASE WHEN s.vigencia_fim IS NULL THEN NULL
                                ELSE (s.vigencia_fim - current_date)::int END
  ) ORDER BY s.data_aplicacao DESC), '[]'::jsonb)
  INTO v_sanctions
  FROM public.contract_sanctions s
  JOIN public.contracts c ON c.id = s.contract_id
  JOIN public.contract_organizations o ON o.id = c.contratada_id
  WHERE c.tenant_id = v_tenant
    AND c.deleted_at IS NULL
    AND o.cnpj = trim(p_cnpj);

  -- Contratos distintos afetados
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object(
    'id',     c.id,
    'numero', c.numero,
    'titulo', c.titulo,
    'status', c.status,
    'valor_total_atual', c.valor_total_atual
  )), '[]'::jsonb)
  INTO v_contracts
  FROM public.contract_sanctions s
  JOIN public.contracts c ON c.id = s.contract_id
  JOIN public.contract_organizations o ON o.id = c.contratada_id
  WHERE c.tenant_id = v_tenant
    AND c.deleted_at IS NULL
    AND o.cnpj = trim(p_cnpj);

  RETURN jsonb_build_object(
    'summary',   v_summary,
    'sanctions', v_sanctions,
    'contracts', v_contracts
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_sanctioned_supplier_detail(text) TO authenticated;

-- =============================================================================
-- RPC: check_cnpj_sanctioned(cnpj)
-- Verificação rápida: o CNPJ tem alguma sanção ativa que impeça contratação?
-- Útil para integração com fluxo de licitação / nova contratação.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_cnpj_sanctioned(p_cnpj text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_v_row record;
BEGIN
  v_tenant := public.current_tenant_id();

  IF p_cnpj IS NULL OR trim(p_cnpj) = '' THEN
    RAISE EXCEPTION 'CNPJ é obrigatório';
  END IF;

  SELECT
    cnpj, nome, status_agregado, severidade_atual,
    impedimento_ativo, inidoneidade_ativa, sancoes_ativas,
    vigencia_fim_ativa, ultima_sancao
  INTO v_v_row
  FROM public.v_sanctioned_suppliers
  WHERE tenant_id = v_tenant AND cnpj = trim(p_cnpj);

  IF v_v_row IS NULL THEN
    RETURN jsonb_build_object(
      'cnpj',           trim(p_cnpj),
      'found',          false,
      'pode_contratar', true,
      'severidade',     'nenhuma'
    );
  END IF;

  RETURN jsonb_build_object(
    'cnpj',                 v_v_row.cnpj,
    'nome',                 v_v_row.nome,
    'found',                true,
    'pode_contratar',
      (v_v_row.impedimento_ativo = 0 AND v_v_row.inidoneidade_ativa = 0),
    'severidade',           v_v_row.severidade_atual,
    'status_agregado',      v_v_row.status_agregado,
    'sancoes_ativas',       v_v_row.sancoes_ativas,
    'impedimento_ativo',    v_v_row.impedimento_ativo,
    'inidoneidade_ativa',   v_v_row.inidoneidade_ativa,
    'vigencia_fim_ativa',   v_v_row.vigencia_fim_ativa,
    'ultima_sancao',        v_v_row.ultima_sancao,
    'motivo_bloqueio',
      CASE
        WHEN v_v_row.inidoneidade_ativa > 0 THEN
          format('Declaração de inidoneidade ativa%s',
            CASE WHEN v_v_row.vigencia_fim_ativa IS NOT NULL
                 THEN ' até ' || to_char(v_v_row.vigencia_fim_ativa, 'DD/MM/YYYY')
                 ELSE '' END)
        WHEN v_v_row.impedimento_ativo > 0 THEN
          format('Impedimento de licitar/contratar ativo%s',
            CASE WHEN v_v_row.vigencia_fim_ativa IS NOT NULL
                 THEN ' até ' || to_char(v_v_row.vigencia_fim_ativa, 'DD/MM/YYYY')
                 ELSE '' END)
        ELSE NULL
      END
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_cnpj_sanctioned(text) TO authenticated;

-- =============================================================================
-- RPC: get_sanctioned_suppliers_summary
-- KPIs do cadastro (para header da página)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_sanctioned_suppliers_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_total int;
  v_ativos int;
  v_criticos int;
  v_altos int;
  v_medios int;
  v_baixos int;
  v_impedimento_ativos int;
  v_inidoneidade_ativos int;
  v_multa_pendente_total numeric;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status_agregado = 'ativo')::int,
    count(*) FILTER (WHERE severidade_atual = 'critica')::int,
    count(*) FILTER (WHERE severidade_atual = 'alta')::int,
    count(*) FILTER (WHERE severidade_atual = 'media')::int,
    count(*) FILTER (WHERE severidade_atual = 'baixa')::int,
    coalesce(sum(impedimento_ativo), 0)::int,
    coalesce(sum(inidoneidade_ativa), 0)::int,
    coalesce(sum(multa_pendente), 0)
  INTO v_total, v_ativos, v_criticos, v_altos, v_medios, v_baixos,
       v_impedimento_ativos, v_inidoneidade_ativos, v_multa_pendente_total
  FROM public.v_sanctioned_suppliers
  WHERE tenant_id = v_tenant;

  RETURN jsonb_build_object(
    'total',                  v_total,
    'com_sancao_ativa',       v_ativos,
    'por_severidade', jsonb_build_object(
      'critica', v_criticos,
      'alta',    v_altos,
      'media',   v_medios,
      'baixa',   v_baixos
    ),
    'impedimentos_ativos',    v_impedimento_ativos,
    'inidoneidades_ativas',   v_inidoneidade_ativos,
    'multa_pendente_total',   v_multa_pendente_total
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_sanctioned_suppliers_summary() TO authenticated;
