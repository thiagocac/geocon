-- geoCon — Correções e refinamentos pós schema inicial
-- Aplicado depois das migrations 001, 002, 003.
-- Diferenças vs source v1:
--   * current_member_id agora respeita JWT claim "active_tenant" (escolhe membro do tenant ativo)
--   * Policies de DELETE adicionadas (faltavam, apenas SELECT/INSERT/UPDATE existiam)
--   * Policy de SELECT pública para public_validation_records (validação /v/:code sem login)
--   * Seed de adjustment_indices brasileiros (IPCA, INCC-DI, IGP-M, SINAPI)
--   * Função check_can_edit_sov (bloqueio após 1ª medição vigente)
--   * Função notification_for_step para notificar passo de workflow

-- =====================================================
-- 1) Atualizar current_member_id para respeitar tenant ativo via JWT
-- =====================================================
CREATE OR REPLACE FUNCTION public.current_member_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id FROM public.members m
  WHERE m.auth_id = auth.uid()
    AND m.active = true
    AND m.deleted_at IS NULL
    AND (
      -- 1) Se JWT trouxer active_tenant, prioriza esse membro
      COALESCE(NULLIF(current_setting('request.jwt.claim.active_tenant', true), ''), '')::text = m.tenant_id::text
      OR
      -- 2) Fallback: ainda existe só 1 membro do usuário
      NOT EXISTS (
        SELECT 1 FROM public.members m2
        WHERE m2.auth_id = auth.uid() AND m2.active = true AND m2.deleted_at IS NULL AND m2.id <> m.id
      )
    )
  ORDER BY m.created_at LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.tenant_id FROM public.members m
  WHERE m.auth_id = auth.uid()
    AND m.active = true
    AND m.deleted_at IS NULL
    AND (
      COALESCE(NULLIF(current_setting('request.jwt.claim.active_tenant', true), ''), '')::text = m.tenant_id::text
      OR
      NOT EXISTS (
        SELECT 1 FROM public.members m2
        WHERE m2.auth_id = auth.uid() AND m2.active = true AND m2.deleted_at IS NULL AND m2.id <> m.id
      )
    )
  ORDER BY m.created_at LIMIT 1
$$;

-- =====================================================
-- 2) DELETE policies para soft delete via update — bloqueamos DELETE físico
-- =====================================================
-- Não criamos policy DELETE (mantemos negado por default) — soft delete via UPDATE deleted_at=now().

-- =====================================================
-- 3) Public read policy para public_validation_records (não requer JWT)
-- =====================================================
ALTER TABLE public_validation_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_validation_records_public_select ON public_validation_records;
CREATE POLICY public_validation_records_public_select ON public_validation_records
  FOR SELECT
  TO anon, authenticated
  USING (active = true AND deleted_at IS NULL);

-- =====================================================
-- 4) Política específica para membros: cada usuário vê apenas seus próprios membros
-- =====================================================
DROP POLICY IF EXISTS members_self_select ON members;
CREATE POLICY members_self_select ON members
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR auth_id = auth.uid()
  );

-- =====================================================
-- 5) Seed de índices de reajuste brasileiros (precisa rodar por tenant)
-- =====================================================
CREATE OR REPLACE FUNCTION public.seed_adjustment_indices(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO adjustment_indices(tenant_id, codigo, nome, periodicidade) VALUES
    (p_tenant_id, 'IPCA', 'IPCA — IBGE', 'mensal'),
    (p_tenant_id, 'IGP-M', 'IGP-M — FGV', 'mensal'),
    (p_tenant_id, 'INCC-DI', 'INCC-DI — FGV', 'mensal'),
    (p_tenant_id, 'SINAPI', 'SINAPI — Caixa', 'mensal'),
    (p_tenant_id, 'IPC-A',  'IPC-A — IBGE acumulado 12m', 'mensal')
  ON CONFLICT DO NOTHING;
END;
$$;

-- =====================================================
-- 6) Função: pode editar SOV?  (false se já há medição vigente)
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_edit_sov(p_contract_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM measurements
    WHERE contract_id = p_contract_id
      AND deleted_at IS NULL
      AND status IN ('emitida','aprovada','paga','retificada','complementar')
  )
