-- =============================================================================
-- 014_fix_quantidade_medida_acumulada — recalcula contract_items.quantidade_medida_acumulada
-- via aggregate (resolve drift quando uma medição é cancelada ou retificada).
-- A coluna foi ADICIONADA em 011 (ALTER TABLE ... ADD COLUMN IF NOT EXISTS).
-- =============================================================================

-- Recalcula UM contract_item somando medições válidas
CREATE OR REPLACE FUNCTION public.recalc_contract_item_acumulado(p_contract_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.contract_items ci
  SET quantidade_medida_acumulada = coalesce((
    SELECT sum(mi.quantidade_periodo)
    FROM public.measurement_items mi
    JOIN public.measurements m ON m.id = mi.measurement_id
    WHERE mi.contract_item_id = p_contract_item_id
      AND mi.deleted_at IS NULL
      AND m.status IN ('emitida','aprovada','paga')
      AND m.deleted_at IS NULL
  ), 0),
  updated_at = now()
  WHERE ci.id = p_contract_item_id;
END;
$$;

-- Trigger: recalcula ao inserir/atualizar/deletar measurement_item
CREATE OR REPLACE FUNCTION public.tr_recalc_acumulado_on_mi_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.contract_item_id IS NOT NULL THEN
      PERFORM public.recalc_contract_item_acumulado(OLD.contract_item_id);
    END IF;
    RETURN OLD;
  ELSE
    IF NEW.contract_item_id IS NOT NULL THEN
      PERFORM public.recalc_contract_item_acumulado(NEW.contract_item_id);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.contract_item_id IS DISTINCT FROM NEW.contract_item_id
       AND OLD.contract_item_id IS NOT NULL THEN
      PERFORM public.recalc_contract_item_acumulado(OLD.contract_item_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS measurement_items_recalc_acumulado ON public.measurement_items;
CREATE TRIGGER measurement_items_recalc_acumulado
AFTER INSERT OR UPDATE OR DELETE ON public.measurement_items
FOR EACH ROW
EXECUTE FUNCTION public.tr_recalc_acumulado_on_mi_change();

-- Trigger: ao mudar status de measurement entre conta/não-conta, recalcula
CREATE OR REPLACE FUNCTION public.tr_recalc_acumulado_on_meas_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_changed boolean;
BEGIN
  v_changed := (
    (OLD.status IN ('emitida','aprovada','paga') AND NEW.status NOT IN ('emitida','aprovada','paga'))
    OR (OLD.status NOT IN ('emitida','aprovada','paga') AND NEW.status IN ('emitida','aprovada','paga'))
  );
  IF v_changed THEN
    PERFORM public.recalc_contract_item_acumulado(mi.contract_item_id)
    FROM public.measurement_items mi
    WHERE mi.measurement_id = NEW.id AND mi.contract_item_id IS NOT NULL AND mi.deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS measurements_recalc_acumulado_on_status ON public.measurements;
CREATE TRIGGER measurements_recalc_acumulado_on_status
AFTER UPDATE OF status ON public.measurements
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.tr_recalc_acumulado_on_meas_status();

-- Backfill inicial (idempotente)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.contract_items WHERE deleted_at IS NULL LOOP
    PERFORM public.recalc_contract_item_acumulado(r.id);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.recalc_contract_item_acumulado(uuid) TO authenticated;
