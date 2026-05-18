-- =============================================================================
-- 047_pendencias_lei14133
-- =============================================================================
-- Estende v_pendencias (criada em 012) adicionando 5 novos tipos de pendência
-- vindos dos institutos V35-V38:
--
--   vicio_aberto                  — V35 · contract_receipt_vicios em aberto
--   par_defesa                    — V37 · PAR em fase de defesa
--   garantia_vencendo             — V36 · garantias ativas vencendo ≤60d
--   sancao_multa_pendente         — V38 · multas não pagas
--   recebimento_definitivo_atrasado — V35 · provisórios sem definitivo após limite
--
-- Reusa o schema da view existente (tenant_id, contract_id, contract_numero,
-- pendencia_tipo, entity_id, descricao, desde, dias_aberta, severidade).
--
-- Schema sem mudanças: view DROPada+criada (CREATE OR REPLACE não basta porque
-- não estamos adicionando colunas, mas sim novas UNION ALL). Idempotente.
-- =============================================================================

DROP VIEW IF EXISTS public.v_pendencias CASCADE;

CREATE VIEW public.v_pendencias AS

-- =============================================================================
-- 1. Medições em aprovação (original V12)
-- =============================================================================
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

-- =============================================================================
-- 2. GRDs enviadas sem confirmação (original V12)
-- =============================================================================
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

-- =============================================================================
-- 3. Itens não previstos em análise (original V12)
-- =============================================================================
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

-- =============================================================================
-- 4. Contratos com risk_flags high (original V12)
-- =============================================================================
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
  )

UNION ALL

-- =============================================================================
-- 5. Vícios abertos em recebimentos (V35 · art. 140)
-- =============================================================================
-- Severidade: high se severidade do vício é alta/crítica OU prazo de
-- saneamento já vencido; medium senão
SELECT
  r.tenant_id, r.contract_id, c.numero AS contract_numero,
  'vicio_aberto'::text AS pendencia_tipo,
  v.id AS entity_id,
  'Vício em Recebimento #' || r.numero || ' (' || v.severidade || '): ' ||
    coalesce(left(v.descricao, 80), '—') ||
    CASE
      WHEN v.data_limite_saneamento IS NULL THEN ''
      WHEN v.data_limite_saneamento < CURRENT_DATE THEN
        ' · saneamento vencido há ' || (CURRENT_DATE - v.data_limite_saneamento) || 'd'
      ELSE
        ' · saneamento em ' || (v.data_limite_saneamento - CURRENT_DATE) || 'd'
    END AS descricao,
  v.created_at::text AS desde,
  (CURRENT_DATE - v.created_at::date)::int AS dias_aberta,
  CASE
    WHEN v.severidade IN ('alta','critica')                                      THEN 'high'
    WHEN v.data_limite_saneamento IS NOT NULL AND v.data_limite_saneamento < CURRENT_DATE THEN 'high'
    WHEN (CURRENT_DATE - v.created_at::date) > 20                                THEN 'medium'
    ELSE 'low'
  END AS severidade
FROM public.contract_receipt_vicios v
JOIN public.contract_receipts r ON r.id = v.receipt_id
JOIN public.contracts c ON c.id = r.contract_id
WHERE v.status IN ('aberto','em_saneamento')
  AND c.deleted_at IS NULL

UNION ALL

-- =============================================================================
-- 6. PARs em fase de defesa com prazo próximo/vencido (V37 · art. 158)
-- =============================================================================
SELECT
  p.tenant_id, p.contract_id, c.numero AS contract_numero,
  'par_defesa'::text AS pendencia_tipo,
  p.id AS entity_id,
  'PAR #' || p.numero || ' em defesa · ' ||
    CASE
      WHEN p.defesa_prazo_limite IS NULL THEN 'sem prazo definido'
      WHEN p.defesa_prazo_limite < CURRENT_DATE THEN
        'prazo vencido há ' || (CURRENT_DATE - p.defesa_prazo_limite) || 'd'
      ELSE
        'prazo em ' || (p.defesa_prazo_limite - CURRENT_DATE) || 'd'
    END AS descricao,
  coalesce(p.instaurado_at::text, p.created_at::text) AS desde,
  (CURRENT_DATE - coalesce(p.instaurado_at::date, p.created_at::date))::int AS dias_aberta,
  CASE
    WHEN p.defesa_prazo_limite IS NOT NULL AND p.defesa_prazo_limite < CURRENT_DATE THEN 'high'
    WHEN p.defesa_prazo_limite IS NOT NULL AND (p.defesa_prazo_limite - CURRENT_DATE) <= 7 THEN 'high'
    WHEN p.defesa_prazo_limite IS NOT NULL AND (p.defesa_prazo_limite - CURRENT_DATE) <= 14 THEN 'medium'
    ELSE 'low'
  END AS severidade
FROM public.contract_par_processes p
JOIN public.contracts c ON c.id = p.contract_id
WHERE p.status = 'em_defesa'
  AND c.deleted_at IS NULL

UNION ALL

