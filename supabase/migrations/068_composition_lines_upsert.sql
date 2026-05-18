-- =============================================================================
-- 068_composition_lines_upsert
-- =============================================================================
-- V69 — Edição inline de composição de preço. Completa V66 (read-only +
-- sync) com capacidade de criar/atualizar/remover linhas atomicamente.
--
-- RPC replace_composition_lines(composition_id, lines jsonb) substitui o
-- conjunto inteiro de linhas:
--   1. Delete todas as linhas atuais do composition
--   2. Insert as fornecidas
--   Tudo em 1 transação. Se qualquer linha for inválida, rollback total.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.replace_composition_lines(
  p_composition_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_count  int;
BEGIN
  -- Valida ownership via RLS implícita
  SELECT tenant_id INTO v_tenant
    FROM public.contract_item_compositions
   WHERE id = p_composition_id AND deleted_at IS NULL;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Composição não encontrada ou sem acesso';
  END IF;

  -- Delete linhas atuais
  DELETE FROM public.contract_item_composition_lines
   WHERE composition_id = p_composition_id;

  -- Insert novas (jsonb_to_recordset valida tipos)
  INSERT INTO public.contract_item_composition_lines (
    tenant_id, composition_id, ordem, tipo, codigo, descricao, unidade,
    coeficiente, preco_unitario, observacao
  )
  SELECT
    v_tenant,
    p_composition_id,
    coalesce(l.ordem, 0),
    l.tipo,
    nullif(l.codigo, ''),
    l.descricao,
    l.unidade,
    l.coeficiente,
    l.preco_unitario,
    nullif(l.observacao, '')
  FROM jsonb_to_recordset(p_lines) AS l(
    ordem int, tipo text, codigo text, descricao text, unidade text,
    coeficiente numeric, preco_unitario numeric, observacao text
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Atualiza header timestamp
  UPDATE public.contract_item_compositions
     SET updated_at = now()
   WHERE id = p_composition_id;

  RETURN jsonb_build_object(
    'composition_id', p_composition_id,
    'lines_count',    v_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_composition_lines(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.replace_composition_lines(uuid, jsonb) IS
'V69 — Substitui atomicamente todas as linhas de uma composição. ' ||
'Útil para editor que carrega linhas, usuário modifica/adiciona/remove, ' ||
'e salva tudo de uma vez.';
