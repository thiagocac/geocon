-- =============================================================================
-- 069_competitor_compositions
-- =============================================================================
-- V72 — Comparação composição própria vs propostas concorrentes.
--
-- Em licitação, equipe técnica quer saber: "minha composição R$ 715/m³,
-- concorrente A cotou R$ 698 e concorrente B R$ 742 — qual é o desvio?"
--
-- Tabela armazena snapshot de preço unitário de concorrente por item, com
-- metadata (nome empresa, data da proposta, etc). View deriva diferença
-- vs preço próprio calculado pela composição.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.contract_item_competitor_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id),
  contract_item_id uuid NOT NULL REFERENCES public.contract_items(id) ON DELETE CASCADE,
  competitor_name  text NOT NULL,                      -- "Empresa Alfa LTDA"
  competitor_cnpj  text,                                -- opcional
  preco_unitario   numeric(18,6) NOT NULL CHECK (preco_unitario >= 0),
  data_proposta    date,
  origem           text NOT NULL DEFAULT 'manual'
    CHECK (origem IN ('manual','licitacao_publica','sirhad','outro')),
  observacao       text,
  created_by       uuid REFERENCES public.members(id),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cicp_item ON public.contract_item_competitor_prices (contract_item_id, created_at DESC);

ALTER TABLE public.contract_item_competitor_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cicp_select ON public.contract_item_competitor_prices;
CREATE POLICY cicp_select ON public.contract_item_competitor_prices
  FOR SELECT TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

DROP POLICY IF EXISTS cicp_modify ON public.contract_item_competitor_prices;
CREATE POLICY cicp_modify ON public.contract_item_competitor_prices
  FOR ALL TO authenticated USING (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  ) WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

-- View comparativa por item (com composição própria como referência)
CREATE OR REPLACE VIEW public.v_contract_item_competitor_comparison AS
SELECT
  ci.id                AS contract_item_id,
  ci.contract_id,
  ci.tenant_id,
  ci.codigo,
  ci.descricao,
  ci.unidade,
  ci.preco_unitario    AS preco_proprio,
  s.total_sem_bdi      AS proprio_sem_bdi,
  s.id                 AS composition_id,
  cp.id                AS competitor_id,
  cp.competitor_name,
  cp.competitor_cnpj,
  cp.preco_unitario    AS preco_competitor,
  cp.data_proposta,
  cp.origem,
  round((cp.preco_unitario - ci.preco_unitario), 6)::numeric(18,6) AS diff_abs,
  CASE
    WHEN ci.preco_unitario = 0 THEN 0
    ELSE round((cp.preco_unitario - ci.preco_unitario) * 100 / ci.preco_unitario, 4)
  END::numeric(8,4) AS diff_pct
FROM public.contract_items ci
JOIN public.contract_item_competitor_prices cp ON cp.contract_item_id = ci.id
LEFT JOIN public.v_contract_item_composition_summary s ON s.contract_item_id = ci.id
WHERE ci.active = true AND ci.deleted_at IS NULL;

-- RPC list por contrato
CREATE OR REPLACE FUNCTION public.list_contract_competitor_comparison(p_contract_id uuid)
RETURNS SETOF public.v_contract_item_competitor_comparison
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.v_contract_item_competitor_comparison
  WHERE contract_id = p_contract_id
  ORDER BY codigo, competitor_name;
$$;
GRANT EXECUTE ON FUNCTION public.list_contract_competitor_comparison(uuid) TO authenticated;

COMMENT ON TABLE public.contract_item_competitor_prices IS
'V72 — Preços de concorrentes para benchmarking de licitação. ' ||
'Cada linha representa cotação de 1 concorrente para 1 item.';
