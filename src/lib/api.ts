import { supabase, hasSupabase, SKIP_AUTH } from './supabase';
import { humanizeError } from './errors';
import {
  MOCK_CONTRACTS, MOCK_ITEMS, MOCK_MEASUREMENTS, MOCK_MITEMS,
  MOCK_ADDITIVES, MOCK_DOCS, MOCK_NOTIFICATIONS,
} from './mockData';
import type {
  Contract, Item, Measurement, MItem, Additive, Doc, Notification,
} from './types';

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

function fail(error: unknown): void {
  if (error) throw new Error(humanizeError(error));
}

// =============================================================================
// NORMALIZERS — convertem rows do Postgres em objetos consistentes
// =============================================================================
function normalizeContract(c: any): Contract {
  const valorAtual = n(c.valor_atual ?? c.valor_total_atual ?? (n(c.valor_inicial) + n(c.valor_aditado)));
  const medido = n(c.valor_medido_acumulado);
  return {
    id: c.id || c.contract_id,
    tenant_id: c.tenant_id,
    numero: c.numero || '',
    objeto: c.objeto || '',
    contratante_nome: c.contratante_nome || c.contratante?.nome || c.orgao?.nome || '',
    contratada_nome:  c.contratada_nome  || c.contratada?.nome  || '',
    municipio: c.municipio || c.contract_lots?.[0]?.municipio || '',
    uf:        c.uf        || c.contract_lots?.[0]?.uf        || '',
    valor_inicial: n(c.valor_inicial),
    valor_aditado: n(c.valor_aditado),
    valor_atual:   valorAtual,
    valor_medido_acumulado: medido,
    valor_pago: n(c.valor_pago),
    saldo_contratual: n(c.saldo_contratual ?? (valorAtual - medido)),
    percentual_fisico:    n(c.percentual_fisico),
    percentual_financeiro: n(c.percentual_financeiro ?? (valorAtual ? (medido / valorAtual) * 100 : 0)),
    data_assinatura:   c.data_assinatura   || '',
    data_ordem_inicio: c.data_ordem_inicio || '',
    regime_contratacao:    c.regime_contratacao    || '',
    modalidade_licitatoria: c.modalidade_licitatoria || '',
    status: c.status || 'rascunho',
    alertas: Array.isArray(c.alertas) ? c.alertas.filter(Boolean) : [],
  };
}

function normalizeItem(i: any): Item {
  return {
    id: i.id,
    contract_id: i.contract_id,
    codigo: i.codigo || '',
    descricao: i.descricao || '',
    disciplina: i.disciplina || i.disciplines?.nome || '',
    unidade:    i.unidade    || '',
    quantidade_contratada:      n(i.quantidade_contratada),
    quantidade_aditada:         n(i.quantidade_aditada),
    quantidade_medida_acumulada: n(i.quantidade_medida_acumulada),
    preco_unitario: n(i.preco_unitario),
    bdi: n(i.bdi ?? i.bdi_percentual),
    fonte_referencia: i.fonte_referencia || 'proprio',
    locked: !!i.locked,
  };
}

function normalizeMItem(i: any): MItem {
  const ci = i.contract_items || {};
  return {
    id: i.id,
    measurement_id: i.measurement_id,
    contract_item_id: i.contract_item_id,
    codigo: i.codigo || ci.codigo || '',
    descricao: i.descricao || ci.descricao || '',
    unidade:  i.unidade  || ci.unidade  || '',
    quantidade_periodo:                n(i.quantidade_periodo),
    quantidade_acumulada_antes:        n(i.quantidade_acumulada_antes),
    quantidade_acumulada_incl_periodo: n(i.quantidade_acumulada_incl_periodo),
    preco_unitario_snapshot:           n(i.preco_unitario_snapshot),
    valor_periodo:  n(i.valor_periodo),
    valor_glosado:  n(i.valor_glosado),
    valor_liquido:  n(i.valor_liquido),
    saldo_disponivel_snapshot: n(i.saldo_disponivel_snapshot),
    memoria_resumo: i.memoria_resumo || '',
    validacao_status: i.validacao_status || 'pendente',
    validacao_erros: Array.isArray(i.validacao_erros) ? i.validacao_erros : [],
  };
}

function normalizeAdditive(a: any): Additive {
  return {
    id: a.id,
    contract_id: a.contract_id,
    numero: n(a.numero),
    tipo: a.tipo || '',
    status: a.status || 'rascunho',
    valor_acrescimo:  n(a.valor_acrescimo ?? a.valor_liquido),
    valor_decrescimo: n(a.valor_decrescimo),
    prazo_execucao_dias: n(a.prazo_execucao_dias ?? a.prazo_execucao_acrescimo_dias),
    data_solicitacao: a.data_solicitacao || a.created_at || '',
    justificativa: a.justificativa || a.justificativa_valor || '',
  };
}

function normalizeDoc(d: any): Doc {
  return {
    id: d.id,
    codigo: d.codigo || d.nomenclature_code || d.numero || '',
    titulo: d.titulo || d.title || '',
    categoria: d.categoria || d.ged_categories?.nome || '',
    revisao:   d.revisao   || d.revisao_atual || '',
    status: d.status || '',
    contrato: d.contrato || d.contracts?.numero || '',
    disciplina: d.disciplina || d.disciplines?.nome || '',
    responsavel: d.responsavel || d.members?.nome || '',
    data_documento: d.data_documento || '',
    versoes: n(d.versoes),
  };
}

// =============================================================================
// CHAMADAS PÚBLICAS — apoiadas em views + fallback em tabelas
// =============================================================================
function checkSupabase() {
  if (SKIP_AUTH) return; // modo demo — usa mocks
  if (!hasSupabase) {
    throw new Error(
      'Supabase não configurado. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.local.',
    );
  }
}

export async function listContracts(): Promise<Contract[]> {
  if (SKIP_AUTH) return MOCK_CONTRACTS;
  checkSupabase();
  let r = await supabase.from('v_contract_dashboard').select('*');
  if (r.error) {
    r = await supabase
      .from('contracts')
      .select('*, contract_lots(municipio,uf), contratante:contract_organizations!contracts_contratante_id_fkey(nome), contratada:contract_organizations!contracts_contratada_id_fkey(nome)')
      .is('deleted_at', null);
  }
  fail(r.error);
  return (r.data || []).map(normalizeContract);
}

export async function getContract(id: string): Promise<Contract | null> {
  if (SKIP_AUTH) return MOCK_CONTRACTS.find((c) => c.id === id) || null;
  checkSupabase();
  let r = await supabase.from('v_contract_dashboard').select('*').eq('id', id).maybeSingle();
  if (r.error || !r.data) {
    r = await supabase
      .from('contracts')
      .select('*, contract_lots(municipio,uf), contratante:contract_organizations!contracts_contratante_id_fkey(nome), contratada:contract_organizations!contracts_contratada_id_fkey(nome)')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
  }
  fail(r.error);
  return r.data ? normalizeContract(r.data) : null;
}

export async function listItems(contractId: string): Promise<Item[]> {
  if (SKIP_AUTH) return MOCK_ITEMS[contractId] || [];
  checkSupabase();
  let r = await supabase
    .from('v_contract_items_balance')
    .select('*')
    .eq('contract_id', contractId)
    .order('codigo');
  if (r.error) {
    r = await supabase
      .from('contract_items')
      .select('*, disciplines(nome)')
      .eq('contract_id', contractId)
      .is('deleted_at', null)
      .order('codigo');
  }
  fail(r.error);
  return (r.data || []).map(normalizeItem);
}

export async function listMeasurements(contractId: string): Promise<Measurement[]> {
  if (SKIP_AUTH) return MOCK_MEASUREMENTS[contractId] || [];
  checkSupabase();
  const r = await supabase
    .from('measurements')
    .select('*')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
    .order('numero', { ascending: false });
  fail(r.error);
  return (r.data || []) as Measurement[];
}

export async function getMeasurement(id: string): Promise<Measurement | null> {
  if (SKIP_AUTH) {
    for (const arr of Object.values(MOCK_MEASUREMENTS)) {
      const m = arr.find((x) => x.id === id);
      if (m) return m;
    }
    return null;
  }
  checkSupabase();
  const r = await supabase.from('measurements').select('*').eq('id', id).maybeSingle();
  fail(r.error);
  return (r.data || null) as Measurement | null;
}

export async function listMItems(measurementId: string): Promise<MItem[]> {
  if (SKIP_AUTH) return MOCK_MITEMS[measurementId] || [];
  checkSupabase();
  let r = await supabase
    .from('v_measurement_items_detail')
    .select('*')
    .eq('measurement_id', measurementId);
  if (r.error) {
    r = await supabase
      .from('measurement_items')
      .select('*, contract_items(codigo,descricao,unidade)')
      .eq('measurement_id', measurementId)
      .is('deleted_at', null);
  }
  fail(r.error);
  return (r.data || []).map(normalizeMItem);
}

export async function listAdditives(contractId: string): Promise<Additive[]> {
  if (SKIP_AUTH) return MOCK_ADDITIVES[contractId] || [];
  checkSupabase();
  const r = await supabase
    .from('additives')
    .select('*')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
    .order('numero', { ascending: false });
  fail(r.error);
  return (r.data || []).map(normalizeAdditive);
}

export async function listDocs(): Promise<Doc[]> {
  if (SKIP_AUTH) return MOCK_DOCS;
  checkSupabase();
  let r = await supabase.from('v_ged_documents').select('*').limit(500);
  if (r.error) {
    r = await supabase
      .from('ged_documents')
      .select('*, ged_categories(nome), contracts(numero), disciplines(nome), members(nome)')
      .is('deleted_at', null)
      .limit(500);
  }
  fail(r.error);
  return (r.data || []).map(normalizeDoc);
}

export async function listNotifications(): Promise<Notification[]> {
  if (SKIP_AUTH) return MOCK_NOTIFICATIONS;
  checkSupabase();
  const r = await supabase
    .from('notifications')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100);
  fail(r.error);
  return (r.data || []) as Notification[];
}

export async function markNotificationRead(id: string): Promise<void> {
  if (SKIP_AUTH) return; // demo: ignora
  checkSupabase();
  const { error } = await supabase.rpc('mark_notification_read', { p_id: id });
  fail(error);
}

export async function markAllNotificationsRead(): Promise<void> {
  if (SKIP_AUTH) return; // demo: ignora
  checkSupabase();
  const { error } = await supabase.rpc('mark_all_notifications_read');
  fail(error);
}

/**
 * Invoca uma Edge Function por nome (kebab-case).
 */
export async function callFn<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
  if (SKIP_AUTH) {
    // eslint-disable-next-line no-console
    console.info(`[demo] callFn("${name}") ignorado em modo demo`, body);
    return { ok: true, demo: true } as unknown as T;
  }
  checkSupabase();
  const { data, error } = await supabase.functions.invoke(name, { body });
  fail(error);
  return data as T;
}

// =============================================================================
// CRUD: contratos, obras/lotes, partes, organizações
// =============================================================================

export interface ContractInput {
  numero: string;
  objeto: string;
  contratante_id?: string | null;
  contratada_id?: string | null;
  gerenciadora_id?: string | null;
  valor_inicial: number;
  data_assinatura?: string | null;
  data_ordem_inicio?: string | null;
  prazo_execucao_dias?: number | null;
  prazo_vigencia_dias?: number | null;
  regime_contratacao?: string | null;
  modalidade_licitatoria?: string | null;
  lei_referencia?: string | null;
  processo_administrativo?: string | null;
  dotacao_orcamentaria?: string | null;
  fonte_recurso?: string | null;
  garantia_percentual?: number | null;
  retencao_padrao_percentual?: number | null;
  periodicidade_medicao?: string | null;
  status?: string | null;
}

export async function createContract(input: ContractInput): Promise<string> {
  if (SKIP_AUTH) {
    // eslint-disable-next-line no-console
    console.info('[demo] createContract — não persiste em modo demo', input);
    return 'demo-' + Math.random().toString(36).slice(2, 10);
  }
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  if (!tenantId) throw new Error('Tenant ativo não localizado. Faça login novamente.');
  const { data, error } = await supabase
    .from('contracts')
    .insert({ ...input, tenant_id: tenantId })
    .select('id')
    .single();
  fail(error);
  return data!.id as string;
}

export async function updateContract(id: string, input: Partial<ContractInput>): Promise<void> {
  if (SKIP_AUTH) {
    console.info('[demo] updateContract', id, input);
    return;
  }
  checkSupabase();
  const { error } = await supabase.from('contracts').update(input).eq('id', id);
  fail(error);
}

export async function listOrganizations(tipo?: string): Promise<Array<{ id: string; nome: string; cnpj: string | null; tipo: string }>> {
  if (SKIP_AUTH) {
    return [
      { id: 'org-1', nome: 'Secretaria de Estado da Saúde', cnpj: '12.345.678/0001-90', tipo: 'orgao' },
      { id: 'org-2', nome: 'Prefeitura Municipal de Ribeirão Preto', cnpj: '00.000.000/0001-11', tipo: 'contratante' },
      { id: 'org-3', nome: 'Construtora Alvorada Ltda.', cnpj: '98.765.432/0001-10', tipo: 'contratada' },
      { id: 'org-4', nome: 'Pavimentadora Bandeirantes S.A.', cnpj: '11.222.333/0001-44', tipo: 'contratada' },
      { id: 'org-5', nome: 'Consulte GEO Engenharia', cnpj: '22.333.444/0001-55', tipo: 'gerenciadora' },
    ].filter((o) => !tipo || o.tipo === tipo);
  }
  checkSupabase();
  let q = supabase.from('contract_organizations').select('id,nome,cnpj,tipo').is('deleted_at', null).order('nome');
  if (tipo) q = q.eq('tipo', tipo);
  const r = await q;
  fail(r.error);
  return (r.data || []) as Array<{ id: string; nome: string; cnpj: string | null; tipo: string }>;
}

export async function createOrganization(input: { nome: string; cnpj?: string | null; tipo: string; email?: string | null; telefone?: string | null }): Promise<string> {
  if (SKIP_AUTH) return 'org-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const { data, error } = await supabase
    .from('contract_organizations')
    .insert({ ...input, tenant_id: tenantId })
    .select('id')
    .single();
  fail(error);
  return data!.id as string;
}

// ---- Obras / lotes -----------------------------------------------------------
export interface Lot {
  id: string;
  contract_id: string;
  nome: string;
  codigo: string | null;
  municipio: string | null;
  uf: string | null;
  endereco: string | null;
  latitude: number | null;
  longitude: number | null;
  valor_obra: number;
  prazo_dias: number | null;
  crea_responsavel: string | null;
  status: string;
}

export async function listLots(contractId: string): Promise<Lot[]> {
  if (SKIP_AUTH) {
    return [
      { id: 'l-c1-1', contract_id: 'c1', nome: 'Bloco cirúrgico — pavimento 1',  codigo: 'BC-P1', municipio: 'São Carlos', uf: 'SP', endereco: 'Av. Trabalhador São-Carlense, 400', latitude: -22.0087, longitude: -47.8901, valor_obra: 8_200_000, prazo_dias: 240, crea_responsavel: '123.456-7/SP', status: 'ativo' },
      { id: 'l-c1-2', contract_id: 'c1', nome: 'Bloco cirúrgico — pavimento 2',  codigo: 'BC-P2', municipio: 'São Carlos', uf: 'SP', endereco: 'Av. Trabalhador São-Carlense, 400', latitude: -22.0087, longitude: -47.8901, valor_obra: 5_440_000, prazo_dias: 180, crea_responsavel: '123.456-7/SP', status: 'ativo' },
    ].filter((l) => l.contract_id === contractId);
  }
  checkSupabase();
  const r = await supabase
    .from('contract_lots').select('*').eq('contract_id', contractId).is('deleted_at', null).order('created_at');
  fail(r.error);
  return (r.data || []) as Lot[];
}

