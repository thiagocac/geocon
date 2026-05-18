-- =============================================================================
-- 055_economic_indices_auto
-- =============================================================================
-- Suporte ao Edge Function download-economic-indices (V48): pull mensal
-- automático de séries do IBGE (IPCA · IPCA-15) — fonte pública estável.
--
-- FGV (INCC · IGP-M) permanece via CSV manual ou paid feed — FGV não expõe
-- API pública gratuita. Estrutura preparada para evoluir quando disponível.
--
-- Componentes:
--   * adjustment_index_fetch_log — audit de cada tentativa de pull
--   * upsert_index_value_external (service_role only) — variante sem JWT
--   * pg_cron mensal dia 15 às 11h UTC
-- =============================================================================

-- =============================================================================
-- Audit table — uma linha por tentativa de fetch
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.adjustment_index_fetch_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  index_codigo    text NOT NULL,               -- 'IPCA', 'IPCA-15', etc
  source          text NOT NULL,               -- 'ibge-api', 'fgv-csv', etc
  status          text NOT NULL CHECK (status IN ('success','partial','failed','skipped')),
  reference_month_from date,
  reference_month_to   date,
  rows_inserted   int  NOT NULL DEFAULT 0,
  rows_updated    int  NOT NULL DEFAULT 0,
  rows_skipped    int  NOT NULL DEFAULT 0,
  error_message   text,
  metadata        jsonb DEFAULT '{}'::jsonb,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  triggered_by    uuid REFERENCES public.members(id)
);

CREATE INDEX IF NOT EXISTS idx_fetch_log_tenant_codigo
  ON public.adjustment_index_fetch_log (tenant_id, index_codigo, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_fetch_log_status
  ON public.adjustment_index_fetch_log (status, fetched_at DESC);

ALTER TABLE public.adjustment_index_fetch_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fetch_log_select ON public.adjustment_index_fetch_log;
CREATE POLICY fetch_log_select ON public.adjustment_index_fetch_log
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.current_tenant_id());

-- INSERT/UPDATE só via service_role (sem policy = bloqueado para authenticated)

GRANT SELECT ON public.adjustment_index_fetch_log TO authenticated;

