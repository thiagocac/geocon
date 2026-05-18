-- =============================================================================
-- 045_contract_timeline
-- =============================================================================
-- Timeline cronológica unificada dos 9 institutos da Lei 14.133.
--
-- A view v_contract_timeline normaliza eventos de:
--   * additives                       (Aditivos · art. 125)
--   * unforeseen_items                (Itens não previstos · art. 125)
--   * measurements                    (Medições · pgto base)
--   * contract_reajuste_events        (Reajuste · V30-V32 · art. 25/92/124-127)
--   * contract_repactuacao_events     (Repactuação · V33 · art. 135)
--   * contract_reequilibrio_requests  (Reequilíbrio · V34 · art. 124)
--   * contract_receipts               (Recebimentos · V35 · art. 140)
--   * contract_guarantee_events       (Garantias · V36 · art. 96-101)
--   * contract_par_steps              (PAR · V37 · art. 158)
--   * contract_sanction_events        (Sanções · V38 · art. 156)
--
-- Schema comum:
--   event_kind     · qual módulo gerou
--   event_subtype  · subtipo dentro do módulo (ex: "aplicacao" em sanção)
--   event_date     · data canônica do evento (date)
--   event_at       · timestamp completo
--   title          · texto principal (ex: "Aditivo #3 · valor")
--   subtitle       · linha auxiliar (ex: "+R$ 1.250.000")
--   severity       · info | warning | danger | success | neutral
--   valor          · numeric nullable (consolidação financeira)
--   ref_id         · id do registro original (pra navegação)
--   ref_link       · subpath relativo (ex: '/aditivos')
--   actor_name     · quem causou (best-effort)
--
-- RPC: list_contract_timeline(p_contract_id, p_kinds, p_from, p_to, p_severity, p_limit)
-- =============================================================================

CREATE OR REPLACE VIEW public.v_contract_timeline AS

-- =============================================================================
-- 1. Additives — 1 evento por aditivo (criação)
-- =============================================================================
SELECT
  a.tenant_id,
  a.contract_id,
  'additive'::text       AS event_kind,
  a.tipo                 AS event_subtype,
  coalesce(a.data_aprovacao, a.data_solicitacao, a.created_at::date) AS event_date,
  a.created_at           AS event_at,
  format('Aditivo #%s · %s', a.numero, a.tipo) AS title,
  format('Líquido: R$ %s · status %s',
         trim(both '0' from to_char(a.valor_liquido, 'FM999G999G990D00')),
         a.status)       AS subtitle,
  CASE a.status
    WHEN 'aprovado' THEN 'success'
    WHEN 'cancelado' THEN 'neutral'
    WHEN 'rejeitado' THEN 'danger'
    ELSE 'info'
  END                    AS severity,
  a.valor_liquido        AS valor,
  a.id                   AS ref_id,
  '/aditivos'::text      AS ref_link,
  (SELECT m.nome FROM public.members m WHERE m.id = a.created_by) AS actor_name
FROM public.additives a

UNION ALL

-- =============================================================================
-- 2. Unforeseen items — 1 evento por item criado
-- =============================================================================
-- Schema real: data_abertura/opened_by/status 9 valores
SELECT
  u.tenant_id,
  u.contract_id,
  'unforeseen'::text    AS event_kind,
  u.status              AS event_subtype,
  coalesce(u.data_abertura, u.created_at::date),
  u.created_at,
  format('Item não previsto #%s: %s', u.numero, left(u.descricao, 60)),
  format('R$ %s · status %s',
         trim(both '0' from to_char(coalesce(u.valor_estimado, 0), 'FM999G999G990D00')),
         u.status),
  CASE u.status
    WHEN 'aprovado'  THEN 'success'
    WHEN 'aditado'   THEN 'success'
    WHEN 'recusado'  THEN 'danger'
    WHEN 'cancelado' THEN 'neutral'
    ELSE 'info'
  END,
  u.valor_estimado,
  u.id,
  '/itens-nao-previstos'::text,
  (SELECT m.nome FROM public.members m WHERE m.id = u.opened_by)