export async function createLot(input: Omit<Lot, 'id'> & { tenant_id?: string }): Promise<string> {
  if (SKIP_AUTH) return 'lot-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const { data, error } = await supabase
    .from('contract_lots').insert({ ...input, tenant_id: tenantId }).select('id').single();
  fail(error);
  return data!.id as string;
}

export async function updateLot(id: string, input: Partial<Lot>): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase.from('contract_lots').update(input).eq('id', id);
  fail(error);
}

export async function deleteLot(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase
    .from('contract_lots').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

// ---- Partes contratuais ------------------------------------------------------
export interface ContractMember {
  id: string;
  contract_id: string;
  member_id: string;
  papel: string;
  can_approve: boolean;
  can_measure: boolean;
  can_view_financial: boolean;
  active: boolean;
  members?: { nome: string; email: string; cargo: string | null };
}

export async function listContractMembers(contractId: string): Promise<ContractMember[]> {
  if (SKIP_AUTH) {
    return [
      { id: 'cm-1', contract_id: 'c1', member_id: 'm-fiscal', papel: 'fiscal_contrato', can_approve: true,  can_measure: false, can_view_financial: true,  active: true, members: { nome: 'Ricardo Mendes',  email: 'ricardo@consultegeo.org', cargo: 'Fiscal do contrato' } },
      { id: 'cm-2', contract_id: 'c1', member_id: 'm-campo',  papel: 'fiscal_campo',    can_approve: false, can_measure: true,  can_view_financial: false, active: true, members: { nome: 'Patrícia Lopes',  email: 'patricia@consultegeo.org', cargo: 'Fiscal de campo' } },
      { id: 'cm-3', contract_id: 'c1', member_id: 'm-gest',   papel: 'gestor_contrato', can_approve: true,  can_measure: false, can_view_financial: true,  active: true, members: { nome: 'Eduardo Vargas', email: 'eduardo@consultegeo.org', cargo: 'Gestor do contrato' } },
      { id: 'cm-4', contract_id: 'c1', member_id: 'm-empre',  papel: 'contratada',      can_approve: false, can_measure: true,  can_view_financial: false, active: true, members: { nome: 'Alvorada Engenharia', email: 'fiscal@alvorada.com.br', cargo: 'Responsável técnico' } },
    ].filter((m) => m.contract_id === contractId);
  }
  checkSupabase();
  const r = await supabase
    .from('contract_members')
    .select('*, members(nome,email,cargo)')
    .eq('contract_id', contractId)
    .is('deleted_at', null);
  fail(r.error);
  return (r.data || []) as ContractMember[];
}

export async function listAvailableMembers(): Promise<Array<{ id: string; nome: string; email: string; cargo: string | null }>> {
  if (SKIP_AUTH) {
    return [
      { id: 'm-fiscal', nome: 'Ricardo Mendes',  email: 'ricardo@consultegeo.org',  cargo: 'Fiscal do contrato' },
      { id: 'm-campo',  nome: 'Patrícia Lopes',  email: 'patricia@consultegeo.org', cargo: 'Fiscal de campo' },
      { id: 'm-gest',   nome: 'Eduardo Vargas',  email: 'eduardo@consultegeo.org',  cargo: 'Gestor do contrato' },
      { id: 'm-empre',  nome: 'Alvorada Engenharia', email: 'fiscal@alvorada.com.br', cargo: 'Responsável técnico' },
      { id: 'm-fin',    nome: 'Janaína Cruz',    email: 'janaina@consultegeo.org',  cargo: 'Financeiro' },
      { id: 'm-aud',    nome: 'Auditor Externo', email: 'auditor@orgao.gov.br',     cargo: 'Auditor' },
    ];
  }
  checkSupabase();
  const r = await supabase
    .from('members').select('id,nome,email,cargo')
    .eq('active', true).is('deleted_at', null).order('nome');
  fail(r.error);
  return (r.data || []) as Array<{ id: string; nome: string; email: string; cargo: string | null }>;
}

export async function addContractMember(input: {
  contract_id: string; member_id: string; papel: string;
  can_approve?: boolean; can_measure?: boolean; can_view_financial?: boolean;
}): Promise<string> {
  if (SKIP_AUTH) return 'cm-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const { data, error } = await supabase
    .from('contract_members').insert({ ...input, tenant_id: tenantId }).select('id').single();
  fail(error);
  return data!.id as string;
}

export async function removeContractMember(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase
    .from('contract_members').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

// =============================================================================
// PLANILHA SOV — versões + criação de itens em lote + hierarquia
// =============================================================================

export interface SovVersion {
  id: string;
  contract_id: string;
  versao: number;
  status: string;
  motivo_alteracao: string | null;
  ativa: boolean;
  created_at: string;
}

export async function getActiveSovVersionId(contractId: string): Promise<string | null> {
  if (SKIP_AUTH) return 'sv-c1-2';
  checkSupabase();
  const r = await supabase
    .from('sov_versions')
    .select('id')
    .eq('contract_id', contractId)
    .eq('status', 'vigente')
    .is('deleted_at', null)
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle();
  fail(r.error);
  return (r.data?.id as string) || null;
}

/** Cria uma nova SOV version (desativa as anteriores). */
export async function createSovVersion(contractId: string, motivo: string): Promise<string> {
  if (SKIP_AUTH) return 'sv-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;

  // Conta versão atual
  const { data: versions } = await supabase
    .from('sov_versions').select('versao').eq('contract_id', contractId).order('versao', { ascending: false }).limit(1);
  const nextVersion = (versions?.[0]?.versao || 0) + 1;

  // Desativa anteriores
  await supabase.from('sov_versions').update({ ativa: false }).eq('contract_id', contractId);

  const { data, error } = await supabase
    .from('sov_versions')
    .insert({ tenant_id: tenantId, contract_id: contractId, versao: nextVersion, motivo_alteracao: motivo, ativa: true, status: 'vigente' })
    .select('id').single();
  fail(error);
  return data!.id as string;
}

/** Insere itens em lote (já normalizados) numa versão SOV. */
export async function bulkInsertContractItems(
  sovVersionId: string,
  contractId: string,
  items: Array<{
    codigo: string; descricao: string; unidade: string;
    quantidade_contratada: number; preco_unitario: number;
    bdi_percentual?: number; fonte_referencia?: string;
    nivel: number; ordem?: number; is_title?: boolean;
    discipline_id?: string | null;
  }>,
): Promise<number> {
  if (SKIP_AUTH) {
    // eslint-disable-next-line no-console
    console.info(`[demo] bulkInsertContractItems → ${items.length} itens em ${sovVersionId}`);
    return items.length;
  }
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const payload = items.map((it, i) => ({
    tenant_id: tenantId, contract_id: contractId, sov_version_id: sovVersionId,
    codigo: it.codigo, descricao: it.descricao, unidade: it.unidade || null,
    quantidade_contratada: it.quantidade_contratada,
    preco_unitario: it.preco_unitario,
    bdi_percentual: it.bdi_percentual ?? 0,
    fonte_referencia: it.fonte_referencia || 'proprio',
    nivel: it.nivel, ordem: it.ordem ?? i,
    is_title: it.is_title || false,
    discipline_id: it.discipline_id || null,
  }));
  const { error } = await supabase.from('contract_items').insert(payload);
  fail(error);
  return items.length;
}

// =============================================================================
// MEMÓRIA DE CÁLCULO + EVIDÊNCIAS
// =============================================================================

export interface CalcLine {
  id: string;
  measurement_item_id: string;
  local: string;
  metodo: string;
  formula: string;
  variaveis: Record<string, number>;
  quantidade_calculada: number;
  observacao: string | null;
}

export async function listCalcLines(measurementItemId: string): Promise<CalcLine[]> {
  if (SKIP_AUTH) {
    const map: Record<string, CalcLine[]> = {
      'mi-1': [
        { id: 'cl-1', measurement_item_id: 'mi-1', local: 'Bloco cirúrgico — pavimento 1', metodo: 'geométrico', formula: 'comprimento × altura', variaveis: { comprimento: 33, altura: 6 }, quantidade_calculada: 198, observacao: 'Eixos A-D, parede externa' },
        { id: 'cl-2', measurement_item_id: 'mi-1', local: 'Bloco cirúrgico — pavimento 2', metodo: 'geométrico', formula: 'comprimento × altura', variaveis: { comprimento: 19, altura: 6 }, quantidade_calculada: 114, observacao: 'Eixos A-B, lado norte' },
      ],
    };
    return map[measurementItemId] || [];
  }
  checkSupabase();
  const r = await supabase
    .from('measurement_calc_lines').select('*').eq('measurement_item_id', measurementItemId).is('deleted_at', null).order('created_at');
  fail(r.error);
  return (r.data || []).map((d: any) => ({
    ...d,
    variaveis: typeof d.variaveis === 'string' ? JSON.parse(d.variaveis) : (d.variaveis || {}),
  }));
}

export async function upsertCalcLine(input: Omit<CalcLine, 'id'> & { id?: string }): Promise<string> {
  if (SKIP_AUTH) return input.id || 'cl-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const row = { ...input, tenant_id: tenantId };
  if (input.id) {
    const { error } = await supabase.from('measurement_calc_lines').update(row).eq('id', input.id);
    fail(error);
    return input.id;
  }
  const { data, error } = await supabase.from('measurement_calc_lines').insert(row).select('id').single();
  fail(error);
  return data!.id as string;
}

export async function deleteCalcLine(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase
    .from('measurement_calc_lines').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

// ---- Evidências (fotos/croquis/documentos) -----------------------------------
export interface Evidence {
  id: string;
  measurement_item_id: string | null;
  measurement_id: string;
  tipo: string;
  nome_arquivo: string;
  storage_path: string;
  mime_type: string | null;
  tamanho_bytes: number | null;
  latitude: number | null;
  longitude: number | null;
  taken_at: string | null;
  observacao: string | null;
  created_at: string;
}

export async function listEvidences(measurementItemId: string): Promise<Evidence[]> {
  if (SKIP_AUTH) {
    return [];
  }
  checkSupabase();
  const r = await supabase
    .from('measurement_evidences').select('*').eq('measurement_item_id', measurementItemId).is('deleted_at', null).order('created_at', { ascending: false });
  fail(r.error);
  return (r.data || []) as Evidence[];
}

export async function uploadEvidence(input: {
  measurement_id: string;
  measurement_item_id: string;
  file: File;
  observacao?: string;
  latitude?: number; longitude?: number; taken_at?: string;
}): Promise<string> {
  if (SKIP_AUTH) {
    console.info('[demo] uploadEvidence', input.file.name);
    return 'ev-' + Math.random().toString(36).slice(2, 10);
  }
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const ext = input.file.name.split('.').pop() || 'bin';
  const path = `tenants/${tenantId}/measurements/${input.measurement_id}/items/${input.measurement_item_id}/${Date.now()}.${ext}`;
  const up = await supabase.storage.from('evidences').upload(path, input.file, {
    contentType: input.file.type, upsert: false,
  });
  if (up.error) throw new Error(up.error.message);

  const { data, error } = await supabase.from('measurement_evidences').insert({
    tenant_id: tenantId,
    measurement_id: input.measurement_id,
    measurement_item_id: input.measurement_item_id,
    tipo: input.file.type.startsWith('image/') ? 'foto' : 'documento',
    nome_arquivo: input.file.name,
    storage_path: path,
    mime_type: input.file.type,
    tamanho_bytes: input.file.size,
    latitude: input.latitude || null,
    longitude: input.longitude || null,
    taken_at: input.taken_at || null,
    observacao: input.observacao || null,
  }).select('id').single();
  fail(error);
  return data!.id as string;
}

export async function deleteEvidence(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase
    .from('measurement_evidences').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

/** URL assinada de evidência para preview/download. */
export async function getEvidenceUrl(storagePath: string): Promise<string | null> {
  if (SKIP_AUTH) return null;
  checkSupabase();
  const { data } = await supabase.storage.from('evidences').createSignedUrl(storagePath, 600);
  return data?.signedUrl || null;
}

// =============================================================================
// MODELO DE 5 OBJETOS — itens não previstos + aditivos
// =============================================================================

export const UNFORESEEN_STATUS_FLOW = [
  'levantamento', 'analise_tecnica', 'analise_preco',
  'aprovacao_consorcio', 'aprovacao_orgao', 'aprovado',
] as const;

export type UnforeseenStatus = typeof UNFORESEEN_STATUS_FLOW[number] | 'aditado' | 'recusado' | 'cancelado';

export interface UnforeseenItem {
  id: string;
  contract_id: string;
  lot_id: string | null;
  discipline_id: string | null;
  origin_id: string | null;
  numero: number;
  descricao: string;
  justificativa: string;
  status: UnforeseenStatus;
  valor_estimado: number;
  prazo_impacto_dias: number;
  data_abertura: string;
  approved_at: string | null;
  unforeseen_item_origins?: { nome: string };
  disciplines?: { nome: string };
}

export interface UnforeseenComponent {
  id: string;
  unforeseen_item_id: string;
  contract_item_id: string | null;
  tipo: 'acrescimo' | 'decrescimo' | 'extra_novo' | 'titulo';
  codigo: string | null;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  preco_unitario: number;
  valor_total: number;
  fonte_referencia: string | null;
  codigo_referencia: string | null;
  composicao: Record<string, unknown>;
}

export interface UnforeseenOrigin {
  id: string;
  nome: string;
  descricao: string | null;
  active: boolean;
}

// ---- Mocks demo --------------------------------------------------------------
const MOCK_ORIGINS: UnforeseenOrigin[] = [
  { id: 'or-1', nome: 'Deficiência de projeto', descricao: 'Projeto original incompleto', active: true },
  { id: 'or-2', nome: 'Solicitação do contratante', descricao: 'Alteração solicitada pelo órgão', active: true },
  { id: 'or-3', nome: 'Condição de campo imprevista', descricao: null, active: true },
  { id: 'or-4', nome: 'Mudança normativa', descricao: 'Nova norma aplicável', active: true },
  { id: 'or-5', nome: 'Caso fortuito ou força maior', descricao: null, active: true },
];

const MOCK_UNFORESEEN: Record<string, UnforeseenItem[]> = {
  c1: [
    {
      id: 'unf-c1-1', contract_id: 'c1', lot_id: 'l-c1-1', discipline_id: null, origin_id: 'or-3',
      numero: 1, descricao: 'Reforço estrutural em pilares P12 a P18',
      justificativa: 'Sondagem complementar identificou solo abaixo da resistência projetada.',
      status: 'aprovado', valor_estimado: 840_000, prazo_impacto_dias: 30,
      data_abertura: '2025-07-22', approved_at: '2025-08-10T14:00:00Z',
      unforeseen_item_origins: { nome: 'Condição de campo imprevista' },
    },
    {
      id: 'unf-c1-2', contract_id: 'c1', lot_id: 'l-c1-2', discipline_id: null, origin_id: 'or-1',
      numero: 2, descricao: 'Sistema de gases medicinais não previsto',
      justificativa: 'Projeto original não contemplou rede de gases para sala de recuperação 2.',
      status: 'analise_preco', valor_estimado: 400_000, prazo_impacto_dias: 0,
      data_abertura: '2025-10-01', approved_at: null,
      unforeseen_item_origins: { nome: 'Deficiência de projeto' },
    },
    {
      id: 'unf-c1-3', contract_id: 'c1', lot_id: null, discipline_id: null, origin_id: 'or-2',
      numero: 3, descricao: 'Aumento da área de circulação no pavimento 2',
      justificativa: 'Pedido formal da Vigilância Sanitária estadual.',
      status: 'levantamento', valor_estimado: 120_000, prazo_impacto_dias: 0,
      data_abertura: '2025-10-30', approved_at: null,
      unforeseen_item_origins: { nome: 'Solicitação do contratante' },
    },
  ],
};

const MOCK_COMPONENTS: Record<string, UnforeseenComponent[]> = {
  'unf-c1-1': [
    { id: 'cmp-1', unforeseen_item_id: 'unf-c1-1', contract_item_id: 'i1-2', tipo: 'acrescimo',
      codigo: '02.015', descricao: 'Concreto fck=30MPa — adicional pilares',
      unidade: 'm3', quantidade: 35, preco_unitario: 845.20, valor_total: 29_582,
      fonte_referencia: 'SINAPI', codigo_referencia: '92479', composicao: {} },
    { id: 'cmp-2', unforeseen_item_id: 'unf-c1-1', contract_item_id: null, tipo: 'extra_novo',
      codigo: 'EX-001', descricao: 'Microestaca raiz Ø 250 mm',
      unidade: 'm', quantidade: 480, preco_unitario: 685.50, valor_total: 329_040,
      fonte_referencia: 'SINAPI', codigo_referencia: '95877', composicao: {} },
  ],
  'unf-c1-2': [
    { id: 'cmp-3', unforeseen_item_id: 'unf-c1-2', contract_item_id: null, tipo: 'extra_novo',
      codigo: 'EX-002', descricao: 'Rede de gases medicinais — oxigênio, ar comprimido, vácuo',
      unidade: 'pt', quantidade: 24, preco_unitario: 16_500, valor_total: 396_000,
      fonte_referencia: 'proprio', codigo_referencia: null, composicao: { mao_de_obra: 0.35, material: 0.5, encargos: 0.15 } },
  ],
};

// ---- Listagens ---------------------------------------------------------------
export async function listUnforeseenOrigins(): Promise<UnforeseenOrigin[]> {
  if (SKIP_AUTH) return MOCK_ORIGINS;
  checkSupabase();
  const r = await supabase
    .from('unforeseen_item_origins').select('*').eq('active', true).is('deleted_at', null).order('nome');
  fail(r.error);
  return (r.data || []) as UnforeseenOrigin[];
}

export async function listUnforeseenItems(contractId: string): Promise<UnforeseenItem[]> {
  if (SKIP_AUTH) return MOCK_UNFORESEEN[contractId] || [];
  checkSupabase();
  const r = await supabase
    .from('unforeseen_items')
    .select('*, unforeseen_item_origins(nome), disciplines(nome)')
    .eq('contract_id', contractId).is('deleted_at', null).order('numero', { ascending: false });
  fail(r.error);
  return (r.data || []) as UnforeseenItem[];
}

export async function getUnforeseenItem(id: string): Promise<UnforeseenItem | null> {
  if (SKIP_AUTH) {
    for (const arr of Object.values(MOCK_UNFORESEEN)) {
      const u = arr.find((x) => x.id === id);
      if (u) return u;
    }
    return null;
  }
  checkSupabase();
  const r = await supabase
    .from('unforeseen_items')
    .select('*, unforeseen_item_origins(nome), disciplines(nome)')
    .eq('id', id).maybeSingle();
  fail(r.error);
  return r.data as UnforeseenItem | null;
}

export async function listUnforeseenComponents(unforeseenItemId: string): Promise<UnforeseenComponent[]> {
  if (SKIP_AUTH) return MOCK_COMPONENTS[unforeseenItemId] || [];
  checkSupabase();
  const r = await supabase
    .from('unforeseen_item_components')
    .select('*').eq('unforeseen_item_id', unforeseenItemId).is('deleted_at', null).order('created_at');
  fail(r.error);
  return (r.data || []) as UnforeseenComponent[];
}

// ---- Mutations (modelo de 5 objetos) ----------------------------------------

/** OBJETO 1: criar solicitação. */
export async function createUnforeseenItem(input: {
  contract_id: string; origin_id?: string | null;
  lot_id?: string | null; discipline_id?: string | null;
  descricao: string; justificativa: string;
  valor_estimado?: number; prazo_impacto_dias?: number;
}): Promise<string> {
  if (SKIP_AUTH) return 'unf-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const { data, error } = await supabase.rpc('create_unforeseen_item', {
    p_contract_id: input.contract_id,
    p_origin_id: input.origin_id || null,
    p_lot_id: input.lot_id || null,
    p_discipline_id: input.discipline_id || null,
    p_descricao: input.descricao,
    p_justificativa: input.justificativa,
    p_valor_estimado: input.valor_estimado || 0,
    p_prazo_impacto_dias: input.prazo_impacto_dias || 0,
  });
  fail(error);
  return data as string;
}

/** OBJETOS 2..4: avançar status. */
export async function advanceUnforeseenItem(id: string, newStatus: UnforeseenStatus, comment?: string): Promise<void> {
  if (SKIP_AUTH) {
    console.info(`[demo] advanceUnforeseenItem ${id} → ${newStatus}`);
    return;
  }
  checkSupabase();
  const { error } = await supabase.rpc('advance_unforeseen_item', {
    p_id: id, p_new_status: newStatus, p_comment: comment || null,
  });
  fail(error);
}

/** Adicionar componente ao item (composição de preço). */
export async function upsertUnforeseenComponent(input: Omit<UnforeseenComponent, 'id'> & { id?: string }): Promise<string> {
  if (SKIP_AUTH) return input.id || 'cmp-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const row = {
    ...input, tenant_id: tenantId,
    valor_total: Number(input.quantidade) * Number(input.preco_unitario),
  };
  if (input.id) {
    const { error } = await supabase.from('unforeseen_item_components').update(row).eq('id', input.id);
    fail(error);
    return input.id;
  }
  const { data, error } = await supabase.from('unforeseen_item_components').insert(row).select('id').single();
  fail(error);
  return data!.id as string;
}

export async function deleteUnforeseenComponent(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase
    .from('unforeseen_item_components').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

/** Verifica limite legal antes de incorporar. */
export async function checkAdditiveLegalLimit(contractId: string, valorAdicional: number): Promise<{
  ok: boolean; bloqueio: boolean; mensagem: string; zona: 'verde' | 'amarelo' | 'laranja' | 'vermelho';
  percentual_proposto: number; limite_percent: number;
  valor_inicial: number; valor_aditado_atual: number; valor_aditado_proposto: number;
}> {
  if (SKIP_AUTH) {
    return {
      ok: true, bloqueio: false, zona: 'amarelo',
      mensagem: 'Atenção: acima de 20% do contrato',
      percentual_proposto: 22.5, limite_percent: 25,
      valor_inicial: 12_400_000, valor_aditado_atual: 1_240_000, valor_aditado_proposto: 1_240_000 + valorAdicional,
    };
  }
  checkSupabase();
  const { data, error } = await supabase.rpc('check_additive_legal_limit', {
    p_contract_id: contractId, p_valor_adicional: valorAdicional,
  });
  fail(error);
  return data as any;
}

/** OBJETO 5: incorporar itens aprovados num aditivo formal. */
export async function incorporateUnforeseenToAdditive(input: {
  contract_id: string; unforeseen_item_ids: string[];
  tipo: 'valor' | 'prazo' | 'valor_prazo' | 'supressao' | 'reequilibrio';
  justificativa: string; legal_basis?: string;
}): Promise<string> {
  if (SKIP_AUTH) {
    console.info('[demo] incorporateUnforeseenToAdditive', input);
    return 'add-' + Math.random().toString(36).slice(2, 10);
  }
  checkSupabase();
  const { data, error } = await supabase.rpc('incorporate_unforeseen_to_additive', {
    p_contract_id: input.contract_id,
    p_unforeseen_item_ids: input.unforeseen_item_ids,
    p_tipo: input.tipo,
    p_justificativa: input.justificativa,
    p_legal_basis: input.legal_basis || 'Lei 14.133/2021 art. 125',
  });
  fail(error);
  return data as string;
}

// =============================================================================
// WORKFLOW DE APROVAÇÃO + DELEGAÇÃO + MAGIC LINK + COMENTÁRIOS
// =============================================================================

export interface WorkflowTemplate {
  id: string;
  contract_id: string | null;
  nome: string;
  entity_type: 'measurement' | 'additive' | 'unforeseen_item' | 'ged_document' | 'grd';
  active: boolean;
  created_at: string;
  workflow_steps?: WorkflowStep[];
}

export interface WorkflowStep {
  id: string;
  template_id: string;
  ordem: number;
  nome: string;
  role_required: string;
  sla_hours: number;
  assinatura_obrigatoria: boolean;
  actions: string[];
}

export interface MeasurementApprovalStep {
  id: string;
  measurement_id: string;
  ordem: number;
  nome: string;
  role_required: string;
  assigned_to: string | null;
  status: 'pendente' | 'aprovado' | 'devolvido' | 'reprovado' | 'ignorado';
  due_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decided_via_delegation: string | null;
  decided_for: string | null;
  comment: string | null;
  signature_method: string | null;
  assigned_member?: { nome: string; email: string };
  decided_member?: { nome: string };
}

export interface ApprovalDelegation {
  id: string;
  delegator_id: string;
  delegatee_id: string;
  escopo: string;
  ativo_de: string;
  ativo_ate: string;
  active: boolean;
  delegator?: { nome: string; email: string };
  delegatee?: { nome: string; email: string };
}

export interface MeasurementItemComment {
  id: string;
  measurement_id: string;
  measurement_item_id: string | null;
  author_id: string | null;
  body: string;
  kind: string;
  created_at: string;
  members?: { nome: string };
}

// ---- Mocks demo --------------------------------------------------------------
const MOCK_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'wt-default', contract_id: null, nome: 'Workflow padrão de medição',
    entity_type: 'measurement', active: true, created_at: '2024-01-01T00:00:00Z',
    workflow_steps: [
      { id: 'ws-1', template_id: 'wt-default', ordem: 1, nome: 'Análise gerenciadora',  role_required: 'gerenciadora',     sla_hours: 48, assinatura_obrigatoria: false, actions: ['aprovar','devolver'] },
      { id: 'ws-2', template_id: 'wt-default', ordem: 2, nome: 'Fiscal do contrato',     role_required: 'fiscal_contrato',  sla_hours: 72, assinatura_obrigatoria: true,  actions: ['aprovar','devolver','reprovar'] },
      { id: 'ws-3', template_id: 'wt-default', ordem: 3, nome: 'Gestor do contrato',     role_required: 'gestor_contrato',  sla_hours: 72, assinatura_obrigatoria: true,  actions: ['aprovar','devolver','reprovar'] },
      { id: 'ws-4', template_id: 'wt-default', ordem: 4, nome: 'Setor financeiro',       role_required: 'financeiro',       sla_hours: 48, assinatura_obrigatoria: false, actions: ['aprovar','devolver'] },
    ],
  },
];

