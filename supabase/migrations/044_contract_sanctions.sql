-- =============================================================================
-- 044_contract_sanctions
-- =============================================================================
-- Sanções e impedimentos (Lei 14.133 art. 156).
--
-- 4 tipos legais:
--   * advertencia    — formal, sem prazo (art. 156 I)
--   * multa          — pecuniária, com cálculo (art. 156 II)
--   * impedimento    — até 3 anos (art. 156 §4º), EXIGE PAR procedente
--   * inidoneidade   — até 6 anos (art. 156 §5º), EXIGE PAR procedente
--
-- Cálculo de multa (default):
--   valor_multa = base_calculo × (percentual_multa / 100)
--   base_calculo geralmente é valor_total_atual do contrato; usuário pode
--   customizar (ex: valor da medição inadimplida)
--
-- Status:
--   ativa → cumprida (multa paga, prazo expirou, ou ato cumprido)
--         → suspensa (decisão judicial ou administrativa temporária)
--         → revogada (anulação por recurso, decisão administrativa)
--
-- View v_sancoes_vigentes + cron mensal de aviso de fim de vigência
-- =============================================================================

-- =============================================================================
-- Tabela principal
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.contract_sanctions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id              uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  numero                   int NOT NULL,

  -- Tipo e gravidade
  tipo                     text NOT NULL
    CHECK (tipo IN ('advertencia', 'multa', 'impedimento', 'inidoneidade')),

  -- Vínculo com PAR (obrigatório para tipos graves)
  par_id                   uuid REFERENCES public.contract_par_processes(id) ON DELETE RESTRICT,

  -- Aplicação
  data_aplicacao           date NOT NULL DEFAULT current_date,
  documento_aplicacao      text,                    -- nº do ato administrativo
  autoridade_aplicadora_id uuid REFERENCES public.members(id),
  fundamentacao            text NOT NULL,           -- ≥30 chars

  -- Multa (apenas se tipo='multa')
  base_calculo             numeric(18,2),
  percentual_multa         numeric(7,4),            -- 0-100
  valor_multa              numeric(18,2),
  data_vencimento_multa    date,
  data_pagamento_multa     date,

  -- Impedimento/inidoneidade (apenas tipos com vigência)
  vigencia_inicio          date,
  vigencia_fim             date,
  duracao_meses            int,                     -- snapshot pra reporting

  -- Status
  status                   text NOT NULL DEFAULT 'ativa'
    CHECK (status IN ('ativa', 'cumprida', 'suspensa', 'revogada')),

  -- Notas adicionais
  observacoes              text,
  metadata                 jsonb DEFAULT '{}'::jsonb,

  -- Audit
  created_by               uuid REFERENCES public.members(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  UNIQUE (contract_id, numero),
  -- Multa exige valor e percentual
  CHECK (tipo <> 'multa' OR (valor_multa IS NOT NULL AND valor_multa > 0)),
  -- Impedimento e inidoneidade exigem vigência
  CHECK (tipo NOT IN ('impedimento','inidoneidade') OR (vigencia_inicio IS NOT NULL AND vigencia_fim IS NOT NULL)),
  -- Vigência consistente
  CHECK (vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio),
  -- Impedimento ≤ 3 anos (~1095 dias), inidoneidade ≤ 6 anos (~2190 dias)
  CHECK (
    tipo NOT IN ('impedimento','inidoneidade')
    OR vigencia_inicio IS NULL
    OR vigencia_fim IS NULL
    OR (tipo = 'impedimento'   AND vigencia_fim <= vigencia_inicio + interval '3 years')
    OR (tipo = 'inidoneidade'  AND vigencia_fim <= vigencia_inicio + interval '6 years')
  )
);

CREATE INDEX IF NOT EXISTS idx_sanctions_contract ON public.contract_sanctions (contract_id, data_aplicacao DESC);
CREATE INDEX IF NOT EXISTS idx_sanctions_tenant   ON public.contract_sanctions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sanctions_status   ON public.contract_sanctions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sanctions_par      ON public.contract_sanctions (par_id) WHERE par_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sanctions_vigencia
  ON public.contract_sanctions (vigencia_fim)
  WHERE status = 'ativa' AND vigencia_fim IS NOT NULL;

