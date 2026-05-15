-- geoCon - schema inicial Supabase/Postgres
-- Stack: Supabase Postgres 15, RLS por tenant, soft delete, UUIDs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_member_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id FROM public.members m
  WHERE m.auth_id = auth.uid() AND m.active = true AND m.deleted_at IS NULL
  ORDER BY m.created_at LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.tenant_id FROM public.members m
  WHERE m.auth_id = auth.uid() AND m.active = true AND m.deleted_at IS NULL
  ORDER BY m.created_at LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.has_role(p_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.members m
    WHERE m.auth_id = auth.uid()
      AND m.active = true
      AND m.deleted_at IS NULL
      AND (m.role = ANY(p_roles) OR m.roles && p_roles)
  )
$$;

-- ============================================================
-- BASE DA PLATAFORMA
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  nome text NOT NULL,
  cnpj text,
  ativo boolean DEFAULT true,
  brand_logo_url text,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY,
  auth_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  nome text NOT NULL,
  cpf text,
  telefone text,
  crea_numero text,
  crea_uf text,
  cargo text,
  empresa text,
  can_sign_measurement boolean DEFAULT false,
  can_sign_additive boolean DEFAULT false,
  active boolean DEFAULT true,
  role text NOT NULL DEFAULT 'viewer',
  roles text[] NOT NULL DEFAULT '{}'::text[],
  product_access jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(auth_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_members_tenant ON members(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_members_auth ON members(auth_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  actor_id uuid REFERENCES members(id),
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  source text,
  severity text DEFAULT 'info' CHECK (severity IN ('info','warn','error')),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_entity ON audit_log(tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  recipient_id uuid NOT NULL REFERENCES members(id),
  title text NOT NULL,
  body text,
  link text,
  kind text DEFAULT 'info',
  metadata jsonb DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread ON notifications(recipient_id, created_at DESC) WHERE read_at IS NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_backlog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero int GENERATED ALWAYS AS IDENTITY,
  titulo text NOT NULL,
  descricao text,
  categoria text NOT NULL DEFAULT 'outro' CHECK (categoria IN ('autorizacao','ui_ux','pdf','email','relatorios','autenticacao','tema','integracao','contratos','medicoes','ged','outro')),
  prioridade text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa','media','alta')),
  status text DEFAULT 'aberto' CHECK (status IN ('aberto','em_andamento','concluido','cancelado')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  delegator_id uuid NOT NULL REFERENCES members(id),
  delegatee_id uuid NOT NULL REFERENCES members(id),
  escopo text NOT NULL,
  ativo_de timestamptz NOT NULL,
  ativo_ate timestamptz NOT NULL,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS approval_magic_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  step_id uuid,
  recipient_email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

-- ============================================================
-- CONTRATOS, PROGRAMAS, LOTES, EAP
-- ============================================================
CREATE TABLE IF NOT EXISTS programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  codigo text, nome text NOT NULL, descricao text, orgao text, funding_source text,
  active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz,
  UNIQUE(tenant_id, codigo) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE IF NOT EXISTS program_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), program_id uuid REFERENCES programs(id),
  codigo text NOT NULL, nome text NOT NULL, observacao text, ordem int DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS program_components_unique ON program_components(tenant_id, program_id, codigo) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS program_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), component_id uuid NOT NULL REFERENCES program_components(id),
  codigo text NOT NULL, nome text NOT NULL, descricao text, ordem int DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS program_goals_unique ON program_goals(component_id, codigo) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS contract_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  tipo text NOT NULL CHECK (tipo IN ('orgao','contratante','contratada','gerenciadora','fiscalizadora','consorcio','subcontratada','outro')),
  nome text NOT NULL, cnpj text, email text, telefone text, endereco text, representante text, metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_contract_organizations_nome ON contract_organizations USING gin(nome gin_trgm_ops);

CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  program_id uuid REFERENCES programs(id), component_id uuid REFERENCES program_components(id), goal_id uuid REFERENCES program_goals(id),
  orgao_id uuid REFERENCES contract_organizations(id), contratante_id uuid REFERENCES contract_organizations(id), contratada_id uuid REFERENCES contract_organizations(id), gerenciadora_id uuid REFERENCES contract_organizations(id),
  numero text NOT NULL, objeto text NOT NULL, processo_administrativo text, dotacao_orcamentaria text, fonte_recurso text,
  valor_inicial numeric(18,2) NOT NULL DEFAULT 0 CHECK (valor_inicial >= 0),
  valor_aditado numeric(18,2) NOT NULL DEFAULT 0,
  valor_total_atual numeric(18,2) GENERATED ALWAYS AS (valor_inicial + valor_aditado) STORED,
  prazo_execucao_dias int, prazo_vigencia_dias int, data_assinatura date, data_ordem_inicio date,
  regime_contratacao text, modalidade_licitatoria text, lei_referencia text DEFAULT '14.133/2021',
  garantia_percentual numeric(8,4) DEFAULT 0, retencao_padrao_percentual numeric(8,4) DEFAULT 0,
  formula_reajuste text, periodicidade_medicao text DEFAULT 'mensal' CHECK (periodicidade_medicao IN ('mensal','quinzenal','semanal','sob_demanda')),
  status text DEFAULT 'rascunho' CHECK (status IN ('rascunho','licitacao','contratado','em_execucao','suspenso','concluido','rescindido','arquivado')),
  locked_sov boolean DEFAULT false, settings jsonb DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES members(id), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS contracts_tenant_numero_unique ON contracts(tenant_id, numero) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_objeto ON contracts USING gin(objeto gin_trgm_ops);

CREATE TABLE IF NOT EXISTS contract_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid NOT NULL REFERENCES contracts(id),
  nome text NOT NULL, codigo text, municipio text, uf char(2), endereco text, latitude numeric(10,7), longitude numeric(10,7),
  responsavel_tecnico_id uuid REFERENCES members(id), responsavel_fiscal_id uuid REFERENCES members(id), responsavel_gestor_id uuid REFERENCES members(id),
  crea_responsavel text, valor_obra numeric(18,2) DEFAULT 0, prazo_dias int, status text DEFAULT 'ativo',
  metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_contract_lots_contract ON contract_lots(contract_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS contract_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid NOT NULL REFERENCES contracts(id), member_id uuid NOT NULL REFERENCES members(id),
  papel text NOT NULL, can_approve boolean DEFAULT false, can_measure boolean DEFAULT false, can_view_financial boolean DEFAULT false, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS contract_members_unique ON contract_members(contract_id, member_id, papel) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS disciplines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  codigo text NOT NULL, nome text NOT NULL, corporativa boolean DEFAULT true, ordem int DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS disciplines_unique ON disciplines(tenant_id, codigo) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS lot_disciplines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), lot_id uuid NOT NULL REFERENCES contract_lots(id), discipline_id uuid NOT NULL REFERENCES disciplines(id),
  active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS wbs_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid REFERENCES contracts(id), lot_id uuid REFERENCES contract_lots(id), program_component_id uuid REFERENCES program_components(id), program_goal_id uuid REFERENCES program_goals(id), discipline_id uuid REFERENCES disciplines(id),
  parent_id uuid REFERENCES wbs_items(id), codigo text NOT NULL, nome text NOT NULL, nivel int NOT NULL DEFAULT 1 CHECK (nivel BETWEEN 1 AND 8), ordem int DEFAULT 0,
  criterio_medicao text DEFAULT 'quantitativo' CHECK (criterio_medicao IN ('quantitativo','percentual_eap','marco','sem_medicao')),
  tem_acompanhamento_fisico boolean DEFAULT true, vinculado_marco boolean DEFAULT false, peso numeric(12,6) DEFAULT 0,
  data_inicio_prevista date, data_fim_prevista date, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_wbs_contract_parent ON wbs_items(contract_id, parent_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS contract_measurement_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid NOT NULL REFERENCES contracts(id),
  dia_inicio_medicao int DEFAULT 1 CHECK (dia_inicio_medicao BETWEEN 1 AND 31), forma_medicao text DEFAULT 'mensal_quantitativo' CHECK (forma_medicao IN ('mensal_quantitativo','fixa','eap_percentual','marco_evento','somente_pagamentos')),
  requer_aprovacao_servicos boolean DEFAULT true, evidencias_obrigatorias boolean DEFAULT true,
  alerta_saldo_80 boolean DEFAULT true, alerta_saldo_95 boolean DEFAULT true, bloqueio_saldo_100 boolean DEFAULT true,
  lock_after_first_measurement boolean DEFAULT true, settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS contract_measurement_settings_contract_unique ON contract_measurement_settings(contract_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS retention_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid REFERENCES contracts(id),
  nome text NOT NULL, tipo text NOT NULL CHECK (tipo IN ('garantia','inss','iss','irrf','multa','retencao_contratual','outro')),
  base_calculo text DEFAULT 'valor_liquido', aliquota numeric(12,6) DEFAULT 0, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS adjustment_indices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  codigo text NOT NULL, nome text NOT NULL, periodicidade text DEFAULT 'mensal', metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS adjustment_indices_unique ON adjustment_indices(tenant_id, codigo) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS contract_adjustment_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid NOT NULL REFERENCES contracts(id), index_id uuid REFERENCES adjustment_indices(id),
  formula text NOT NULL, data_base date, periodicidade_meses int DEFAULT 12, carencia_meses int DEFAULT 12, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

-- ============================================================
-- PLANILHA CONTRATUAL / SOV
-- ============================================================
CREATE TABLE IF NOT EXISTS spreadsheet_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid NOT NULL REFERENCES contracts(id),
  file_name text, storage_path text, mapping jsonb DEFAULT '{}'::jsonb, rows_detected int DEFAULT 0, rows_imported int DEFAULT 0, status text DEFAULT 'processado', errors jsonb DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES members(id), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS sov_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid NOT NULL REFERENCES contracts(id),
  numero int NOT NULL, origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','excel','aditivo','migracao')),
  status text DEFAULT 'rascunho' CHECK (status IN ('rascunho','em_revisao','vigente','substituida','cancelada')),
  locked_at timestamptz, locked_by uuid REFERENCES members(id), additive_id uuid, snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_value numeric(18,2) DEFAULT 0, total_items int DEFAULT 0, import_id uuid REFERENCES spreadsheet_imports(id),
  created_by uuid REFERENCES members(id), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sov_versions_contract_numero_unique ON sov_versions(contract_id, numero) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS contract_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid NOT NULL REFERENCES contracts(id), sov_version_id uuid NOT NULL REFERENCES sov_versions(id),
  parent_id uuid REFERENCES contract_items(id), discipline_id uuid REFERENCES disciplines(id), lot_id uuid REFERENCES contract_lots(id),
  nivel int NOT NULL DEFAULT 1 CHECK (nivel BETWEEN 1 AND 5), ordem int DEFAULT 0, codigo text NOT NULL, descricao text NOT NULL, unidade text,
  quantidade_contratada numeric(18,6) DEFAULT 0 CHECK (quantidade_contratada >= 0), quantidade_aditada numeric(18,6) DEFAULT 0,
  preco_unitario numeric(18,6) DEFAULT 0 CHECK (preco_unitario >= 0), bdi_percentual numeric(12,6) DEFAULT 0 CHECK (bdi_percentual >= 0),
  fonte_referencia text DEFAULT 'proprio' CHECK (fonte_referencia IN ('SINAPI','SICRO','ORSE','SEDOP','proprio','outro')),
  codigo_referencia text, is_title boolean DEFAULT false, is_extra boolean DEFAULT false, additive_item_id uuid,
  data_liberacao_medicao date, active boolean DEFAULT true, locked boolean DEFAULT false, metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS contract_items_unique ON contract_items(sov_version_id, codigo) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contract_items_contract ON contract_items(contract_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contract_items_desc ON contract_items USING gin(descricao gin_trgm_ops);

CREATE TABLE IF NOT EXISTS contract_item_price_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_item_id uuid NOT NULL REFERENCES contract_items(id),
  base text NOT NULL, codigo text, descricao text, uf char(2), data_base date, preco_referencia numeric(18,6), divergencia_percentual numeric(12,6), metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS wbs_item_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), wbs_item_id uuid NOT NULL REFERENCES wbs_items(id), contract_item_id uuid NOT NULL REFERENCES contract_items(id),
  quantidade_planejada numeric(18,6) DEFAULT 0, percentual_planejado numeric(12,6) DEFAULT 0, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS wbs_item_links_unique ON wbs_item_links(wbs_item_id, contract_item_id) WHERE deleted_at IS NULL;

-- ============================================================
-- WORKFLOW, MEDICOES, GLOSAS, RETENCOES
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid REFERENCES contracts(id),
  nome text NOT NULL, entity_type text NOT NULL CHECK (entity_type IN ('measurement','additive','unforeseen_item','ged_document','grd')),
  active boolean DEFAULT true, created_by uuid REFERENCES members(id), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), template_id uuid NOT NULL REFERENCES workflow_templates(id),
  ordem int NOT NULL, nome text NOT NULL, role_required text NOT NULL, sla_hours int DEFAULT 48,
  assinatura_obrigatoria boolean DEFAULT false, actions text[] DEFAULT ARRAY['aprovar','devolver','reprovar'], metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_steps_unique ON workflow_steps(template_id, ordem) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid NOT NULL REFERENCES contracts(id), sov_version_id uuid REFERENCES sov_versions(id),
  numero int NOT NULL, complementar_numero int DEFAULT 0, tipo text DEFAULT 'mensal_quantitativo' CHECK (tipo IN ('mensal_quantitativo','fixa','eap_percentual','marco_evento','somente_pagamentos')),
  periodo_inicio date NOT NULL, periodo_fim date NOT NULL, status text DEFAULT 'rascunho' CHECK (status IN ('rascunho','preliminar','emitida','em_aprovacao','aprovada','paga','devolvida','cancelada','complementar','retificada')),
  data_emissao date, data_aprovacao date, data_pagamento date, valor_po numeric(18,2) DEFAULT 0, valor_reajustado numeric(18,2) DEFAULT 0, valor_glosado numeric(18,2) DEFAULT 0, valor_retido numeric(18,2) DEFAULT 0, valor_liquido numeric(18,2) DEFAULT 0,
  hash_documento text, public_validation_code text, official_pdf_storage_path text, parent_measurement_id uuid REFERENCES measurements(id), snapshot jsonb DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES members(id), updated_by uuid REFERENCES members(id), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS measurements_contract_numero_unique ON measurements(contract_id, numero, complementar_numero) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_measurements_contract_status ON measurements(contract_id, status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS measurement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), measurement_id uuid NOT NULL REFERENCES measurements(id), contract_item_id uuid NOT NULL REFERENCES contract_items(id),
  quantidade_periodo numeric(18,6) DEFAULT 0, quantidade_acumulada_antes numeric(18,6) DEFAULT 0, quantidade_acumulada_incl_periodo numeric(18,6) DEFAULT 0,
  preco_unitario_snapshot numeric(18,6) DEFAULT 0, valor_periodo numeric(18,2) DEFAULT 0, valor_glosado numeric(18,2) DEFAULT 0, valor_liquido numeric(18,2) DEFAULT 0,
  saldo_disponivel_snapshot numeric(18,6) DEFAULT 0, memoria_resumo text, validacao_status text DEFAULT 'pendente' CHECK (validacao_status IN ('pendente','ok','alerta','bloqueado')),
  validacao_erros jsonb DEFAULT '[]'::jsonb, metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS measurement_items_unique ON measurement_items(measurement_id, contract_item_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS measurement_calc_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), measurement_item_id uuid NOT NULL REFERENCES measurement_items(id),
  local_fisico text, metodo_medicao text, formula text, variaveis jsonb DEFAULT '{}'::jsonb, quantidade_calculada numeric(18,6) DEFAULT 0, observacao text,
  locked_at timestamptz, created_by uuid REFERENCES members(id), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS measurement_evidences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), measurement_id uuid NOT NULL REFERENCES measurements(id), measurement_item_id uuid REFERENCES measurement_items(id),
  tipo text DEFAULT 'foto' CHECK (tipo IN ('foto','documento','croqui','planilha','rdo','outro')),
  title text, storage_path text, mime_type text, latitude numeric(10,7), longitude numeric(10,7), captured_at timestamptz, metadata jsonb DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES members(id), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS measurement_item_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), measurement_id uuid NOT NULL REFERENCES measurements(id), measurement_item_id uuid REFERENCES measurement_items(id),
  author_id uuid REFERENCES members(id), body text NOT NULL, kind text DEFAULT 'comment', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS measurement_glosses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), measurement_id uuid NOT NULL REFERENCES measurements(id), measurement_item_id uuid REFERENCES measurement_items(id),
  valor_glosado numeric(18,2) NOT NULL DEFAULT 0, quantidade_glosada numeric(18,6) DEFAULT 0, justificativa text NOT NULL, status text DEFAULT 'aplicada' CHECK (status IN ('rascunho','aplicada','contestada','mantida','cancelada')),
  decided_by uuid REFERENCES members(id), decided_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS measurement_retentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), measurement_id uuid NOT NULL REFERENCES measurements(id), retention_rule_id uuid REFERENCES retention_rules(id),
  nome text NOT NULL, base_valor numeric(18,2) DEFAULT 0, aliquota numeric(12,6) DEFAULT 0, valor_retido numeric(18,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS measurement_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), measurement_id uuid NOT NULL REFERENCES measurements(id),
  valor_pago numeric(18,2) NOT NULL, data_pagamento date NOT NULL, numero_ordem_bancaria text, nota_fiscal text, observacao text,
  created_by uuid REFERENCES members(id), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS measurement_approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), measurement_id uuid NOT NULL REFERENCES measurements(id), template_step_id uuid REFERENCES workflow_steps(id),
  ordem int NOT NULL, nome text NOT NULL, role_required text NOT NULL, assigned_to uuid REFERENCES members(id), status text DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','devolvido','reprovado','ignorado')),
  due_at timestamptz, decided_at timestamptz, decided_by uuid REFERENCES members(id), decided_via_delegation uuid REFERENCES approval_delegations(id), decided_for uuid REFERENCES members(id), comment text, signature_method text, signature_storage_path text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_measurement_approval_pending ON measurement_approval_steps(tenant_id, due_at) WHERE status='pendente' AND deleted_at IS NULL;