const MOCK_APPROVAL_STEPS: Record<string, MeasurementApprovalStep[]> = {
  'm1-6': [
    { id: 'as-1', measurement_id: 'm1-6', ordem: 1, nome: 'Análise gerenciadora', role_required: 'gerenciadora',
      assigned_to: 'm-gerenc', status: 'aprovado', due_at: '2025-11-05T17:00:00Z',
      decided_at: '2025-11-04T15:42:00Z', decided_by: 'm-gerenc', decided_via_delegation: null, decided_for: null,
      comment: 'Quantitativos coerentes com a evolução física observada em campo.', signature_method: null,
      assigned_member: { nome: 'Consulte GEO — Gerenciadora', email: 'gerenciadora@consultegeo.org' },
      decided_member: { nome: 'Consulte GEO — Gerenciadora' } },
    { id: 'as-2', measurement_id: 'm1-6', ordem: 2, nome: 'Fiscal do contrato', role_required: 'fiscal_contrato',
      assigned_to: 'm-fiscal', status: 'aprovado', due_at: '2025-11-08T17:00:00Z',
      decided_at: '2025-11-07T10:15:00Z', decided_by: 'm-fiscal', decided_via_delegation: null, decided_for: null,
      comment: 'Aprovado conforme memória de cálculo e evidências.', signature_method: 'gov_br',
      assigned_member: { nome: 'Ricardo Mendes', email: 'ricardo@consultegeo.org' },
      decided_member: { nome: 'Ricardo Mendes' } },
    { id: 'as-3', measurement_id: 'm1-6', ordem: 3, nome: 'Gestor do contrato', role_required: 'gestor_contrato',
      assigned_to: 'm-gest', status: 'pendente', due_at: '2025-11-12T17:00:00Z',
      decided_at: null, decided_by: null, decided_via_delegation: null, decided_for: null,
      comment: null, signature_method: null,
      assigned_member: { nome: 'Eduardo Vargas', email: 'eduardo@consultegeo.org' } },
    { id: 'as-4', measurement_id: 'm1-6', ordem: 4, nome: 'Setor financeiro', role_required: 'financeiro',
      assigned_to: 'm-fin', status: 'pendente', due_at: '2025-11-14T17:00:00Z',
      decided_at: null, decided_by: null, decided_via_delegation: null, decided_for: null,
      comment: null, signature_method: null,
      assigned_member: { nome: 'Janaína Cruz', email: 'janaina@consultegeo.org' } },
  ],
};

const MOCK_DELEGATIONS: ApprovalDelegation[] = [
  {
    id: 'dlg-1', delegator_id: 'm-gest', delegatee_id: 'm-fiscal',
    escopo: 'measurement_approval',
    ativo_de: '2025-11-10T00:00:00Z', ativo_ate: '2025-11-17T00:00:00Z',
    active: true,
    delegator: { nome: 'Eduardo Vargas', email: 'eduardo@consultegeo.org' },
    delegatee: { nome: 'Ricardo Mendes', email: 'ricardo@consultegeo.org' },
  },
];

const MOCK_COMMENTS: Record<string, MeasurementItemComment[]> = {
  'mi-1': [
    { id: 'cm-1', measurement_id: 'm1-6', measurement_item_id: 'mi-1', author_id: 'm-fiscal',
      body: 'Confirmar quantitativo dos eixos C-D na próxima visita.', kind: 'comment',
      created_at: '2025-11-05T11:30:00Z', members: { nome: 'Ricardo Mendes' } },
  ],
};

// ---- Listagens / busca -------------------------------------------------------
export async function listWorkflowTemplates(entityType = 'measurement', contractId?: string | null): Promise<WorkflowTemplate[]> {
  if (SKIP_AUTH) return MOCK_TEMPLATES.filter((t) => t.entity_type === entityType);
  checkSupabase();
  let q = supabase.from('workflow_templates')
    .select('*, workflow_steps(*)')
    .eq('entity_type', entityType)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (contractId !== undefined) q = q.or(`contract_id.eq.${contractId},contract_id.is.null`);
  const r = await q;
  fail(r.error);
  return (r.data || []) as WorkflowTemplate[];
}

export async function listMeasurementApprovalSteps(measurementId: string): Promise<MeasurementApprovalStep[]> {
  if (SKIP_AUTH) return MOCK_APPROVAL_STEPS[measurementId] || [];
  checkSupabase();
  const r = await supabase
    .from('measurement_approval_steps')
    .select('*, assigned_member:members!measurement_approval_steps_assigned_to_fkey(nome,email), decided_member:members!measurement_approval_steps_decided_by_fkey(nome)')
    .eq('measurement_id', measurementId)
    .is('deleted_at', null)
    .order('ordem');
  fail(r.error);
  return (r.data || []) as MeasurementApprovalStep[];
}

/** Instancia (ou reinstancia) o workflow numa medição. */
export async function instantiateMeasurementWorkflow(measurementId: string, templateId?: string): Promise<number> {
  if (SKIP_AUTH) {
    console.info('[demo] instantiateMeasurementWorkflow', measurementId, templateId);
    return MOCK_APPROVAL_STEPS[measurementId]?.length || 4;
  }
  checkSupabase();
  const { data, error } = await supabase.rpc('instantiate_measurement_workflow', {
    p_measurement_id: measurementId,
    p_template_id: templateId || null,
  });
  fail(error);
  return data as number;
}

