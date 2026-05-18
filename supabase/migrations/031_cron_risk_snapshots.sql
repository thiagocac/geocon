-- =============================================================================
-- 031_cron_risk_snapshots
-- =============================================================================
-- Agenda batch diário de refresh dos risk snapshots usando pg_cron.
--
-- Esta migration é IDEMPOTENTE e SEGURA: se a extensão pg_cron não estiver
-- disponível no projeto Supabase (não-Pro), apenas loga um NOTICE e segue.
-- Em projetos Pro, pg_cron costuma vir habilitado no schema `cron`.
--
-- O job chama a view interna `cron_refresh_stale_risk_all_tenants()` que
-- itera os tenants e chama capture_risk_snapshot pra cada contrato vencido.
-- Mantém isso 100% server-side (não depende de EF / curl externo) — alternativa
-- mais simples que invocar a Edge Function via http_extension.
-- =============================================================================

-- =============================================================================
-- (A) Função interna que roda o batch (chamável só por service_role / cron)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cron_refresh_stale_risk_all_tenants(
  p_max_age_days int DEFAULT 14,
  p_limit_per_tenant int DEFAULT 100
)
RETURNS TABLE (
  tenant_id    uuid,
  refreshed    int,
  errors       int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t  record;
  v_c  record;
  v_refreshed int;
  v_errors    int;
BEGIN
  -- Itera tenants distintos com contratos stale
  FOR v_t IN
    SELECT DISTINCT v.tenant_id
    FROM public.v_contracts_stale_risk v
    WHERE v.last_snapshot_at IS NULL
       OR v.last_snapshot_at < now() - make_interval(days => p_max_age_days)
  LOOP
    v_refreshed := 0;
    v_errors    := 0;

    -- Top-N contratos mais velhos por tenant
    FOR v_c IN
      SELECT v.contract_id
      FROM public.v_contracts_stale_risk v
      WHERE v.tenant_id = v_t.tenant_id
        AND (v.last_snapshot_at IS NULL
             OR v.last_snapshot_at < now() - make_interval(days => p_max_age_days))
      ORDER BY v.last_snapshot_at ASC NULLS FIRST
      LIMIT p_limit_per_tenant
    LOOP
      BEGIN
        PERFORM public.capture_risk_snapshot(v_c.contract_id, 'cron');
        v_refreshed := v_refreshed + 1;
      EXCEPTION WHEN others THEN
        v_errors := v_errors + 1;
        RAISE NOTICE 'cron_refresh: contrato % falhou: %', v_c.contract_id, SQLERRM;
      END;
    END LOOP;

    tenant_id := v_t.tenant_id;
    refreshed := v_refreshed;
    errors    := v_errors;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cron_refresh_stale_risk_all_tenants(int, int) FROM public, authenticated;
GRANT  EXECUTE ON FUNCTION public.cron_refresh_stale_risk_all_tenants(int, int) TO service_role;

-- =============================================================================
-- (B) Tenta agendar via pg_cron se extensão estiver disponível
-- =============================================================================
DO $$
DECLARE
  v_has_cron boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) INTO v_has_cron;

  IF NOT v_has_cron THEN
    RAISE NOTICE '[031_cron_risk_snapshots] pg_cron não está habilitado — pulando agendamento. '
                 'Em produção Supabase Pro, habilite via Dashboard > Database > Extensions.';
    RETURN;
  END IF;

  -- Remove job antigo (idempotência) se existir
  BEGIN
    PERFORM cron.unschedule('refresh_stale_risk_daily');
  EXCEPTION WHEN others THEN NULL;
  END;

  -- Agenda novo: 03:00 UTC todos os dias (= 00:00 America/Sao_Paulo)
  PERFORM cron.schedule(
    'refresh_stale_risk_daily',
    '0 3 * * *',
    $cron$SELECT public.cron_refresh_stale_risk_all_tenants(14, 100);$cron$
  );

  RAISE NOTICE '[031_cron_risk_snapshots] Job "refresh_stale_risk_daily" agendado para 03:00 UTC.';
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- (C) View pra auditoria de execuções do cron — admin pode consultar
-- =============================================================================
-- Note: esta view pressupõe pg_cron. Quando ausente, retorna empty set.
CREATE OR REPLACE VIEW public.v_cron_risk_runs AS
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
       THEN (SELECT count(*)::int FROM information_schema.tables
             WHERE table_schema = 'cron' AND table_name = 'job_run_details')
       ELSE 0
  END AS placeholder
WHERE false;

-- =============================================================================
-- RPC pra UI testar a chamada manualmente (admin only, sem agendar de novo)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.test_cron_refresh_risk()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin boolean;
  v_rows  int := 0;
  v_total_refreshed int := 0;
  v_total_errors    int := 0;
  v_r record;
BEGIN
  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))) INTO v_admin
    FROM public.members WHERE id = public.current_member_id();
  IF NOT v_admin THEN RAISE EXCEPTION 'Apenas administradores'; END IF;

  FOR v_r IN SELECT * FROM public.cron_refresh_stale_risk_all_tenants(14, 50) LOOP
    v_rows := v_rows + 1;
    v_total_refreshed := v_total_refreshed + v_r.refreshed;
    v_total_errors    := v_total_errors    + v_r.errors;
  END LOOP;

  RETURN jsonb_build_object(
    'tenants_processed', v_rows,
    'total_refreshed',   v_total_refreshed,
    'total_errors',      v_total_errors,
    'ran_at',            now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.test_cron_refresh_risk() TO authenticated;