-- ============================================================
-- ITENS NAO PREVISTOS E ADITIVOS
-- ============================================================
CREATE TABLE IF NOT EXISTS unforeseen_item_origins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), nome text NOT NULL, descricao text, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS unforeseen_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid NOT NULL REFERENCES contracts(id), lot_id uuid REFERENCES contract_lots(id), discipline_id uuid REFERENCES disciplines(id), origin_id uuid REFERENCES unforeseen_item_origins(id),
  numero int NOT NULL, descricao text NOT NULL, justificativa text NOT NULL, data_abertura date DEFAULT CURRENT_DATE,
  status text DEFAULT 'levantamento' CHECK (status IN ('levantamento','analise_tecnica','analise_preco','aprovacao_consorcio','aprovacao_orgao','aprovado','recusado','aditado','cancelado')),
  valor_estimado numeric(18,2) DEFAULT 0, prazo_impacto_dias int DEFAULT 0, opened_by uuid REFERENCES members(id), approved_by uuid REFERENCES members(id), approved_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS unforeseen_items_contract_numero_unique ON unforeseen_items(contract_id, numero) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS unforeseen_item_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), unforeseen_item_id uuid NOT NULL REFERENCES unforeseen_items(id), contract_item_id uuid REFERENCES contract_items(id),
  tipo text NOT NULL CHECK (tipo IN ('acrescimo','decrescimo','extra_novo','titulo')),
  codigo text, descricao text NOT NULL, unidade text, quantidade numeric(18,6) DEFAULT 0, preco_unitario numeric(18,6) DEFAULT 0, valor_total numeric(18,2) DEFAULT 0,
  fonte_referencia text, codigo_referencia text, composicao jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS unforeseen_item_approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), unforeseen_item_id uuid NOT NULL REFERENCES unforeseen_items(id),
  ordem int NOT NULL, nome text NOT NULL, role_required text NOT NULL, status text DEFAULT 'pendente', due_at timestamptz, decided_at timestamptz, decided_by uuid REFERENCES members(id), comment text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS additives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid NOT NULL REFERENCES contracts(id),
  numero int NOT NULL, tipo text NOT NULL CHECK (tipo IN ('valor','prazo','valor_prazo','supressao','reequilibrio')),
  status text DEFAULT 'rascunho' CHECK (status IN ('rascunho','em_analise','em_aprovacao','aprovado','incorporado','reprovado','cancelado')),
  data_solicitacao date DEFAULT CURRENT_DATE, data_aprovacao date, valor_acrescimo numeric(18,2) DEFAULT 0, valor_decrescimo numeric(18,2) DEFAULT 0,
  valor_liquido numeric(18,2) GENERATED ALWAYS AS (valor_acrescimo - valor_decrescimo) STORED,
  prazo_execucao_acrescimo_dias int DEFAULT 0, prazo_vigencia_acrescimo_dias int DEFAULT 0,
  percentual_sobre_inicial numeric(12,6), justificativa_valor text, justificativa_prazo text, legal_basis text DEFAULT 'Lei 14.133/2021 art. 125',
  created_by uuid REFERENCES members(id), approved_by uuid REFERENCES members(id), metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS additives_contract_numero_unique ON additives(contract_id, numero) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS additive_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), additive_id uuid NOT NULL REFERENCES additives(id), unforeseen_item_component_id uuid REFERENCES unforeseen_item_components(id), contract_item_id uuid REFERENCES contract_items(id),
  tipo text NOT NULL CHECK (tipo IN ('acrescimo','decrescimo','extra_novo')),
  codigo text, descricao text NOT NULL, unidade text, quantidade numeric(18,6) DEFAULT 0, preco_unitario numeric(18,6) DEFAULT 0, valor_total numeric(18,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS additive_approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), additive_id uuid NOT NULL REFERENCES additives(id),
  ordem int NOT NULL, nome text NOT NULL, role_required text NOT NULL, status text DEFAULT 'pendente', due_at timestamptz, decided_at timestamptz, decided_by uuid REFERENCES members(id), comment text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

