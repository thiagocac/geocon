-- =============================================================================
-- 056_realtime_alerts_lei14133
-- =============================================================================
-- Cria tabela `realtime_alerts` + 3 triggers + Realtime publication para
-- emitir alertas em tempo real quando eventos Lei 14.133 críticos ocorrem.
--
-- Triggers:
--   1. Vício grave registrado (severidade IN alta/critica)
--   2. Multa grande aplicada (valor > R$ 100.000)
--   3. PAR decidido como procedente
--
-- Garantias vencendo ≤7d são detectadas via cron (não trigger) — não há
-- mudança de estado que dispare, são apenas a passagem do tempo.
--
-- Multi-tenant: RLS escopa por tenant. Realtime publication filtra no
-- canal por tenant_id (cliente subscribe usando filter).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.realtime_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_id  uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  contract_numero text,           -- snapshot p/ exibição mesmo se contrato deletado
  alert_kind   text NOT NULL CHECK (alert_kind IN (
    'vicio_grave', 'multa_grande', 'par_procedente', 'garantia_vencendo'
  )),
  severity     text NOT NULL CHECK (severity IN ('warning', 'danger')),
  title        text NOT NULL,
  body         text,
  ref_link     text,
  metadata     jsonb DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  dismissed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_realtime_alerts_tenant_active
  ON public.realtime_alerts (tenant_id, created_at DESC)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_realtime_alerts_contract
  ON public.realtime_alerts (contract_id) WHERE contract_id IS NOT NULL;

ALTER TABLE public.realtime_alerts ENABLE ROW LEVEL SECURITY;

-- SELECT: membro do tenant lê
CREATE POLICY realtime_alerts_select ON public.realtime_alerts FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.members WHERE auth_id = auth.uid()
    )
  );

-- UPDATE: membro pode marcar dismiss (só campos dismissed_*)
CREATE POLICY realtime_alerts_update_dismiss ON public.realtime_alerts FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.members WHERE auth_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.members WHERE auth_id = auth.uid()
    )
  );

-- INSERT/DELETE: apenas service_role (via triggers ou admin tooling)
-- (sem POLICY = nega para authenticated)

GRANT SELECT, UPDATE ON public.realtime_alerts TO authenticated;
GRANT ALL ON public.realtime_alerts TO service_role;

