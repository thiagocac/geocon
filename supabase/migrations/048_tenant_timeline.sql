-- =============================================================================
-- 048_tenant_timeline
-- =============================================================================
-- Timeline global do tenant: reaproveita a view v_contract_timeline (V39/045)
-- mas filtra apenas pelo tenant_id e enriquece cada linha com contract_numero
-- e contract_titulo. Permite que gerentes seniores monitorem a carteira inteira
-- numa única feed temporal.
--
-- Sem novas tabelas, sem CHECKs, sem cron. Puramente compositiva sobre V39.
--
-- RPCs:
--   list_tenant_timeline(kinds, contract_ids, from, to, severity, limit, cursor)
--   get_tenant_timeline_summary()
--   get_tenant_timeline_contracts() — lista contratos com atividade (para filtro UI)
--
-- Differenças vs list_contract_timeline (V39):
--   * Sem p_contract_id — escopo é tenant inteiro
--   * Adiciona p_contract_ids[] como filtro (multiselect)
--   * Limit max 500 (vs V39 max 2000) — escala diferente
--   * Default 200 (vs V39 500)
--   * Inclui contract_numero/contract_titulo em cada linha
--   * Cursor-based pagination via p_before (event_at < p_before)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.list_tenant_timeline(
  p_kinds        text[] DEFAULT NULL,
  p_contract_ids uuid[] DEFAULT NULL,
  p_from         date   DEFAULT NULL,
  p_to           date   DEFAULT NULL,
  p_severity     text[] DEFAULT NULL,
  p_limit        int    DEFAULT 200,
  p_before       timestamptz DEFAULT NULL  -- cursor para paginação
)
RETURNS TABLE (
  event_kind      text,
  event_subtype   text,
  event_date      date,
  event_at        timestamptz,
  title           text,
  subtitle        text,
  severity        text,
  valor           numeric,
  ref_id          uuid,
  ref_link        text,
  actor_name      text,
  contract_id     uuid,
  contract_numero int,
  contract_titulo text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.event_kind, v.event_subtype, v.event_date, v.event_at,
    v.title, v.subtitle, v.severity, v.valor,
    v.ref_id, v.ref_link, v.actor_name,
    v.contract_id, c.numero AS contract_numero, c.titulo AS contract_titulo
  FROM public.v_contract_timeline v
  JOIN public.contracts c ON c.id = v.contract_id
  WHERE v.tenant_id     = public.current_tenant_id()
    AND c.deleted_at IS NULL
    AND (p_contract_ids IS NULL OR v.contract_id = ANY(p_contract_ids))
    AND (p_kinds        IS NULL OR v.event_kind  = ANY(p_kinds))
    AND (p_from         IS NULL OR v.event_date >= p_from)
    AND (p_to           IS NULL OR v.event_date <= p_to)
    AND (p_severity     IS NULL OR v.severity    = ANY(p_severity))
    AND (p_before       IS NULL OR v.event_at   < p_before)
  ORDER BY v.event_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 200), 500));
$$;
GRANT EXECUTE ON FUNCTION public.list_tenant_timeline(text[], uuid[], date, date, text[], int, timestamptz) TO authenticated;

-- =============================================================================
-- Summary KPIs do tenant inteiro
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_tenant_timeline_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant         uuid;
  v_total          int;
  v_events_30d     int;
  v_events_7d      int;
  v_contracts_active int;
  v_contracts_total  int;
  v_last_event     timestamptz;
  v_by_kind        jsonb;
  v_by_severity    jsonb;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT count(*),
         count(*) FILTER (WHERE event_date >= current_date - interval '30 days'),
         count(*) FILTER (WHERE event_date >= current_date - interval '7 days'),
         max(event_at)
  INTO v_total, v_events_30d, v_events_7d, v_last_event
  FROM public.v_contract_timeline v
  JOIN public.contracts c ON c.id = v.contract_id
  WHERE v.tenant_id = v_tenant AND c.deleted_at IS NULL;

  -- Contratos com atividade nos últimos 30 dias
  SELECT count(DISTINCT v.contract_id)::int
  INTO v_contracts_active
  FROM public.v_contract_timeline v
  JOIN public.contracts c ON c.id = v.contract_id
  WHERE v.tenant_id = v_tenant
    AND c.deleted_at IS NULL
    AND v.event_date >= current_date - interval '30 days';

  -- Contratos totais do tenant (denominador)
  SELECT count(*)::int
  INTO v_contracts_total
  FROM public.contracts
  WHERE tenant_id = v_tenant AND deleted_at IS NULL;

  SELECT coalesce(jsonb_object_agg(event_kind, k_count), '{}'::jsonb)
  INTO v_by_kind
  FROM (
    SELECT event_kind, count(*) AS k_count
    FROM public.v_contract_timeline v
    JOIN public.contracts c ON c.id = v.contract_id
    WHERE v.tenant_id = v_tenant AND c.deleted_at IS NULL
    GROUP BY event_kind
  ) sub;

  SELECT coalesce(jsonb_object_agg(severity, s_count), '{}'::jsonb)
  INTO v_by_severity
  FROM (
    SELECT severity, count(*) AS s_count
    FROM public.v_contract_timeline v
    JOIN public.contracts c ON c.id = v.contract_id
    WHERE v.tenant_id = v_tenant AND c.deleted_at IS NULL
    GROUP BY severity
  ) sub;

  RETURN jsonb_build_object(
    'total',              v_total,
    'events_30d',         v_events_30d,
    'events_7d',          v_events_7d,
    'last_event_at',      v_last_event,
    'contracts_active',   v_contracts_active,
    'contracts_total',    v_contracts_total,
    'by_kind',            v_by_kind,
    'by_severity',        v_by_severity
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_tenant_timeline_summary() TO authenticated;

-- =============================================================================
-- Contratos com atividade (para filtro multiselect na UI)
-- Top N contratos por count de eventos, ordenados por atividade recente
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_tenant_timeline_contracts(p_limit int DEFAULT 50)
RETURNS TABLE (
  contract_id     uuid,
  contract_numero int,
  contract_titulo text,
  event_count     int,
  last_event_at   timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id            AS contract_id,
    c.numero        AS contract_numero,
    c.titulo        AS contract_titulo,
    count(v.*)::int AS event_count,
    max(v.event_at) AS last_event_at
  FROM public.contracts c
  LEFT JOIN public.v_contract_timeline v ON v.contract_id = c.id
  WHERE c.tenant_id = public.current_tenant_id()
    AND c.deleted_at IS NULL
  GROUP BY c.id, c.numero, c.titulo
  HAVING count(v.*) > 0
  ORDER BY max(v.event_at) DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
$$;
GRANT EXECUTE ON FUNCTION public.get_tenant_timeline_contracts(int) TO authenticated;