-- ============================================================
-- CRONOGRAMA E FINANCEIRO
-- ============================================================
CREATE TABLE IF NOT EXISTS schedule_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid NOT NULL REFERENCES contracts(id),
  periodo date NOT NULL, label text, ordem int DEFAULT 0, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS physical_financial_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid NOT NULL REFERENCES contracts(id), lot_id uuid REFERENCES contract_lots(id), discipline_id uuid REFERENCES disciplines(id), wbs_item_id uuid REFERENCES wbs_items(id), schedule_period_id uuid REFERENCES schedule_periods(id),
  percentual_fisico_previsto numeric(12,6) DEFAULT 0, percentual_fisico_realizado numeric(12,6) DEFAULT 0,
  valor_previsto numeric(18,2) DEFAULT 0, valor_realizado numeric(18,2) DEFAULT 0,
  source text DEFAULT 'manual', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS contract_financial_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid NOT NULL REFERENCES contracts(id),
  reference_date date NOT NULL DEFAULT CURRENT_DATE, valor_inicial numeric(18,2) DEFAULT 0, valor_aditado numeric(18,2) DEFAULT 0, valor_total_atual numeric(18,2) DEFAULT 0,
  valor_medido_mes numeric(18,2) DEFAULT 0, valor_medido_acumulado numeric(18,2) DEFAULT 0, valor_reajustado_acumulado numeric(18,2) DEFAULT 0, total_retencoes numeric(18,2) DEFAULT 0, total_glosas numeric(18,2) DEFAULT 0, total_pago numeric(18,2) DEFAULT 0, saldo_contratual numeric(18,2) DEFAULT 0,
  percentual_fisico numeric(12,6) DEFAULT 0, percentual_financeiro numeric(12,6) DEFAULT 0,
  forecast_3m numeric(18,2) DEFAULT 0, forecast_6m numeric(18,2) DEFAULT 0, forecast_12m numeric(18,2) DEFAULT 0,
  risk_flags jsonb DEFAULT '[]'::jsonb, generated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_contract_financial_snapshots_contract ON contract_financial_snapshots(contract_id, reference_date DESC);

