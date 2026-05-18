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

// V51: 5 contratos alinhados à narrativa V49+V50 (MOCK_PENDENCIAS + MOCK_PORTFOLIO + MOCK_TENANT_DASHBOARD)
// Substituiu o set anterior c1-c4 (Hospital São Carlos, Pavimentação RP, Creche Goiânia, DER-MG)
// que não casava com pendencias/portfolio que usam CT-2024/0107 Niterói, CT-2024/0211 Rio, etc.
// Items/measurements/additives existentes referem c1-c4 e continuam funcionais — V51 só atualiza
// metadata exibida (numero/objeto/municipio/contratante).
export const MOCK_CONTRACTS: Contract[] = [
  {
    id: 'c1', tenant_id: TENANT_ID,
    numero: 'CT-2024/0042',
    objeto: 'Construção do Hospital Regional do Estado do Rio de Janeiro — bloco cirúrgico e UTI',
    contratante_nome: 'Secretaria de Estado de Saúde — SES/RJ',
    contratada_nome: 'Construtora Alvorada Ltda.',
    municipio: 'Rio de Janeiro', uf: 'RJ',
    valor_inicial: 12_500_000, valor_aditado: 450_000,
    valor_atual: 12_950_000, valor_medido_acumulado: 7_550_000,
    valor_pago: 6_980_000, saldo_contratual: 5_400_000,
    percentual_fisico: 58, percentual_financeiro: 58.3,
    data_assinatura: '2024-03-15', data_ordem_inicio: '2024-04-01',
    regime_contratacao: 'Empreitada por preço unitário',
    modalidade_licitatoria: 'Concorrência (Lei 14.133)',
    status: 'em_execucao',
    alertas: ['Atraso físico: 65% temporal vs 58.3% executado', 'SLA de medição #07 vence em 3 dias'],
  },
  {
    id: 'c2', tenant_id: TENANT_ID,
    numero: 'CT-2024/0107',
    objeto: 'Reforma e modernização da rede municipal de escolas — Niterói (lote 1)',
    contratante_nome: 'Secretaria de Estado de Educação — SEEDUC/RJ',
    contratada_nome: 'Pavimentadora Bandeirantes S.A.',
    municipio: 'Niterói', uf: 'RJ',
    valor_inicial: 14_300_000, valor_aditado: 0,
    valor_atual: 14_300_000, valor_medido_acumulado: 4_580_000,
    valor_pago: 4_180_000, saldo_contratual: 9_720_000,
    percentual_fisico: 32, percentual_financeiro: 32,
    data_assinatura: '2024-06-10', data_ordem_inicio: '2024-07-01',
    regime_contratacao: 'Empreitada por preço unitário',
    modalidade_licitatoria: 'Concorrência (Lei 14.133)',
    status: 'em_execucao',
    alertas: ['PAR-2025/003 em fase de defesa (limite 20/11/2025)', 'Multa R$ 245.000 aplicada · vence 12/12', 'Impedimento de 6 meses aplicado em 14/11'],
  },
  {
    id: 'c3', tenant_id: TENANT_ID,
    numero: 'CT-2024/0211',
    objeto: 'Reforma e ampliação do Hospital Universitário — Bloco B (UTI e centro cirúrgico)',
    contratante_nome: 'Secretaria de Estado de Saúde — SES/RJ',
    contratada_nome: 'Engerocha Construções',
    municipio: 'Rio de Janeiro', uf: 'RJ',
    valor_inicial: 4_200_000, valor_aditado: 0,
    valor_atual: 4_200_000, valor_medido_acumulado: 3_780_000,
    valor_pago: 3_402_000, saldo_contratual: 420_000,
    percentual_fisico: 90, percentual_financeiro: 90,
    data_assinatura: '2024-04-22', data_ordem_inicio: '2024-05-15',
    regime_contratacao: 'Empreitada por preço global',
    modalidade_licitatoria: 'Concorrência (Lei 14.133)',
    status: 'em_execucao',
    alertas: ['Vício "concreto fora de fck" registrado em 02/11 · em saneamento até 02/12'],
  },
  {
    id: 'c4', tenant_id: TENANT_ID,
    numero: 'CT-2024/0298',
    objeto: 'Construção da UPA Petrópolis — fase 2 (consultas e leitos de observação)',
    contratante_nome: 'Secretaria de Estado de Saúde — SES/RJ',
    contratada_nome: 'Consulte GEO Engenharia',
    municipio: 'Petrópolis', uf: 'RJ',
    valor_inicial: 11_200_000, valor_aditado: 0,
    valor_atual: 11_200_000, valor_medido_acumulado: 4_480_000,
    valor_pago: 4_032_000, saldo_contratual: 6_720_000,
    percentual_fisico: 40, percentual_financeiro: 40,
    data_assinatura: '2024-09-30', data_ordem_inicio: '2024-11-20',
    regime_contratacao: 'Empreitada por preço unitário',
    modalidade_licitatoria: 'Concorrência (Lei 14.133)',
    status: 'em_execucao',
    alertas: ['Garantia GA-00128 vence em 6 dias (20/11/2025) · ação requerida'],
  },
  {
    id: 'c5', tenant_id: TENANT_ID,
    numero: 'CT-2024/0334',
    objeto: 'Revitalização da Praça Central de Nova Iguaçu — paisagismo e mobiliário urbano',
    contratante_nome: 'Prefeitura Municipal de Nova Iguaçu',
    contratada_nome: 'Verde Paisagismo Ltda.',
    municipio: 'Nova Iguaçu', uf: 'RJ',
    valor_inicial: 4_300_000, valor_aditado: 0,
    valor_atual: 4_300_000, valor_medido_acumulado: 3_870_000,
    valor_pago: 3_870_000, saldo_contratual: 430_000,
    percentual_fisico: 95, percentual_financeiro: 90,
    data_assinatura: '2024-05-10', data_ordem_inicio: '2024-06-01',
    regime_contratacao: 'Empreitada por preço global',
    modalidade_licitatoria: 'Pregão eletrônico (Lei 14.133)',
    status: 'em_execucao',
    alertas: ['Recebimento provisório de 15/08 sem definitivo · prazo limite (90d) ultrapassado'],
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
    { id: 'i2-1', contract_id: 'c2', codigo: '01.020', descricao: 'Demolição de revestimento cerâmico — paredes e pisos', disciplina: 'Demolição', unidade: 'm2', quantidade_contratada: 2_800, quantidade_aditada: 0, quantidade_medida_acumulada: 2_800, preco_unitario: 18.40, bdi: 22, fonte_referencia: 'SINAPI', locked: true },
    { id: 'i2-2', contract_id: 'c2', codigo: '04.015', descricao: 'Reforma de cobertura — telha cerâmica e madeiramento', disciplina: 'Cobertura', unidade: 'm2', quantidade_contratada: 4_200, quantidade_aditada: 0, quantidade_medida_acumulada: 2_100, preco_unitario: 142.80, bdi: 22, fonte_referencia: 'SINAPI', locked: false },
    { id: 'i2-3', contract_id: 'c2', codigo: '08.022', descricao: 'Pintura PVA latex — paredes internas e externas', disciplina: 'Acabamento', unidade: 'm2', quantidade_contratada: 12_400, quantidade_aditada: 0, quantidade_medida_acumulada: 0, preco_unitario: 28.50, bdi: 22, fonte_referencia: 'SINAPI', locked: false },
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
    // V54: mi-2 acumula 2 alertas (glosa + qtd_acima_25pct)
    { id: 'mi-2', measurement_id: 'm1-6', contract_item_id: 'i1-4', codigo: '07.022', descricao: 'Revestimento cerâmico 60x60', unidade: 'm2', quantidade_periodo: 230, quantidade_acumulada_antes: 230, quantidade_acumulada_incl_periodo: 460, preco_unitario_snapshot: 128.40, valor_periodo: 29_532.00, valor_glosado: 12_840.00, valor_liquido: 16_692.00, saldo_disponivel_snapshot: 520, memoria_resumo: '4 banheiros pavimento 1 + corredor', validacao_status: 'alerta', validacao_erros: [
      { rule: 'glosa_excessiva',        severity: 'alerta', message: 'Glosa de 43,5% supera 30% do período — revisar' },
      { rule: 'quantidade_acima_25pct', severity: 'alerta', message: 'Quantidade do período (230) é 30,7% do saldo disponível (750,00 m²) — revisar.' },
    ]},
    // V54: mi-3 com preco divergente da referência SINAPI (8,4% acima)
    { id: 'mi-3', measurement_id: 'm1-6', contract_item_id: 'i1-5', codigo: '12.040', descricao: 'Quadro elétrico 24 disjuntores', unidade: 'un', quantidade_periodo: 2, quantidade_acumulada_antes: 3, quantidade_acumulada_incl_periodo: 5, preco_unitario_snapshot: 4_280.00, valor_periodo: 8_560.00, valor_glosado: 0, valor_liquido: 8_560.00, saldo_disponivel_snapshot: 3, memoria_resumo: 'QDF-101 e QDF-102', validacao_status: 'alerta', validacao_erros: [
      { rule: 'preco_divergente_referencia', severity: 'alerta', message: 'Preço unitário diverge +8,4% da referência SINAPI (R$ 3.950,00).' },
    ]},
    // V54: mi-4 sem memória de cálculo
    { id: 'mi-4', measurement_id: 'm1-6', contract_item_id: 'i1-2', codigo: '02.015', descricao: 'Concreto fck=30MPa para pilares', unidade: 'm3', quantidade_periodo: 18, quantidade_acumulada_antes: 138, quantidade_acumulada_incl_periodo: 156, preco_unitario_snapshot: 845.20, valor_periodo: 15_213.60, valor_glosado: 0, valor_liquido: 15_213.60, saldo_disponivel_snapshot: 36, memoria_resumo: '', validacao_status: 'alerta', validacao_erros: [
      { rule: 'memoria_ausente', severity: 'alerta', message: 'Memória de cálculo vazia.' },
    ]},
  ],
  // V54: m2-2 (preliminar) com 1 item BLOQUEADO — demonstra bloqueio do submit
  'm2-2': [
    { id: 'mi-c2-1', measurement_id: 'm2-2', contract_item_id: 'i2-2', codigo: '04.015', descricao: 'Reforma de cobertura — telha cerâmica e madeiramento', unidade: 'm2', quantidade_periodo: 2_200, quantidade_acumulada_antes: 2_100, quantidade_acumulada_incl_periodo: 4_300, preco_unitario_snapshot: 142.80, valor_periodo: 314_160.00, valor_glosado: 0, valor_liquido: 314_160.00, saldo_disponivel_snapshot: -100, memoria_resumo: 'Bloco A + bloco B', validacao_status: 'bloqueado', validacao_erros: [
      { rule: 'saldo', severity: 'bloqueado', message: 'Quantidade ultrapassa saldo contratual (contratada+aditada=4.200, acumulado previsto=4.300).' },
    ]},
    { id: 'mi-c2-2', measurement_id: 'm2-2', contract_item_id: 'i2-3', codigo: '08.022', descricao: 'Pintura PVA latex — paredes internas e externas', unidade: 'm2', quantidade_periodo: 2_500, quantidade_acumulada_antes: 0, quantidade_acumulada_incl_periodo: 2_500, preco_unitario_snapshot: 28.50, valor_periodo: 71_250.00, valor_glosado: 0, valor_liquido: 71_250.00, saldo_disponivel_snapshot: 9_900, memoria_resumo: 'Pintura geral pavimento térreo', validacao_status: 'ok', validacao_erros: [] },
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
  { id: 'd6', codigo: 'PR-PAV-003', titulo: 'Sondagem de solo — terreno escola CIEP Niterói',       categoria: 'Projeto executivo', revisao: 'R01', status: 'aprovado',  contrato: 'CT-2024/0107', disciplina: 'Fundações',responsavel: 'Roberto Vaz', data_documento: '2024-06-25', versoes: 2 },
];

export const MOCK_NOTIFICATIONS: Notification[] = [
  { id: 'n1', title: 'Medição #06 aguardando sua revisão', body: 'Contrato CT-2024/0042 · 1 alerta de validação', link: '/contratos/c1/medicoes/m1-6', read_at: null, kind: 'measurement_pending', created_at: new Date(Date.now() - 1000 * 60 * 22).toISOString() },
  { id: 'n2', title: 'Aditivo #03 em aprovação',             body: 'Contrato CT-2024/0042 · acréscimo de R$ 400.000,00', link: '/contratos/c1/aditivos/a1-3', read_at: null, kind: 'additive_pending', created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() },
  { id: 'n3', title: 'SLA próximo do vencimento',            body: 'Passo "Fiscal do contrato" vence em 3 dias', link: '/contratos/c1/medicoes/m1-6/aprovar', read_at: null, kind: 'sla_warning', created_at: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString() },
  // V65 — workflow GED aguardando aprovação (V60 ativado)
  { id: 'n5', title: 'Revisão GED aguardando sua aprovação', body: 'Planta arquitetônica — pavimento 2 · revisão 3 · etapa "Aprovação final · Coordenação"', link: '/ged/documentos/doc-1/aprovar', read_at: null, kind: 'workflow_assignment', created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
  { id: 'n4', title: 'PDF gerado — Medição #05', body: 'Boletim disponível em /v/A1B2C3D4E5F60718', link: '/contratos/c1/medicoes/m1-5', read_at: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(), kind: 'pdf_generated', created_at: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString() },
];