CREATE OR REPLACE FUNCTION public.trg_touch_sanction()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_touch_sanction ON public.contract_sanctions;
CREATE TRIGGER trg_touch_sanction BEFORE UPDATE ON public.contract_sanctions
  FOR EACH ROW EXECUTE FUNCTION public.trg_touch_sanction();

-- =============================================================================
-- Audit de transições
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.contract_sanction_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sanction_id     uuid NOT NULL REFERENCES public.contract_sanctions(id) ON DELETE CASCADE,
  tipo            text NOT NULL
    CHECK (tipo IN ('aplicacao', 'pagamento_multa', 'suspensao', 'reativacao', 'revogacao', 'cumprimento')),
  status_anterior text,
  status_novo     text,
  descricao       text NOT NULL,
  applied_by      uuid REFERENCES public.members(id),
  applied_at      timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sanction_events_sanction ON public.contract_sanction_events (sanction_id, applied_at);

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE public.contract_sanctions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_sanction_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sanctions_select ON public.contract_sanctions;
CREATE POLICY sanctions_select ON public.contract_sanctions
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS sanctions_write ON public.contract_sanctions;
CREATE POLICY sanctions_write ON public.contract_sanctions
  FOR ALL TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin'
             OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'gestor_contrato' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin'
             OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'gestor_contrato' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  );

DROP POLICY IF EXISTS sanction_events_select ON public.contract_sanction_events;
CREATE POLICY sanction_events_select ON public.contract_sanction_events
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS sanction_events_insert ON public.contract_sanction_events;
CREATE POLICY sanction_events_insert ON public.contract_sanction_events
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = public.current_member_id()
        AND (m.role = 'admin'
             OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'gestor_contrato' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    )
  );