-- =============================================================================
-- RPC: upsert_index_value_external — variante service_role (sem JWT)
-- Inputs análogos a upsert_index_value (V31) mas aceita tenant_id explícito
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_index_value_external(
  p_tenant_id       uuid,
  p_index_codigo    text,
  p_reference_month date,
  p_index_value     numeric,
  p_source          text,
  p_published_at    timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_index_id uuid;
  v_existing record;
  v_action text;
BEGIN
  -- Resolve index_id pelo codigo dentro do tenant
  SELECT id INTO v_index_id
  FROM public.adjustment_indices
  WHERE tenant_id = p_tenant_id
    AND codigo = p_index_codigo
    AND deleted_at IS NULL;

  IF v_index_id IS NULL THEN
    RETURN jsonb_build_object('action', 'skipped', 'reason', 'index_not_configured_in_tenant');
  END IF;

  SELECT id, index_value INTO v_existing
  FROM public.adjustment_index_values
  WHERE index_id = v_index_id AND reference_month = p_reference_month;

  IF v_existing IS NULL THEN
    INSERT INTO public.adjustment_index_values (
      index_id, tenant_id, reference_month, index_value, source, published_at
    )
    VALUES (v_index_id, p_tenant_id, p_reference_month, p_index_value, p_source, coalesce(p_published_at, now()));
    v_action := 'inserted';
  ELSIF v_existing.index_value <> p_index_value THEN
    UPDATE public.adjustment_index_values
       SET index_value  = p_index_value,
           source       = p_source,
           published_at = coalesce(p_published_at, now())
     WHERE id = v_existing.id;
    v_action := 'updated';
  ELSE
    v_action := 'unchanged';
  END IF;

  RETURN jsonb_build_object(
    'action',          v_action,
    'index_id',        v_index_id,
    'reference_month', p_reference_month,
    'index_value',     p_index_value
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.upsert_index_value_external(uuid, text, date, numeric, text, timestamptz) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_index_value_external(uuid, text, date, numeric, text, timestamptz) TO service_role;

-- =============================================================================
-- RPC: list_tenants_with_ibge_indices — quais tenants têm IBGE configurado?
-- Chamada pela EF para iterar tenants pendentes
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_tenants_with_ibge_indices()
RETURNS TABLE (
  tenant_id     uuid,
  index_codigo  text,
  ibge_serie    text       -- '1737' para IPCA, '7060' para IPCA-15, etc
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.tenant_id,
    i.codigo,
    coalesce(i.metadata->>'ibge_serie',
             CASE i.codigo
               WHEN 'IPCA'    THEN '1737'   -- IBGE/SIDRA: IPCA-IBGE, índice acumulado base dez/1993
               WHEN 'IPCA-15' THEN '7060'   -- IBGE/SIDRA: IPCA-15-IBGE
               ELSE NULL
             END
    ) AS ibge_serie
  FROM public.adjustment_indices i
  WHERE i.deleted_at IS NULL
    AND (i.codigo IN ('IPCA', 'IPCA-15') OR i.metadata ? 'ibge_serie');
$$;
REVOKE EXECUTE ON FUNCTION public.list_tenants_with_ibge_indices() FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenants_with_ibge_indices() TO service_role;

-- =============================================================================
-- RPC: record_fetch_log_entry — chamada pela EF
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_fetch_log_entry(
  p_tenant_id     uuid,
  p_index_codigo  text,
  p_source        text,
  p_status        text,
  p_rows_inserted int,
  p_rows_updated  int,
  p_rows_skipped  int,
  p_error_message text DEFAULT NULL,
  p_metadata      jsonb DEFAULT '{}'::jsonb,
  p_reference_month_from date DEFAULT NULL,
  p_reference_month_to   date DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.adjustment_index_fetch_log (
    tenant_id, index_codigo, source, status,
    rows_inserted, rows_updated, rows_skipped,
    error_message, metadata,
    reference_month_from, reference_month_to
  )
  VALUES (
    p_tenant_id, p_index_codigo, p_source, p_status,
    p_rows_inserted, p_rows_updated, p_rows_skipped,
    p_error_message, p_metadata,
    p_reference_month_from, p_reference_month_to
  )
  RETURNING id;
$$;
REVOKE EXECUTE ON FUNCTION public.record_fetch_log_entry(uuid, text, text, text, int, int, int, text, jsonb, date, date) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.record_fetch_log_entry(uuid, text, text, text, int, int, int, text, jsonb, date, date) TO service_role;

-- =============================================================================
-- RPC user-facing: list_fetch_log — admin vê histórico
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_fetch_log(p_limit int DEFAULT 50)
RETURNS TABLE (
  id              uuid,
  index_codigo    text,
  source          text,
  status          text,
  reference_month_from date,
  reference_month_to   date,
  rows_inserted   int,
  rows_updated    int,
  rows_skipped    int,
  error_message   text,
  fetched_at      timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id, index_codigo, source, status,
    reference_month_from, reference_month_to,
    rows_inserted, rows_updated, rows_skipped,
    error_message, fetched_at
  FROM public.adjustment_index_fetch_log
  WHERE tenant_id IS NULL OR tenant_id = public.current_tenant_id()
  ORDER BY fetched_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
$$;
GRANT EXECUTE ON FUNCTION public.list_fetch_log(int) TO authenticated;

-- =============================================================================
-- pg_cron — mensal, dia 15 às 11h UTC (8h Brasília)
-- IBGE publica IPCA típicamente entre dia 10-12 do mês seguinte
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron não disponível, agendamento manual necessário';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'download-economic-indices-monthly';

  PERFORM cron.schedule(
    'download-economic-indices-monthly',
    '0 11 15 * *',  -- dia 15, 11h UTC
    $cron$
    SELECT net.http_post(
      url := current_setting('app.supabase_url', true) || '/functions/v1/download-economic-indices',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule falhou: %. Agende manualmente após deploy.', SQLERRM;
END
$$;

COMMENT ON TABLE public.adjustment_index_fetch_log IS
  'V48 · audit trail das tentativas de fetch automático de índices econômicos. '
  'Cada linha: 1 par (tenant, índice) por tentativa. Inclui status, contagens '
  'de inserts/updates/skips e mensagem de erro se aplicável.';