FROM public.unforeseen_items u
WHERE u.deleted_at IS NULL

UNION ALL

-- =============================================================================
-- 3. Measurements — 1 evento por medição (emissão/aprovação/pagamento)
-- =============================================================================
SELECT
  meas.tenant_id,
  meas.contract_id,
  'measurement'::text   AS event_kind,
  meas.status           AS event_subtype,
  coalesce(meas.data_emissao, meas.created_at::date),
  meas.created_at,
  format('Medição #%s%s · %s a %s',
         meas.numero,
         CASE WHEN meas.complementar_numero > 0
              THEN '.' || meas.complementar_numero::text
              ELSE '' END,
         to_char(meas.periodo_inicio, 'DD/MM/YYYY'),
         to_char(meas.periodo_fim, 'DD/MM/YYYY')),
  format('Líquido: R$ %s · %s',
         trim(both '0' from to_char(meas.valor_liquido, 'FM999G999G990D00')),
         meas.status),
  CASE meas.status
    WHEN 'paga' THEN 'success'
    WHEN 'aprovada' THEN 'success'
    WHEN 'devolvida' THEN 'warning'
    WHEN 'cancelada' THEN 'neutral'
    ELSE 'info'
  END,
  meas.valor_liquido,
  meas.id,
  '/medicoes'::text,
  (SELECT m.nome FROM public.members m WHERE m.id = meas.created_by)
FROM public.measurements meas
WHERE meas.deleted_at IS NULL

UNION ALL

-- =============================================================================
-- 4. Reajuste events — V30 · art. 25/92/124-127
-- =============================================================================
-- Schema real: applied_at/applied_by/factor/value_before/value_after/delta + rule_id
SELECT
  r.tenant_id,
  r.contract_id,
  'reajuste'::text      AS event_kind,
  'aplicado'::text      AS event_subtype,  -- contract_reajuste_events só registra aplicações
  r.applied_at::date,
  r.applied_at,
  format('Reajuste · %s',
         coalesce(
           (SELECT ai.codigo
              FROM public.adjustment_indices ai
              JOIN public.contract_adjustment_rules car ON car.index_id = ai.id
              WHERE car.id = r.rule_id), '—')),
  format('Fator %s · variação %s%% · Δ R$ %s',
         round(r.factor, 6)::text,
         to_char(r.variation_percent, 'FM990D00'),
         trim(both '0' from to_char(r.delta, 'FM999G999G990D00'))),
  'success'::text,
  r.delta               AS valor,
  r.id,
  '/reajustes'::text,
  (SELECT m.nome FROM public.members m WHERE m.id = r.applied_by)
FROM public.contract_reajuste_events r

UNION ALL

-- =============================================================================
-- 5. Repactuação events — V33 · art. 135
-- =============================================================================
-- Schema real: applied_at/applied_by/delta_total/items_affected/cct_reference
-- contract_repactuacao_events só registra aplicações concluídas (sem workflow)
SELECT
  rp.tenant_id,
  rp.contract_id,
  'repactuacao'::text   AS event_kind,
  'aplicado'::text      AS event_subtype,
  rp.applied_at::date,
  rp.applied_at,
  format('Repactuação%s',
         CASE WHEN rp.cct_reference IS NOT NULL
              THEN ' · ' || rp.cct_reference
              ELSE '' END),
  format('Δ R$ %s · %s itens · variação %s%%',
         trim(both '0' from to_char(rp.delta_total, 'FM999G999G990D00')),
         rp.items_affected,
         to_char(rp.variation_percent, 'FM990D00')),
  CASE WHEN rp.delta_total > 0 THEN 'success'
       WHEN rp.delta_total < 0 THEN 'warning'
       ELSE 'info' END,
  rp.delta_total        AS valor,
  rp.id,
  '/repactuacoes'::text,
  (SELECT m.nome FROM public.members m WHERE m.id = rp.applied_by)
FROM public.contract_repactuacao_events rp

UNION ALL