/** Decide uma etapa (aprovar / devolver / reprovar). */
export async function decideApprovalStep(input: {
  step_id: string;
  action: 'aprovar' | 'devolver' | 'reprovar';
  comment?: string;
  signature_method?: string | null;
}): Promise<void> {
  if (SKIP_AUTH) {
    console.info('[demo] decideApprovalStep', input);
    return;
  }
  checkSupabase();
  const { error } = await supabase.rpc('decide_approval_step', {
    p_step_id: input.step_id,
    p_action: input.action,
    p_comment: input.comment || null,
    p_signature_method: input.signature_method || null,
  });
  fail(error);
}

/** Cria magic-link de aprovação e dispara envio por email via EF send-notification. */
export async function issueApprovalMagicLink(input: {
  step_id: string;
  recipient_email: string;
  ttl_hours?: number;
}): Promise<{ token: string; expires_in_hours: number }> {
  if (SKIP_AUTH) {
    console.info('[demo] issueApprovalMagicLink', input);
    return { token: 'demo-' + Math.random().toString(36).slice(2, 10), expires_in_hours: 72 };
  }
  checkSupabase();
  const { data, error } = await supabase.rpc('issue_approval_magic_link', {
    p_step_id: input.step_id,
    p_recipient_email: input.recipient_email,
    p_ttl_hours: input.ttl_hours || 72,
  });
  fail(error);
  return data as any;
}

// ---- Delegações --------------------------------------------------------------
export async function listMyDelegations(): Promise<ApprovalDelegation[]> {
  if (SKIP_AUTH) return MOCK_DELEGATIONS;
  checkSupabase();
  const r = await supabase
    .from('approval_delegations')
    .select('*, delegator:members!approval_delegations_delegator_id_fkey(nome,email), delegatee:members!approval_delegations_delegatee_id_fkey(nome,email)')
    .eq('active', true)
    .is('deleted_at', null)
    .order('ativo_de', { ascending: false });
  fail(r.error);
  return (r.data || []) as ApprovalDelegation[];
}

export async function createDelegation(input: {
  delegatee_id: string; escopo?: string;
  ativo_de: string; ativo_ate: string;
}): Promise<string> {
  if (SKIP_AUTH) return 'dlg-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const { data: me } = await supabase.from('members').select('id').eq('tenant_id', tenantId).eq('active', true).maybeSingle();
  const { data, error } = await supabase
    .from('approval_delegations')
    .insert({
      tenant_id: tenantId,
      delegator_id: me?.id, delegatee_id: input.delegatee_id,
      escopo: input.escopo || 'measurement_approval',
      ativo_de: input.ativo_de, ativo_ate: input.ativo_ate, active: true,
    }).select('id').single();
  fail(error);
  return data!.id as string;
}

