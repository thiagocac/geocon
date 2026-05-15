/**
 * Mock data para o modo DEMO (SKIP_AUTH=true em config.js).
 * Usado quando o usuário ainda não configurou Supabase real e quer ver
 * como as telas ficam. NÃO entra em produção real porque depende da flag.
 */
import type { Contract, Item, Measurement, MItem, Additive, Doc, Notification, Member } from './types';

const TODAY = new Date().toISOString().slice(0, 10);
const FIRST_OF_MONTH = `${TODAY.slice(0, 8)}01`;
const TENANT_ID = '00000000-0000-0000-0000-00000000bee5';

export const MOCK_MEMBER: Member = {
  id: '11111111-1111-1111-1111-111111111111',
  auth_id: '22222222-2222-2222-2222-222222222222',
  tenant_id: TENANT_ID,
  email: 'demo@consultegeo.org',
  nome: 'Demonstração',
  cargo: 'Engenheiro fiscal',
  empresa: 'Consulte GEO',
  crea_numero: '123.456/D',
  crea_uf: 'SP',
  cpf: null,
  telefone: null,
  can_sign_measurement: true,
  can_sign_additive: true,
  active: true,
  role: 'admin',
  roles: ['admin', 'gestor_contrato', 'fiscal_contrato'],
  tenants: {
    id: TENANT_ID,
    nome: 'Tenant DEMO — Consulte GEO',
    cnpj: '12.345.678/0001-90',
    ativo: true,
    brand_logo_url: null,
  },
};

export const MOCK_CONTRACTS: Contract[] = [
  {
    id: 'c1', tenant_id: TENANT_ID,
    numero: 'CT-2024/0042',
    objeto: 'Reforma e ampliação do hospital regional de São Carlos — bloco cirúrgico',
    contratante_nome: 'Secretaria de Estado da Saúde',
    contratada_nome: 'Construtora Alvorada Ltda.',
    municipio: 'São Carlos', uf: 'SP',
    valor_inicial: 12_400_000, valor_aditado: 1_240_000,
    valor_atual: 13_640_000, valor_medido_acumulado: 8_184_000,
    valor_pago: 7_650_000, saldo_contratual: 5_456_000,
    percentual_fisico: 62, percentual_financeiro: 60,
    data_assinatura: '2024-03-15', data_ordem_inicio: '2024-04-01',
    regime_contratacao: 'Empreitada por preço unitário',
    modalidade_licitatoria: 'Concorrência',
    status: 'em_execucao',
    alertas: ['Aditivo atinge 10% — próximo do limite de 25%', 'SLA de medição #06 vence em 3 dias'],
  },
  {
    id: 'c2', tenant_id: TENANT_ID,
    numero: 'CT-2024/0058',
    objeto: 'Pavimentação e drenagem do bairro Jardim Europa, lote 2',
    contratante_nome: 'Prefeitura Municipal de Ribeirão Preto',
    contratada_nome: 'Pavimentadora Bandeirantes S.A.',
    municipio: 'Ribeirão Preto', uf: 'SP',
    valor_inicial: 4_850_000, valor_aditado: 0,
    valor_atual: 4_850_000, valor_medido_acumulado: 1_212_500,
    valor_pago: 1_212_500, saldo_contratual: 3_637_500,
    percentual_fisico: 28, percentual_financeiro: 25,
    data_assinatura: '2024-06-10', data_ordem_inicio: '2024-07-01',
    regime_contratacao: 'Empreitada por preço unitário',
    modalidade_licitatoria: 'Pregão eletrônico',
    status: 'em_execucao',
    alertas: [],
  },
  {
    id: 'c3', tenant_id: TENANT_ID,
    numero: 'CT-2023/0019',
    objeto: 'Construção de creche-escola padrão FNDE — Setor Sul',
    contratante_nome: 'Município de Goiânia',
    contratada_nome: 'Engerocha Construções',
    municipio: 'Goiânia', uf: 'GO',
    valor_inicial: 6_800_000, valor_aditado: 320_000,
    valor_atual: 7_120_000, valor_medido_acumulado: 7_120_000,
    valor_pago: 6_768_000, saldo_contratual: 0,
    percentual_fisico: 100, percentual_financeiro: 100,
    data_assinatura: '2023-08-22', data_ordem_inicio: '2023-09-15',
    regime_contratacao: 'Empreitada por preço global',
    modalidade_licitatoria: 'RDC',
    status: 'concluido',
    alertas: ['Aguardando termo de recebimento definitivo'],
  },
  {
    id: 'c4', tenant_id: TENANT_ID,
    numero: 'CT-2025/0003',
    objeto: 'Serviços de engenharia consultiva — supervisão de obras rodoviárias',
    contratante_nome: 'DER-MG',
    contratada_nome: 'Consulte GEO Engenharia',
    municipio: 'Belo Horizonte', uf: 'MG',
    valor_inicial: 2_200_000, valor_aditado: 0,
    valor_atual: 2_200_000, valor_medido_acumulado: 0,
    valor_pago: 0, saldo_contratual: 2_200_000,
    percentual_fisico: 0, percentual_financeiro: 0,
    data_assinatura: '2025-01-12', data_ordem_inicio: '2025-02-01',
    regime_contratacao: 'Preço unitário',
    modalidade_licitatoria: 'Concorrência',
    status: 'contratado',
    alertas: [],
  },
];