-- =============================================================================
-- 6. Reequilíbrio requests — V34 · art. 124
-- =============================================================================
SELECT
  re.tenant_id,
  re.contract_id,
  'reequilibrio'::text  AS event_kind,
  re.status             AS event_subtype,
  coalesce(re.data_evento, re.created_at::date),
  re.created_at,
  format('Reequilíbrio #%s · %s', re.numero, re.tipo_evento),
  format('%s · R$ %s · %s',
         re.impacto_tipo,
         trim(both '0' from to_char(coalesce(re.valor_aprovado, re.valor_solicitado, 0), 'FM999G999G990D00')),
         re.status),
  CASE re.status
    WHEN 'aplicado' THEN 'success'
    WHEN 'aprovado' THEN 'success'
    WHEN 'recusado' THEN 'danger'
    WHEN 'cancelado' THEN 'neutral'
    ELSE 'warning'
  END,
  coalesce(re.valor_aprovado, re.valor_solicitado),
  re.id,
  '/reequilibrios'::text,
  (SELECT m.nome FROM public.members m WHERE m.id = re.created_by)
FROM public.contract_reequilibrio_requests re

UNION ALL

-- =============================================================================
-- 7. Receipts — V35 · art. 140
-- =============================================================================
SELECT
  rec.tenant_id,
  rec.contract_id,
  'receipt'::text       AS event_kind,
  rec.tipo              AS event_subtype,
  coalesce(rec.data_emissao, rec.created_at::date),
  rec.created_at,
  format('Recebimento %s #%s',
         CASE rec.tipo WHEN 'provisorio' THEN 'provisório' ELSE 'definitivo' END,
         rec.numero),
  CASE
    WHEN rec.prazo_garantia_meses IS NOT NULL THEN
      format('%s · garantia %s meses (%s)',
             rec.status, rec.prazo_garantia_meses,
             to_char(rec.garantia_fim, 'DD/MM/YYYY'))
    WHEN rec.tipo = 'provisorio' AND rec.data_limite_definitivo IS NOT NULL THEN
      format('%s · limite definitivo %s', rec.status, to_char(rec.data_limite_definitivo, 'DD/MM/YYYY'))
    ELSE rec.status
  END,
  CASE rec.status
    WHEN 'emitido' THEN 'success'
    WHEN 'sanado' THEN 'success'
    WHEN 'com_pendencias' THEN 'warning'
    WHEN 'recusado' THEN 'danger'
    WHEN 'cancelado' THEN 'neutral'
    ELSE 'info'
  END,
  NULL::numeric,
  rec.id,
  '/recebimentos'::text,
  (SELECT m.nome FROM public.members m WHERE m.id = rec.emitido_por_id)
FROM public.contract_receipts rec

UNION ALL

-- =============================================================================
-- 8. Guarantee events — V36 · art. 96-101
-- =============================================================================
SELECT
  ge.tenant_id,
  g.contract_id,
  'guarantee'::text     AS event_kind,
  ge.tipo               AS event_subtype,
  ge.data_evento,
  ge.created_at,
  format('Garantia #%s · %s',
         g.numero,
         CASE ge.tipo
           WHEN 'registro'        THEN 'registro inicial'
           WHEN 'extensao'        THEN 'extensão de vigência'
           WHEN 'liberacao'       THEN 'liberação'
           WHEN 'execucao'        THEN 'execução'
           WHEN 'cancelamento'    THEN 'cancelamento'
           WHEN 'renovacao_valor' THEN 'renovação de valor'
           ELSE ge.tipo
         END),
  CASE
    WHEN ge.valor_movimentado > 0 THEN
      format('R$ %s · saldo R$ %s',
             trim(both '0' from to_char(ge.valor_movimentado, 'FM999G999G990D00')),
             trim(both '0' from to_char(coalesce(ge.valor_disponivel_apos, 0), 'FM999G999G990D00')))
    WHEN ge.nova_vigencia_fim IS NOT NULL THEN
      format('Nova vigência: %s', to_char(ge.nova_vigencia_fim, 'DD/MM/YYYY'))
    ELSE coalesce(left(ge.motivacao, 80), '—')
  END,
  CASE ge.tipo
    WHEN 'registro'     THEN 'success'
    WHEN 'extensao'     THEN 'info'
    WHEN 'liberacao'    THEN 'neutral'
    WHEN 'execucao'     THEN 'danger'
    WHEN 'cancelamento' THEN 'neutral'
    ELSE 'info'
  END,
  ge.valor_movimentado,
  ge.guarantee_id       AS ref_id,
  '/garantias'::text,
  (SELECT m.nome FROM public.members m WHERE m.id = ge.applied_by)