-- =============================================================================
-- 7. Garantias vencendo em ≤60 dias (V36 · art. 96-101)
-- =============================================================================
SELECT
  g.tenant_id, g.contract_id, c.numero AS contract_numero,
  'garantia_vencendo'::text AS pendencia_tipo,
  g.id AS entity_id,
  'Garantia #' || g.numero || ' (' || g.modalidade || ') ' ||
    CASE
      WHEN g.data_vigencia_fim < CURRENT_DATE THEN
        'vencida há ' || (CURRENT_DATE - g.data_vigencia_fim) || 'd'
      ELSE
        'vence em ' || (g.data_vigencia_fim - CURRENT_DATE) || 'd (' ||
        to_char(g.data_vigencia_fim, 'DD/MM/YYYY') || ')'
    END AS descricao,
  g.data_vigencia_fim::text AS desde,
  GREATEST(0, (g.data_vigencia_fim - g.data_vigencia_inicio))::int AS dias_aberta,
  CASE
    WHEN g.data_vigencia_fim < CURRENT_DATE                            THEN 'high'
    WHEN (g.data_vigencia_fim - CURRENT_DATE) <= 7                     THEN 'high'
    WHEN (g.data_vigencia_fim - CURRENT_DATE) <= 30                    THEN 'medium'
    ELSE 'low'
  END AS severidade
FROM public.contract_guarantees g
JOIN public.contracts c ON c.id = g.contract_id
WHERE g.status IN ('ativa','estendida')
  AND g.data_vigencia_fim <= CURRENT_DATE + INTERVAL '60 days'
  AND c.deleted_at IS NULL

UNION ALL

-- =============================================================================
-- 8. Multas pendentes (V38 · art. 156 II)
-- =============================================================================
SELECT
  s.tenant_id, s.contract_id, c.numero AS contract_numero,
  'sancao_multa_pendente'::text AS pendencia_tipo,
  s.id AS entity_id,
  'Multa Sanção #' || s.numero || ' · R$ ' ||
    trim(both '0' from to_char(coalesce(s.valor_multa, 0), 'FM999G999G990D00')) ||
    CASE
      WHEN s.data_vencimento_multa IS NULL THEN ' · sem vencimento'
      WHEN s.data_vencimento_multa < CURRENT_DATE THEN
        ' · vencida há ' || (CURRENT_DATE - s.data_vencimento_multa) || 'd'
      ELSE
        ' · vence em ' || (s.data_vencimento_multa - CURRENT_DATE) || 'd'
    END AS descricao,
  s.data_aplicacao::text AS desde,
  (CURRENT_DATE - s.data_aplicacao)::int AS dias_aberta,
  CASE
    WHEN s.valor_multa > 100000                                                          THEN 'high'
    WHEN s.data_vencimento_multa IS NOT NULL AND s.data_vencimento_multa < CURRENT_DATE  THEN 'high'
    WHEN s.data_vencimento_multa IS NOT NULL AND (s.data_vencimento_multa - CURRENT_DATE) <= 15 THEN 'medium'
    ELSE 'low'
  END AS severidade
FROM public.contract_sanctions s
JOIN public.contracts c ON c.id = s.contract_id
WHERE s.tipo = 'multa'
  AND s.status IN ('ativa','suspensa')
  AND s.data_pagamento_multa IS NULL
  AND c.deleted_at IS NULL

UNION ALL

-- =============================================================================
-- 9. Recebimentos definitivos atrasados (V35 · art. 140)
-- =============================================================================
-- Provisórios cujo data_limite_definitivo já passou e sem definitivo emitido
SELECT
  r.tenant_id, r.contract_id, c.numero AS contract_numero,
  'recebimento_definitivo_atrasado'::text AS pendencia_tipo,
  r.id AS entity_id,
  'Recebimento provisório #' || r.numero || ' sem definitivo · ' ||
    'limite vencido há ' || (CURRENT_DATE - r.data_limite_definitivo) || 'd' AS descricao,
  r.data_limite_definitivo::text AS desde,
  (CURRENT_DATE - r.data_limite_definitivo)::int AS dias_aberta,
  'high'::text AS severidade  -- art. 140 § 3º — sempre crítico passar do limite
FROM public.contract_receipts r
JOIN public.contracts c ON c.id = r.contract_id
WHERE r.tipo = 'provisorio'
  AND r.status IN ('emitido','sanado')
  AND r.data_limite_definitivo IS NOT NULL
  AND r.data_limite_definitivo < CURRENT_DATE
  AND NOT EXISTS (
    SELECT 1 FROM public.contract_receipts r2
    WHERE r2.provisorio_id = r.id
      AND r2.tipo = 'definitivo'
      AND r2.status IN ('emitido','sanado')
  )
  AND c.deleted_at IS NULL;

GRANT SELECT ON public.v_pendencias TO authenticated;

-- =============================================================================
-- Comentário documentacional
-- =============================================================================
COMMENT ON VIEW public.v_pendencias IS
  'Caixa de saída executiva multi-tenant. 9 fontes consolidadas: '
  'medições em aprovação · GRDs sem confirmação · itens não previstos · risco · '
  'vícios abertos (V35) · PARs em defesa (V37) · garantias vencendo (V36) · '
  'multas pendentes (V38) · recebimentos definitivos atrasados (V35). '
  'Severidades unificadas (low/medium/high) com critérios por tipo.';