-- ============================================================
-- GED / DATABOOK
-- ============================================================
CREATE TABLE IF NOT EXISTS ged_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), parent_id uuid REFERENCES ged_categories(id),
  codigo text NOT NULL, nome text NOT NULL, ordem int DEFAULT 0, nomenclature_pattern text, requires_physical_original boolean DEFAULT false, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ged_categories_unique ON ged_categories(tenant_id, codigo) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ged_controlled_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), key text NOT NULL, nome text NOT NULL, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ged_terms_unique ON ged_controlled_terms(tenant_id, key) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ged_controlled_term_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), term_id uuid NOT NULL REFERENCES ged_controlled_terms(id),
  value text NOT NULL, label text NOT NULL, ordem int DEFAULT 0, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS ged_metadata_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), category_id uuid NOT NULL REFERENCES ged_categories(id),
  key text NOT NULL, label text NOT NULL, field_type text DEFAULT 'text' CHECK (field_type IN ('text','number','date','boolean','controlled_term','member','contract','lot','discipline','item')),
  required boolean DEFAULT false, controlled_term_id uuid REFERENCES ged_controlled_terms(id), ordem int DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS ged_storage_module_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), nome text NOT NULL, descricao text, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS ged_storage_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), type_id uuid REFERENCES ged_storage_module_types(id),
  codigo text NOT NULL, nome text NOT NULL, localizacao text, capacidade text, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS ged_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), category_id uuid NOT NULL REFERENCES ged_categories(id),
  contract_id uuid REFERENCES contracts(id), lot_id uuid REFERENCES contract_lots(id), discipline_id uuid REFERENCES disciplines(id), contract_item_id uuid REFERENCES contract_items(id),
  numero text, nomenclature_code text, title text NOT NULL, description text, status text DEFAULT 'em_elaboracao' CHECK (status IN ('em_elaboracao','em_revisao','aprovado','distribuido','obsoleto','cancelado')),
  revisao_atual text, data_documento date, responsavel_id uuid REFERENCES members(id), keywords text[], has_physical_original boolean DEFAULT false, storage_module_id uuid REFERENCES ged_storage_modules(id), physical_location text,
  fulltext tsvector, metadata jsonb DEFAULT '{}'::jsonb, created_by uuid REFERENCES members(id), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ged_documents_fulltext ON ged_documents USING gin(fulltext);