export async function revokeDelegation(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase
    .from('approval_delegations').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

// ---- Comentários por item ----------------------------------------------------
export async function listItemComments(measurementItemId: string): Promise<MeasurementItemComment[]> {
  if (SKIP_AUTH) return MOCK_COMMENTS[measurementItemId] || [];
  checkSupabase();
  const r = await supabase
    .from('measurement_item_comments')
    .select('*, members(nome)')
    .eq('measurement_item_id', measurementItemId)
    .is('deleted_at', null)
    .order('created_at');
  fail(r.error);
  return (r.data || []) as MeasurementItemComment[];
}

export async function addItemComment(input: {
  measurement_id: string;
  measurement_item_id: string;
  body: string;
  kind?: string;
}): Promise<string> {
  if (SKIP_AUTH) {
    console.info('[demo] addItemComment', input);
    return 'cm-' + Math.random().toString(36).slice(2, 10);
  }
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const { data: me } = await supabase.from('members').select('id').eq('tenant_id', tenantId).eq('active', true).maybeSingle();
  const { data, error } = await supabase
    .from('measurement_item_comments')
    .insert({
      tenant_id: tenantId, measurement_id: input.measurement_id,
      measurement_item_id: input.measurement_item_id,
      author_id: me?.id, body: input.body, kind: input.kind || 'comment',
    }).select('id').single();
  fail(error);
  return data!.id as string;
}

// =============================================================================
// GED — taxonomia, documentos, versões, GRD
// =============================================================================

export interface GedCategory {
  id: string;
  parent_id: string | null;
  codigo: string;
  nome: string;
  ordem: number;
  nomenclature_pattern: string | null;
  requires_physical_original: boolean;
  active: boolean;
}

export interface GedMetadataField {
  id: string;
  category_id: string;
  key: string;
  label: string;
  field_type: 'text' | 'number' | 'date' | 'boolean' | 'controlled_term' | 'member' | 'contract' | 'lot' | 'discipline' | 'item';
  required: boolean;
  ordem: number;
}

export interface GedDocument {
  id: string;
  category_id: string;
  contract_id: string | null;
  numero: string | null;
  nomenclature_code: string | null;
  title: string;
  description: string | null;
  status: 'em_elaboracao' | 'em_revisao' | 'aprovado' | 'distribuido' | 'obsoleto' | 'cancelado';
  revisao_atual: string | null;
  data_documento: string | null;
  responsavel_id: string | null;
  keywords: string[] | null;
  has_physical_original: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  ged_categories?: { codigo: string; nome: string };
  members?: { nome: string };
}

export interface GedMasterListItem {
  id: string;
  contract_id: string | null;
  numero: string | null;
  nomenclature_code: string | null;
  title: string;
  description: string | null;
  status: GedDocument['status'];
  revisao_atual: string | null;
  data_documento: string | null;
  category_codigo: string;
  category_nome: string;
  contract_numero: string | null;
  responsavel_nome: string | null;
  current_version_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  versions_count: number;
  created_at: string;
}

export interface GedTransmittal {
  id: string;
  contract_id: string | null;
  numero: string;
  title: string;
  status: 'rascunho' | 'enviada' | 'recebida_parcial' | 'recebida' | 'cancelada';
  sender_id: string | null;
  recipient_organization_id: string | null;
  sent_at: string | null;
  created_at: string;
  recipient?: { nome: string };
  doc_count?: number;
}

// ---- Mocks demo --------------------------------------------------------------
const MOCK_GED_CATEGORIES: GedCategory[] = [
  { id: 'cat-con', parent_id: null, codigo: 'CON', nome: 'Contratual',              ordem: 1,  nomenclature_pattern: '{contrato}-CON-{numero}',         requires_physical_original: true,  active: true },
  { id: 'cat-prj', parent_id: null, codigo: 'PRJ', nome: 'Projetos',                ordem: 2,  nomenclature_pattern: '{contrato}-PRJ-{disciplina}-{numero}-R{revisao}', requires_physical_original: false, active: true },
  { id: 'cat-mem', parent_id: null, codigo: 'MEM', nome: 'Memoriais descritivos',   ordem: 3,  nomenclature_pattern: '{contrato}-MEM-{disciplina}',     requires_physical_original: false, active: true },
  { id: 'cat-pln', parent_id: null, codigo: 'PLN', nome: 'Planilhas e orçamentos',  ordem: 4,  nomenclature_pattern: '{contrato}-PLN-{tipo}',           requires_physical_original: false, active: true },
  { id: 'cat-cro', parent_id: null, codigo: 'CRO', nome: 'Cronogramas',             ordem: 5,  nomenclature_pattern: '{contrato}-CRO-{tipo}',           requires_physical_original: false, active: true },
  { id: 'cat-med', parent_id: null, codigo: 'MED', nome: 'Medições',                ordem: 6,  nomenclature_pattern: '{contrato}-MED-{numero}',         requires_physical_original: false, active: true },
  { id: 'cat-adt', parent_id: null, codigo: 'ADT', nome: 'Aditivos contratuais',    ordem: 7,  nomenclature_pattern: '{contrato}-ADT-{numero}',         requires_physical_original: true,  active: true },
  { id: 'cat-cor', parent_id: null, codigo: 'COR', nome: 'Correspondências',        ordem: 8,  nomenclature_pattern: '{contrato}-COR-{numero}',         requires_physical_original: false, active: true },
  { id: 'cat-rel', parent_id: null, codigo: 'REL', nome: 'Relatórios técnicos',     ordem: 9,  nomenclature_pattern: '{contrato}-REL-{tipo}-{numero}',  requires_physical_original: false, active: true },
  { id: 'cat-obr', parent_id: null, codigo: 'OBR', nome: 'Obra (as-built, RDO)',    ordem: 10, nomenclature_pattern: '{contrato}-OBR-{tipo}-{numero}',  requires_physical_original: false, active: true },
];

const MOCK_METADATA_FIELDS: Record<string, GedMetadataField[]> = {
  'cat-prj': [
    { id: 'mf-prj-1', category_id: 'cat-prj', key: 'disciplina',    label: 'Disciplina',          field_type: 'discipline',       required: true,  ordem: 1 },
    { id: 'mf-prj-2', category_id: 'cat-prj', key: 'numero_folha',  label: 'Número da folha',     field_type: 'text',             required: true,  ordem: 2 },
    { id: 'mf-prj-3', category_id: 'cat-prj', key: 'escala',        label: 'Escala',              field_type: 'text',             required: false, ordem: 3 },
    { id: 'mf-prj-4', category_id: 'cat-prj', key: 'autor',         label: 'Autor / projetista',  field_type: 'member',           required: true,  ordem: 4 },
    { id: 'mf-prj-5', category_id: 'cat-prj', key: 'data_emissao',  label: 'Data de emissão',     field_type: 'date',             required: true,  ordem: 5 },
  ],
  'cat-con': [
    { id: 'mf-con-1', category_id: 'cat-con', key: 'tipo',          label: 'Tipo de documento',   field_type: 'text',             required: true,  ordem: 1 },
    { id: 'mf-con-2', category_id: 'cat-con', key: 'data_assinatura', label: 'Data de assinatura', field_type: 'date',            required: true,  ordem: 2 },
  ],
  'cat-med': [
    { id: 'mf-med-1', category_id: 'cat-med', key: 'numero_medicao', label: 'Número da medição',  field_type: 'number',           required: true,  ordem: 1 },
    { id: 'mf-med-2', category_id: 'cat-med', key: 'periodo_inicio', label: 'Período - início',   field_type: 'date',             required: true,  ordem: 2 },
    { id: 'mf-med-3', category_id: 'cat-med', key: 'periodo_fim',    label: 'Período - fim',      field_type: 'date',             required: true,  ordem: 3 },
  ],
};

const MOCK_GED_DOCS: GedMasterListItem[] = [
  {
    id: 'doc-1', contract_id: 'c1', numero: '00001', nomenclature_code: 'CT-2024/0042-CON-00001',
    title: 'Termo de contrato CT-2024/0042 — assinatura original',
    description: 'Contrato original assinado entre as partes em 15/04/2024.',
    status: 'aprovado', revisao_atual: '0', data_documento: '2024-04-15',
    category_codigo: 'CON', category_nome: 'Contratual',
    contract_numero: 'CT-2024/0042', responsavel_nome: 'Eduardo Vargas',
    current_version_path: 'demo/path', file_size: 2_400_000, mime_type: 'application/pdf', versions_count: 1,
    created_at: '2024-04-16T10:00:00Z',
  },
  {
    id: 'doc-2', contract_id: 'c1', numero: '00012', nomenclature_code: 'CT-2024/0042-PRJ-ARQ-00012-R3',
    title: 'Planta arquitetônica — pavimento 2',
    description: 'Planta arquitetônica do pavimento 2 do bloco cirúrgico.',
    status: 'em_revisao', revisao_atual: '3', data_documento: '2025-09-20',
    category_codigo: 'PRJ', category_nome: 'Projetos',
    contract_numero: 'CT-2024/0042', responsavel_nome: 'Patrícia Lopes',
    current_version_path: 'demo/path', file_size: 8_500_000, mime_type: 'application/pdf', versions_count: 3,
    created_at: '2025-08-10T14:00:00Z',
  },
  {
    id: 'doc-3', contract_id: 'c1', numero: '00008', nomenclature_code: 'CT-2024/0042-MED-00008',
    title: 'Boletim de medição n.º 6 — outubro/2025',
    description: 'Boletim oficial da 6ª medição do contrato.',
    status: 'distribuido', revisao_atual: '0', data_documento: '2025-10-31',
    category_codigo: 'MED', category_nome: 'Medições',
    contract_numero: 'CT-2024/0042', responsavel_nome: 'Ricardo Mendes',
    current_version_path: 'demo/path', file_size: 480_000, mime_type: 'application/pdf', versions_count: 1,
    created_at: '2025-11-01T09:30:00Z',
  },
  {
    id: 'doc-4', contract_id: 'c1', numero: '00003', nomenclature_code: 'CT-2024/0042-COR-00003',
    title: 'Ofício 047/2025 — solicitação de prorrogação',
    description: 'Pedido formal de prorrogação por 30 dias devido a condições climáticas.',
    status: 'em_elaboracao', revisao_atual: '0', data_documento: '2025-11-08',
    category_codigo: 'COR', category_nome: 'Correspondências',
    contract_numero: 'CT-2024/0042', responsavel_nome: 'Eduardo Vargas',
    current_version_path: null, file_size: null, mime_type: null, versions_count: 0,
    created_at: '2025-11-08T16:00:00Z',
  },
];

// ---- Funções públicas --------------------------------------------------------
export async function listGedCategories(): Promise<GedCategory[]> {
  if (SKIP_AUTH) return MOCK_GED_CATEGORIES;
  checkSupabase();
  const r = await supabase
    .from('ged_categories').select('*').is('deleted_at', null).eq('active', true).order('ordem');
  fail(r.error);
  return (r.data || []) as GedCategory[];
}

export async function upsertGedCategory(input: Omit<GedCategory, 'id'> & { id?: string }): Promise<string> {
  if (SKIP_AUTH) return input.id || 'cat-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const row = { ...input, tenant_id: tenantId };
  if (input.id) {
    const { error } = await supabase.from('ged_categories').update(row).eq('id', input.id);
    fail(error);
    return input.id;
  }
  const { data, error } = await supabase.from('ged_categories').insert(row).select('id').single();
  fail(error);
  return data!.id as string;
}

export async function deleteGedCategory(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase
    .from('ged_categories').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

export async function listMetadataFields(categoryId: string): Promise<GedMetadataField[]> {
  if (SKIP_AUTH) return MOCK_METADATA_FIELDS[categoryId] || [];
  checkSupabase();
  const r = await supabase
    .from('ged_metadata_fields').select('*').eq('category_id', categoryId).is('deleted_at', null).order('ordem');
  fail(r.error);
  return (r.data || []) as GedMetadataField[];
}

export async function upsertMetadataField(input: Omit<GedMetadataField, 'id'> & { id?: string }): Promise<string> {
  if (SKIP_AUTH) return input.id || 'mf-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const row = { ...input, tenant_id: tenantId };
  if (input.id) {
    const { error } = await supabase.from('ged_metadata_fields').update(row).eq('id', input.id);
    fail(error);
    return input.id;
  }
  const { data, error } = await supabase.from('ged_metadata_fields').insert(row).select('id').single();
  fail(error);
  return data!.id as string;
}

export async function deleteMetadataField(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase
    .from('ged_metadata_fields').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

// ---- Controlled terms (vocabulários) -----------------------------------------
export interface GedControlledTerm {
  id: string;
  key: string;
  nome: string;
  active: boolean;
  values?: GedControlledTermValue[];
}

export interface GedControlledTermValue {
  id: string;
  term_id: string;
  value: string;
  label: string;
  ordem: number;
  active: boolean;
}

const MOCK_TERMS: GedControlledTerm[] = [
  { id: 't-disc', key: 'discipline', nome: 'Disciplina', active: true },
  { id: 't-phase', key: 'phase', nome: 'Fase do projeto', active: true },
  { id: 't-status', key: 'drawing_status', nome: 'Status de desenho', active: true },
];

const MOCK_TERM_VALUES: Record<string, GedControlledTermValue[]> = {
  't-disc': [
    { id: 'tv-1', term_id: 't-disc', value: 'ARQ', label: 'Arquitetura',    ordem: 1, active: true },
    { id: 'tv-2', term_id: 't-disc', value: 'EST', label: 'Estrutura',      ordem: 2, active: true },
    { id: 'tv-3', term_id: 't-disc', value: 'HID', label: 'Hidrossanitária', ordem: 3, active: true },
    { id: 'tv-4', term_id: 't-disc', value: 'ELE', label: 'Elétrica',       ordem: 4, active: true },
  ],
  't-phase': [
    { id: 'tv-5', term_id: 't-phase', value: 'EP',   label: 'Estudo preliminar', ordem: 1, active: true },
    { id: 'tv-6', term_id: 't-phase', value: 'AP',   label: 'Anteprojeto',       ordem: 2, active: true },
    { id: 'tv-7', term_id: 't-phase', value: 'PB',   label: 'Projeto básico',    ordem: 3, active: true },
    { id: 'tv-8', term_id: 't-phase', value: 'PE',   label: 'Projeto executivo', ordem: 4, active: true },
  ],
  't-status': [
    { id: 'tv-9',  term_id: 't-status', value: 'PRE', label: 'Preliminar',  ordem: 1, active: true },
    { id: 'tv-10', term_id: 't-status', value: 'APR', label: 'Aprovado',    ordem: 2, active: true },
    { id: 'tv-11', term_id: 't-status', value: 'OBS', label: 'Obsoleto',    ordem: 3, active: true },
  ],
};

export async function listGedControlledTerms(): Promise<GedControlledTerm[]> {
  if (SKIP_AUTH) return MOCK_TERMS.map((t) => ({ ...t, values: MOCK_TERM_VALUES[t.id] || [] }));
  checkSupabase();
  const r = await supabase
    .from('ged_controlled_terms')
    .select('*, values:ged_controlled_term_values(*)')
    .is('deleted_at', null)
    .eq('active', true)
    .order('nome');
  fail(r.error);
  return (r.data || []).map((t: any) => ({
    ...t,
    values: (t.values || [])
      .filter((v: any) => !v.deleted_at)
      .sort((a: any, b: any) => a.ordem - b.ordem),
  })) as GedControlledTerm[];
}

export async function upsertGedControlledTerm(
  input: Omit<GedControlledTerm, 'id' | 'values'> & { id?: string },
): Promise<string> {
  if (SKIP_AUTH) return input.id || 't-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const row = { ...input, tenant_id: tenantId };
  if (input.id) {
    const { error } = await supabase.from('ged_controlled_terms').update(row).eq('id', input.id);
    fail(error);
    return input.id;
  }
  const { data, error } = await supabase.from('ged_controlled_terms').insert(row).select('id').single();
  fail(error);
  return data!.id as string;
}

export async function deleteGedControlledTerm(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase
    .from('ged_controlled_terms').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

export async function upsertGedControlledTermValue(
  input: Omit<GedControlledTermValue, 'id'> & { id?: string },
): Promise<string> {
  if (SKIP_AUTH) return input.id || 'tv-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const row = { ...input, tenant_id: tenantId };
  if (input.id) {
    const { error } = await supabase.from('ged_controlled_term_values').update(row).eq('id', input.id);
    fail(error);
    return input.id;
  }
  const { data, error } = await supabase.from('ged_controlled_term_values').insert(row).select('id').single();
  fail(error);
  return data!.id as string;
}

export async function deleteGedControlledTermValue(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase
    .from('ged_controlled_term_values').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

export async function listGedMasterList(input: {
  contractId?: string | null; status?: string | null;
  categoryId?: string | null; query?: string | null;
}): Promise<GedMasterListItem[]> {
  if (SKIP_AUTH) {
    let arr = [...MOCK_GED_DOCS];
    if (input.contractId) arr = arr.filter((d) => d.contract_id === input.contractId);
    if (input.status) arr = arr.filter((d) => d.status === input.status);
    if (input.categoryId) {
      const cat = MOCK_GED_CATEGORIES.find((c) => c.id === input.categoryId);
      if (cat) arr = arr.filter((d) => d.category_codigo === cat.codigo);
    }
    if (input.query) {
      const q = input.query.toLowerCase();
      arr = arr.filter((d) => (d.title || '').toLowerCase().includes(q)
                          || (d.description || '').toLowerCase().includes(q)
                          || (d.nomenclature_code || '').toLowerCase().includes(q));
    }
    return arr;
  }
  checkSupabase();
  let q = supabase.from('v_ged_master_list').select('*').order('created_at', { ascending: false });
  if (input.contractId) q = q.eq('contract_id', input.contractId);
  if (input.status) q = q.eq('status', input.status);
  if (input.categoryId) q = q.eq('category_id', input.categoryId);
  // Full-text com to_tsquery (português, plainto_tsquery aceita texto livre)
  if (input.query && input.query.trim()) {
    q = q.textSearch('fulltext', input.query.trim(), { type: 'plain', config: 'portuguese' });
  }
  const r = await q;
  fail(r.error);
  return (r.data || []) as GedMasterListItem[];
}

export async function createGedDocument(input: {
  category_id: string;
  contract_id?: string | null;
  title: string; description?: string | null;
  revision: string;
  file: File;
  keywords?: string[];
  metadata?: Record<string, unknown>;
}): Promise<string> {
  if (SKIP_AUTH) {
    console.info('[demo] createGedDocument', input.title, input.file.name);
    return 'doc-' + Math.random().toString(36).slice(2, 10);
  }
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  // 1. Upload do arquivo
  const ext = input.file.name.split('.').pop() || 'bin';
  const docTmpKey = Math.random().toString(36).slice(2, 10);
  const path = `tenants/${tenantId}/ged/${input.category_id}/${docTmpKey}.${ext}`;
  const up = await supabase.storage.from('ged-documents').upload(path, input.file, {
    contentType: input.file.type, upsert: false,
  });
  if (up.error) throw new Error(up.error.message);

  // 2. Calcula hash SHA-256
  const buf = await input.file.arrayBuffer();
  const hashBytes = await crypto.subtle.digest('SHA-256', buf);
  const hash = Array.from(new Uint8Array(hashBytes)).map((b) => b.toString(16).padStart(2, '0')).join('');

  // 3. Cria documento + versão via RPC
  const { data, error } = await supabase.rpc('create_ged_document', {
    p_category_id: input.category_id,
    p_contract_id: input.contract_id || null,
    p_title: input.title,
    p_description: input.description || null,
    p_revision: input.revision,
    p_storage_path: path,
    p_mime_type: input.file.type,
    p_file_size: input.file.size,
    p_hash_sha256: hash,
    p_keywords: input.keywords || null,
    p_metadata: input.metadata || {},
  });
  fail(error);
  return data as string;
}

export async function uploadGedDocumentRevision(input: {
  document_id: string;
  revision: string;
  file: File;
}): Promise<string> {
  if (SKIP_AUTH) return 'ver-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const ext = input.file.name.split('.').pop() || 'bin';
  const path = `tenants/${tenantId}/ged/revisions/${input.document_id}/r${input.revision}-${Date.now()}.${ext}`;
  const up = await supabase.storage.from('ged-documents').upload(path, input.file, {
    contentType: input.file.type, upsert: false,
  });
  if (up.error) throw new Error(up.error.message);

  const buf = await input.file.arrayBuffer();
  const hashBytes = await crypto.subtle.digest('SHA-256', buf);
  const hash = Array.from(new Uint8Array(hashBytes)).map((b) => b.toString(16).padStart(2, '0')).join('');

  const { data, error } = await supabase.rpc('upload_ged_document_revision', {
    p_document_id: input.document_id,
    p_revision: input.revision,
    p_storage_path: path,
    p_mime_type: input.file.type,
    p_file_size: input.file.size,
    p_hash_sha256: hash,
  });
  fail(error);
  return data as string;
}

export async function getGedDocumentUrl(storagePath: string): Promise<string | null> {
  if (SKIP_AUTH) return null;
  checkSupabase();
  const { data } = await supabase.storage.from('ged-documents').createSignedUrl(storagePath, 300);
  return data?.signedUrl || null;
}

export async function logGedAccess(documentId: string, action: 'view' | 'download' | 'print' = 'view'): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  await supabase.rpc('log_ged_access', { p_document_id: documentId, p_action: action });
}

// ---- Documento: detalhe, versões, trilha de acesso --------------------------
export interface GedDocumentDetail {
  id: string;
  tenant_id: string;
  category_id: string;
  contract_id: string | null;
  numero: string | null;
  nomenclature_code: string | null;
  title: string;
  description: string | null;
  status: GedDocument['status'];
  revisao_atual: string | null;
  data_documento: string | null;
  responsavel_id: string | null;
  keywords: string[] | null;
  has_physical_original: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  ged_categories?: { id: string; codigo: string; nome: string; nomenclature_pattern: string | null; requires_physical_original: boolean };
  contracts?: { id: string; numero: string; titulo: string | null } | null;
  responsavel?: { nome: string; email: string } | null;
}

export interface GedDocumentVersion {
  id: string;
  document_id: string;
  revision: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  hash_sha256: string | null;
  status: 'vigente' | 'obsoleta' | 'rascunho';
  uploaded_by: string | null;
  uploaded_at: string;
  extracted_text: string | null;
  uploader?: { nome: string } | null;
}

export interface GedAccessLogEntry {
  id: string;
  document_id: string;
  member_id: string | null;
  action: string;
  occurred_at: string;
  member?: { nome: string; email: string } | null;
}

const MOCK_DOC_DETAIL: GedDocumentDetail = {
  id: 'doc-1', tenant_id: 't-1', category_id: 'cat-prj', contract_id: 'c1',
  numero: '00012', nomenclature_code: 'CT-2024/0042-PRJ-ARQ-00012-R3',
  title: 'Planta arquitetônica — pavimento 2',
  description: 'Planta arquitetônica do pavimento 2 do bloco cirúrgico.',
  status: 'em_revisao', revisao_atual: '3', data_documento: '2025-09-20',
  responsavel_id: 'm-pat', keywords: ['arquitetura', 'pavimento2', 'cirurgia'],
  has_physical_original: false, metadata: { disciplina: 'ARQ', fase: 'PE' },
  created_at: '2025-08-10T14:00:00Z',
  ged_categories: { id: 'cat-prj', codigo: 'PRJ', nome: 'Projetos', nomenclature_pattern: null, requires_physical_original: false },
  contracts: { id: 'c1', numero: 'CT-2024/0042', titulo: 'Construção de Hospital Regional' },
  responsavel: { nome: 'Patrícia Lopes', email: 'patricia@example.com' },
};

const MOCK_VERSIONS: GedDocumentVersion[] = [
  { id: 'v3', document_id: 'doc-1', revision: '3', storage_path: 'demo/r3.pdf', mime_type: 'application/pdf', file_size: 8_500_000, hash_sha256: 'a1b2c3...', status: 'vigente', uploaded_by: 'm-pat', uploaded_at: '2025-09-20T10:00:00Z', extracted_text: null, uploader: { nome: 'Patrícia Lopes' } },
  { id: 'v2', document_id: 'doc-1', revision: '2', storage_path: 'demo/r2.pdf', mime_type: 'application/pdf', file_size: 8_300_000, hash_sha256: 'd4e5f6...', status: 'obsoleta', uploaded_by: 'm-pat', uploaded_at: '2025-08-15T10:00:00Z', extracted_text: null, uploader: { nome: 'Patrícia Lopes' } },
  { id: 'v1', document_id: 'doc-1', revision: '1', storage_path: 'demo/r1.pdf', mime_type: 'application/pdf', file_size: 8_100_000, hash_sha256: '789abc...', status: 'obsoleta', uploaded_by: 'm-pat', uploaded_at: '2025-08-10T14:00:00Z', extracted_text: null, uploader: { nome: 'Patrícia Lopes' } },
];

const MOCK_ACCESS: GedAccessLogEntry[] = [
  { id: 'l1', document_id: 'doc-1', member_id: 'm-fis', action: 'view',     occurred_at: '2025-09-21T09:00:00Z', member: { nome: 'Ricardo Mendes',  email: 'ricardo@example.com' } },
  { id: 'l2', document_id: 'doc-1', member_id: 'm-fis', action: 'download', occurred_at: '2025-09-21T09:01:00Z', member: { nome: 'Ricardo Mendes',  email: 'ricardo@example.com' } },
  { id: 'l3', document_id: 'doc-1', member_id: 'm-pat', action: 'view',     occurred_at: '2025-09-20T10:05:00Z', member: { nome: 'Patrícia Lopes',  email: 'patricia@example.com' } },
];

export async function getGedDocument(id: string): Promise<GedDocumentDetail | null> {
  if (SKIP_AUTH) return MOCK_DOC_DETAIL;
  checkSupabase();
  const r = await supabase
    .from('ged_documents')
    .select(`*,
      ged_categories(id, codigo, nome, nomenclature_pattern, requires_physical_original),
      contracts(id, numero, titulo),
      responsavel:members!ged_documents_responsavel_id_fkey(nome, email)
    `)
    .eq('id', id).is('deleted_at', null).maybeSingle();
  fail(r.error);
  return r.data as GedDocumentDetail | null;
}

export async function listGedDocumentVersions(documentId: string): Promise<GedDocumentVersion[]> {
  if (SKIP_AUTH) return MOCK_VERSIONS;
  checkSupabase();
  const r = await supabase
    .from('ged_document_versions')
    .select('*, uploader:members!ged_document_versions_uploaded_by_fkey(nome)')
    .eq('document_id', documentId).is('deleted_at', null)
    .order('uploaded_at', { ascending: false });
  fail(r.error);
  return (r.data || []) as GedDocumentVersion[];
}

export async function listGedAccessLog(documentId: string): Promise<GedAccessLogEntry[]> {
  if (SKIP_AUTH) return MOCK_ACCESS;
  checkSupabase();
  const r = await supabase
    .from('ged_access_log')
    .select('*, member:members(nome, email)')
    .eq('document_id', documentId)
    .order('occurred_at', { ascending: false })
    .limit(100);
  fail(r.error);
  return (r.data || []) as GedAccessLogEntry[];
}

export async function updateGedDocumentStatus(id: string, status: GedDocument['status']): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase
    .from('ged_documents').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

export async function extractTextFromVersion(versionId: string, storagePath: string): Promise<{ pages: number; length: number; preview: string } | null> {
  if (SKIP_AUTH) {
    console.info('[demo] extractText', versionId, storagePath);
    return { pages: 3, length: 1200, preview: 'Texto extraído de exemplo…' };
  }
  return await callFn('extract-pdf-text', {
    storage_path: storagePath,
    storage_bucket: 'ged-documents',
    ged_document_version_id: versionId,
  });
}

// ---- Painéis financeiro e cronograma ----------------------------------------

export interface FinancialSnapshot {
  id: string;
  contract_id: string;
  reference_date: string;
  valor_inicial: number;
  valor_aditado: number;
  valor_total_atual: number;
  valor_medido_mes: number;
  valor_medido_acumulado: number;
  valor_reajustado_acumulado: number;
  total_retencoes: number;
  total_glosas: number;
  total_pago: number;
  saldo_contratual: number;
  percentual_fisico: number;
  percentual_financeiro: number;
  forecast_3m: number;
  forecast_6m: number;
  forecast_12m: number;
  risk_flags: Array<{ code: string; severity: 'low' | 'medium' | 'high'; message: string }>;
  generated_at: string;
}

export interface CurvaSPoint {
  contract_id: string;
  mes: string;
  valor_realizado_mes: number;
  valor_realizado_acumulado: number;
  valor_previsto_mes: number;
  valor_previsto_acumulado: number;
}

const MOCK_SNAPSHOT: FinancialSnapshot = {
  id: 'snap-1', contract_id: 'c1', reference_date: '2025-11-14',
  valor_inicial: 12_500_000, valor_aditado: 450_000, valor_total_atual: 12_950_000,
  valor_medido_mes: 380_000, valor_medido_acumulado: 7_240_000, valor_reajustado_acumulado: 180_000,
  total_retencoes: 362_000, total_glosas: 145_000, total_pago: 6_733_000,
  saldo_contratual: 5_710_000, percentual_fisico: 58.3, percentual_financeiro: 55.9,
  forecast_3m: 1_140_000, forecast_6m: 2_280_000, forecast_12m: 4_560_000,
  risk_flags: [
    { code: 'desaceleracao', severity: 'medium', message: 'Possível desaceleração: 65% temporal vs 58.3% executado' },
  ],
  generated_at: '2025-11-14T10:00:00Z',
};

const MOCK_CURVA_S: CurvaSPoint[] = [
  { contract_id: 'c1', mes: '2024-05-01', valor_realizado_mes: 320_000, valor_realizado_acumulado: 320_000, valor_previsto_mes: 380_000, valor_previsto_acumulado: 380_000 },
  { contract_id: 'c1', mes: '2024-06-01', valor_realizado_mes: 410_000, valor_realizado_acumulado: 730_000, valor_previsto_mes: 450_000, valor_previsto_acumulado: 830_000 },
  { contract_id: 'c1', mes: '2024-07-01', valor_realizado_mes: 580_000, valor_realizado_acumulado: 1_310_000, valor_previsto_mes: 600_000, valor_previsto_acumulado: 1_430_000 },
  { contract_id: 'c1', mes: '2024-08-01', valor_realizado_mes: 640_000, valor_realizado_acumulado: 1_950_000, valor_previsto_mes: 680_000, valor_previsto_acumulado: 2_110_000 },
  { contract_id: 'c1', mes: '2024-09-01', valor_realizado_mes: 720_000, valor_realizado_acumulado: 2_670_000, valor_previsto_mes: 700_000, valor_previsto_acumulado: 2_810_000 },
  { contract_id: 'c1', mes: '2024-10-01', valor_realizado_mes: 690_000, valor_realizado_acumulado: 3_360_000, valor_previsto_mes: 720_000, valor_previsto_acumulado: 3_530_000 },
  { contract_id: 'c1', mes: '2024-11-01', valor_realizado_mes: 730_000, valor_realizado_acumulado: 4_090_000, valor_previsto_mes: 730_000, valor_previsto_acumulado: 4_260_000 },
  { contract_id: 'c1', mes: '2024-12-01', valor_realizado_mes: 410_000, valor_realizado_acumulado: 4_500_000, valor_previsto_mes: 500_000, valor_previsto_acumulado: 4_760_000 },
  { contract_id: 'c1', mes: '2025-01-01', valor_realizado_mes: 280_000, valor_realizado_acumulado: 4_780_000, valor_previsto_mes: 400_000, valor_previsto_acumulado: 5_160_000 },
  { contract_id: 'c1', mes: '2025-02-01', valor_realizado_mes: 520_000, valor_realizado_acumulado: 5_300_000, valor_previsto_mes: 600_000, valor_previsto_acumulado: 5_760_000 },
  { contract_id: 'c1', mes: '2025-03-01', valor_realizado_mes: 600_000, valor_realizado_acumulado: 5_900_000, valor_previsto_mes: 650_000, valor_previsto_acumulado: 6_410_000 },
  { contract_id: 'c1', mes: '2025-04-01', valor_realizado_mes: 580_000, valor_realizado_acumulado: 6_480_000, valor_previsto_mes: 700_000, valor_previsto_acumulado: 7_110_000 },
  { contract_id: 'c1', mes: '2025-05-01', valor_realizado_mes: 380_000, valor_realizado_acumulado: 6_860_000, valor_previsto_mes: 700_000, valor_previsto_acumulado: 7_810_000 },
  { contract_id: 'c1', mes: '2025-06-01', valor_realizado_mes: 0,        valor_realizado_acumulado: 6_860_000, valor_previsto_mes: 720_000, valor_previsto_acumulado: 8_530_000 },
];

export async function getLatestSnapshot(contractId: string): Promise<FinancialSnapshot | null> {
  if (SKIP_AUTH) return { ...MOCK_SNAPSHOT, contract_id: contractId };
  checkSupabase();
  const r = await supabase
    .from('contract_financial_snapshots')
    .select('*')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
    .order('reference_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  fail(r.error);
  return r.data as FinancialSnapshot | null;
}

export async function listFinancialTrend(contractId: string, limit = 12): Promise<FinancialSnapshot[]> {
  if (SKIP_AUTH) return [MOCK_SNAPSHOT].map((s) => ({ ...s, contract_id: contractId }));
  checkSupabase();
  const r = await supabase
    .from('v_financial_trend')
    .select('*')
    .eq('contract_id', contractId)
    .limit(limit);
  fail(r.error);
  return (r.data || []) as FinancialSnapshot[];
}

export async function recalcFinancialSnapshot(contractId: string, ensurePeriods = true): Promise<{ snapshot_id: string; snapshot: FinancialSnapshot | null } | null> {
  if (SKIP_AUTH) {
    console.info('[demo] recalcFinancialSnapshot', contractId);
    return { snapshot_id: 'snap-' + Math.random().toString(36).slice(2, 10), snapshot: MOCK_SNAPSHOT };
  }
  return await callFn('recalc-financial-snapshot', { contract_id: contractId, ensure_periods: ensurePeriods });
}

export async function getCurvaS(contractId: string): Promise<CurvaSPoint[]> {
  if (SKIP_AUTH) return MOCK_CURVA_S.map((p) => ({ ...p, contract_id: contractId }));
  checkSupabase();
  const r = await supabase
    .from('v_curva_s')
    .select('*')
    .eq('contract_id', contractId)
    .order('mes');
  fail(r.error);
  return (r.data || []) as CurvaSPoint[];
}

export interface SchedulePeriod {
  id: string;
  contract_id: string;
  periodo: string;
  label: string;
  ordem: number;
}

export interface PhysicalFinancialRow {
  id: string;
  contract_id: string;
  schedule_period_id: string | null;
  lot_id: string | null;
  discipline_id: string | null;
  wbs_item_id: string | null;
  percentual_fisico_previsto: number | null;
  percentual_fisico_realizado: number | null;
  valor_previsto: number | null;
  valor_realizado: number | null;
  source: string | null;
  // joined fields
  periodo?: string;
  label?: string;
}

export async function listSchedulePeriods(contractId: string): Promise<SchedulePeriod[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase
    .from('schedule_periods')
    .select('*')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
    .order('ordem');
  fail(r.error);
  return (r.data || []) as SchedulePeriod[];
}

export async function ensureSchedulePeriods(contractId: string): Promise<number> {
  if (SKIP_AUTH) return 0;
  checkSupabase();
  const { data, error } = await supabase.rpc('ensure_schedule_periods', { p_contract_id: contractId });
  fail(error);
  return Number(data || 0);
}

export async function listPhysicalFinancialSchedule(contractId: string): Promise<PhysicalFinancialRow[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase
    .from('physical_financial_schedule')
    .select(`*, schedule_periods(periodo, label, ordem)`)
    .eq('contract_id', contractId)
    .is('deleted_at', null);
  fail(r.error);
  return (r.data || []).map((row: any) => ({
    ...row,
    periodo: row.schedule_periods?.periodo,
    label: row.schedule_periods?.label,
  })) as PhysicalFinancialRow[];
}

export async function upsertScheduleRow(input: {
  contract_id: string;
  schedule_period_id: string;
  lot_id?: string | null;
  discipline_id?: string | null;
  valor_previsto?: number | null;
  percentual_fisico_previsto?: number | null;
  source?: string | null;
}): Promise<string> {
  if (SKIP_AUTH) return 'pfs-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  // Tenta achar existente (mesmo period + lot + discipline)
  let q = supabase.from('physical_financial_schedule')
    .select('id')
    .eq('contract_id', input.contract_id)
    .eq('schedule_period_id', input.schedule_period_id)
    .is('deleted_at', null);
  if (input.lot_id) q = q.eq('lot_id', input.lot_id); else q = q.is('lot_id', null);
  if (input.discipline_id) q = q.eq('discipline_id', input.discipline_id); else q = q.is('discipline_id', null);
  const exists = await q.maybeSingle();
  const payload = {
    tenant_id: tenantId,
    contract_id: input.contract_id,
    schedule_period_id: input.schedule_period_id,
    lot_id: input.lot_id || null,
    discipline_id: input.discipline_id || null,
    valor_previsto: input.valor_previsto ?? null,
    percentual_fisico_previsto: input.percentual_fisico_previsto ?? null,
    source: input.source || 'manual',
  };
  if (exists.data?.id) {
    const { error } = await supabase.from('physical_financial_schedule').update(payload).eq('id', exists.data.id);
    fail(error);
    return exists.data.id;
  }
  const { data, error } = await supabase.from('physical_financial_schedule').insert(payload).select('id').single();
  fail(error);
  return data!.id;
}

// ---- Funcionalidades pontuais (Item 13) -------------------------------------

// Boletim complementar
export async function createComplementaryMeasurement(measurementId: string, descricao?: string): Promise<string> {
  if (SKIP_AUTH) return 'm-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const { data, error } = await supabase.rpc('create_complementary_measurement', {
    p_origin_measurement_id: measurementId,
    p_descricao: descricao || null,
  });
  fail(error);
  return data as string;
}

// Boletim de retificação
export async function createRectificationMeasurement(measurementId: string, motivo: string): Promise<string> {
  if (SKIP_AUTH) return 'm-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const { data, error } = await supabase.rpc('create_rectification_measurement', {
    p_origin_measurement_id: measurementId,
    p_motivo: motivo,
  });
  fail(error);
  return data as string;
}

// Glosa por item
export interface ItemGloss {
  id: string;
  measurement_id: string;
  measurement_item_id: string | null;
  valor_glosado: number;
  quantidade_glosada: number | null;
  justificativa: string;
  status: 'pendente' | 'aplicada' | 'cancelada';
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  measurement_items?: { codigo: string; descricao: string } | null;
}

export async function listItemGlosses(measurementId: string): Promise<ItemGloss[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase
    .from('measurement_glosses')
    .select('*, measurement_items(codigo, descricao)')
    .eq('measurement_id', measurementId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  fail(r.error);
  return (r.data || []) as ItemGloss[];
}

export async function upsertItemGloss(input: {
  id?: string;
  measurement_id: string;
  measurement_item_id?: string | null;
  valor_glosado: number;
  quantidade_glosada?: number | null;
  justificativa: string;
}): Promise<string> {
  if (SKIP_AUTH) return input.id || 'gl-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const row: Record<string, unknown> = {
    measurement_id: input.measurement_id,
    measurement_item_id: input.measurement_item_id || null,
    valor_glosado: input.valor_glosado,
    quantidade_glosada: input.quantidade_glosada ?? null,
    justificativa: input.justificativa,
    tenant_id: tenantId,
  };
  if (input.id) {
    const { error } = await supabase.from('measurement_glosses').update(row).eq('id', input.id);
    fail(error);
    return input.id;
  }
  row.status = 'pendente';
  const { data, error } = await supabase.from('measurement_glosses').insert(row).select('id').single();
  fail(error);
  return data!.id;
}

export async function deleteItemGloss(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase.from('measurement_glosses').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

export async function decideGloss(id: string, decision: 'aplicada' | 'cancelada'): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase
    .from('measurement_glosses')
    .update({ status: decision, decided_at: new Date().toISOString() })
    .eq('id', id);
  fail(error);
}

// Helpers para "copiar saldo" e "copiar medição anterior"
export async function copyMeasurementBalance(measurementId: string): Promise<number> {
  if (SKIP_AUTH) return 0;
  checkSupabase();
  const { data, error } = await supabase.rpc('copy_measurement_balance', { p_measurement_id: measurementId });
  fail(error);
  return Number(data || 0);
}

export async function copyPreviousMeasurement(measurementId: string): Promise<number> {
  if (SKIP_AUTH) return 0;
  checkSupabase();
  const { data, error } = await supabase.rpc('copy_previous_measurement', { p_measurement_id: measurementId });
  fail(error);
  return Number(data || 0);
}

// Lifecycle: complementar, retificação, cancelamento
export async function createComplementarMeasurement(input: {
  parent_id: string;
  periodo_inicio: string;
  periodo_fim: string;
  observacao?: string;
}): Promise<string> {
  if (SKIP_AUTH) return 'med-complementar-' + Math.random().toString(36).slice(2, 8);
  checkSupabase();
  const { data, error } = await supabase.rpc('create_complementar_measurement', {
    p_parent_id: input.parent_id,
    p_periodo_inicio: input.periodo_inicio,
    p_periodo_fim: input.periodo_fim,
    p_observacao: input.observacao ?? null,
  });
  fail(error);
  return data as string;
}

export async function createRetificacaoMeasurement(input: {
  parent_id: string;
  justificativa: string;
}): Promise<string> {
  if (SKIP_AUTH) return 'med-retificacao-' + Math.random().toString(36).slice(2, 8);
  checkSupabase();
  const { data, error } = await supabase.rpc('create_retificacao_measurement', {
    p_parent_id: input.parent_id,
    p_justificativa: input.justificativa,
  });
  fail(error);
  return data as string;
}

export async function cancelMeasurement(input: { id: string; motivo: string }): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase.rpc('cancel_measurement', {
    p_measurement_id: input.id,
    p_motivo: input.motivo,
  });
  fail(error);
}

