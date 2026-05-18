-- =============================================================================
-- 057_scan_guarantees_expiring_cron
-- =============================================================================
-- Implementação SQL nativa do scan de garantias vencendo ≤7d (V53).
-- Alternativa à Edge Function `scan-guarantees-expiring` — mesma lógica, mas
-- roda dentro do Postgres via pg_cron sem ida-volta HTTP.
--
-- Triggers da migration 056 cobrem 3 alert_kinds; este cron cobre o 4º
-- (garantia_vencendo) que depende de passagem do tempo.
--
-- Schedule: diário às 06:00 UTC (~03:00 BRT).
-- =============================================================================

-- GRANT EXECUTE no helper criado em 056 (precisamos chamar de outras funções)
GRANT EXECUTE ON FUNCTION public._insert_realtime_alert(
  uuid, uuid, text, text, text, text, text, jsonb
) TO service_role;

-- =============================================================================
-- Função SQL: scan_guarantees_expiring
-- =============================================================================
CREATE OR REPLACE FUNCTION public.scan_guarantees_expiring(
  p_days_ahead int DEFAULT 7,
  p_dry_run    boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alerts_created      int := 0;
  v_skipped_idempotent  int := 0;
  v_errors              int := 0;
  v_processed           int := 0;
  v_rec                 record;
  v_existing_id         uuid;
  v_severity            text;
  v_modalidade_label    text;
  v_title               text;
  v_body                text;
  v_ref_link            text;
  v_dias                int;
BEGIN
  -- Sane bounds
  IF p_days_ahead < 1 THEN p_days_ahead := 1; END IF;
  IF p_days_ahead > 30 THEN p_days_ahead := 30; END IF;

  FOR v_rec IN
    SELECT g.id, g.contract_id, g.numero, g.modalidade, g.valor_garantido,
           g.data_vigencia_fim, c.tenant_id, c.numero AS contract_numero,
           (g.data_vigencia_fim - CURRENT_DATE) AS dias
      FROM public.contract_guarantees g
      JOIN public.contracts c ON c.id = g.contract_id
     WHERE g.status IN ('ativa','estendida')
       AND g.data_vigencia_fim BETWEEN CURRENT_DATE AND CURRENT_DATE + p_days_ahead
       AND c.deleted_at IS NULL
  LOOP
    v_processed := v_processed + 1;

    -- Idempotência: alerta para esta guarantee criado nos últimos 7d?
    SELECT id INTO v_existing_id
      FROM public.realtime_alerts
     WHERE tenant_id    = v_rec.tenant_id
       AND contract_id  = v_rec.contract_id
       AND alert_kind   = 'garantia_vencendo'
       AND metadata->>'guarantee_id' = v_rec.id::text
       AND created_at   > now() - interval '7 days'
       AND dismissed_at IS NULL
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      v_skipped_idempotent := v_skipped_idempotent + 1;
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      v_alerts_created := v_alerts_created + 1;
      CONTINUE;
    END IF;

    v_dias := v_rec.dias;
    v_severity := CASE WHEN v_dias <= 3 THEN 'danger' ELSE 'warning' END;
    v_modalidade_label := CASE v_rec.modalidade
      WHEN 'caucao_dinheiro' THEN 'Caução em dinheiro'
      WHEN 'caucao_titulos'  THEN 'Caução em títulos'
      WHEN 'seguro_garantia' THEN 'Seguro-garantia'
      WHEN 'fianca_bancaria' THEN 'Fiança bancária'
      ELSE v_rec.modalidade
    END;
    v_title := 'Garantia GA-' || to_char(v_rec.numero, 'FM00000')
            || ' vence em ' || v_dias::text
            || ' dia' || CASE WHEN v_dias = 1 THEN '' ELSE 's' END;
    v_body := v_modalidade_label
           || ' · R$ ' || to_char(v_rec.valor_garantido, 'FM999G999G999D00')
           || ' · contrato ' || v_rec.contract_numero;
    v_ref_link := '/contratos/' || v_rec.contract_id || '/garantias';

    BEGIN
      PERFORM public._insert_realtime_alert(
        v_rec.tenant_id,
        v_rec.contract_id,
        'garantia_vencendo',
        v_severity,
        v_title,
        v_body,
        v_ref_link,
        jsonb_build_object(
          'guarantee_id',          v_rec.id,
          'guarantee_numero',      v_rec.numero,
          'modalidade',            v_rec.modalidade,
          'valor',                 v_rec.valor_garantido,
          'dias_para_vencimento',  v_dias,
          'data_vigencia_fim',     v_rec.data_vigencia_fim
        )
      );
      v_alerts_created := v_alerts_created + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed',          v_processed,
    'alerts_created',     v_alerts_created,
    'skipped_idempotent', v_skipped_idempotent,
    'errors',             v_errors,
    'dry_run',            p_dry_run,
    'days_ahead',         p_days_ahead,
    'executed_at',        now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.scan_guarantees_expiring(int, boolean) TO service_role;

-- =============================================================================
-- pg_cron schedule (diário 06:00 UTC ≈ 03:00 BRT)
-- =============================================================================
-- Idempotente: remove job anterior se existir antes de re-criar.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scan_guarantees_expiring_daily') THEN
      PERFORM cron.unschedule('scan_guarantees_expiring_daily');
    END IF;

    PERFORM cron.schedule(
      'scan_guarantees_expiring_daily',
      '0 6 * * *',
      $cron$ SELECT public.scan_guarantees_expiring(7, false); $cron$
    );
  END IF;
EXCEPTION
  WHEN undefined_table OR undefined_function THEN
    -- pg_cron não instalado (ambiente local sem extensão)
    NULL;
END;
$$;

COMMENT ON FUNCTION public.scan_guarantees_expiring(int, boolean) IS
'V53 — Scan diário de garantias vencendo. Insere realtime_alerts ' ||
'idempotentemente (skip se mesmo guarantee tem alerta ≤7d não-dismissado).';