const items: Record<string, Item[]> = {
  c1: [
    { id: 'i1-1', contract_id: 'c1', codigo: '01.001', descricao: 'Demolição de alvenaria de bloco cerâmico, e=15cm', disciplina: 'Demolição', unidade: 'm2', quantidade_contratada: 420, quantidade_aditada: 0, quantidade_medida_acumulada: 380, preco_unitario: 38.50, bdi: 24.5, fonte_referencia: 'SINAPI', locked: true },
    { id: 'i1-2', contract_id: 'c1', codigo: '02.015', descricao: 'Concreto fck=30MPa para pilares e vigas', disciplina: 'Estrutura', unidade: 'm3', quantidade_contratada: 180, quantidade_aditada: 12, quantidade_medida_acumulada: 156, preco_unitario: 845.20, bdi: 24.5, fonte_referencia: 'SINAPI', locked: true },
    { id: 'i1-3', contract_id: 'c1', codigo: '04.003', descricao: 'Alvenaria de bloco de concreto 14x19x39 cm', disciplina: 'Vedação', unidade: 'm2', quantidade_contratada: 1850, quantidade_aditada: 0, quantidade_medida_acumulada: 1102, preco_unitario: 92.30, bdi: 24.5, fonte_referencia: 'SINAPI', locked: false },
    { id: 'i1-4', contract_id: 'c1', codigo: '07.022', descricao: 'Revestimento cerâmico 60x60 cm — área molhada', disciplina: 'Acabamento', unidade: 'm2', quantidade_contratada: 980, quantidade_aditada: 0, quantidade_medida_acumulada: 410, preco_unitario: 128.40, bdi: 24.5, fonte_referencia: 'SINAPI', locked: false },
    { id: 'i1-5', contract_id: 'c1', codigo: '12.040', descricao: 'Quadro elétrico 24 disjuntores DIN, com barramento', disciplina: 'Elétrica', unidade: 'un', quantidade_contratada: 8, quantidade_aditada: 0, quantidade_medida_acumulada: 5, preco_unitario: 4_280.00, bdi: 24.5, fonte_referencia: 'SBC', locked: false },
  ],
  c2: [
    { id: 'i2-1', contract_id: 'c2', codigo: '01.010', descricao: 'Limpeza e raspagem do terreno', disciplina: 'Terraplanagem', unidade: 'm2', quantidade_contratada: 18500, quantidade_aditada: 0, quantidade_medida_acumulada: 18500, preco_unitario: 4.20, bdi: 22, fonte_referencia: 'SINAPI', locked: true },
    { id: 'i2-2', contract_id: 'c2', codigo: '03.045', descricao: 'Base de brita graduada simples — 20cm', disciplina: 'Pavimentação', unidade: 'm2', quantidade_contratada: 16800, quantidade_aditada: 0, quantidade_medida_acumulada: 8200, preco_unitario: 38.90, bdi: 22, fonte_referencia: 'SINAPI', locked: false },
    { id: 'i2-3', contract_id: 'c2', codigo: '03.050', descricao: 'Capa asfáltica CBUQ — 5cm', disciplina: 'Pavimentação', unidade: 'm2', quantidade_contratada: 16800, quantidade_aditada: 0, quantidade_medida_acumulada: 0, preco_unitario: 72.10, bdi: 22, fonte_referencia: 'SINAPI', locked: false },
  ],
  c3: [], c4: [],
};

export const MOCK_ITEMS = items;