// Comparador SOV
export interface SovComparisonRow {
  codigo: string;
  descricao: string;
  unidade: string | null;
  preco_unit_a: number | null;
  preco_unit_b: number | null;
  qtd_a: number | null;
  qtd_b: number | null;
  valor_a: number | null;
  valor_b: number | null;
  delta_valor: number;
  delta_pct: number | null;
  situacao: 'incluido' | 'removido' | 'alterado' | 'inalterado';
}

export async function listSovVersions(contractId: string): Promise<Array<{ id: string; numero: number; origem: string | null; status: string; locked_at: string | null; total_value: number | null; total_items: number | null; created_at: string }>> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase
    .from('sov_versions')
    .select('id, numero, origem, status, locked_at, total_value, total_items, created_at')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
    .order('numero');
  fail(r.error);
  return r.data || [];
}

export async function compareSovVersions(versionA: string, versionB: string): Promise<SovComparisonRow[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const { data, error } = await supabase.rpc('compare_sov_versions', { p_version_a: versionA, p_version_b: versionB });
  fail(error);
  return (data || []) as SovComparisonRow[];
}

// Alertas de saldo
export interface SaldoAlert {
  contract_id: string;
  numero: string;
  valor_contrato: number;
  valor_medido: number;
  pct_consumido: number;
  nivel_alerta: 'ok' | 'atencao' | 'critico' | 'esgotado';
  mensagem: string | null;
}

export async function getSaldoAlert(contractId: string): Promise<SaldoAlert | null> {
  if (SKIP_AUTH) return { contract_id: contractId, numero: 'CT-DEMO', valor_contrato: 1000000, valor_medido: 850000, pct_consumido: 85, nivel_alerta: 'atencao', mensagem: 'Atenção — saldo abaixo de 20%' };
  checkSupabase();
  const r = await supabase.from('v_saldo_alerts').select('*').eq('contract_id', contractId).maybeSingle();
  fail(r.error);
  return r.data as SaldoAlert | null;
}

// ---- Admin: programas, disciplinas, EAP -------------------------------------

export interface Program {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  orgao: string | null;
  funding_source: string | null;
  active: boolean;
}

export interface Discipline {
  id: string;
  codigo: string;
  nome: string;
  corporativa: boolean;
  ordem: number;
}

export interface WbsItem {
  id: string;
  contract_id: string;
  lot_id: string | null;
  discipline_id: string | null;
  parent_id: string | null;
  codigo: string;
  nome: string;
  nivel: number;
  ordem: number;
  criterio_medicao: string | null;
  tem_acompanhamento_fisico: boolean;
  vinculado_marco: boolean;
  peso: number | null;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  active: boolean;
  disciplines?: { nome: string };
}

