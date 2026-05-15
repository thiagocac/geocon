-- =============================================================================
-- 019_risk_score_history — snapshots históricos do score de risco
-- =============================================================================
-- Permite traçar a evolução do score ao longo do tempo (e seus componentes).
-- Idempotente por dia: dois snapshots no mesmo dia para o mesmo contrato com
-- a mesma origem fazem upsert no registro do dia.

CREATE TABLE IF NOT EXISTS public.contract_risk_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id     uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  captured_at     timestamptz NOT NULL DEFAULT now(),
  captured_date   date NOT NULL DEFAULT current_date,
  score                  int    NOT NULL,
  score_avanco           int    NOT NULL DEFAULT 0,
  score_alertas_legais   int    NOT NULL DEFAULT 0,
  score_gap              int    NOT NULL DEFAULT 0,
  score_saldo            int    NOT NULL DEFAULT 0,
  nivel                  text   NOT NULL CHECK (nivel IN ('critico', 'atencao', 'monitorar', 'estavel')),
  percentual_financeiro  numeric,
  percentual_fisico      numeric,
  saldo_contratual       numeric,
  pendencias_high        int    NOT NULL DEFAULT 0,
  alertas                text[] NOT NULL DEFAULT ARRAY[]::text[],
  source                 text   NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto_view', 'cron', 'pdf_export')),
  captured_by            uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- Idempotência por dia + origem
CREATE UNIQUE INDEX IF NOT EXISTS contract_risk_snapshots_daily_unique
  ON public.contract_risk_snapshots (contract_id, captured_date, source);

