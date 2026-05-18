-- =============================================================================
-- 041_contract_receipts
-- =============================================================================
-- Recebimento provisório e definitivo (Lei 14.133 art. 140).
--
-- Dois tipos de termo:
--   * Provisório (art. 140 I "a"): até 15 dias após comunicação escrita do
--     contratado. Fiscal técnico verifica execução inicial.
--   * Definitivo (art. 140 I "b"): até 90 dias depois do provisório. Comissão
--     designada atesta adequação aos termos contratuais. Dispara início do
--     prazo de garantia.
--
-- Cada termo pode listar vícios. Termo com vícios fica em status
-- "com_pendencias" até saneamento.
--
-- Recebimento definitivo NÃO pode ser emitido se há vícios não-sanados no
-- provisório que o precede.
-- =============================================================================

-- =============================================================================
-- Tabela principal: termos de recebimento
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.contract_receipts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id          uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,

  -- Tipo + numeração
  tipo                 text NOT NULL
    CHECK (tipo IN ('provisorio', 'definitivo')),
  numero               int NOT NULL,

  -- Status
  status               text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'emitido', 'com_pendencias', 'sanado', 'recusado', 'cancelado')),

  -- Datas chave
  data_comunicacao     date,                       -- comunicação do contratado (art. 140 I "a")
  data_emissao         date,                       -- data do termo
  data_limite_definitivo date,                     -- emissão+90 (computado em provisório)

  -- Conteúdo
  emitido_por_id       uuid REFERENCES public.members(id),
  observacoes_emissao  text,
  parecer_tecnico      text,

  -- Vínculo: definitivo referencia provisório precedente
  provisorio_id        uuid REFERENCES public.contract_receipts(id) ON DELETE RESTRICT,

  -- Vinculação opcional com medições no escopo do termo
  medicao_inicial_id   uuid REFERENCES public.measurements(id),
  medicao_final_id     uuid REFERENCES public.measurements(id),

  -- Garantia (apenas em definitivos)
  prazo_garantia_meses int CHECK (prazo_garantia_meses IS NULL OR prazo_garantia_meses BETWEEN 1 AND 120),
  garantia_inicio      date,
  garantia_fim         date,

  -- Audit
  created_by           uuid REFERENCES public.members(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  metadata             jsonb DEFAULT '{}'::jsonb,

  UNIQUE (contract_id, tipo, numero)
);

