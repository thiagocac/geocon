-- =============================================================================
-- 063_contract_item_audit_trigger
-- =============================================================================
-- Histórico item-level (audit trail) para contract_items.
--
-- Estratégia: reusa a tabela genérica `audit_log` (V01) com
-- entity_type='contract_item'. Trigger AFTER UPDATE captura mudanças nos
-- campos relevantes (preço, quantidade, descrição, locked, fonte_referencia,
-- bdi_percentual) e insere 1 linha em audit_log por update significativo.
--
-- NÃO captura: campos auto-gerenciados (updated_at, quantidade_medida_acumulada
-- via trigger downstream), nem mudanças irrelevantes (metadata jsonb internal).
-- =============================================================================

-- 1) Helper: identifica o actor (member do auth.uid()) ou null
CREATE OR REPLACE FUNCTION public._current_member_id(p_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.members
  WHERE user_id = auth.uid()
    AND tenant_id = p_tenant_id
    AND deleted_at IS NULL
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public._current_member_id(uuid) TO authenticated, service_role;

-- 2) Trigger function
CREATE OR REPLACE FUNCTION public.audit_contract_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_changed  jsonb := '{}'::jsonb;
  v_before   jsonb := '{}'::jsonb;
  v_after    jsonb := '{}'::jsonb;
  v_has_change boolean := false;
BEGIN
  -- Skip soft-delete e re-activation; eventos têm trigger próprio se quiserem
  IF (TG_OP = 'UPDATE' AND OLD.deleted_at IS DISTINCT FROM NEW.deleted_at) THEN
    RETURN NEW;
  END IF;

  -- Detecta mudanças em campos relevantes
  IF OLD.preco_unitario IS DISTINCT FROM NEW.preco_unitario THEN
    v_before := v_before || jsonb_build_object('preco_unitario', OLD.preco_unitario);
    v_after  := v_after  || jsonb_build_object('preco_unitario', NEW.preco_unitario);
    v_has_change := true;
  END IF;

  IF OLD.quantidade_contratada IS DISTINCT FROM NEW.quantidade_contratada THEN
    v_before := v_before || jsonb_build_object('quantidade_contratada', OLD.quantidade_contratada);
    v_after  := v_after  || jsonb_build_object('quantidade_contratada', NEW.quantidade_contratada);
    v_has_change := true;
  END IF;

  IF OLD.quantidade_aditada IS DISTINCT FROM NEW.quantidade_aditada THEN
    v_before := v_before || jsonb_build_object('quantidade_aditada', OLD.quantidade_aditada);
    v_after  := v_after  || jsonb_build_object('quantidade_aditada', NEW.quantidade_aditada);
    v_has_change := true;
  END IF;

  IF OLD.descricao IS DISTINCT FROM NEW.descricao THEN
    v_before := v_before || jsonb_build_object('descricao', OLD.descricao);
    v_after  := v_after  || jsonb_build_object('descricao', NEW.descricao);
    v_has_change := true;
  END IF;

  IF OLD.codigo IS DISTINCT FROM NEW.codigo THEN
    v_before := v_before || jsonb_build_object('codigo', OLD.codigo);
    v_after  := v_after  || jsonb_build_object('codigo', NEW.codigo);
    v_has_change := true;
  END IF;

  IF OLD.unidade IS DISTINCT FROM NEW.unidade THEN
    v_before := v_before || jsonb_build_object('unidade', OLD.unidade);
    v_after  := v_after  || jsonb_build_object('unidade', NEW.unidade);
    v_has_change := true;
  END IF;

  IF OLD.locked IS DISTINCT FROM NEW.locked THEN
    v_before := v_before || jsonb_build_object('locked', OLD.locked);
    v_after  := v_after  || jsonb_build_object('locked', NEW.locked);
    v_has_change := true;
  END IF;

  IF OLD.active IS DISTINCT FROM NEW.active THEN
    v_before := v_before || jsonb_build_object('active', OLD.active);
    v_after  := v_after  || jsonb_build_object('active', NEW.active);
    v_has_change := true;
  END IF;

  IF OLD.fonte_referencia IS DISTINCT FROM NEW.fonte_referencia THEN
    v_before := v_before || jsonb_build_object('fonte_referencia', OLD.fonte_referencia);
    v_after  := v_after  || jsonb_build_object('fonte_referencia', NEW.fonte_referencia);
    v_has_change := true;
  END IF;

  IF OLD.bdi_percentual IS DISTINCT FROM NEW.bdi_percentual THEN
    v_before := v_before || jsonb_build_object('bdi_percentual', OLD.bdi_percentual);
    v_after  := v_after  || jsonb_build_object('bdi_percentual', NEW.bdi_percentual);
    v_has_change := true;
  END IF;

  IF NOT v_has_change THEN
    RETURN NEW;
  END IF;

  v_actor_id := public._current_member_id(NEW.tenant_id);

  INSERT INTO public.audit_log (
    tenant_id, actor_id, entity_type, entity_id, action,
    before_value, after_value, source
  ) VALUES (
    NEW.tenant_id, v_actor_id, 'contract_item', NEW.id, 'update',
    v_before, v_after, 'sov_edit'
  );

  RETURN NEW;
END;
$$;

-- 3) Trigger registration (idempotente)
DROP TRIGGER IF EXISTS trg_audit_contract_item ON public.contract_items;
CREATE TRIGGER trg_audit_contract_item
  AFTER UPDATE ON public.contract_items
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_contract_item_change();

-- 4) RPC: histórico legível por item
-- Retorna lista pronta para UI com join no member.
CREATE OR REPLACE FUNCTION public.list_contract_item_history(p_item_id uuid)
RETURNS TABLE (
  id uuid,
  changed_at timestamptz,
  actor_id uuid,
  actor_nome text,
  action text,
  before_value jsonb,
  after_value jsonb,
  source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id, a.created_at AS changed_at,
    a.actor_id, m.nome AS actor_nome,
    a.action, a.before_value, a.after_value, a.source
  FROM public.audit_log a
  LEFT JOIN public.members m ON m.id = a.actor_id
  WHERE a.entity_type = 'contract_item'
    AND a.entity_id   = p_item_id
  ORDER BY a.created_at DESC
  LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION public.list_contract_item_history(uuid) TO authenticated;

COMMENT ON FUNCTION public.list_contract_item_history(uuid) IS
'V64 — Histórico audit-trail de mudanças em 1 contract_item. ' ||
'Reusa audit_log com entity_type=contract_item. Limite 200 entradas.';