const MOCK_PROGRAMS: Program[] = [
  { id: 'pg-1', codigo: 'SAU-2024', nome: 'Saúde — Expansão hospitalar', descricao: 'Programa de expansão da rede pública de saúde no estado', orgao: 'SES/RJ', funding_source: 'BNDES', active: true },
  { id: 'pg-2', codigo: 'EDU-2024', nome: 'Educação — Reforma de escolas', descricao: 'Programa de reforma e ampliação de escolas estaduais', orgao: 'SEEDUC/RJ', funding_source: 'FNDE', active: true },
];

const MOCK_DISCIPLINES: Discipline[] = [
  { id: 'd-arq', codigo: 'ARQ', nome: 'Arquitetura',         corporativa: true,  ordem: 1 },
  { id: 'd-est', codigo: 'EST', nome: 'Estrutura',           corporativa: true,  ordem: 2 },
  { id: 'd-hid', codigo: 'HID', nome: 'Hidrossanitária',     corporativa: true,  ordem: 3 },
  { id: 'd-ele', codigo: 'ELE', nome: 'Elétrica',            corporativa: true,  ordem: 4 },
  { id: 'd-cli', codigo: 'CLI', nome: 'Climatização (HVAC)', corporativa: true,  ordem: 5 },
  { id: 'd-tel', codigo: 'TEL', nome: 'Telecomunicações',    corporativa: true,  ordem: 6 },
];

const MOCK_WBS: WbsItem[] = [
  { id: 'w1', contract_id: 'c1', lot_id: null, discipline_id: null, parent_id: null, codigo: '1', nome: 'Serviços preliminares', nivel: 1, ordem: 1, criterio_medicao: 'preliminares', tem_acompanhamento_fisico: true, vinculado_marco: true, peso: 5, data_inicio_prevista: '2024-05-01', data_fim_prevista: '2024-06-30', active: true },
  { id: 'w2', contract_id: 'c1', lot_id: null, discipline_id: 'd-est', parent_id: null, codigo: '2', nome: 'Estrutura', nivel: 1, ordem: 2, criterio_medicao: 'volume', tem_acompanhamento_fisico: true, vinculado_marco: false, peso: 25, data_inicio_prevista: '2024-06-15', data_fim_prevista: '2024-12-30', active: true, disciplines: { nome: 'Estrutura' } },
  { id: 'w3', contract_id: 'c1', lot_id: null, discipline_id: 'd-arq', parent_id: null, codigo: '3', nome: 'Acabamentos', nivel: 1, ordem: 3, criterio_medicao: 'área', tem_acompanhamento_fisico: true, vinculado_marco: false, peso: 20, data_inicio_prevista: '2025-01-15', data_fim_prevista: '2025-08-30', active: true, disciplines: { nome: 'Arquitetura' } },
];

// ---- Programs CRUD ----------------------------------------------------------
export async function listPrograms(): Promise<Program[]> {
  if (SKIP_AUTH) return MOCK_PROGRAMS;
  checkSupabase();
  const r = await supabase.from('programs').select('*').is('deleted_at', null).order('codigo');
  fail(r.error);
  return (r.data || []) as Program[];
}

export async function upsertProgram(input: Omit<Program, 'id'> & { id?: string }): Promise<string> {
  if (SKIP_AUTH) return input.id || 'pg-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const row = { ...input, tenant_id: tenantId };
  if (input.id) {
    const { error } = await supabase.from('programs').update(row).eq('id', input.id);
    fail(error);
    return input.id;
  }
  const { data, error } = await supabase.from('programs').insert(row).select('id').single();
  fail(error);
  return data!.id;
}