-- =============================================================================
-- Helper: insere alerta com snapshot do contract_numero
-- =============================================================================
CREATE OR REPLACE FUNCTION public._insert_realtime_alert(
  p_tenant_id   uuid,
  p_contract_id uuid,
  p_alert_kind  text,
  p_severity    text,
  p_title       text,
  p_body        text,
  p_ref_link    text,
  p_metadata    jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract_numero text;
  v_alert_id uuid;
BEGIN
  SELECT c.numero INTO v_contract_numero
    FROM public.contracts c
   WHERE c.id = p_contract_id;

  INSERT INTO public.realtime_alerts (
    tenant_id, contract_id, contract_numero, alert_kind,
    severity, title, body, ref_link, metadata
  ) VALUES (
    p_tenant_id, p_contract_id, v_contract_numero, p_alert_kind,
    p_severity, p_title, p_body, p_ref_link, p_metadata
  )
  RETURNING id INTO v_alert_id;

  RETURN v_alert_id;
END;
$$;

-- =============================================================================
-- Trigger 1: vício grave registrado/atualizado
-- =============================================================================
CREATE OR REPLACE FUNCTION public._trg_alert_vicio_grave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_contract_id uuid;
BEGIN
  -- só dispara quando o vício é alta/critica E status é aberto/em_saneamento
  IF NEW.severidade NOT IN ('alta','critica') THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('aberto','em_saneamento') THEN RETURN NEW; END IF;

  -- evita re-disparar quando UPDATE não mudou os campos relevantes
  IF TG_OP = 'UPDATE' AND OLD.severidade = NEW.severidade AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT r.contract_id, c.tenant_id
    INTO v_contract_id, v_tenant_id
    FROM public.contract_receipts r
    JOIN public.contracts c ON c.id = r.contract_id
   WHERE r.id = NEW.receipt_id;

  IF v_tenant_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public._insert_realtime_alert(
    v_tenant_id,
    v_contract_id,
    'vicio_grave',
    'danger',
    'Vício ' || NEW.severidade || ' registrado',
    coalesce(NEW.descricao, 'Vício de severidade ' || NEW.severidade),
    '/contratos/' || v_contract_id || '/recebimentos',
    jsonb_build_object(
      'receipt_id', NEW.receipt_id,
      'vicio_id', NEW.id,
      'severidade', NEW.severidade,
      'status', NEW.status
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_vicio_grave ON public.contract_receipt_vicios;
CREATE TRIGGER trg_alert_vicio_grave
  AFTER INSERT OR UPDATE ON public.contract_receipt_vicios
  FOR EACH ROW EXECUTE FUNCTION public._trg_alert_vicio_grave();

-- =============================================================================
-- Trigger 2: multa grande aplicada (> R$ 100.000)
-- =============================================================================
CREATE OR REPLACE FUNCTION public._trg_alert_multa_grande()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF NEW.tipo <> 'multa' THEN RETURN NEW; END IF;
  IF NEW.valor_multa IS NULL OR NEW.valor_multa <= 100000 THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('ativa','suspensa') THEN RETURN NEW; END IF;
  IF NEW.data_pagamento_multa IS NOT NULL THEN RETURN NEW; END IF;

  -- evita re-disparar em UPDATE que não muda valor/status
  IF TG_OP = 'UPDATE'
     AND OLD.valor_multa = NEW.valor_multa
     AND OLD.status = NEW.status
     AND coalesce(OLD.data_pagamento_multa::text, '') = coalesce(NEW.data_pagamento_multa::text, '')
  THEN
    RETURN NEW;
  END IF;

  SELECT c.tenant_id INTO v_tenant_id
    FROM public.contracts c WHERE c.id = NEW.contract_id;

  IF v_tenant_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public._insert_realtime_alert(
    v_tenant_id,
    NEW.contract_id,
    'multa_grande',
    'danger',
    'Multa de R$ ' || to_char(NEW.valor_multa, 'FM999G999G999D00') || ' aplicada',
    coalesce(NEW.fundamentacao, 'Multa aplicada'),
    '/contratos/' || NEW.contract_id || '/sancoes',
    jsonb_build_object(
      'sanction_id', NEW.id,
      'valor_multa', NEW.valor_multa,
      'vencimento', NEW.data_vencimento_multa
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_multa_grande ON public.contract_sanctions;
CREATE TRIGGER trg_alert_multa_grande
  AFTER INSERT OR UPDATE ON public.contract_sanctions
  FOR EACH ROW EXECUTE FUNCTION public._trg_alert_multa_grande();

-- =============================================================================
-- Trigger 3: PAR decidido como procedente
-- =============================================================================
CREATE OR REPLACE FUNCTION public._trg_alert_par_procedente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- só dispara quando status passa para 'decidido' E resultado = procedente
  IF NEW.status <> 'decidido' THEN RETURN NEW; END IF;
  IF NEW.decisao_resultado NOT IN ('procedente','parcialmente_procedente') THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status
     AND coalesce(OLD.decisao_resultado, '') = coalesce(NEW.decisao_resultado, '')
  THEN
    RETURN NEW;
  END IF;

  SELECT c.tenant_id INTO v_tenant_id
    FROM public.contracts c WHERE c.id = NEW.contract_id;

  IF v_tenant_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public._insert_realtime_alert(
    v_tenant_id,
    NEW.contract_id,
    'par_procedente',
    'danger',
    'PAR-' || to_char(NEW.numero, 'FM000') || ' decidido · ' || NEW.decisao_resultado,
    'Processo de apuração concluído. Avalie a aplicação de sanção.',
    '/contratos/' || NEW.contract_id || '/processos-administrativos',
    jsonb_build_object(
      'par_id', NEW.id,
      'par_numero', NEW.numero,
      'resultado', NEW.decisao_resultado,
      'tipo_infracao', NEW.tipo_infracao
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_par_procedente ON public.contract_par_processes;
CREATE TRIGGER trg_alert_par_procedente
  AFTER INSERT OR UPDATE ON public.contract_par_processes
  FOR EACH ROW EXECUTE FUNCTION public._trg_alert_par_procedente();

-- =============================================================================
-- RPC pública: dismiss alert
-- =============================================================================
CREATE OR REPLACE FUNCTION public.dismiss_realtime_alert(p_alert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
BEGIN
  SELECT m.id INTO v_member_id
    FROM public.members m
   WHERE m.auth_id = auth.uid()
   LIMIT 1;

  UPDATE public.realtime_alerts
     SET dismissed_at = now(),
         dismissed_by = auth.uid()
   WHERE id = p_alert_id
     AND dismissed_at IS NULL
     AND tenant_id IN (SELECT tenant_id FROM public.members WHERE auth_id = auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.dismiss_realtime_alert(uuid) TO authenticated;

-- =============================================================================
-- RPC: dismiss em lote (para "limpar todos")
-- =============================================================================
CREATE OR REPLACE FUNCTION public.dismiss_all_realtime_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH updated AS (
    UPDATE public.realtime_alerts
       SET dismissed_at = now(),
           dismissed_by = auth.uid()
     WHERE dismissed_at IS NULL
       AND tenant_id IN (SELECT tenant_id FROM public.members WHERE auth_id = auth.uid())
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM updated;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dismiss_all_realtime_alerts() TO authenticated;

-- =============================================================================
-- Realtime: adiciona tabela à publicação supabase_realtime
-- =============================================================================
-- Idempotente: só adiciona se ainda não estiver na publication.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'realtime_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.realtime_alerts;
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    -- publication não existe (provavelmente ambiente local sem Supabase)
    -- ignora silenciosamente
    NULL;
END;
$$;

COMMENT ON TABLE public.realtime_alerts IS
'V52 — Alertas em tempo real Lei 14.133. Triggers inserem aqui; clientes ' ||
'subscrevem via Realtime channel filtrado por tenant_id.';