CREATE INDEX IF NOT EXISTS contract_risk_snapshots_contract_date
  ON public.contract_risk_snapshots (contract_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS contract_risk_snapshots_tenant
  ON public.contract_risk_snapshots (tenant_id, captured_at DESC);

-- RLS multi-tenant
ALTER TABLE public.contract_risk_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_risk_snapshots_select ON public.contract_risk_snapshots;
CREATE POLICY contract_risk_snapshots_select ON public.contract_risk_snapshots
  FOR SELECT USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS contract_risk_snapshots_insert ON public.contract_risk_snapshots;
CREATE POLICY contract_risk_snapshots_insert ON public.contract_risk_snapshots
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT ON public.contract_risk_snapshots TO authenticated;

-- =============================================================================
-- RPC: capture_risk_snapshot
-- =============================================================================
-- Captura snapshot atual do score do contrato e salva (upsert por dia+source).
-- Retorna a linha inserida/atualizada.
CREATE OR REPLACE FUNCTION public.capture_risk_snapshot(
  p_contract_id uuid,
  p_source text DEFAULT 'manual'
)
RETURNS public.contract_risk_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  out_row public.contract_risk_snapshots;
  v_tenant_id uuid;
  v_member_id uuid;
  v_nivel text;
BEGIN
  IF p_source NOT IN ('manual', 'auto_view', 'cron', 'pdf_export') THEN
    RAISE EXCEPTION 'source inválido: %', p_source;
  END IF;

  SELECT * INTO r FROM public.v_contract_risk_analysis WHERE contract_id = p_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato não encontrado ou sem dashboard: %', p_contract_id;
  END IF;

  v_tenant_id := r.tenant_id;
  v_member_id := public.current_member_id();

  v_nivel := CASE
    WHEN r.score >= 70 THEN 'critico'
    WHEN r.score >= 40 THEN 'atencao'
    WHEN r.score >= 20 THEN 'monitorar'
    ELSE 'estavel'
  END;

  INSERT INTO public.contract_risk_snapshots (
    tenant_id, contract_id, captured_at, captured_date,
    score, score_avanco, score_alertas_legais, score_gap, score_saldo,
    nivel, percentual_financeiro, percentual_fisico, saldo_contratual,
    pendencias_high, alertas, source, captured_by
  ) VALUES (
    v_tenant_id, p_contract_id, now(), current_date,
    r.score, r.score_avanco, r.score_alertas_legais, r.score_gap, r.score_saldo,
    v_nivel, r.percentual_financeiro, r.percentual_fisico, r.saldo_contratual,
    r.pendencias_high, r.alertas, p_source, v_member_id
  )
  ON CONFLICT (contract_id, captured_date, source)
  DO UPDATE SET
    captured_at = excluded.captured_at,
    score = excluded.score,
    score_avanco = excluded.score_avanco,
    score_alertas_legais = excluded.score_alertas_legais,
    score_gap = excluded.score_gap,
    score_saldo = excluded.score_saldo,
    nivel = excluded.nivel,
    percentual_financeiro = excluded.percentual_financeiro,
    percentual_fisico = excluded.percentual_fisico,
    saldo_contratual = excluded.saldo_contratual,
    pendencias_high = excluded.pendencias_high,
    alertas = excluded.alertas,
    captured_by = excluded.captured_by
  RETURNING * INTO out_row;

  RETURN out_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.capture_risk_snapshot(uuid, text) TO authenticated;

-- =============================================================================
-- RPC: capture_risk_snapshots_for_tenant
-- =============================================================================
-- Para uso em cron job — captura snapshots de todos os contratos ativos do tenant
-- do chamador (ou de um tenant específico se chamado por service_role).
CREATE OR REPLACE FUNCTION public.capture_risk_snapshots_for_tenant(
  p_tenant_id uuid DEFAULT NULL
)
RETURNS TABLE (contract_id uuid, score int, nivel text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  c record;
  snap public.contract_risk_snapshots;
BEGIN
  v_tenant := COALESCE(p_tenant_id, public.current_tenant_id());
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'tenant_id não pôde ser determinado';
  END IF;

  FOR c IN
    SELECT id FROM public.contracts
    WHERE tenant_id = v_tenant
      AND deleted_at IS NULL
      AND status NOT IN ('rascunho', 'encerrado', 'rescindido')
  LOOP
    BEGIN
      snap := public.capture_risk_snapshot(c.id, 'cron');
      contract_id := snap.contract_id;
      score := snap.score;
      nivel := snap.nivel;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- continua com os demais
      RAISE NOTICE 'Falha ao capturar snapshot do contrato %: %', c.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.capture_risk_snapshots_for_tenant(uuid) TO authenticated;

-- =============================================================================
-- View: v_contract_risk_history — série temporal por contrato
-- =============================================================================
CREATE OR REPLACE VIEW public.v_contract_risk_history WITH (security_invoker = true) AS
SELECT
  s.id,
  s.tenant_id,
  s.contract_id,
  s.captured_at,
  s.captured_date,
  s.score,
  s.score_avanco,
  s.score_alertas_legais,
  s.score_gap,
  s.score_saldo,
  s.nivel,
  s.percentual_financeiro,
  s.percentual_fisico,
  s.saldo_contratual,
  s.pendencias_high,
  s.alertas,
  s.source,
  m.nome AS captured_by_nome
FROM public.contract_risk_snapshots s
LEFT JOIN public.members m ON m.id = s.captured_by
ORDER BY s.contract_id, s.captured_at DESC;

GRANT SELECT ON public.v_contract_risk_history TO authenticated;

-- =============================================================================
-- Backfill: 1 snapshot inicial por contrato ativo (origem 'cron')
-- =============================================================================
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT v.contract_id, v.tenant_id, v.score, v.score_avanco, v.score_alertas_legais,
           v.score_gap, v.score_saldo,
           v.percentual_financeiro, v.percentual_fisico, v.saldo_contratual,
           v.pendencias_high, v.alertas
    FROM public.v_contract_risk_analysis v
  LOOP
    INSERT INTO public.contract_risk_snapshots (
      tenant_id, contract_id, captured_at, captured_date,
      score, score_avanco, score_alertas_legais, score_gap, score_saldo,
      nivel, percentual_financeiro, percentual_fisico, saldo_contratual,
      pendencias_high, alertas, source
    ) VALUES (
      c.tenant_id, c.contract_id, now(), current_date,
      c.score, c.score_avanco, c.score_alertas_legais, c.score_gap, c.score_saldo,
      CASE WHEN c.score >= 70 THEN 'critico'
           WHEN c.score >= 40 THEN 'atencao'
           WHEN c.score >= 20 THEN 'monitorar'
           ELSE 'estavel' END,
      c.percentual_financeiro, c.percentual_fisico, c.saldo_contratual,
      c.pendencias_high, c.alertas, 'cron'
    )
    ON CONFLICT (contract_id, captured_date, source) DO NOTHING;
  END LOOP;
END $$;
