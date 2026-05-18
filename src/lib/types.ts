export type Role =
  | 'admin'
  | 'gestor_contrato'
  | 'fiscal_contrato'
  | 'fiscal_campo'
  | 'contratada'
  | 'gerenciadora'
  | 'financeiro'
  | 'controle_interno'
  | 'auditor'
  | 'ged_admin'
  | 'ged_reader'
  | 'viewer';

export type MeasurementStatus =
  | 'rascunho'
  | 'preliminar'
  | 'enviada'
  | 'em_revisao'
  | 'devolvida'
  | 'aprovada'
  | 'emitida'
  | 'paga'
  | 'cancelada'
  | 'retificada'
  | 'complementar';

export interface Tenant {
  id: string;
  nome: string;
  cnpj?: string | null;
  ativo: boolean;
  brand_logo_url?: string | null;
  settings?: Record<string, unknown>;
}

export interface Member {
  id: string;
  auth_id: string;
  tenant_id: string;
  email: string;
  nome: string;
  cpf?: string | null;
  telefone?: string | null;
  crea_numero?: string | null;
  crea_uf?: string | null;
  cargo?: string | null;
  empresa?: string | null;
  can_sign_measurement: boolean;
  can_sign_additive: boolean;
  active: boolean;
  role: Role;
  roles: Role[];
  product_access?: Record<string, unknown>;
  tenants?: Tenant;
}

export interface Contract {
  id: string;
  tenant_id?: string;
  numero: string;
  objeto: string;
  contratante_nome: string;
  contratada_nome: string;
  municipio: string;
  uf: string;
  valor_inicial: number;
  valor_aditado: number;
  valor_atual: number;
  valor_medido_acumulado: number;
  valor_pago: number;
  saldo_contratual: number;
  percentual_fisico: number;
  percentual_financeiro: number;
  data_assinatura: string;
  data_ordem_inicio: string;
  regime_contratacao: string;
  modalidade_licitatoria: string;
  status: string;
  alertas: string[];
}

export interface Item {
  id: string;
  contract_id: string;
  codigo: string;
  descricao: string;
  disciplina: string;
  unidade: string;
  quantidade_contratada: number;
  quantidade_aditada: number;
  quantidade_medida_acumulada: number;
  preco_unitario: number;
  bdi: number;
  fonte_referencia: string;
  locked: boolean;
}

export interface Measurement {
  id: string;
  contract_id: string;
  numero: number;
  complementar_numero?: number | null;
  tipo: string;
  status: MeasurementStatus;
  periodo_inicio: string;
  periodo_fim: string;
  data_emissao?: string;
  valor_po: number;
  valor_reajustado: number;
  valor_glosado: number;
  valor_retido: number;
  valor_liquido: number;
  hash_documento?: string;
  public_validation_code?: string;
  official_pdf_storage_path?: string;
  parent_measurement_id?: string | null;
  snapshot?: {
    origin?: 'complementar' | 'retificacao' | string;
    parent_numero?: number;
    observacao?: string;
    justificativa?: string;
    itens_copiados?: number;
    cancelamento?: { motivo?: string; cancelled_at?: string };
    [key: string]: unknown;
  } | null;
}

export interface ValidationIssue {
  rule: string;
  severity: 'alerta' | 'bloqueado';
  message: string;
}

export interface MItem {
  id: string;
  measurement_id: string;
  contract_item_id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade_periodo: number;
  quantidade_acumulada_antes: number;
  quantidade_acumulada_incl_periodo: number;
  preco_unitario_snapshot: number;
  valor_periodo: number;
  valor_glosado: number;
  valor_liquido: number;
  saldo_disponivel_snapshot: number;
  memoria_resumo: string;
  validacao_status: string;
  validacao_erros: ValidationIssue[];
}

export interface Additive {
  id: string;
  contract_id: string;
  numero: number;
  tipo: string;
  status: string;
  valor_acrescimo: number;
  valor_decrescimo: number;
  prazo_execucao_dias: number;
  data_solicitacao: string;
  justificativa: string;
}

export interface Doc {
  id: string;
  codigo: string;
  titulo: string;
  categoria: string;
  revisao: string;
  status: string;
  contrato: string;
  disciplina: string;
  responsavel: string;
  data_documento: string;
  versoes: number;
}

export interface Notification {
  id: string;
  title: string;
  body?: string | null;
  link?: string | null;
  read_at?: string | null;
  kind?: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export interface PublicValidationRecord {
  id: string;
  code: string;
  entity_type: string;
  entity_id: string;
  title: string;
  hash_sha256: string;
  storage_path: string | null;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}