FROM public.contract_guarantee_events ge
JOIN public.contract_guarantees g ON g.id = ge.guarantee_id

UNION ALL

-- =============================================================================
-- 9. PAR steps — V37 · art. 158
-- =============================================================================
SELECT
  ps.tenant_id,
  p.contract_id,
  'par'::text           AS event_kind,
  ps.step_type          AS event_subtype,
  ps.step_at::date,
  ps.step_at,
  format('PAR #%s · %s', p.numero,
         CASE ps.step_type
           WHEN 'criacao'             THEN 'criado em rascunho'
           WHEN 'instauracao'         THEN 'instaurado'
           WHEN 'defesa_apresentada'  THEN 'defesa apresentada'
           WHEN 'defesa_revel'        THEN 'revelia decretada'
           WHEN 'instrucao_concluida' THEN 'instrução concluída'
           WHEN 'decisao'             THEN format('decidido: %s',
                                                  coalesce(p.decisao_resultado, '?'))
           WHEN 'recurso_aberto'      THEN 'recurso interposto'
           WHEN 'recurso_julgado'     THEN format('recurso: %s',
                                                  coalesce(p.recurso_resultado, '?'))
           WHEN 'arquivamento'        THEN 'arquivado'
           WHEN 'cancelamento'        THEN 'cancelado'
           ELSE ps.step_type
         END),
  coalesce(ps.descricao, '—'),
  CASE
    WHEN ps.step_type = 'decisao' AND p.decisao_resultado = 'procedente'              THEN 'danger'
    WHEN ps.step_type = 'decisao' AND p.decisao_resultado = 'parcialmente_procedente' THEN 'warning'
    WHEN ps.step_type = 'decisao' AND p.decisao_resultado = 'improcedente'            THEN 'success'
    WHEN ps.step_type = 'defesa_revel'   THEN 'warning'
    WHEN ps.step_type = 'arquivamento'   THEN 'neutral'
    WHEN ps.step_type = 'cancelamento'   THEN 'neutral'
    ELSE 'info'
  END,
  NULL::numeric,
  p.id                  AS ref_id,
  '/processos-administrativos'::text,
  (SELECT m.nome FROM public.members m WHERE m.id = ps.applied_by)
FROM public.contract_par_steps ps
JOIN public.contract_par_processes p ON p.id = ps.par_id

UNION ALL

-- =============================================================================
-- 10. Sanction events — V38 · art. 156
-- =============================================================================
SELECT
  se.tenant_id,
  s.contract_id,
  'sanction'::text      AS event_kind,
  se.tipo               AS event_subtype,
  se.applied_at::date,
  se.applied_at,
  format('Sanção #%s · %s · %s',
         s.numero,
         CASE s.tipo
           WHEN 'advertencia'  THEN 'advertência'
           WHEN 'multa'        THEN 'multa'
           WHEN 'impedimento'  THEN 'impedimento'
           WHEN 'inidoneidade' THEN 'inidoneidade'
           ELSE s.tipo
         END,
         CASE se.tipo
           WHEN 'aplicacao'       THEN 'aplicação'
           WHEN 'pagamento_multa' THEN 'pagamento'
           WHEN 'suspensao'       THEN 'suspensa'
           WHEN 'reativacao'      THEN 'reativada'
           WHEN 'revogacao'       THEN 'revogada'
           WHEN 'cumprimento'     THEN 'cumprida'
           ELSE se.tipo
         END),
  CASE
    WHEN s.tipo = 'multa' AND s.valor_multa IS NOT NULL THEN
      format('R$ %s · %s',
             trim(both '0' from to_char(s.valor_multa, 'FM999G999G990D00')),
             coalesce(left(se.descricao, 60), ''))
    WHEN s.vigencia_fim IS NOT NULL THEN
      format('Vigência até %s · %s',
             to_char(s.vigencia_fim, 'DD/MM/YYYY'),
             coalesce(left(se.descricao, 60), ''))
    ELSE coalesce(se.descricao, '—')
  END,
  CASE
    WHEN se.tipo = 'aplicacao' AND s.tipo IN ('impedimento','inidoneidade') THEN 'danger'
    WHEN se.tipo = 'aplicacao' AND s.tipo = 'multa'                         THEN 'warning'
    WHEN se.tipo = 'aplicacao'                                              THEN 'info'
    WHEN se.tipo = 'pagamento_multa'                                        THEN 'success'
    WHEN se.tipo = 'cumprimento'                                            THEN 'success'
    WHEN se.tipo = 'suspensao'                                              THEN 'warning'
    WHEN se.tipo = 'reativacao'                                             THEN 'info'
    WHEN se.tipo = 'revogacao'                                              THEN 'neutral'
    ELSE 'info'
  END,
  CASE WHEN s.tipo = 'multa' THEN s.valor_multa ELSE NULL END,
  s.id                  AS ref_id,
  '/sancoes'::text,
  (SELECT m.nome FROM public.members m WHERE m.id = se.applied_by)