-- =============================================================================
-- Helper
-- =============================================================================
CREATE OR REPLACE FUNCTION public.next_sanction_numero(p_contract_id uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT coalesce(max(numero), 0) + 1
  FROM public.contract_sanctions
  WHERE contract_id = p_contract_id;
$$;

-- =============================================================================
-- RPC 1: register_sanction — aplicação formal
--
-- Para tipos 'impedimento' e 'inidoneidade':
--   * exige par_id procedente
--   * computa vigencia_fim se duracao_meses informado
--   * verifica cap legal (3 anos / 6 anos)
--
-- Para 'multa':
--   * exige base_calculo + percentual OU valor_multa direto
--   * computa o valor automaticamente
-- =============================================================================
CREATE OR REPLACE FUNCTION public.register_sanction(
  p_contract_id     uuid,
  p_tipo            text,
  p_fundamentacao   text,
  p_documento_aplicacao text DEFAULT NULL,
  p_par_id          uuid    DEFAULT NULL,
  -- Multa
  p_base_calculo    numeric DEFAULT NULL,
  p_percentual      numeric DEFAULT NULL,
  p_valor_multa     numeric DEFAULT NULL,
  p_data_vencimento_multa date DEFAULT NULL,
  -- Impedimento/inidoneidade
  p_vigencia_inicio date    DEFAULT NULL,
  p_duracao_meses   int     DEFAULT NULL,
  p_observacoes     text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant     uuid;
  v_member     uuid;
  v_admin      boolean;
  v_id         uuid;
  v_numero     int;
  v_par        record;
  v_v_inicio   date;
  v_v_fim      date;
  v_max_meses  int;
  v_valor      numeric;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();

  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_admin FROM public.members WHERE id = v_member;
  IF NOT v_admin THEN
    RAISE EXCEPTION 'Apenas admin ou gestor_contrato podem aplicar sanção';
  END IF;

  IF p_tipo NOT IN ('advertencia','multa','impedimento','inidoneidade') THEN
    RAISE EXCEPTION 'Tipo de sanção inválido: %', p_tipo;
  END IF;
  IF length(trim(coalesce(p_fundamentacao, ''))) < 30 THEN
    RAISE EXCEPTION 'Fundamentação obrigatória (mínimo 30 caracteres)';
  END IF;

  -- Validações por tipo
  IF p_tipo IN ('impedimento', 'inidoneidade') THEN
    -- Exige PAR procedente
    IF p_par_id IS NULL THEN
      RAISE EXCEPTION '% exige vínculo com PAR procedente (Lei 14.133 art. 158)',
        CASE p_tipo WHEN 'impedimento' THEN 'Impedimento de licitar' ELSE 'Declaração de inidoneidade' END;
    END IF;
    SELECT * INTO v_par FROM public.contract_par_processes
      WHERE id = p_par_id AND tenant_id = v_tenant;
    IF v_par IS NULL THEN
      RAISE EXCEPTION 'PAR informado não encontrado';
    END IF;
    IF v_par.contract_id <> p_contract_id THEN
      RAISE EXCEPTION 'PAR informado pertence a outro contrato';
    END IF;
    IF v_par.decisao_resultado NOT IN ('procedente', 'parcialmente_procedente') THEN
      RAISE EXCEPTION 'PAR vinculado precisa ter decisão procedente ou parcialmente procedente (atual: %)',
        coalesce(v_par.decisao_resultado, 'sem decisão');
    END IF;

    -- Vigência obrigatória
    IF p_vigencia_inicio IS NULL THEN
      RAISE EXCEPTION 'Vigência início obrigatória para %', p_tipo;
    END IF;
    IF p_duracao_meses IS NULL OR p_duracao_meses < 1 THEN
      RAISE EXCEPTION 'Duração em meses obrigatória e ≥1 para %', p_tipo;
    END IF;

    v_max_meses := CASE p_tipo WHEN 'impedimento' THEN 36 ELSE 72 END;
    IF p_duracao_meses > v_max_meses THEN
      RAISE EXCEPTION '% não pode exceder % meses (cap legal art. 156 §%s)',
        p_tipo, v_max_meses,
        CASE p_tipo WHEN 'impedimento' THEN '4º' ELSE '5º' END;
    END IF;

    v_v_inicio := p_vigencia_inicio;
    v_v_fim    := (p_vigencia_inicio + make_interval(months => p_duracao_meses))::date;
  END IF;

  -- Multa
  IF p_tipo = 'multa' THEN
    IF p_valor_multa IS NOT NULL THEN
      v_valor := p_valor_multa;
    ELSIF p_base_calculo IS NOT NULL AND p_percentual IS NOT NULL THEN
      IF p_percentual <= 0 OR p_percentual > 100 THEN
        RAISE EXCEPTION 'Percentual de multa deve estar entre 0 e 100';
      END IF;
      v_valor := round(p_base_calculo * (p_percentual / 100), 2);
    ELSE
      RAISE EXCEPTION 'Multa exige valor_multa direto OU (base_calculo + percentual)';
    END IF;
    IF v_valor <= 0 THEN
      RAISE EXCEPTION 'Valor de multa deve ser positivo';
    END IF;
  END IF;

  v_numero := public.next_sanction_numero(p_contract_id);

  INSERT INTO public.contract_sanctions (
    tenant_id, contract_id, numero, tipo,
    par_id, data_aplicacao, documento_aplicacao,
    autoridade_aplicadora_id, fundamentacao,
    base_calculo, percentual_multa, valor_multa, data_vencimento_multa,
    vigencia_inicio, vigencia_fim, duracao_meses,
    status, observacoes, created_by
  )
  VALUES (
    v_tenant, p_contract_id, v_numero, p_tipo,
    p_par_id, current_date, p_documento_aplicacao,
    v_member, trim(p_fundamentacao),
    CASE WHEN p_tipo = 'multa' THEN p_base_calculo END,
    CASE WHEN p_tipo = 'multa' THEN p_percentual END,
    CASE WHEN p_tipo = 'multa' THEN v_valor END,
    CASE WHEN p_tipo = 'multa' THEN p_data_vencimento_multa END,
    v_v_inicio, v_v_fim, p_duracao_meses,
    'ativa', p_observacoes, v_member
  )
  RETURNING id INTO v_id;

  INSERT INTO public.contract_sanction_events (
    tenant_id, sanction_id, tipo, status_novo, descricao, applied_by
  )
  VALUES (
    v_tenant, v_id, 'aplicacao', 'ativa',
    format('Sanção aplicada: %s', p_tipo),
    v_member
  );

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.register_sanction(uuid, text, text, text, uuid, numeric, numeric, numeric, date, date, int, text) TO authenticated;

-- =============================================================================
-- RPC 2: register_multa_payment — registra pagamento da multa
-- =============================================================================
CREATE OR REPLACE FUNCTION public.register_multa_payment(
  p_sanction_id   uuid,
  p_data_pagamento date,
  p_observacoes   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_s      record;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT * INTO v_s FROM public.contract_sanctions
    WHERE id = p_sanction_id AND tenant_id = v_tenant;
  IF v_s IS NULL THEN RAISE EXCEPTION 'Sanção não encontrada'; END IF;
  IF v_s.tipo <> 'multa' THEN
    RAISE EXCEPTION 'Apenas multas têm pagamento (atual: %)', v_s.tipo;
  END IF;
  IF v_s.status NOT IN ('ativa', 'suspensa') THEN
    RAISE EXCEPTION 'Multa não pode ser paga em status %', v_s.status;
  END IF;
  IF v_s.data_pagamento_multa IS NOT NULL THEN
    RAISE EXCEPTION 'Multa já foi paga em %', v_s.data_pagamento_multa;
  END IF;

  UPDATE public.contract_sanctions
     SET data_pagamento_multa = p_data_pagamento,
         status               = 'cumprida'
   WHERE id = p_sanction_id;

  INSERT INTO public.contract_sanction_events (
    tenant_id, sanction_id, tipo, status_anterior, status_novo, descricao, applied_by, metadata
  )
  VALUES (
    v_tenant, p_sanction_id, 'pagamento_multa', v_s.status, 'cumprida',
    format('Multa paga em %s', p_data_pagamento),
    public.current_member_id(),
    jsonb_build_object('observacoes', coalesce(p_observacoes, ''))
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.register_multa_payment(uuid, date, text) TO authenticated;

-- =============================================================================
-- RPC 3: suspend_sanction — ativa → suspensa (decisão judicial/administrativa)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.suspend_sanction(
  p_id        uuid,
  p_motivacao text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_s      record;
BEGIN
  v_tenant := public.current_tenant_id();
  IF length(trim(coalesce(p_motivacao, ''))) < 20 THEN
    RAISE EXCEPTION 'Motivação obrigatória (mínimo 20 caracteres)';
  END IF;

  SELECT * INTO v_s FROM public.contract_sanctions
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_s IS NULL THEN RAISE EXCEPTION 'Sanção não encontrada'; END IF;
  IF v_s.status <> 'ativa' THEN
    RAISE EXCEPTION 'Apenas sanções ativas podem ser suspensas (atual: %)', v_s.status;
  END IF;

  UPDATE public.contract_sanctions SET status = 'suspensa' WHERE id = p_id;

  INSERT INTO public.contract_sanction_events (
    tenant_id, sanction_id, tipo, status_anterior, status_novo, descricao, applied_by
  )
  VALUES (
    v_tenant, p_id, 'suspensao', 'ativa', 'suspensa',
    trim(p_motivacao),
    public.current_member_id()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.suspend_sanction(uuid, text) TO authenticated;

-- =============================================================================
-- RPC 4: reactivate_sanction — suspensa → ativa
-- =============================================================================
CREATE OR REPLACE FUNCTION public.reactivate_sanction(
  p_id        uuid,
  p_motivacao text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_s      record;
BEGIN
  v_tenant := public.current_tenant_id();
  IF length(trim(coalesce(p_motivacao, ''))) < 20 THEN
    RAISE EXCEPTION 'Motivação obrigatória (mínimo 20 caracteres)';
  END IF;

  SELECT * INTO v_s FROM public.contract_sanctions
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_s IS NULL THEN RAISE EXCEPTION 'Sanção não encontrada'; END IF;
  IF v_s.status <> 'suspensa' THEN
    RAISE EXCEPTION 'Apenas sanções suspensas podem ser reativadas (atual: %)', v_s.status;
  END IF;

  UPDATE public.contract_sanctions SET status = 'ativa' WHERE id = p_id;

  INSERT INTO public.contract_sanction_events (
    tenant_id, sanction_id, tipo, status_anterior, status_novo, descricao, applied_by
  )
  VALUES (
    v_tenant, p_id, 'reativacao', 'suspensa', 'ativa',
    trim(p_motivacao),
    public.current_member_id()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.reactivate_sanction(uuid, text) TO authenticated;

-- =============================================================================
-- RPC 5: revoke_sanction — anulação (provimento de recurso, decisão judicial)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.revoke_sanction(
  p_id        uuid,
  p_motivacao text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_s      record;
  v_admin  boolean;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_admin FROM public.members WHERE id = public.current_member_id();
  IF NOT v_admin THEN
    RAISE EXCEPTION 'Apenas admin pode revogar sanção (decisão de superior)';
  END IF;

  IF length(trim(coalesce(p_motivacao, ''))) < 30 THEN
    RAISE EXCEPTION 'Motivação obrigatória (mínimo 30 caracteres) — revogação tem efeito retroativo';
  END IF;

  SELECT * INTO v_s FROM public.contract_sanctions
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_s IS NULL THEN RAISE EXCEPTION 'Sanção não encontrada'; END IF;
  IF v_s.status NOT IN ('ativa', 'suspensa') THEN
    RAISE EXCEPTION 'Não é possível revogar sanção em status %', v_s.status;
  END IF;

  UPDATE public.contract_sanctions SET status = 'revogada' WHERE id = p_id;

  INSERT INTO public.contract_sanction_events (
    tenant_id, sanction_id, tipo, status_anterior, status_novo, descricao, applied_by
  )
  VALUES (
    v_tenant, p_id, 'revogacao', v_s.status, 'revogada',
    trim(p_motivacao),
    public.current_member_id()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.revoke_sanction(uuid, text) TO authenticated;

-- =============================================================================
-- RPC 6: mark_as_fulfilled — vigência venceu naturalmente (impedimento/inidoneidade)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mark_sanction_fulfilled(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_s      record;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT * INTO v_s FROM public.contract_sanctions
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_s IS NULL THEN RAISE EXCEPTION 'Sanção não encontrada'; END IF;
  IF v_s.status <> 'ativa' THEN
    RAISE EXCEPTION 'Apenas sanções ativas podem ser marcadas como cumpridas (atual: %)', v_s.status;
  END IF;
  IF v_s.tipo NOT IN ('impedimento', 'inidoneidade') AND v_s.tipo <> 'advertencia' THEN
    RAISE EXCEPTION 'Use register_multa_payment para multas';
  END IF;

  UPDATE public.contract_sanctions SET status = 'cumprida' WHERE id = p_id;

  INSERT INTO public.contract_sanction_events (
    tenant_id, sanction_id, tipo, status_anterior, status_novo, descricao, applied_by
  )
  VALUES (
    v_tenant, p_id, 'cumprimento', 'ativa', 'cumprida',
    CASE
      WHEN v_s.tipo IN ('impedimento','inidoneidade') THEN format('Vigência cumprida em %s', v_s.vigencia_fim)
      ELSE 'Sanção cumprida'
    END,
    public.current_member_id()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_sanction_fulfilled(uuid) TO authenticated;

-- =============================================================================
-- RPC 7: list_contract_sanctions
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_contract_sanctions(p_contract_id uuid)
RETURNS TABLE (
  id                       uuid,
  numero                   int,
  tipo                     text,
  status                   text,
  data_aplicacao           date,
  documento_aplicacao      text,
  fundamentacao            text,
  par_id                   uuid,
  par_numero               int,
  valor_multa              numeric,
  data_pagamento_multa     date,
  data_vencimento_multa    date,
  vigencia_inicio          date,
  vigencia_fim             date,
  duracao_meses            int,
  dias_para_vencimento     int,
  autoridade_nome          text,
  created_at               timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id, s.numero, s.tipo, s.status, s.data_aplicacao, s.documento_aplicacao,
    s.fundamentacao,
    s.par_id, p.numero AS par_numero,
    s.valor_multa, s.data_pagamento_multa, s.data_vencimento_multa,
    s.vigencia_inicio, s.vigencia_fim, s.duracao_meses,
    CASE WHEN s.vigencia_fim IS NULL THEN NULL
         ELSE (s.vigencia_fim - current_date)::int
    END AS dias_para_vencimento,
    m.nome AS autoridade_nome,
    s.created_at
  FROM public.contract_sanctions s
  LEFT JOIN public.members m ON m.id = s.autoridade_aplicadora_id
  LEFT JOIN public.contract_par_processes p ON p.id = s.par_id
  WHERE s.contract_id = p_contract_id
    AND s.tenant_id   = public.current_tenant_id()
  ORDER BY s.numero DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_contract_sanctions(uuid) TO authenticated;

-- =============================================================================
-- RPC 8: list_sanction_events (audit timeline)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_sanction_events(p_sanction_id uuid)
RETURNS TABLE (
  id              uuid,
  tipo            text,
  status_anterior text,
  status_novo     text,
  descricao       text,
  applied_by_nome text,
  applied_at      timestamptz,
  metadata        jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.tipo, e.status_anterior, e.status_novo,
         e.descricao, m.nome AS applied_by_nome, e.applied_at, e.metadata
  FROM public.contract_sanction_events e
  LEFT JOIN public.members m ON m.id = e.applied_by
  WHERE e.sanction_id = p_sanction_id
    AND e.tenant_id   = public.current_tenant_id()
  ORDER BY e.applied_at;
$$;
GRANT EXECUTE ON FUNCTION public.list_sanction_events(uuid) TO authenticated;

-- =============================================================================
-- RPC 9: get_contract_sanctions_summary
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_contract_sanctions_summary(p_contract_id uuid)
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
  v_advertencias int;
  v_multas int;
  v_impedimentos int;
  v_inidoneidades int;
  v_multa_total numeric;
  v_multa_paga numeric;
  v_multa_pendente numeric;
  v_proximo_vencimento record;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'ativa'),
    count(*) FILTER (WHERE tipo = 'advertencia'),
    count(*) FILTER (WHERE tipo = 'multa'),
    count(*) FILTER (WHERE tipo = 'impedimento'),
    count(*) FILTER (WHERE tipo = 'inidoneidade'),
    coalesce(sum(valor_multa)            FILTER (WHERE tipo = 'multa'), 0),
    coalesce(sum(valor_multa)            FILTER (WHERE tipo = 'multa' AND data_pagamento_multa IS NOT NULL), 0),
    coalesce(sum(valor_multa)            FILTER (WHERE tipo = 'multa' AND data_pagamento_multa IS NULL AND status IN ('ativa','suspensa')), 0)
  INTO v_total, v_ativas, v_advertencias, v_multas, v_impedimentos, v_inidoneidades,
       v_multa_total, v_multa_paga, v_multa_pendente
  FROM public.contract_sanctions
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant;

  SELECT id, numero, tipo, vigencia_fim, (vigencia_fim - current_date)::int AS dias
  INTO v_proximo_vencimento
  FROM public.contract_sanctions
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant
    AND status = 'ativa' AND vigencia_fim IS NOT NULL
  ORDER BY vigencia_fim
  LIMIT 1;

  RETURN jsonb_build_object(
    'total',             v_total,
    'ativas',            v_ativas,
    'advertencias',      v_advertencias,
    'multas',            v_multas,
    'impedimentos',      v_impedimentos,
    'inidoneidades',     v_inidoneidades,
    'multa_total',       v_multa_total,
    'multa_paga',        v_multa_paga,
    'multa_pendente',    v_multa_pendente,
    'proximo_vencimento', CASE
      WHEN v_proximo_vencimento IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id',             v_proximo_vencimento.id,
        'numero',         v_proximo_vencimento.numero,
        'tipo',           v_proximo_vencimento.tipo,
        'data',           v_proximo_vencimento.vigencia_fim,
        'dias_restantes', v_proximo_vencimento.dias
      )
    END
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_contract_sanctions_summary(uuid) TO authenticated;

-- =============================================================================
-- View v_sancoes_vigentes + cron mensal de aviso
-- Sanções de impedimento/inidoneidade ativas vencendo nos próximos 60 dias
-- =============================================================================
CREATE OR REPLACE VIEW public.v_sancoes_vigentes AS
SELECT
  s.id,
  s.tenant_id,
  s.contract_id,
  c.numero AS contract_numero,
  s.numero AS sanction_numero,
  s.tipo,
  s.vigencia_fim,
  (s.vigencia_fim - current_date)::int AS dias_restantes
FROM public.contract_sanctions s
JOIN public.contracts c ON c.id = s.contract_id
WHERE s.status = 'ativa'
  AND s.tipo IN ('impedimento', 'inidoneidade')
  AND s.vigencia_fim BETWEEN current_date AND current_date + interval '60 days';

GRANT SELECT ON public.v_sancoes_vigentes TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_sanction_expiring()
RETURNS TABLE (
  tenant_id        uuid,
  admins_notified  int,
  sanctions_count  int
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
  v_cooldown    interval := interval '21 days';
BEGIN
  FOR v_t IN
    SELECT DISTINCT v.tenant_id, count(*) AS cnt
    FROM public.v_sancoes_vigentes v
    GROUP BY v.tenant_id
  LOOP
    v_count := v_t.cnt;
    v_admin_count := 0;

    FOR v_admin_id IN
      SELECT m.id FROM public.members m
      WHERE m.tenant_id = v_t.tenant_id
        AND m.active = true AND m.deleted_at IS NULL
        AND (m.role = 'admin'
             OR 'admin' = ANY(coalesce(m.roles, ARRAY[]::text[]))
             OR 'gestor_contrato' = ANY(coalesce(m.roles, ARRAY[]::text[])))
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.recipient_id = v_admin_id
          AND n.metadata @> '{"sanction_expiring_alert": true}'::jsonb
          AND n.created_at > v_now - v_cooldown
      ) THEN
        CONTINUE;
      END IF;

      SELECT string_agg(
        format('· Sanção #%s · Contrato %s · %s · %sd restantes',
               sanction_numero, contract_numero, tipo, dias_restantes),
        E'\n' ORDER BY dias_restantes
      ) INTO v_body
      FROM (
        SELECT sanction_numero, contract_numero, tipo, dias_restantes
        FROM public.v_sancoes_vigentes
        WHERE tenant_id = v_t.tenant_id
        ORDER BY dias_restantes
        LIMIT 5
      ) sub;

      INSERT INTO public.notifications (
        tenant_id, recipient_id, kind, title, body, action_url, metadata
      )
      VALUES (
        v_t.tenant_id, v_admin_id, 'system',
        format('%s sanç%s vencendo nos próximos 60 dias',
               v_count, CASE WHEN v_count = 1 THEN 'ão' ELSE 'ões' END),
        coalesce(v_body, '') || (CASE WHEN v_count > 5 THEN format(E'\n… e mais %s', v_count - 5) ELSE '' END),
        '/contratos',
        jsonb_build_object('sanction_expiring_alert', true,
                           'count', v_count,
                           'notified_at', v_now)
      );
      v_admin_count := v_admin_count + 1;
    END LOOP;

    tenant_id        := v_t.tenant_id;
    admins_notified  := v_admin_count;
    sanctions_count  := v_count;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_sanction_expiring() FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_sanction_expiring() TO service_role;

DO $$
DECLARE v_has_cron boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_cron;
  IF NOT v_has_cron THEN
    RAISE NOTICE '[044] pg_cron ausente';
    RETURN;
  END IF;

  BEGIN PERFORM cron.unschedule('sanction_expiring_alerts'); EXCEPTION WHEN others THEN NULL; END;

  PERFORM cron.schedule(
    'sanction_expiring_alerts',
    '0 9 1 * *',  -- dia 1 de cada mês às 9h UTC
    $cron$SELECT * FROM public.notify_sanction_expiring();$cron$
  );
  RAISE NOTICE '[044] sanction_expiring_alerts agendado (dia 1 às 9h UTC)';
EXCEPTION WHEN others THEN
  RAISE WARNING '[044] erro ao agendar: %', SQLERRM;
END;
$$;