CREATE INDEX IF NOT EXISTS idx_ged_documents_title ON ged_documents USING gin(title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS ged_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), document_id uuid NOT NULL REFERENCES ged_documents(id),
  revision text NOT NULL, storage_path text, mime_type text, file_size bigint, hash_sha256 text, extracted_text text, status text DEFAULT 'vigente', uploaded_by uuid REFERENCES members(id), uploaded_at timestamptz DEFAULT now(), metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ged_document_versions_unique ON ged_document_versions(document_id, revision) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ged_document_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), document_id uuid NOT NULL REFERENCES ged_documents(id), field_id uuid NOT NULL REFERENCES ged_metadata_fields(id),
  value_text text, value_number numeric, value_date date, value_bool boolean, value_json jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS ged_distribution_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), nome text NOT NULL, category_id uuid REFERENCES ged_categories(id), active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS ged_distribution_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), list_id uuid NOT NULL REFERENCES ged_distribution_lists(id), member_id uuid NOT NULL REFERENCES members(id),
  delivery_method text DEFAULT 'email', active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS ged_transmittals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid REFERENCES contracts(id),
  numero text NOT NULL, title text NOT NULL, status text DEFAULT 'rascunho' CHECK (status IN ('rascunho','enviada','recebida_parcial','recebida','cancelada')),
  sender_id uuid REFERENCES members(id), recipient_organization_id uuid REFERENCES contract_organizations(id), sent_at timestamptz, metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS ged_transmittal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), transmittal_id uuid NOT NULL REFERENCES ged_transmittals(id), document_version_id uuid NOT NULL REFERENCES ged_document_versions(id),
  finalidade text DEFAULT 'informacao', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS ged_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), transmittal_id uuid NOT NULL REFERENCES ged_transmittals(id), recipient_id uuid REFERENCES members(id),
  status text DEFAULT 'pendente' CHECK (status IN ('pendente','confirmado','recusado')), confirmed_at timestamptz, signature_method text, comment text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS ged_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), document_id uuid NOT NULL REFERENCES ged_documents(id), member_id uuid REFERENCES members(id),
  action text NOT NULL CHECK (action IN ('view','download','preview','share','print_label')), ip inet, user_agent text, created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ged_databook_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid REFERENCES contracts(id), lot_id uuid REFERENCES contract_lots(id),
  status text DEFAULT 'solicitado' CHECK (status IN ('solicitado','processando','gerado','erro','cancelado')), storage_path text, manifest_pdf_path text, manifest_csv_path text, hash_sha256 text, filters jsonb DEFAULT '{}'::jsonb,
  requested_by uuid REFERENCES members(id), generated_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