FROM public.contract_sanction_events se
JOIN public.contract_sanctions s ON s.id = se.sanction_id;

-- View herda RLS das tabelas-base (Postgres aplica policies de cada SELECT).
GRANT SELECT ON public.v_contract_timeline TO authenticated, service_role;

-- =============================================================================
-- RPC: list_contract_timeline
-- Filtros: kinds[] (whitelist), from/to (date range), severity (lista), limit
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_contract_timeline(
  p_contract_id uuid,
  p_kinds       text[] DEFAULT NULL,
  p_from        date   DEFAULT NULL,
  p_to          date   DEFAULT NULL,
  p_severity    text[] DEFAULT NULL,
  p_limit       int    DEFAULT 500
)
RETURNS TABLE (
  event_kind     text,
  event_subtype  text,
  event_date     date,
  event_at       timestamptz,
  title          text,
  subtitle       text,
  severity       text,
  valor          numeric,
  ref_id         uuid,
  ref_link       text,
  actor_name     text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.event_kind, v.event_subtype, v.event_date, v.event_at,
    v.title, v.subtitle, v.severity, v.valor,
    v.ref_id, v.ref_link, v.actor_name
  FROM public.v_contract_timeline v
  WHERE v.contract_id = p_contract_id
    AND v.tenant_id   = public.current_tenant_id()
    AND (p_kinds    IS NULL OR v.event_kind = ANY(p_kinds))
    AND (p_from     IS NULL OR v.event_date >= p_from)
    AND (p_to       IS NULL OR v.event_date <= p_to)
    AND (p_severity IS NULL OR v.severity   = ANY(p_severity))
  ORDER BY v.event_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 500), 2000));
$$;
GRANT EXECUTE ON FUNCTION public.list_contract_timeline(uuid, text[], date, date, text[], int) TO authenticated;

-- =============================================================================
-- RPC: get_contract_timeline_summary
-- KPIs: total events + 1 contagem por kind + range temporal
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_contract_timeline_summary(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_total  int;
  v_first  date;
  v_last   date;
  v_by_kind jsonb;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT count(*),
         min(event_date),
         max(event_date)
  INTO v_total, v_first, v_last
  FROM public.v_contract_timeline
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant;

  SELECT coalesce(jsonb_object_agg(event_kind, kind_count), '{}'::jsonb)
  INTO v_by_kind
  FROM (
    SELECT event_kind, count(*) AS kind_count
    FROM public.v_contract_timeline
    WHERE contract_id = p_contract_id AND tenant_id = v_tenant
    GROUP BY event_kind
  ) sub;

  RETURN jsonb_build_object(
    'total',      v_total,
    'first_at',   v_first,
    'last_at',    v_last,
    'by_kind',    v_by_kind
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_contract_timeline_summary(uuid) TO authenticated;