export async function deleteProgram(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase.from('programs').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

// ---- Disciplines CRUD -------------------------------------------------------
export async function listDisciplines(): Promise<Discipline[]> {
  if (SKIP_AUTH) return MOCK_DISCIPLINES;
  checkSupabase();
  const r = await supabase.from('disciplines').select('*').is('deleted_at', null).order('ordem').order('codigo');
  fail(r.error);
  return (r.data || []) as Discipline[];
}

export async function upsertDiscipline(input: Omit<Discipline, 'id'> & { id?: string }): Promise<string> {
  if (SKIP_AUTH) return input.id || 'd-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const row = { ...input, tenant_id: tenantId };
  if (input.id) {
    const { error } = await supabase.from('disciplines').update(row).eq('id', input.id);
    fail(error);
    return input.id;
  }
  const { data, error } = await supabase.from('disciplines').insert(row).select('id').single();
  fail(error);
  return data!.id;
}

export async function deleteDiscipline(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase.from('disciplines').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

// ---- WBS CRUD (estrutura analítica do projeto por contrato) -----------------
export async function listWbs(contractId: string): Promise<WbsItem[]> {
  if (SKIP_AUTH) return MOCK_WBS.filter((w) => w.contract_id === contractId);
  checkSupabase();
  const r = await supabase
    .from('wbs_items')
    .select('*, disciplines(nome)')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
    .order('codigo');
  fail(r.error);
  return (r.data || []) as WbsItem[];
}

export async function upsertWbsItem(input: Omit<WbsItem, 'id' | 'disciplines'> & { id?: string }): Promise<string> {
  if (SKIP_AUTH) return input.id || 'w-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  const row = { ...input, tenant_id: tenantId };
  if (input.id) {
    const { error } = await supabase.from('wbs_items').update(row).eq('id', input.id);
    fail(error);
    return input.id;
  }
  const { data, error } = await supabase.from('wbs_items').insert(row).select('id').single();
  fail(error);
  return data!.id;
}

export async function deleteWbsItem(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase.from('wbs_items').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

// ---- Painéis agregados (visão executiva multi-contrato) ---------------------

export interface PortfolioByProgram {
  program_id: string | null;
  program_codigo: string | null;
  program_nome: string | null;
  program_orgao: string | null;
  contratos_count: number;
  contratos_ativos: number;
  valor_total: number;
  valor_aditado_total: number;
  valor_medido_total: number;
  valor_pago_total: number;
  percentual_financeiro_medio: number;
}

export interface PortfolioByOrgao {
  orgao: string;
  contratos_count: number;
  contratos_ativos: number;
  valor_total: number;
  valor_medido_total: number;
  valor_pago_total: number;
  percentual_financeiro_medio: number;
}

export interface PortfolioByMunicipio {
  uf: string;
  municipio: string;
  contratos_count: number;
  contratos_ativos: number;
  valor_total: number;
  valor_medido_total: number;
}

export interface AdditiveConsolidated {
  tenant_id: string;
  contract_id: string;
  contract_numero: string;
  contract_objeto: string;
  contract_valor_atual: number;
  contract_valor_inicial: number;
  additive_id: string;
  additive_numero: string;
  additive_tipo: string;
  additive_status: string;
  valor_acrescimo: number;
  valor_decrescimo: number;
  valor_liquido: number;
  dias_adicionais: number;
  percentual_individual: number;
  data_aprovacao: string | null;
  data_solicitacao: string | null;
  justificativa_valor: string | null;
  legal_basis: string | null;
  created_at: string;
}

export interface Pendencia {
  tenant_id: string;
  contract_id: string | null;
  contract_numero: string | null;
  pendencia_tipo: 'medicao_aprovacao' | 'grd_recebimento' | 'unforeseen_analise' | 'risco_alto';
  entity_id: string;
  descricao: string;
  desde: string;
  dias_aberta: number;
  severidade: 'low' | 'medium' | 'high';
}

export interface TenantSummary {
  tenant_id: string;
  contratos_total: number;
  contratos_ativos: number;
  valor_carteira_total: number;
  valor_medido_total: number;
  valor_pago_total: number;
  valor_glosado_total: number;
  pendencias_total: number;
  pendencias_high: number;
}

// Mocks demo
const MOCK_PORTFOLIO_PROGRAM: PortfolioByProgram[] = [
  { program_id: 'pg-1', program_codigo: 'SAU-2024', program_nome: 'Saúde — Expansão hospitalar', program_orgao: 'SES/RJ', contratos_count: 3, contratos_ativos: 2, valor_total: 38_500_000, valor_aditado_total: 1_240_000, valor_medido_total: 22_100_000, valor_pago_total: 19_800_000, percentual_financeiro_medio: 57.4 },
  { program_id: 'pg-2', program_codigo: 'EDU-2024', program_nome: 'Educação — Reforma de escolas', program_orgao: 'SEEDUC/RJ', contratos_count: 5, contratos_ativos: 4, valor_total: 22_700_000, valor_aditado_total: 0, valor_medido_total: 8_400_000, valor_pago_total: 7_300_000, percentual_financeiro_medio: 37.0 },
  { program_id: null, program_codigo: null, program_nome: 'Sem programa', program_orgao: null, contratos_count: 1, contratos_ativos: 1, valor_total: 4_300_000, valor_aditado_total: 200_000, valor_medido_total: 1_200_000, valor_pago_total: 1_050_000, percentual_financeiro_medio: 26.7 },
];

const MOCK_PORTFOLIO_ORGAO: PortfolioByOrgao[] = [
  { orgao: 'SES/RJ',      contratos_count: 3, contratos_ativos: 2, valor_total: 38_500_000, valor_medido_total: 22_100_000, valor_pago_total: 19_800_000, percentual_financeiro_medio: 57.4 },
  { orgao: 'SEEDUC/RJ',   contratos_count: 5, contratos_ativos: 4, valor_total: 22_700_000, valor_medido_total: 8_400_000,  valor_pago_total: 7_300_000,  percentual_financeiro_medio: 37.0 },
  { orgao: 'Prefeitura',  contratos_count: 1, contratos_ativos: 1, valor_total: 4_300_000,  valor_medido_total: 1_200_000,  valor_pago_total: 1_050_000,  percentual_financeiro_medio: 26.7 },
];

const MOCK_PORTFOLIO_MUNICIPIO: PortfolioByMunicipio[] = [
  { uf: 'RJ', municipio: 'Rio de Janeiro',   contratos_count: 4, contratos_ativos: 3, valor_total: 28_400_000, valor_medido_total: 16_300_000 },
  { uf: 'RJ', municipio: 'Niterói',          contratos_count: 2, contratos_ativos: 2, valor_total: 18_700_000, valor_medido_total: 9_100_000 },
  { uf: 'RJ', municipio: 'Petrópolis',       contratos_count: 2, contratos_ativos: 1, valor_total: 11_200_000, valor_medido_total: 4_600_000 },
  { uf: 'RJ', municipio: 'Nova Iguaçu',      contratos_count: 1, contratos_ativos: 1, valor_total: 7_200_000,  valor_medido_total: 1_700_000 },
];

const MOCK_ADDITIVES_CONS: AdditiveConsolidated[] = [
  { tenant_id: 't', contract_id: 'c1', contract_numero: 'CT-2024/0042', contract_objeto: 'Construção de Hospital Regional', contract_valor_atual: 12_950_000, contract_valor_inicial: 12_500_000, additive_id: 'a1', additive_numero: '01/2025', additive_tipo: 'acrescimo', additive_status: 'aprovado', valor_acrescimo: 450_000, valor_decrescimo: 0, valor_liquido: 450_000, dias_adicionais: 45, percentual_individual: 3.6, data_aprovacao: '2025-08-10', data_solicitacao: '2025-07-12', justificativa_valor: 'Inclusão de itens não previstos no PE', legal_basis: 'Lei 14.133/21, art. 124', created_at: '2025-07-12T10:00:00Z' },
];

const MOCK_PENDENCIAS: Pendencia[] = [
  { tenant_id: 't', contract_id: 'c1', contract_numero: 'CT-2024/0042', pendencia_tipo: 'medicao_aprovacao', entity_id: 'm1', descricao: 'Medição n.º 7 em aprovação há 18 dias', desde: '2025-10-27T10:00:00Z', dias_aberta: 18, severidade: 'medium' },
  { tenant_id: 't', contract_id: 'c1', contract_numero: 'CT-2024/0042', pendencia_tipo: 'risco_alto', entity_id: 'fs1', descricao: 'Contrato CT-2024/0042: Atraso físico: 65% temporal vs 58.3% executado', desde: '2025-11-14T10:00:00Z', dias_aberta: 0, severidade: 'high' },
  { tenant_id: 't', contract_id: 'c2', contract_numero: 'CT-2024/0107', pendencia_tipo: 'grd_recebimento', entity_id: 'gr1', descricao: 'GRD GRD-00007 sem confirmação há 8 dias', desde: '2025-11-06T14:00:00Z', dias_aberta: 8, severidade: 'medium' },
  { tenant_id: 't', contract_id: 'c1', contract_numero: 'CT-2024/0042', pendencia_tipo: 'unforeseen_analise', entity_id: 'u1', descricao: 'Item não previsto "Reforço estrutural" em em_analise há 22 dias', desde: '2025-10-23T08:00:00Z', dias_aberta: 22, severidade: 'high' },
];

const MOCK_SUMMARY: TenantSummary = {
  tenant_id: 't', contratos_total: 9, contratos_ativos: 7, valor_carteira_total: 65_500_000,
  valor_medido_total: 31_700_000, valor_pago_total: 28_150_000, valor_glosado_total: 380_000,
  pendencias_total: 4, pendencias_high: 2,
};

export async function getPortfolioByProgram(): Promise<PortfolioByProgram[]> {
  if (SKIP_AUTH) return MOCK_PORTFOLIO_PROGRAM;
  checkSupabase();
  const r = await supabase.from('v_portfolio_by_program').select('*').order('valor_total', { ascending: false });
  fail(r.error);
  return (r.data || []) as PortfolioByProgram[];
}

export async function getPortfolioByOrgao(): Promise<PortfolioByOrgao[]> {
  if (SKIP_AUTH) return MOCK_PORTFOLIO_ORGAO;
  checkSupabase();
  const r = await supabase.from('v_portfolio_by_orgao').select('*').order('valor_total', { ascending: false });
  fail(r.error);
  return (r.data || []) as PortfolioByOrgao[];
}

export async function getPortfolioByMunicipio(): Promise<PortfolioByMunicipio[]> {
  if (SKIP_AUTH) return MOCK_PORTFOLIO_MUNICIPIO;
  checkSupabase();
  const r = await supabase.from('v_portfolio_by_municipio').select('*').order('valor_total', { ascending: false });
  fail(r.error);
  return (r.data || []) as PortfolioByMunicipio[];
}

export async function getAdditivesConsolidated(): Promise<AdditiveConsolidated[]> {
  if (SKIP_AUTH) return MOCK_ADDITIVES_CONS;
  checkSupabase();
  const r = await supabase.from('v_additives_consolidated').select('*').order('created_at', { ascending: false });
  fail(r.error);
  return (r.data || []) as AdditiveConsolidated[];
}

export async function getPendencias(filterSeverity?: 'low' | 'medium' | 'high'): Promise<Pendencia[]> {
  if (SKIP_AUTH) return filterSeverity ? MOCK_PENDENCIAS.filter((p) => p.severidade === filterSeverity) : MOCK_PENDENCIAS;
  checkSupabase();
  let q = supabase.from('v_pendencias').select('*').order('dias_aberta', { ascending: false });
  if (filterSeverity) q = q.eq('severidade', filterSeverity);
  const r = await q;
  fail(r.error);
  return (r.data || []) as Pendencia[];
}

export async function getTenantSummary(): Promise<TenantSummary | null> {
  if (SKIP_AUTH) return MOCK_SUMMARY;
  checkSupabase();
  const tenantId = typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
  let q = supabase.from('v_tenant_summary').select('*');
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const r = await q.maybeSingle();
  fail(r.error);
  return r.data as TenantSummary | null;
}

// ---- GRD --------------------------------------------------------------------

export interface GedTransmittalListItem {
  id: string;
  contract_id: string | null;
  numero: string;
  title: string;
  status: 'rascunho' | 'enviada' | 'recebida_parcial' | 'recebida' | 'cancelada';
  sender_id: string | null;
  recipient_organization_id: string | null;
  sent_at: string | null;
  created_at: string;
  contract_numero: string | null;
  recipient_nome: string | null;
  recipient_cnpj: string | null;
  sender_nome: string | null;
  docs_count: number;
  receipts_total: number;
  receipts_confirmed: number;
  metadata?: { pdf_path?: string; pdf_hash?: string; validation_code?: string };
}

export interface GedTransmittalDocument {
  id: string;
  transmittal_id: string;
  document_version_id: string;
  finalidade: string | null;
  ged_document_versions?: {
    id: string; revision: string; storage_path: string;
    file_size: number | null; mime_type: string | null; hash_sha256: string | null;
    ged_documents?: {
      id: string; title: string; numero: string | null; nomenclature_code: string | null;
      ged_categories?: { codigo: string; nome: string };
    };
  };
}

export interface GedReceipt {
  id: string;
  transmittal_id: string;
  recipient_id: string | null;
  status: 'pendente' | 'recebida' | 'recusada';
  confirmed_at: string | null;
  signature_method: string | null;
  comment: string | null;
  member?: { nome: string; email: string } | null;
}

const MOCK_TRANSMITTAL_LIST: GedTransmittalListItem[] = [
  {
    id: 'tr-1', contract_id: 'c1', numero: 'GRD-00001', title: 'Remessa inicial de projetos executivos',
    status: 'recebida', sender_id: 'm-gest', recipient_organization_id: 'org-3',
    sent_at: '2024-05-02T10:00:00Z', created_at: '2024-05-02T09:55:00Z',
    contract_numero: 'CT-2024/0042', recipient_nome: 'Construtora Alvorada Ltda.', recipient_cnpj: '12.345.678/0001-00',
    sender_nome: 'Eduardo Vargas', docs_count: 24, receipts_total: 1, receipts_confirmed: 1,
  },
  {
    id: 'tr-2', contract_id: 'c1', numero: 'GRD-00007', title: 'Revisão 03 da planta arquitetônica',
    status: 'enviada', sender_id: 'm-fiscal', recipient_organization_id: 'org-3',
    sent_at: '2025-09-21T14:30:00Z', created_at: '2025-09-21T14:25:00Z',
    contract_numero: 'CT-2024/0042', recipient_nome: 'Construtora Alvorada Ltda.', recipient_cnpj: '12.345.678/0001-00',
    sender_nome: 'Patrícia Lopes', docs_count: 1, receipts_total: 1, receipts_confirmed: 0,
  },
];

export async function listTransmittals(contractId?: string | null): Promise<GedTransmittalListItem[]> {
  if (SKIP_AUTH) {
    return contractId ? MOCK_TRANSMITTAL_LIST.filter((t) => t.contract_id === contractId) : MOCK_TRANSMITTAL_LIST;
  }
  checkSupabase();
  let q = supabase.from('v_ged_transmittals').select('*').order('created_at', { ascending: false });
  if (contractId) q = q.eq('contract_id', contractId);
  const r = await q;
  fail(r.error);
  return (r.data || []) as GedTransmittalListItem[];
}

export async function getTransmittal(id: string): Promise<GedTransmittalListItem | null> {
  if (SKIP_AUTH) return MOCK_TRANSMITTAL_LIST.find((t) => t.id === id) || null;
  checkSupabase();
  const r = await supabase.from('v_ged_transmittals').select('*').eq('id', id).maybeSingle();
  fail(r.error);
  return r.data as GedTransmittalListItem | null;
}

export async function listTransmittalDocuments(transmittalId: string): Promise<GedTransmittalDocument[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase
    .from('ged_transmittal_documents')
    .select(`*, ged_document_versions(id, revision, storage_path, file_size, mime_type, hash_sha256,
      ged_documents(id, title, numero, nomenclature_code,
        ged_categories(codigo, nome)
      )
    )`)
    .eq('transmittal_id', transmittalId)
    .is('deleted_at', null);
  fail(r.error);
  return (r.data || []) as GedTransmittalDocument[];
}

export async function listTransmittalReceipts(transmittalId: string): Promise<GedReceipt[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase
    .from('ged_receipts')
    .select('*, member:members!ged_receipts_recipient_id_fkey(nome, email)')
    .eq('transmittal_id', transmittalId)
    .is('deleted_at', null)
    .order('created_at');
  fail(r.error);
  return (r.data || []) as GedReceipt[];
}

export async function issueGrd(input: {
  contract_id: string;
  recipient_organization_id: string;
  title: string;
  document_version_ids: string[];
  finalidades?: string[];
}): Promise<string> {
  if (SKIP_AUTH) return 'tr-' + Math.random().toString(36).slice(2, 10);
  checkSupabase();
  const { data, error } = await supabase.rpc('issue_grd', {
    p_contract_id: input.contract_id,
    p_recipient_organization_id: input.recipient_organization_id,
    p_title: input.title,
    p_document_version_ids: input.document_version_ids,
    p_finalidades: input.finalidades && input.finalidades.length > 0 ? input.finalidades : null,
    p_metadata: {},
  });
  fail(error);
  return data as string;
}

export async function sendGrd(transmittalId: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase.rpc('send_grd', { p_transmittal_id: transmittalId });
  fail(error);
}

export async function cancelGrd(transmittalId: string, reason?: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase.rpc('cancel_grd', {
    p_transmittal_id: transmittalId,
    p_reason: reason || null,
  });
  fail(error);
}

export async function confirmGrdReceipt(transmittalId: string, observacao?: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const { error } = await supabase.rpc('confirm_grd_receipt', {
    p_transmittal_id: transmittalId,
    p_observacao: observacao || null,
  });
  fail(error);
}

export async function generateGrdPdf(transmittalId: string): Promise<{ storage_path: string; validation_url: string; docs_count: number } | null> {
  if (SKIP_AUTH) {
    console.info('[demo] generateGrdPdf', transmittalId);
    return { storage_path: 'demo/grd.pdf', validation_url: 'https://contratos.consultegeo.org/v/DEMOABCD', docs_count: 0 };
  }
  return await callFn('issue-grd-pdf', { transmittal_id: transmittalId });
}

export async function listContractOrganizations(contractId: string): Promise<Array<{ id: string; nome: string; cnpj: string | null; tipo: string | null }>> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase
    .from('contracts')
    .select(`
      contratante:contract_organizations!contracts_contratante_id_fkey(id, nome, cnpj),
      contratada:contract_organizations!contracts_contratada_id_fkey(id, nome, cnpj),
      gerenciadora:contract_organizations!contracts_gerenciadora_id_fkey(id, nome, cnpj)
    `)
    .eq('id', contractId)
    .maybeSingle();
  fail(r.error);
  const out: Array<{ id: string; nome: string; cnpj: string | null; tipo: string | null }> = [];
  const seen = new Set<string>();
  for (const [tipo, org] of [['contratante', r.data?.contratante], ['contratada', r.data?.contratada], ['gerenciadora', r.data?.gerenciadora]]) {
    const o = org as { id?: string; nome?: string; cnpj?: string | null } | null;
    if (o && o.id && !seen.has(o.id)) {
      seen.add(o.id);
      out.push({ id: o.id, nome: o.nome || '—', cnpj: o.cnpj || null, tipo: tipo as string });
    }
  }
  return out;
}

// =============================================================================
// CRUD: WORKFLOW TEMPLATES + STEPS
// =============================================================================

function getActiveTenantId(): string | null {
  return typeof window !== 'undefined' ? window.localStorage.getItem('geocon:active_tenant') : null;
}

export async function createWorkflowTemplate(input: {
  nome: string;
  entity_type: WorkflowTemplate['entity_type'];
  contract_id?: string | null;
}): Promise<string> {
  if (SKIP_AUTH) {
    console.info('[demo] createWorkflowTemplate', input);
    return 'wt-' + Math.random().toString(36).slice(2, 10);
  }
  checkSupabase();
  const tenantId = getActiveTenantId();
  const { data: me } = await supabase.from('members').select('id').eq('tenant_id', tenantId).eq('active', true).maybeSingle();
  const { data, error } = await supabase
    .from('workflow_templates')
    .insert({
      tenant_id: tenantId,
      contract_id: input.contract_id || null,
      nome: input.nome,
      entity_type: input.entity_type,
      active: true,
      created_by: me?.id || null,
    })
    .select('id').single();
  fail(error);
  return data!.id as string;
}

export async function updateWorkflowTemplate(id: string, patch: { nome?: string; active?: boolean; contract_id?: string | null }): Promise<void> {
  if (SKIP_AUTH) { console.info('[demo] updateWorkflowTemplate', id, patch); return; }
  checkSupabase();
  const { error } = await supabase.from('workflow_templates')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

export async function deleteWorkflowTemplate(id: string): Promise<void> {
  if (SKIP_AUTH) { console.info('[demo] deleteWorkflowTemplate', id); return; }
  checkSupabase();
  const { error } = await supabase.from('workflow_templates')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

export async function createWorkflowStep(input: {
  template_id: string;
  ordem: number;
  nome: string;
  role_required: string;
  sla_hours: number;
  assinatura_obrigatoria: boolean;
  actions: string[];
}): Promise<string> {
  if (SKIP_AUTH) {
    console.info('[demo] createWorkflowStep', input);
    return 'ws-' + Math.random().toString(36).slice(2, 10);
  }
  checkSupabase();
  const tenantId = getActiveTenantId();
  const { data, error } = await supabase.from('workflow_steps').insert({
    tenant_id: tenantId,
    template_id: input.template_id,
    ordem: input.ordem,
    nome: input.nome,
    role_required: input.role_required,
    sla_hours: input.sla_hours,
    assinatura_obrigatoria: input.assinatura_obrigatoria,
    actions: input.actions,
  }).select('id').single();
  fail(error);
  return data!.id as string;
}

export async function updateWorkflowStep(id: string, patch: Partial<{
  nome: string; role_required: string; sla_hours: number;
  assinatura_obrigatoria: boolean; actions: string[]; ordem: number;
}>): Promise<void> {
  if (SKIP_AUTH) { console.info('[demo] updateWorkflowStep', id, patch); return; }
  checkSupabase();
  const { error } = await supabase.from('workflow_steps')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

export async function deleteWorkflowStep(id: string): Promise<void> {
  if (SKIP_AUTH) { console.info('[demo] deleteWorkflowStep', id); return; }
  checkSupabase();
  const { error } = await supabase.from('workflow_steps')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

export async function reorderWorkflowSteps(templateId: string, stepIds: string[]): Promise<number> {
  if (SKIP_AUTH) { console.info('[demo] reorderWorkflowSteps', templateId, stepIds); return stepIds.length; }
  checkSupabase();
  const { data, error } = await supabase.rpc('reorder_workflow_steps', {
    p_template_id: templateId,
    p_step_ids: stepIds,
  });
  fail(error);
  return data as number;
}

/** Lista contratos do tenant para vincular templates. Retorna formato leve. */
export async function listContractsLite(): Promise<Array<{ id: string; numero: string; objeto: string }>> {
  if (SKIP_AUTH) {
    return MOCK_CONTRACTS.slice(0, 5).map((c) => ({ id: c.id, numero: c.numero, objeto: c.objeto }));
  }
  checkSupabase();
  const r = await supabase.from('contracts')
    .select('id, numero, objeto')
    .is('deleted_at', null).order('numero');
  fail(r.error);
  return (r.data || []) as Array<{ id: string; numero: string; objeto: string }>;
}

// =============================================================================
// MAGIC LINK — fluxo PÚBLICO (sem auth) consumido pela rota /aprovar/:token
// =============================================================================

import { hasSupabase as _hasSupabase } from './supabase';

export interface MagicLinkPreview {
  ok: true;
  tenant_id: string;
  recipient_email: string;
  recipient_member_id: string | null;
  expires_at: string;
  step: {
    id: string;
    measurement_id: string;
    ordem: number;
    nome: string;
    role_required: string;
    status: 'pendente' | 'aprovado' | 'devolvido' | 'reprovado' | 'ignorado';
    due_at: string | null;
  };
  measurement: {
    id: string;
    numero: number | string;
    periodo_inicio: string | null;
    periodo_fim: string | null;
    valor_bruto: number | null;
    valor_liquido: number | null;
    status: string;
  };
  contract: {
    id: string;
    numero: string;
    objeto: string;
  };
}

/** Resolve base URL para chamar a EF approve-magic-link sem auth. */
function magicLinkEndpoint(): string | null {
  if (typeof window === 'undefined') return null;
  const url = window.GEOCON_CONFIG?.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
  if (!url) return null;
  return `${url.replace(/\/$/, '')}/functions/v1/approve-magic-link`;
}

/** Preview público — não exige login. Lança Error com mensagem amigável se falhar. */
export async function getMagicLinkPreview(token: string): Promise<MagicLinkPreview> {
  if (SKIP_AUTH) {
    return {
      ok: true,
      tenant_id: 't1',
      recipient_email: 'fiscal@consultegeo.org',
      recipient_member_id: 'm-fiscal',
      expires_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      step: {
        id: 'as-3', measurement_id: 'm1-6', ordem: 3, nome: 'Gestor do contrato',
        role_required: 'gestor_contrato', status: 'pendente',
        due_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      },
      measurement: {
        id: 'm1-6', numero: 6,
        periodo_inicio: '2025-10-01', periodo_fim: '2025-10-31',
        valor_bruto: 482500, valor_liquido: 461150, status: 'em_aprovacao',
      },
      contract: { id: 'c1', numero: 'CT-2024/0142', objeto: 'Reforma e ampliação da Escola Municipal Bairro Alto' },
    };
  }

  if (!_hasSupabase) {
    throw new Error('Backend não configurado. Configure SUPABASE_URL e SUPABASE_ANON_KEY.');
  }
  const endpoint = magicLinkEndpoint();
  if (!endpoint) throw new Error('SUPABASE_URL não disponível em runtime');

  // O anon key é exigido pelo gateway das Edge Functions mesmo para EFs públicas
  const anon = (typeof window !== 'undefined' && window.GEOCON_CONFIG?.SUPABASE_ANON_KEY)
    || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  const r = await fetch(`${endpoint}?token=${encodeURIComponent(token)}`, {
    method: 'GET',
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json?.ok === false) {
    throw new Error(json?.error || `Falha ao validar link (status ${r.status})`);
  }
  return json as MagicLinkPreview;
}

export async function consumeMagicLink(input: {
  token: string;
  action: 'aprovar' | 'devolver' | 'reprovar';
  comment?: string | null;
  signature_method?: string | null;
}): Promise<{ ok: true; step_id: string; new_status: string; measurement_id: string }> {
  if (SKIP_AUTH) {
    console.info('[demo] consumeMagicLink', input);
    return { ok: true, step_id: 'as-3', new_status: input.action === 'aprovar' ? 'aprovado' : input.action === 'devolver' ? 'devolvido' : 'reprovado', measurement_id: 'm1-6' };
  }
  if (!_hasSupabase) throw new Error('Backend não configurado');
  const endpoint = magicLinkEndpoint();
  if (!endpoint) throw new Error('SUPABASE_URL não disponível em runtime');

  const anon = (typeof window !== 'undefined' && window.GEOCON_CONFIG?.SUPABASE_ANON_KEY)
    || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anon, Authorization: `Bearer ${anon}`,
    },
    body: JSON.stringify({
      token: input.token,
      action: input.action,
      comment: input.comment ?? null,
      signature_method: input.signature_method ?? null,
    }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json?.ok === false) {
    throw new Error(json?.error || `Falha ao processar (status ${r.status})`);
  }
  return {
    ok: true,
    step_id: json.result?.step_id || '',
    new_status: json.result?.new_status || '',
    measurement_id: json.result?.measurement_id || '',
  };
}