const measurements: Record<string, Measurement[]> = {
  c1: [
    { id: 'm1-6', contract_id: 'c1', numero: 6, tipo: 'mensal_quantitativo', status: 'em_revisao', periodo_inicio: FIRST_OF_MONTH, periodo_fim: TODAY, valor_po: 1_420_000, valor_reajustado: 0, valor_glosado: 38_000, valor_retido: 71_000, valor_liquido: 1_311_000 },
    { id: 'm1-5', contract_id: 'c1', numero: 5, tipo: 'mensal_quantitativo', status: 'paga', periodo_inicio: '2025-09-01', periodo_fim: '2025-09-30', valor_po: 1_580_000, valor_reajustado: 0, valor_glosado: 12_000, valor_retido: 79_000, valor_liquido: 1_489_000, hash_documento: '7c4d1f8e2a9b3c5d8e7f1a2b3c4d5e6f', public_validation_code: 'A1B2C3D4E5F60718', official_pdf_storage_path: 'mock' },
    { id: 'm1-4', contract_id: 'c1', numero: 4, tipo: 'mensal_quantitativo', status: 'paga', periodo_inicio: '2025-08-01', periodo_fim: '2025-08-31', valor_po: 1_640_000, valor_reajustado: 0, valor_glosado: 0, valor_retido: 82_000, valor_liquido: 1_558_000, hash_documento: '9e5d2c1b3a4f8e7d6c5b4a3f2e1d0c9b', public_validation_code: 'F0E1D2C3B4A50617', official_pdf_storage_path: 'mock' },
    { id: 'm1-3', contract_id: 'c1', numero: 3, tipo: 'mensal_quantitativo', status: 'paga', periodo_inicio: '2025-07-01', periodo_fim: '2025-07-31', valor_po: 1_380_000, valor_reajustado: 0, valor_glosado: 22_000, valor_retido: 69_000, valor_liquido: 1_289_000 },
    { id: 'm1-2', contract_id: 'c1', numero: 2, tipo: 'mensal_quantitativo', status: 'paga', periodo_inicio: '2025-06-01', periodo_fim: '2025-06-30', valor_po: 1_240_000, valor_reajustado: 0, valor_glosado: 0, valor_retido: 62_000, valor_liquido: 1_178_000 },
    { id: 'm1-1', contract_id: 'c1', numero: 1, tipo: 'mensal_quantitativo', status: 'paga', periodo_inicio: '2025-05-01', periodo_fim: '2025-05-31', valor_po: 1_120_000, valor_reajustado: 0, valor_glosado: 0, valor_retido: 56_000, valor_liquido: 1_064_000 },
  ],
  c2: [
    { id: 'm2-2', contract_id: 'c2', numero: 2, tipo: 'mensal_quantitativo', status: 'preliminar', periodo_inicio: FIRST_OF_MONTH, periodo_fim: TODAY, valor_po: 645_000, valor_reajustado: 0, valor_glosado: 0, valor_retido: 0, valor_liquido: 645_000 },
    { id: 'm2-1', contract_id: 'c2', numero: 1, tipo: 'mensal_quantitativo', status: 'paga', periodo_inicio: '2025-09-01', periodo_fim: '2025-09-30', valor_po: 567_500, valor_reajustado: 0, valor_glosado: 0, valor_retido: 28_375, valor_liquido: 539_125 },
  ],
  c3: [], c4: [],
};
export const MOCK_MEASUREMENTS = measurements;

const mitems: Record<string, MItem[]> = {
  'm1-6': [
    { id: 'mi-1', measurement_id: 'm1-6', contract_item_id: 'i1-3', codigo: '04.003', descricao: 'Alvenaria de bloco de concreto', unidade: 'm2', quantidade_periodo: 312, quantidade_acumulada_antes: 790, quantidade_acumulada_incl_periodo: 1102, preco_unitario_snapshot: 92.30, valor_periodo: 28_797.60, valor_glosado: 0, valor_liquido: 28_797.60, saldo_disponivel_snapshot: 748, memoria_resumo: 'Bloco cirúrgico — pavimento 1: 198 m²; pavimento 2: 114 m²', validacao_status: 'ok', validacao_erros: [] },
    { id: 'mi-2', measurement_id: 'm1-6', contract_item_id: 'i1-4', codigo: '07.022', descricao: 'Revestimento cerâmico 60x60', unidade: 'm2', quantidade_periodo: 180, quantidade_acumulada_antes: 230, quantidade_acumulada_incl_periodo: 410, preco_unitario_snapshot: 128.40, valor_periodo: 23_112.00, valor_glosado: 12_840.00, valor_liquido: 10_272.00, saldo_disponivel_snapshot: 570, memoria_resumo: '4 banheiros pavimento 1 + corredor', validacao_status: 'alerta', validacao_erros: [{ rule: 'glosa_excessiva', severity: 'alerta', message: 'Glosa de 55,5% supera 30% do período — revisar' }] },
    { id: 'mi-3', measurement_id: 'm1-6', contract_item_id: 'i1-5', codigo: '12.040', descricao: 'Quadro elétrico 24 disjuntores', unidade: 'un', quantidade_periodo: 2, quantidade_acumulada_antes: 3, quantidade_acumulada_incl_periodo: 5, preco_unitario_snapshot: 4_280.00, valor_periodo: 8_560.00, valor_glosado: 0, valor_liquido: 8_560.00, saldo_disponivel_snapshot: 3, memoria_resumo: 'QDF-101 e QDF-102', validacao_status: 'ok', validacao_erros: [] },
  ],
};
export const MOCK_MITEMS = mitems;

