-- =============================================================================
-- 023_sov_bulk_operations
-- =============================================================================
-- Operações em lote sobre contract_items (planilha SOV):
--   (1) bulk_lock_items       — bloqueia/desbloqueia em massa
--   (2) bulk_set_discipline   — reatribui disciplina em massa
--   (3) bulk_adjust_prices    — aplica % de aumento/desconto no preço unitário
--   (4) bulk_soft_delete      — soft-delete em massa (com sanity check de medições)
--
-- Todas as RPCs:
--   - SECURITY DEFINER + SET search_path = public
--   - validam tenant_id ativo
--   - respeitam `locked` (não permite alterar itens travados)
--   - geram audit_log por item afetado
--   - retornam JSONB com {affected, blocked_locked, blocked_other, errors}

-- =============================================================================
-- 1. bulk_lock_items — trava ou destrava
-- =============================================================================
CREATE OR REPLACE FUNCTION public.bulk_lock_items(
  p_item_ids uuid[],
  p_lock     boolean,
  p_motivo   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
  v_affected int := 0;
  v_blocked  int := 0;
  v_item record;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();
  IF v_tenant IS NULL OR v_member IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  FOR v_item IN
    SELECT id, locked, contract_id FROM public.contract_items
    WHERE id = ANY(p_item_ids)
      AND tenant_id = v_tenant
      AND deleted_at IS NULL
  LOOP
    -- Lock/unlock idempotente: pular se já no estado desejado
    IF v_item.locked = p_lock THEN
      v_blocked := v_blocked + 1;
      CONTINUE;
    END IF;

    UPDATE public.contract_items
       SET locked = p_lock,
           updated_at = now(),
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             CASE WHEN p_lock THEN 'locked_at' ELSE 'unlocked_at' END, now(),
             CASE WHEN p_lock THEN 'locked_by' ELSE 'unlocked_by' END, v_member,
             CASE WHEN p_lock THEN 'lock_motivo' ELSE 'unlock_motivo' END, p_motivo
           )
     WHERE id = v_item.id;

    INSERT INTO public.audit_log (tenant_id, member_id, entity_type, entity_id, action, before_value, after_value, metadata)
    VALUES (v_tenant, v_member, 'contract_item', v_item.id,
            CASE WHEN p_lock THEN 'bulk_lock' ELSE 'bulk_unlock' END,
            jsonb_build_object('locked', v_item.locked),
            jsonb_build_object('locked', p_lock),
            jsonb_build_object('motivo', p_motivo, 'bulk_size', array_length(p_item_ids, 1)));

    v_affected := v_affected + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'affected', v_affected,
    'skipped',  v_blocked,
    'requested', array_length(p_item_ids, 1)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_lock_items(uuid[], boolean, text) TO authenticated;