-- ============================================================
-- RELATORIOS, VALIDACAO PUBLICA E INTEGRACOES
-- ============================================================
CREATE TABLE IF NOT EXISTS generated_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid REFERENCES contracts(id),
  report_type text NOT NULL, title text NOT NULL, storage_path text, mime_type text, filters jsonb DEFAULT '{}'::jsonb, status text DEFAULT 'gerado' CHECK (status IN ('processando','gerado','erro','cancelado')),
  generated_by uuid REFERENCES members(id), generated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public_validation_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL UNIQUE, entity_type text NOT NULL CHECK (entity_type IN ('measurement_document','additive_document','ged_document_version','databook_export','grd')),
  entity_id uuid NOT NULL, title text NOT NULL, hash_sha256 text, storage_path text, metadata jsonb DEFAULT '{}'::jsonb, active boolean DEFAULT true, expires_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS external_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contract_id uuid REFERENCES contracts(id),
  external_system text NOT NULL, external_id text NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL, metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS integration_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  destination text NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL, status text DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled')), attempts int DEFAULT 0, last_error text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);

-- ============================================================
-- TRIGGERS
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','members','admin_backlog','approval_delegations','approval_magic_links','programs','program_components','program_goals','contract_organizations','contracts','contract_lots','contract_members','disciplines','lot_disciplines','wbs_items','contract_measurement_settings','retention_rules','adjustment_indices','contract_adjustment_rules','spreadsheet_imports','sov_versions','contract_items','contract_item_price_references','wbs_item_links','workflow_templates','workflow_steps','measurements','measurement_items','measurement_calc_lines','measurement_evidences','measurement_item_comments','measurement_glosses','measurement_retentions','measurement_payment_events','measurement_approval_steps','unforeseen_item_origins','unforeseen_items','unforeseen_item_components','unforeseen_item_approval_steps','additives','additive_items','additive_approval_steps','schedule_periods','physical_financial_schedule','contract_financial_snapshots','ged_categories','ged_controlled_terms','ged_controlled_term_values','ged_metadata_fields','ged_storage_module_types','ged_storage_modules','ged_documents','ged_document_versions','ged_document_metadata','ged_distribution_lists','ged_distribution_members','ged_transmittals','ged_transmittal_documents','ged_receipts','ged_databook_exports','generated_reports','public_validation_records','external_links','integration_outbox'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END $$;

