-- =============================================================================
-- 066_price_divergence_and_audit_source
-- =============================================================================
-- 1) View v_contract_price_divergence: lista itens onde preco_unitario diverge
--    do preço calculado pela composição × (1+BDI). Liga V57 + V64 + V66.
--
-- 2) Helper set_audit_source(text): permite endpoints específicos
--    (SovImport, SovBulk) marcarem origem da mudança no trigger V64.
--    Sem isso, todos os UPDATEs ficam como 'sov_edit' por default.
-- =============================================================================

-- =============================================================================
-- View v_contract_price_divergence
-- =============================================================================
-- Para cada contract_item que TEM composição cadastrada:
--   - preco_unitario_atual : valor cravado em contract_items
--   - preco_calculado      : total_sem_bdi × (1 + bdi/100)
--   - divergencia_abs      : abs(atual - calculado)
--   - divergencia_pct      : divergência relativa ao calculado
--   - severidade           : faixas para badges (ok ≤2% / atenção ≤10% / alerta ≤25% / crítico >25%)
-- =============================================================================

CREATE OR REPLACE VIEW public.v_contract_price_divergence AS
SELECT
  ci.id              AS item_id,
  ci.tenant_id,
  ci.contract_id,
  ci.codigo,
  ci.descricao,
  ci.unidade,
  ci.quantidade_contratada,
  ci.preco_unitario  AS preco_atual,
  s.id               AS composition_id,
  s.codigo_composicao,
  s.fonte,
  s.data_base,
  s.total_sem_bdi,
  coalesce(ci.bdi_percentual, 0)::numeric(8,4) AS bdi_percentual,
  round(s.total_sem_bdi * (1 + coalesce(ci.bdi_percentual, 0) / 100.0), 6)::numeric(18,6) AS preco_calculado,
  round(ci.preco_unitario - (s.total_sem_bdi * (1 + coalesce(ci.bdi_percentual, 0) / 100.0)), 6)::numeric(18,6) AS divergencia_abs,
  CASE
    WHEN s.total_sem_bdi = 0 OR ci.preco_unitario = 0 THEN 0
    ELSE round(
      (ci.preco_unitario - (s.total_sem_bdi * (1 + coalesce(ci.bdi_percentual, 0) / 100.0))) * 100.0
      / NULLIF(s.total_sem_bdi * (1 + coalesce(ci.bdi_percentual, 0) / 100.0), 0),
      4
    )
  END::numeric(8,4) AS divergencia_pct,
  CASE
    WHEN s.total_sem_bdi = 0 OR ci.preco_unitario = 0 THEN 'indeterminado'
    WHEN abs(
      (ci.preco_unitario - (s.total_sem_bdi * (1 + coalesce(ci.bdi_percentual, 0) / 100.0))) * 100.0
      / NULLIF(s.total_sem_bdi * (1 + coalesce(ci.bdi_percentual, 0) / 100.0), 0)
    ) <= 2  THEN 'ok'
    WHEN abs(
      (ci.preco_unitario - (s.total_sem_bdi * (1 + coalesce(ci.bdi_percentual, 0) / 100.0))) * 100.0
      / NULLIF(s.total_sem_bdi * (1 + coalesce(ci.bdi_percentual, 0) / 100.0), 0)
    ) <= 10 THEN 'atencao'
    WHEN abs(
      (ci.preco_unitario - (s.total_sem_bdi * (1 + coalesce(ci.bdi_percentual, 0) / 100.0))) * 100.0
      / NULLIF(s.total_sem_bdi * (1 + coalesce(ci.bdi_percentual, 0) / 100.0), 0)
    ) <= 25 THEN 'alerta'
    ELSE 'critico'
  END AS severidade,
  round((ci.preco_unitario - (s.total_sem_bdi * (1 + coalesce(ci.bdi_percentual, 0) / 100.0))) * ci.quantidade_contratada, 4)::numeric(18,4) AS impacto_financeiro
FROM public.contract_items ci
JOIN public.v_contract_item_composition_summary s ON s.contract_item_id = ci.id
WHERE ci.active = true
  AND ci.deleted_at IS NULL;

COMMENT ON VIEW public.v_contract_price_divergence IS
'V67 — Divergência entre preço cravado e calculado por composição. ' ||
'Severidade ok ≤2% / atenção ≤10% / alerta ≤25% / crítico >25%.';

-- =============================================================================
-- RPC: lista divergências de um contrato com filtro opcional de severidade
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_contract_price_divergences(
  p_contract_id uuid,
  p_severidades text[] DEFAULT NULL
)
RETURNS TABLE (
  item_id uuid, codigo text, descricao text, unidade text,
  quantidade_contratada numeric, preco_atual numeric, preco_calculado numeric,
  divergencia_abs numeric, divergencia_pct numeric, severidade text,
  impacto_financeiro numeric, composition_id uuid, codigo_composicao text,
  fonte text, data_base date, bdi_percentual numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    item_id, codigo, descricao, unidade,
    quantidade_contratada, preco_atual, preco_calculado,
    divergencia_abs, divergencia_pct, severidade,
    impacto_financeiro, composition_id, codigo_composicao,
    fonte, data_base, bdi_percentual
  FROM public.v_contract_price_divergence
  WHERE contract_id = p_contract_id
    AND (p_severidades IS NULL OR severidade = ANY(p_severidades))
  ORDER BY abs(divergencia_pct) DESC NULLS LAST, codigo;
$$;

GRANT EXECUTE ON FUNCTION public.list_contract_price_divergences(uuid, text[]) TO authenticated;

-- =============================================================================
-- Helper set_audit_source — para SovImport/SovBulk marcarem origem
-- =============================================================================
-- Endpoints chamam `SELECT set_audit_source('sov_import')` antes de fazer
-- bulk UPDATEs. O trigger V64 (atualizado abaixo) lê current_setting().
-- SET LOCAL é session-scoped — não vaza para outras transações.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_audit_source(p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- SET LOCAL exige LOCAL=true; só vale dentro da transação corrente
  PERFORM set_config('app.audit_source', p_source, true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_audit_source(text) TO authenticated;

-- Atualiza trigger V64 para ler app.audit_source com fallback 'sov_edit'
CREATE OR REPLACE FUNCTION public.audit_contract_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_before   jsonb := '{}'::jsonb;
  v_after    jsonb := '{}'::jsonb;
  v_has_change boolean := false;
  v_source   text;
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.deleted_at IS DISTINCT FROM NEW.deleted_at) THEN
    RETURN NEW;
  END IF;

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
  -- V67: lê app.audit_source com fallback 'sov_edit'
  v_source := coalesce(nullif(current_setting('app.audit_source', true), ''), 'sov_edit');

  INSERT INTO public.audit_log (
    tenant_id, actor_id, entity_type, entity_id, action,
    before_value, after_value, source
  ) VALUES (
    NEW.tenant_id, v_actor_id, 'contract_item', NEW.id, 'update',
    v_before, v_after, v_source
  );

  RETURN NEW;
END;
$$;
