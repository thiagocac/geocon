-- =============================================================================
-- 065_contract_item_compositions
-- =============================================================================
-- Composições de preço explícitas para itens contratuais (SOV).
--
-- Cada item de SOV pode ter (opcionalmente) uma composição que decompõe seu
-- preço unitário em insumos: mão-de-obra, material, equipamento, terceiros.
-- Cada linha tem coeficiente (qty insumo por unidade do serviço) × preço
-- unitário do insumo. Soma das linhas = preço sem BDI. Com BDI aplicado =
-- preço unitário que vai pra contract_items.preco_unitario.
--
-- Modelo paralelo ao SINAPI/SICRO oficiais — permite importar composições
-- diretamente desses catálogos.
--
-- V66 só implementa schema + leitura + cálculo + UI. Edit inline fica
-- para V67+ (ou import via Excel/CSV que já existe na infra atual).
-- =============================================================================

-- 1) Header — 1:1 com contract_item (UNIQUE constraint)
CREATE TABLE IF NOT EXISTS public.contract_item_compositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id),
  contract_item_id uuid NOT NULL REFERENCES public.contract_items(id) ON DELETE CASCADE,
  codigo_composicao text,  -- ex: '92395' (SINAPI), 'CIVIL-001' (SICRO)
  fonte text NOT NULL DEFAULT 'proprio'
    CHECK (fonte IN ('SINAPI','SICRO','ORSE','SEDOP','proprio','outro')),
  data_base date,           -- mês/ano da referência da fonte
  observacao text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.members(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

-- 1 composição por item (não pode duplicar; soft-delete antes de criar nova)
CREATE UNIQUE INDEX IF NOT EXISTS contract_item_compositions_unique
  ON public.contract_item_compositions (contract_item_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contract_item_compositions_tenant
  ON public.contract_item_compositions (tenant_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.contract_item_compositions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cic_select ON public.contract_item_compositions;
CREATE POLICY cic_select ON public.contract_item_compositions
  FOR SELECT TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

DROP POLICY IF EXISTS cic_modify ON public.contract_item_compositions;
CREATE POLICY cic_modify ON public.contract_item_compositions
  FOR ALL TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  ) WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

-- 2) Linhas — N por composition (FK CASCADE para limpar com header)
CREATE TABLE IF NOT EXISTS public.contract_item_composition_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id),
  composition_id uuid NOT NULL REFERENCES public.contract_item_compositions(id) ON DELETE CASCADE,
  ordem int NOT NULL DEFAULT 0,
  tipo text NOT NULL
    CHECK (tipo IN ('mao_obra','material','equipamento','servico_terceiro','consumo_auxiliar')),
  codigo      text,        -- código do insumo no SINAPI/SICRO/etc
  descricao   text NOT NULL,
  unidade     text NOT NULL,
  coeficiente numeric(18,8) NOT NULL CHECK (coeficiente >= 0),  -- 8 dec p/ precisão SINAPI
  preco_unitario numeric(18,6) NOT NULL DEFAULT 0 CHECK (preco_unitario >= 0),
  observacao text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cic_lines_composition
  ON public.contract_item_composition_lines (composition_id, ordem);

CREATE INDEX IF NOT EXISTS idx_cic_lines_tenant
  ON public.contract_item_composition_lines (tenant_id);

ALTER TABLE public.contract_item_composition_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cic_lines_select ON public.contract_item_composition_lines;
CREATE POLICY cic_lines_select ON public.contract_item_composition_lines
  FOR SELECT TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

DROP POLICY IF EXISTS cic_lines_modify ON public.contract_item_composition_lines;
CREATE POLICY cic_lines_modify ON public.contract_item_composition_lines
  FOR ALL TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  ) WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