-- Fulltext update for GED
CREATE OR REPLACE FUNCTION public.ged_documents_fulltext_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.fulltext := to_tsvector('portuguese', coalesce(NEW.title,'') || ' ' || coalesce(NEW.description,'') || ' ' || coalesce(NEW.nomenclature_code,'') || ' ' || coalesce(array_to_string(NEW.keywords,' '),''));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ged_documents_fulltext ON ged_documents;
CREATE TRIGGER ged_documents_fulltext BEFORE INSERT OR UPDATE ON ged_documents FOR EACH ROW EXECUTE FUNCTION public.ged_documents_fulltext_update();

-- ============================================================
-- RLS
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'members','audit_log','notifications','approval_delegations','approval_magic_links','programs','program_components','program_goals','contract_organizations','contracts','contract_lots','contract_members','disciplines','lot_disciplines','wbs_items','contract_measurement_settings','retention_rules','adjustment_indices','contract_adjustment_rules','spreadsheet_imports','sov_versions','contract_items','contract_item_price_references','wbs_item_links','workflow_templates','workflow_steps','measurements','measurement_items','measurement_calc_lines','measurement_evidences','measurement_item_comments','measurement_glosses','measurement_retentions','measurement_payment_events','measurement_approval_steps','unforeseen_item_origins','unforeseen_items','unforeseen_item_components','unforeseen_item_approval_steps','additives','additive_items','additive_approval_steps','schedule_periods','physical_financial_schedule','contract_financial_snapshots','ged_categories','ged_controlled_terms','ged_controlled_term_values','ged_metadata_fields','ged_storage_module_types','ged_storage_modules','ged_documents','ged_document_versions','ged_document_metadata','ged_distribution_lists','ged_distribution_members','ged_transmittals','ged_transmittal_documents','ged_receipts','ged_access_log','ged_databook_exports','generated_reports','public_validation_records','external_links','integration_outbox'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (tenant_id = public.current_tenant_id())', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id())', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id())', t || '_update', t);
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenants_select ON tenants;
CREATE POLICY tenants_select ON tenants FOR SELECT USING (id = public.current_tenant_id());
DROP POLICY IF EXISTS tenants_update ON tenants;
CREATE POLICY tenants_update ON tenants FOR UPDATE USING (id = public.current_tenant_id() AND public.has_role(ARRAY['admin'])) WITH CHECK (id = public.current_tenant_id() AND public.has_role(ARRAY['admin']));

