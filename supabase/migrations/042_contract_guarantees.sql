-- =============================================================================
-- 042_contract_guarantees
-- =============================================================================
-- Garantias contratuais (Lei 14.133 art. 96-101).
--
-- Modalidades (art. 96):
--   * caucao_dinheiro     — depósito em dinheiro
--   * caucao_titulos      — TDP (Títulos da Dívida Pública)
--   * seguro_garantia     — apólice de seguradora
--   * fianca_bancaria     — fiança bancária ou similar
--
-- Percentuais (art. 98 §1º / art. 99):
--   * 5% — padrão
--   * até 10% — obras de grande vulto
--   * até 30% — serviços de grande vulto + risco elevado (com justificativa)
--
-- Status de vida:
--   ativa → estendida → liberada_parcial → liberada_total
--                    ↘ executada_parcial → executada_total
--   * → cancelada (administrativo)
--
-- Eventos (audit + financeiro):
--   * registro     — criação
--   * extensao     — aditivo de vigência (com aditivo_id opcional)
--   * liberacao    — devolução parcial/total (após recebimento definitivo)
--   * execucao     — execução por inadimplemento (parcial/total)
--   * cancelamento — administrativo
-- =============================================================================

-- =============================================================================
-- Tabela principal
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.contract_guarantees (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id           uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  numero                int NOT NULL,

  modalidade            text NOT NULL
    CHECK (modalidade IN ('caucao_dinheiro', 'caucao_titulos', 'seguro_garantia', 'fianca_bancaria')),

  -- Identificação do instrumento
  emissor               text,                       -- nome da seguradora/banco
  instrumento_numero    text,                       -- nº da apólice/contrato/depósito
  beneficiario          text,                       -- órgão contratante

  -- Valores
  valor_garantido       numeric(18,2) NOT NULL CHECK (valor_garantido >= 0),
  percentual_contrato   numeric(7,4),               -- snapshot no registro
  valor_disponivel      numeric(18,2) NOT NULL,     -- = valor_garantido - executado_total

  -- Vigência
  data_emissao          date NOT NULL,
  data_vigencia_inicio  date NOT NULL,
  data_vigencia_fim     date NOT NULL,

  -- Status
  status                text NOT NULL DEFAULT 'ativa'
    CHECK (status IN ('ativa', 'estendida', 'liberada_parcial', 'liberada_total',
                      'executada_parcial', 'executada_total', 'cancelada', 'vencida')),

  -- Vínculos opcionais
  ultimo_aditivo_id     uuid REFERENCES public.additives(id),   -- aditivo que estendeu última vez
  liberacao_recebimento_id uuid REFERENCES public.contract_receipts(id),

  -- Observações
  observacoes           text,
  metadata              jsonb DEFAULT '{}'::jsonb,

  -- Audit
  created_by            uuid REFERENCES public.members(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (contract_id, numero),
  CHECK (data_vigencia_fim >= data_vigencia_inicio),
  CHECK (valor_disponivel <= valor_garantido)
);

CREATE INDEX IF NOT EXISTS idx_guarantees_contract   ON public.contract_guarantees (contract_id, data_emissao DESC);
CREATE INDEX IF NOT EXISTS idx_guarantees_tenant     ON public.contract_guarantees (tenant_id);
CREATE INDEX IF NOT EXISTS idx_guarantees_status     ON public.contract_guarantees (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_guarantees_vigencia   ON public.contract_guarantees (tenant_id, data_vigencia_fim)
  WHERE status IN ('ativa', 'estendida');

CREATE OR REPLACE FUNCTION public.trg_touch_guarantee()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_touch_guarantee ON public.contract_guarantees;
CREATE TRIGGER trg_touch_guarantee BEFORE UPDATE ON public.contract_guarantees
  FOR EACH ROW EXECUTE FUNCTION public.trg_touch_guarantee();

-- =============================================================================
-- Tabela: eventos de movimentação (audit + histórico financeiro)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.contract_guarantee_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  guarantee_id    uuid NOT NULL REFERENCES public.contract_guarantees(id) ON DELETE CASCADE,
  tipo            text NOT NULL
    CHECK (tipo IN ('registro', 'extensao', 'liberacao', 'execucao', 'cancelamento', 'renovacao_valor')),

  -- Valores movimentados (positivo)
  valor_movimentado numeric(18,2) DEFAULT 0,
  valor_disponivel_apos numeric(18,2),   -- snapshot do disponível depois do evento

  -- Datas
  data_evento     date NOT NULL DEFAULT current_date,
  nova_vigencia_fim date,                -- preenchido em extensao/renovacao

  -- Vínculos opcionais
  aditivo_id      uuid REFERENCES public.additives(id),
  receipt_id      uuid REFERENCES public.contract_receipts(id),

  motivacao       text NOT NULL,           -- ≥10 chars
  evidencia       text,                    -- ref a documento/processo

  applied_by      uuid REFERENCES public.members(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guarantee_events_guarantee ON public.contract_guarantee_events (guarantee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guarantee_events_tenant    ON public.contract_guarantee_events (tenant_id);

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE public.contract_guarantees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_guarantee_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guarantees_select ON public.contract_guarantees;
CREATE POLICY guarantees_select ON public.contract_guarantees
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS guarantees_write ON public.contract_guarantees;
CREATE POLICY guarantees_write ON public.contract_guarantees
  FOR ALL TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin'
             OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'gestor_contrato' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'financeiro' = ANY(coalesce(m.roles, ARRAY[]::text[])))
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
             OR 'financeiro' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  );

DROP POLICY IF EXISTS g_events_select ON public.contract_guarantee_events;
CREATE POLICY g_events_select ON public.contract_guarantee_events
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS g_events_insert ON public.contract_guarantee_events;
CREATE POLICY g_events_insert ON public.contract_guarantee_events
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin'
             OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'gestor_contrato' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'financeiro' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  );

-- =============================================================================
-- Helpers
-- =============================================================================
CREATE OR REPLACE FUNCTION public.next_guarantee_numero(p_contract_id uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT coalesce(max(numero), 0) + 1
  FROM public.contract_guarantees
  WHERE contract_id = p_contract_id;
$$;

-- =============================================================================
-- RPC 1: register_guarantee — cria garantia + event 'registro'
-- =============================================================================
CREATE OR REPLACE FUNCTION public.register_guarantee(
  p_contract_id        uuid,
  p_modalidade         text,
  p_valor_garantido    numeric,
  p_data_emissao       date,
  p_data_vigencia_inicio date,
  p_data_vigencia_fim  date,
  p_emissor            text DEFAULT NULL,
  p_instrumento_numero text DEFAULT NULL,
  p_beneficiario       text DEFAULT NULL,
  p_observacoes        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant      uuid;
  v_member      uuid;
  v_can         boolean;
  v_id          uuid;
  v_numero      int;
  v_contract    record;
  v_pct         numeric;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();

  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'financeiro' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_can FROM public.members WHERE id = v_member;
  IF NOT v_can THEN
    RAISE EXCEPTION 'Apenas admin, gestor_contrato ou financeiro podem registrar garantia';
  END IF;

  IF p_valor_garantido <= 0 THEN
    RAISE EXCEPTION 'Valor garantido deve ser positivo';
  END IF;
  IF p_data_vigencia_fim < p_data_vigencia_inicio THEN
    RAISE EXCEPTION 'Vigência fim não pode ser anterior ao início';
  END IF;

  SELECT id, valor_total_atual INTO v_contract
    FROM public.contracts
    WHERE id = p_contract_id AND tenant_id = v_tenant;
  IF v_contract IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  -- Snapshot do percentual sobre o contrato (informativo)
  v_pct := CASE WHEN v_contract.valor_total_atual > 0
                THEN round((p_valor_garantido / v_contract.valor_total_atual) * 100, 4)
                ELSE NULL
           END;

  -- Alerta se exceder 30% (cap legal)
  IF v_pct IS NOT NULL AND v_pct > 30 THEN
    RAISE EXCEPTION 'Percentual de %.2f%% excede o limite legal de 30%% (art. 99 da Lei 14.133)', v_pct;
  END IF;

  v_numero := public.next_guarantee_numero(p_contract_id);

  INSERT INTO public.contract_guarantees (
    tenant_id, contract_id, numero,
    modalidade, emissor, instrumento_numero, beneficiario,
    valor_garantido, percentual_contrato, valor_disponivel,
    data_emissao, data_vigencia_inicio, data_vigencia_fim,
    status, observacoes, created_by
  )
  VALUES (
    v_tenant, p_contract_id, v_numero,
    p_modalidade, p_emissor, p_instrumento_numero, p_beneficiario,
    p_valor_garantido, v_pct, p_valor_garantido,
    p_data_emissao, p_data_vigencia_inicio, p_data_vigencia_fim,
    'ativa', p_observacoes, v_member
  )
  RETURNING id INTO v_id;

  INSERT INTO public.contract_guarantee_events (
    tenant_id, guarantee_id, tipo,
    valor_movimentado, valor_disponivel_apos,
    data_evento, motivacao, applied_by
  )
  VALUES (
    v_tenant, v_id, 'registro',
    p_valor_garantido, p_valor_garantido,
    p_data_emissao, 'Registro inicial da garantia', v_member
  );

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.register_guarantee(uuid, text, numeric, date, date, date, text, text, text, text) TO authenticated;

-- =============================================================================
-- RPC 2: extend_guarantee — estende vigência (geralmente vinculada a aditivo)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.extend_guarantee(
  p_guarantee_id  uuid,
  p_nova_vigencia_fim date,
  p_motivacao     text,
  p_aditivo_id    uuid DEFAULT NULL,
  p_evidencia     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_g      record;
BEGIN
  v_tenant := public.current_tenant_id();

  IF length(trim(coalesce(p_motivacao, ''))) < 10 THEN
    RAISE EXCEPTION 'Motivação obrigatória (mínimo 10 caracteres)';
  END IF;

  SELECT * INTO v_g FROM public.contract_guarantees
    WHERE id = p_guarantee_id AND tenant_id = v_tenant;
  IF v_g IS NULL THEN RAISE EXCEPTION 'Garantia não encontrada'; END IF;
  IF v_g.status NOT IN ('ativa', 'estendida') THEN
    RAISE EXCEPTION 'Apenas garantias ativas ou estendidas podem ser estendidas (atual: %)', v_g.status;
  END IF;
  IF p_nova_vigencia_fim <= v_g.data_vigencia_fim THEN
    RAISE EXCEPTION 'Nova vigência (%) deve ser posterior à vigência atual (%)',
      p_nova_vigencia_fim, v_g.data_vigencia_fim;
  END IF;
  IF p_aditivo_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.additives WHERE id = p_aditivo_id AND tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'Aditivo informado não encontrado';
    END IF;
  END IF;

  UPDATE public.contract_guarantees
     SET data_vigencia_fim = p_nova_vigencia_fim,
         status            = 'estendida',
         ultimo_aditivo_id = coalesce(p_aditivo_id, ultimo_aditivo_id)
   WHERE id = p_guarantee_id;

  INSERT INTO public.contract_guarantee_events (
    tenant_id, guarantee_id, tipo,
    valor_disponivel_apos, nova_vigencia_fim, aditivo_id,
    motivacao, evidencia, applied_by
  )
  VALUES (
    v_tenant, p_guarantee_id, 'extensao',
    v_g.valor_disponivel, p_nova_vigencia_fim, p_aditivo_id,
    trim(p_motivacao), p_evidencia, public.current_member_id()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.extend_guarantee(uuid, date, text, uuid, text) TO authenticated;

-- =============================================================================
-- RPC 3: release_guarantee — liberação parcial/total
-- Geralmente após recebimento definitivo + saneamento
-- =============================================================================
CREATE OR REPLACE FUNCTION public.release_guarantee(
  p_guarantee_id uuid,
  p_valor        numeric,
  p_motivacao    text,
  p_receipt_id   uuid DEFAULT NULL,
  p_evidencia    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   uuid;
  v_g        record;
  v_novo_disp numeric;
  v_novo_status text;
BEGIN
  v_tenant := public.current_tenant_id();

  IF length(trim(coalesce(p_motivacao, ''))) < 10 THEN
    RAISE EXCEPTION 'Motivação obrigatória (mínimo 10 caracteres)';
  END IF;
  IF p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor de liberação deve ser positivo';
  END IF;

  SELECT * INTO v_g FROM public.contract_guarantees
    WHERE id = p_guarantee_id AND tenant_id = v_tenant;
  IF v_g IS NULL THEN RAISE EXCEPTION 'Garantia não encontrada'; END IF;
  IF v_g.status NOT IN ('ativa', 'estendida', 'liberada_parcial') THEN
    RAISE EXCEPTION 'Não é possível liberar garantia em status %', v_g.status;
  END IF;
  IF p_valor > v_g.valor_disponivel THEN
    RAISE EXCEPTION 'Valor de liberação (%.2f) excede saldo disponível (%.2f)',
      p_valor, v_g.valor_disponivel;
  END IF;

  -- Validação opcional: recebimento_id precisa ser definitivo emitido/sanado
  IF p_receipt_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.contract_receipts
      WHERE id = p_receipt_id AND tenant_id = v_tenant
        AND tipo = 'definitivo' AND status IN ('emitido', 'sanado')
    ) THEN
      RAISE EXCEPTION 'Recebimento de referência deve ser definitivo emitido ou sanado';
    END IF;
  END IF;

  v_novo_disp := v_g.valor_disponivel - p_valor;
  v_novo_status := CASE
    WHEN v_novo_disp = 0 THEN 'liberada_total'
    ELSE 'liberada_parcial'
  END;

  UPDATE public.contract_guarantees
     SET valor_disponivel       = v_novo_disp,
         status                  = v_novo_status,
         liberacao_recebimento_id = coalesce(p_receipt_id, liberacao_recebimento_id)
   WHERE id = p_guarantee_id;

  INSERT INTO public.contract_guarantee_events (
    tenant_id, guarantee_id, tipo,
    valor_movimentado, valor_disponivel_apos, receipt_id,
    motivacao, evidencia, applied_by
  )
  VALUES (
    v_tenant, p_guarantee_id, 'liberacao',
    p_valor, v_novo_disp, p_receipt_id,
    trim(p_motivacao), p_evidencia, public.current_member_id()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.release_guarantee(uuid, numeric, text, uuid, text) TO authenticated;

-- =============================================================================
-- RPC 4: execute_guarantee — execução por inadimplemento (parcial/total)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.execute_guarantee(
  p_guarantee_id uuid,
  p_valor        numeric,
  p_motivacao    text,
  p_evidencia    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant      uuid;
  v_g           record;
  v_novo_disp   numeric;
  v_novo_status text;
  v_can         boolean;
BEGIN
  v_tenant := public.current_tenant_id();

  -- Apenas admin ou gestor_contrato podem executar (financeiro vê mas não dispara)
  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_can FROM public.members WHERE id = public.current_member_id();
  IF NOT v_can THEN
    RAISE EXCEPTION 'Apenas admin ou gestor_contrato podem executar garantia';
  END IF;

  IF length(trim(coalesce(p_motivacao, ''))) < 20 THEN
    RAISE EXCEPTION 'Motivação obrigatória (mínimo 20 caracteres) — execução exige fundamentação';
  END IF;
  IF p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor de execução deve ser positivo';
  END IF;

  SELECT * INTO v_g FROM public.contract_guarantees
    WHERE id = p_guarantee_id AND tenant_id = v_tenant;
  IF v_g IS NULL THEN RAISE EXCEPTION 'Garantia não encontrada'; END IF;
  IF v_g.status NOT IN ('ativa', 'estendida', 'executada_parcial') THEN
    RAISE EXCEPTION 'Não é possível executar garantia em status %', v_g.status;
  END IF;
  IF p_valor > v_g.valor_disponivel THEN
    RAISE EXCEPTION 'Valor de execução (%.2f) excede saldo disponível (%.2f)',
      p_valor, v_g.valor_disponivel;
  END IF;

  v_novo_disp := v_g.valor_disponivel - p_valor;
  v_novo_status := CASE
    WHEN v_novo_disp = 0 THEN 'executada_total'
    ELSE 'executada_parcial'
  END;

  UPDATE public.contract_guarantees
     SET valor_disponivel = v_novo_disp,
         status            = v_novo_status
   WHERE id = p_guarantee_id;

  INSERT INTO public.contract_guarantee_events (
    tenant_id, guarantee_id, tipo,
    valor_movimentado, valor_disponivel_apos,
    motivacao, evidencia, applied_by
  )
  VALUES (
    v_tenant, p_guarantee_id, 'execucao',
    p_valor, v_novo_disp,
    trim(p_motivacao), p_evidencia, public.current_member_id()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.execute_guarantee(uuid, numeric, text, text) TO authenticated;

-- =============================================================================
-- RPC 5: cancel_guarantee
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_guarantee(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_g      record;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT * INTO v_g FROM public.contract_guarantees
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_g IS NULL THEN RAISE EXCEPTION 'Garantia não encontrada'; END IF;
  IF v_g.status IN ('cancelada', 'liberada_total', 'executada_total') THEN
    RAISE EXCEPTION 'Garantia já está em estado final (%)', v_g.status;
  END IF;
  IF length(trim(coalesce(p_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'Motivo de cancelamento obrigatório (mínimo 10 caracteres)';
  END IF;

  UPDATE public.contract_guarantees SET status = 'cancelada' WHERE id = p_id;

  INSERT INTO public.contract_guarantee_events (
    tenant_id, guarantee_id, tipo,
    valor_disponivel_apos, motivacao, applied_by
  )
  VALUES (
    v_tenant, p_id, 'cancelamento',
    v_g.valor_disponivel, trim(p_motivo), public.current_member_id()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_guarantee(uuid, text) TO authenticated;

-- =============================================================================
-- RPC 6: list_contract_guarantees
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_contract_guarantees(p_contract_id uuid)
RETURNS TABLE (
  id                    uuid,
  numero                int,
  modalidade            text,
  emissor               text,
  instrumento_numero    text,
  valor_garantido       numeric,
  valor_disponivel      numeric,
  percentual_contrato   numeric,
  data_emissao          date,
  data_vigencia_inicio  date,
  data_vigencia_fim     date,
  dias_para_vencimento  int,
  status                text,
  ultimo_aditivo_num    int,
  events_count          int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    g.id, g.numero, g.modalidade, g.emissor, g.instrumento_numero,
    g.valor_garantido, g.valor_disponivel, g.percentual_contrato,
    g.data_emissao, g.data_vigencia_inicio, g.data_vigencia_fim,
    (g.data_vigencia_fim - current_date)::int AS dias_para_vencimento,
    g.status,
    a.numero AS ultimo_aditivo_num,
    (SELECT count(*)::int FROM public.contract_guarantee_events e WHERE e.guarantee_id = g.id) AS events_count
  FROM public.contract_guarantees g
  LEFT JOIN public.additives a ON a.id = g.ultimo_aditivo_id
  WHERE g.contract_id = p_contract_id
    AND g.tenant_id = public.current_tenant_id()
  ORDER BY g.numero DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_contract_guarantees(uuid) TO authenticated;

-- =============================================================================
-- RPC 7: list_guarantee_events
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_guarantee_events(p_guarantee_id uuid)
RETURNS TABLE (
  id                    uuid,
  tipo                  text,
  valor_movimentado     numeric,
  valor_disponivel_apos numeric,
  data_evento           date,
  nova_vigencia_fim     date,
  aditivo_id            uuid,
  aditivo_numero        int,
  receipt_id            uuid,
  receipt_numero        int,
  motivacao             text,
  evidencia             text,
  applied_by_nome       text,
  created_at            timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id, e.tipo, e.valor_movimentado, e.valor_disponivel_apos,
    e.data_evento, e.nova_vigencia_fim,
    e.aditivo_id, a.numero AS aditivo_numero,
    e.receipt_id, r.numero AS receipt_numero,
    e.motivacao, e.evidencia,
    m.nome AS applied_by_nome,
    e.created_at
  FROM public.contract_guarantee_events e
  LEFT JOIN public.members m ON m.id = e.applied_by
  LEFT JOIN public.additives a ON a.id = e.aditivo_id
  LEFT JOIN public.contract_receipts r ON r.id = e.receipt_id
  WHERE e.guarantee_id = p_guarantee_id
    AND e.tenant_id    = public.current_tenant_id()
  ORDER BY e.created_at ASC;
$$;
GRANT EXECUTE ON FUNCTION public.list_guarantee_events(uuid) TO authenticated;

-- =============================================================================
-- RPC 8: get_contract_guarantees_summary
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_contract_guarantees_summary(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_total int;
  v_ativas int;
  v_valor_ativo numeric;
  v_valor_executado numeric;
  v_valor_liberado numeric;
  v_proximo_venc record;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT
    count(*),
    count(*) FILTER (WHERE status IN ('ativa','estendida')),
    coalesce(sum(valor_disponivel) FILTER (WHERE status IN ('ativa','estendida','liberada_parcial','executada_parcial')), 0),
    coalesce(sum(valor_garantido - valor_disponivel) FILTER (WHERE status IN ('executada_parcial','executada_total')), 0),
    coalesce(sum(valor_garantido - valor_disponivel) FILTER (WHERE status IN ('liberada_parcial','liberada_total')), 0)
  INTO v_total, v_ativas, v_valor_ativo, v_valor_executado, v_valor_liberado
  FROM public.contract_guarantees
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant;

  SELECT id, numero, data_vigencia_fim, (data_vigencia_fim - current_date)::int AS dias
  INTO v_proximo_venc
  FROM public.contract_guarantees
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant
    AND status IN ('ativa', 'estendida')
  ORDER BY data_vigencia_fim ASC
  LIMIT 1;

  RETURN jsonb_build_object(
    'total',                v_total,
    'ativas',               v_ativas,
    'valor_disponivel',     v_valor_ativo,
    'valor_executado_total',v_valor_executado,
    'valor_liberado_total', v_valor_liberado,
    'proximo_vencimento', CASE
      WHEN v_proximo_venc IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id',            v_proximo_venc.id,
        'numero',        v_proximo_venc.numero,
        'data_fim',      v_proximo_venc.data_vigencia_fim,
        'dias_restantes', v_proximo_venc.dias
      )
    END
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_contract_guarantees_summary(uuid) TO authenticated;

-- =============================================================================
-- View v_guarantees_vencendo + cron
-- Garantias ativas/estendidas com vencimento nos próximos 30 dias
-- =============================================================================
CREATE OR REPLACE VIEW public.v_guarantees_vencendo AS
SELECT
  g.id,
  g.tenant_id,
  g.contract_id,
  c.numero AS contract_numero,
  g.numero AS guarantee_numero,
  g.modalidade,
  g.valor_disponivel,
  g.data_vigencia_fim,
  (g.data_vigencia_fim - current_date)::int AS dias_restantes
FROM public.contract_guarantees g
JOIN public.contracts c ON c.id = g.contract_id
WHERE g.status IN ('ativa', 'estendida')
  AND g.data_vigencia_fim BETWEEN current_date AND current_date + interval '30 days';

GRANT SELECT ON public.v_guarantees_vencendo TO authenticated, service_role;

-- =============================================================================
-- RPC notify_guarantee_due — chamada via pg_cron
-- Notifica admins + financeiro de garantias vencendo (cooldown 14d por admin)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.notify_guarantee_due()
RETURNS TABLE (
  tenant_id        uuid,
  admins_notified  int,
  guarantees_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t           record;
  v_count       int;
  v_admin_id    uuid;
  v_admin_count int;
  v_body        text;
  v_now         timestamptz := now();
  v_cooldown    interval := interval '14 days';
BEGIN
  FOR v_t IN
    SELECT DISTINCT v.tenant_id, count(*) AS guarantees_count_per_tenant
    FROM public.v_guarantees_vencendo v
    GROUP BY v.tenant_id
  LOOP
    v_count := v_t.guarantees_count_per_tenant;
    v_admin_count := 0;

    FOR v_admin_id IN
      SELECT m.id
      FROM public.members m
      WHERE m.tenant_id = v_t.tenant_id
        AND m.active = true
        AND m.deleted_at IS NULL
        AND (m.role = 'admin'
             OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'financeiro' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    LOOP
      -- Cooldown per admin
      IF EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.recipient_id = v_admin_id
          AND n.metadata @> '{"guarantee_due_alert": true}'::jsonb
          AND n.created_at > v_now - v_cooldown
      ) THEN
        CONTINUE;
      END IF;

      -- Body com top-5 garantias vencendo
      SELECT string_agg(
        format('· #%s · Contrato %s · %s · %sd restantes',
               guarantee_numero, contract_numero, modalidade, dias_restantes),
        E'\n' ORDER BY dias_restantes
      ) INTO v_body
      FROM (
        SELECT guarantee_numero, contract_numero, modalidade, dias_restantes
        FROM public.v_guarantees_vencendo
        WHERE tenant_id = v_t.tenant_id
        ORDER BY dias_restantes
        LIMIT 5
      ) sub;

      INSERT INTO public.notifications (
        tenant_id, recipient_id, kind, title, body, action_url, metadata
      )
      VALUES (
        v_t.tenant_id, v_admin_id, 'system',
        format('%s garantia%s vencendo nos próximos 30 dias',
               v_count, CASE WHEN v_count = 1 THEN '' ELSE 's' END),
        coalesce(v_body, '') || (CASE WHEN v_count > 5 THEN format(E'\n… e mais %s', v_count - 5) ELSE '' END),
        '/contratos',
        jsonb_build_object('guarantee_due_alert', true,
                           'count', v_count,
                           'notified_at', v_now)
      );
      v_admin_count := v_admin_count + 1;
    END LOOP;

    tenant_id        := v_t.tenant_id;
    admins_notified  := v_admin_count;
    guarantees_count := v_count;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_guarantee_due() FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_guarantee_due() TO service_role;

DO $$
DECLARE v_has_cron boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_cron;
  IF NOT v_has_cron THEN
    RAISE NOTICE '[042] pg_cron ausente — agendamento manual necessário';
    RETURN;
  END IF;

  BEGIN PERFORM cron.unschedule('guarantee_due_alerts'); EXCEPTION WHEN others THEN NULL; END;

  PERFORM cron.schedule(
    'guarantee_due_alerts',
    '0 9 1,15 * *',
    $cron$SELECT * FROM public.notify_guarantee_due();$cron$
  );
  RAISE NOTICE '[042] guarantee_due_alerts agendado (dias 1 e 15 às 9h UTC)';
EXCEPTION WHEN others THEN
  RAISE WARNING '[042] erro ao agendar: %', SQLERRM;
END;
$$;