-- 3) View agregada — pronta para o frontend
-- Calcula totais por tipo + total geral sem BDI.
-- O preço com BDI é calculado na aplicação (precisa de contract_items.bdi_percentual).
CREATE OR REPLACE VIEW public.v_contract_item_composition_summary AS
SELECT
  c.id,
  c.tenant_id,
  c.contract_item_id,
  c.codigo_composicao,
  c.fonte,
  c.data_base,
  c.observacao,
  c.created_at,
  c.updated_at,
  coalesce(SUM(CASE WHEN l.tipo = 'mao_obra'          THEN l.coeficiente * l.preco_unitario END), 0)::numeric(18,4) AS total_mao_obra,
  coalesce(SUM(CASE WHEN l.tipo = 'material'          THEN l.coeficiente * l.preco_unitario END), 0)::numeric(18,4) AS total_material,
  coalesce(SUM(CASE WHEN l.tipo = 'equipamento'       THEN l.coeficiente * l.preco_unitario END), 0)::numeric(18,4) AS total_equipamento,
  coalesce(SUM(CASE WHEN l.tipo = 'servico_terceiro'  THEN l.coeficiente * l.preco_unitario END), 0)::numeric(18,4) AS total_terceiros,
  coalesce(SUM(CASE WHEN l.tipo = 'consumo_auxiliar'  THEN l.coeficiente * l.preco_unitario END), 0)::numeric(18,4) AS total_aux,
  coalesce(SUM(l.coeficiente * l.preco_unitario), 0)::numeric(18,4) AS total_sem_bdi,
  count(l.id)::int AS num_linhas
FROM public.contract_item_compositions c
LEFT JOIN public.contract_item_composition_lines l ON l.composition_id = c.id
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.tenant_id, c.contract_item_id, c.codigo_composicao, c.fonte,
         c.data_base, c.observacao, c.created_at, c.updated_at;

-- 4) RPC: get composition completa por item (header + lines + summary)
-- Atalho para reduzir round-trips client-side.
CREATE OR REPLACE FUNCTION public.get_contract_item_composition(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary jsonb;
  v_lines   jsonb;
BEGIN
  SELECT to_jsonb(s.*) INTO v_summary
    FROM public.v_contract_item_composition_summary s
   WHERE s.contract_item_id = p_item_id
   LIMIT 1;

  IF v_summary IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(l.*) ORDER BY l.tipo, l.ordem, l.codigo), '[]'::jsonb)
    INTO v_lines
    FROM public.contract_item_composition_lines l
   WHERE l.composition_id = (v_summary->>'id')::uuid;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'lines',   v_lines
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_contract_item_composition(uuid) TO authenticated;

-- 5) RPC: aplica preço calculado (com BDI) em contract_items.preco_unitario
-- Usuário pode decidir quando sincronizar; não há trigger automático para
-- preservar liberdade editorial (preço da proposta pode ser maior/menor
-- que o calculado por motivos de mercado).
CREATE OR REPLACE FUNCTION public.apply_composition_price_to_item(p_composition_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item_id   uuid;
  v_total     numeric;
  v_bdi       numeric;
  v_new_price numeric;
  v_old_price numeric;
BEGIN
  -- Pega item e total da view
  SELECT s.contract_item_id, s.total_sem_bdi
    INTO v_item_id, v_total
    FROM public.v_contract_item_composition_summary s
   WHERE s.id = p_composition_id;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'Composição não encontrada';
  END IF;

  -- Pega BDI do item + preço atual
  SELECT bdi_percentual, preco_unitario INTO v_bdi, v_old_price
    FROM public.contract_items WHERE id = v_item_id;

  v_new_price := round(v_total * (1 + coalesce(v_bdi, 0) / 100.0), 6);

  -- Update — trigger V64 grava em audit_log automaticamente
  UPDATE public.contract_items
     SET preco_unitario = v_new_price,
         updated_at = now()
   WHERE id = v_item_id;

  RETURN jsonb_build_object(
    'item_id',        v_item_id,
    'total_sem_bdi',  v_total,
    'bdi_percentual', v_bdi,
    'preco_anterior', v_old_price,
    'preco_novo',     v_new_price
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_composition_price_to_item(uuid) TO authenticated;

COMMENT ON TABLE public.contract_item_compositions IS
'V66 — Composição de preço de 1 contract_item. Decompõe preço em insumos.';

COMMENT ON FUNCTION public.get_contract_item_composition(uuid) IS
'V66 — Retorna composição completa (summary + lines) de 1 item em 1 jsonb.';

COMMENT ON FUNCTION public.apply_composition_price_to_item(uuid) IS
'V66 — Aplica total_sem_bdi × (1+BDI) ao preco_unitario do item. Sem trigger ' ||
'automático: usuário decide quando sincronizar.';