ALTER TABLE admin_backlog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_backlog_select ON admin_backlog;
CREATE POLICY admin_backlog_select ON admin_backlog FOR SELECT USING (public.has_role(ARRAY['admin']));
DROP POLICY IF EXISTS admin_backlog_write ON admin_backlog;
CREATE POLICY admin_backlog_write ON admin_backlog FOR ALL USING (public.has_role(ARRAY['admin'])) WITH CHECK (public.has_role(ARRAY['admin']));

-- ============================================================
-- SEED HELPER POR TENANT
-- ============================================================
CREATE OR REPLACE FUNCTION public.seed_geocon_tenant(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO disciplines(tenant_id,codigo,nome,corporativa,ordem) VALUES
    (p_tenant_id,'ADM','Administração local',true,1),(p_tenant_id,'CIV','Civil',true,2),(p_tenant_id,'ELE','Elétrica',true,3),(p_tenant_id,'HID','Hidráulica',true,4),(p_tenant_id,'DRE','Drenagem',true,5)
  ON CONFLICT DO NOTHING;
  INSERT INTO unforeseen_item_origins(tenant_id,nome,descricao) VALUES
    (p_tenant_id,'Deficiência de projeto','Serviço não previsto por lacuna ou erro de projeto'),
    (p_tenant_id,'Solicitação do contratante','Mudança solicitada formalmente pelo contratante'),
    (p_tenant_id,'Condição de campo','Situação encontrada em campo não prevista'),
    (p_tenant_id,'Mudança normativa','Adequação legal ou técnica superveniente')
  ON CONFLICT DO NOTHING;
  INSERT INTO ged_categories(tenant_id,codigo,nome,ordem,nomenclature_pattern) VALUES
    (p_tenant_id,'PROJ','Projeto executivo',1,'{CONTRATO}-{DISC}-{TIPO}-{SEQ}'),
    (p_tenant_id,'MED','Medições',2,'{CONTRATO}-MED-{SEQ}'),
    (p_tenant_id,'ADI','Aditivos',3,'{CONTRATO}-ADI-{SEQ}'),
    (p_tenant_id,'FISC','Fiscalização',4,'{CONTRATO}-FISC-{SEQ}'),
    (p_tenant_id,'ASB','As built',5,'{CONTRATO}-ASB-{SEQ}')
  ON CONFLICT DO NOTHING;
END;
$$;
