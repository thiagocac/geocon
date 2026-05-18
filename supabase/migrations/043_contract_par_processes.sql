-- =============================================================================
-- 043_contract_par_processes
-- =============================================================================
-- Apuração Administrativa / PAR (Lei 14.133 art. 158).
--
-- Processo formal exigido antes da aplicação de sanções graves (impedimento
-- de licitar, declaração de inidoneidade). Garante contraditório e ampla defesa.
--
-- Workflow legal (7 status):
--   rascunho → instaurado → em_defesa → em_instrucao → em_julgamento
--                                                    → decidido → recurso
--                                                              → arquivado
--   * → cancelado (administrativo)
--
-- Gates por role:
--   instaurar:           admin OR gestor_contrato
--   registrar_defesa:    fiscal OR admin (representa o contratado no sistema)
--   concluir_instrucao:  admin OR gestor_contrato (comissão designada)
--   decidir:             admin (autoridade superior)
--   abrir_recurso:       fiscal OR admin
--   julgar_recurso:      admin
-- =============================================================================

-- =============================================================================
-- Tabela principal
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.contract_par_processes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id              uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  numero                   int NOT NULL,

  -- Status do processo
  status                   text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'instaurado', 'em_defesa', 'em_instrucao',
                      'em_julgamento', 'decidido', 'em_recurso', 'arquivado', 'cancelado')),

  -- Caracterização da infração
  tipo_infracao            text NOT NULL
    CHECK (tipo_infracao IN (
      'inexecucao_parcial', 'inexecucao_total', 'atraso_injustificado',
      'qualidade_inferior', 'fraude_documental', 'recusa_assinar',
      'descumprimento_clausula', 'subcontratacao_irregular', 'outra'
    )),
  fato_descricao           text NOT NULL,           -- ≥50 chars
  data_ocorrencia          date NOT NULL,
  fundamentacao_legal      text NOT NULL DEFAULT 'Lei 14.133/2021 art. 156-158',

  -- Comissão e autoridades
  comissao_designacao      text,                    -- portaria nº
  comissao_members         jsonb DEFAULT '[]'::jsonb,
  autoridade_julgadora_id  uuid REFERENCES public.members(id),

  -- Instauração
  instaurado_at            timestamptz,
  instaurado_por_id        uuid REFERENCES public.members(id),
  instauracao_documento    text,                    -- nº do documento (ato de instauração)

  -- Defesa
  defesa_prazo_dias        int DEFAULT 15 CHECK (defesa_prazo_dias > 0),
  defesa_prazo_limite      date,
  defesa_apresentada_at    timestamptz,
  defesa_apresentada_por_id uuid REFERENCES public.members(id),
  defesa_resumo            text,
  defesa_documento         text,

  -- Instrução
  instrucao_concluida_at   timestamptz,
  instrucao_parecer        text,                    -- ≥100 chars
  instrucao_por_id         uuid REFERENCES public.members(id),

  -- Decisão de mérito
  decisao_at               timestamptz,
  decisao_por_id           uuid REFERENCES public.members(id),
  decisao_resultado        text
    CHECK (decisao_resultado IS NULL
           OR decisao_resultado IN ('procedente', 'parcialmente_procedente', 'improcedente')),
  decisao_motivacao        text,                    -- ≥30 chars
  sancao_proposta          text,                    -- texto livre da proposta
  sancao_proposta_tipos    text[],                  -- ['advertencia','multa','impedimento','inidoneidade']

  -- Recurso (opcional)
  recurso_aberto_at        timestamptz,
  recurso_motivacao        text,
  recurso_julgado_at       timestamptz,
  recurso_resultado        text
    CHECK (recurso_resultado IS NULL
           OR recurso_resultado IN ('provido', 'parcialmente_provido', 'improvido')),
  recurso_motivacao_julgamento text,

  -- Arquivamento
  arquivado_at             timestamptz,

  -- Vínculos com módulos afetados (auditoria + cross-reference)
  -- Estruturado como jsonb em vez de N tabelas separadas
  -- formato: { "additives": [uuid,...], "measurements": [uuid,...], "guarantees": [uuid,...] }
  vinculos                 jsonb DEFAULT '{}'::jsonb,

  -- Audit comum
  created_by               uuid REFERENCES public.members(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  metadata                 jsonb DEFAULT '{}'::jsonb,

  UNIQUE (contract_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_par_contract  ON public.contract_par_processes (contract_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_par_tenant    ON public.contract_par_processes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_par_status    ON public.contract_par_processes (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_par_prazo     ON public.contract_par_processes (defesa_prazo_limite)
  WHERE status = 'em_defesa';

CREATE OR REPLACE FUNCTION public.trg_touch_par()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_touch_par ON public.contract_par_processes;
CREATE TRIGGER trg_touch_par BEFORE UPDATE ON public.contract_par_processes
  FOR EACH ROW EXECUTE FUNCTION public.trg_touch_par();

-- =============================================================================
-- Tabela: timeline de eventos (audit trail)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.contract_par_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  par_id          uuid NOT NULL REFERENCES public.contract_par_processes(id) ON DELETE CASCADE,
  step_type       text NOT NULL
    CHECK (step_type IN (
      'criacao', 'instauracao', 'defesa_apresentada', 'defesa_revel',
      'instrucao_concluida', 'decisao', 'recurso_aberto', 'recurso_julgado',
      'arquivamento', 'cancelamento'
    )),
  step_at         timestamptz NOT NULL DEFAULT now(),
  status_anterior text,
  status_novo     text,
  descricao       text,
  applied_by      uuid REFERENCES public.members(id),
  metadata        jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_par_steps_par    ON public.contract_par_steps (par_id, step_at);
CREATE INDEX IF NOT EXISTS idx_par_steps_tenant ON public.contract_par_steps (tenant_id);

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE public.contract_par_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_par_steps     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS par_select ON public.contract_par_processes;
CREATE POLICY par_select ON public.contract_par_processes
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS par_write ON public.contract_par_processes;
CREATE POLICY par_write ON public.contract_par_processes
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

DROP POLICY IF EXISTS par_steps_select ON public.contract_par_steps;
CREATE POLICY par_steps_select ON public.contract_par_steps
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS par_steps_insert ON public.contract_par_steps;
CREATE POLICY par_steps_insert ON public.contract_par_steps
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

-- =============================================================================
-- Helper
-- =============================================================================
CREATE OR REPLACE FUNCTION public.next_par_numero(p_contract_id uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT coalesce(max(numero), 0) + 1
  FROM public.contract_par_processes
  WHERE contract_id = p_contract_id;
$$;

-- =============================================================================
-- RPC 1: create_par_process — cria em rascunho
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_par_process(
  p_contract_id    uuid,
  p_tipo_infracao  text,
  p_fato_descricao text,
  p_data_ocorrencia date,
  p_vinculos       jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
  v_can    boolean;
  v_id     uuid;
  v_numero int;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();

  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'fiscal' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_can FROM public.members WHERE id = v_member;
  IF NOT v_can THEN
    RAISE EXCEPTION 'Apenas admin, gestor_contrato ou fiscal podem abrir PAR';
  END IF;

  IF length(trim(p_fato_descricao)) < 50 THEN
    RAISE EXCEPTION 'Descrição dos fatos deve ter no mínimo 50 caracteres (caracterização legal)';
  END IF;

  v_numero := public.next_par_numero(p_contract_id);

  INSERT INTO public.contract_par_processes (
    tenant_id, contract_id, numero, status,
    tipo_infracao, fato_descricao, data_ocorrencia,
    vinculos, created_by
  )
  VALUES (
    v_tenant, p_contract_id, v_numero, 'rascunho',
    p_tipo_infracao, trim(p_fato_descricao), p_data_ocorrencia,
    coalesce(p_vinculos, '{}'::jsonb), v_member
  )
  RETURNING id INTO v_id;

  INSERT INTO public.contract_par_steps (
    tenant_id, par_id, step_type, status_novo, descricao, applied_by
  )
  VALUES (
    v_tenant, v_id, 'criacao', 'rascunho',
    'PAR criado em rascunho', v_member
  );

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_par_process(uuid, text, text, date, jsonb) TO authenticated;

-- =============================================================================
-- RPC 2: instaurate_par — rascunho → instaurado → em_defesa
-- =============================================================================
CREATE OR REPLACE FUNCTION public.instaurate_par(
  p_id                      uuid,
  p_comissao_designacao     text,
  p_comissao_members        jsonb DEFAULT '[]'::jsonb,
  p_instauracao_documento   text DEFAULT NULL,
  p_defesa_prazo_dias       int DEFAULT 15
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
  v_can    boolean;
  v_curr   text;
  v_data_lim date;
BEGIN
  v_tenant := public.current_tenant_id();
  v_member := public.current_member_id();

  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'gestor_contrato' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_can FROM public.members WHERE id = v_member;
  IF NOT v_can THEN
    RAISE EXCEPTION 'Apenas admin ou gestor_contrato podem instaurar PAR';
  END IF;

  IF length(trim(coalesce(p_comissao_designacao, ''))) < 5 THEN
    RAISE EXCEPTION 'Designação da comissão obrigatória (ex: nº da portaria)';
  END IF;

  SELECT status INTO v_curr FROM public.contract_par_processes
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_curr IS NULL THEN RAISE EXCEPTION 'PAR não encontrado'; END IF;
  IF v_curr <> 'rascunho' THEN
    RAISE EXCEPTION 'Apenas PARs em rascunho podem ser instaurados (atual: %)', v_curr;
  END IF;

  v_data_lim := (current_date + p_defesa_prazo_dias)::date;

  UPDATE public.contract_par_processes
     SET status                = 'em_defesa',
         instaurado_at         = now(),
         instaurado_por_id     = v_member,
         comissao_designacao   = trim(p_comissao_designacao),
         comissao_members      = coalesce(p_comissao_members, '[]'::jsonb),
         instauracao_documento = p_instauracao_documento,
         defesa_prazo_dias     = p_defesa_prazo_dias,
         defesa_prazo_limite   = v_data_lim
   WHERE id = p_id;

  INSERT INTO public.contract_par_steps (
    tenant_id, par_id, step_type, status_anterior, status_novo, descricao, applied_by
  )
  VALUES (
    v_tenant, p_id, 'instauracao', 'rascunho', 'em_defesa',
    format('PAR instaurado · prazo de defesa: %s (%s dias)', v_data_lim, p_defesa_prazo_dias),
    v_member
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.instaurate_par(uuid, text, jsonb, text, int) TO authenticated;

-- =============================================================================
-- RPC 3: register_par_defesa — em_defesa → em_instrucao
-- (ou marcar como revelia se não houve defesa no prazo)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.register_par_defesa(
  p_id              uuid,
  p_defesa_resumo   text,
  p_revelia         boolean DEFAULT false,
  p_defesa_documento text DEFAULT NULL
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
    RAISE EXCEPTION 'Apenas admin ou fiscal podem registrar defesa';
  END IF;

  SELECT status INTO v_curr FROM public.contract_par_processes
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_curr <> 'em_defesa' THEN
    RAISE EXCEPTION 'PAR não está em fase de defesa (atual: %)', v_curr;
  END IF;

  IF NOT p_revelia AND length(trim(coalesce(p_defesa_resumo, ''))) < 30 THEN
    RAISE EXCEPTION 'Resumo da defesa deve ter no mínimo 30 caracteres (ou marcar revelia)';
  END IF;

  UPDATE public.contract_par_processes
     SET status                  = 'em_instrucao',
         defesa_apresentada_at   = CASE WHEN p_revelia THEN NULL ELSE now() END,
         defesa_apresentada_por_id = CASE WHEN p_revelia THEN NULL ELSE public.current_member_id() END,
         defesa_resumo           = CASE WHEN p_revelia THEN '[Revelia — defesa não apresentada no prazo]' ELSE trim(p_defesa_resumo) END,
         defesa_documento        = p_defesa_documento
   WHERE id = p_id;

  INSERT INTO public.contract_par_steps (
    tenant_id, par_id, step_type, status_anterior, status_novo, descricao, applied_by
  )
  VALUES (
    v_tenant, p_id,
    CASE WHEN p_revelia THEN 'defesa_revel' ELSE 'defesa_apresentada' END,
    'em_defesa', 'em_instrucao',
    CASE WHEN p_revelia THEN 'Revelia decretada — defesa não apresentada' ELSE 'Defesa apresentada e registrada' END,
    public.current_member_id()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.register_par_defesa(uuid, text, boolean, text) TO authenticated;

-- =============================================================================
-- RPC 4: conclude_par_instrucao — em_instrucao → em_julgamento
-- =============================================================================
CREATE OR REPLACE FUNCTION public.conclude_par_instrucao(
  p_id      uuid,
  p_parecer text
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
    RAISE EXCEPTION 'Apenas admin ou gestor_contrato (comissão) podem concluir instrução';
  END IF;

  IF length(trim(coalesce(p_parecer, ''))) < 100 THEN
    RAISE EXCEPTION 'Parecer da instrução deve ter no mínimo 100 caracteres';
  END IF;

  SELECT status INTO v_curr FROM public.contract_par_processes
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_curr <> 'em_instrucao' THEN
    RAISE EXCEPTION 'PAR não está em instrução (atual: %)', v_curr;
  END IF;

  UPDATE public.contract_par_processes
     SET status                 = 'em_julgamento',
         instrucao_concluida_at = now(),
         instrucao_parecer      = trim(p_parecer),
         instrucao_por_id       = public.current_member_id()
   WHERE id = p_id;

  INSERT INTO public.contract_par_steps (
    tenant_id, par_id, step_type, status_anterior, status_novo, descricao, applied_by
  )
  VALUES (
    v_tenant, p_id, 'instrucao_concluida', 'em_instrucao', 'em_julgamento',
    'Parecer técnico da comissão concluído', public.current_member_id()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.conclude_par_instrucao(uuid, text) TO authenticated;

-- =============================================================================
-- RPC 5: decide_par — em_julgamento → decidido
-- Autoridade julgadora (admin) decide mérito e propõe sanções
-- =============================================================================
CREATE OR REPLACE FUNCTION public.decide_par(
  p_id              uuid,
  p_resultado       text,        -- 'procedente' | 'parcialmente_procedente' | 'improcedente'
  p_motivacao       text,
  p_sancao_proposta text DEFAULT NULL,
  p_sancao_tipos    text[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_curr   text;
  v_admin  boolean;
  v_t      text;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_admin FROM public.members WHERE id = public.current_member_id();
  IF NOT v_admin THEN
    RAISE EXCEPTION 'Apenas autoridade julgadora (admin) pode decidir o PAR';
  END IF;

  IF p_resultado NOT IN ('procedente', 'parcialmente_procedente', 'improcedente') THEN
    RAISE EXCEPTION 'Resultado inválido: %', p_resultado;
  END IF;
  IF length(trim(coalesce(p_motivacao, ''))) < 30 THEN
    RAISE EXCEPTION 'Motivação da decisão deve ter no mínimo 30 caracteres';
  END IF;

  -- Valida tipos de sanção propostos
  IF p_sancao_tipos IS NOT NULL THEN
    FOREACH v_t IN ARRAY p_sancao_tipos LOOP
      IF v_t NOT IN ('advertencia','multa','impedimento','inidoneidade') THEN
        RAISE EXCEPTION 'Tipo de sanção inválido: %', v_t;
      END IF;
    END LOOP;
  END IF;

  -- Sanção só faz sentido se procedente ou parcial
  IF p_resultado = 'improcedente' AND (p_sancao_tipos IS NOT NULL AND cardinality(p_sancao_tipos) > 0) THEN
    RAISE EXCEPTION 'PAR improcedente não pode ter sanção proposta';
  END IF;

  SELECT status INTO v_curr FROM public.contract_par_processes
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_curr <> 'em_julgamento' THEN
    RAISE EXCEPTION 'PAR não está em julgamento (atual: %)', v_curr;
  END IF;

  UPDATE public.contract_par_processes
     SET status              = 'decidido',
         decisao_at          = now(),
         decisao_por_id      = public.current_member_id(),
         decisao_resultado   = p_resultado,
         decisao_motivacao   = trim(p_motivacao),
         sancao_proposta     = p_sancao_proposta,
         sancao_proposta_tipos = p_sancao_tipos
   WHERE id = p_id;

  INSERT INTO public.contract_par_steps (
    tenant_id, par_id, step_type, status_anterior, status_novo, descricao, applied_by, metadata
  )
  VALUES (
    v_tenant, p_id, 'decisao', 'em_julgamento', 'decidido',
    format('Decisão: %s', p_resultado),
    public.current_member_id(),
    jsonb_build_object('resultado', p_resultado,
                       'sancao_tipos', coalesce(p_sancao_tipos, ARRAY[]::text[]))
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.decide_par(uuid, text, text, text, text[]) TO authenticated;

-- =============================================================================
-- RPC 6: open_par_recurso — decidido → em_recurso
-- =============================================================================
CREATE OR REPLACE FUNCTION public.open_par_recurso(
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
  v_curr   text;
  v_can    boolean;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT (role = 'admin'
          OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[]))
          OR 'fiscal' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_can FROM public.members WHERE id = public.current_member_id();
  IF NOT v_can THEN
    RAISE EXCEPTION 'Apenas admin ou fiscal podem registrar recurso';
  END IF;

  IF length(trim(coalesce(p_motivacao, ''))) < 30 THEN
    RAISE EXCEPTION 'Motivação do recurso deve ter no mínimo 30 caracteres';
  END IF;

  SELECT status INTO v_curr FROM public.contract_par_processes
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_curr <> 'decidido' THEN
    RAISE EXCEPTION 'Recurso só cabível em PAR decidido (atual: %)', v_curr;
  END IF;

  UPDATE public.contract_par_processes
     SET status            = 'em_recurso',
         recurso_aberto_at = now(),
         recurso_motivacao = trim(p_motivacao)
   WHERE id = p_id;

  INSERT INTO public.contract_par_steps (
    tenant_id, par_id, step_type, status_anterior, status_novo, descricao, applied_by
  )
  VALUES (
    v_tenant, p_id, 'recurso_aberto', 'decidido', 'em_recurso',
    'Recurso interposto', public.current_member_id()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.open_par_recurso(uuid, text) TO authenticated;

-- =============================================================================
-- RPC 7: judge_par_recurso — em_recurso → arquivado
-- =============================================================================
CREATE OR REPLACE FUNCTION public.judge_par_recurso(
  p_id                  uuid,
  p_resultado_recurso   text,
  p_motivacao_julgamento text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_curr   text;
  v_admin  boolean;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_admin FROM public.members WHERE id = public.current_member_id();
  IF NOT v_admin THEN
    RAISE EXCEPTION 'Apenas autoridade superior (admin) pode julgar recurso';
  END IF;

  IF p_resultado_recurso NOT IN ('provido', 'parcialmente_provido', 'improvido') THEN
    RAISE EXCEPTION 'Resultado de recurso inválido: %', p_resultado_recurso;
  END IF;
  IF length(trim(coalesce(p_motivacao_julgamento, ''))) < 30 THEN
    RAISE EXCEPTION 'Motivação do julgamento deve ter no mínimo 30 caracteres';
  END IF;

  SELECT status INTO v_curr FROM public.contract_par_processes
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_curr <> 'em_recurso' THEN
    RAISE EXCEPTION 'PAR não está em recurso (atual: %)', v_curr;
  END IF;

  UPDATE public.contract_par_processes
     SET status                       = 'arquivado',
         recurso_julgado_at           = now(),
         recurso_resultado            = p_resultado_recurso,
         recurso_motivacao_julgamento = trim(p_motivacao_julgamento),
         arquivado_at                 = now()
   WHERE id = p_id;

  INSERT INTO public.contract_par_steps (
    tenant_id, par_id, step_type, status_anterior, status_novo, descricao, applied_by, metadata
  )
  VALUES (
    v_tenant, p_id, 'recurso_julgado', 'em_recurso', 'arquivado',
    format('Recurso julgado: %s', p_resultado_recurso),
    public.current_member_id(),
    jsonb_build_object('resultado', p_resultado_recurso)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.judge_par_recurso(uuid, text, text) TO authenticated;

-- =============================================================================
-- RPC 8: archive_par — decidido → arquivado (sem recurso)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.archive_par(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_curr   text;
  v_admin  boolean;
BEGIN
  v_tenant := public.current_tenant_id();
  SELECT (role = 'admin' OR 'admin' = ANY(coalesce(roles, ARRAY[]::text[])))
  INTO v_admin FROM public.members WHERE id = public.current_member_id();
  IF NOT v_admin THEN RAISE EXCEPTION 'Apenas admin pode arquivar PAR'; END IF;

  SELECT status INTO v_curr FROM public.contract_par_processes
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_curr <> 'decidido' THEN
    RAISE EXCEPTION 'Apenas PARs decididos podem ser arquivados sem recurso (atual: %)', v_curr;
  END IF;

  UPDATE public.contract_par_processes
     SET status       = 'arquivado',
         arquivado_at = now()
   WHERE id = p_id;

  INSERT INTO public.contract_par_steps (
    tenant_id, par_id, step_type, status_anterior, status_novo, descricao, applied_by
  )
  VALUES (
    v_tenant, p_id, 'arquivamento', 'decidido', 'arquivado',
    'PAR arquivado sem interposição de recurso',
    public.current_member_id()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.archive_par(uuid) TO authenticated;

-- =============================================================================
-- RPC 9: cancel_par
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_par(p_id uuid, p_motivo text)
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
  SELECT status INTO v_curr FROM public.contract_par_processes
    WHERE id = p_id AND tenant_id = v_tenant;
  IF v_curr IS NULL THEN RAISE EXCEPTION 'PAR não encontrado'; END IF;
  IF v_curr IN ('arquivado', 'cancelado') THEN
    RAISE EXCEPTION 'PAR já em estado final (%)', v_curr;
  END IF;
  IF length(trim(coalesce(p_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'Motivo do cancelamento obrigatório (mínimo 10 caracteres)';
  END IF;

  UPDATE public.contract_par_processes
     SET status = 'cancelado',
         metadata = coalesce(metadata, '{}'::jsonb) ||
                    jsonb_build_object('cancel_reason', trim(p_motivo),
                                       'cancelled_at', now(),
                                       'cancelled_by', public.current_member_id())
   WHERE id = p_id;

  INSERT INTO public.contract_par_steps (
    tenant_id, par_id, step_type, status_anterior, status_novo, descricao, applied_by
  )
  VALUES (
    v_tenant, p_id, 'cancelamento', v_curr, 'cancelado',
    trim(p_motivo), public.current_member_id()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_par(uuid, text) TO authenticated;

-- =============================================================================
-- RPC 10: list_contract_pars
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_contract_pars(p_contract_id uuid)
RETURNS TABLE (
  id                    uuid,
  numero                int,
  status                text,
  tipo_infracao         text,
  data_ocorrencia       date,
  instaurado_at         timestamptz,
  defesa_prazo_limite   date,
  decisao_resultado     text,
  recurso_resultado     text,
  created_at            timestamptz,
  created_by_nome       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id, p.numero, p.status, p.tipo_infracao, p.data_ocorrencia,
    p.instaurado_at, p.defesa_prazo_limite,
    p.decisao_resultado, p.recurso_resultado,
    p.created_at, m.nome AS created_by_nome
  FROM public.contract_par_processes p
  LEFT JOIN public.members m ON m.id = p.created_by
  WHERE p.contract_id = p_contract_id
    AND p.tenant_id   = public.current_tenant_id()
  ORDER BY p.numero DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_contract_pars(uuid) TO authenticated;

-- =============================================================================
-- RPC 11: get_par_detail (jsonb com nomes resolvidos)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_par_detail(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT to_jsonb(p) ||
         jsonb_build_object(
           'created_by_nome',          (SELECT nome FROM public.members WHERE id = p.created_by),
           'instaurado_por_nome',      (SELECT nome FROM public.members WHERE id = p.instaurado_por_id),
           'defesa_apresentada_por_nome', (SELECT nome FROM public.members WHERE id = p.defesa_apresentada_por_id),
           'instrucao_por_nome',       (SELECT nome FROM public.members WHERE id = p.instrucao_por_id),
           'decisao_por_nome',         (SELECT nome FROM public.members WHERE id = p.decisao_por_id),
           'contract_numero',          (SELECT numero FROM public.contracts WHERE id = p.contract_id)
         )
  INTO v_result
  FROM public.contract_par_processes p
  WHERE p.id = p_id AND p.tenant_id = public.current_tenant_id();
  IF v_result IS NULL THEN RAISE EXCEPTION 'PAR não encontrado'; END IF;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_par_detail(uuid) TO authenticated;

-- =============================================================================
-- RPC 12: list_par_steps
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_par_steps(p_par_id uuid)
RETURNS TABLE (
  id              uuid,
  step_type       text,
  step_at         timestamptz,
  status_anterior text,
  status_novo     text,
  descricao       text,
  applied_by_nome text,
  metadata        jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.step_type, s.step_at, s.status_anterior, s.status_novo,
         s.descricao, m.nome AS applied_by_nome, s.metadata
  FROM public.contract_par_steps s
  LEFT JOIN public.members m ON m.id = s.applied_by
  WHERE s.par_id = p_par_id
    AND s.tenant_id = public.current_tenant_id()
  ORDER BY s.step_at;
$$;
GRANT EXECUTE ON FUNCTION public.list_par_steps(uuid) TO authenticated;

-- =============================================================================
-- RPC 13: get_contract_pars_summary
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_contract_pars_summary(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_total int;
  v_open  int;
  v_proc  int;
  v_improc int;
  v_in_defesa int;
  v_prazo_estourado int;
BEGIN
  v_tenant := public.current_tenant_id();

  SELECT
    count(*),
    count(*) FILTER (WHERE status IN ('rascunho','instaurado','em_defesa','em_instrucao','em_julgamento','decidido','em_recurso')),
    count(*) FILTER (WHERE decisao_resultado IN ('procedente','parcialmente_procedente')),
    count(*) FILTER (WHERE decisao_resultado = 'improcedente'),
    count(*) FILTER (WHERE status = 'em_defesa'),
    count(*) FILTER (WHERE status = 'em_defesa' AND defesa_prazo_limite < current_date)
  INTO v_total, v_open, v_proc, v_improc, v_in_defesa, v_prazo_estourado
  FROM public.contract_par_processes
  WHERE contract_id = p_contract_id AND tenant_id = v_tenant;

  RETURN jsonb_build_object(
    'total',              v_total,
    'em_andamento',       v_open,
    'procedentes',        v_proc,
    'improcedentes',      v_improc,
    'em_defesa',          v_in_defesa,
    'prazo_estourado',    v_prazo_estourado
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_contract_pars_summary(uuid) TO authenticated;