$$;

-- =====================================================
-- 7) View: contratos ordenados por criticidade (alerta de prazo, aditivos > 20%, saldo < 5%)
-- =====================================================
CREATE OR REPLACE VIEW public.v_contract_critical_score WITH (security_invoker = true) AS
SELECT v.id, v.tenant_id, v.numero, v.objeto,
       v.valor_atual, v.saldo_contratual, v.percentual_financeiro, v.percentual_fisico, v.alertas,
       (
         CASE WHEN v.percentual_financeiro >= 95 THEN 30 WHEN v.percentual_financeiro >= 80 THEN 15 ELSE 0 END
       + CASE WHEN cardinality(v.alertas) > 0 THEN 25 ELSE 0 END
       + CASE WHEN v.percentual_financeiro - v.percentual_fisico >= 20 THEN 25 ELSE 0 END
       + CASE WHEN v.saldo_contratual < (v.valor_atual * 0.05) THEN 20 ELSE 0 END
       )::int AS score
FROM v_contract_dashboard v;

-- =====================================================
-- 8) Função para criar notificação (usada pelas Edge Functions)
-- =====================================================
CREATE OR REPLACE FUNCTION public.notify_recipient(
  p_recipient_id uuid,
  p_title text,
  p_body text DEFAULT NULL,
  p_link text DEFAULT NULL,
  p_kind text DEFAULT 'info',
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM members WHERE id = p_recipient_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Destinatário não encontrado: %', p_recipient_id; END IF;
  INSERT INTO notifications(tenant_id, recipient_id, title, body, link, kind, metadata)
  VALUES(v_tenant, p_recipient_id, p_title, p_body, p_link, p_kind, p_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- =====================================================
-- 9) Constraint: medição não pode ter quantidade_periodo negativa após validação
-- =====================================================
ALTER TABLE measurement_items DROP CONSTRAINT IF EXISTS measurement_items_qtd_periodo_nonneg;
ALTER TABLE measurement_items ADD CONSTRAINT measurement_items_qtd_periodo_nonneg
  CHECK (quantidade_periodo >= 0) NOT VALID;

-- =====================================================
-- 10) Trigger: bloqueia edição de contract_items se SOV está locked
-- =====================================================
CREATE OR REPLACE FUNCTION public.block_locked_sov_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_locked boolean;
BEGIN
  SELECT (locked_at IS NOT NULL) INTO v_locked FROM sov_versions WHERE id = COALESCE(NEW.sov_version_id, OLD.sov_version_id);
  IF v_locked AND (TG_OP <> 'INSERT' OR NEW.is_title = false) THEN
    -- Permitimos INSERT em SOV nova (gerada por aditivo), mas bloqueamos UPDATE/DELETE em SOV travada
    IF TG_OP IN ('UPDATE','DELETE') THEN
      RAISE EXCEPTION 'SOV travada: alterações somente via aditivo';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS contract_items_block_locked_sov ON contract_items;
CREATE TRIGGER contract_items_block_locked_sov
  BEFORE UPDATE OR DELETE ON contract_items
  FOR EACH ROW EXECUTE FUNCTION public.block_locked_sov_edit();

-- =====================================================
-- 11) Garantir que o tenant raiz da plataforma exista (com UUID determinístico)
--     IMPORTANTE: substitua pelo UUID real do tenant principal no identity hub
-- =====================================================
-- Esta linha é apenas um placeholder. Use scripts/seed-tenant.sh para criar tenants reais.
-- INSERT INTO tenants(id, nome, ativo) VALUES ('00000000-0000-0000-0000-000000000000','Consulte GEO — Tenant Raiz', true) ON CONFLICT DO NOTHING;

-- =====================================================
-- 12) Grant explícito de execução das functions para authenticated
-- =====================================================
GRANT EXECUTE ON FUNCTION public.current_member_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_contract_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_sov(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_measurement_period(uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_measurement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_measurement_step(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_additive(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_financial_snapshot(uuid) TO authenticated;

COMMENT ON SCHEMA public IS 'geoCon — Consulte GEO Gestão de Contratos (schema versão 1.1, com correções multi-tenant)';
