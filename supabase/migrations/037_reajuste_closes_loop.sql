-- =============================================================================
-- 037_reajuste_closes_loop
-- =============================================================================
-- (A) Adiciona 'reajuste' ao CHECK de additives.tipo
-- (B) Adiciona contract_reajuste_events.additive_id (link bidireccional)
-- (C) Reescreve apply_contract_reajuste para aceitar opcionalmente criar aditivo
-- (D) RPC bulk_upsert_index_values pra CSV import
-- (E) Cron mensal: notifica gestores quando contrato chega ao aniversário
-- =============================================================================

-- =============================================================================
-- (A) Estender CHECK de additives.tipo
-- =============================================================================
ALTER TABLE public.additives
  DROP CONSTRAINT IF EXISTS additives_tipo_check;

ALTER TABLE public.additives
  ADD CONSTRAINT additives_tipo_check
  CHECK (tipo IN ('valor', 'prazo', 'valor_prazo', 'supressao', 'reequilibrio', 'reajuste'));

COMMENT ON COLUMN public.additives.tipo IS
  'valor | prazo | valor_prazo | supressao | reequilibrio | reajuste (V31+)';

-- =============================================================================
-- (B) Link bidirecional event → additive (opcional)
-- =============================================================================
ALTER TABLE public.contract_reajuste_events
  ADD COLUMN IF NOT EXISTS additive_id uuid REFERENCES public.additives(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contract_reajuste_events.additive_id IS
  'Aditivo formal criado automaticamente quando admin marca "criar aditivo" no apply. NULL = reajuste registrado apenas como audit (sem formalização).';

CREATE INDEX IF NOT EXISTS idx_reajuste_events_additive
  ON public.contract_reajuste_events (additive_id) WHERE additive_id IS NOT NULL;

-- =============================================================================
-- (C) Reescreve apply_contract_reajuste com flag p_create_additive
-- =============================================================================
CREATE OR REPLACE FUNCTION public.apply_contract_reajuste(
  p_contract_id     uuid,
  p_target_date     date    DEFAULT NULL,
  p_notes           text    DEFAULT NULL,
  p_create_additive boolean DEFAULT false
)
RETURNS jsonb   -- { event_id, additive_id?, value_after, delta }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant      uuid;
  v_member      uuid;
  v_admin       boolean;
  v_sim         jsonb;
  v_event_id    uuid;
  v_additive_id uuid;
  v_delta       numeric;
  v_factor      numeric;
  v_index_code  text;
  v_contract    record;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();
  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_admin
  FROM public.members WHERE id = v_member;
  IF NOT v_admin THEN RAISE EXCEPTION 'Apenas administradores ou gestor de contrato'; END IF;

  -- Reusa lógica de simulação
  v_sim := public.simulate_contract_reajuste(p_contract_id, p_target_date);
  IF NOT (v_sim->>'ok')::boolean THEN
    RAISE EXCEPTION 'Reajuste não pode ser aplicado: %', v_sim->>'error';
  END IF;

  v_delta      := (v_sim->>'delta')::numeric;
  v_factor     := (v_sim->>'factor')::numeric;
  v_index_code := v_sim->>'index_codigo';

  -- Cria event audit
  INSERT INTO public.contract_reajuste_events (
    tenant_id, contract_id, rule_id, applied_at, applied_by,
    base_date, reference_date,
    index_value_base, index_value_ref,
    factor, variation_percent,
    value_before, value_after, delta, notes
  )
  VALUES (
    v_tenant, p_contract_id, (v_sim->>'rule_id')::uuid, now(), v_member,
    (v_sim->>'base_date')::date, (v_sim->>'reference_date')::date,
    (v_sim->>'index_value_base')::numeric, (v_sim->>'index_value_ref')::numeric,
    v_factor, (v_sim->>'variation_percent')::numeric,
    (v_sim->>'value_before')::numeric, (v_sim->>'value_after')::numeric,
    v_delta, p_notes
  )
  RETURNING id INTO v_event_id;

  -- Opcional: criar aditivo formal
  IF p_create_additive THEN
    -- Apenas se delta > 0 (não cria aditivo de R$ 0 ou negativo nesse caminho)
    IF v_delta <= 0 THEN
      RAISE NOTICE '[apply_contract_reajuste] delta <= 0; aditivo não criado';
    ELSE
      SELECT * INTO v_contract FROM public.contracts WHERE id = p_contract_id;

      v_additive_id := public.register_additive(
        p_contract_id,
        jsonb_build_object(
          'tipo',                     'reajuste',
          'valor_acrescimo',          v_delta,
          'valor_decrescimo',         0,
          'prazo_execucao_dias',      0,
          'prazo_vigencia_dias',      0,
          'justificativa_valor',
            format('Reajuste contratual %s — fator %s (variação %.4f%%). Base %s → ref %s. %s',
                   v_index_code,
                   round(v_factor, 8),
                   ((v_factor - 1) * 100),
                   (v_sim->>'base_date'),
                   (v_sim->>'reference_date'),
                   coalesce(p_notes, '')),
          'metadata', jsonb_build_object(
            'reajuste_event_id', v_event_id,
            'index_codigo',      v_index_code,
            'factor',            v_factor,
            'auto_generated',    true
          )
        )
      );

      -- Atualiza event com link
      UPDATE public.contract_reajuste_events
         SET additive_id = v_additive_id
       WHERE id = v_event_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'event_id',     v_event_id,
    'additive_id',  v_additive_id,
    'value_before', (v_sim->>'value_before')::numeric,
    'value_after',  (v_sim->>'value_after')::numeric,
    'delta',        v_delta,
    'factor',       v_factor
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_contract_reajuste(uuid, date, text, boolean) TO authenticated;

-- =============================================================================
-- Update list_contract_reajustes pra retornar additive_id também
-- =============================================================================
DROP FUNCTION IF EXISTS public.list_contract_reajustes(uuid);
CREATE OR REPLACE FUNCTION public.list_contract_reajustes(p_contract_id uuid)
RETURNS TABLE (
  id                 uuid,
  applied_at         timestamptz,
  applied_by         uuid,
  applied_by_nome    text,
  base_date          date,
  reference_date     date,
  index_codigo       text,
  factor             numeric,
  variation_percent  numeric,
  value_before       numeric,
  value_after        numeric,
  delta              numeric,
  notes              text,
  additive_id        uuid,
  additive_numero    int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id, e.applied_at, e.applied_by,
    m.nome AS applied_by_nome,
    e.base_date, e.reference_date,
    i.codigo AS index_codigo,
    e.factor, e.variation_percent,
    e.value_before, e.value_after, e.delta,
    e.notes,
    e.additive_id,
    a.numero AS additive_numero
  FROM public.contract_reajuste_events e
  JOIN public.contract_adjustment_rules r ON r.id = e.rule_id
  JOIN public.adjustment_indices i ON i.id = r.index_id
  LEFT JOIN public.members m ON m.id = e.applied_by
  LEFT JOIN public.additives a ON a.id = e.additive_id
  WHERE e.contract_id = p_contract_id
    AND e.tenant_id = public.current_tenant_id()
  ORDER BY e.applied_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_contract_reajustes(uuid) TO authenticated;

-- =============================================================================
-- (D) Bulk upsert de valores de índice (CSV import)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.bulk_upsert_index_values(
  p_index_id uuid,
  p_rows     jsonb,        -- array de { reference_month: 'YYYY-MM-DD' | 'YYYY-MM', index_value: number }
  p_source   text DEFAULT 'csv-import'
)
RETURNS jsonb   -- { inserted, updated, skipped, errors[] }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   uuid;
  v_admin    boolean;
  v_member   uuid;
  v_row      jsonb;
  v_month    date;
  v_value    numeric;
  v_existing record;
  v_count_ins int := 0;
  v_count_upd int := 0;
  v_count_skp int := 0;
  v_errors   jsonb := '[]'::jsonb;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();
  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))) INTO v_admin
    FROM public.members WHERE id = v_member;
  IF NOT v_admin THEN RAISE EXCEPTION 'Apenas administradores'; END IF;

  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha fornecida';
  END IF;
  IF jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'Máximo 1000 linhas por chamada (recebido: %)', jsonb_array_length(p_rows);
  END IF;

  -- Validate index belongs to tenant
  IF NOT EXISTS (SELECT 1 FROM public.adjustment_indices WHERE id = p_index_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Índice não encontrado';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    -- Parse mês: aceita 'YYYY-MM' ou 'YYYY-MM-DD'
    BEGIN
      DECLARE
        v_month_str text;
      BEGIN
        v_month_str := v_row->>'reference_month';
        IF v_month_str IS NULL THEN
          v_errors := v_errors || jsonb_build_object('row', v_row, 'error', 'reference_month ausente');
          v_count_skp := v_count_skp + 1;
          CONTINUE;
        END IF;
        -- Normaliza
        IF length(v_month_str) = 7 THEN
          v_month := (v_month_str || '-01')::date;
        ELSE
          v_month := date_trunc('month', v_month_str::date)::date;
        END IF;
      END;
    EXCEPTION WHEN others THEN
      v_errors := v_errors || jsonb_build_object('row', v_row, 'error', 'data inválida: ' || SQLERRM);
      v_count_skp := v_count_skp + 1;
      CONTINUE;
    END;

    -- Parse valor
    BEGIN
      v_value := (v_row->>'index_value')::numeric;
      IF v_value IS NULL OR v_value <= 0 THEN
        v_errors := v_errors || jsonb_build_object('row', v_row, 'error', 'index_value deve ser positivo');
        v_count_skp := v_count_skp + 1;
        CONTINUE;
      END IF;
    EXCEPTION WHEN others THEN
      v_errors := v_errors || jsonb_build_object('row', v_row, 'error', 'index_value inválido: ' || SQLERRM);
      v_count_skp := v_count_skp + 1;
      CONTINUE;
    END;

    -- Check existing
    SELECT * INTO v_existing
    FROM public.adjustment_index_values
    WHERE index_id = p_index_id AND reference_month = v_month;

    IF v_existing IS NOT NULL THEN
      UPDATE public.adjustment_index_values
         SET index_value = v_value,
             source = p_source,
             published_at = coalesce(published_at, now()),
             recorded_by = v_member,
             updated_at = now()
       WHERE id = v_existing.id;
      v_count_upd := v_count_upd + 1;
    ELSE
      INSERT INTO public.adjustment_index_values (
        index_id, tenant_id, reference_month, index_value, source, published_at, recorded_by
      ) VALUES (
        p_index_id, v_tenant, v_month, v_value, p_source, now(), v_member
      );
      v_count_ins := v_count_ins + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_count_ins,
    'updated',  v_count_upd,
    'skipped',  v_count_skp,
    'errors',   v_errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_upsert_index_values(uuid, jsonb, text) TO authenticated;

-- =============================================================================
-- (E) Cron mensal: aniversário de reajuste
-- =============================================================================
-- View: contratos elegíveis pra reajuste no mês corrente (alvo nos próximos 30 dias)
CREATE OR REPLACE VIEW public.v_contracts_due_reajuste AS
SELECT
  c.id            AS contract_id,
  c.tenant_id,
  c.numero        AS contract_numero,
  c.objeto,
  r.id            AS rule_id,
  r.data_base,
  r.periodicidade_meses,
  i.codigo        AS index_codigo,
  coalesce(
    (SELECT max(e.reference_date) FROM public.contract_reajuste_events e WHERE e.contract_id = c.id),
    r.data_base,
    c.data_inicio_prevista,
    c.data_assinatura
  ) AS last_reference_date,
  coalesce(
    (SELECT max(e.reference_date) FROM public.contract_reajuste_events e WHERE e.contract_id = c.id),
    r.data_base,
    c.data_inicio_prevista,
    c.data_assinatura
  ) + make_interval(months => r.periodicidade_meses)::interval AS next_anniversary
FROM public.contracts c
JOIN public.contract_adjustment_rules r ON r.contract_id = c.id AND r.active = true AND r.deleted_at IS NULL
JOIN public.adjustment_indices i ON i.id = r.index_id
WHERE c.deleted_at IS NULL
  AND c.status IN ('contratado', 'em_execucao')  -- evita arquivado/concluído
  AND coalesce(
        (SELECT max(e.reference_date) FROM public.contract_reajuste_events e WHERE e.contract_id = c.id),
        r.data_base,
        c.data_inicio_prevista,
        c.data_assinatura
      ) + make_interval(months => r.periodicidade_meses)::interval
      BETWEEN now()::date AND (now() + interval '30 days')::date;

GRANT SELECT ON public.v_contracts_due_reajuste TO authenticated;

-- RPC: notify_reajuste_due — admin recebe lista de contratos próximos do aniversário
CREATE OR REPLACE FUNCTION public.notify_reajuste_due()
RETURNS TABLE (
  tenant_id        uuid,
  contracts_count  int,
  members_notified int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t       record;
  v_member  record;
  v_due     record;
  v_count   int;
  v_already boolean;
  v_body    text;
BEGIN
  FOR v_t IN
    SELECT v.tenant_id, count(*) AS n
    FROM public.v_contracts_due_reajuste v
    GROUP BY v.tenant_id
  LOOP
    v_count := 0;

    FOR v_member IN
      SELECT id FROM public.members
      WHERE tenant_id = v_t.tenant_id
        AND active = true
        AND deleted_at IS NULL
        AND (role = 'admin'
             OR 'admin'         = ANY(coalesce(roles, ARRAY[]::text[]))
             OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[])))
    LOOP
      -- 30-day cooldown
      SELECT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.recipient_id = v_member.id
          AND n.kind = 'system'
          AND (n.metadata->>'reajuste_due_alert') = 'true'
          AND n.created_at > now() - interval '30 days'
      ) INTO v_already;
      IF v_already THEN CONTINUE; END IF;

      -- Body: lista até 5 contratos com mais detalhe
      SELECT string_agg(
        format('%s (índice %s, aniversário em %s)',
               v.contract_numero,
               v.index_codigo,
               to_char(v.next_anniversary, 'DD/MM/YYYY')),
        E'\n'
      ) INTO v_body
      FROM (
        SELECT * FROM public.v_contracts_due_reajuste
        WHERE tenant_id = v_t.tenant_id
        ORDER BY next_anniversary ASC
        LIMIT 5
      ) v;

      INSERT INTO public.notifications (
        tenant_id, recipient_id, kind, title, body, action_url, metadata
      ) VALUES (
        v_t.tenant_id,
        v_member.id,
        'system',
        format('%s contrato(s) próximo(s) do aniversário de reajuste', v_t.n),
        coalesce(v_body, '') || CASE WHEN v_t.n > 5 THEN E'\n…e mais ' || (v_t.n - 5) || ' contrato(s)' ELSE '' END,
        '/dashboard',
        jsonb_build_object(
          'reajuste_due_alert', true,
          'contracts_count', v_t.n
        )
      );
      v_count := v_count + 1;
    END LOOP;

    tenant_id := v_t.tenant_id;
    contracts_count := v_t.n;
    members_notified := v_count;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_reajuste_due() FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_reajuste_due() TO service_role;

-- pg_cron: roda dia 1 e dia 15 de cada mês às 09:00 UTC
DO $$
DECLARE v_has_cron boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_cron;
  IF NOT v_has_cron THEN
    RAISE NOTICE '[037] pg_cron ausente — aviso de aniversário precisa rodar manualmente.';
    RETURN;
  END IF;

  BEGIN PERFORM cron.unschedule('reajuste_due_alert_biweekly'); EXCEPTION WHEN others THEN NULL; END;

  PERFORM cron.schedule(
    'reajuste_due_alert_biweekly',
    '0 9 1,15 * *',  -- dia 1 e 15 às 09:00 UTC
    $cron$SELECT * FROM public.notify_reajuste_due();$cron$
  );

  RAISE NOTICE '[037] reajuste_due_alert_biweekly agendado.';
EXCEPTION WHEN others THEN
  RAISE WARNING '[037] erro ao agendar aviso de aniversário: %', SQLERRM;
END;
$$;