CREATE INDEX IF NOT EXISTS idx_receipts_contract  ON public.contract_receipts (contract_id, data_emissao DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_receipts_tenant    ON public.contract_receipts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_receipts_status    ON public.contract_receipts (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_receipts_garantia  ON public.contract_receipts (tenant_id, garantia_fim) WHERE garantia_fim IS NOT NULL;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.trg_touch_receipt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_touch_receipt ON public.contract_receipts;
CREATE TRIGGER trg_touch_receipt BEFORE UPDATE ON public.contract_receipts
  FOR EACH ROW EXECUTE FUNCTION public.trg_touch_receipt();

-- =============================================================================
-- Tabela: vícios identificados no termo
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.contract_receipt_vicios (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  receipt_id        uuid NOT NULL REFERENCES public.contract_receipts(id) ON DELETE CASCADE,

  ordem             int NOT NULL DEFAULT 1,
  severidade        text NOT NULL DEFAULT 'media'
    CHECK (severidade IN ('baixa', 'media', 'alta', 'critica')),
  descricao         text NOT NULL,                 -- ≥20 chars
  local_referencia  text,                          -- ex: "Bloco B · pavimento 3 · sala 304"
  prazo_saneamento_dias int NOT NULL DEFAULT 30 CHECK (prazo_saneamento_dias > 0),
  data_limite_saneamento date,                     -- computado: data_registro + prazo

  -- Status do vício
  status            text NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto', 'em_saneamento', 'sanado', 'aceito_residual', 'cancelado')),

  -- Saneamento
  sanado_at         timestamptz,
  sanado_por_id     uuid REFERENCES public.members(id),
  evidencia_saneamento text,

  created_by        uuid REFERENCES public.members(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vicios_receipt  ON public.contract_receipt_vicios (receipt_id, ordem);
CREATE INDEX IF NOT EXISTS idx_vicios_status   ON public.contract_receipt_vicios (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_vicios_prazo    ON public.contract_receipt_vicios (data_limite_saneamento) WHERE status IN ('aberto','em_saneamento');

CREATE OR REPLACE FUNCTION public.trg_touch_vicio()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_touch_vicio ON public.contract_receipt_vicios;
CREATE TRIGGER trg_touch_vicio BEFORE UPDATE ON public.contract_receipt_vicios
  FOR EACH ROW EXECUTE FUNCTION public.trg_touch_vicio();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE public.contract_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_receipt_vicios ENABLE ROW LEVEL SECURITY;

-- contract_receipts
DROP POLICY IF EXISTS receipts_select ON public.contract_receipts;
CREATE POLICY receipts_select ON public.contract_receipts
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS receipts_write ON public.contract_receipts;
CREATE POLICY receipts_write ON public.contract_receipts
  FOR ALL TO authenticated
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
  )
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

-- contract_receipt_vicios
DROP POLICY IF EXISTS vicios_select ON public.contract_receipt_vicios;
CREATE POLICY vicios_select ON public.contract_receipt_vicios
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS vicios_write ON public.contract_receipt_vicios;
CREATE POLICY vicios_write ON public.contract_receipt_vicios
  FOR ALL TO authenticated
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
  )
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

-- =============================================================================
-- Helper: próximo número sequencial por contrato+tipo
-- =============================================================================
CREATE OR REPLACE FUNCTION public.next_receipt_numero(p_contract_id uuid, p_tipo text)
RETURNS int
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(max(numero), 0) + 1
  FROM public.contract_receipts
  WHERE contract_id = p_contract_id AND tipo = p_tipo;
$$;

-- =============================================================================
-- RPC 1: create_receipt — cria rascunho (provisório ou definitivo)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_receipt(
  p_contract_id        uuid,
  p_tipo               text,
  p_data_comunicacao   date DEFAULT NULL,
  p_provisorio_id      uuid DEFAULT NULL,
  p_medicao_inicial_id uuid DEFAULT NULL,
  p_medicao_final_id   uuid DEFAULT NULL,
  p_observacoes        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant     uuid;
  v_member     uuid;
  v_can        boolean;
  v_id         uuid;
  v_numero     int;
  v_prov_curr  text;
  v_prov_vicios int;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();

  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'fiscal' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_can FROM public.members WHERE id = v_member;
  IF NOT v_can THEN
    RAISE EXCEPTION 'Apenas admin, gestor_contrato ou fiscal podem emitir recebimento';
  END IF;

  IF p_tipo NOT IN ('provisorio', 'definitivo') THEN
    RAISE EXCEPTION 'Tipo deve ser provisorio ou definitivo';
  END IF;

  -- Definitivo exige provisório precedente
  IF p_tipo = 'definitivo' THEN
    IF p_provisorio_id IS NULL THEN
      RAISE EXCEPTION 'Recebimento definitivo exige vínculo com recebimento provisório';
    END IF;
    SELECT status INTO v_prov_curr FROM public.contract_receipts
      WHERE id = p_provisorio_id AND tenant_id = v_tenant AND tipo = 'provisorio';
    IF v_prov_curr IS NULL THEN
      RAISE EXCEPTION 'Provisório informado não encontrado';
    END IF;
    -- Provisório precisa estar emitido OU sanado pra encadear definitivo
    IF v_prov_curr NOT IN ('emitido', 'sanado') THEN
      RAISE EXCEPTION 'Provisório vinculado precisa estar emitido ou sanado (atual: %)', v_prov_curr;
    END IF;
    -- E não pode ter vícios abertos
    SELECT count(*) INTO v_prov_vicios
    FROM public.contract_receipt_vicios
    WHERE receipt_id = p_provisorio_id
      AND status IN ('aberto', 'em_saneamento');
    IF v_prov_vicios > 0 THEN
      RAISE EXCEPTION 'Provisório vinculado tem % víc%s não-sanados — não é possível emitir definitivo',
        v_prov_vicios,
        CASE WHEN v_prov_vicios = 1 THEN 'io' ELSE 'ios' END;
    END IF;
  END IF;

  v_numero := public.next_receipt_numero(p_contract_id, p_tipo);

  INSERT INTO public.contract_receipts (
    tenant_id, contract_id, tipo, numero, status,
    data_comunicacao, provisorio_id,
    medicao_inicial_id, medicao_final_id,
    observacoes_emissao, created_by
  )
  VALUES (
    v_tenant, p_contract_id, p_tipo, v_numero, 'rascunho',
    p_data_comunicacao, p_provisorio_id,
    p_medicao_inicial_id, p_medicao_final_id,
    p_observacoes, v_member
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_receipt(uuid, text, date, uuid, uuid, uuid, text) TO authenticated;

-- =============================================================================
-- RPC 2: emit_receipt — rascunho → emitido
-- Provisório calcula data_limite_definitivo = data_emissao + 90 dias
-- Definitivo inicia garantia (se prazo_garantia_meses informado)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.emit_receipt(
  p_id                   uuid,
  p_data_emissao         date DEFAULT NULL,
  p_parecer_tecnico      text DEFAULT NULL,
  p_prazo_garantia_meses int  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
  v_r      record;
  v_data   date;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();
  v_data   := coalesce(p_data_emissao, current_date);

  SELECT * INTO v_r FROM public.contract_receipts
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_r IS NULL THEN RAISE EXCEPTION 'Recebimento não encontrado'; END IF;
  IF v_r.status <> 'rascunho' THEN
    RAISE EXCEPTION 'Apenas recebimentos em rascunho podem ser emitidos (atual: %)', v_r.status;
  END IF;

  -- Definitivo: garantia opcional mas se informada precisa ter início igual à emissão
  IF v_r.tipo = 'definitivo' AND p_prazo_garantia_meses IS NOT NULL THEN
    UPDATE public.contract_receipts
       SET status               = 'emitido',
           data_emissao         = v_data,
           emitido_por_id       = v_member,
           parecer_tecnico      = p_parecer_tecnico,
           prazo_garantia_meses = p_prazo_garantia_meses,
           garantia_inicio      = v_data,
           garantia_fim         = (v_data + make_interval(months => p_prazo_garantia_meses))::date
     WHERE id = p_id;
  ELSIF v_r.tipo = 'provisorio' THEN
    UPDATE public.contract_receipts
       SET status                 = 'emitido',
           data_emissao           = v_data,
           emitido_por_id         = v_member,
           parecer_tecnico        = p_parecer_tecnico,
           data_limite_definitivo = (v_data + interval '90 days')::date
     WHERE id = p_id;
  ELSE
    UPDATE public.contract_receipts
       SET status         = 'emitido',
           data_emissao   = v_data,
           emitido_por_id = v_member,
           parecer_tecnico= p_parecer_tecnico
     WHERE id = p_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.emit_receipt(uuid, date, text, int) TO authenticated;

-- =============================================================================
-- RPC 3: add_receipt_vicio
-- Vícios em status 'aberto' por default; vincula receipt a 'com_pendencias'
-- =============================================================================
CREATE OR REPLACE FUNCTION public.add_receipt_vicio(
  p_receipt_id        uuid,
  p_descricao         text,
  p_severidade        text DEFAULT 'media',
  p_local_referencia  text DEFAULT NULL,
  p_prazo_saneamento_dias int DEFAULT 30
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_r      record;
  v_ordem  int;
  v_id     uuid;
BEGIN
  v_tenant := public.current_tenant_id();

  IF length(trim(coalesce(p_descricao, ''))) < 20 THEN
    RAISE EXCEPTION 'Descrição do vício deve ter no mínimo 20 caracteres';
  END IF;

  SELECT * INTO v_r FROM public.contract_receipts
    WHERE id = p_receipt_id AND tenant_id = v_tenant;
  IF v_r IS NULL THEN RAISE EXCEPTION 'Recebimento não encontrado'; END IF;
  IF v_r.status NOT IN ('rascunho', 'emitido', 'com_pendencias') THEN
    RAISE EXCEPTION 'Não é possível adicionar vícios em recebimento %', v_r.status;
  END IF;

  SELECT coalesce(max(ordem), 0) + 1 INTO v_ordem
  FROM public.contract_receipt_vicios WHERE receipt_id = p_receipt_id;

  INSERT INTO public.contract_receipt_vicios (
    tenant_id, receipt_id, ordem,
    severidade, descricao, local_referencia,
    prazo_saneamento_dias, data_limite_saneamento,
    created_by
  )
  VALUES (
    v_tenant, p_receipt_id, v_ordem,
    p_severidade, trim(p_descricao), p_local_referencia,
    p_prazo_saneamento_dias,
    (current_date + p_prazo_saneamento_dias)::date,
    public.current_member_id()
  )
  RETURNING id INTO v_id;

  -- Vincula recebimento a com_pendencias se já estava emitido
  IF v_r.status = 'emitido' THEN
    UPDATE public.contract_receipts SET status = 'com_pendencias' WHERE id = p_receipt_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.add_receipt_vicio(uuid, text, text, text, int) TO authenticated;

-- =============================================================================
-- RPC 4: resolve_vicio — marca vício como sanado (ou aceito residual)
-- Se for último vício aberto, recebimento volta a 'sanado'
-- =============================================================================
CREATE OR REPLACE FUNCTION public.resolve_vicio(
  p_vicio_id  uuid,
  p_novo_status text,        -- 'sanado' | 'aceito_residual' | 'cancelado'
  p_evidencia text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant      uuid;
  v_member      uuid;
  v_v           record;
  v_open_left   int;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();

  IF p_novo_status NOT IN ('sanado', 'aceito_residual', 'cancelado') THEN
    RAISE EXCEPTION 'Status inválido: %', p_novo_status;
  END IF;

  SELECT * INTO v_v FROM public.contract_receipt_vicios
    WHERE id = p_vicio_id AND tenant_id = v_tenant;
  IF v_v IS NULL THEN RAISE EXCEPTION 'Vício não encontrado'; END IF;
  IF v_v.status IN ('sanado', 'aceito_residual', 'cancelado') THEN
    RAISE EXCEPTION 'Vício já em estado final (atual: %)', v_v.status;
  END IF;

  UPDATE public.contract_receipt_vicios
     SET status               = p_novo_status,
         sanado_at            = CASE WHEN p_novo_status IN ('sanado','aceito_residual') THEN now() ELSE sanado_at END,
         sanado_por_id        = CASE WHEN p_novo_status IN ('sanado','aceito_residual') THEN v_member ELSE sanado_por_id END,
         evidencia_saneamento = coalesce(p_evidencia, evidencia_saneamento)
   WHERE id = p_vicio_id;

  -- Conta vícios ainda abertos no recebimento
  SELECT count(*) INTO v_open_left
  FROM public.contract_receipt_vicios
  WHERE receipt_id = v_v.receipt_id
    AND status IN ('aberto', 'em_saneamento');

  -- Se zerou, recebimento vira 'sanado'
  IF v_open_left = 0 THEN
    UPDATE public.contract_receipts
       SET status = 'sanado'
     WHERE id = v_v.receipt_id AND status = 'com_pendencias';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_vicio(uuid, text, text) TO authenticated;

-- =============================================================================
-- RPC 5: cancel_receipt
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_receipt(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_r      record;
  v_has_definitivo int;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT * INTO v_r FROM public.contract_receipts
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_r IS NULL THEN RAISE EXCEPTION 'Recebimento não encontrado'; END IF;
  IF v_r.status = 'cancelado' THEN
    RAISE EXCEPTION 'Recebimento já cancelado';
  END IF;

  -- Se é provisório, não pode cancelar se há definitivo vinculado emitido
  IF v_r.tipo = 'provisorio' THEN
    SELECT count(*) INTO v_has_definitivo
    FROM public.contract_receipts
    WHERE provisorio_id = p_id AND status IN ('emitido','sanado','com_pendencias');
    IF v_has_definitivo > 0 THEN
      RAISE EXCEPTION 'Não é possível cancelar provisório com definitivo emitido vinculado';
    END IF;
  END IF;

  UPDATE public.contract_receipts
     SET status = 'cancelado',
         metadata = coalesce(metadata, '{}'::jsonb) ||
                    jsonb_build_object('cancel_reason', coalesce(p_motivo, ''),
                                       'cancelled_at', now(),
                                       'cancelled_by', public.current_member_id())
   WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_receipt(uuid, text) TO authenticated;

-- =============================================================================
-- RPC 6: list_contract_receipts — com count de vícios
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_contract_receipts(p_contract_id uuid)
RETURNS TABLE (
  id                     uuid,
  tipo                   text,
  numero                 int,
  status                 text,
  data_emissao           date,
  data_limite_definitivo date,
  emitido_por_nome       text,
  provisorio_id          uuid,
  provisorio_numero      int,
  prazo_garantia_meses   int,
  garantia_inicio        date,
  garantia_fim           date,
  vicios_abertos         int,
  vicios_total           int,
  created_at             timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id, r.tipo, r.numero, r.status,
    r.data_emissao, r.data_limite_definitivo,
    m.nome AS emitido_por_nome,
    r.provisorio_id,
    p.numero AS provisorio_numero,
    r.prazo_garantia_meses, r.garantia_inicio, r.garantia_fim,
    (SELECT count(*)::int FROM public.contract_receipt_vicios v
       WHERE v.receipt_id = r.id AND v.status IN ('aberto','em_saneamento'))::int AS vicios_abertos,
    (SELECT count(*)::int FROM public.contract_receipt_vicios v
       WHERE v.receipt_id = r.id)::int AS vicios_total,
    r.created_at
  FROM public.contract_receipts r
  LEFT JOIN public.members m ON m.id = r.emitido_por_id
  LEFT JOIN public.contract_receipts p ON p.id = r.provisorio_id
  WHERE r.contract_id = p_contract_id
    AND r.tenant_id = public.current_tenant_id()
  ORDER BY r.tipo, r.numero DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_contract_receipts(uuid) TO authenticated;

-- =============================================================================
-- RPC 7: list_receipt_vicios
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_receipt_vicios(p_receipt_id uuid)
RETURNS TABLE (
  id                     uuid,
  ordem                  int,
  severidade             text,
  descricao              text,
  local_referencia       text,
  prazo_saneamento_dias  int,
  data_limite_saneamento date,
  status                 text,
  sanado_at              timestamptz,
  sanado_por_nome        text,
  evidencia_saneamento   text,
  created_at             timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id, v.ordem, v.severidade, v.descricao, v.local_referencia,
    v.prazo_saneamento_dias, v.data_limite_saneamento,
    v.status, v.sanado_at,
    m.nome AS sanado_por_nome,
    v.evidencia_saneamento,
    v.created_at
  FROM public.contract_receipt_vicios v
  LEFT JOIN public.members m ON m.id = v.sanado_por_id
  WHERE v.receipt_id = p_receipt_id
    AND v.tenant_id  = public.current_tenant_id()
  ORDER BY v.ordem;
$$;
GRANT EXECUTE ON FUNCTION public.list_receipt_vicios(uuid) TO authenticated;

-- =============================================================================
-- RPC 8: get_contract_receipts_summary — KPIs pra UI
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_contract_receipts_summary(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_prov_emitidos int;
  v_def_emitidos  int;
  v_vicios_open   int;
  v_garantia_ativa boolean;
  v_garantia_fim  date;
  v_dias_para_garantia_fim int;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT count(*)::int FILTER (WHERE tipo='provisorio' AND status IN ('emitido','sanado','com_pendencias')),
         count(*)::int FILTER (WHERE tipo='definitivo' AND status IN ('emitido','sanado','com_pendencias'))
  INTO v_prov_emitidos, v_def_emitidos
  FROM public.contract_receipts
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant;

  SELECT count(*)::int INTO v_vicios_open
  FROM public.contract_receipt_vicios v
  JOIN public.contract_receipts r ON r.id = v.receipt_id
  WHERE r.contract_id = p_contract_id
    AND r.tenant_id   = v_tenant
    AND v.status IN ('aberto','em_saneamento');

  -- Garantia ativa: definitivo emitido com garantia_fim > today
  SELECT garantia_fim INTO v_garantia_fim
  FROM public.contract_receipts
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant
    AND tipo = 'definitivo'
    AND status IN ('emitido', 'sanado')
    AND garantia_fim IS NOT NULL
  ORDER BY garantia_fim DESC
  LIMIT 1;

  v_garantia_ativa := v_garantia_fim IS NOT NULL AND v_garantia_fim >= current_date;
  v_dias_para_garantia_fim := CASE
    WHEN v_garantia_fim IS NULL THEN NULL
    ELSE (v_garantia_fim - current_date)
  END;

  RETURN jsonb_build_object(
    'provisorios_emitidos',     v_prov_emitidos,
    'definitivos_emitidos',     v_def_emitidos,
    'vicios_abertos',           v_vicios_open,
    'garantia_ativa',           v_garantia_ativa,
    'garantia_fim',             v_garantia_fim,
    'garantia_dias_restantes',  v_dias_para_garantia_fim
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_contract_receipts_summary(uuid) TO authenticated;