-- =============================================================================
-- 2. bulk_set_discipline — reatribui disciplina
-- =============================================================================
CREATE OR REPLACE FUNCTION public.bulk_set_discipline(
  p_item_ids uuid[],
  p_discipline_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
  v_affected int := 0;
  v_blocked_locked int := 0;
  v_item record;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();
  IF v_tenant IS NULL OR v_member IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- Verificar disciplina existe e pertence ao tenant
  IF p_discipline_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.disciplines
    WHERE id = p_discipline_id AND tenant_id = v_tenant AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Disciplina inválida ou não pertence ao tenant';
  END IF;

  FOR v_item IN
    SELECT id, discipline_id, locked FROM public.contract_items
    WHERE id = ANY(p_item_ids)
      AND tenant_id = v_tenant
      AND deleted_at IS NULL
  LOOP
    IF v_item.locked THEN
      v_blocked_locked := v_blocked_locked + 1;
      CONTINUE;
    END IF;
    IF v_item.discipline_id IS NOT DISTINCT FROM p_discipline_id THEN
      CONTINUE; -- idempotente
    END IF;

    UPDATE public.contract_items
       SET discipline_id = p_discipline_id, updated_at = now()
     WHERE id = v_item.id;

    INSERT INTO public.audit_log (tenant_id, member_id, entity_type, entity_id, action, before_value, after_value, metadata)
    VALUES (v_tenant, v_member, 'contract_item', v_item.id, 'bulk_set_discipline',
            jsonb_build_object('discipline_id', v_item.discipline_id),
            jsonb_build_object('discipline_id', p_discipline_id),
            jsonb_build_object('bulk_size', array_length(p_item_ids, 1)));

    v_affected := v_affected + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'affected', v_affected,
    'blocked_locked', v_blocked_locked,
    'requested', array_length(p_item_ids, 1)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_set_discipline(uuid[], uuid) TO authenticated;

-- =============================================================================
-- 3. bulk_adjust_prices — aplica fator multiplicativo no preço unitário
-- =============================================================================
-- p_factor = 1.05 → +5%, 0.9 → -10%, etc
-- Validação: 0.1 <= factor <= 10.0 (impede zerar ou multiplicar por 100x)
CREATE OR REPLACE FUNCTION public.bulk_adjust_prices(
  p_item_ids uuid[],
  p_factor   numeric,
  p_motivo   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
  v_affected int := 0;
  v_blocked_locked int := 0;
  v_blocked_measured int := 0;
  v_item record;
  v_new_price numeric;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();
  IF v_tenant IS NULL OR v_member IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF p_factor < 0.1 OR p_factor > 10.0 THEN
    RAISE EXCEPTION 'Fator inválido: % (permitido 0.1 a 10.0)', p_factor;
  END IF;

  IF length(coalesce(trim(p_motivo), '')) < 5 THEN
    RAISE EXCEPTION 'Motivo é obrigatório (mín 5 caracteres) para alteração de preços em massa';
  END IF;

  FOR v_item IN
    SELECT id, preco_unitario, locked, quantidade_medida_acumulada
    FROM public.contract_items ci
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(mi.quantidade), 0) AS quantidade_medida_acumulada
      FROM public.measurement_items mi
      JOIN public.measurements m ON m.id = mi.measurement_id
      WHERE mi.contract_item_id = ci.id
        AND m.status IN ('aprovada','paga','emitida')
        AND m.deleted_at IS NULL
    ) med ON true
    WHERE ci.id = ANY(p_item_ids)
      AND ci.tenant_id = v_tenant
      AND ci.deleted_at IS NULL
  LOOP
    IF v_item.locked THEN
      v_blocked_locked := v_blocked_locked + 1;
      CONTINUE;
    END IF;
    IF v_item.quantidade_medida_acumulada > 0 THEN
      v_blocked_measured := v_blocked_measured + 1;
      CONTINUE;
    END IF;

    v_new_price := round((v_item.preco_unitario * p_factor)::numeric, 6);
    UPDATE public.contract_items
       SET preco_unitario = v_new_price, updated_at = now()
     WHERE id = v_item.id;

    INSERT INTO public.audit_log (tenant_id, member_id, entity_type, entity_id, action, before_value, after_value, metadata)
    VALUES (v_tenant, v_member, 'contract_item', v_item.id, 'bulk_adjust_price',
            jsonb_build_object('preco_unitario', v_item.preco_unitario),
            jsonb_build_object('preco_unitario', v_new_price),
            jsonb_build_object('factor', p_factor, 'motivo', p_motivo, 'bulk_size', array_length(p_item_ids, 1)));

    v_affected := v_affected + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'affected', v_affected,
    'blocked_locked', v_blocked_locked,
    'blocked_measured', v_blocked_measured,
    'requested', array_length(p_item_ids, 1)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_adjust_prices(uuid[], numeric, text) TO authenticated;

-- =============================================================================
-- 4. bulk_soft_delete — exclusão em massa com sanity check
-- =============================================================================
CREATE OR REPLACE FUNCTION public.bulk_soft_delete_items(
  p_item_ids uuid[],
  p_motivo   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
  v_affected int := 0;
  v_blocked_locked int := 0;
  v_blocked_measured int := 0;
  v_item record;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();
  IF v_tenant IS NULL OR v_member IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF length(coalesce(trim(p_motivo), '')) < 5 THEN
    RAISE EXCEPTION 'Motivo é obrigatório (mín 5 caracteres) para exclusão em massa';
  END IF;

  FOR v_item IN
    SELECT id, locked,
           (SELECT count(*) FROM public.measurement_items mi
             JOIN public.measurements m ON m.id = mi.measurement_id
             WHERE mi.contract_item_id = ci.id
               AND m.deleted_at IS NULL) AS measurement_refs
    FROM public.contract_items ci
    WHERE ci.id = ANY(p_item_ids)
      AND ci.tenant_id = v_tenant
      AND ci.deleted_at IS NULL
  LOOP
    IF v_item.locked THEN
      v_blocked_locked := v_blocked_locked + 1;
      CONTINUE;
    END IF;
    IF v_item.measurement_refs > 0 THEN
      v_blocked_measured := v_blocked_measured + 1;
      CONTINUE;
    END IF;

    UPDATE public.contract_items
       SET deleted_at = now(), updated_at = now()
     WHERE id = v_item.id;

    INSERT INTO public.audit_log (tenant_id, member_id, entity_type, entity_id, action, before_value, after_value, metadata)
    VALUES (v_tenant, v_member, 'contract_item', v_item.id, 'bulk_soft_delete', NULL, NULL,
            jsonb_build_object('motivo', p_motivo, 'bulk_size', array_length(p_item_ids, 1)));

    v_affected := v_affected + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'affected', v_affected,
    'blocked_locked', v_blocked_locked,
    'blocked_measured', v_blocked_measured,
    'requested', array_length(p_item_ids, 1)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_soft_delete_items(uuid[], text) TO authenticated;