const additives: Record<string, Additive[]> = {
  c1: [
    { id: 'a1-1', contract_id: 'c1', numero: 1, tipo: 'quantitativo_acrescimo', status: 'aprovado', valor_acrescimo: 840_000, valor_decrescimo: 0, prazo_execucao_dias: 30, data_solicitacao: '2025-08-12', justificativa: 'Necessidade de reforço estrutural no bloco cirúrgico devido a sondagem complementar' },
    { id: 'a1-2', contract_id: 'c1', numero: 2, tipo: 'prazo', status: 'aprovado', valor_acrescimo: 0, valor_decrescimo: 0, prazo_execucao_dias: 45, data_solicitacao: '2025-09-30', justificativa: 'Chuvas atípicas — paralisação dos serviços externos' },
    { id: 'a1-3', contract_id: 'c1', numero: 3, tipo: 'quantitativo_acrescimo', status: 'em_revisao', valor_acrescimo: 400_000, valor_decrescimo: 0, prazo_execucao_dias: 0, data_solicitacao: '2025-10-08', justificativa: 'Inclusão de sistema de gases medicinais não previsto no projeto inicial' },
  ],
  c2: [], c3: [], c4: [],
};
export const MOCK_ADDITIVES = additives;

export const MOCK_DOCS: Doc[] = [
  { id: 'd1', codigo: 'PR-ARQ-001', titulo: 'Planta baixa — Bloco cirúrgico, pav. térreo', categoria: 'Projeto executivo', revisao: 'R03', status: 'aprovado',  contrato: 'CT-2024/0042', disciplina: 'Arquitetura', responsavel: 'Ana Souza',   data_documento: '2024-04-12', versoes: 4 },
  { id: 'd2', codigo: 'PR-EST-014', titulo: 'Memorial de cálculo estrutural — fundações',    categoria: 'Memorial',          revisao: 'R01', status: 'aprovado',  contrato: 'CT-2024/0042', disciplina: 'Estrutura',   responsavel: 'Carlos Lima', data_documento: '2024-03-30', versoes: 2 },
  { id: 'd3', codigo: 'PR-ELE-022', titulo: 'Diagrama unifilar — QDF e quadros derivados',   categoria: 'Projeto executivo', revisao: 'R02', status: 'em_revisao', contrato: 'CT-2024/0042', disciplina: 'Elétrica',    responsavel: 'Marina Sá',   data_documento: '2024-05-08', versoes: 3 },
  { id: 'd4', codigo: 'RT-OBR-007', titulo: 'Relatório fotográfico — semana 18',             categoria: 'Relatório',         revisao: 'R00', status: 'distribuido',contrato: 'CT-2024/0042', disciplina: '',            responsavel: 'João Pedro',  data_documento: '2025-10-05', versoes: 1 },
  { id: 'd5', codigo: 'AT-LIC-001', titulo: 'Alvará de construção atualizado',                categoria: 'Documento legal',   revisao: 'R00', status: 'aprovado',  contrato: 'CT-2024/0042', disciplina: '',            responsavel: 'Ana Souza',   data_documento: '2024-02-28', versoes: 1 },
  { id: 'd6', codigo: 'PR-PAV-003', titulo: 'Seção tipo do pavimento — eixo principal',       categoria: 'Projeto executivo', revisao: 'R01', status: 'aprovado',  contrato: 'CT-2024/0058', disciplina: 'Pavimentação',responsavel: 'Roberto Vaz', data_documento: '2024-06-25', versoes: 2 },
];

export const MOCK_NOTIFICATIONS: Notification[] = [
  { id: 'n1', title: 'Medição #06 aguardando sua revisão', body: 'Contrato CT-2024/0042 · 1 alerta de validação', link: '/contratos/c1/medicoes/m1-6', read_at: null, kind: 'measurement_pending', created_at: new Date(Date.now() - 1000 * 60 * 22).toISOString() },
  { id: 'n2', title: 'Aditivo #03 em aprovação',             body: 'Contrato CT-2024/0042 · acréscimo de R$ 400.000,00', link: '/contratos/c1/aditivos/a1-3', read_at: null, kind: 'additive_pending', created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() },
  { id: 'n3', title: 'SLA próximo do vencimento',            body: 'Passo "Fiscal do contrato" vence em 3 dias', link: '/contratos/c1/medicoes/m1-6/aprovar', read_at: null, kind: 'sla_warning', created_at: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString() },
  { id: 'n4', title: 'PDF gerado — Medição #05', body: 'Boletim disponível em /v/A1B2C3D4E5F60718', link: '/contratos/c1/medicoes/m1-5', read_at: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(), kind: 'pdf_generated', created_at: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString() },
];
