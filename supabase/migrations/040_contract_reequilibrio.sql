-- =============================================================================
-- 040_contract_reequilibrio
-- =============================================================================
-- Reequilíbrio econômico-financeiro (Lei 14.133 art. 124).
--
-- Característica distintiva (vs reajuste e repactuação):
--   * Reajuste: índice externo, periódico, automático
--   * Repactuação: CCT/convenção, item-a-item, cálculo direto
--   * Reequilíbrio: evento EXTRAORDINÁRIO, exige análise técnica + decisão
--
-- Workflow:
--   rascunho → em_analise_tecnica → em_aprovacao → aprovado → aplicado
--                                                ↘ recusado
--   * → cancelado (em qualquer etapa antes de aplicado)
-- =============================================================================

-- =============================================================================
-- Tabela principal
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.contract_reequilibrio_requests (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id              uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  numero                   int NOT NULL,

  -- Workflow
  status                   text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'em_analise_tecnica', 'em_aprovacao',
                      'aprovado', 'aplicado', 'recusado', 'cancelado')),

  -- Caracterização do evento
  tipo_evento              text NOT NULL
    CHECK (tipo_evento IN ('alta_insumo', 'baixa_insumo', 'fato_principe',
                           'caso_fortuito', 'forca_maior', 'alea_economica', 'outro')),
  data_evento              date NOT NULL,
  descricao_evento         text NOT NULL,        -- ≥30 chars
  fundamentacao_legal      text NOT NULL DEFAULT 'Lei 14.133/2021 art. 124',

  -- Impacto solicitado
  impacto_tipo             text NOT NULL
    CHECK (impacto_tipo IN ('valor_aumento', 'valor_reducao', 'prazo', 'misto')),
  valor_solicitado         numeric(18,2) DEFAULT 0,
  prazo_solicitado_dias    int DEFAULT 0,

  -- Análise técnica
  parecer_tecnico          text,
  analise_at               timestamptz,
  analista_id              uuid REFERENCES public.members(id),

  -- Decisão
  decisao_motivacao        text,
  valor_aprovado           numeric(18,2),
  prazo_aprovado_dias      int,
  decided_at               timestamptz,
  decided_by               uuid REFERENCES public.members(id),

  -- Aplicação
  applied_at               timestamptz,
  applied_by               uuid REFERENCES public.members(id),
  applied_via_additive_id  uuid REFERENCES public.additives(id) ON DELETE SET NULL,
  application_notes        text,

  -- Audit comum
  created_by               uuid REFERENCES public.members(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  metadata                 jsonb DEFAULT '{}'::jsonb,  -- guarda refs de attachments GED

  UNIQUE (contract_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_reequi_contract  ON public.contract_reequilibrio_requests (contract_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reequi_tenant    ON public.contract_reequilibrio_requests (tenant_id);
CREATE INDEX IF NOT EXISTS idx_reequi_status    ON public.contract_reequilibrio_requests (tenant_id, status);

-- Trigger update_at
CREATE OR REPLACE FUNCTION public.trg_touch_reequilibrio()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_touch_reequilibrio ON public.contract_reequilibrio_requests;
CREATE TRIGGER trg_touch_reequilibrio BEFORE UPDATE ON public.contract_reequilibrio_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_touch_reequilibrio();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE public.contract_reequilibrio_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reequi_select ON public.contract_reequilibrio_requests;
CREATE POLICY reequi_select ON public.contract_reequilibrio_requests
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- Insert: gestor_contrato ou admin podem criar
DROP POLICY IF EXISTS reequi_insert ON public.contract_reequilibrio_requests;
CREATE POLICY reequi_insert ON public.contract_reequilibrio_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin'
             OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'gestor_contrato' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'fiscal' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  );

-- Update: mesmo conjunto, mas via RPC com validação de transição
DROP POLICY IF EXISTS reequi_update ON public.contract_reequilibrio_requests;
CREATE POLICY reequi_update ON public.contract_reequilibrio_requests
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin'
             OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'gestor_contrato' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'fiscal' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  );

-- =============================================================================
-- Helper: próximo número sequencial por contrato
-- =============================================================================
CREATE OR REPLACE FUNCTION public.next_reequilibrio_numero(p_contract_id uuid)
RETURNS int
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(max(numero), 0) + 1
  FROM public.contract_reequilibrio_requests
  WHERE contract_id = p_contract_id;
$$;

-- =============================================================================
-- RPC 1: create_reequilibrio_request
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_reequilibrio_request(
  p_contract_id     uuid,
  p_tipo_evento     text,
  p_data_evento     date,
  p_descricao       text,
  p_impacto_tipo    text,
  p_valor_solicitado numeric DEFAULT 0,
  p_prazo_solicitado_dias int DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   uuid;
  v_member   uuid;
  v_can      boolean;
  v_id       uuid;
  v_numero   int;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();

  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'fiscal' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_can FROM public.members WHERE id = v_member;
  IF NOT v_can THEN
    RAISE EXCEPTION 'Apenas admin, gestor_contrato ou fiscal podem solicitar reequilíbrio';
  END IF;

  IF length(trim(p_descricao)) < 30 THEN
    RAISE EXCEPTION 'Descrição do evento deve ter no mínimo 30 caracteres (caracterização legal)';
  END IF;

  v_numero := public.next_reequilibrio_numero(p_contract_id);

  INSERT INTO public.contract_reequilibrio_requests (
    tenant_id, contract_id, numero, status,
    tipo_evento, data_evento, descricao_evento,
    impacto_tipo, valor_solicitado, prazo_solicitado_dias,
    created_by
  )
  VALUES (
    v_tenant, p_contract_id, v_numero, 'rascunho',
    p_tipo_evento, p_data_evento, trim(p_descricao),
    p_impacto_tipo, coalesce(p_valor_solicitado, 0), coalesce(p_prazo_solicitado_dias, 0),
    v_member
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_reequilibrio_request(uuid, text, date, text, text, numeric, int) TO authenticated;

-- =============================================================================
-- RPC 2: submit_reequilibrio (rascunho → em_analise_tecnica)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.submit_reequilibrio_request(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_curr   text;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT status INTO v_curr FROM public.contract_reequilibrio_requests
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_curr IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  IF v_curr <> 'rascunho' THEN
    RAISE EXCEPTION 'Apenas solicitações em rascunho podem ser submetidas (atual: %)', v_curr;
  END IF;

  UPDATE public.contract_reequilibrio_requests
     SET status = 'em_analise_tecnica'
   WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_reequilibrio_request(uuid) TO authenticated;

-- =============================================================================
-- RPC 3: complete_technical_analysis (em_analise_tecnica → em_aprovacao)
-- Apenas fiscal técnico ou admin podem fazer análise
-- =============================================================================
CREATE OR REPLACE FUNCTION public.complete_technical_analysis(
  p_id              uuid,
  p_parecer_tecnico text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_curr   text;
  v_can    boolean;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'fiscal' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_can FROM public.members WHERE id = public.current_member_id();
  IF NOT v_can THEN
    RAISE EXCEPTION 'Apenas fiscal ou admin podem completar análise técnica';
  END IF;

  IF length(trim(coalesce(p_parecer_tecnico, ''))) < 50 THEN
    RAISE EXCEPTION 'Parecer técnico deve ter no mínimo 50 caracteres';
  END IF;

  SELECT status INTO v_curr FROM public.contract_reequilibrio_requests
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_curr <> 'em_analise_tecnica' THEN
    RAISE EXCEPTION 'Solicitação não está em análise técnica (atual: %)', v_curr;
  END IF;

  UPDATE public.contract_reequilibrio_requests
     SET status      = 'em_aprovacao',
         parecer_tecnico = trim(p_parecer_tecnico),
         analise_at  = now(),
         analista_id = public.current_member_id()
   WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_technical_analysis(uuid, text) TO authenticated;

-- =============================================================================
-- RPC 4: decide_reequilibrio (em_aprovacao → aprovado | recusado)
-- Apenas admin/gestor_contrato
-- =============================================================================
CREATE OR REPLACE FUNCTION public.decide_reequilibrio(
  p_id                 uuid,
  p_aprovar            boolean,
  p_motivacao          text,
  p_valor_aprovado     numeric DEFAULT NULL,
  p_prazo_aprovado_dias int DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_curr   text;
  v_can    boolean;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_can FROM public.members WHERE id = public.current_member_id();
  IF NOT v_can THEN
    RAISE EXCEPTION 'Apenas admin ou gestor_contrato podem decidir';
  END IF;

  IF length(trim(coalesce(p_motivacao, ''))) < 20 THEN
    RAISE EXCEPTION 'Motivação da decisão deve ter no mínimo 20 caracteres';
  END IF;

  SELECT status INTO v_curr FROM public.contract_reequilibrio_requests
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_curr <> 'em_aprovacao' THEN
    RAISE EXCEPTION 'Solicitação não está em aprovação (atual: %)', v_curr;
  END IF;

  UPDATE public.contract_reequilibrio_requests
     SET status                = CASE WHEN p_aprovar THEN 'aprovado' ELSE 'recusado' END,
         decisao_motivacao     = trim(p_motivacao),
         valor_aprovado        = CASE WHEN p_aprovar THEN p_valor_aprovado ELSE NULL END,
         prazo_aprovado_dias   = CASE WHEN p_aprovar THEN p_prazo_aprovado_dias ELSE NULL END,
         decided_at            = now(),
         decided_by            = public.current_member_id()
   WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.decide_reequilibrio(uuid, boolean, text, numeric, int) TO authenticated;

-- =============================================================================
-- RPC 5: apply_reequilibrio (aprovado → aplicado)
-- Marca como aplicado + permite linkar com aditivo formal existente
-- =============================================================================
CREATE OR REPLACE FUNCTION public.apply_reequilibrio(
  p_id                  uuid,
  p_additive_id         uuid DEFAULT NULL,
  p_application_notes   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_curr   text;
  v_can    boolean;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_can FROM public.members WHERE id = public.current_member_id();
  IF NOT v_can THEN
    RAISE EXCEPTION 'Apenas admin ou gestor_contrato podem marcar como aplicado';
  END IF;

  SELECT status INTO v_curr FROM public.contract_reequilibrio_requests
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_curr <> 'aprovado' THEN
    RAISE EXCEPTION 'Apenas reequilíbrios aprovados podem ser marcados como aplicados (atual: %)', v_curr;
  END IF;

  -- Validar aditivo se informado
  IF p_additive_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.additives a
      WHERE a.id = p_additive_id AND a.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'Aditivo informado não encontrado';
    END IF;
  END IF;

  UPDATE public.contract_reequilibrio_requests
     SET status                  = 'aplicado',
         applied_at              = now(),
         applied_by              = public.current_member_id(),
         applied_via_additive_id = p_additive_id,
         application_notes       = p_application_notes
   WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_reequilibrio(uuid, uuid, text) TO authenticated;

-- =============================================================================
-- RPC 6: cancel_reequilibrio (qualquer estado pré-aplicado → cancelado)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_reequilibrio(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_curr   text;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT status INTO v_curr FROM public.contract_reequilibrio_requests
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_curr IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  IF v_curr IN ('aplicado', 'cancelado') THEN
    RAISE EXCEPTION 'Não é possível cancelar (status atual: %)', v_curr;
  END IF;

  UPDATE public.contract_reequilibrio_requests
     SET status   = 'cancelado',
         metadata = coalesce(metadata, '{}'::jsonb) ||
                    jsonb_build_object('cancel_reason', coalesce(p_motivo, ''),
                                       'cancelled_at', now(),
                                       'cancelled_by', public.current_member_id())
   WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_reequilibrio(uuid, text) TO authenticated;

-- =============================================================================
-- RPC 7: list_contract_reequilibrios
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_contract_reequilibrios(p_contract_id uuid)
RETURNS TABLE (
  id                       uuid,
  numero                   int,
  status                   text,
  tipo_evento              text,
  data_evento              date,
  descricao_evento         text,
  impacto_tipo             text,
  valor_solicitado         numeric,
  prazo_solicitado_dias    int,
  valor_aprovado           numeric,
  prazo_aprovado_dias      int,
  created_at               timestamptz,
  created_by_nome          text,
  decided_at               timestamptz,
  applied_at               timestamptz,
  applied_via_additive_id  uuid,
  applied_via_additive_num int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id, r.numero, r.status, r.tipo_evento, r.data_evento, r.descricao_evento,
    r.impacto_tipo, r.valor_solicitado, r.prazo_solicitado_dias,
    r.valor_aprovado, r.prazo_aprovado_dias,
    r.created_at,
    m.nome AS created_by_nome,
    r.decided_at, r.applied_at,
    r.applied_via_additive_id,
    a.numero AS applied_via_additive_num
  FROM public.contract_reequilibrio_requests r
  LEFT JOIN public.members m ON m.id = r.created_by
  LEFT JOIN public.additives a ON a.id = r.applied_via_additive_id
  WHERE r.contract_id = p_contract_id
    AND r.tenant_id = public.current_tenant_id()
  ORDER BY r.numero DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_contract_reequilibrios(uuid) TO authenticated;

-- =============================================================================
-- RPC 8: get_reequilibrio_detail
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_reequilibrio_detail(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(r) ||
         jsonb_build_object(
           'created_by_nome',  (SELECT nome FROM public.members WHERE id = r.created_by),
           'analista_nome',    (SELECT nome FROM public.members WHERE id = r.analista_id),
           'decided_by_nome',  (SELECT nome FROM public.members WHERE id = r.decided_by),
           'applied_by_nome',  (SELECT nome FROM public.members WHERE id = r.applied_by),
           'additive_numero',  (SELECT numero FROM public.additives WHERE id = r.applied_via_additive_id),
           'contract_numero',  (SELECT numero FROM public.contracts WHERE id = r.contract_id)
         )
  INTO v_result
  FROM public.contract_reequilibrio_requests r
  WHERE r.id = p_id
    AND r.tenant_id = public.current_tenant_id();

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Solicitação não encontrada';
  END IF;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_reequilibrio_detail(uuid) TO authenticated;

-- =============================================================================
-- RPC 9: get_contract_reequilibrio_summary
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_contract_reequilibrio_summary(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_total  int;
  v_open   int;
  v_aplic  int;
  v_recus  int;
  v_aprovado_valor numeric;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT
    count(*),
    count(*) FILTER (WHERE status IN ('rascunho','em_analise_tecnica','em_aprovacao','aprovado')),
    count(*) FILTER (WHERE status = 'aplicado'),
    count(*) FILTER (WHERE status = 'recusado'),
    coalesce(sum(valor_aprovado) FILTER (WHERE status IN ('aprovado','aplicado')), 0)
  INTO v_total, v_open, v_aplic, v_recus, v_aprovado_valor
  FROM public.contract_reequilibrio_requests
  WHERE contract_id = p_contract_id
    AND tenant_id   = v_tenant;

  RETURN jsonb_build_object(
    'total',           v_total,
    'open',            v_open,
    'aplicado',        v_aplic,
    'recusado',        v_recus,
    'valor_aprovado_total', v_aprovado_valor
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_contract_reequilibrio_summary(uuid) TO authenticated;
