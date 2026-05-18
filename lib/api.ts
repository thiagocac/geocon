import { supabase, hasSupabase, SKIP_AUTH, SITE_URL } from './supabase';
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
      { id: 'org-1', nome: 'Secretaria de Estado de Saúde — SES/RJ', cnpj: '12.345.678/0001-90', tipo: 'orgao' },
      { id: 'org-2', nome: 'Secretaria de Estado de Educação — SEEDUC/RJ', cnpj: '00.000.000/0001-11', tipo: 'contratante' },
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
      { id: 'l-c1-1', contract_id: 'c1', nome: 'Bloco cirúrgico — pavimento 1',  codigo: 'BC-P1', municipio: 'Rio de Janeiro', uf: 'RJ', endereco: 'Av. Brasil, 4365 — Manguinhos', latitude: -22.8770, longitude: -43.2461, valor_obra: 8_200_000, prazo_dias: 240, crea_responsavel: '021.234-5/RJ', status: 'ativo' },
      { id: 'l-c1-2', contract_id: 'c1', nome: 'Bloco cirúrgico — pavimento 2',  codigo: 'BC-P2', municipio: 'Rio de Janeiro', uf: 'RJ', endereco: 'Av. Brasil, 4365 — Manguinhos', latitude: -22.8770, longitude: -43.2461, valor_obra: 4_300_000, prazo_dias: 180, crea_responsavel: '021.234-5/RJ', status: 'ativo' },
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
  // V56: validade temporal
  data_validade: string | null;
  dias_alerta_antes: number;
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
  // V56: validade temporal (campos opcionais — backend só preenche se data_validade não é null)
  data_validade: string | null;
  dias_alerta_antes: number | null;
  dias_para_vencimento: number | null;
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
    data_validade: null, dias_alerta_antes: null, dias_para_vencimento: null,
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
    data_validade: null, dias_alerta_antes: null, dias_para_vencimento: null,
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
    data_validade: null, dias_alerta_antes: null, dias_para_vencimento: null,
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
    data_validade: null, dias_alerta_antes: null, dias_para_vencimento: null,
  },
  // V56: 3 docs com validade temporal — ARTs, licenças e ASOs típicos
  {
    id: 'doc-5', contract_id: 'c1', numero: '00021', nomenclature_code: 'CT-2024/0042-ART-00021',
    title: 'ART do responsável técnico — Eng. Eduardo Vargas',
    description: 'Anotação de Responsabilidade Técnica (CREA-RJ 021.234-5/D) — gestão da obra.',
    status: 'aprovado', revisao_atual: '0', data_documento: '2025-06-03',
    category_codigo: 'ART', category_nome: 'Documentos legais',
    contract_numero: 'CT-2024/0042', responsavel_nome: 'Eduardo Vargas',
    current_version_path: 'demo/path', file_size: 320_000, mime_type: 'application/pdf', versions_count: 1,
    created_at: '2025-06-04T11:00:00Z',
    data_validade: '2026-06-03', dias_alerta_antes: 30, dias_para_vencimento: 18,
  },
  {
    id: 'doc-6', contract_id: 'c1', numero: '00007', nomenclature_code: 'CT-2024/0042-LIC-00007',
    title: 'Licença ambiental de operação — LO 045/2024',
    description: 'Licença ambiental SEAMB/RJ — operação canteiro de obras.',
    status: 'aprovado', revisao_atual: '0', data_documento: '2025-05-12',
    category_codigo: 'LIC', category_nome: 'Documentos legais',
    contract_numero: 'CT-2024/0042', responsavel_nome: 'Patrícia Lopes',
    current_version_path: 'demo/path', file_size: 1_200_000, mime_type: 'application/pdf', versions_count: 1,
    created_at: '2025-05-13T08:30:00Z',
    data_validade: '2026-05-20', dias_alerta_antes: 30, dias_para_vencimento: 4,
  },
  {
    id: 'doc-7', contract_id: 'c2', numero: '00033', nomenclature_code: 'CT-2024/0107-ASO-00033',
    title: 'ASO admissional — Marcelo Souza (pedreiro)',
    description: 'Atestado de Saúde Ocupacional — admissão setembro/2024.',
    status: 'aprovado', revisao_atual: '0', data_documento: '2025-04-30',
    category_codigo: 'ASO', category_nome: 'SST',
    contract_numero: 'CT-2024/0107', responsavel_nome: 'Ricardo Mendes',
    current_version_path: 'demo/path', file_size: 180_000, mime_type: 'application/pdf', versions_count: 1,
    created_at: '2025-05-01T10:00:00Z',
    data_validade: '2026-05-04', dias_alerta_antes: 60, dias_para_vencimento: -12,
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
  // V57: validade temporal opcional (chamada subsequente após criar o doc)
  data_validade?: string | null;
  dias_alerta_antes?: number;
}): Promise<string> {
  if (SKIP_AUTH) {
    console.info('[demo] createGedDocument', input.title, input.file.name, input.data_validade);
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

  // V57: se validade foi informada, encadeia chamada para setar (RPC separada)
  const docId = data as string;
  if (input.data_validade && docId) {
    try {
      await supabase.rpc('update_ged_document_validity', {
        p_document_id:   docId,
        p_data_validade: input.data_validade,
        p_dias_alerta:   input.dias_alerta_antes ?? 30,
      });
    } catch (e) {
      // Não falha a criação se validade falhar — apenas registra
      console.warn('[createGedDocument] falha ao setar validade:', e);
    }
  }

  return docId;

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
  // V56
  data_validade: string | null;
  dias_alerta_antes: number | null;
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
  status: 'vigente' | 'obsoleta' | 'rascunho' | 'em_aprovacao' | 'reprovada';
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

// V56: MOCK_DOC_DETAIL_BY_ID — permite o detail page ler doc-5/6/7 (com validade)
//      além do doc-1 default. Mantemos campos opcionais com fallback razoável.
const MOCK_DOC_DETAIL_BY_ID: Record<string, GedDocumentDetail> = {
  'doc-1': {
    id: 'doc-1', tenant_id: 't-1', category_id: 'cat-con', contract_id: 'c1',
    numero: '00001', nomenclature_code: 'CT-2024/0042-CON-00001',
    title: 'Termo de contrato CT-2024/0042 — assinatura original',
    description: 'Contrato original assinado entre as partes em 15/04/2024.',
    status: 'aprovado', revisao_atual: '0', data_documento: '2024-04-15',
    responsavel_id: 'm-edu', keywords: ['contrato', 'assinatura'],
    has_physical_original: true, metadata: {},
    created_at: '2024-04-16T10:00:00Z',
    data_validade: null, dias_alerta_antes: null,
    ged_categories: { id: 'cat-con', codigo: 'CON', nome: 'Contratual', nomenclature_pattern: null, requires_physical_original: true },
    contracts: { id: 'c1', numero: 'CT-2024/0042', titulo: 'Construção de Hospital Regional' },
    responsavel: { nome: 'Eduardo Vargas', email: 'eduardo@example.com' },
  },
  'doc-5': {
    id: 'doc-5', tenant_id: 't-1', category_id: 'cat-art', contract_id: 'c1',
    numero: '00021', nomenclature_code: 'CT-2024/0042-ART-00021',
    title: 'ART do responsável técnico — Eng. Eduardo Vargas',
    description: 'Anotação de Responsabilidade Técnica (CREA-RJ 021.234-5/D) — gestão da obra.',
    status: 'aprovado', revisao_atual: '0', data_documento: '2024-04-01',
    responsavel_id: 'm-edu', keywords: ['ART', 'CREA', 'RT'],
    has_physical_original: true, metadata: { crea: '021.234-5/D' },
    created_at: '2024-04-02T11:00:00Z',
    data_validade: '2025-12-03', dias_alerta_antes: 30,
    ged_categories: { id: 'cat-art', codigo: 'ART', nome: 'Documentos legais', nomenclature_pattern: null, requires_physical_original: true },
    contracts: { id: 'c1', numero: 'CT-2024/0042', titulo: 'Construção de Hospital Regional' },
    responsavel: { nome: 'Eduardo Vargas', email: 'eduardo@example.com' },
  },
  'doc-6': {
    id: 'doc-6', tenant_id: 't-1', category_id: 'cat-lic', contract_id: 'c1',
    numero: '00007', nomenclature_code: 'CT-2024/0042-LIC-00007',
    title: 'Licença ambiental de operação — LO 045/2024',
    description: 'Licença ambiental SEAMB/RJ — operação canteiro de obras.',
    status: 'aprovado', revisao_atual: '0', data_documento: '2024-05-12',
    responsavel_id: 'm-pat', keywords: ['licença', 'ambiental', 'canteiro'],
    has_physical_original: true, metadata: { orgao: 'SEAMB/RJ', numero_processo: 'LO 045/2024' },
    created_at: '2024-05-13T08:30:00Z',
    data_validade: '2025-11-19', dias_alerta_antes: 30,
    ged_categories: { id: 'cat-lic', codigo: 'LIC', nome: 'Documentos legais', nomenclature_pattern: null, requires_physical_original: true },
    contracts: { id: 'c1', numero: 'CT-2024/0042', titulo: 'Construção de Hospital Regional' },
    responsavel: { nome: 'Patrícia Lopes', email: 'patricia@example.com' },
  },
  'doc-7': {
    id: 'doc-7', tenant_id: 't-1', category_id: 'cat-aso', contract_id: 'c2',
    numero: '00033', nomenclature_code: 'CT-2024/0107-ASO-00033',
    title: 'ASO admissional — Marcelo Souza (pedreiro)',
    description: 'Atestado de Saúde Ocupacional — admissão setembro/2024.',
    status: 'aprovado', revisao_atual: '0', data_documento: '2024-09-15',
    responsavel_id: 'm-ric', keywords: ['ASO', 'admissional', 'SST'],
    has_physical_original: false, metadata: { funcao: 'pedreiro', empregador: 'Construtora Alfa' },
    created_at: '2024-09-16T10:00:00Z',
    data_validade: '2025-11-03', dias_alerta_antes: 60,
    ged_categories: { id: 'cat-aso', codigo: 'ASO', nome: 'SST', nomenclature_pattern: null, requires_physical_original: false },
    contracts: { id: 'c2', numero: 'CT-2024/0107', titulo: 'Reforma de Escolas SEEDUC Niterói' },
    responsavel: { nome: 'Ricardo Mendes', email: 'ricardo@example.com' },
  },
};

const MOCK_DOC_DETAIL: GedDocumentDetail = {
  id: 'doc-1', tenant_id: 't-1', category_id: 'cat-prj', contract_id: 'c1',
  numero: '00012', nomenclature_code: 'CT-2024/0042-PRJ-ARQ-00012-R3',
  title: 'Planta arquitetônica — pavimento 2',
  description: 'Planta arquitetônica do pavimento 2 do bloco cirúrgico.',
  status: 'em_revisao', revisao_atual: '3', data_documento: '2025-09-20',
  responsavel_id: 'm-pat', keywords: ['arquitetura', 'pavimento2', 'cirurgia'],
  has_physical_original: false, metadata: { disciplina: 'ARQ', fase: 'PE' },
  created_at: '2025-08-10T14:00:00Z',
  data_validade: null, dias_alerta_antes: null,
  ged_categories: { id: 'cat-prj', codigo: 'PRJ', nome: 'Projetos', nomenclature_pattern: null, requires_physical_original: false },
  contracts: { id: 'c1', numero: 'CT-2024/0042', titulo: 'Construção de Hospital Regional' },
  responsavel: { nome: 'Patrícia Lopes', email: 'patricia@example.com' },
};

const MOCK_VERSIONS: GedDocumentVersion[] = [
  { id: 'v3', document_id: 'doc-1', revision: '3', storage_path: 'demo/r3.pdf', mime_type: 'application/pdf', file_size: 8_500_000, hash_sha256: 'a1b2c3...', status: 'em_aprovacao',  uploaded_by: 'm-pat', uploaded_at: '2025-09-20T10:00:00Z',
    extracted_text:
`MEMORIAL DESCRITIVO — BLOCO CIRÚRGICO
Hospital Municipal do Rio de Janeiro · CT-2024/0042
Revisão 3 · 20/09/2025

1. OBJETO
Reforma e ampliação do bloco cirúrgico, incluindo sala híbrida e ala de recuperação pós-anestésica.

2. ESPECIFICAÇÕES TÉCNICAS
2.1 Estrutura: concreto armado fck=30MPa, conforme ABNT NBR 6118:2014.
2.2 Alvenaria: bloco cerâmico de vedação 9x19x29cm.
2.3 Revestimento: porcelanato técnico 60x60cm, classe PEI-5, áreas comuns.
2.4 Sistema elétrico: quadros TR-2 e TR-3, com no-break dedicado para sala híbrida.
2.5 HVAC: pressão positiva nas salas de cirurgia, filtros HEPA H14.
2.6 Pisos hospitalares: vinílico condutivo nas salas de cirurgia.

3. NORMAS APLICÁVEIS
NBR 6118:2014, NBR 7117:2012, NBR 7256:2005, RDC 50/2002 ANVISA.

4. CRONOGRAMA
Prazo de execução: 240 dias corridos a partir da ordem de serviço.

5. RESPONSÁVEL TÉCNICO
Eng. Eduardo Vargas · CREA-RJ 021.234-5/D
ART 2025/RJ/0042-A`,
    uploader: { nome: 'Patrícia Lopes' } },
  { id: 'v2', document_id: 'doc-1', revision: '2', storage_path: 'demo/r2.pdf', mime_type: 'application/pdf', file_size: 8_300_000, hash_sha256: 'd4e5f6...', status: 'obsoleta', uploaded_by: 'm-pat', uploaded_at: '2025-08-15T10:00:00Z',
    extracted_text:
`MEMORIAL DESCRITIVO — BLOCO CIRÚRGICO
Hospital Municipal do Rio de Janeiro · CT-2024/0042
Revisão 2 · 15/08/2025

1. OBJETO
Reforma do bloco cirúrgico, incluindo ala de recuperação pós-anestésica.

2. ESPECIFICAÇÕES TÉCNICAS
2.1 Estrutura: concreto armado fck=25MPa, conforme ABNT NBR 6118:2014.
2.2 Alvenaria: bloco cerâmico de vedação 9x19x29cm.
2.3 Revestimento: porcelanato técnico 60x60cm, classe PEI-5, áreas comuns.
2.4 Sistema elétrico: quadros TR-2 e TR-3.
2.5 HVAC: filtros HEPA H13.

3. NORMAS APLICÁVEIS
NBR 6118:2014, NBR 7117:2012, RDC 50/2002 ANVISA.

4. CRONOGRAMA
Prazo de execução: 180 dias corridos a partir da ordem de serviço.

5. RESPONSÁVEL TÉCNICO
Eng. Eduardo Vargas · CREA-RJ 021.234-5/D
ART 2025/RJ/0042-A`,
    uploader: { nome: 'Patrícia Lopes' } },
  { id: 'v1', document_id: 'doc-1', revision: '1', storage_path: 'demo/r1.pdf', mime_type: 'application/pdf', file_size: 8_100_000, hash_sha256: '789abc...', status: 'obsoleta', uploaded_by: 'm-pat', uploaded_at: '2025-08-10T14:00:00Z',
    extracted_text:
`MEMORIAL DESCRITIVO — BLOCO CIRÚRGICO
Hospital Municipal do Rio de Janeiro · CT-2024/0042
Revisão 1 · 10/08/2025

1. OBJETO
Reforma do bloco cirúrgico.

2. ESPECIFICAÇÕES TÉCNICAS
2.1 Estrutura: concreto armado fck=25MPa.
2.2 Alvenaria: bloco cerâmico.
2.3 Sistema elétrico: quadros TR-2 e TR-3.

3. CRONOGRAMA
Prazo de execução: 180 dias.

4. RESPONSÁVEL TÉCNICO
Eng. Eduardo Vargas · CREA-RJ 021.234-5/D`,
    uploader: { nome: 'Patrícia Lopes' } },
];

const MOCK_ACCESS: GedAccessLogEntry[] = [
  { id: 'l1', document_id: 'doc-1', member_id: 'm-fis', action: 'view',     occurred_at: '2025-09-21T09:00:00Z', member: { nome: 'Ricardo Mendes',  email: 'ricardo@example.com' } },
  { id: 'l2', document_id: 'doc-1', member_id: 'm-fis', action: 'download', occurred_at: '2025-09-21T09:01:00Z', member: { nome: 'Ricardo Mendes',  email: 'ricardo@example.com' } },
  { id: 'l3', document_id: 'doc-1', member_id: 'm-pat', action: 'view',     occurred_at: '2025-09-20T10:05:00Z', member: { nome: 'Patrícia Lopes',  email: 'patricia@example.com' } },
];

export async function getGedDocument(id: string): Promise<GedDocumentDetail | null> {
  if (SKIP_AUTH) return MOCK_DOC_DETAIL_BY_ID[id] ?? MOCK_DOC_DETAIL;
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

/**
 * V58 — Busca apenas o texto extraído de uma versão específica.
 * Útil para diff entre revisões sem trazer storage_path/hash/etc.
 */
export async function getGedVersionExtractedText(versionId: string): Promise<{
  id: string;
  revision: string;
  extracted_text: string | null;
  uploaded_at: string;
} | null> {
  if (SKIP_AUTH) {
    const v = MOCK_VERSIONS.find((x) => x.id === versionId);
    return v ? { id: v.id, revision: v.revision, extracted_text: v.extracted_text, uploaded_at: v.uploaded_at } : null;
  }
  checkSupabase();
  const r = await supabase
    .from('ged_document_versions')
    .select('id, revision, extracted_text, uploaded_at')
    .eq('id', versionId).is('deleted_at', null).maybeSingle();
  fail(r.error);
  return r.data as { id: string; revision: string; extracted_text: string | null; uploaded_at: string } | null;
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
  pendencia_tipo: 'medicao_aprovacao' | 'grd_recebimento' | 'unforeseen_analise' | 'risco_alto'
                | 'vicio_aberto' | 'par_defesa' | 'garantia_vencendo'
                | 'sancao_multa_pendente' | 'recebimento_definitivo_atrasado';
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
  // V35-V38 (migration 047 + V49 mock data extension):
  { tenant_id: 't', contract_id: 'c3', contract_numero: 'CT-2024/0211', pendencia_tipo: 'vicio_aberto', entity_id: 'v1', descricao: 'Vício "Concreto fora de fck" aberto há 12 dias · severidade alta', desde: '2025-11-02T09:00:00Z', dias_aberta: 12, severidade: 'high' },
  { tenant_id: 't', contract_id: 'c2', contract_numero: 'CT-2024/0107', pendencia_tipo: 'par_defesa', entity_id: 'p1', descricao: 'PAR-2025/003 em defesa · prazo limite 2025-11-20', desde: '2025-11-05T10:00:00Z', dias_aberta: 9, severidade: 'medium' },
  { tenant_id: 't', contract_id: 'c4', contract_numero: 'CT-2024/0298', pendencia_tipo: 'garantia_vencendo', entity_id: 'g1', descricao: 'Garantia GA-00128 (Caução em dinheiro) vence em 6 dias', desde: '2025-11-08T12:00:00Z', dias_aberta: 6, severidade: 'high' },
  { tenant_id: 't', contract_id: 'c2', contract_numero: 'CT-2024/0107', pendencia_tipo: 'sancao_multa_pendente', entity_id: 's1', descricao: 'Multa de R$ 245.000,00 não paga (vencida há 18 dias)', desde: '2025-10-27T15:00:00Z', dias_aberta: 18, severidade: 'high' },
  { tenant_id: 't', contract_id: 'c5', contract_numero: 'CT-2024/0334', pendencia_tipo: 'recebimento_definitivo_atrasado', entity_id: 'r1', descricao: 'Recebimento provisório de 2025-08-15 sem definitivo (limite +90d ultrapassado)', desde: '2025-08-15T14:00:00Z', dias_aberta: 92, severidade: 'medium' },
];

const MOCK_SUMMARY: TenantSummary = {
  tenant_id: 't', contratos_total: 9, contratos_ativos: 7, valor_carteira_total: 65_500_000,
  valor_medido_total: 31_700_000, valor_pago_total: 28_150_000, valor_glosado_total: 380_000,
  // V50: counts atualizados após V49 expandir MOCK_PENDENCIAS para 9 (5 high, 4 medium)
  pendencias_total: 9, pendencias_high: 5,
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

// =============================================================================
// Item 11 — submit, payment, bulk-decide, reports, labels, workflow status
// =============================================================================

export type ReportVariant = 'carteira' | 'pendencias' | 'curva_s' | 'glosas' | 'top_glosas' | 'health';

export interface ReportResponse<T = Record<string, unknown>> {
  ok: boolean;
  meta: { variant: ReportVariant; total_rows: number; generated_at: string; contract_id?: string | null };
  data: T[];
}

export interface MeasurementWorkflowStatus {
  measurement_id: string;
  tenant_id: string;
  contract_id: string;
  measurement_status: string;
  total_steps: number;
  approved_steps: number;
  pending_steps: number;
  returned_steps: number;
  rejected_steps: number;
  pct_concluido: number;
  next_step_ordem: number | null;
  next_step_due_at: string | null;
  proximo_step_sla: 'sem_sla' | 'atrasado' | 'urgente' | 'no_prazo';
}

/** Submete uma medição (rascunho/preliminar/devolvida → em_aprovacao). */
export async function submitMeasurement(measurementId: string): Promise<{
  measurement_id: string;
  new_status: string;
  items: number;
  pending_validations: number;
  workflow_steps_created: number;
}> {
  if (SKIP_AUTH) {
    return { measurement_id: measurementId, new_status: 'em_aprovacao', items: 0, pending_validations: 0, workflow_steps_created: 4 };
  }
  const res = await callFn<{ ok: boolean; result?: Record<string, unknown> }>('submit-measurement', {
    measurement_id: measurementId,
  });
  const r = (res?.result ?? {}) as Record<string, unknown>;
  return {
    measurement_id: String(r.measurement_id || measurementId),
    new_status: String(r.new_status || 'em_aprovacao'),
    items: Number(r.items || 0),
    pending_validations: Number(r.pending_validations || 0),
    workflow_steps_created: Number(r.workflow_steps_created || 0),
  };
}

/** Registra evento de pagamento de uma medição aprovada/paga. */
export async function registerPaymentEvent(input: {
  measurement_id: string;
  valor_pago: number;
  data_pagamento: string;
  numero_ordem_bancaria?: string | null;
  nota_fiscal?: string | null;
  observacao?: string | null;
}): Promise<string> {
  if (SKIP_AUTH) {
    console.info('[demo] registerPaymentEvent', input);
    return 'pay-' + Math.random().toString(36).slice(2, 10);
  }
  const res = await callFn<{ ok: boolean; event_id?: string }>('register-payment', {
    measurement_id: input.measurement_id,
    valor_pago: input.valor_pago,
    data_pagamento: input.data_pagamento,
    numero_ordem_bancaria: input.numero_ordem_bancaria ?? null,
    nota_fiscal: input.nota_fiscal ?? null,
    observacao: input.observacao ?? null,
  });
  return String(res?.event_id || '');
}

/** Decide múltiplos steps de uma vez (mesma ação, mesmo comentário). */
export async function bulkDecideApprovalSteps(input: {
  step_ids: string[];
  action: 'aprovar' | 'devolver' | 'reprovar';
  comment?: string;
  signature_method?: string | null;
}): Promise<{ processed: number; failed: number; errors: Array<{ step_id: string; error: string }> }> {
  if (SKIP_AUTH) {
    return { processed: input.step_ids.length, failed: 0, errors: [] };
  }
  checkSupabase();
  const { data, error } = await supabase.rpc('bulk_decide_approval_steps', {
    p_step_ids: input.step_ids,
    p_action: input.action,
    p_comment: input.comment || null,
    p_signature_method: input.signature_method || null,
  });
  fail(error);
  const d = (data as Record<string, unknown>) || {};
  return {
    processed: Number(d.processed || 0),
    failed: Number(d.failed || 0),
    errors: (d.errors as Array<{ step_id: string; error: string }>) || [],
  };
}

/** Busca um relatório como JSON. */
export async function fetchReport<T = Record<string, unknown>>(
  variant: ReportVariant,
  contractId?: string | null,
): Promise<ReportResponse<T>> {
  if (SKIP_AUTH) {
    return { ok: true, meta: { variant, total_rows: 0, generated_at: new Date().toISOString(), contract_id: contractId ?? null }, data: [] };
  }
  const res = await callFn<ReportResponse<T>>('generate-report', {
    variant, format: 'json', contract_id: contractId ?? null,
  });
  return res;
}

/** Baixa o CSV de um relatório (aciona download no navegador). */
export async function downloadReportCsv(variant: ReportVariant, contractId?: string | null): Promise<void> {
  if (SKIP_AUTH) {
    console.info('[demo] downloadReportCsv', variant, contractId);
    return;
  }
  checkSupabase();
  const { data, error } = await supabase.functions.invoke('generate-report', {
    body: { variant, format: 'csv', contract_id: contractId ?? null },
  });
  fail(error);
  // supabase-js auto-detects text/csv → string; também aceita Blob direto
  const csv = typeof data === 'string' ? data : await (data as Blob).text();
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = `${variant}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
}

/** Gera PDF de etiquetas GED (abre em nova aba). */
export async function printGedLabels(documentIds: string[]): Promise<void> {
  if (SKIP_AUTH) {
    console.info('[demo] printGedLabels', documentIds);
    return;
  }
  if (documentIds.length === 0) throw new Error('Selecione ao menos 1 documento');
  if (documentIds.length > 48) throw new Error('Máximo de 48 etiquetas por requisição');
  checkSupabase();
  const { data, error } = await supabase.functions.invoke('generate-labels-pdf', {
    body: { document_ids: documentIds },
  });
  fail(error);
  // application/pdf → Blob
  const blob = data instanceof Blob ? data : new Blob([data as ArrayBuffer], { type: 'application/pdf' });
  const objUrl = URL.createObjectURL(blob);
  window.open(objUrl, '_blank');
  setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
}

/** Lê o status do workflow de uma medição (view v_measurement_workflow_status). */
export async function getMeasurementWorkflowStatus(measurementId: string): Promise<MeasurementWorkflowStatus | null> {
  if (SKIP_AUTH) return null;
  checkSupabase();
  const { data, error } = await supabase
    .from('v_measurement_workflow_status')
    .select('*')
    .eq('measurement_id', measurementId)
    .maybeSingle();
  fail(error);
  return (data as MeasurementWorkflowStatus | null) || null;
}

// =============================================================================
// Tracking / AdditiveDetail helpers (V4)
// =============================================================================

export interface ContractItemRecord {
  id: string;
  contract_id: string;
  parent_id: string | null;
  discipline_id: string | null;
  lot_id: string | null;
  codigo: string;
  descricao: string;
  unidade: string | null;
  nivel: number;
  ordem: number;
  quantidade_contratada: number;
  quantidade_aditada: number;
  quantidade_medida_acumulada: number;
  preco_unitario: number;
  bdi_percentual: number;
  fonte_referencia: string | null;
  codigo_referencia: string | null;
  is_title: boolean;
  is_extra: boolean;
  active: boolean;
  data_liberacao_medicao: string | null;
}

export interface ItemMeasurementRow {
  measurement_id: string;
  measurement_numero: number;
  complementar_numero: number;
  measurement_status: string;
  periodo_inicio: string;
  periodo_fim: string;
  measurement_item_id: string;
  quantidade_periodo: number;
  quantidade_acumulada_antes: number;
  quantidade_acumulada_incl_periodo: number;
  valor_periodo: number;
  valor_glosado: number;
  valor_liquido: number;
  validacao_status: string;
}

export interface AdditiveItemRow {
  id: string;
  additive_id: string;
  contract_item_id: string | null;
  tipo: 'acrescimo' | 'decrescimo' | 'extra_novo';
  codigo: string | null;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  preco_unitario: number;
  valor_total: number;
}

export interface AdditiveDetailRecord {
  id: string;
  contract_id: string;
  numero: number;
  tipo: string;
  status: string;
  data_solicitacao: string;
  data_aprovacao: string | null;
  valor_acrescimo: number;
  valor_decrescimo: number;
  valor_liquido: number;
  prazo_execucao_acrescimo_dias: number;
  prazo_vigencia_acrescimo_dias: number;
  percentual_sobre_inicial: number | null;
  justificativa_valor: string | null;
  justificativa_prazo: string | null;
  legal_basis: string | null;
  created_at: string;
}

const MOCK_CONTRACT_ITEM: ContractItemRecord = {
  id: 'ci-demo', contract_id: 'c1', parent_id: null, discipline_id: null, lot_id: null,
  codigo: '3.1', descricao: 'Concreto estrutural C30 — pilares', unidade: 'm³',
  nivel: 2, ordem: 1,
  quantidade_contratada: 850, quantidade_aditada: 45, quantidade_medida_acumulada: 612,
  preco_unitario: 620, bdi_percentual: 22.5,
  fonte_referencia: 'SINAPI', codigo_referencia: '92873',
  is_title: false, is_extra: false, active: true,
  data_liberacao_medicao: '2024-05-01',
};

const MOCK_ITEM_MEASUREMENTS: ItemMeasurementRow[] = [
  { measurement_id: 'm6', measurement_numero: 6, complementar_numero: 0, measurement_status: 'paga',
    periodo_inicio: '2024-09-01', periodo_fim: '2024-09-30', measurement_item_id: 'mi6',
    quantidade_periodo: 120, quantidade_acumulada_antes: 80, quantidade_acumulada_incl_periodo: 200,
    valor_periodo: 74400, valor_glosado: 22300, valor_liquido: 52100, validacao_status: 'ok' },
  { measurement_id: 'm7', measurement_numero: 7, complementar_numero: 0, measurement_status: 'paga',
    periodo_inicio: '2024-10-01', periodo_fim: '2024-10-31', measurement_item_id: 'mi7',
    quantidade_periodo: 140, quantidade_acumulada_antes: 200, quantidade_acumulada_incl_periodo: 340,
    valor_periodo: 86800, valor_glosado: 0, valor_liquido: 86800, validacao_status: 'ok' },
  { measurement_id: 'm8', measurement_numero: 8, complementar_numero: 0, measurement_status: 'aprovada',
    periodo_inicio: '2024-11-01', periodo_fim: '2024-11-30', measurement_item_id: 'mi8',
    quantidade_periodo: 152, quantidade_acumulada_antes: 340, quantidade_acumulada_incl_periodo: 492,
    valor_periodo: 94240, valor_glosado: 0, valor_liquido: 94240, validacao_status: 'ok' },
];

const MOCK_ADDITIVE_ITEMS: AdditiveItemRow[] = [
  { id: 'ai1', additive_id: 'a1', contract_item_id: 'ci-demo', tipo: 'acrescimo',
    codigo: '3.1', descricao: 'Concreto estrutural C30 — pilares', unidade: 'm³',
    quantidade: 45, preco_unitario: 620, valor_total: 27900 },
  { id: 'ai2', additive_id: 'a1', contract_item_id: null, tipo: 'extra_novo',
    codigo: 'EXT-001', descricao: 'Reforço estrutural — fundação adicional P12', unidade: 'vb',
    quantidade: 1, preco_unitario: 422100, valor_total: 422100 },
];

const MOCK_ADDITIVE_DETAIL: AdditiveDetailRecord = {
  id: 'a1', contract_id: 'c1', numero: 1, tipo: 'valor', status: 'aprovado',
  data_solicitacao: '2025-07-12', data_aprovacao: '2025-08-10',
  valor_acrescimo: 450_000, valor_decrescimo: 0, valor_liquido: 450_000,
  prazo_execucao_acrescimo_dias: 45, prazo_vigencia_acrescimo_dias: 60,
  percentual_sobre_inicial: 3.6,
  justificativa_valor: 'Inclusão de itens não previstos no PE: reforço estrutural P12 e ajuste de quantidade de concreto C30.',
  justificativa_prazo: 'Necessidade técnica de aguardar cura completa do reforço antes de prosseguir para próxima etapa.',
  legal_basis: 'Lei 14.133/2021, art. 124',
  created_at: '2025-07-12T10:00:00Z',
};

/** Busca um contract_item completo. */
export async function getContractItem(itemId: string): Promise<ContractItemRecord | null> {
  if (SKIP_AUTH) return { ...MOCK_CONTRACT_ITEM, id: itemId };
  checkSupabase();
  const r = await supabase.from('contract_items').select('*').eq('id', itemId).is('deleted_at', null).maybeSingle();
  fail(r.error);
  return (r.data as ContractItemRecord | null) || null;
}

/** Lista as participações do item em medições (com dados da medição pai). */
export async function listMeasurementItemsByContractItem(contractItemId: string): Promise<ItemMeasurementRow[]> {
  if (SKIP_AUTH) return MOCK_ITEM_MEASUREMENTS;
  checkSupabase();
  const r = await supabase
    .from('measurement_items')
    .select(`
      id,
      quantidade_periodo, quantidade_acumulada_antes, quantidade_acumulada_incl_periodo,
      valor_periodo, valor_glosado, valor_liquido, validacao_status,
      measurements (id, numero, complementar_numero, status, periodo_inicio, periodo_fim, deleted_at)
    `)
    .eq('contract_item_id', contractItemId)
    .is('deleted_at', null);
  fail(r.error);
  type Row = {
    id: string;
    quantidade_periodo: number | null;
    quantidade_acumulada_antes: number | null;
    quantidade_acumulada_incl_periodo: number | null;
    valor_periodo: number | null;
    valor_glosado: number | null;
    valor_liquido: number | null;
    validacao_status: string;
    measurements: {
      id: string;
      numero: number;
      complementar_numero: number;
      status: string;
      periodo_inicio: string;
      periodo_fim: string;
      deleted_at: string | null;
    } | null;
  };
  return ((r.data || []) as unknown as Row[])
    .filter((x) => x.measurements && !x.measurements.deleted_at)
    .map((x) => ({
      measurement_id: x.measurements!.id,
      measurement_numero: x.measurements!.numero,
      complementar_numero: x.measurements!.complementar_numero,
      measurement_status: x.measurements!.status,
      periodo_inicio: x.measurements!.periodo_inicio,
      periodo_fim: x.measurements!.periodo_fim,
      measurement_item_id: x.id,
      quantidade_periodo: Number(x.quantidade_periodo || 0),
      quantidade_acumulada_antes: Number(x.quantidade_acumulada_antes || 0),
      quantidade_acumulada_incl_periodo: Number(x.quantidade_acumulada_incl_periodo || 0),
      valor_periodo: Number(x.valor_periodo || 0),
      valor_glosado: Number(x.valor_glosado || 0),
      valor_liquido: Number(x.valor_liquido || 0),
      validacao_status: x.validacao_status,
    }))
    .sort((a, b) => (a.periodo_fim < b.periodo_fim ? -1 : a.periodo_fim > b.periodo_fim ? 1 : 0));
}

/** Busca um aditivo completo. */
export async function getAdditive(additiveId: string): Promise<AdditiveDetailRecord | null> {
  if (SKIP_AUTH) return { ...MOCK_ADDITIVE_DETAIL, id: additiveId };
  checkSupabase();
  const r = await supabase.from('additives').select('*').eq('id', additiveId).is('deleted_at', null).maybeSingle();
  fail(r.error);
  return (r.data as AdditiveDetailRecord | null) || null;
}

/** Lista itens de um aditivo. */
export async function listAdditiveItems(additiveId: string): Promise<AdditiveItemRow[]> {
  if (SKIP_AUTH) return MOCK_ADDITIVE_ITEMS;
  checkSupabase();
  const r = await supabase.from('additive_items').select('*').eq('additive_id', additiveId).is('deleted_at', null).order('created_at');
  fail(r.error);
  return (r.data || []) as AdditiveItemRow[];
}

// =============================================================================
// Generated reports history + Audit log (V5)
// =============================================================================

export interface GeneratedReport {
  id: string;
  contract_id: string | null;
  report_type: string;
  title: string;
  storage_path: string | null;
  mime_type: string | null;
  filters: Record<string, unknown>;
  status: 'processando' | 'gerado' | 'erro' | 'cancelado';
  generated_by: string | null;
  generated_at: string;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  source: string | null;
  severity: 'info' | 'warn' | 'error';
  metadata: Record<string, unknown>;
  created_at: string;
  actor?: { nome: string; email: string } | null;
}

const MOCK_GENERATED_REPORTS: GeneratedReport[] = [
  { id: 'gr1', contract_id: 'c1', report_type: 'carteira',
    title: 'Carteira — Outubro/2025', storage_path: '/reports/c1-carteira-202510.pdf',
    mime_type: 'application/pdf', filters: {}, status: 'gerado',
    generated_by: 'm1', generated_at: '2025-10-31T18:00:00Z', created_at: '2025-10-31T18:00:00Z' },
  { id: 'gr2', contract_id: 'c1', report_type: 'glosas',
    title: 'Mapa de glosas — Outubro/2025', storage_path: '/reports/c1-glosas-202510.csv',
    mime_type: 'text/csv', filters: {}, status: 'gerado',
    generated_by: 'm1', generated_at: '2025-10-31T18:05:00Z', created_at: '2025-10-31T18:05:00Z' },
];

const MOCK_AUDIT_LOG: AuditLogEntry[] = [
  { id: 'a1', tenant_id: 't', actor_id: 'm1', entity_type: 'measurement', entity_id: 'med-13',
    action: 'submit', before_value: { status: 'rascunho' }, after_value: { status: 'em_aprovacao' },
    source: 'submit-measurement EF', severity: 'info', metadata: { items: 7 },
    created_at: '2025-11-12T14:23:00Z',
    actor: { nome: 'Thiago Vieira', email: 'thiago@consultegeo.com.br' } },
  { id: 'a2', tenant_id: 't', actor_id: 'm2', entity_type: 'additive', entity_id: 'ad-01',
    action: 'approve', before_value: { status: 'em_aprovacao' }, after_value: { status: 'aprovado' },
    source: 'decide_approval_step', severity: 'info', metadata: {},
    created_at: '2025-11-10T09:15:00Z',
    actor: { nome: 'Helena Soares', email: 'helena@arcoiris.eng.br' } },
  { id: 'a3', tenant_id: 't', actor_id: null, entity_type: 'ged_transmittal', entity_id: 'grd-005',
    action: 'sla_overdue', before_value: null, after_value: null,
    source: 'check-sla-overdue (cron)', severity: 'warn', metadata: { dias_em_atraso: 12 },
    created_at: '2025-11-08T03:00:00Z', actor: null },
];

/** Lista relatórios gerados (com filtro opcional por contrato). */
export async function listGeneratedReports(contractId?: string | null): Promise<GeneratedReport[]> {
  if (SKIP_AUTH) return contractId
    ? MOCK_GENERATED_REPORTS.filter((r) => r.contract_id === contractId || !r.contract_id)
    : MOCK_GENERATED_REPORTS;
  checkSupabase();
  let q = supabase.from('generated_reports').select('*').is('deleted_at', null).order('generated_at', { ascending: false }).limit(50);
  if (contractId) q = q.eq('contract_id', contractId);
  const r = await q;
  fail(r.error);
  return (r.data || []) as GeneratedReport[];
}

/** Cria URL assinada para um relatório gerado (storage). */
export async function getGeneratedReportUrl(storagePath: string): Promise<string | null> {
  if (SKIP_AUTH) return null;
  checkSupabase();
  const { data } = await supabase.storage.from('reports').createSignedUrl(storagePath, 300);
  return data?.signedUrl ?? null;
}

/** Lista entradas do audit_log com filtros opcionais. */
export async function listAuditLog(input: {
  entity_type?: string | null;
  entity_id?: string | null;
  severity?: 'info' | 'warn' | 'error' | null;
  limit?: number;
} = {}): Promise<AuditLogEntry[]> {
  if (SKIP_AUTH) {
    let arr = MOCK_AUDIT_LOG;
    if (input.entity_type) arr = arr.filter((a) => a.entity_type === input.entity_type);
    if (input.entity_id) arr = arr.filter((a) => a.entity_id === input.entity_id);
    if (input.severity) arr = arr.filter((a) => a.severity === input.severity);
    return arr;
  }
  checkSupabase();
  let q = supabase
    .from('audit_log')
    .select('*, actor:members(nome, email)')
    .order('created_at', { ascending: false })
    .limit(input.limit ?? 200);
  if (input.entity_type) q = q.eq('entity_type', input.entity_type);
  if (input.entity_id) q = q.eq('entity_id', input.entity_id);
  if (input.severity) q = q.eq('severity', input.severity);
  const r = await q;
  fail(r.error);
  type Row = AuditLogEntry & { actor: { nome: string; email: string }[] | null };
  return ((r.data || []) as unknown as Row[]).map((x) => ({
    ...x,
    actor: Array.isArray(x.actor) && x.actor.length > 0 ? x.actor[0] : null,
  }));
}

// =============================================================================
// My pending approvals (V8) — agrega steps assignados ao usuário corrente
// =============================================================================

export interface PendingApprovalRow {
  step_id: string;
  measurement_id: string;
  measurement_numero: number;
  measurement_complementar: number;
  measurement_status: string;
  measurement_valor_liquido: number;
  contract_id: string;
  contract_numero: string;
  contract_objeto: string;
  step_ordem: number;
  step_nome: string;
  role_required: string;
  due_at: string | null;
  created_at: string;
  dias_pendente: number;
  sla: 'no_prazo' | 'urgente' | 'atrasado' | 'sem_sla';
}

const MOCK_PENDING_APPROVALS: PendingApprovalRow[] = [
  { step_id: 's1', measurement_id: 'm7', measurement_numero: 7, measurement_complementar: 0,
    measurement_status: 'em_aprovacao', measurement_valor_liquido: 412_300,
    contract_id: 'c1', contract_numero: 'CT-2024/0042',
    contract_objeto: 'Construção de Hospital Regional',
    step_ordem: 2, step_nome: 'Fiscalização técnica', role_required: 'fiscal',
    due_at: new Date(Date.now() - 86400_000).toISOString(),
    created_at: new Date(Date.now() - 86400_000 * 5).toISOString(),
    dias_pendente: 5, sla: 'atrasado' },
  { step_id: 's2', measurement_id: 'm12', measurement_numero: 12, measurement_complementar: 0,
    measurement_status: 'em_aprovacao', measurement_valor_liquido: 287_640,
    contract_id: 'c1', contract_numero: 'CT-2024/0042',
    contract_objeto: 'Construção de Hospital Regional',
    step_ordem: 1, step_nome: 'Análise preliminar', role_required: 'fiscal',
    due_at: new Date(Date.now() + 86400_000 * 2).toISOString(),
    created_at: new Date(Date.now() - 86400_000 * 2).toISOString(),
    dias_pendente: 2, sla: 'no_prazo' },
  { step_id: 's3', measurement_id: 'm5', measurement_numero: 5, measurement_complementar: 1,
    measurement_status: 'em_aprovacao', measurement_valor_liquido: 95_120,
    contract_id: 'c2', contract_numero: 'CT-2024/0107',
    contract_objeto: 'Reforma de escolas — Lote 3',
    step_ordem: 2, step_nome: 'Aprovação gerencial', role_required: 'gestor_contrato',
    due_at: new Date(Date.now() + 12 * 3600_000).toISOString(),
    created_at: new Date(Date.now() - 86400_000 * 3).toISOString(),
    dias_pendente: 3, sla: 'urgente' },
];

/**
 * Lista todos os steps de aprovação pendentes assignados ao usuário corrente,
 * em qualquer contrato/medição do tenant.
 */
export async function listMyPendingApprovals(): Promise<PendingApprovalRow[]> {
  if (SKIP_AUTH) return MOCK_PENDING_APPROVALS;
  checkSupabase();

  // Descobrir member do auth.uid() corrente
  const { data: au } = await supabase.auth.getUser();
  const authId = au?.user?.id;
  if (!authId) return [];

  const memberRes = await supabase
    .from('members').select('id').eq('auth_id', authId).is('deleted_at', null).maybeSingle();
  const memberId = memberRes.data?.id;
  if (!memberId) return [];

  const r = await supabase
    .from('measurement_approval_steps')
    .select(`
      id, ordem, nome, role_required, due_at, created_at, status,
      measurements!inner (
        id, numero, complementar_numero, status, valor_liquido, deleted_at,
        contracts!inner ( id, numero, objeto, deleted_at )
      )
    `)
    .eq('status', 'pendente')
    .eq('assigned_to', memberId)
    .is('deleted_at', null)
    .order('due_at', { ascending: true, nullsFirst: false });

  fail(r.error);
  type Row = {
    id: string; ordem: number; nome: string; role_required: string;
    due_at: string | null; created_at: string;
    measurements: {
      id: string; numero: number; complementar_numero: number; status: string;
      valor_liquido: number; deleted_at: string | null;
      contracts: { id: string; numero: string; objeto: string; deleted_at: string | null } | null;
    } | null;
  };
  const now = Date.now();
  return ((r.data || []) as unknown as Row[])
    .filter((x) => x.measurements && !x.measurements.deleted_at && x.measurements.contracts && !x.measurements.contracts.deleted_at)
    .map((x) => {
      const m = x.measurements!;
      const c = m.contracts!;
      const created = new Date(x.created_at).getTime();
      const dias = Math.max(0, Math.floor((now - created) / 86400_000));
      let sla: PendingApprovalRow['sla'] = 'sem_sla';
      if (x.due_at) {
        const due = new Date(x.due_at).getTime();
        if (due < now) sla = 'atrasado';
        else if (due < now + 86400_000) sla = 'urgente';
        else sla = 'no_prazo';
      }
      return {
        step_id: x.id,
        measurement_id: m.id,
        measurement_numero: m.numero,
        measurement_complementar: m.complementar_numero,
        measurement_status: m.status,
        measurement_valor_liquido: Number(m.valor_liquido || 0),
        contract_id: c.id,
        contract_numero: c.numero,
        contract_objeto: c.objeto,
        step_ordem: x.ordem,
        step_nome: x.nome,
        role_required: x.role_required,
        due_at: x.due_at,
        created_at: x.created_at,
        dias_pendente: dias,
        sla,
      };
    });
}

// =============================================================================
// Risk analysis (V9) — v_contract_risk_analysis + v_top_critical_contracts
// =============================================================================

export interface RiskAnalysisRow {
  contract_id: string;
  tenant_id: string;
  numero: string;
  objeto: string;
  contratada_nome: string | null;
  valor_inicial: number;
  valor_atual: number;
  valor_aditado: number;
  valor_medido_acumulado: number;
  saldo_contratual: number;
  percentual_financeiro: number;
  percentual_fisico: number;
  alertas: string[];
  data_termino: string | null;
  status: string;
  gap_fis_fin: number;
  pct_aditivos_sobre_inicial: number;
  pct_saldo: number;
  pendencias_high: number;
  pendencias_medium: number;
  pendencias_total: number;
  pendencia_mais_antiga_dias: number;
  medicoes_em_aprovacao_atrasadas: number;
  forecast_3m: number | null;
  forecast_6m: number | null;
  forecast_12m: number | null;
  risk_flags: Record<string, unknown> | null;
  snapshot_at: string | null;
  score: number;
  score_avanco: number;
  score_alertas_legais: number;
  score_gap: number;
  score_saldo: number;
}

export interface TopCriticalContract {
  id: string;
  tenant_id: string;
  numero: string;
  objeto: string;
  contratada_nome: string | null;
  valor_atual: number;
  saldo_contratual: number;
  percentual_financeiro: number;
  percentual_fisico: number;
  score: number;
  score_avanco: number;
  score_alertas_legais: number;
  score_gap: number;
  score_saldo: number;
  pendencias_high: number;
  alertas: string[];
  nivel: 'critico' | 'atencao' | 'monitorar' | 'estavel';
}

export interface RiskRecommendation {
  tipo: string;
  prioridade: 'alta' | 'media' | 'baixa';
  titulo: string;
  descricao: string;
  acao_label: string;
  acao_href: string;
}

export interface ContractRiskRecommendations {
  contract_id: string;
  score: number;
  nivel: 'critico' | 'atencao' | 'monitorar' | 'estavel';
  computed_at: string;
  recommendations: RiskRecommendation[];
}

// Mock para SKIP_AUTH
const MOCK_TOP_CRITICAL: TopCriticalContract[] = MOCK_CONTRACTS.slice(0, 3).map((c, i) => ({
  id: c.id,
  tenant_id: 't1',
  numero: c.numero,
  objeto: c.objeto,
  contratada_nome: c.contratada_nome,
  valor_atual: c.valor_atual,
  saldo_contratual: c.saldo_contratual,
  percentual_financeiro: c.percentual_financeiro,
  percentual_fisico: c.percentual_fisico,
  score: [75, 55, 30][i] || 30,
  score_avanco: i === 0 ? 30 : 15,
  score_alertas_legais: i === 0 ? 25 : 0,
  score_gap: i === 1 ? 25 : 0,
  score_saldo: i === 0 ? 20 : 0,
  pendencias_high: i,
  alertas: c.alertas,
  nivel: i === 0 ? 'critico' : i === 1 ? 'atencao' : 'monitorar',
}));

export async function listTopCriticalContracts(limit = 5): Promise<TopCriticalContract[]> {
  if (SKIP_AUTH) return MOCK_TOP_CRITICAL.slice(0, limit);
  checkSupabase();
  const r = await supabase
    .from('v_top_critical_contracts')
    .select('*')
    .gt('score', 0)
    .limit(limit);
  fail(r.error);
  return (r.data || []) as TopCriticalContract[];
}

export async function getContractRiskAnalysis(contract_id: string): Promise<RiskAnalysisRow | null> {
  if (SKIP_AUTH) {
    const mock = MOCK_TOP_CRITICAL.find((c) => c.id === contract_id);
    if (!mock) return null;
    return {
      contract_id: mock.id,
      tenant_id: mock.tenant_id,
      numero: mock.numero,
      objeto: mock.objeto,
      contratada_nome: mock.contratada_nome,
      valor_inicial: mock.valor_atual * 0.9,
      valor_atual: mock.valor_atual,
      valor_aditado: mock.valor_atual * 0.1,
      valor_medido_acumulado: mock.valor_atual * (mock.percentual_financeiro / 100),
      saldo_contratual: mock.saldo_contratual,
      percentual_financeiro: mock.percentual_financeiro,
      percentual_fisico: mock.percentual_fisico,
      alertas: mock.alertas,
      data_termino: null,
      status: 'ativo',
      gap_fis_fin: mock.percentual_financeiro - mock.percentual_fisico,
      pct_aditivos_sobre_inicial: 11,
      pct_saldo: (mock.saldo_contratual / mock.valor_atual) * 100,
      pendencias_high: mock.pendencias_high,
      pendencias_medium: 0,
      pendencias_total: mock.pendencias_high,
      pendencia_mais_antiga_dias: 12,
      medicoes_em_aprovacao_atrasadas: 0,
      forecast_3m: 500000, forecast_6m: 1000000, forecast_12m: 2000000,
      risk_flags: null, snapshot_at: null,
      score: mock.score,
      score_avanco: mock.score_avanco,
      score_alertas_legais: mock.score_alertas_legais,
      score_gap: mock.score_gap,
      score_saldo: mock.score_saldo,
    };
  }
  checkSupabase();
  const r = await supabase
    .from('v_contract_risk_analysis')
    .select('*')
    .eq('contract_id', contract_id)
    .maybeSingle();
  fail(r.error);
  return (r.data || null) as RiskAnalysisRow | null;
}

export async function getContractRiskRecommendations(contract_id: string): Promise<ContractRiskRecommendations | null> {
  if (SKIP_AUTH) {
    const mock = MOCK_TOP_CRITICAL.find((c) => c.id === contract_id);
    if (!mock) return null;
    const recs: RiskRecommendation[] = [];
    if (mock.score_avanco >= 30) recs.push({
      tipo: 'avanco_alto', prioridade: 'alta',
      titulo: 'Contrato próximo do encerramento (≥ 95% medido)',
      descricao: 'Conduza pré-fechamento: validação documental, livro de medição encerrado, devolução de cauções.',
      acao_label: 'Ver financeiro', acao_href: `/contratos/${contract_id}/financeiro`,
    });
    if (mock.score_alertas_legais > 0) recs.push({
      tipo: 'alertas_legais', prioridade: 'alta',
      titulo: 'Alertas legais ativos',
      descricao: 'Há ' + (mock.alertas?.length || 0) + ' alerta(s) que requerem revisão.',
      acao_label: 'Editar contrato', acao_href: `/contratos/${contract_id}/editar`,
    });
    if (mock.score_gap > 0) recs.push({
      tipo: 'gap_fis_fin', prioridade: 'alta',
      titulo: 'Avanço financeiro descolado do físico',
      descricao: 'Revise medições para identificar antecipações.',
      acao_label: 'Ver medições', acao_href: `/contratos/${contract_id}/medicoes`,
    });
    if (recs.length === 0) recs.push({
      tipo: 'estavel', prioridade: 'baixa',
      titulo: 'Contrato em condição saudável',
      descricao: 'Sem sinais de risco operacional ou financeiro.',
      acao_label: 'Ver financeiro', acao_href: `/contratos/${contract_id}/financeiro`,
    });
    return {
      contract_id, score: mock.score, nivel: mock.nivel,
      computed_at: new Date().toISOString(), recommendations: recs,
    };
  }
  checkSupabase();
  const r = await supabase.rpc('get_contract_risk_recommendations', { p_contract_id: contract_id });
  fail(r.error);
  return (r.data || null) as ContractRiskRecommendations | null;
}

// =============================================================================
// Backlog admin CRUD (V9)
// =============================================================================

export interface BacklogItem {
  id: string;
  numero: number;
  titulo: string;
  descricao: string | null;
  categoria: 'autorizacao' | 'ui_ux' | 'pdf' | 'email' | 'relatorios' | 'autenticacao' | 'tema' | 'integracao' | 'contratos' | 'medicoes' | 'ged' | 'outro';
  prioridade: 'baixa' | 'media' | 'alta';
  status: 'aberto' | 'em_andamento' | 'concluido' | 'cancelado';
  created_at: string;
  updated_at: string;
}

export async function listBacklog(): Promise<BacklogItem[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.from('admin_backlog').select('*').order('numero', { ascending: false });
  fail(r.error);
  return (r.data || []) as BacklogItem[];
}

export async function createBacklogItem(input: {
  titulo: string;
  descricao?: string | null;
  categoria: BacklogItem['categoria'];
  prioridade: BacklogItem['prioridade'];
}): Promise<BacklogItem> {
  checkSupabase();
  const r = await supabase
    .from('admin_backlog')
    .insert([{
      titulo: input.titulo,
      descricao: input.descricao ?? null,
      categoria: input.categoria,
      prioridade: input.prioridade,
      status: 'aberto',
    }])
    .select('*')
    .single();
  fail(r.error);
  return r.data as BacklogItem;
}

export async function updateBacklogItem(id: string, input: Partial<{
  titulo: string;
  descricao: string | null;
  categoria: BacklogItem['categoria'];
  prioridade: BacklogItem['prioridade'];
  status: BacklogItem['status'];
}>): Promise<BacklogItem> {
  checkSupabase();
  const r = await supabase
    .from('admin_backlog')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  fail(r.error);
  return r.data as BacklogItem;
}

// =============================================================================
// Audit log enhancements (V9) — date range filter (used by AuditLog page)
// =============================================================================

export async function listAuditLogRange(input: {
  entity_type?: string | null;
  entity_id?: string | null;
  severity?: 'info' | 'warn' | 'error' | null;
  date_from?: string | null;
  date_to?: string | null;
  actor_id?: string | null;
  limit?: number;
} = {}): Promise<AuditLogEntry[]> {
  if (SKIP_AUTH) {
    let arr = MOCK_AUDIT_LOG;
    if (input.entity_type) arr = arr.filter((a) => a.entity_type === input.entity_type);
    if (input.entity_id) arr = arr.filter((a) => a.entity_id === input.entity_id);
    if (input.severity) arr = arr.filter((a) => a.severity === input.severity);
    if (input.date_from) arr = arr.filter((a) => a.created_at >= input.date_from!);
    if (input.date_to) arr = arr.filter((a) => a.created_at <= input.date_to!);
    if (input.actor_id) arr = arr.filter((a) => a.actor_id === input.actor_id);
    return arr.slice(0, input.limit ?? 500);
  }
  checkSupabase();
  let q = supabase
    .from('audit_log')
    .select('*, actor:members(nome, email)')
    .order('created_at', { ascending: false })
    .limit(input.limit ?? 500);
  if (input.entity_type) q = q.eq('entity_type', input.entity_type);
  if (input.entity_id) q = q.eq('entity_id', input.entity_id);
  if (input.severity) q = q.eq('severity', input.severity);
  if (input.actor_id) q = q.eq('actor_id', input.actor_id);
  if (input.date_from) q = q.gte('created_at', input.date_from);
  if (input.date_to) q = q.lte('created_at', input.date_to);
  const r = await q;
  fail(r.error);
  type Row = AuditLogEntry & { actor: { nome: string; email: string }[] | null };
  return ((r.data || []) as unknown as Row[]).map((x) => ({
    ...x,
    actor: Array.isArray(x.actor) && x.actor.length > 0 ? x.actor[0] : null,
  }));
}

// =============================================================================
// Risk history (V10) — snapshots históricos do score
// =============================================================================

export interface RiskSnapshot {
  id: string;
  tenant_id: string;
  contract_id: string;
  captured_at: string;
  captured_date: string;
  score: number;
  score_avanco: number;
  score_alertas_legais: number;
  score_gap: number;
  score_saldo: number;
  nivel: 'critico' | 'atencao' | 'monitorar' | 'estavel';
  percentual_financeiro: number | null;
  percentual_fisico: number | null;
  saldo_contratual: number | null;
  pendencias_high: number;
  alertas: string[];
  source: 'manual' | 'auto_view' | 'cron' | 'pdf_export';
  captured_by_nome?: string | null;
}

export async function listRiskSnapshots(contract_id: string, limit = 30): Promise<RiskSnapshot[]> {
  if (SKIP_AUTH) {
    // Gera série sintética coerente para demo
    const out: RiskSnapshot[] = [];
    const baseScore = 55;
    const today = new Date();
    for (let i = 14; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400_000 * 2);
      const score = Math.max(0, Math.min(100, Math.round(baseScore + Math.sin(i / 3) * 15 + (Math.random() - 0.5) * 8)));
      const nivel: RiskSnapshot['nivel'] = score >= 70 ? 'critico' : score >= 40 ? 'atencao' : score >= 20 ? 'monitorar' : 'estavel';
      out.push({
        id: `mock-snap-${i}`,
        tenant_id: 't1',
        contract_id,
        captured_at: d.toISOString(),
        captured_date: d.toISOString().slice(0, 10),
        score,
        score_avanco: Math.round(score * 0.3),
        score_alertas_legais: score > 60 ? 25 : 0,
        score_gap: score > 50 ? 25 : 0,
        score_saldo: 0,
        nivel,
        percentual_financeiro: 50 + i,
        percentual_fisico: 45 + i,
        saldo_contratual: 1000000 - i * 20000,
        pendencias_high: score > 70 ? 2 : 0,
        alertas: score > 60 ? ['vigência'] : [],
        source: i === 0 ? 'auto_view' : 'cron',
      });
    }
    return out.slice(0, limit).reverse();
  }
  checkSupabase();
  const r = await supabase
    .from('v_contract_risk_history')
    .select('*')
    .eq('contract_id', contract_id)
    .order('captured_at', { ascending: false })
    .limit(limit);
  fail(r.error);
  return ((r.data || []) as RiskSnapshot[]);
}

export async function captureRiskSnapshot(contract_id: string, source: RiskSnapshot['source'] = 'auto_view'): Promise<RiskSnapshot | null> {
  if (SKIP_AUTH) return null;
  checkSupabase();
  const r = await supabase.rpc('capture_risk_snapshot', { p_contract_id: contract_id, p_source: source });
  fail(r.error);
  return (r.data || null) as RiskSnapshot | null;
}

export async function generateRiskAnalysisPdf(contract_id: string): Promise<{
  storage_path: string; hash_sha256: string; public_validation_code: string;
  validation_url: string; size_bytes: number; score: number; nivel: string;
}> {
  if (SKIP_AUTH) {
    return {
      storage_path: '/demo/risk.pdf', hash_sha256: 'demo-hash', public_validation_code: 'DEMO1234',
      validation_url: '/v/DEMO1234', size_bytes: 0, score: 55, nivel: 'atencao',
    };
  }
  checkSupabase();
  const { data, error } = await supabase.functions.invoke('generate-risk-analysis-pdf', { body: { contract_id } });
  if (error) throw new Error(humanizeError(error));
  if (!data?.ok) throw new Error(data?.error || 'Falha ao gerar PDF');
  return data;
}

export async function getReportSignedUrl(storage_path: string, expires_in_seconds = 300): Promise<string> {
  if (SKIP_AUTH) return storage_path;
  checkSupabase();
  const r = await supabase.storage.from('reports').createSignedUrl(storage_path, expires_in_seconds);
  fail(r.error);
  if (!r.data?.signedUrl) throw new Error('URL assinada não retornada');
  return r.data.signedUrl;
}

// =============================================================================
// Notification preferences (V11)
// =============================================================================

export type NotificationEventType =
  | 'measurement_approval_pending'
  | 'measurement_decided'
  | 'grd_received'
  | 'unforeseen_decision_pending'
  | 'additive_approval_pending'
  | 'pendency_high'
  | 'risk_critico'
  | 'digest_daily'
  | 'workflow_assignment'        // V65 — revisão GED aguardando aprovação
  | 'workflow_decided';          // V65 — revisão GED aprovada/devolvida/reprovada

export type NotificationChannel = 'in_app' | 'email';

export interface NotificationPrefRow {
  event_type: NotificationEventType;
  channel: NotificationChannel;
  enabled: boolean;
  pref_id: string | null;
  updated_at: string | null;
}

const EVENT_DEFAULTS: Record<NotificationEventType, boolean> = {
  measurement_approval_pending: true,
  measurement_decided: true,
  grd_received: true,
  unforeseen_decision_pending: true,
  additive_approval_pending: true,
  pendency_high: true,
  risk_critico: true,
  digest_daily: false,
  workflow_assignment: true,
  workflow_decided: true,
};

const ALL_EVENTS: NotificationEventType[] = [
  'measurement_approval_pending',
  'measurement_decided',
  'grd_received',
  'unforeseen_decision_pending',
  'additive_approval_pending',
  'pendency_high',
  'risk_critico',
  'digest_daily',
  'workflow_assignment',
  'workflow_decided',
];

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, { title: string; hint: string }> = {
  measurement_approval_pending: { title: 'Medição aguardando minha aprovação',           hint: 'Você é o aprovador de uma etapa pendente' },
  measurement_decided:          { title: 'Medição que enviei foi decidida',              hint: 'Aprovação ou rejeição em medição que você criou' },
  grd_received:                 { title: 'Recebi nova GRD',                              hint: 'Distribuição de documento dirigida a você' },
  unforeseen_decision_pending:  { title: 'Imprevisto aguardando minha decisão',          hint: 'Item imprevisto pendente de análise' },
  additive_approval_pending:    { title: 'Aditivo aguardando minha aprovação',           hint: 'Aditivo contratual em workflow' },
  pendency_high:                { title: 'Pendência crítica em contrato meu',            hint: 'Pendência prazo alto / risco operacional' },
  risk_critico:                 { title: 'Risco crítico detectado',                      hint: 'Score do contrato passou para zona crítica' },
  digest_daily:                 { title: 'Resumo diário (digest)',                       hint: 'Compilação noturna em vez de notificações individuais' },
  workflow_assignment:          { title: 'Revisão GED aguardando minha aprovação',       hint: 'Você é aprovador em workflow de documento (V65)' },
  workflow_decided:             { title: 'Revisão GED que enviei foi decidida',          hint: 'Aprovação/devolução/reprovação em revisão sua (V65)' },
};

const MOCK_PREFS: NotificationPrefRow[] = ALL_EVENTS.flatMap((e) => [
  { event_type: e, channel: 'in_app' as const, enabled: EVENT_DEFAULTS[e], pref_id: null, updated_at: null },
  { event_type: e, channel: 'email'  as const, enabled: EVENT_DEFAULTS[e], pref_id: null, updated_at: null },
]);

export async function listMyNotificationPrefs(): Promise<NotificationPrefRow[]> {
  if (SKIP_AUTH) return MOCK_PREFS;
  checkSupabase();
  const r = await supabase.from('v_my_notification_prefs').select('*');
  fail(r.error);
  return ((r.data || []) as NotificationPrefRow[]);
}

export async function upsertNotificationPref(input: {
  event_type: NotificationEventType;
  channel: NotificationChannel;
  enabled: boolean;
}): Promise<void> {
  if (SKIP_AUTH) {
    const idx = MOCK_PREFS.findIndex((p) => p.event_type === input.event_type && p.channel === input.channel);
    if (idx >= 0) MOCK_PREFS[idx] = { ...MOCK_PREFS[idx], enabled: input.enabled, updated_at: new Date().toISOString() };
    return;
  }
  checkSupabase();
  const r = await supabase.rpc('upsert_notification_pref', {
    p_event_type: input.event_type,
    p_channel: input.channel,
    p_enabled: input.enabled,
  });
  fail(r.error);
}

// =============================================================================
// Tenant-wide risk trend (V11) — média do score do portfólio ao longo do tempo
// =============================================================================

export interface TenantRiskTrendPoint {
  captured_date: string;
  avg_score: number;
  high_count: number; // contratos com score >= 70 naquele dia
  total: number;
}

export async function getTenantRiskTrend(days = 30): Promise<TenantRiskTrendPoint[]> {
  if (SKIP_AUTH) {
    const out: TenantRiskTrendPoint[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400_000);
      const base = 35 + Math.sin(i / 4) * 10;
      out.push({
        captured_date: d.toISOString().slice(0, 10),
        avg_score: Math.round(base + (Math.random() - 0.5) * 8),
        high_count: Math.max(0, Math.round((i % 5 === 0 ? 2 : 0) + Math.random())),
        total: 8,
      });
    }
    return out;
  }
  checkSupabase();
  // Agrega client-side a partir de v_contract_risk_history
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const r = await supabase
    .from('contract_risk_snapshots')
    .select('captured_date, score')
    .gte('captured_at', since)
    .order('captured_date', { ascending: true });
  fail(r.error);
  const rows = (r.data || []) as Array<{ captured_date: string; score: number }>;
  const byDate = new Map<string, { sum: number; count: number; high: number }>();
  for (const row of rows) {
    const cur = byDate.get(row.captured_date) || { sum: 0, count: 0, high: 0 };
    cur.sum += row.score;
    cur.count += 1;
    if (row.score >= 70) cur.high += 1;
    byDate.set(row.captured_date, cur);
  }
  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([captured_date, v]) => ({
      captured_date,
      avg_score: v.count > 0 ? Math.round(v.sum / v.count) : 0,
      high_count: v.high,
      total: v.count,
    }));
}

// =============================================================================
// Digest preview & quiet hours (V12)
// =============================================================================

export interface DigestPreview {
  member_id: string;
  email: string;
  nome: string;
  aprovacoes_pendentes: number;
  aprovacoes_atrasadas: number;
  grds_pendentes: number;
  notif_nao_lidas: number;
  pendencias_high_tenant: number;
  contratos_criticos_tenant: number;
  contratos_atencao_tenant: number;
  computed_at: string;
  empty?: boolean;
}

export async function getMyDigestPreview(): Promise<DigestPreview | null> {
  if (SKIP_AUTH) {
    return {
      member_id: 'mock-m', email: 'demo@consultegeo.org', nome: 'Demo Usuário',
      aprovacoes_pendentes: 3, aprovacoes_atrasadas: 1,
      grds_pendentes: 2, notif_nao_lidas: 5,
      pendencias_high_tenant: 2, contratos_criticos_tenant: 1,
      contratos_atencao_tenant: 2,
      computed_at: new Date().toISOString(),
    };
  }
  checkSupabase();
  const r = await supabase.rpc('get_my_digest_preview');
  fail(r.error);
  return (r.data || null) as DigestPreview | null;
}

export interface QuietHoursPrefs {
  timezone: string;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null; // HH:MM:SS
  quiet_hours_end: string | null;
}

export async function getMyQuietHours(): Promise<QuietHoursPrefs | null> {
  if (SKIP_AUTH) {
    return { timezone: 'America/Sao_Paulo', quiet_hours_enabled: false, quiet_hours_start: null, quiet_hours_end: null };
  }
  checkSupabase();
  // current_member_id é determinado por RLS — não precisa filtrar; member é único por sessão
  const r = await supabase
    .from('members')
    .select('id,timezone,quiet_hours_enabled,quiet_hours_start,quiet_hours_end')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  fail(r.error);
  if (!r.data) return null;
  return {
    timezone: r.data.timezone || 'America/Sao_Paulo',
    quiet_hours_enabled: r.data.quiet_hours_enabled === true,
    quiet_hours_start: r.data.quiet_hours_start,
    quiet_hours_end: r.data.quiet_hours_end,
  };
}

export async function updateMyQuietHours(input: QuietHoursPrefs & { member_id: string }): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const r = await supabase
    .from('members')
    .update({
      timezone: input.timezone,
      quiet_hours_enabled: input.quiet_hours_enabled,
      quiet_hours_start: input.quiet_hours_start,
      quiet_hours_end: input.quiet_hours_end,
    })
    .eq('id', input.member_id);
  fail(r.error);
}

export async function triggerDigestPreview(dry_run = true): Promise<{ processed: number; sent: number; results: Array<{ member_id: string; email: string; status: string }> }> {
  if (SKIP_AUTH) return { processed: 0, sent: 0, results: [] };
  checkSupabase();
  const { data, error } = await supabase.functions.invoke('digest-daily', { body: { dry_run, force: dry_run } });
  if (error) throw new Error(humanizeError(error));
  if (!data?.ok) throw new Error(data?.error || 'Falha ao executar digest');
  return data;
}

// =============================================================================
// User filter presets (V13)
// =============================================================================

export type FilterPresetPage = 'pendencias' | 'audit_log' | 'contracts' | 'measurements';

export interface FilterPreset {
  id: string;
  tenant_id: string;
  member_id: string;
  page_key: FilterPresetPage;
  nome: string;
  filters: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

const MOCK_PRESETS: FilterPreset[] = [];

export async function listMyFilterPresets(page_key: FilterPresetPage): Promise<FilterPreset[]> {
  if (SKIP_AUTH) return MOCK_PRESETS.filter((p) => p.page_key === page_key);
  checkSupabase();
  const r = await supabase
    .from('user_filter_presets')
    .select('*')
    .eq('page_key', page_key)
    .is('deleted_at', null)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false });
  fail(r.error);
  return (r.data || []) as FilterPreset[];
}

export async function saveFilterPreset(input: {
  page_key: FilterPresetPage;
  nome: string;
  filters: Record<string, unknown>;
  is_default?: boolean;
}): Promise<FilterPreset> {
  if (SKIP_AUTH) {
    const existing = MOCK_PRESETS.findIndex((p) => p.page_key === input.page_key && p.nome === input.nome);
    const now = new Date().toISOString();
    const row: FilterPreset = {
      id: existing >= 0 ? MOCK_PRESETS[existing].id : `mock-${Math.random().toString(36).slice(2, 9)}`,
      tenant_id: 't1', member_id: 'm1',
      page_key: input.page_key, nome: input.nome, filters: input.filters,
      is_default: input.is_default || false,
      created_at: existing >= 0 ? MOCK_PRESETS[existing].created_at : now,
      updated_at: now,
    };
    if (existing >= 0) MOCK_PRESETS[existing] = row;
    else MOCK_PRESETS.push(row);
    return row;
  }
  checkSupabase();
  const r = await supabase.rpc('save_filter_preset', {
    p_page_key: input.page_key,
    p_nome: input.nome,
    p_filters: input.filters,
    p_is_default: input.is_default || false,
  });
  fail(r.error);
  return r.data as FilterPreset;
}

export async function deleteFilterPreset(id: string): Promise<void> {
  if (SKIP_AUTH) {
    const idx = MOCK_PRESETS.findIndex((p) => p.id === id);
    if (idx >= 0) MOCK_PRESETS.splice(idx, 1);
    return;
  }
  checkSupabase();
  const r = await supabase.rpc('delete_filter_preset', { p_id: id });
  fail(r.error);
}

// =============================================================================
// Digests admin history (V13)
// =============================================================================

export interface DigestHistoryRow {
  id: string;
  tenant_id: string;
  member_id: string;
  member_nome: string | null;
  member_email: string | null;
  sent_date: string;
  sent_at: string;
  email_status: 'sent' | 'skipped' | 'failed';
  metadata: Record<string, unknown>;
  aprovacoes: number;
  grds: number;
  pendencias_high: number;
  criticos: number;
}

export interface DigestDailyStat {
  sent_date: string;
  total: number;
  enviados: number;
  pulados: number;
  falharam: number;
}

export async function listDigestsHistory(limit = 100, date_from?: string): Promise<DigestHistoryRow[]> {
  if (SKIP_AUTH) {
    const today = new Date();
    return Array.from({ length: 12 }).map((_, i) => {
      const d = new Date(today.getTime() - i * 86400_000);
      const status: DigestHistoryRow['email_status'] = i % 7 === 0 ? 'failed' : (i % 3 === 0 ? 'skipped' : 'sent');
      return {
        id: `mock-${i}`,
        tenant_id: 't1', member_id: 'm1',
        member_nome: ['Thiago Vieira', 'Ricardo Mendes', 'Patrícia Lopes'][i % 3],
        member_email: 'demo@consultegeo.org',
        sent_date: d.toISOString().slice(0, 10),
        sent_at: d.toISOString(),
        email_status: status,
        metadata: { aprovacoes: 3, grds: 2, pendencias_high: 1, criticos: 0 },
        aprovacoes: 3, grds: 2, pendencias_high: 1, criticos: 0,
      };
    });
  }
  checkSupabase();
  let q = supabase
    .from('v_digests_history')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (date_from) q = q.gte('sent_date', date_from);
  const r = await q;
  fail(r.error);
  return (r.data || []) as DigestHistoryRow[];
}

export async function listDigestsDailyStats(days = 30): Promise<DigestDailyStat[]> {
  if (SKIP_AUTH) {
    const today = new Date();
    return Array.from({ length: days }).map((_, i) => {
      const d = new Date(today.getTime() - i * 86400_000);
      return {
        sent_date: d.toISOString().slice(0, 10),
        total: 8 + (i % 3), enviados: 6 + (i % 3), pulados: 1, falharam: i % 7 === 0 ? 1 : 0,
      };
    }).reverse();
  }
  checkSupabase();
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const r = await supabase
    .from('v_digests_daily_stats')
    .select('*')
    .gte('sent_date', since)
    .order('sent_date', { ascending: true });
  fail(r.error);
  return (r.data || []) as DigestDailyStat[];
}

// =============================================================================
// Bulk SOV operations (V16)
// =============================================================================

export interface BulkResult {
  affected: number;
  requested: number;
  skipped?: number;
  blocked_locked?: number;
  blocked_measured?: number;
}

export async function bulkLockItems(item_ids: string[], lock: boolean, motivo?: string): Promise<BulkResult> {
  if (SKIP_AUTH) return { affected: item_ids.length, requested: item_ids.length };
  checkSupabase();
  await setAuditSource(lock ? 'sov_lock' : 'sov_unlock');
  const r = await supabase.rpc('bulk_lock_items', { p_item_ids: item_ids, p_lock: lock, p_motivo: motivo || null });
  fail(r.error);
  return r.data as BulkResult;
}

export async function bulkSetDiscipline(item_ids: string[], discipline_id: string | null): Promise<BulkResult> {
  if (SKIP_AUTH) return { affected: item_ids.length, requested: item_ids.length };
  checkSupabase();
  await setAuditSource('sov_bulk');
  const r = await supabase.rpc('bulk_set_discipline', { p_item_ids: item_ids, p_discipline_id: discipline_id });
  fail(r.error);
  return r.data as BulkResult;
}

export async function bulkAdjustPrices(item_ids: string[], factor: number, motivo: string): Promise<BulkResult> {
  if (SKIP_AUTH) return { affected: item_ids.length, requested: item_ids.length, blocked_locked: 0, blocked_measured: 0 };
  checkSupabase();
  await setAuditSource('sov_bulk');
  const r = await supabase.rpc('bulk_adjust_prices', { p_item_ids: item_ids, p_factor: factor, p_motivo: motivo });
  fail(r.error);
  return r.data as BulkResult;
}

export async function bulkSoftDeleteItems(item_ids: string[], motivo: string): Promise<BulkResult> {
  if (SKIP_AUTH) return { affected: item_ids.length, requested: item_ids.length };
  checkSupabase();
  await setAuditSource('sov_bulk');
  const r = await supabase.rpc('bulk_soft_delete_items', { p_item_ids: item_ids, p_motivo: motivo });
  fail(r.error);
  return r.data as BulkResult;
}

// =============================================================================
// Notifications broadcast (V17)
// =============================================================================

export interface BroadcastPreview {
  total: number;
  with_email: number;
  by_role: Record<string, number>;
}

export interface BroadcastFilter {
  filter_roles?: string[];
  filter_member_ids?: string[];
  filter_contract_id?: string;
}

export interface BroadcastResult {
  broadcast_id: string;
  total_sent: number;
}

export interface BroadcastHistoryRow {
  id: string;
  tenant_id: string;
  sender_id: string;
  sender_nome: string | null;
  sender_email: string | null;
  title: string;
  body: string;
  kind: string;
  action_url: string | null;
  filter_roles: string[] | null;
  filter_member_ids: string[] | null;
  filter_contract_id: string | null;
  contract_numero: string | null;
  contract_objeto: string | null;
  scope: 'all' | 'role' | 'specific' | 'contract';
  total_sent: number;
  total_failed: number;
  email_also: boolean;
  created_at: string;
}

export async function previewBroadcastRecipients(filter: BroadcastFilter): Promise<BroadcastPreview> {
  if (SKIP_AUTH) {
    return {
      total: filter.filter_contract_id ? 5 : (filter.filter_roles?.includes('admin') ? 2 : 12),
      with_email: filter.filter_contract_id ? 4 : (filter.filter_roles?.includes('admin') ? 2 : 11),
      by_role: { admin: 2, gestor_contrato: 4, fiscal_contrato: 3, viewer: 3 },
    };
  }
  checkSupabase();
  const r = await supabase.rpc('preview_broadcast_recipients', {
    p_filter_roles: filter.filter_roles || null,
    p_filter_member_ids: filter.filter_member_ids || null,
    p_filter_contract_id: filter.filter_contract_id || null,
  });
  fail(r.error);
  return r.data as BroadcastPreview;
}

export async function bulkSendNotification(input: {
  title: string;
  body: string;
  kind?: string;
  action_url?: string;
  filter_roles?: string[];
  filter_member_ids?: string[];
  filter_contract_id?: string;
}): Promise<BroadcastResult> {
  if (SKIP_AUTH) {
    return { broadcast_id: 'mock-bc', total_sent: input.filter_contract_id ? 5 : 12 };
  }
  checkSupabase();
  const r = await supabase.rpc('bulk_send_notification', {
    p_title: input.title,
    p_body: input.body,
    p_kind: input.kind || 'info',
    p_action_url: input.action_url || null,
    p_filter_roles: input.filter_roles || null,
    p_filter_member_ids: input.filter_member_ids || null,
    p_filter_contract_id: input.filter_contract_id || null,
  });
  fail(r.error);
  return r.data as BroadcastResult;
}

export async function listBroadcastsHistory(limit = 50): Promise<BroadcastHistoryRow[]> {
  if (SKIP_AUTH) {
    const now = Date.now();
    return Array.from({ length: 8 }).map((_, i) => ({
      id: `bc-${i}`, tenant_id: 't1', sender_id: 'm1',
      sender_nome: ['Thiago Vieira', 'Eduardo Vargas'][i % 2],
      sender_email: 'admin@consultegeo.org',
      title: ['Manutenção programada: domingo 14h–16h', 'Nova diretriz de medição', 'Treinamento obrigatório', 'Alteração de fluxo aprovação'][i % 4],
      body: 'Comunicado interno da administração.',
      kind: 'info',
      action_url: null,
      filter_roles: i % 3 === 0 ? null : ['gestor_contrato', 'fiscal_contrato'],
      filter_member_ids: null,
      filter_contract_id: i === 2 ? 'c-mock-1' : null,
      contract_numero: i === 2 ? 'CT 045/2024' : null,
      contract_objeto: i === 2 ? 'Pavimentação urbana – Lote A' : null,
      scope: (i === 2 ? 'contract' : (i % 3 === 0 ? 'all' : 'role')) as 'all' | 'role' | 'contract',
      total_sent: 8 + i * 2,
      total_failed: 0,
      email_also: i % 4 === 0,
      created_at: new Date(now - i * 86400_000).toISOString(),
    }));
  }
  checkSupabase();
  const r = await supabase
    .from('v_notification_broadcasts_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  fail(r.error);
  return (r.data || []) as BroadcastHistoryRow[];
}

// =============================================================================
// Dispatch broadcast emails (V18)
// =============================================================================

export interface BroadcastEmailStats {
  total: number;
  sent: number;
  skipped_pref: number;
  skipped_quiet: number;
  failed: number;
}

export async function dispatchBroadcastEmails(broadcast_id: string): Promise<{ email_stats: BroadcastEmailStats; broadcast_id?: string; note?: string }> {
  if (SKIP_AUTH) {
    return { broadcast_id, email_stats: { total: 12, sent: 9, skipped_pref: 2, skipped_quiet: 1, failed: 0 } };
  }
  checkSupabase();
  const { data, error } = await supabase.functions.invoke('dispatch-broadcast-emails', { body: { broadcast_id } });
  if (error) throw new Error(humanizeError(error));
  if (!data?.ok) throw new Error(data?.error || 'Falha ao disparar e-mails');
  return data;
}

// =============================================================================
// Broadcast templates (V21)
// =============================================================================

export interface BroadcastTemplate {
  id: string;
  tenant_id: string;
  owner_id: string;
  owner_nome: string | null;
  owner_email: string | null;
  is_owner: boolean;
  nome: string;
  title: string;
  body: string;
  kind: string;
  action_url: string | null;
  default_filter_roles: string[] | null;
  default_filter_contract_id: string | null;
  default_contract_numero: string | null;
  default_filter_member_ids: string[] | null;
  default_email_also: boolean;
  is_shared: boolean;
  uses_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BroadcastTemplateInput {
  id?: string | null;
  nome: string;
  title: string;
  body: string;
  kind?: string;
  action_url?: string | null;
  default_filter_roles?: string[] | null;
  default_filter_contract_id?: string | null;
  default_filter_member_ids?: string[] | null;
  default_email_also?: boolean;
  is_shared?: boolean;
}

export async function listBroadcastTemplates(): Promise<BroadcastTemplate[]> {
  if (SKIP_AUTH) {
    const now = Date.now();
    return [
      { id: 't1', tenant_id: 't', owner_id: 'm1', owner_nome: 'Thiago Vieira', owner_email: 'thiago@consultegeo.org', is_owner: true,
        nome: 'Manutenção programada', title: 'Manutenção do sistema · domingo 14h–16h',
        body: 'Vamos atualizar o sistema neste domingo. Salvem alterações em andamento.',
        kind: 'warning', action_url: null,
        default_filter_roles: null, default_filter_contract_id: null, default_contract_numero: null,
        default_filter_member_ids: null, default_email_also: true, is_shared: true, uses_count: 7,
        last_used_at: new Date(now - 5 * 86400_000).toISOString(),
        created_at: new Date(now - 90 * 86400_000).toISOString(), updated_at: new Date(now - 5 * 86400_000).toISOString() },
      { id: 't2', tenant_id: 't', owner_id: 'm1', owner_nome: 'Thiago Vieira', owner_email: 'thiago@consultegeo.org', is_owner: true,
        nome: 'Lembrete de medição', title: 'Encerramento de medição em 3 dias',
        body: 'Lembrete: o ciclo de medição encerra em 3 dias. Submetam os boletins até sexta às 17h.',
        kind: 'info', action_url: '/medicoes',
        default_filter_roles: ['fiscal_contrato', 'fiscal_campo'], default_filter_contract_id: null,
        default_contract_numero: null, default_filter_member_ids: null, default_email_also: false,
        is_shared: false, uses_count: 12, last_used_at: new Date(now - 1 * 86400_000).toISOString(),
        created_at: new Date(now - 120 * 86400_000).toISOString(), updated_at: new Date(now - 1 * 86400_000).toISOString() },
    ];
  }
  checkSupabase();
  const r = await supabase.from('v_broadcast_templates_list').select('*');
  fail(r.error);
  return (r.data || []) as BroadcastTemplate[];
}

export async function upsertBroadcastTemplate(input: BroadcastTemplateInput): Promise<string> {
  if (SKIP_AUTH) return input.id || 'mock-tpl-' + Math.random().toString(36).slice(2, 8);
  checkSupabase();
  const r = await supabase.rpc('upsert_broadcast_template', {
    p_id:                         input.id || null,
    p_nome:                       input.nome,
    p_title:                      input.title,
    p_body:                       input.body,
    p_kind:                       input.kind || 'info',
    p_action_url:                 input.action_url || null,
    p_default_filter_roles:       input.default_filter_roles || null,
    p_default_filter_contract_id: input.default_filter_contract_id || null,
    p_default_filter_member_ids:  input.default_filter_member_ids || null,
    p_default_email_also:         input.default_email_also || false,
    p_is_shared:                  input.is_shared || false,
  });
  fail(r.error);
  return r.data as string;
}

export async function deleteBroadcastTemplate(id: string): Promise<boolean> {
  if (SKIP_AUTH) return true;
  checkSupabase();
  const r = await supabase.rpc('delete_broadcast_template', { p_id: id });
  fail(r.error);
  return r.data as boolean;
}

export async function recordBroadcastTemplateUse(id: string): Promise<void> {
  if (SKIP_AUTH) return;
  checkSupabase();
  const r = await supabase.rpc('record_broadcast_template_use', { p_id: id });
  fail(r.error);
}

// =============================================================================
// V24 — Role aliases
// =============================================================================
export interface RoleAlias {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  roles: string[];
  description: string | null;
  created_by: string | null;
  created_by_nome: string | null;
  created_at: string;
  updated_at: string;
  member_count: number;
}

export interface RoleAliasInput {
  id?: string | null;
  name: string;
  roles: string[];
  description?: string | null;
}

export async function listRoleAliases(): Promise<RoleAlias[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('list_role_aliases');
  fail(r.error);
  return (r.data || []) as RoleAlias[];
}

export async function upsertRoleAlias(input: RoleAliasInput): Promise<string> {
  if (SKIP_AUTH) return 'demo-id';
  checkSupabase();
  const r = await supabase.rpc('upsert_role_alias', {
    p_id: input.id ?? null,
    p_name: input.name,
    p_roles: input.roles,
    p_description: input.description ?? null,
  });
  fail(r.error);
  return r.data as string;
}

export async function deleteRoleAlias(id: string): Promise<boolean> {
  if (SKIP_AUTH) return true;
  checkSupabase();
  const r = await supabase.rpc('delete_role_alias', { p_id: id });
  fail(r.error);
  return r.data as boolean;
}

// =============================================================================
// V24 — Tenant webhooks (Slack / Teams / generic)
// =============================================================================
export type WebhookKind = 'slack' | 'teams' | 'generic';
export type WebhookEvent =
  | 'broadcast_sent'
  | 'risk_critico_changed'
  | 'measurement_emitted'
  | 'measurement_decided'
  | 'additive_approved'
  | 'unforeseen_pending'
  | 'digest_failed';

export interface TenantWebhook {
  id: string;
  tenant_id: string;
  label: string;
  kind: WebhookKind;
  url: string;
  secret_hint: string | null;
  events: WebhookEvent[];
  active: boolean;
  created_by: string | null;
  created_by_nome: string | null;
  created_at: string;
  last_called_at: string | null;
  last_status: string | null;
  last_response_code: number | null;
  dispatch_count: number;
  error_count: number;
  /** V25 — HMAC signing */
  has_signing_secret?: boolean;
  secret_rotated_at?: string | null;
  /** V25 — custom payload (kind=generic) */
  payload_template?: string | null;
  /** V28 — auto-rotate */
  auto_rotate_after_days?: number | null;
}

export interface TenantWebhookInput {
  id?: string | null;
  label: string;
  kind: WebhookKind;
  url: string;
  secret_hint?: string | null;
  events: WebhookEvent[];
  active: boolean;
  /** V25 — JSON com placeholders {{ … }} (kind=generic) */
  payload_template?: string | null;
  /** V28 — auto-rotate signing secret após N dias */
  auto_rotate_after_days?: number | null;
}

export interface WebhookDispatchRow {
  id: string;
  webhook_id: string;
  webhook_label: string;
  webhook_kind: WebhookKind;
  broadcast_id: string | null;
  event: string;
  attempted_at: string;
  status: 'ok' | 'error' | 'skipped';
  response_code: number | null;
  error_text: string | null;
  /** V25 */
  signed?: boolean;
}

export interface WebhookDispatchResult {
  dispatched: number;
  ok_count: number;
  error_count: number;
  /** V25 — quantos foram com HMAC */
  signed_count?: number;
  results: Array<{
    webhook_id: string;
    label: string;
    kind: WebhookKind;
    status: 'ok' | 'error';
    response_code: number | null;
    error: string | null;
    signed?: boolean;
  }>;
  note?: string;
}

export async function listTenantWebhooks(): Promise<TenantWebhook[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('list_tenant_webhooks');
  fail(r.error);
  return (r.data || []) as TenantWebhook[];
}

export async function upsertTenantWebhook(input: TenantWebhookInput): Promise<string> {
  if (SKIP_AUTH) return 'demo-id';
  checkSupabase();
  const r = await supabase.rpc('upsert_tenant_webhook', {
    p_id:                     input.id ?? null,
    p_label:                  input.label,
    p_kind:                   input.kind,
    p_url:                    input.url,
    p_secret_hint:            input.secret_hint ?? null,
    p_events:                 input.events,
    p_active:                 input.active,
    p_payload_template:       input.payload_template ?? null,
    p_auto_rotate_after_days: input.auto_rotate_after_days ?? null,
  });
  fail(r.error);
  return r.data as string;
}

export async function deleteTenantWebhook(id: string): Promise<boolean> {
  if (SKIP_AUTH) return true;
  checkSupabase();
  const r = await supabase.rpc('delete_tenant_webhook', { p_id: id });
  fail(r.error);
  return r.data as boolean;
}

export async function listWebhookDispatches(limit = 50): Promise<WebhookDispatchRow[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('list_webhook_dispatches', { p_limit: limit });
  fail(r.error);
  return (r.data || []) as WebhookDispatchRow[];
}

export async function dispatchBroadcastWebhooks(broadcast_id: string): Promise<WebhookDispatchResult> {
  if (SKIP_AUTH) return { dispatched: 0, ok_count: 0, error_count: 0, results: [], note: 'demo' };
  checkSupabase();
  const { data, error } = await supabase.functions.invoke('dispatch-broadcast-webhooks', {
    body: { broadcast_id },
  });
  if (error) {
    return { dispatched: 0, ok_count: 0, error_count: 0, results: [], note: humanizeError(error) };
  }
  return (data || { dispatched: 0, ok_count: 0, error_count: 0, results: [] }) as WebhookDispatchResult;
}

export async function testTenantWebhook(webhook_id: string): Promise<{
  status: 'ok' | 'error';
  response_code: number | null;
  error: string | null;
}> {
  if (SKIP_AUTH) return { status: 'ok', response_code: 200, error: null };
  checkSupabase();
  const { data, error } = await supabase.functions.invoke('dispatch-broadcast-webhooks', {
    body: { test_webhook_id: webhook_id },
  });
  if (error) {
    return { status: 'error', response_code: null, error: humanizeError(error) };
  }
  const d = (data || {}) as { status?: 'ok' | 'error'; response_code?: number; error?: string | null };
  return { status: d.status || 'ok', response_code: d.response_code ?? null, error: d.error ?? null };
}

// =============================================================================
// V24 — Scheduled risk snapshots refresh
// =============================================================================
export interface StaleRiskContract {
  contract_id: string;
  tenant_id: string;
  numero: string;
  objeto: string;
  last_snapshot_at: string | null;
  freshness: 'never' | 'critical' | 'stale' | 'fresh';
}

export interface RefreshRiskResult {
  total: number;
  refreshed: Array<{ contract_id: string; numero?: string; score: number; nivel: string }>;
  errors: Array<{ contract_id: string; numero?: string; message: string }>;
}

export async function listStaleRiskContracts(max_age_days = 14, limit = 50): Promise<StaleRiskContract[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('contracts_needing_risk_refresh', {
    p_max_age_days: max_age_days,
    p_limit: limit,
  });
  fail(r.error);
  return (r.data || []) as StaleRiskContract[];
}

export async function refreshRiskSnapshots(max_age_days = 14, max_contracts = 50): Promise<RefreshRiskResult> {
  if (SKIP_AUTH) return { total: 0, refreshed: [], errors: [] };
  checkSupabase();
  const { data, error } = await supabase.functions.invoke('refresh-risk-snapshots', {
    body: { max_age_days, max_contracts },
  });
  if (error) {
    throw new Error(humanizeError(error));
  }
  return (data || { total: 0, refreshed: [], errors: [] }) as RefreshRiskResult;
}

// =============================================================================
// V25 — Webhook HMAC signing
// =============================================================================
export interface RotateSecretResult {
  secret: string;     // mostrado uma única vez (write-once-read-once)
  hint: string;       // últimos chars (persistido)
  rotated_at: string;
}

export async function rotateWebhookSecret(id: string): Promise<RotateSecretResult> {
  if (SKIP_AUTH) {
    return { secret: 'whsec_demo_secret_visible_once', hint: '…oonc', rotated_at: new Date().toISOString() };
  }
  checkSupabase();
  const r = await supabase.rpc('rotate_webhook_secret', { p_id: id });
  fail(r.error);
  return r.data as RotateSecretResult;
}

export async function clearWebhookSecret(id: string): Promise<boolean> {
  if (SKIP_AUTH) return true;
  checkSupabase();
  const r = await supabase.rpc('clear_webhook_secret', { p_id: id });
  fail(r.error);
  return r.data as boolean;
}

// =============================================================================
// V25 — Cron risk refresh manual test (admin only)
// =============================================================================
export interface CronTestResult {
  tenants_processed: number;
  total_refreshed: number;
  total_errors: number;
  ran_at: string;
}

export async function testCronRefreshRisk(): Promise<CronTestResult> {
  if (SKIP_AUTH) return { tenants_processed: 0, total_refreshed: 0, total_errors: 0, ran_at: new Date().toISOString() };
  checkSupabase();
  const r = await supabase.rpc('test_cron_refresh_risk');
  fail(r.error);
  return r.data as CronTestResult;
}

// =============================================================================
// V26 — Webhook event queue + retry/backoff
// =============================================================================

export const WEBHOOK_DOMAIN_EVENT_OPTIONS: Array<{
  value: string;
  label: string;
  description: string;
  group: 'communication' | 'contract' | 'risk' | 'operations';
}> = [
  { value: 'broadcast_sent',       label: 'Broadcast enviado',             description: 'Admin disparou um comunicado pra membros',                group: 'communication' },
  { value: 'risk_critico_changed', label: 'Risco virou crítico',           description: 'Snapshot de contrato passou pro nível crítico',           group: 'risk' },
  { value: 'measurement_emitted',  label: 'Medição emitida',               description: 'Medição passou para o status emitida',                    group: 'contract' },
  { value: 'measurement_decided',  label: 'Medição decidida',              description: 'Status mudou para aprovada, devolvida ou paga',           group: 'contract' },
  { value: 'additive_approved',    label: 'Aditivo aprovado',              description: 'Aditivo passou pro status aprovado ou incorporado',       group: 'contract' },
  { value: 'unforeseen_pending',   label: 'Item não previsto em análise',  description: 'Item entrou em fase de aprovação técnica ou comercial',   group: 'contract' },
  { value: 'digest_failed',        label: 'Digest falhou',                 description: 'Envio de digest diário falhou para um destinatário',      group: 'operations' },
];

export interface WebhookQueueStats {
  due_now: number;
  waiting_backoff: number;
  processed: number;
  dead_letter: number;
  risk_critico_total: number;
  measurement_decided_total: number;
  additive_approved_total: number;
}

export async function tenantWebhookQueueStats(): Promise<WebhookQueueStats | null> {
  if (SKIP_AUTH) return null;
  checkSupabase();
  const r = await supabase.rpc('tenant_webhook_queue_stats');
  fail(r.error);
  const rows = (r.data || []) as WebhookQueueStats[];
  return rows[0] || null;
}

export type WebhookQueueStatus = 'pending' | 'processed' | 'dead';

export interface WebhookQueueEvent {
  id: string;
  event: string;
  entity_type: string;
  entity_id: string;
  enqueued_at: string;
  next_attempt_at: string;
  processed_at: string | null;
  attempts: number;
  last_error: string | null;
  payload: Record<string, unknown>;
}

export async function listWebhookQueueEvents(
  status?: WebhookQueueStatus,
  limit = 50,
): Promise<WebhookQueueEvent[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('list_webhook_queue_events', {
    p_status: status || null,
    p_limit: limit,
  });
  fail(r.error);
  return (r.data || []) as WebhookQueueEvent[];
}

export async function requeueWebhookEvent(id: string): Promise<boolean> {
  if (SKIP_AUTH) return true;
  checkSupabase();
  const r = await supabase.rpc('requeue_webhook_event', { p_id: id });
  fail(r.error);
  return r.data as boolean;
}

// =============================================================================
// V27 — Sample payload preview
// =============================================================================

export interface SamplePayloadResult {
  event: string;
  synthetic: boolean;
  payload: Record<string, unknown>;
}

export async function buildWebhookSamplePayload(event: string, entity_id?: string | null): Promise<SamplePayloadResult> {
  if (SKIP_AUTH) {
    return {
      event,
      synthetic: true,
      payload: { note: 'modo demo — sample payload não disponível' },
    };
  }
  checkSupabase();
  const r = await supabase.rpc('build_webhook_sample_payload', {
    p_event: event,
    p_entity_id: entity_id || null,
  });
  fail(r.error);
  return r.data as SamplePayloadResult;
}

// =============================================================================
// V28 — Entity search + test dispatch + dead-letter CSV export
// =============================================================================

export interface WebhookEntity {
  id: string;
  label: string;
  hint: string | null;
}

export async function searchEntitiesForWebhook(
  event: string,
  query: string,
  limit = 10,
): Promise<WebhookEntity[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('search_entities_for_webhook', {
    p_event: event,
    p_query: query || '',
    p_limit: limit,
  });
  fail(r.error);
  return (r.data || []) as WebhookEntity[];
}

/** Re-envia um evento histórico pra um webhook específico (não broadcasta) */
export async function enqueueWebhookTest(
  source_event_id: string,
  target_webhook: string,
): Promise<string> {
  if (SKIP_AUTH) return 'demo-test-id';
  checkSupabase();
  const r = await supabase.rpc('enqueue_webhook_test', {
    p_source_event_id: source_event_id,
    p_target_webhook:  target_webhook,
  });
  fail(r.error);
  return r.data as string;
}

export interface DeadLetterCsvRow {
  enqueued_at:  string;
  event:        string;
  entity_type:  string;
  entity_id:    string;
  attempts:     number;
  last_error:   string;
  payload_json: string;
}

export async function exportDeadLetterEvents(): Promise<DeadLetterCsvRow[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('export_dead_letter_events');
  fail(r.error);
  return (r.data || []) as DeadLetterCsvRow[];
}

/** Converte rows para CSV no client (sem dep de papaparse) */
export function deadLetterRowsToCsv(rows: DeadLetterCsvRow[]): string {
  const header = ['enqueued_at', 'event', 'entity_type', 'entity_id', 'attempts', 'last_error', 'payload_json'];
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    // RFC 4180: quote se contém vírgula, aspas ou newline; aspas dobram
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    header.join(','),
    ...rows.map((r) => header.map((h) => escape((r as unknown as Record<string, unknown>)[h])).join(',')),
  ];
  return lines.join('\n');
}

// =============================================================================
// V29 — Bulk ops + webhook health score
// =============================================================================
export async function bulkRequeueWebhookEvents(ids: string[]): Promise<number> {
  if (SKIP_AUTH) return ids.length;
  checkSupabase();
  const r = await supabase.rpc('bulk_requeue_webhook_events', { p_ids: ids });
  fail(r.error);
  return Number(r.data) || 0;
}

export interface WebhookHealthRow {
  id: string;
  label: string;
  active: boolean;
  dispatch_count: number;
  error_count: number;
  last_called_at: string | null;
  last_status: string | null;
  error_rate: number;
  days_since_last_call: number | null;
  dead_letter_for_events: number;
  health_score: number;
}

export async function tenantWebhookHealth(): Promise<WebhookHealthRow[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('tenant_webhook_health');
  fail(r.error);
  return (r.data || []) as WebhookHealthRow[];
}

/** Helper: cor + label do score */
export function healthBucket(score: number): { tone: 'green' | 'yellow' | 'red'; label: string } {
  if (score >= 80) return { tone: 'green',  label: 'saudável' };
  if (score >= 50) return { tone: 'yellow', label: 'atenção' };
  return                  { tone: 'red',    label: 'crítico' };
}

// =============================================================================
// V30 — Reajustes contratuais
// =============================================================================

export interface AdjustmentIndex {
  id: string;
  codigo: string;
  nome: string;
  periodicidade: string;
}

export async function listAdjustmentIndices(): Promise<AdjustmentIndex[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.from('adjustment_indices').select('id, codigo, nome, periodicidade').is('deleted_at', null).order('codigo');
  fail(r.error);
  return (r.data || []) as AdjustmentIndex[];
}

export interface IndexValueRow {
  id: string;
  reference_month: string;
  index_value: number;
  source: string | null;
  published_at: string | null;
  recorded_by: string | null;
}

export async function listIndexValues(index_id: string, from?: string, to?: string): Promise<IndexValueRow[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('list_index_values', {
    p_index_id: index_id,
    p_from: from || null,
    p_to: to || null,
  });
  fail(r.error);
  return (r.data || []) as IndexValueRow[];
}

export async function upsertIndexValue(
  index_id: string, reference_month: string, index_value: number, source = 'manual',
): Promise<string> {
  if (SKIP_AUTH) return 'demo-id';
  checkSupabase();
  const r = await supabase.rpc('upsert_index_value', {
    p_index_id: index_id,
    p_reference_month: reference_month,
    p_index_value: index_value,
    p_source: source,
    p_published_at: null,
  });
  fail(r.error);
  return r.data as string;
}

// Reajuste — contract scope

export interface ReajusteRule {
  id: string;
  formula: string;
  data_base: string | null;
  periodicidade_meses: number;
  carencia_meses: number;
  active: boolean;
  index_id: string;
  index_codigo: string;
  index_nome: string;
}

export interface ReajusteSummary {
  contract_id: string;
  contract_numero: string;
  valor_inicial: number;
  valor_total_atual: number;
  total_reajustado: number;
  events_count: number;
  rule: ReajusteRule | null;
}

export async function getContractReajusteSummary(contract_id: string): Promise<ReajusteSummary> {
  if (SKIP_AUTH) {
    return {
      contract_id, contract_numero: 'CT-DEMO', valor_inicial: 0, valor_total_atual: 0,
      total_reajustado: 0, events_count: 0, rule: null,
    };
  }
  checkSupabase();
  const r = await supabase.rpc('get_contract_reajuste_summary', { p_contract_id: contract_id });
  fail(r.error);
  return r.data as ReajusteSummary;
}

export interface ReajusteSimulation {
  ok: boolean;
  error?: string;
  rule_id?: string;
  index_codigo?: string;
  index_nome?: string;
  formula?: string;
  periodicidade_meses?: number;
  base_date?: string;
  reference_date?: string;
  next_anniversary?: string;
  index_value_base?: number;
  index_value_ref?: number;
  factor?: number;
  variation_percent?: number;
  value_before: number;
  value_after?: number;
  delta?: number;
}

export async function simulateContractReajuste(contract_id: string, target_date?: string): Promise<ReajusteSimulation> {
  if (SKIP_AUTH) return { ok: false, error: 'modo demo', value_before: 0 };
  checkSupabase();
  const r = await supabase.rpc('simulate_contract_reajuste', {
    p_contract_id: contract_id,
    p_target_date: target_date || null,
  });
  fail(r.error);
  return r.data as ReajusteSimulation;
}

export interface ApplyReajusteResult {
  event_id: string;
  additive_id: string | null;
  value_before: number;
  value_after: number;
  delta: number;
  factor: number;
}

export async function applyContractReajuste(
  contract_id: string,
  target_date?: string,
  notes?: string,
  create_additive = false,
): Promise<ApplyReajusteResult> {
  if (SKIP_AUTH) {
    return { event_id: 'demo', additive_id: null, value_before: 0, value_after: 0, delta: 0, factor: 1 };
  }
  checkSupabase();
  const r = await supabase.rpc('apply_contract_reajuste', {
    p_contract_id: contract_id,
    p_target_date: target_date || null,
    p_notes: notes || null,
    p_create_additive: create_additive,
  });
  fail(r.error);
  return r.data as ApplyReajusteResult;
}

export interface ReajusteEvent {
  id: string;
  applied_at: string;
  applied_by: string | null;
  applied_by_nome: string | null;
  base_date: string;
  reference_date: string;
  index_codigo: string;
  factor: number;
  variation_percent: number;
  value_before: number;
  value_after: number;
  delta: number;
  notes: string | null;
  /** V31: link pro aditivo formal quando admin marcou "criar aditivo" */
  additive_id?: string | null;
  additive_numero?: number | null;
}

export async function listContractReajustes(contract_id: string): Promise<ReajusteEvent[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('list_contract_reajustes', { p_contract_id: contract_id });
  fail(r.error);
  return (r.data || []) as ReajusteEvent[];
}

export async function upsertContractAdjustmentRule(input: {
  id?: string | null;
  contract_id: string;
  index_id: string;
  formula: string;
  data_base: string | null;
  periodicidade_meses?: number;
  carencia_meses?: number;
  active?: boolean;
}): Promise<string> {
  if (SKIP_AUTH) return 'demo-rule-id';
  checkSupabase();
  const r = await supabase.rpc('upsert_contract_adjustment_rule', {
    p_id: input.id ?? null,
    p_contract_id: input.contract_id,
    p_index_id: input.index_id,
    p_formula: input.formula,
    p_data_base: input.data_base,
    p_periodicidade_meses: input.periodicidade_meses ?? 12,
    p_carencia_meses: input.carencia_meses ?? 12,
    p_active: input.active ?? true,
  });
  fail(r.error);
  return r.data as string;
}

// =============================================================================
// V31 — Bulk import CSV de índices
// =============================================================================

export interface BulkUpsertIndexResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: Record<string, unknown>; error: string }>;
}

export interface IndexCsvRow {
  reference_month: string;   // 'YYYY-MM' ou 'YYYY-MM-DD'
  index_value: number;
}

export async function bulkUpsertIndexValues(
  index_id: string,
  rows: IndexCsvRow[],
  source = 'csv-import',
): Promise<BulkUpsertIndexResult> {
  if (SKIP_AUTH) {
    return { inserted: rows.length, updated: 0, skipped: 0, errors: [] };
  }
  checkSupabase();
  const r = await supabase.rpc('bulk_upsert_index_values', {
    p_index_id: index_id,
    p_rows: rows,
    p_source: source,
  });
  fail(r.error);
  return r.data as BulkUpsertIndexResult;
}

/**
 * Parser CSV bem simples — sem dep externa. Assume:
 *   - 1ª linha: header (será ignorada se contém 'reference_month' ou 'mes')
 *   - Demais linhas: <month>;<value> ou <month>,<value>
 *   - Aceita YYYY-MM, MM/YYYY, YYYY-MM-DD
 *   - Aceita valor com vírgula decimal ou ponto, com ou sem separador de milhar
 *
 * Retorna rows válidas + warnings. Não chama o backend.
 */
export function parseIndexCsv(text: string): {
  rows: IndexCsvRow[];
  warnings: Array<{ line: number; raw: string; error: string }>;
} {
  const rows: IndexCsvRow[] = [];
  const warnings: Array<{ line: number; raw: string; error: string }> = [];

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { rows, warnings };

  let startIdx = 0;
  const firstLower = lines[0].toLowerCase();
  if (firstLower.includes('mes') || firstLower.includes('mês') ||
      firstLower.includes('month') || firstLower.includes('reference') ||
      firstLower.includes('período') || firstLower.includes('periodo')) {
    startIdx = 1;
  }

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split(/[;,\t]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      warnings.push({ line: i + 1, raw: line, error: 'Esperadas 2 colunas (mês, valor)' });
      continue;
    }
    const rawMonth = parts[0];
    const rawValue = parts[1];

    // Parse mês
    let month: string | null = null;
    if (/^\d{4}-\d{2}(-\d{2})?$/.test(rawMonth)) {
      month = rawMonth.slice(0, 7) + '-01';
    } else if (/^\d{2}\/\d{4}$/.test(rawMonth)) {
      const [mm, yyyy] = rawMonth.split('/');
      month = `${yyyy}-${mm.padStart(2, '0')}-01`;
    } else if (/^\d{2}-\d{4}$/.test(rawMonth)) {
      const [mm, yyyy] = rawMonth.split('-');
      month = `${yyyy}-${mm.padStart(2, '0')}-01`;
    }
    if (!month) {
      warnings.push({ line: i + 1, raw: line, error: `Formato de mês inválido: "${rawMonth}"` });
      continue;
    }

    // Parse valor: aceita "1.234,5678" ou "1234.5678"
    const cleaned = rawValue.replace(/\./g, '').replace(/,/g, '.');
    const value = parseFloat(cleaned);
    if (!isFinite(value) || value <= 0) {
      warnings.push({ line: i + 1, raw: line, error: `Valor inválido: "${rawValue}"` });
      continue;
    }

    rows.push({ reference_month: month, index_value: value });
  }

  return { rows, warnings };
}

// =============================================================================
// V32 — Reajuste em massa
// =============================================================================

export interface ReajusteCandidate {
  contract_id:         string;
  contract_numero:     string;
  objeto:              string | null;
  status:              string;
  valor_total_atual:   number;
  rule_id:             string;
  index_id:            string;
  index_codigo:        string;
  periodicidade_meses: number;
  last_reference_date: string;
  next_anniversary:    string;
  is_due:              boolean;
  events_count:        number;
}

export async function listReajusteCandidates(opts: {
  window_days?: number;
  only_due?:    boolean;
  index_id?:    string | null;
} = {}): Promise<ReajusteCandidate[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('list_reajuste_candidates', {
    p_window_days: opts.window_days ?? 30,
    p_only_due:    opts.only_due ?? false,
    p_index_id:    opts.index_id ?? null,
  });
  fail(r.error);
  return (r.data || []) as ReajusteCandidate[];
}

export interface BulkSimRow {
  contract_id:       string;
  contract_numero:   string;
  ok:                boolean;
  error:             string | null;
  factor:            number | null;
  variation_percent: number | null;
  value_before:      number | null;
  value_after:       number | null;
  delta:             number | null;
}

export async function bulkSimulateReajuste(
  contract_ids: string[],
  target_date?: string,
): Promise<BulkSimRow[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('bulk_simulate_reajuste', {
    p_contract_ids: contract_ids,
    p_target_date:  target_date || null,
  });
  fail(r.error);
  return (r.data || []) as BulkSimRow[];
}

export interface BulkApplyRow {
  contract_id:     string;
  contract_numero: string;
  ok:              boolean;
  error:           string | null;
  event_id:        string | null;
  additive_id:     string | null;
  delta:           number | null;
}

export async function bulkApplyReajuste(
  contract_ids: string[],
  target_date?: string,
  notes?: string,
  create_additive = false,
): Promise<BulkApplyRow[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('bulk_apply_reajuste', {
    p_contract_ids:    contract_ids,
    p_target_date:     target_date || null,
    p_notes:           notes || null,
    p_create_additive: create_additive,
  });
  fail(r.error);
  return (r.data || []) as BulkApplyRow[];
}

// =============================================================================
// V33 — Repactuação contratual (Lei 14.133 art. 135)
// =============================================================================

export interface RepactuacaoCandidate {
  item_id: string;
  codigo: string;
  descricao: string;
  unidade: string | null;
  quantidade_total: number;
  preco_unitario_atual: number;
  subtotal: number;
}

export async function listRepactuacaoCandidates(contract_id: string): Promise<RepactuacaoCandidate[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('list_repactuacao_candidates', { p_contract_id: contract_id });
  fail(r.error);
  return (r.data || []) as RepactuacaoCandidate[];
}

export interface RepactuacaoSimulationItem {
  item_id: string;
  codigo: string;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  preco_anterior: number;
  preco_novo: number;
  delta_unitario: number;
  delta_total: number;
}

export interface RepactuacaoSimulation {
  ok: boolean;
  error?: string;
  items_affected?: number;
  items_unchanged?: number;
  value_before: number;
  value_after?: number;
  total_delta?: number;
  variation_percent?: number;
  items?: RepactuacaoSimulationItem[];
}

export async function simulateRepactuacao(
  contract_id: string,
  items: Array<{ item_id: string; preco_novo: number }>,
): Promise<RepactuacaoSimulation> {
  if (SKIP_AUTH) return { ok: false, error: 'modo demo', value_before: 0 };
  checkSupabase();
  const r = await supabase.rpc('simulate_repactuacao', {
    p_contract_id: contract_id,
    p_items: items,
  });
  fail(r.error);
  return r.data as RepactuacaoSimulation;
}

export interface ApplyRepactuacaoResult {
  event_id: string;
  items_affected: number;
  delta_total: number;
  value_after: number;
}

export async function applyRepactuacao(input: {
  contract_id: string;
  items: Array<{ item_id: string; preco_novo: number }>;
  reference_date: string;
  motivacao: string;
  cct_reference?: string;
  notes?: string;
}): Promise<ApplyRepactuacaoResult> {
  if (SKIP_AUTH) return { event_id: 'demo', items_affected: 0, delta_total: 0, value_after: 0 };
  checkSupabase();
  const r = await supabase.rpc('apply_repactuacao', {
    p_contract_id:    input.contract_id,
    p_items:          input.items,
    p_reference_date: input.reference_date,
    p_motivacao:      input.motivacao,
    p_cct_reference:  input.cct_reference || null,
    p_notes:          input.notes || null,
  });
  fail(r.error);
  return r.data as ApplyRepactuacaoResult;
}

export interface RepactuacaoEvent {
  id: string;
  applied_at: string;
  applied_by: string | null;
  applied_by_nome: string | null;
  reference_date: string;
  cct_reference: string | null;
  motivacao: string;
  delta_total: number;
  items_affected: number;
  value_before: number;
  value_after: number;
  variation_percent: number;
  notes: string | null;
}

export async function listContractRepactuacoes(contract_id: string): Promise<RepactuacaoEvent[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('list_contract_repactuacoes', { p_contract_id: contract_id });
  fail(r.error);
  return (r.data || []) as RepactuacaoEvent[];
}

export interface RepactuacaoEventItem {
  item_id: string;
  codigo: string;
  descricao: string;
  unidade: string | null;
  preco_unitario_anterior: number;
  preco_unitario_novo: number;
  delta_unitario: number;
  quantidade_referencia: number;
  delta_total_item: number;
  variation_percent: number;
}

export async function getRepactuacaoEventItems(event_id: string): Promise<RepactuacaoEventItem[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('get_repactuacao_event_items', { p_event_id: event_id });
  fail(r.error);
  return (r.data || []) as RepactuacaoEventItem[];
}

export interface RepactuacaoSummary {
  contract_id: string;
  contract_numero: string;
  valor_inicial: number;
  valor_total_atual: number;
  events_count: number;
  total_repactuado: number;
  last_applied_at: string | null;
  last_delta: number | null;
  percent_sobre_inicial: number;
}

export async function getContractRepactuacaoSummary(contract_id: string): Promise<RepactuacaoSummary> {
  if (SKIP_AUTH) {
    return {
      contract_id, contract_numero: '', valor_inicial: 0, valor_total_atual: 0,
      events_count: 0, total_repactuado: 0, last_applied_at: null, last_delta: null,
      percent_sobre_inicial: 0,
    };
  }
  checkSupabase();
  const r = await supabase.rpc('get_contract_repactuacao_summary', { p_contract_id: contract_id });
  fail(r.error);
  return r.data as RepactuacaoSummary;
}

// =============================================================================
// V34 — Reequilíbrio econômico-financeiro (Lei 14.133 art. 124)
// =============================================================================

export type ReequilibrioStatus =
  | 'rascunho' | 'em_analise_tecnica' | 'em_aprovacao'
  | 'aprovado' | 'aplicado' | 'recusado' | 'cancelado';

export type ReequilibrioTipoEvento =
  | 'alta_insumo' | 'baixa_insumo' | 'fato_principe'
  | 'caso_fortuito' | 'forca_maior' | 'alea_economica' | 'outro';

export type ReequilibrioImpactoTipo = 'valor_aumento' | 'valor_reducao' | 'prazo' | 'misto';

export interface ReequilibrioRow {
  id: string;
  numero: number;
  status: ReequilibrioStatus;
  tipo_evento: ReequilibrioTipoEvento;
  data_evento: string;
  descricao_evento: string;
  impacto_tipo: ReequilibrioImpactoTipo;
  valor_solicitado: number;
  prazo_solicitado_dias: number;
  valor_aprovado: number | null;
  prazo_aprovado_dias: number | null;
  created_at: string;
  created_by_nome: string | null;
  decided_at: string | null;
  applied_at: string | null;
  applied_via_additive_id: string | null;
  applied_via_additive_num: number | null;
}

export interface ReequilibrioDetail extends ReequilibrioRow {
  tenant_id: string;
  contract_id: string;
  contract_numero: string;
  fundamentacao_legal: string;
  parecer_tecnico: string | null;
  analise_at: string | null;
  analista_id: string | null;
  analista_nome: string | null;
  decisao_motivacao: string | null;
  decided_by: string | null;
  decided_by_nome: string | null;
  applied_by: string | null;
  applied_by_nome: string | null;
  application_notes: string | null;
  created_by: string | null;
  metadata: Record<string, unknown>;
  additive_numero: number | null;
}

export interface ReequilibrioSummary {
  total: number;
  open: number;
  aplicado: number;
  recusado: number;
  valor_aprovado_total: number;
}

export async function listContractReequilibrios(contract_id: string): Promise<ReequilibrioRow[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('list_contract_reequilibrios', { p_contract_id: contract_id });
  fail(r.error);
  return (r.data || []) as ReequilibrioRow[];
}

export async function getReequilibrioDetail(id: string): Promise<ReequilibrioDetail> {
  checkSupabase();
  const r = await supabase.rpc('get_reequilibrio_detail', { p_id: id });
  fail(r.error);
  return r.data as ReequilibrioDetail;
}

export async function getContractReequilibrioSummary(contract_id: string): Promise<ReequilibrioSummary> {
  if (SKIP_AUTH) return { total: 0, open: 0, aplicado: 0, recusado: 0, valor_aprovado_total: 0 };
  checkSupabase();
  const r = await supabase.rpc('get_contract_reequilibrio_summary', { p_contract_id: contract_id });
  fail(r.error);
  return r.data as ReequilibrioSummary;
}

export async function createReequilibrioRequest(input: {
  contract_id: string;
  tipo_evento: ReequilibrioTipoEvento;
  data_evento: string;
  descricao: string;
  impacto_tipo: ReequilibrioImpactoTipo;
  valor_solicitado?: number;
  prazo_solicitado_dias?: number;
}): Promise<string> {
  if (SKIP_AUTH) return 'demo';
  checkSupabase();
  const r = await supabase.rpc('create_reequilibrio_request', {
    p_contract_id:           input.contract_id,
    p_tipo_evento:           input.tipo_evento,
    p_data_evento:           input.data_evento,
    p_descricao:             input.descricao,
    p_impacto_tipo:          input.impacto_tipo,
    p_valor_solicitado:      input.valor_solicitado ?? 0,
    p_prazo_solicitado_dias: input.prazo_solicitado_dias ?? 0,
  });
  fail(r.error);
  return r.data as string;
}

export async function submitReequilibrioRequest(id: string): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('submit_reequilibrio_request', { p_id: id });
  fail(r.error);
}

export async function completeTechnicalAnalysis(id: string, parecer: string): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('complete_technical_analysis', { p_id: id, p_parecer_tecnico: parecer });
  fail(r.error);
}

export async function decideReequilibrio(input: {
  id: string;
  aprovar: boolean;
  motivacao: string;
  valor_aprovado?: number | null;
  prazo_aprovado_dias?: number | null;
}): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('decide_reequilibrio', {
    p_id:                   input.id,
    p_aprovar:              input.aprovar,
    p_motivacao:            input.motivacao,
    p_valor_aprovado:       input.valor_aprovado ?? null,
    p_prazo_aprovado_dias:  input.prazo_aprovado_dias ?? null,
  });
  fail(r.error);
}

export async function applyReequilibrio(input: {
  id: string;
  additive_id?: string | null;
  notes?: string;
}): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('apply_reequilibrio', {
    p_id:                 input.id,
    p_additive_id:        input.additive_id ?? null,
    p_application_notes:  input.notes ?? null,
  });
  fail(r.error);
}

export async function cancelReequilibrio(id: string, motivo: string): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('cancel_reequilibrio', { p_id: id, p_motivo: motivo });
  fail(r.error);
}

// Helpers UI
export const REEQUILIBRIO_TIPO_EVENTO_LABELS: Record<ReequilibrioTipoEvento, string> = {
  alta_insumo:    'Alta abrupta de insumo',
  baixa_insumo:   'Baixa abrupta de insumo',
  fato_principe:  'Fato do príncipe',
  caso_fortuito:  'Caso fortuito',
  forca_maior:    'Força maior',
  alea_economica: 'Álea econômica extraordinária',
  outro:          'Outro',
};

export const REEQUILIBRIO_IMPACTO_LABELS: Record<ReequilibrioImpactoTipo, string> = {
  valor_aumento:  'Aumento de valor',
  valor_reducao:  'Redução de valor',
  prazo:          'Concessão de prazo',
  misto:          'Misto (valor + prazo)',
};

export const REEQUILIBRIO_STATUS_LABELS: Record<ReequilibrioStatus, string> = {
  rascunho:           'Rascunho',
  em_analise_tecnica: 'Em análise técnica',
  em_aprovacao:       'Em aprovação',
  aprovado:           'Aprovado',
  aplicado:           'Aplicado',
  recusado:           'Recusado',
  cancelado:          'Cancelado',
};

export function reequilibrioStatusTone(s: ReequilibrioStatus): 'slate' | 'blue' | 'purple' | 'green' | 'red' {
  if (s === 'rascunho')           return 'slate';
  if (s === 'em_analise_tecnica') return 'blue';
  if (s === 'em_aprovacao')       return 'purple';
  if (s === 'aprovado')           return 'green';
  if (s === 'aplicado')           return 'green';
  if (s === 'recusado')           return 'red';
  return 'slate';
}

// =============================================================================
// V35 — Recebimento provisório e definitivo (Lei 14.133 art. 140)
// =============================================================================

export type ReceiptTipo = 'provisorio' | 'definitivo';
export type ReceiptStatus = 'rascunho' | 'emitido' | 'com_pendencias' | 'sanado' | 'recusado' | 'cancelado';
export type VicioSeveridade = 'baixa' | 'media' | 'alta' | 'critica';
export type VicioStatus = 'aberto' | 'em_saneamento' | 'sanado' | 'aceito_residual' | 'cancelado';

export interface ContractReceipt {
  id: string;
  tipo: ReceiptTipo;
  numero: number;
  status: ReceiptStatus;
  data_emissao: string | null;
  data_limite_definitivo: string | null;
  emitido_por_nome: string | null;
  provisorio_id: string | null;
  provisorio_numero: number | null;
  prazo_garantia_meses: number | null;
  garantia_inicio: string | null;
  garantia_fim: string | null;
  vicios_abertos: number;
  vicios_total: number;
  created_at: string;
}

export interface ReceiptVicio {
  id: string;
  ordem: number;
  severidade: VicioSeveridade;
  descricao: string;
  local_referencia: string | null;
  prazo_saneamento_dias: number;
  data_limite_saneamento: string | null;
  status: VicioStatus;
  sanado_at: string | null;
  sanado_por_nome: string | null;
  evidencia_saneamento: string | null;
  created_at: string;
}

export interface ReceiptsSummary {
  provisorios_emitidos: number;
  definitivos_emitidos: number;
  vicios_abertos: number;
  garantia_ativa: boolean;
  garantia_fim: string | null;
  garantia_dias_restantes: number | null;
}

// V51: Mock realista para c3 (#211 Rio CIEP) com vício aberto "concreto fora de fck".
// Apenas c3 tem recebimento; demais contratos retornam vazio (preserva narrativa V50).
const MOCK_RECEIPTS_C3: ContractReceipt[] = [{
  id: 'rec-c3-1', tipo: 'provisorio', numero: 1, status: 'com_pendencias',
  data_emissao: '2025-10-25', data_limite_definitivo: '2026-01-23',
  emitido_por_nome: 'Patrícia Lopes',
  provisorio_id: null, provisorio_numero: null,
  prazo_garantia_meses: 60, garantia_inicio: '2025-10-25', garantia_fim: '2030-10-25',
  vicios_abertos: 1, vicios_total: 1,
  created_at: '2025-10-25T10:00:00Z',
}];

const MOCK_VICIOS_C3_REC1: ReceiptVicio[] = [{
  id: 'vic-c3-1', ordem: 1, severidade: 'alta',
  descricao: 'Concreto fora de fck (35MPa) em pilares do bloco B · análise laboratorial confirmada',
  local_referencia: 'Bloco B · pilares P12-P18',
  prazo_saneamento_dias: 30, data_limite_saneamento: '2025-12-02',
  status: 'em_saneamento', sanado_at: null, sanado_por_nome: null,
  evidencia_saneamento: null,
  created_at: '2025-11-02T09:00:00Z',
}];

export async function listContractReceipts(contract_id: string): Promise<ContractReceipt[]> {
  if (SKIP_AUTH) return contract_id === 'c3' ? MOCK_RECEIPTS_C3 : [];
  checkSupabase();
  const r = await supabase.rpc('list_contract_receipts', { p_contract_id: contract_id });
  fail(r.error);
  return (r.data || []) as ContractReceipt[];
}

export async function listReceiptVicios(receipt_id: string): Promise<ReceiptVicio[]> {
  if (SKIP_AUTH) return receipt_id === 'rec-c3-1' ? MOCK_VICIOS_C3_REC1 : [];
  checkSupabase();
  const r = await supabase.rpc('list_receipt_vicios', { p_receipt_id: receipt_id });
  fail(r.error);
  return (r.data || []) as ReceiptVicio[];
}

export async function getContractReceiptsSummary(contract_id: string): Promise<ReceiptsSummary> {
  if (SKIP_AUTH) {
    if (contract_id === 'c3') {
      return { provisorios_emitidos: 1, definitivos_emitidos: 0, vicios_abertos: 1,
               garantia_ativa: true, garantia_fim: '2030-10-25', garantia_dias_restantes: 1804 };
    }
    return { provisorios_emitidos: 0, definitivos_emitidos: 0, vicios_abertos: 0,
             garantia_ativa: false, garantia_fim: null, garantia_dias_restantes: null };
  }
  checkSupabase();
  const r = await supabase.rpc('get_contract_receipts_summary', { p_contract_id: contract_id });
  fail(r.error);
  return r.data as ReceiptsSummary;
}

export async function createReceipt(input: {
  contract_id: string;
  tipo: ReceiptTipo;
  data_comunicacao?: string | null;
  provisorio_id?: string | null;
  medicao_inicial_id?: string | null;
  medicao_final_id?: string | null;
  observacoes?: string | null;
}): Promise<string> {
  if (SKIP_AUTH) return 'demo';
  checkSupabase();
  const r = await supabase.rpc('create_receipt', {
    p_contract_id:        input.contract_id,
    p_tipo:               input.tipo,
    p_data_comunicacao:   input.data_comunicacao ?? null,
    p_provisorio_id:      input.provisorio_id ?? null,
    p_medicao_inicial_id: input.medicao_inicial_id ?? null,
    p_medicao_final_id:   input.medicao_final_id ?? null,
    p_observacoes:        input.observacoes ?? null,
  });
  fail(r.error);
  return r.data as string;
}

export async function emitReceipt(input: {
  id: string;
  data_emissao?: string;
  parecer_tecnico?: string;
  prazo_garantia_meses?: number | null;
}): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('emit_receipt', {
    p_id:                   input.id,
    p_data_emissao:         input.data_emissao ?? null,
    p_parecer_tecnico:      input.parecer_tecnico ?? null,
    p_prazo_garantia_meses: input.prazo_garantia_meses ?? null,
  });
  fail(r.error);
}

export async function addReceiptVicio(input: {
  receipt_id: string;
  descricao: string;
  severidade?: VicioSeveridade;
  local_referencia?: string;
  prazo_saneamento_dias?: number;
}): Promise<string> {
  if (SKIP_AUTH) return 'demo';
  checkSupabase();
  const r = await supabase.rpc('add_receipt_vicio', {
    p_receipt_id:            input.receipt_id,
    p_descricao:             input.descricao,
    p_severidade:            input.severidade ?? 'media',
    p_local_referencia:      input.local_referencia ?? null,
    p_prazo_saneamento_dias: input.prazo_saneamento_dias ?? 30,
  });
  fail(r.error);
  return r.data as string;
}

export async function resolveVicio(
  vicio_id: string, novo_status: 'sanado' | 'aceito_residual' | 'cancelado', evidencia?: string,
): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('resolve_vicio', {
    p_vicio_id: vicio_id, p_novo_status: novo_status, p_evidencia: evidencia ?? null,
  });
  fail(r.error);
}

export async function cancelReceipt(id: string, motivo: string): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('cancel_receipt', { p_id: id, p_motivo: motivo });
  fail(r.error);
}

// Labels/tones
export const RECEIPT_TIPO_LABELS: Record<ReceiptTipo, string> = {
  provisorio: 'Provisório',
  definitivo: 'Definitivo',
};

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  rascunho:        'Rascunho',
  emitido:         'Emitido',
  com_pendencias:  'Com pendências',
  sanado:          'Sanado',
  recusado:        'Recusado',
  cancelado:       'Cancelado',
};

export function receiptStatusTone(s: ReceiptStatus): 'slate' | 'blue' | 'yellow' | 'green' | 'red' {
  if (s === 'rascunho')        return 'slate';
  if (s === 'emitido')         return 'blue';
  if (s === 'com_pendencias')  return 'yellow';
  if (s === 'sanado')          return 'green';
  if (s === 'recusado')        return 'red';
  return 'slate';
}

export const VICIO_SEVERIDADE_LABELS: Record<VicioSeveridade, string> = {
  baixa:   'Baixa',
  media:   'Média',
  alta:    'Alta',
  critica: 'Crítica',
};

export function vicioSeveridadeTone(s: VicioSeveridade): 'slate' | 'blue' | 'yellow' | 'red' {
  if (s === 'baixa')   return 'slate';
  if (s === 'media')   return 'blue';
  if (s === 'alta')    return 'yellow';
  if (s === 'critica') return 'red';
  return 'slate';
}

export const VICIO_STATUS_LABELS: Record<VicioStatus, string> = {
  aberto:           'Aberto',
  em_saneamento:    'Em saneamento',
  sanado:           'Sanado',
  aceito_residual:  'Aceito residual',
  cancelado:        'Cancelado',
};

// =============================================================================
// V36 — Garantias contratuais (Lei 14.133 art. 96-101)
// =============================================================================

export type GuaranteeModalidade =
  | 'caucao_dinheiro' | 'caucao_titulos' | 'seguro_garantia' | 'fianca_bancaria';

export type GuaranteeStatus =
  | 'ativa' | 'estendida' | 'liberada_parcial' | 'liberada_total'
  | 'executada_parcial' | 'executada_total' | 'cancelada' | 'vencida';

export type GuaranteeEventTipo =
  | 'registro' | 'extensao' | 'liberacao' | 'execucao' | 'cancelamento' | 'renovacao_valor';

export interface ContractGuarantee {
  id: string;
  numero: number;
  modalidade: GuaranteeModalidade;
  emissor: string | null;
  instrumento_numero: string | null;
  valor_garantido: number;
  valor_disponivel: number;
  percentual_contrato: number | null;
  data_emissao: string;
  data_vigencia_inicio: string;
  data_vigencia_fim: string;
  dias_para_vencimento: number;
  status: GuaranteeStatus;
  ultimo_aditivo_num: number | null;
  events_count: number;
}

export interface GuaranteeEvent {
  id: string;
  tipo: GuaranteeEventTipo;
  valor_movimentado: number;
  valor_disponivel_apos: number;
  data_evento: string;
  nova_vigencia_fim: string | null;
  aditivo_id: string | null;
  aditivo_numero: number | null;
  receipt_id: string | null;
  receipt_numero: number | null;
  motivacao: string;
  evidencia: string | null;
  applied_by_nome: string | null;
  created_at: string;
}

export interface GuaranteesSummary {
  total: number;
  ativas: number;
  valor_disponivel: number;
  valor_executado_total: number;
  valor_liberado_total: number;
  proximo_vencimento: {
    id: string;
    numero: number;
    data_fim: string;
    dias_restantes: number;
  } | null;
}

// V51: Mock realista para c4 (#298 UPA Petrópolis) com garantia caução em dinheiro
// vencendo em 6 dias — coerente com `garantias_7d` no MOCK_TENANT_DASHBOARD.
const MOCK_GUARANTEES_C4: ContractGuarantee[] = [{
  id: 'gar-c4-1', numero: 128, modalidade: 'caucao_dinheiro',
  emissor: null, instrumento_numero: 'CAU-2024/0298-001',
  valor_garantido: 560_000, valor_disponivel: 560_000,
  percentual_contrato: 5.0,
  data_emissao: '2024-11-20',
  data_vigencia_inicio: '2024-11-20', data_vigencia_fim: '2025-11-20',
  dias_para_vencimento: 6,
  status: 'ativa', ultimo_aditivo_num: null, events_count: 1,
}];

const MOCK_GUARANTEE_EVENTS_C4_1: GuaranteeEvent[] = [{
  id: 'ge-c4-1-1', tipo: 'registro',
  valor_movimentado: 560_000, valor_disponivel_apos: 560_000,
  data_evento: '2024-11-20', nova_vigencia_fim: '2025-11-20',
  aditivo_id: null, aditivo_numero: null,
  receipt_id: null, receipt_numero: null,
  motivacao: 'Registro inicial da garantia contratual · caução em dinheiro · 5% do valor inicial',
  evidencia: 'CAU-2024/0298-001.pdf',
  applied_by_nome: 'Eduardo Vargas', created_at: '2024-11-20T10:00:00Z',
}];

export async function listContractGuarantees(contract_id: string): Promise<ContractGuarantee[]> {
  if (SKIP_AUTH) return contract_id === 'c4' ? MOCK_GUARANTEES_C4 : [];
  checkSupabase();
  const r = await supabase.rpc('list_contract_guarantees', { p_contract_id: contract_id });
  fail(r.error);
  return (r.data || []) as ContractGuarantee[];
}

export async function listGuaranteeEvents(guarantee_id: string): Promise<GuaranteeEvent[]> {
  if (SKIP_AUTH) return guarantee_id === 'gar-c4-1' ? MOCK_GUARANTEE_EVENTS_C4_1 : [];
  checkSupabase();
  const r = await supabase.rpc('list_guarantee_events', { p_guarantee_id: guarantee_id });
  fail(r.error);
  return (r.data || []) as GuaranteeEvent[];
}

export async function getContractGuaranteesSummary(contract_id: string): Promise<GuaranteesSummary> {
  if (SKIP_AUTH) {
    if (contract_id === 'c4') {
      return {
        total: 1, ativas: 1, valor_disponivel: 560_000,
        valor_executado_total: 0, valor_liberado_total: 0,
        proximo_vencimento: { id: 'gar-c4-1', numero: 128, data_fim: '2025-11-20', dias_restantes: 6 },
      };
    }
    return {
      total: 0, ativas: 0, valor_disponivel: 0,
      valor_executado_total: 0, valor_liberado_total: 0,
      proximo_vencimento: null,
    };
  }
  checkSupabase();
  const r = await supabase.rpc('get_contract_guarantees_summary', { p_contract_id: contract_id });
  fail(r.error);
  return r.data as GuaranteesSummary;
}

export async function registerGuarantee(input: {
  contract_id: string;
  modalidade: GuaranteeModalidade;
  valor_garantido: number;
  data_emissao: string;
  data_vigencia_inicio: string;
  data_vigencia_fim: string;
  emissor?: string;
  instrumento_numero?: string;
  beneficiario?: string;
  observacoes?: string;
}): Promise<string> {
  if (SKIP_AUTH) return 'demo';
  checkSupabase();
  const r = await supabase.rpc('register_guarantee', {
    p_contract_id:          input.contract_id,
    p_modalidade:           input.modalidade,
    p_valor_garantido:      input.valor_garantido,
    p_data_emissao:         input.data_emissao,
    p_data_vigencia_inicio: input.data_vigencia_inicio,
    p_data_vigencia_fim:    input.data_vigencia_fim,
    p_emissor:              input.emissor ?? null,
    p_instrumento_numero:   input.instrumento_numero ?? null,
    p_beneficiario:         input.beneficiario ?? null,
    p_observacoes:          input.observacoes ?? null,
  });
  fail(r.error);
  return r.data as string;
}

export async function extendGuarantee(input: {
  guarantee_id: string;
  nova_vigencia_fim: string;
  motivacao: string;
  aditivo_id?: string;
  evidencia?: string;
}): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('extend_guarantee', {
    p_guarantee_id:      input.guarantee_id,
    p_nova_vigencia_fim: input.nova_vigencia_fim,
    p_motivacao:         input.motivacao,
    p_aditivo_id:        input.aditivo_id ?? null,
    p_evidencia:         input.evidencia ?? null,
  });
  fail(r.error);
}

export async function releaseGuarantee(input: {
  guarantee_id: string;
  valor: number;
  motivacao: string;
  receipt_id?: string;
  evidencia?: string;
}): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('release_guarantee', {
    p_guarantee_id: input.guarantee_id,
    p_valor:        input.valor,
    p_motivacao:    input.motivacao,
    p_receipt_id:   input.receipt_id ?? null,
    p_evidencia:    input.evidencia ?? null,
  });
  fail(r.error);
}

export async function executeGuarantee(input: {
  guarantee_id: string;
  valor: number;
  motivacao: string;
  evidencia?: string;
}): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('execute_guarantee', {
    p_guarantee_id: input.guarantee_id,
    p_valor:        input.valor,
    p_motivacao:    input.motivacao,
    p_evidencia:    input.evidencia ?? null,
  });
  fail(r.error);
}

export async function cancelGuarantee(id: string, motivo: string): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('cancel_guarantee', { p_id: id, p_motivo: motivo });
  fail(r.error);
}

// Labels/tones
export const GUARANTEE_MODALIDADE_LABELS: Record<GuaranteeModalidade, string> = {
  caucao_dinheiro: 'Caução em dinheiro',
  caucao_titulos:  'Caução em títulos (TDP)',
  seguro_garantia: 'Seguro-garantia',
  fianca_bancaria: 'Fiança bancária',
};

export const GUARANTEE_STATUS_LABELS: Record<GuaranteeStatus, string> = {
  ativa:             'Ativa',
  estendida:         'Estendida',
  liberada_parcial:  'Liberada parcial',
  liberada_total:    'Liberada total',
  executada_parcial: 'Executada parcial',
  executada_total:   'Executada total',
  cancelada:         'Cancelada',
  vencida:           'Vencida',
};

export function guaranteeStatusTone(s: GuaranteeStatus): 'slate' | 'blue' | 'green' | 'red' | 'yellow' | 'purple' {
  if (s === 'ativa')               return 'green';
  if (s === 'estendida')           return 'blue';
  if (s === 'liberada_parcial')    return 'yellow';
  if (s === 'liberada_total')      return 'slate';
  if (s === 'executada_parcial')   return 'red';
  if (s === 'executada_total')     return 'red';
  if (s === 'cancelada')           return 'slate';
  if (s === 'vencida')             return 'red';
  return 'slate';
}

export const GUARANTEE_EVENT_TIPO_LABELS: Record<GuaranteeEventTipo, string> = {
  registro:        'Registro inicial',
  extensao:        'Extensão de vigência',
  liberacao:       'Liberação',
  execucao:        'Execução',
  cancelamento:    'Cancelamento',
  renovacao_valor: 'Renovação de valor',
};

export function guaranteeEventTipoTone(t: GuaranteeEventTipo): 'slate' | 'blue' | 'green' | 'red' | 'purple' {
  if (t === 'registro')        return 'green';
  if (t === 'extensao')        return 'blue';
  if (t === 'liberacao')       return 'slate';
  if (t === 'execucao')        return 'red';
  if (t === 'cancelamento')    return 'slate';
  if (t === 'renovacao_valor') return 'purple';
  return 'slate';
}

// =============================================================================
// V37 — Apuração Administrativa / PAR (Lei 14.133 art. 158)
// =============================================================================

export type ParStatus =
  | 'rascunho' | 'instaurado' | 'em_defesa' | 'em_instrucao' | 'em_julgamento'
  | 'decidido' | 'em_recurso' | 'arquivado' | 'cancelado';

export type ParTipoInfracao =
  | 'inexecucao_parcial' | 'inexecucao_total' | 'atraso_injustificado'
  | 'qualidade_inferior' | 'fraude_documental' | 'recusa_assinar'
  | 'descumprimento_clausula' | 'subcontratacao_irregular' | 'outra';

export type ParResultado = 'procedente' | 'parcialmente_procedente' | 'improcedente';
export type ParRecursoResultado = 'provido' | 'parcialmente_provido' | 'improvido';
export type ParSancaoTipo = 'advertencia' | 'multa' | 'impedimento' | 'inidoneidade';

export interface ParRow {
  id: string;
  numero: number;
  status: ParStatus;
  tipo_infracao: ParTipoInfracao;
  data_ocorrencia: string;
  instaurado_at: string | null;
  defesa_prazo_limite: string | null;
  decisao_resultado: ParResultado | null;
  recurso_resultado: ParRecursoResultado | null;
  created_at: string;
  created_by_nome: string | null;
}

export interface ParDetail extends ParRow {
  tenant_id: string;
  contract_id: string;
  contract_numero: string;
  fato_descricao: string;
  fundamentacao_legal: string;
  comissao_designacao: string | null;
  comissao_members: Array<Record<string, unknown>>;
  instaurado_por_nome: string | null;
  instauracao_documento: string | null;
  defesa_prazo_dias: number;
  defesa_apresentada_at: string | null;
  defesa_apresentada_por_nome: string | null;
  defesa_resumo: string | null;
  defesa_documento: string | null;
  instrucao_concluida_at: string | null;
  instrucao_parecer: string | null;
  instrucao_por_nome: string | null;
  decisao_at: string | null;
  decisao_por_nome: string | null;
  decisao_motivacao: string | null;
  sancao_proposta: string | null;
  sancao_proposta_tipos: ParSancaoTipo[] | null;
  recurso_aberto_at: string | null;
  recurso_motivacao: string | null;
  recurso_julgado_at: string | null;
  recurso_motivacao_julgamento: string | null;
  arquivado_at: string | null;
  vinculos: Record<string, string[]>;
  metadata: Record<string, unknown>;
}

export interface ParStep {
  id: string;
  step_type: string;
  step_at: string;
  status_anterior: string | null;
  status_novo: string | null;
  descricao: string | null;
  applied_by_nome: string | null;
  metadata: Record<string, unknown>;
}

export interface ParSummary {
  total: number;
  em_andamento: number;
  procedentes: number;
  improcedentes: number;
  em_defesa: number;
  prazo_estourado: number;
}

// V51: Mock realista para c2 (#107 Niterói) — PAR-2025/003 em fase de defesa.
// Coerente com MOCK_PENDENCIAS (par_defesa) e MOCK_TENANT_DASHBOARD (next_dates · par_defesa).
const MOCK_PARS_C2: ParRow[] = [{
  id: 'par-c2-1', numero: 3, status: 'em_defesa',
  tipo_infracao: 'atraso_injustificado',
  data_ocorrencia: '2025-10-20', instaurado_at: '2025-11-08T11:30:00Z',
  defesa_prazo_limite: '2025-11-20',
  decisao_resultado: null, recurso_resultado: null,
  created_at: '2025-11-08T11:30:00Z', created_by_nome: 'Ricardo Mendes',
}];

const MOCK_PAR_STEPS_C2: ParStep[] = [
  { id: 'step-par-c2-1', step_type: 'criado', step_at: '2025-11-08T11:30:00Z',
    status_anterior: null, status_novo: 'rascunho',
    descricao: 'PAR criado por atraso reiterado nas entregas',
    applied_by_nome: 'Ricardo Mendes', metadata: {} },
  { id: 'step-par-c2-2', step_type: 'instaurado', step_at: '2025-11-08T15:00:00Z',
    status_anterior: 'rascunho', status_novo: 'instaurado',
    descricao: 'Instaurado por decisão da autoridade designante',
    applied_by_nome: 'Eduardo Vargas', metadata: {} },
  { id: 'step-par-c2-3', step_type: 'em_defesa', step_at: '2025-11-08T15:00:01Z',
    status_anterior: 'instaurado', status_novo: 'em_defesa',
    descricao: 'Notificada a contratada; prazo de defesa: 10 dias úteis',
    applied_by_nome: 'Eduardo Vargas',
    metadata: { prazo_dias: 10, limite: '2025-11-20' } },
];

export async function listContractPars(contract_id: string): Promise<ParRow[]> {
  if (SKIP_AUTH) return contract_id === 'c2' ? MOCK_PARS_C2 : [];
  checkSupabase();
  const r = await supabase.rpc('list_contract_pars', { p_contract_id: contract_id });
  fail(r.error);
  return (r.data || []) as ParRow[];
}

export async function getParDetail(id: string): Promise<ParDetail> {
  checkSupabase();
  const r = await supabase.rpc('get_par_detail', { p_id: id });
  fail(r.error);
  return r.data as ParDetail;
}

export async function listParSteps(par_id: string): Promise<ParStep[]> {
  if (SKIP_AUTH) return par_id === 'par-c2-1' ? MOCK_PAR_STEPS_C2 : [];
  checkSupabase();
  const r = await supabase.rpc('list_par_steps', { p_par_id: par_id });
  fail(r.error);
  return (r.data || []) as ParStep[];
}

export async function getContractParsSummary(contract_id: string): Promise<ParSummary> {
  if (SKIP_AUTH) {
    if (contract_id === 'c2') {
      return { total: 1, em_andamento: 1, procedentes: 0, improcedentes: 0, em_defesa: 1, prazo_estourado: 0 };
    }
    return { total: 0, em_andamento: 0, procedentes: 0, improcedentes: 0, em_defesa: 0, prazo_estourado: 0 };
  }
  checkSupabase();
  const r = await supabase.rpc('get_contract_pars_summary', { p_contract_id: contract_id });
  fail(r.error);
  return r.data as ParSummary;
}

export async function createParProcess(input: {
  contract_id: string;
  tipo_infracao: ParTipoInfracao;
  fato_descricao: string;
  data_ocorrencia: string;
  vinculos?: Record<string, string[]>;
}): Promise<string> {
  if (SKIP_AUTH) return 'demo';
  checkSupabase();
  const r = await supabase.rpc('create_par_process', {
    p_contract_id:     input.contract_id,
    p_tipo_infracao:   input.tipo_infracao,
    p_fato_descricao:  input.fato_descricao,
    p_data_ocorrencia: input.data_ocorrencia,
    p_vinculos:        input.vinculos ?? {},
  });
  fail(r.error);
  return r.data as string;
}

export async function instaurarePar(input: {
  id: string;
  comissao_designacao: string;
  comissao_members?: Array<Record<string, unknown>>;
  instauracao_documento?: string;
  defesa_prazo_dias?: number;
}): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('instaurate_par', {
    p_id:                     input.id,
    p_comissao_designacao:    input.comissao_designacao,
    p_comissao_members:       input.comissao_members ?? [],
    p_instauracao_documento:  input.instauracao_documento ?? null,
    p_defesa_prazo_dias:      input.defesa_prazo_dias ?? 15,
  });
  fail(r.error);
}

export async function registerParDefesa(input: {
  id: string;
  defesa_resumo: string;
  revelia?: boolean;
  defesa_documento?: string;
}): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('register_par_defesa', {
    p_id:               input.id,
    p_defesa_resumo:    input.defesa_resumo,
    p_revelia:          input.revelia ?? false,
    p_defesa_documento: input.defesa_documento ?? null,
  });
  fail(r.error);
}

export async function concludeParInstrucao(id: string, parecer: string): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('conclude_par_instrucao', { p_id: id, p_parecer: parecer });
  fail(r.error);
}

export async function decidePar(input: {
  id: string;
  resultado: ParResultado;
  motivacao: string;
  sancao_proposta?: string;
  sancao_tipos?: ParSancaoTipo[];
}): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('decide_par', {
    p_id:              input.id,
    p_resultado:       input.resultado,
    p_motivacao:       input.motivacao,
    p_sancao_proposta: input.sancao_proposta ?? null,
    p_sancao_tipos:    input.sancao_tipos ?? null,
  });
  fail(r.error);
}

export async function openParRecurso(id: string, motivacao: string): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('open_par_recurso', { p_id: id, p_motivacao: motivacao });
  fail(r.error);
}

export async function judgeParRecurso(input: {
  id: string;
  resultado_recurso: ParRecursoResultado;
  motivacao_julgamento: string;
}): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('judge_par_recurso', {
    p_id:                     input.id,
    p_resultado_recurso:      input.resultado_recurso,
    p_motivacao_julgamento:   input.motivacao_julgamento,
  });
  fail(r.error);
}

export async function archivePar(id: string): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('archive_par', { p_id: id });
  fail(r.error);
}

export async function cancelPar(id: string, motivo: string): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('cancel_par', { p_id: id, p_motivo: motivo });
  fail(r.error);
}

// Labels/tones
export const PAR_STATUS_LABELS: Record<ParStatus, string> = {
  rascunho:      'Rascunho',
  instaurado:    'Instaurado',
  em_defesa:     'Em defesa',
  em_instrucao:  'Em instrução',
  em_julgamento: 'Em julgamento',
  decidido:      'Decidido',
  em_recurso:    'Em recurso',
  arquivado:     'Arquivado',
  cancelado:     'Cancelado',
};

export function parStatusTone(s: ParStatus): 'slate' | 'blue' | 'yellow' | 'purple' | 'green' | 'red' {
  if (s === 'rascunho')      return 'slate';
  if (s === 'instaurado')    return 'blue';
  if (s === 'em_defesa')     return 'yellow';
  if (s === 'em_instrucao')  return 'blue';
  if (s === 'em_julgamento') return 'purple';
  if (s === 'decidido')      return 'green';
  if (s === 'em_recurso')    return 'purple';
  if (s === 'arquivado')     return 'slate';
  if (s === 'cancelado')     return 'slate';
  return 'slate';
}

export const PAR_TIPO_INFRACAO_LABELS: Record<ParTipoInfracao, string> = {
  inexecucao_parcial:       'Inexecução parcial',
  inexecucao_total:         'Inexecução total',
  atraso_injustificado:     'Atraso injustificado',
  qualidade_inferior:       'Qualidade inferior à especificada',
  fraude_documental:        'Fraude documental',
  recusa_assinar:           'Recusa em assinar/manter proposta',
  descumprimento_clausula:  'Descumprimento de cláusula contratual',
  subcontratacao_irregular: 'Subcontratação irregular',
  outra:                    'Outra',
};

export const PAR_RESULTADO_LABELS: Record<ParResultado, string> = {
  procedente:              'Procedente',
  parcialmente_procedente: 'Parcialmente procedente',
  improcedente:            'Improcedente',
};

export function parResultadoTone(r: ParResultado | null | undefined): 'slate' | 'green' | 'yellow' | 'red' {
  if (r === 'procedente')              return 'red';
  if (r === 'parcialmente_procedente') return 'yellow';
  if (r === 'improcedente')            return 'green';
  return 'slate';
}

export const PAR_RECURSO_RESULTADO_LABELS: Record<ParRecursoResultado, string> = {
  provido:              'Provido',
  parcialmente_provido: 'Parcialmente provido',
  improvido:            'Improvido',
};

export const PAR_SANCAO_TIPO_LABELS: Record<ParSancaoTipo, string> = {
  advertencia:   'Advertência',
  multa:         'Multa',
  impedimento:   'Impedimento de licitar/contratar',
  inidoneidade:  'Declaração de inidoneidade',
};

export function parSancaoTipoTone(t: ParSancaoTipo): 'slate' | 'yellow' | 'red' {
  if (t === 'advertencia')  return 'slate';
  if (t === 'multa')        return 'yellow';
  if (t === 'impedimento')  return 'red';
  if (t === 'inidoneidade') return 'red';
  return 'slate';
}

// =============================================================================
// V38 — Sanções e impedimentos (Lei 14.133 art. 156)
// =============================================================================

export type SanctionTipo = 'advertencia' | 'multa' | 'impedimento' | 'inidoneidade';
export type SanctionStatus = 'ativa' | 'cumprida' | 'suspensa' | 'revogada';
export type SanctionEventTipo = 'aplicacao' | 'pagamento_multa' | 'suspensao' | 'reativacao' | 'revogacao' | 'cumprimento';

export interface ContractSanction {
  id: string;
  numero: number;
  tipo: SanctionTipo;
  status: SanctionStatus;
  data_aplicacao: string;
  documento_aplicacao: string | null;
  fundamentacao: string;
  par_id: string | null;
  par_numero: number | null;
  valor_multa: number | null;
  data_pagamento_multa: string | null;
  data_vencimento_multa: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  duracao_meses: number | null;
  dias_para_vencimento: number | null;
  autoridade_nome: string | null;
  created_at: string;
}

export interface SanctionEvent {
  id: string;
  tipo: SanctionEventTipo;
  status_anterior: string | null;
  status_novo: string | null;
  descricao: string;
  applied_by_nome: string | null;
  applied_at: string;
  metadata: Record<string, unknown>;
}

export interface SanctionsSummary {
  total: number;
  ativas: number;
  advertencias: number;
  multas: number;
  impedimentos: number;
  inidoneidades: number;
  multa_total: number;
  multa_paga: number;
  multa_pendente: number;
  proximo_vencimento: {
    id: string;
    numero: number;
    tipo: SanctionTipo;
    data: string;
    dias_restantes: number;
  } | null;
}

// V51: Mock realista para c2 (#107 Niterói) — 2 sanções coerentes com narrativa:
//   #1 multa R$ 245k aplicada 12/11, vencimento 12/12 (PAR-2025/002 anterior)
//   #2 impedimento de licitar 6 meses aplicado 14/11 (fraude documental comprovada)
// Coerentes com MOCK_PENDENCIAS (sancao_multa_pendente) + MOCK_TENANT_DASHBOARD.
const MOCK_SANCTIONS_C2: ContractSanction[] = [
  { id: 'sanc-c2-1', numero: 1, tipo: 'multa', status: 'ativa',
    data_aplicacao: '2025-11-12', documento_aplicacao: 'Decisão 045/2025',
    fundamentacao: 'Multa por atraso reiterado · cláusula 12.4 do contrato · resultado do PAR-2025/002',
    par_id: null, par_numero: 2,
    valor_multa: 245_000, data_pagamento_multa: null,
    data_vencimento_multa: '2025-12-12',
    vigencia_inicio: null, vigencia_fim: null, duracao_meses: null,
    dias_para_vencimento: 28,
    autoridade_nome: 'Mariana Costa (Diretora SEEDUC)', created_at: '2025-11-12T14:20:00Z' },
  { id: 'sanc-c2-2', numero: 2, tipo: 'impedimento', status: 'ativa',
    data_aplicacao: '2025-11-14', documento_aplicacao: 'Decisão 046/2025',
    fundamentacao: 'Impedimento de licitar e contratar com a Administração · fraude documental comprovada (art. 156, III)',
    par_id: null, par_numero: 2,
    valor_multa: null, data_pagamento_multa: null, data_vencimento_multa: null,
    vigencia_inicio: '2025-11-14', vigencia_fim: '2026-05-14',
    duracao_meses: 6, dias_para_vencimento: 180,
    autoridade_nome: 'Mariana Costa (Diretora SEEDUC)', created_at: '2025-11-14T10:00:00Z' },
];

const MOCK_SANCTION_EVENTS: Record<string, SanctionEvent[]> = {
  'sanc-c2-1': [{
    id: 'sev-c2-1-1', tipo: 'aplicacao',
    status_anterior: null, status_novo: 'ativa',
    descricao: 'Multa aplicada após análise do PAR-2025/002 · resultado procedente',
    applied_by_nome: 'Mariana Costa', applied_at: '2025-11-12T14:20:00Z',
    metadata: { valor: 245_000, vencimento: '2025-12-12', par_numero: 2 },
  }],
  'sanc-c2-2': [{
    id: 'sev-c2-2-1', tipo: 'aplicacao',
    status_anterior: null, status_novo: 'ativa',
    descricao: 'Impedimento aplicado — duração 6 meses · vigência até 14/05/2026',
    applied_by_nome: 'Mariana Costa', applied_at: '2025-11-14T10:00:00Z',
    metadata: { duracao_meses: 6, vigencia_fim: '2026-05-14' },
  }],
};

export async function listContractSanctions(contract_id: string): Promise<ContractSanction[]> {
  if (SKIP_AUTH) return contract_id === 'c2' ? MOCK_SANCTIONS_C2 : [];
  checkSupabase();
  const r = await supabase.rpc('list_contract_sanctions', { p_contract_id: contract_id });
  fail(r.error);
  return (r.data || []) as ContractSanction[];
}

export async function listSanctionEvents(sanction_id: string): Promise<SanctionEvent[]> {
  if (SKIP_AUTH) return MOCK_SANCTION_EVENTS[sanction_id] || [];
  checkSupabase();
  const r = await supabase.rpc('list_sanction_events', { p_sanction_id: sanction_id });
  fail(r.error);
  return (r.data || []) as SanctionEvent[];
}

export async function getContractSanctionsSummary(contract_id: string): Promise<SanctionsSummary> {
  if (SKIP_AUTH) {
    if (contract_id === 'c2') {
      return {
        total: 2, ativas: 2, advertencias: 0, multas: 1, impedimentos: 1, inidoneidades: 0,
        multa_total: 245_000, multa_paga: 0, multa_pendente: 245_000,
        proximo_vencimento: { id: 'sanc-c2-1', numero: 1, tipo: 'multa',
                              data: '2025-12-12', dias_restantes: 28 },
      };
    }
    return {
      total: 0, ativas: 0, advertencias: 0, multas: 0, impedimentos: 0, inidoneidades: 0,
      multa_total: 0, multa_paga: 0, multa_pendente: 0, proximo_vencimento: null,
    };
  }
  checkSupabase();
  const r = await supabase.rpc('get_contract_sanctions_summary', { p_contract_id: contract_id });
  fail(r.error);
  return r.data as SanctionsSummary;
}

export async function registerSanction(input: {
  contract_id: string;
  tipo: SanctionTipo;
  fundamentacao: string;
  documento_aplicacao?: string;
  par_id?: string;
  // multa
  base_calculo?: number;
  percentual?: number;
  valor_multa?: number;
  data_vencimento_multa?: string;
  // impedimento/inidoneidade
  vigencia_inicio?: string;
  duracao_meses?: number;
  observacoes?: string;
}): Promise<string> {
  if (SKIP_AUTH) return 'demo';
  checkSupabase();
  const r = await supabase.rpc('register_sanction', {
    p_contract_id:           input.contract_id,
    p_tipo:                  input.tipo,
    p_fundamentacao:         input.fundamentacao,
    p_documento_aplicacao:   input.documento_aplicacao ?? null,
    p_par_id:                input.par_id ?? null,
    p_base_calculo:          input.base_calculo ?? null,
    p_percentual:            input.percentual ?? null,
    p_valor_multa:           input.valor_multa ?? null,
    p_data_vencimento_multa: input.data_vencimento_multa ?? null,
    p_vigencia_inicio:       input.vigencia_inicio ?? null,
    p_duracao_meses:         input.duracao_meses ?? null,
    p_observacoes:           input.observacoes ?? null,
  });
  fail(r.error);
  return r.data as string;
}

export async function registerMultaPayment(input: {
  sanction_id: string;
  data_pagamento: string;
  observacoes?: string;
}): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('register_multa_payment', {
    p_sanction_id:    input.sanction_id,
    p_data_pagamento: input.data_pagamento,
    p_observacoes:    input.observacoes ?? null,
  });
  fail(r.error);
}

export async function suspendSanction(id: string, motivacao: string): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('suspend_sanction', { p_id: id, p_motivacao: motivacao });
  fail(r.error);
}

export async function reactivateSanction(id: string, motivacao: string): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('reactivate_sanction', { p_id: id, p_motivacao: motivacao });
  fail(r.error);
}

export async function revokeSanction(id: string, motivacao: string): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('revoke_sanction', { p_id: id, p_motivacao: motivacao });
  fail(r.error);
}

export async function markSanctionFulfilled(id: string): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('mark_sanction_fulfilled', { p_id: id });
  fail(r.error);
}

// Labels/tones
export const SANCTION_TIPO_LABELS: Record<SanctionTipo, string> = {
  advertencia:  'Advertência',
  multa:        'Multa',
  impedimento:  'Impedimento de licitar/contratar',
  inidoneidade: 'Declaração de inidoneidade',
};

export function sanctionTipoTone(t: SanctionTipo): 'slate' | 'yellow' | 'red' {
  if (t === 'advertencia')  return 'slate';
  if (t === 'multa')        return 'yellow';
  if (t === 'impedimento')  return 'red';
  if (t === 'inidoneidade') return 'red';
  return 'slate';
}

export const SANCTION_STATUS_LABELS: Record<SanctionStatus, string> = {
  ativa:     'Ativa',
  cumprida:  'Cumprida',
  suspensa:  'Suspensa',
  revogada:  'Revogada',
};

export function sanctionStatusTone(s: SanctionStatus): 'slate' | 'blue' | 'green' | 'yellow' | 'red' {
  if (s === 'ativa')    return 'red';
  if (s === 'cumprida') return 'green';
  if (s === 'suspensa') return 'yellow';
  if (s === 'revogada') return 'slate';
  return 'slate';
}

export const SANCTION_EVENT_TIPO_LABELS: Record<SanctionEventTipo, string> = {
  aplicacao:        'Aplicação',
  pagamento_multa:  'Pagamento de multa',
  suspensao:        'Suspensão',
  reativacao:       'Reativação',
  revogacao:        'Revogação',
  cumprimento:      'Cumprimento',
};

/** Caps legais por tipo */
export const SANCTION_MAX_MESES: Record<SanctionTipo, number | null> = {
  advertencia:  null,
  multa:        null,
  impedimento:  36,
  inidoneidade: 72,
};

/** Indica se o tipo exige PAR procedente */
export function sanctionRequiresPar(t: SanctionTipo): boolean {
  return t === 'impedimento' || t === 'inidoneidade';
}

// =============================================================================
// V39 — Timeline cronológica unificada (consome 9 institutos Lei 14.133)
// =============================================================================

export type TimelineEventKind =
  | 'additive' | 'unforeseen' | 'measurement'
  | 'reajuste' | 'repactuacao' | 'reequilibrio'
  | 'receipt' | 'guarantee' | 'par' | 'sanction';

export type TimelineSeverity = 'info' | 'warning' | 'danger' | 'success' | 'neutral';

export interface TimelineEvent {
  event_kind: TimelineEventKind;
  event_subtype: string;
  event_date: string;          // ISO date YYYY-MM-DD
  event_at: string;            // ISO timestamp
  title: string;
  subtitle: string | null;
  severity: TimelineSeverity;
  valor: number | null;
  ref_id: string;
  ref_link: string;            // ex: '/aditivos'
  actor_name: string | null;
}

export interface TimelineSummary {
  total: number;
  first_at: string | null;
  last_at: string | null;
  by_kind: Partial<Record<TimelineEventKind, number>>;
}

export interface TimelineFilters {
  kinds?: TimelineEventKind[];
  from?: string;
  to?: string;
  severity?: TimelineSeverity[];
  limit?: number;
}

// V51: Timeline mocks — combina eventos das 4 resources Lei 14.133 + aditivo de c1.
// Cada evento é uma derivação dos mocks específicos (Sanctions/PARs/Receipts/Guarantees)
// já criados no V51, mais o aditivo histórico de c1.
const MOCK_CONTRACT_TITLES_V51: Record<string, { numero: number; titulo: string }> = {
  c1: { numero:  42, titulo: 'Construção de Hospital Regional' },
  c2: { numero: 107, titulo: 'Reforma escolas — Niterói' },
  c3: { numero: 211, titulo: 'Reforma escola CIEP — Rio de Janeiro' },
  c4: { numero: 298, titulo: 'UPA Petrópolis — fase 2' },
  c5: { numero: 334, titulo: 'Praça Nova Iguaçu' },
};

const MOCK_CONTRACT_TIMELINE: Record<string, TimelineEvent[]> = {
  c1: [{
    event_kind: 'additive', event_subtype: 'aprovado',
    event_date: '2025-08-10', event_at: '2025-08-10T16:00:00Z',
    title: 'Aditivo 01/2025 aprovado · +R$ 450.000,00',
    subtitle: 'Acréscimo · 45 dias adicionais',
    severity: 'info', valor: 450_000,
    ref_id: 'a1', ref_link: '/aditivos/a1',
    actor_name: 'Eduardo Vargas',
  }],
  c2: [
    { event_kind: 'sanction', event_subtype: 'impedimento_aplicado',
      event_date: '2025-11-14', event_at: '2025-11-14T10:00:00Z',
      title: 'Impedimento aplicado · 6 meses',
      subtitle: 'Fraude documental · vigência até 14/05/2026',
      severity: 'danger', valor: null,
      ref_id: 'sanc-c2-2', ref_link: '/sancoes/sanc-c2-2',
      actor_name: 'Mariana Costa' },
    { event_kind: 'sanction', event_subtype: 'multa_aplicada',
      event_date: '2025-11-12', event_at: '2025-11-12T14:20:00Z',
      title: 'Multa aplicada · R$ 245.000,00',
      subtitle: 'Atraso na execução · vencimento 12/12/2025',
      severity: 'danger', valor: 245_000,
      ref_id: 'sanc-c2-1', ref_link: '/sancoes/sanc-c2-1',
      actor_name: 'Mariana Costa' },
    { event_kind: 'par', event_subtype: 'instaurado',
      event_date: '2025-11-08', event_at: '2025-11-08T11:30:00Z',
      title: 'PAR-2025/003 instaurado',
      subtitle: 'Atraso reiterado · em defesa até 20/11/2025',
      severity: 'warning', valor: null,
      ref_id: 'par-c2-1', ref_link: '/processos-administrativos/par-c2-1',
      actor_name: 'Ricardo Mendes' },
  ],
  c3: [{
    event_kind: 'receipt', event_subtype: 'vicio_registrado',
    event_date: '2025-11-02', event_at: '2025-11-02T09:00:00Z',
    title: 'Vício registrado · concreto fora de fck',
    subtitle: 'Severidade alta · em saneamento até 02/12/2025',
    severity: 'danger', valor: null,
    ref_id: 'vic-c3-1', ref_link: '/recebimentos/rec-c3-1',
    actor_name: 'Patrícia Lopes',
  }, {
    event_kind: 'receipt', event_subtype: 'provisorio_emitido',
    event_date: '2025-10-25', event_at: '2025-10-25T10:00:00Z',
    title: 'Recebimento provisório #1 emitido',
    subtitle: 'Limite p/ definitivo: 23/01/2026 · garantia 60 meses',
    severity: 'info', valor: null,
    ref_id: 'rec-c3-1', ref_link: '/recebimentos/rec-c3-1',
    actor_name: 'Patrícia Lopes',
  }],
  c4: [{
    event_kind: 'guarantee', event_subtype: 'registro',
    event_date: '2024-11-20', event_at: '2024-11-20T10:00:00Z',
    title: 'Garantia GA-00128 registrada · R$ 560.000,00',
    subtitle: 'Caução em dinheiro · vigência 1 ano',
    severity: 'info', valor: 560_000,
    ref_id: 'gar-c4-1', ref_link: '/garantias/gar-c4-1',
    actor_name: 'Eduardo Vargas',
  }],
  c5: [{
    event_kind: 'receipt', event_subtype: 'provisorio_emitido',
    event_date: '2025-08-15', event_at: '2025-08-15T14:00:00Z',
    title: 'Recebimento provisório #1 emitido',
    subtitle: 'Limite p/ definitivo: 90 dias (vencido)',
    severity: 'warning', valor: null,
    ref_id: 'rec-c5-1', ref_link: '/recebimentos/rec-c5-1',
    actor_name: 'Patrícia Lopes',
  }],
};

const MOCK_TENANT_TIMELINE_V51: TenantTimelineEvent[] = Object.entries(MOCK_CONTRACT_TIMELINE).flatMap(
  ([cid, events]) => events.map((e) => ({
    ...e,
    contract_id: cid,
    contract_numero: MOCK_CONTRACT_TITLES_V51[cid].numero,
    contract_titulo: MOCK_CONTRACT_TITLES_V51[cid].titulo,
  })),
).sort((a, b) => b.event_at.localeCompare(a.event_at));

function filterTimeline<T extends TimelineEvent>(
  events: T[], filters: { kinds?: TimelineEventKind[]; from?: string; to?: string;
                          severity?: TimelineSeverity[]; limit?: number },
): T[] {
  let out = events;
  if (filters.kinds && filters.kinds.length) {
    const set = new Set(filters.kinds);
    out = out.filter((e) => set.has(e.event_kind));
  }
  if (filters.severity && filters.severity.length) {
    const set = new Set(filters.severity);
    out = out.filter((e) => set.has(e.severity));
  }
  if (filters.from) out = out.filter((e) => e.event_date >= filters.from!);
  if (filters.to)   out = out.filter((e) => e.event_date <= filters.to!);
  if (filters.limit && filters.limit > 0) out = out.slice(0, filters.limit);
  return out;
}

export async function listContractTimeline(
  contract_id: string, filters: TimelineFilters = {},
): Promise<TimelineEvent[]> {
  if (SKIP_AUTH) {
    const events = MOCK_CONTRACT_TIMELINE[contract_id] || [];
    return filterTimeline(events, filters);
  }
  checkSupabase();
  const r = await supabase.rpc('list_contract_timeline', {
    p_contract_id: contract_id,
    p_kinds:       filters.kinds    && filters.kinds.length    ? filters.kinds    : null,
    p_from:        filters.from    ?? null,
    p_to:          filters.to      ?? null,
    p_severity:    filters.severity && filters.severity.length ? filters.severity : null,
    p_limit:       filters.limit   ?? 500,
  });
  fail(r.error);
  return (r.data || []) as TimelineEvent[];
}

export async function getContractTimelineSummary(contract_id: string): Promise<TimelineSummary> {
  if (SKIP_AUTH) {
    const events = MOCK_CONTRACT_TIMELINE[contract_id] || [];
    if (!events.length) return { total: 0, first_at: null, last_at: null, by_kind: {} };
    const sorted = [...events].sort((a, b) => a.event_at.localeCompare(b.event_at));
    const by_kind: Partial<Record<TimelineEventKind, number>> = {};
    for (const e of events) by_kind[e.event_kind] = (by_kind[e.event_kind] || 0) + 1;
    return {
      total: events.length,
      first_at: sorted[0].event_at,
      last_at:  sorted[sorted.length - 1].event_at,
      by_kind,
    };
  }
  checkSupabase();
  const r = await supabase.rpc('get_contract_timeline_summary', { p_contract_id: contract_id });
  fail(r.error);
  return r.data as TimelineSummary;
}

// Labels e configuração visual
export const TIMELINE_KIND_LABELS: Record<TimelineEventKind, string> = {
  additive:     'Aditivo',
  unforeseen:   'Item não previsto',
  measurement:  'Medição',
  reajuste:     'Reajuste',
  repactuacao:  'Repactuação',
  reequilibrio: 'Reequilíbrio',
  receipt:      'Recebimento',
  guarantee:    'Garantia',
  par:          'PAR',
  sanction:     'Sanção',
};

export const TIMELINE_KIND_ORDER: TimelineEventKind[] = [
  'additive', 'unforeseen', 'measurement',
  'reajuste', 'repactuacao', 'reequilibrio',
  'receipt', 'guarantee', 'par', 'sanction',
];

export function timelineSeverityTone(s: TimelineSeverity): 'slate' | 'blue' | 'yellow' | 'red' | 'green' {
  if (s === 'info')    return 'blue';
  if (s === 'warning') return 'yellow';
  if (s === 'danger')  return 'red';
  if (s === 'success') return 'green';
  return 'slate';
}

// =============================================================================
// V41 — Dashboard agregado por contrato (consome 9 institutos + timeline V39)
// =============================================================================

export interface DashboardAlert {
  severity: 'info' | 'warning' | 'danger';
  title: string;
  body: string;
  link: string;        // sub-path relativo, ex: '/garantias'
  count: number;
}

export interface DashboardKpisFinancial {
  valor_inicial: number;
  valor_total_atual: number;
  valor_aditado: number;
  valor_garantia_disponivel: number;
  valor_garantia_executado: number;
}

export interface DashboardKpisPending {
  vicios_abertos: number;
  pars_em_curso: number;
  multas_pendentes: number;
  recebimentos_pendentes: number;
  reequilibrios_pendentes: number;
}

export interface DashboardKpisRecent {
  events_30d: number;
  last_event_at: string | null;
}

export interface DashboardNextDate {
  kind: 'guarantee' | 'receipt_limit' | 'vicio' | 'par_defesa'
      | 'sanction_vigencia' | 'sanction_multa';
  due_date: string;
  days_until: number;
  label: string;
  link: string;
  ref_id: string;
}

export interface DashboardAxisAditivo {
  total: number;
  aprovados: number;
  em_aprovacao: number;
  valor_liquido_total: number;
}
export interface DashboardAxisReajuste {
  rules_active: number;
  events_total: number;
  last_event_at: string | null;
  delta_total: number;
}
export interface DashboardAxisRepactuacao {
  events_total: number;
  last_event_at: string | null;
  delta_total: number;
}
export interface DashboardAxisReequilibrio {
  total: number;
  open: number;
  aplicado: number;
  valor_aprovado_total: number;
}
export interface DashboardAxisRecebimento {
  provisorios_emitidos: number;
  definitivos_emitidos: number;
  vicios_abertos: number;
  pendentes_total: number;
}
export interface DashboardAxisGarantia {
  total: number;
  ativas: number;
  valor_disponivel: number;
  valor_executado: number;
}
export interface DashboardAxisPar {
  total: number;
  em_andamento: number;
  procedentes: number;
  prazo_estourado: number;
}
export interface DashboardAxisSancao {
  total: number;
  ativas: number;
  multa_pendente: number;
  impedimento_inidoneidade_ativos: number;
}

export interface DashboardRecentEvent {
  event_kind: TimelineEventKind;
  event_subtype: string;
  event_date: string;
  event_at: string;
  title: string;
  subtitle: string | null;
  severity: TimelineSeverity;
  valor: number | null;
  ref_link: string;
  actor_name: string | null;
}

export interface ContractDashboard {
  contract: {
    id: string;
    numero: number;
    titulo: string;
    status: string;
    valor_inicial: number;
    valor_total_atual: number;
    valor_aditado: number;
    data_assinatura: string | null;
    data_inicio: string | null;
  };
  alerts: DashboardAlert[];
  kpis: {
    financial: DashboardKpisFinancial;
    pending:   DashboardKpisPending;
    recent:    DashboardKpisRecent;
  };
  per_axis: {
    aditivo:      DashboardAxisAditivo;
    reajuste:     DashboardAxisReajuste;
    repactuacao:  DashboardAxisRepactuacao;
    reequilibrio: DashboardAxisReequilibrio;
    recebimento:  DashboardAxisRecebimento;
    garantia:     DashboardAxisGarantia;
    par:          DashboardAxisPar;
    sancao:       DashboardAxisSancao;
  };
  next_dates:    DashboardNextDate[];
  recent_events: DashboardRecentEvent[];
}

export async function getContractDashboard(contract_id: string): Promise<ContractDashboard> {
  if (SKIP_AUTH) {
    return {
      contract: { id: contract_id, numero: 0, titulo: '', status: '', valor_inicial: 0, valor_total_atual: 0, valor_aditado: 0, data_assinatura: null, data_inicio: null },
      alerts: [], kpis: {
        financial: { valor_inicial: 0, valor_total_atual: 0, valor_aditado: 0, valor_garantia_disponivel: 0, valor_garantia_executado: 0 },
        pending:   { vicios_abertos: 0, pars_em_curso: 0, multas_pendentes: 0, recebimentos_pendentes: 0, reequilibrios_pendentes: 0 },
        recent:    { events_30d: 0, last_event_at: null },
      },
      per_axis: {
        aditivo:      { total: 0, aprovados: 0, em_aprovacao: 0, valor_liquido_total: 0 },
        reajuste:     { rules_active: 0, events_total: 0, last_event_at: null, delta_total: 0 },
        repactuacao:  { events_total: 0, last_event_at: null, delta_total: 0 },
        reequilibrio: { total: 0, open: 0, aplicado: 0, valor_aprovado_total: 0 },
        recebimento:  { provisorios_emitidos: 0, definitivos_emitidos: 0, vicios_abertos: 0, pendentes_total: 0 },
        garantia:     { total: 0, ativas: 0, valor_disponivel: 0, valor_executado: 0 },
        par:          { total: 0, em_andamento: 0, procedentes: 0, prazo_estourado: 0 },
        sancao:       { total: 0, ativas: 0, multa_pendente: 0, impedimento_inidoneidade_ativos: 0 },
      },
      next_dates: [],
      recent_events: [],
    };
  }
  checkSupabase();
  const r = await supabase.rpc('get_contract_dashboard', { p_contract_id: contract_id });
  fail(r.error);
  return r.data as ContractDashboard;
}

// Helpers
export const DASHBOARD_NEXT_DATE_KIND_LABELS: Record<DashboardNextDate['kind'], string> = {
  guarantee:         'Garantia',
  receipt_limit:     'Limite definitivo',
  vicio:             'Saneamento de vício',
  par_defesa:        'Prazo de defesa (PAR)',
  sanction_vigencia: 'Fim de vigência (sanção)',
  sanction_multa:    'Vencimento de multa',
};

export function dashboardDueTone(days_until: number): 'red' | 'yellow' | 'slate' | 'blue' {
  if (days_until < 0)       return 'red';
  if (days_until <= 7)      return 'red';
  if (days_until <= 30)     return 'yellow';
  if (days_until <= 60)     return 'blue';
  return 'slate';
}

// =============================================================================
// V42 — Timeline global do tenant (consome v_contract_timeline V39 cross-contract)
// =============================================================================

export interface TenantTimelineEvent extends TimelineEvent {
  contract_id: string;
  contract_numero: number;
  contract_titulo: string;
}

export interface TenantTimelineSummary {
  total: number;
  events_30d: number;
  events_7d: number;
  last_event_at: string | null;
  contracts_active: number;
  contracts_total: number;
  by_kind: Partial<Record<TimelineEventKind, number>>;
  by_severity: Partial<Record<TimelineSeverity, number>>;
}

export interface TenantTimelineContract {
  contract_id: string;
  contract_numero: number;
  contract_titulo: string;
  event_count: number;
  last_event_at: string | null;
}

export interface TenantTimelineFilters {
  kinds?: TimelineEventKind[];
  contract_ids?: string[];
  from?: string;
  to?: string;
  severity?: TimelineSeverity[];
  limit?: number;
  before?: string;   // cursor (ISO timestamp)
}

export async function listTenantTimeline(filters: TenantTimelineFilters = {}): Promise<TenantTimelineEvent[]> {
  if (SKIP_AUTH) {
    let events = MOCK_TENANT_TIMELINE_V51;
    if (filters.contract_ids && filters.contract_ids.length) {
      const set = new Set(filters.contract_ids);
      events = events.filter((e) => set.has(e.contract_id));
    }
    if (filters.before) {
      events = events.filter((e) => e.event_at < filters.before!);
    }
    return filterTimeline(events, filters);
  }
  checkSupabase();
  const r = await supabase.rpc('list_tenant_timeline', {
    p_kinds:        filters.kinds        && filters.kinds.length        ? filters.kinds        : null,
    p_contract_ids: filters.contract_ids && filters.contract_ids.length ? filters.contract_ids : null,
    p_from:         filters.from     ?? null,
    p_to:           filters.to       ?? null,
    p_severity:     filters.severity     && filters.severity.length     ? filters.severity     : null,
    p_limit:        filters.limit    ?? 200,
    p_before:       filters.before   ?? null,
  });
  fail(r.error);
  return (r.data || []) as TenantTimelineEvent[];
}

export async function getTenantTimelineSummary(): Promise<TenantTimelineSummary> {
  if (SKIP_AUTH) {
    const events = MOCK_TENANT_TIMELINE_V51;
    const by_kind: Partial<Record<TimelineEventKind, number>> = {};
    const by_severity: Partial<Record<TimelineSeverity, number>> = {};
    for (const e of events) {
      by_kind[e.event_kind] = (by_kind[e.event_kind] || 0) + 1;
      by_severity[e.severity] = (by_severity[e.severity] || 0) + 1;
    }
    // events_30d / events_7d aproximação simbólica usando 2025-11-14 como hoje
    return {
      total: events.length,
      events_30d: 7, events_7d: 4,
      last_event_at: events.length ? events[0].event_at : null,
      contracts_active: 7, contracts_total: 9,
      by_kind, by_severity,
    };
  }
  checkSupabase();
  const r = await supabase.rpc('get_tenant_timeline_summary');
  fail(r.error);
  return r.data as TenantTimelineSummary;
}

export async function getTenantTimelineContracts(limit = 50): Promise<TenantTimelineContract[]> {
  if (SKIP_AUTH) {
    return Object.entries(MOCK_CONTRACT_TIMELINE).map(([cid, events]) => ({
      contract_id: cid,
      contract_numero: MOCK_CONTRACT_TITLES_V51[cid].numero,
      contract_titulo: MOCK_CONTRACT_TITLES_V51[cid].titulo,
      event_count: events.length,
      last_event_at: events.length
        ? [...events].sort((a, b) => b.event_at.localeCompare(a.event_at))[0].event_at
        : null,
    })).slice(0, limit);
  }
  checkSupabase();
  const r = await supabase.rpc('get_tenant_timeline_contracts', { p_limit: limit });
  fail(r.error);
  return (r.data || []) as TenantTimelineContract[];
}

// =============================================================================
// V43 — Portfolio estendido com KPIs Lei 14.133 (V35-V38)
// =============================================================================

export interface PortfolioLei14133Base {
  vicios_abertos: number;
  pars_em_curso: number;
  garantias_vencendo_30d: number;
  multas_pendentes_count: number;
  multas_pendentes_valor: number;
  sancoes_graves_ativas: number;
  contratos_criticos: number;
}

export interface PortfolioByProgramLei14133 extends PortfolioLei14133Base {
  program_id: string | null;
  contratos_count: number;
}

export interface PortfolioByOrgaoLei14133 extends PortfolioLei14133Base {
  orgao: string;
  contratos_count: number;
}

export interface PortfolioByMunicipioLei14133 extends PortfolioLei14133Base {
  uf: string;
  municipio: string;
  contratos_count: number;
}

export interface TenantLei14133Kpis extends PortfolioLei14133Base {
  contratos_total: number;
}

// =============================================================================
// V50: Mocks Lei 14.133 portfolio (Completar Carteira V12)
// =============================================================================
// Narrativa coerente com MOCK_PENDENCIAS V49 (9 entradas, 5 contratos):
//   c2 CT-2024/0107 SEEDUC/RJ Niterói: PAR + multa R$245k + grave (impedimento)
//   c3 CT-2024/0211 SES/RJ  Rio:        vício aberto
//   c4 CT-2024/0298 SES/RJ  Petrópolis: garantia vencendo em 6 dias
//   c1, c5: sem KPI Lei 14.133 ativo (c5 só tem recebimento atrasado)
// Totais: 1 vício + 1 PAR + 1 garantia + 1 multa(R$245k) + 1 grave = 5 KPIs · 3 críticos
// Distribuição por dimensão preserva soma dos contratos_count (9 / 9 / 9).
// =============================================================================

const MOCK_PORTFOLIO_PROGRAM_LEI14133: PortfolioByProgramLei14133[] = [
  // pg-1 SAU-2024 (SES/RJ): c1 hospital + c3 vicio + c4 garantia = 3 contratos, 2 críticos
  { program_id: 'pg-1', contratos_count: 3,
    vicios_abertos: 1, pars_em_curso: 0, garantias_vencendo_30d: 1,
    multas_pendentes_count: 0, multas_pendentes_valor: 0, sancoes_graves_ativas: 0,
    contratos_criticos: 2 },
  // pg-2 EDU-2024 (SEEDUC/RJ): c2 escola com 3 issues + 4 outros = 5 contratos, 1 crítico
  { program_id: 'pg-2', contratos_count: 5,
    vicios_abertos: 0, pars_em_curso: 1, garantias_vencendo_30d: 0,
    multas_pendentes_count: 1, multas_pendentes_valor: 245_000, sancoes_graves_ativas: 1,
    contratos_criticos: 1 },
  // Sem programa: c5 sem issue Lei 14.133
  { program_id: null, contratos_count: 1,
    vicios_abertos: 0, pars_em_curso: 0, garantias_vencendo_30d: 0,
    multas_pendentes_count: 0, multas_pendentes_valor: 0, sancoes_graves_ativas: 0,
    contratos_criticos: 0 },
];

const MOCK_PORTFOLIO_ORGAO_LEI14133: PortfolioByOrgaoLei14133[] = [
  { orgao: 'SES/RJ', contratos_count: 3,
    vicios_abertos: 1, pars_em_curso: 0, garantias_vencendo_30d: 1,
    multas_pendentes_count: 0, multas_pendentes_valor: 0, sancoes_graves_ativas: 0,
    contratos_criticos: 2 },
  { orgao: 'SEEDUC/RJ', contratos_count: 5,
    vicios_abertos: 0, pars_em_curso: 1, garantias_vencendo_30d: 0,
    multas_pendentes_count: 1, multas_pendentes_valor: 245_000, sancoes_graves_ativas: 1,
    contratos_criticos: 1 },
  { orgao: 'Prefeitura', contratos_count: 1,
    vicios_abertos: 0, pars_em_curso: 0, garantias_vencendo_30d: 0,
    multas_pendentes_count: 0, multas_pendentes_valor: 0, sancoes_graves_ativas: 0,
    contratos_criticos: 0 },
];

const MOCK_PORTFOLIO_MUNICIPIO_LEI14133: PortfolioByMunicipioLei14133[] = [
  // Rio de Janeiro (4 contratos): c1 hospital + c3 vicio + 2 escolas = 1 crítico
  { uf: 'RJ', municipio: 'Rio de Janeiro', contratos_count: 4,
    vicios_abertos: 1, pars_em_curso: 0, garantias_vencendo_30d: 0,
    multas_pendentes_count: 0, multas_pendentes_valor: 0, sancoes_graves_ativas: 0,
    contratos_criticos: 1 },
  // Niterói (2 contratos): c2 escola com 3 issues + 1 outro = 1 crítico
  { uf: 'RJ', municipio: 'Niterói', contratos_count: 2,
    vicios_abertos: 0, pars_em_curso: 1, garantias_vencendo_30d: 0,
    multas_pendentes_count: 1, multas_pendentes_valor: 245_000, sancoes_graves_ativas: 1,
    contratos_criticos: 1 },
  // Petrópolis (2 contratos): c4 garantia + 1 outro = 1 crítico
  { uf: 'RJ', municipio: 'Petrópolis', contratos_count: 2,
    vicios_abertos: 0, pars_em_curso: 0, garantias_vencendo_30d: 1,
    multas_pendentes_count: 0, multas_pendentes_valor: 0, sancoes_graves_ativas: 0,
    contratos_criticos: 1 },
  // Nova Iguaçu (1 contrato): c5 sem Lei 14.133
  { uf: 'RJ', municipio: 'Nova Iguaçu', contratos_count: 1,
    vicios_abertos: 0, pars_em_curso: 0, garantias_vencendo_30d: 0,
    multas_pendentes_count: 0, multas_pendentes_valor: 0, sancoes_graves_ativas: 0,
    contratos_criticos: 0 },
];

const MOCK_TENANT_LEI14133_KPIS: TenantLei14133Kpis = {
  vicios_abertos: 1, pars_em_curso: 1, garantias_vencendo_30d: 1,
  multas_pendentes_count: 1, multas_pendentes_valor: 245_000,
  sancoes_graves_ativas: 1, contratos_criticos: 3, contratos_total: 9,
};

export async function getPortfolioByProgramLei14133(): Promise<PortfolioByProgramLei14133[]> {
  if (SKIP_AUTH) return MOCK_PORTFOLIO_PROGRAM_LEI14133;
  checkSupabase();
  const r = await supabase.from('v_portfolio_by_program_lei14133').select('*');
  fail(r.error);
  return (r.data || []) as PortfolioByProgramLei14133[];
}

export async function getPortfolioByOrgaoLei14133(): Promise<PortfolioByOrgaoLei14133[]> {
  if (SKIP_AUTH) return MOCK_PORTFOLIO_ORGAO_LEI14133;
  checkSupabase();
  const r = await supabase.from('v_portfolio_by_orgao_lei14133').select('*');
  fail(r.error);
  return (r.data || []) as PortfolioByOrgaoLei14133[];
}

export async function getPortfolioByMunicipioLei14133(): Promise<PortfolioByMunicipioLei14133[]> {
  if (SKIP_AUTH) return MOCK_PORTFOLIO_MUNICIPIO_LEI14133;
  checkSupabase();
  const r = await supabase.from('v_portfolio_by_municipio_lei14133').select('*');
  fail(r.error);
  return (r.data || []) as PortfolioByMunicipioLei14133[];
}

export async function getTenantLei14133Kpis(): Promise<TenantLei14133Kpis> {
  if (SKIP_AUTH) return MOCK_TENANT_LEI14133_KPIS;
  checkSupabase();
  const r = await supabase.rpc('get_tenant_lei14133_kpis');
  fail(r.error);
  return r.data as TenantLei14133Kpis;
}

// =============================================================================
// V43 — Dashboard global do tenant (agregação cross-contract dos 9 institutos)
// =============================================================================

export interface TenantDashboardTotals {
  contracts_total: number;
  contracts_ativos: number;
  valor_inicial_total: number;
  valor_atual_total: number;
  valor_aditado_total: number;
}

export interface TenantDashboardAlertContract {
  id: string;
  numero: number;
  titulo: string;
}

export interface TenantDashboardAlerts {
  vicios_graves:             { count: number; contracts: TenantDashboardAlertContract[] };
  garantias_7d:              { count: number; contracts: TenantDashboardAlertContract[] };
  par_procedente_sem_sancao: { count: number; contracts: TenantDashboardAlertContract[] };
  par_prazo_defesa_vencido:  { count: number; contracts: TenantDashboardAlertContract[] };
  multas_grandes_pendentes:  { count: number; total_valor: number };
}

export interface TenantDashboardAxisAditivo {
  total: number; aprovados: number; em_aprovacao: number; valor_liquido_total: number;
}
export interface TenantDashboardAxisReajuste {
  rules_active: number; events_total: number; delta_total: number;
}
export interface TenantDashboardAxisRepactuacao {
  events_total: number; delta_total: number;
}
export interface TenantDashboardAxisReequilibrio {
  total: number; open: number; aplicado: number; valor_aprovado_total: number;
}
export interface TenantDashboardAxisRecebimento {
  provisorios_emitidos: number; definitivos_emitidos: number; vicios_abertos: number;
}
export interface TenantDashboardAxisGarantia {
  total: number; ativas: number; valor_disponivel: number; valor_executado: number;
}
export interface TenantDashboardAxisPar {
  total: number; em_andamento: number; procedentes: number; prazo_estourado: number;
}
export interface TenantDashboardAxisSancao {
  total: number; ativas: number; multa_pendente: number; impedimento_inidoneidade_ativos: number;
}

export interface TenantDashboardTopCritical {
  id: string;
  numero: number;
  titulo: string;
  status: string;
  valor_total_atual: number;
  score: number;
}

export interface TenantDashboardNextDate {
  kind: 'guarantee' | 'receipt_limit' | 'par_defesa' | 'sanction_vigencia';
  due_date: string;
  days_until: number;
  label: string;
  link: string;
  contract_id: string;
  contract_numero: number;
  contract_titulo: string;
}

export interface TenantDashboardRecentEvent {
  event_kind: TimelineEventKind;
  event_subtype: string;
  event_date: string;
  event_at: string;
  title: string;
  subtitle: string | null;
  severity: TimelineSeverity;
  valor: number | null;
  ref_link: string;
  actor_name: string | null;
  contract_id: string;
  contract_numero: number;
  contract_titulo: string;
}

export interface TenantDashboard {
  totals: TenantDashboardTotals;
  alerts: TenantDashboardAlerts;
  per_axis: {
    aditivo:      TenantDashboardAxisAditivo;
    reajuste:     TenantDashboardAxisReajuste;
    repactuacao:  TenantDashboardAxisRepactuacao;
    reequilibrio: TenantDashboardAxisReequilibrio;
    recebimento:  TenantDashboardAxisRecebimento;
    garantia:     TenantDashboardAxisGarantia;
    par:          TenantDashboardAxisPar;
    sancao:       TenantDashboardAxisSancao;
  };
  top_critical_contracts: TenantDashboardTopCritical[];
  next_dates:             TenantDashboardNextDate[];
  recent_events:          TenantDashboardRecentEvent[];
  recent_activity:        { events_30d: number; events_7d: number };
}

// V50: Mock realista alinhado a MOCK_PENDENCIAS V49 + Lei 14.133 portfolio mocks.
// Critical contracts: c2 #107 (PAR+multa+grave), c3 #211 (vício), c4 #298 (garantia ≤7d).
const MOCK_TENANT_DASHBOARD: TenantDashboard = {
  totals: {
    contracts_total: 9, contracts_ativos: 7,
    valor_inicial_total: 65_500_000,
    valor_atual_total:   67_140_000,   // +1.64M em aditivos
    valor_aditado_total:  1_640_000,
  },
  alerts: {
    vicios_graves: { count: 1, contracts: [
      { id: 'c3', numero: 211, titulo: 'Reforma escola CIEP — Rio de Janeiro' },
    ]},
    garantias_7d: { count: 1, contracts: [
      { id: 'c4', numero: 298, titulo: 'UPA Petrópolis — fase 2' },
    ]},
    par_procedente_sem_sancao: { count: 0, contracts: [] },
    par_prazo_defesa_vencido:  { count: 0, contracts: [] },
    multas_grandes_pendentes:  { count: 1, total_valor: 245_000 },
  },
  per_axis: {
    aditivo:      { total: 3, aprovados: 2, em_aprovacao: 1, valor_liquido_total: 1_640_000 },
    reajuste:     { rules_active: 4, events_total: 6, delta_total: 420_000 },
    repactuacao:  { events_total: 1, delta_total: 180_000 },
    reequilibrio: { total: 2, open: 1, aplicado: 1, valor_aprovado_total: 95_000 },
    recebimento:  { provisorios_emitidos: 5, definitivos_emitidos: 3, vicios_abertos: 1 },
    garantia:     { total: 9, ativas: 7, valor_disponivel: 3_275_000, valor_executado: 0 },
    par:          { total: 4, em_andamento: 1, procedentes: 1, prazo_estourado: 0 },
    sancao:       { total: 3, ativas: 2, multa_pendente: 1, impedimento_inidoneidade_ativos: 1 },
  },
  top_critical_contracts: [
    { id: 'c2', numero: 107, titulo: 'Reforma escolas — Niterói',
      status: 'em_execucao', valor_total_atual: 14_300_000, score: 87 },
    { id: 'c3', numero: 211, titulo: 'Reforma escola CIEP — Rio de Janeiro',
      status: 'em_execucao', valor_total_atual:  4_200_000, score: 72 },
    { id: 'c4', numero: 298, titulo: 'UPA Petrópolis — fase 2',
      status: 'em_execucao', valor_total_atual: 11_200_000, score: 65 },
  ],
  next_dates: [
    { kind: 'guarantee', due_date: '2025-11-20', days_until: 6,
      label: 'Garantia GA-00128 (caução) vence',
      link: '/contratos/c4/garantias', contract_id: 'c4', contract_numero: 298,
      contract_titulo: 'UPA Petrópolis — fase 2' },
    { kind: 'par_defesa', due_date: '2025-11-20', days_until: 6,
      label: 'PAR-2025/003 — limite de defesa',
      link: '/contratos/c2/processos-administrativos', contract_id: 'c2', contract_numero: 107,
      contract_titulo: 'Reforma escolas — Niterói' },
    { kind: 'receipt_limit', due_date: '2025-11-13', days_until: -1,
      label: 'Recebimento definitivo vencido (+90d)',
      link: '/contratos/c5/recebimentos', contract_id: 'c5', contract_numero: 334,
      contract_titulo: 'Praça Nova Iguaçu' },
    { kind: 'sanction_vigencia', due_date: '2026-05-14', days_until: 180,
      label: 'Impedimento — fim de vigência',
      link: '/contratos/c2/sancoes', contract_id: 'c2', contract_numero: 107,
      contract_titulo: 'Reforma escolas — Niterói' },
  ],
  recent_events: [
    { event_kind: 'sanction', event_subtype: 'multa_aplicada',
      event_date: '2025-11-12', event_at: '2025-11-12T14:20:00Z',
      title: 'Multa aplicada · R$ 245.000,00', subtitle: 'Atraso na execução · Niterói',
      severity: 'danger', valor: 245_000, ref_link: '/contratos/c2/sancoes',
      actor_name: 'Eduardo Vargas', contract_id: 'c2', contract_numero: 107,
      contract_titulo: 'Reforma escolas — Niterói' },
    { event_kind: 'receipt', event_subtype: 'vicio_registrado',
      event_date: '2025-11-10', event_at: '2025-11-10T09:00:00Z',
      title: 'Vício registrado · concreto fora de fck',
      subtitle: 'Severidade alta · em saneamento',
      severity: 'danger', valor: null, ref_link: '/contratos/c3/recebimentos',
      actor_name: 'Patrícia Lopes', contract_id: 'c3', contract_numero: 211,
      contract_titulo: 'Reforma escola CIEP — Rio de Janeiro' },
    { event_kind: 'par', event_subtype: 'instaurado',
      event_date: '2025-11-08', event_at: '2025-11-08T11:30:00Z',
      title: 'PAR-2025/003 instaurado', subtitle: 'Atraso reiterado · em defesa',
      severity: 'warning', valor: null, ref_link: '/contratos/c2/processos-administrativos',
      actor_name: 'Ricardo Mendes', contract_id: 'c2', contract_numero: 107,
      contract_titulo: 'Reforma escolas — Niterói' },
    { event_kind: 'additive', event_subtype: 'aprovado',
      event_date: '2025-08-10', event_at: '2025-08-10T16:00:00Z',
      title: 'Aditivo 01/2025 aprovado · +R$ 450.000,00',
      subtitle: 'Acréscimo · 45 dias adicionais',
      severity: 'info', valor: 450_000, ref_link: '/contratos/c1/aditivos',
      actor_name: 'Eduardo Vargas', contract_id: 'c1', contract_numero: 42,
      contract_titulo: 'Construção de Hospital Regional' },
  ],
  recent_activity: { events_30d: 14, events_7d: 5 },
};

export async function getTenantDashboard(): Promise<TenantDashboard> {
  if (SKIP_AUTH) return MOCK_TENANT_DASHBOARD;
  checkSupabase();
  const r = await supabase.rpc('get_tenant_dashboard');
  fail(r.error);
  return r.data as TenantDashboard;
}

export const TENANT_DASHBOARD_ALERT_LABELS = {
  vicios_graves:              { title: 'Vícios graves em aberto',                 body: 'Vícios de severidade alta ou crítica em contratos da carteira', link: 'recebimentos' },
  garantias_7d:               { title: 'Garantias vencendo em até 7 dias',        body: 'Atue para estender ou substituir antes do vencimento',         link: 'garantias' },
  par_procedente_sem_sancao:  { title: 'PARs procedentes sem sanção aplicada',    body: 'PARs decididos como procedentes mas sem materialização',       link: 'processos-administrativos' },
  par_prazo_defesa_vencido:   { title: 'PARs com prazo de defesa vencido',        body: 'Registre defesa ou revelia para destravar instrução',          link: 'processos-administrativos' },
  multas_grandes_pendentes:   { title: 'Multas grandes pendentes',                body: 'Pagamento pendente de multas com valor expressivo (>R$ 100k)', link: 'sancoes' },
} as const;

export type TenantDashboardAlertKey = keyof typeof TENANT_DASHBOARD_ALERT_LABELS;

export function tenantDashboardAlertSeverity(key: TenantDashboardAlertKey): 'danger' | 'warning' {
  if (key === 'vicios_graves' || key === 'garantias_7d') return 'danger';
  return 'warning';
}

// =============================================================================
// V44 — Export de Timeline em PDF (EF export-contract-timeline-pdf)
// =============================================================================

export interface TimelinePdfExportResult {
  storage_path: string;
  hash_sha256: string;
  public_validation_code: string;
  validation_url: string;
  size_bytes: number;
  total_events: number;
}

export interface TimelinePdfExportFilters {
  kinds?: TimelineEventKind[];
  severity?: TimelineSeverity[];
  from?: string;
  to?: string;
}

/**
 * Gera PDF da Linha do Tempo de um contrato.
 *
 * O PDF é salvo no Storage `reports` bucket; retorna o storage_path.
 * Use {@link getTimelinePdfDownloadUrl} para obter a URL temporária assinada.
 */
export async function exportContractTimelinePdf(
  contract_id: string,
  filters: TimelinePdfExportFilters = {},
): Promise<TimelinePdfExportResult> {
  if (SKIP_AUTH) {
    return {
      storage_path: 'demo/path.pdf',
      hash_sha256: 'demo-hash',
      public_validation_code: 'DEMOCODE',
      validation_url: 'https://demo',
      size_bytes: 0,
      total_events: 0,
    };
  }
  checkSupabase();
  const { data, error } = await supabase.functions.invoke('export-contract-timeline-pdf', {
    body: { contract_id, filters },
  });
  fail(error);
  if (!data || (data as any).error) {
    throw new Error((data as any)?.error || 'Falha ao gerar PDF');
  }
  return data as TimelinePdfExportResult;
}

/**
 * Cria URL temporária assinada para download do PDF gerado.
 * Default: 5 minutos de validade.
 */
export async function getTimelinePdfDownloadUrl(
  storage_path: string,
  expires_in = 300,
): Promise<string> {
  if (SKIP_AUTH) return 'data:application/pdf;base64,';
  checkSupabase();
  const { data, error } = await supabase.storage
    .from('reports')
    .createSignedUrl(storage_path, expires_in, { download: true });
  fail(error);
  if (!data?.signedUrl) throw new Error('Falha ao gerar URL de download');
  return data.signedUrl;
}

// =============================================================================
// V45 — Cadastro de fornecedores sancionados (cross-contract)
// =============================================================================

export type SanctionedSupplierStatus = 'ativo' | 'historico';
export type SanctionedSupplierSeverity = 'critica' | 'alta' | 'media' | 'baixa' | 'nenhuma';

export interface SanctionedSupplierRow {
  cnpj: string;
  nome: string;
  organization_id: string;
  email: string | null;
  telefone: string | null;
  status_agregado: SanctionedSupplierStatus;
  severidade_atual: SanctionedSupplierSeverity;
  sancoes_total: number;
  sancoes_ativas: number;
  qt_advertencia: number;
  qt_multa: number;
  qt_impedimento: number;
  qt_inidoneidade: number;
  impedimento_ativo: number;
  inidoneidade_ativa: number;
  multa_pendente: number;
  primeira_sancao: string | null;
  ultima_sancao: string | null;
  vigencia_fim_ativa: string | null;
  dias_ate_vencimento: number | null;
  contratos_distintos: number;
}

export interface SanctionedSupplierSanction {
  id: string;
  numero: number;
  contract_id: string;
  contract_numero: number;
  contract_titulo: string;
  tipo: SanctionTipo;
  status: SanctionStatus;
  data_aplicacao: string;
  documento_aplicacao: string | null;
  fundamentacao: string;
  par_id: string | null;
  valor_multa: number | null;
  data_pagamento_multa: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  duracao_meses: number | null;
  dias_ate_vencimento: number | null;
}

export interface SanctionedSupplierContract {
  id: string;
  numero: number;
  titulo: string;
  status: string;
  valor_total_atual: number;
}

export interface SanctionedSupplierDetail {
  summary: SanctionedSupplierRow & { tenant_id: string };
  sanctions: SanctionedSupplierSanction[];
  contracts: SanctionedSupplierContract[];
}

export interface SanctionedSuppliersSummary {
  total: number;
  com_sancao_ativa: number;
  por_severidade: {
    critica: number;
    alta: number;
    media: number;
    baixa: number;
  };
  impedimentos_ativos: number;
  inidoneidades_ativas: number;
  multa_pendente_total: number;
}

export interface CnpjSanctionedCheck {
  cnpj: string;
  nome?: string;
  found: boolean;
  pode_contratar: boolean;
  severidade: SanctionedSupplierSeverity;
  status_agregado?: SanctionedSupplierStatus;
  sancoes_ativas?: number;
  impedimento_ativo?: number;
  inidoneidade_ativa?: number;
  vigencia_fim_ativa?: string | null;
  ultima_sancao?: string | null;
  motivo_bloqueio?: string | null;
}

export interface SanctionedSuppliersFilters {
  severidade?: SanctionedSupplierSeverity[];
  status?: SanctionedSupplierStatus[];
  q?: string;
  only_with_active?: boolean;
  limit?: number;
}

export async function listSanctionedSuppliers(
  filters: SanctionedSuppliersFilters = {},
): Promise<SanctionedSupplierRow[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('list_sanctioned_suppliers', {
    p_severidade:       filters.severidade && filters.severidade.length ? filters.severidade : null,
    p_status:           filters.status     && filters.status.length     ? filters.status     : null,
    p_q:                filters.q ?? null,
    p_only_with_active: filters.only_with_active ?? false,
    p_limit:            filters.limit ?? 200,
  });
  fail(r.error);
  return (r.data || []) as SanctionedSupplierRow[];
}

export async function getSanctionedSupplierDetail(cnpj: string): Promise<SanctionedSupplierDetail> {
  checkSupabase();
  const r = await supabase.rpc('get_sanctioned_supplier_detail', { p_cnpj: cnpj });
  fail(r.error);
  return r.data as SanctionedSupplierDetail;
}

export async function getSanctionedSuppliersSummary(): Promise<SanctionedSuppliersSummary> {
  if (SKIP_AUTH) {
    return {
      total: 0, com_sancao_ativa: 0,
      por_severidade: { critica: 0, alta: 0, media: 0, baixa: 0 },
      impedimentos_ativos: 0, inidoneidades_ativas: 0, multa_pendente_total: 0,
    };
  }
  checkSupabase();
  const r = await supabase.rpc('get_sanctioned_suppliers_summary');
  fail(r.error);
  return r.data as SanctionedSuppliersSummary;
}

export async function checkCnpjSanctioned(cnpj: string): Promise<CnpjSanctionedCheck> {
  if (SKIP_AUTH) {
    return { cnpj, found: false, pode_contratar: true, severidade: 'nenhuma' };
  }
  checkSupabase();
  const r = await supabase.rpc('check_cnpj_sanctioned', { p_cnpj: cnpj });
  fail(r.error);
  return r.data as CnpjSanctionedCheck;
}

// Labels e tones
export const SANCTIONED_SEVERITY_LABELS: Record<SanctionedSupplierSeverity, string> = {
  critica: 'Crítica',
  alta:    'Alta',
  media:   'Média',
  baixa:   'Baixa',
  nenhuma: 'Sem sanção ativa',
};

export function sanctionedSeverityTone(s: SanctionedSupplierSeverity): 'red' | 'yellow' | 'blue' | 'slate' {
  if (s === 'critica') return 'red';
  if (s === 'alta')    return 'red';
  if (s === 'media')   return 'yellow';
  if (s === 'baixa')   return 'blue';
  return 'slate';
}

export function fmtCnpj(cnpj: string): string {
  // CNPJ raw → 00.000.000/0000-00
  const d = (cnpj || '').replace(/\D/g, '');
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// =============================================================================
// V46 — API keys + REST público
// =============================================================================

export type ApiKeyStatus = 'ativa' | 'revogada' | 'expirada';

export const API_KEY_VALID_SCOPES = ['suppliers:check', 'suppliers:read'] as const;
export type ApiKeyScope = typeof API_KEY_VALID_SCOPES[number];

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  'suppliers:check': 'Verificar CNPJ — POST /suppliers/check',
  'suppliers:read':  'Listar fornecedores sancionados — GET /suppliers/sanctioned',
};

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: ApiKeyScope[];
  created_by: string | null;
  created_by_nome: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by_nome: string | null;
  status: ApiKeyStatus;
}

export interface ApiKeyCreated {
  id: string;
  name: string;
  key_prefix: string;
  scopes: ApiKeyScope[];
  expires_at: string | null;
  full_key: string;
  created_at: string;
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('list_api_keys');
  fail(r.error);
  return (r.data || []) as ApiKeyRow[];
}

export async function createApiKey(input: {
  name: string;
  scopes: ApiKeyScope[];
  expires_at?: string;
}): Promise<ApiKeyCreated> {
  checkSupabase();
  const r = await supabase.rpc('create_api_key', {
    p_name:       input.name,
    p_scopes:     input.scopes,
    p_expires_at: input.expires_at ?? null,
  });
  fail(r.error);
  return r.data as ApiKeyCreated;
}

export async function revokeApiKey(id: string): Promise<void> {
  checkSupabase();
  const r = await supabase.rpc('revoke_api_key', { p_id: id });
  fail(r.error);
}

export function apiKeyStatusTone(s: ApiKeyStatus): 'green' | 'slate' | 'yellow' {
  if (s === 'ativa')    return 'green';
  if (s === 'expirada') return 'yellow';
  return 'slate';
}

export const API_KEY_STATUS_LABELS: Record<ApiKeyStatus, string> = {
  ativa:    'Ativa',
  revogada: 'Revogada',
  expirada: 'Expirada',
};

// =============================================================================
// V47 — Email digest de alertas Lei 14.133
// =============================================================================

export type AlertDigestFrequency = 'daily' | 'weekly' | 'monthly';
export type AlertDigestSeverityThreshold = 'warning' | 'danger';

export const ALERT_DIGEST_FREQUENCY_LABELS: Record<AlertDigestFrequency, string> = {
  daily:   'Diário',
  weekly:  'Semanal',
  monthly: 'Mensal',
};

export const ALERT_DIGEST_THRESHOLD_LABELS: Record<AlertDigestSeverityThreshold, string> = {
  warning: 'Todos (warning + danger)',
  danger:  'Apenas críticos (danger)',
};

export interface AlertDigestSettings {
  id?: string;
  enabled: boolean;
  frequency: AlertDigestFrequency;
  severity_threshold: AlertDigestSeverityThreshold;
  last_sent_at: string | null;
  last_alert_count: number | null;
  configured: boolean;
  updated_at?: string;
}

export interface AlertDigestPreview {
  member_id: string;
  member_email: string;
  member_nome: string;
  tenant_id: string;
  tenant_name: string;
  alert_count: number;
  threshold: string;
  alerts: {
    vicios_graves: number;
    garantias_7d: number;
    par_procedente_sem_sancao: number;
    par_prazo_defesa_vencido: number;
    multas_grandes_pendentes: number;
    multas_total_valor: number;
  };
  top_critical: Array<{ id: string; numero: number; titulo: string; score: number }>;
  next_dates: Array<{ due_date: string; days_until: number; label: string; contract_id: string; link: string }>;
  generated_at: string;
}

export async function getAlertDigestSettings(): Promise<AlertDigestSettings> {
  if (SKIP_AUTH) {
    return { enabled: false, frequency: 'weekly', severity_threshold: 'warning',
             last_sent_at: null, last_alert_count: null, configured: false };
  }
  checkSupabase();
  const r = await supabase.rpc('get_alert_digest_settings');
  fail(r.error);
  return r.data as AlertDigestSettings;
}

export async function upsertAlertDigestSettings(input: {
  enabled: boolean;
  frequency: AlertDigestFrequency;
  severity_threshold: AlertDigestSeverityThreshold;
}): Promise<AlertDigestSettings> {
  checkSupabase();
  const r = await supabase.rpc('upsert_alert_digest_settings', {
    p_enabled: input.enabled,
    p_frequency: input.frequency,
    p_severity_threshold: input.severity_threshold,
  });
  fail(r.error);
  return { ...r.data, configured: true } as AlertDigestSettings;
}

export async function previewAlertDigest(): Promise<AlertDigestPreview> {
  checkSupabase();
  const r = await supabase.rpc('preview_alert_digest');
  fail(r.error);
  return r.data as AlertDigestPreview;
}


// =============================================================================
// V48 — Download automático de índices IBGE
// =============================================================================

export type FetchLogStatus = 'success' | 'partial' | 'failed' | 'skipped';

export interface FetchLogEntry {
  id: string;
  index_codigo: string;
  source: string;
  status: FetchLogStatus;
  reference_month_from: string | null;
  reference_month_to: string | null;
  rows_inserted: number;
  rows_updated: number;
  rows_skipped: number;
  error_message: string | null;
  fetched_at: string;
}

export interface IbgeDispatchResult {
  tenant_id: string;
  index_codigo: string;
  source: string;
  status: FetchLogStatus;
  rows_inserted: number;
  rows_updated: number;
  rows_skipped: number;
  rows_unchanged: number;
  error_message?: string;
  reference_month_from?: string;
  reference_month_to?: string;
}

export interface IbgeDispatchResponse {
  ok: boolean;
  dispatched: number;
  results?: IbgeDispatchResult[];
  message?: string;
  dry_run?: boolean;
  months_back?: number;
}

export async function listFetchLog(limit = 50): Promise<FetchLogEntry[]> {
  if (SKIP_AUTH) return [];
  checkSupabase();
  const r = await supabase.rpc('list_fetch_log', { p_limit: limit });
  fail(r.error);
  return (r.data || []) as FetchLogEntry[];
}

export async function triggerEconomicIndicesDownload(input?: {
  dry_run?: boolean;
  tenant_id?: string;
  codigo?: 'IPCA' | 'IPCA-15';
  months_back?: number;
}): Promise<IbgeDispatchResponse> {
  checkSupabase();
  const { data, error } = await supabase.functions.invoke('download-economic-indices', {
    body: input || {},
  });
  fail(error);
  if (!data) throw new Error('Resposta vazia da EF');
  return data as IbgeDispatchResponse;
}

export const FETCH_LOG_STATUS_LABELS: Record<FetchLogStatus, string> = {
  success: 'Sucesso',
  partial: 'Parcial',
  failed:  'Falha',
  skipped: 'Sem dados',
};

export function fetchLogStatusTone(s: FetchLogStatus): 'green' | 'yellow' | 'red' | 'slate' {
  if (s === 'success') return 'green';
  if (s === 'partial') return 'yellow';
  if (s === 'failed')  return 'red';
  return 'slate';
}

// =============================================================================
// V52 — Realtime alerts Lei 14.133
// =============================================================================
// Triggers Postgres (migration 056) inserem em `realtime_alerts`. Clientes
// subscrevem via Supabase Realtime channel filtrado por tenant_id.
// Em SKIP_AUTH, o subscribe simula chegada de alertas via setTimeout.
// =============================================================================

export type RealtimeAlertKind =
  | 'vicio_grave' | 'multa_grande' | 'par_procedente' | 'garantia_vencendo'
  | 'documento_vencendo';

export type RealtimeAlertSeverity = 'warning' | 'danger';

export interface RealtimeAlert {
  id: string;
  tenant_id: string;
  contract_id: string | null;
  contract_numero: string | null;
  alert_kind: RealtimeAlertKind;
  severity: RealtimeAlertSeverity;
  title: string;
  body: string | null;
  ref_link: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  dismissed_at: string | null;
}

export const REALTIME_ALERT_KIND_LABELS: Record<RealtimeAlertKind, string> = {
  vicio_grave:        'Vício grave',
  multa_grande:       'Multa relevante',
  par_procedente:     'PAR procedente',
  garantia_vencendo:  'Garantia vencendo',
  documento_vencendo: 'Documento vencendo',
};

// Mock para SKIP_AUTH — alertas que "chegariam" no demo
const MOCK_REALTIME_ALERTS_INITIAL: RealtimeAlert[] = [
  {
    id: 'rta-mock-1', tenant_id: 't',
    contract_id: 'c2', contract_numero: 'CT-2024/0107',
    alert_kind: 'multa_grande', severity: 'danger',
    title: 'Multa de R$ 245.000,00 aplicada',
    body: 'Atraso reiterado na execução · Reforma escolas Niterói',
    ref_link: '/contratos/c2/sancoes',
    metadata: { sanction_id: 'sanc-c2-1', valor_multa: 245_000, vencimento: '2025-12-12' },
    created_at: '2025-11-12T14:20:00Z',
    dismissed_at: null,
  },
  {
    id: 'rta-mock-2', tenant_id: 't',
    contract_id: 'c3', contract_numero: 'CT-2024/0211',
    alert_kind: 'vicio_grave', severity: 'danger',
    title: 'Vício alta registrado',
    body: 'Concreto fora de fck (35MPa) em pilares do bloco B · análise laboratorial confirmada',
    ref_link: '/contratos/c3/recebimentos',
    metadata: { vicio_id: 'vic-c3-1', severidade: 'alta', status: 'em_saneamento' },
    created_at: '2025-11-02T09:00:00Z',
    dismissed_at: null,
  },
  // V56: alerta de documento vencendo (doc-6 licença ambiental, 4 dias)
  {
    id: 'rta-mock-3', tenant_id: 't',
    contract_id: 'c1', contract_numero: 'CT-2024/0042',
    alert_kind: 'documento_vencendo', severity: 'danger',
    title: 'Documento vence em 4 dias · LIC',
    body: 'Licença ambiental de operação — LO 045/2024 · contrato CT-2024/0042 · vencimento 20/05/2026',
    ref_link: '/ged/documentos/doc-6',
    metadata: {
      document_id: 'doc-6', document_title: 'Licença ambiental de operação — LO 045/2024',
      category_codigo: 'LIC', data_validade: '2026-05-20', dias_para_vencimento: 4,
      dias_alerta_antes: 30,
    },
    created_at: '2026-05-14T06:30:00Z',
    dismissed_at: null,
  },
];

// Lista de alertas que "vão chegar" durante a sessão demo
const MOCK_REALTIME_INCOMING: RealtimeAlert[] = [
  {
    id: 'rta-incoming-1', tenant_id: 't',
    contract_id: 'c4', contract_numero: 'CT-2024/0298',
    alert_kind: 'garantia_vencendo', severity: 'warning',
    title: 'Garantia GA-00128 vence em 6 dias',
    body: 'UPA Petrópolis · caução em dinheiro · R$ 560.000,00',
    ref_link: '/contratos/c4/garantias',
    metadata: { guarantee_id: 'gar-c4-1', dias_para_vencimento: 6 },
    created_at: new Date().toISOString(),
    dismissed_at: null,
  },
];

export async function listUndismissedRealtimeAlerts(): Promise<RealtimeAlert[]> {
  if (SKIP_AUTH) {
    // Lê o estado dismissido do localStorage para persistir entre reloads
    const dismissed = readDismissedDemoAlerts();
    return MOCK_REALTIME_ALERTS_INITIAL.filter((a) => !dismissed.has(a.id));
  }
  checkSupabase();
  const r = await supabase
    .from('realtime_alerts')
    .select('*')
    .is('dismissed_at', null)
    .order('created_at', { ascending: false });
  fail(r.error);
  return (r.data || []) as RealtimeAlert[];
}

export async function dismissRealtimeAlert(id: string): Promise<void> {
  if (SKIP_AUTH) {
    const dismissed = readDismissedDemoAlerts();
    dismissed.add(id);
    writeDismissedDemoAlerts(dismissed);
    return;
  }
  checkSupabase();
  const r = await supabase.rpc('dismiss_realtime_alert', { p_alert_id: id });
  fail(r.error);
}

export async function dismissAllRealtimeAlerts(): Promise<number> {
  if (SKIP_AUTH) {
    const current = await listUndismissedRealtimeAlerts();
    const dismissed = readDismissedDemoAlerts();
    for (const a of current) dismissed.add(a.id);
    writeDismissedDemoAlerts(dismissed);
    return current.length;
  }
  checkSupabase();
  const r = await supabase.rpc('dismiss_all_realtime_alerts');
  fail(r.error);
  return (r.data as number) || 0;
}

/**
 * Subscribe to realtime alerts. Calls `onAlert` for each new INSERT.
 * Returns an unsubscribe function.
 *
 * SKIP_AUTH: simula chegada do MOCK_REALTIME_INCOMING após delay.
 */
export function subscribeToRealtimeAlerts(
  tenantId: string | null,
  onAlert: (alert: RealtimeAlert) => void,
): () => void {
  if (SKIP_AUTH) {
    // Em demo, dispara o alerta "incoming" após 8s
    const fired = new Set(readFiredDemoAlerts());
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    MOCK_REALTIME_INCOMING.forEach((a, i) => {
      if (fired.has(a.id)) return;
      const timer = setTimeout(() => {
        fired.add(a.id);
        writeFiredDemoAlerts(fired);
        onAlert(a);
      }, 8000 + i * 10000);
      timers.push(timer);
    });
    return () => timers.forEach(clearTimeout);
  }

  if (!hasSupabase || !tenantId) return () => {};

  const channel = supabase
    .channel(`realtime_alerts:tenant=${tenantId}`)
    .on(
      'postgres_changes' as 'system',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'realtime_alerts',
        filter: `tenant_id=eq.${tenantId}`,
      },
      (payload) => {
        const alert = (payload as { new: RealtimeAlert }).new;
        if (alert) onAlert(alert);
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// =============================================================================
// SKIP_AUTH localStorage helpers (persistir estado demo entre reloads)
// =============================================================================
const DEMO_DISMISSED_KEY = 'geocon:demo:realtime_dismissed';
const DEMO_FIRED_KEY     = 'geocon:demo:realtime_fired';

function readDismissedDemoAlerts(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(DEMO_DISMISSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}

function writeDismissedDemoAlerts(set: Set<string>) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(DEMO_DISMISSED_KEY, JSON.stringify([...set])); } catch { /* */ }
}

function readFiredDemoAlerts(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(DEMO_FIRED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}

function writeFiredDemoAlerts(set: Set<string>) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(DEMO_FIRED_KEY, JSON.stringify([...set])); } catch { /* */ }
}

// =============================================================================
// V54 — Validações automáticas de medição (labels + helpers)
// =============================================================================
// 6 regras implementadas em supabase/functions/validate-measurement:
//   1. saldo                       — quantidade acumulada > contratada+aditada (bloqueado)
//   2. glosa_excessiva             — glosa > 30% do valor período (alerta)
//   3. memoria_ausente             — memória de cálculo vazia (alerta)
//   4. quantidade_zero             — valor lançado mas qtd zero (bloqueado)
//   5. quantidade_acima_25pct      — período > 25% do saldo (alerta) ← V54
//   6. preco_divergente_referencia — divergência >5% vs SINAPI/SICRO (alerta) ← V54
// =============================================================================

export const VALIDATION_RULE_LABELS: Record<string, string> = {
  saldo:                          'Saldo contratual',
  glosa_excessiva:                'Glosa excessiva',
  memoria_ausente:                'Memória de cálculo ausente',
  quantidade_zero:                'Quantidade zero c/ valor',
  quantidade_acima_25pct:         'Quantidade acima de 25% do saldo',
  preco_divergente_referencia:    'Preço divergente da referência',
};

export interface MeasurementValidationSummary {
  total: number;
  ok: number;
  alertas: number;
  bloqueados: number;
  pendentes: number;
  status_agregado: 'ok' | 'alerta' | 'bloqueado' | 'pendente';
}

/**
 * Deriva o resumo agregado de validação a partir da lista de measurement_items.
 * Não chama backend — só agrega.
 */
export function summarizeMeasurementValidation(items: MItem[]): MeasurementValidationSummary {
  let ok = 0, alertas = 0, bloqueados = 0, pendentes = 0;
  for (const it of items) {
    if (it.validacao_status === 'ok') ok++;
    else if (it.validacao_status === 'alerta') alertas++;
    else if (it.validacao_status === 'bloqueado') bloqueados++;
    else pendentes++;
  }
  const status_agregado = bloqueados > 0 ? 'bloqueado'
                        : alertas > 0    ? 'alerta'
                        : pendentes > 0  ? 'pendente'
                        : 'ok';
  return { total: items.length, ok, alertas, bloqueados, pendentes, status_agregado };
}

/**
 * Retorna a lista de issues agrupada por rule, com array de items afetados.
 * Útil para o painel "Validações" que mostra "X items têm regra Y".
 */
export function groupValidationIssuesByRule(items: MItem[]): Array<{
  rule: string;
  label: string;
  severity: 'alerta' | 'bloqueado';
  items: Array<{ item_id: string; codigo: string; descricao: string; message: string }>;
}> {
  const map = new Map<string, { rule: string; severity: 'alerta' | 'bloqueado';
                                items: Array<{ item_id: string; codigo: string; descricao: string; message: string }> }>();
  for (const it of items) {
    for (const issue of it.validacao_erros || []) {
      const cur = map.get(issue.rule) ?? { rule: issue.rule, severity: issue.severity, items: [] };
      cur.items.push({ item_id: it.id, codigo: it.codigo, descricao: it.descricao, message: issue.message });
      // se a mesma regra tem severidades diferentes em items diferentes, eleva
      if (issue.severity === 'bloqueado') cur.severity = 'bloqueado';
      map.set(issue.rule, cur);
    }
  }
  return Array.from(map.values())
    .map((g) => ({ ...g, label: VALIDATION_RULE_LABELS[g.rule] || g.rule }))
    .sort((a, b) => {
      // bloqueado antes de alerta; dentro do mesmo, ordem alfabética
      if (a.severity !== b.severity) return a.severity === 'bloqueado' ? -1 : 1;
      return a.label.localeCompare(b.label, 'pt-BR');
    });
}

// =============================================================================
// V55 — Curva ABC de itens contratuais (SOV)
// =============================================================================
// Classifica items por valor acumulado descendente:
//   A: ≤80% acumulado (poucos items, alto valor — Pareto)
//   B: 80-95%
//   C: 95-100% (cauda longa)
//
// Migration 058 cria view + RPC `get_contract_abc_summary`.
// =============================================================================

export type AbcClasse = 'A' | 'B' | 'C';

export interface ContractItemAbc {
  id: string;
  contract_id: string;
  sov_version_id: string;
  codigo: string;
  descricao: string;
  unidade: string | null;
  discipline_id: string | null;
  quantidade_contratada: number;
  quantidade_aditada: number;
  preco_unitario: number;
  quantidade_medida_acumulada: number;
  fonte_referencia: string;
  valor_total: number;
  valor_contrato_total: number;
  pct_individual: number;
  pct_acumulado: number;
  rank: number;
  classe: AbcClasse;
}

export interface AbcClasseStats {
  items_count: number;
  valor_total: number;
  pct_items: number;
  pct_valor: number;
}

export interface ContractAbcSummary {
  contract_id: string;
  valor_contrato_total: number;
  items_total: number;
  A: AbcClasseStats;
  B: AbcClasseStats;
  C: AbcClasseStats;
}

// Mock SKIP_AUTH — deriva ABC dos MOCK_ITEMS para os contratos com items.
// Sem mock estático separado — função pura sobre dados existentes mantém
// consistência mesmo se MOCK_ITEMS mudar.
function deriveAbcFromMockItems(contractId: string): ContractItemAbc[] {
  const items = (MOCK_ITEMS[contractId] || []).filter((it) => it.locked || !it.locked); // todos
  if (items.length === 0) return [];
  // Calcula valor por item (qtd_contratada + qtd_aditada) * preco_unitario
  const enriched = items.map((it) => ({
    ...it,
    valor: (it.quantidade_contratada + (it.quantidade_aditada || 0)) * it.preco_unitario,
  }));
  enriched.sort((a, b) => b.valor - a.valor || a.codigo.localeCompare(b.codigo));
  const valorTotal = enriched.reduce((s, e) => s + e.valor, 0);
  let acumulado = 0;
  return enriched.map((it, idx) => {
    acumulado += it.valor;
    const pctIndiv = valorTotal > 0 ? (it.valor / valorTotal) * 100 : 0;
    const pctAcum  = valorTotal > 0 ? (acumulado / valorTotal) * 100 : 0;
    const classe: AbcClasse = pctAcum <= 80 ? 'A' : pctAcum <= 95 ? 'B' : 'C';
    return {
      id: it.id,
      contract_id: contractId,
      sov_version_id: 'sov-mock',
      codigo: it.codigo,
      descricao: it.descricao,
      unidade: it.unidade,
      discipline_id: null,
      quantidade_contratada: it.quantidade_contratada,
      quantidade_aditada: it.quantidade_aditada || 0,
      preco_unitario: it.preco_unitario,
      quantidade_medida_acumulada: it.quantidade_medida_acumulada,
      fonte_referencia: it.fonte_referencia || 'proprio',
      valor_total: it.valor,
      valor_contrato_total: valorTotal,
      pct_individual: Number(pctIndiv.toFixed(4)),
      pct_acumulado:  Number(pctAcum.toFixed(4)),
      rank: idx + 1,
      classe,
    };
  });
}

export async function listContractItemsAbc(contractId: string): Promise<ContractItemAbc[]> {
  if (SKIP_AUTH) return deriveAbcFromMockItems(contractId);
  checkSupabase();
  const r = await supabase
    .from('v_contract_items_abc')
    .select('*')
    .eq('contract_id', contractId)
    .order('rank', { ascending: true });
  fail(r.error);
  return (r.data || []) as ContractItemAbc[];
}

export async function getContractAbcSummary(contractId: string): Promise<ContractAbcSummary> {
  if (SKIP_AUTH) {
    const rows = deriveAbcFromMockItems(contractId);
    const valorTotal = rows[0]?.valor_contrato_total ?? 0;
    const itemsTotal = rows.length;
    function statsFor(classe: AbcClasse): AbcClasseStats {
      const filtered = rows.filter((r) => r.classe === classe);
      const count = filtered.length;
      const valor = filtered.reduce((s, r) => s + r.valor_total, 0);
      return {
        items_count: count,
        valor_total: Number(valor.toFixed(2)),
        pct_items:   itemsTotal > 0 ? Number(((count / itemsTotal) * 100).toFixed(1)) : 0,
        pct_valor:   valorTotal > 0 ? Number(((valor / valorTotal) * 100).toFixed(1)) : 0,
      };
    }
    return {
      contract_id: contractId,
      valor_contrato_total: Number(valorTotal.toFixed(2)),
      items_total: itemsTotal,
      A: statsFor('A'), B: statsFor('B'), C: statsFor('C'),
    };
  }
  checkSupabase();
  const r = await supabase.rpc('get_contract_abc_summary', { p_contract_id: contractId });
  fail(r.error);
  return r.data as ContractAbcSummary;
}

export const ABC_CLASSE_LABELS: Record<AbcClasse, string> = {
  A: 'Classe A · alto valor',
  B: 'Classe B · médio valor',
  C: 'Classe C · cauda longa',
};

export const ABC_CLASSE_DESCRIPTION: Record<AbcClasse, string> = {
  A: '≤80% do valor acumulado · prioridade máxima de controle',
  B: '80–95% acumulado · controle moderado',
  C: '95–100% acumulado · controle rotineiro',
};

// =============================================================================
// V56 — Validade temporal em GED (helpers + RPC update)
// =============================================================================
// Schema: ged_documents.data_validade + dias_alerta_antes (migration 059)
// Cron diário scan_ged_documents_expiring popula realtime_alerts.
// =============================================================================

export type GedValidityStatus = 'sem_validade' | 'ok' | 'vencendo' | 'vencendo_critico' | 'vencido';

/**
 * Deriva o status de validade a partir de dias_para_vencimento e dias_alerta_antes.
 *
 * - sem_validade: campo data_validade não preenchido
 * - vencido: dias < 0
 * - vencendo_critico: 0 ≤ dias ≤ 7
 * - vencendo: 7 < dias ≤ dias_alerta_antes
 * - ok: dias > dias_alerta_antes (fora da janela de alerta)
 */
export function gedValidityStatus(
  dias_para_vencimento: number | null,
  dias_alerta_antes: number | null = 30,
): GedValidityStatus {
  if (dias_para_vencimento === null || dias_para_vencimento === undefined) return 'sem_validade';
  if (dias_para_vencimento < 0) return 'vencido';
  if (dias_para_vencimento <= 7) return 'vencendo_critico';
  if (dias_para_vencimento <= (dias_alerta_antes ?? 30)) return 'vencendo';
  return 'ok';
}

export const GED_VALIDITY_LABELS: Record<GedValidityStatus, string> = {
  sem_validade:     'Sem validade',
  ok:               'OK',
  vencendo:         'Vencendo',
  vencendo_critico: 'Vencendo · crítico',
  vencido:          'Vencido',
};

/**
 * Define ou limpa a validade de um documento GED.
 * Pass `data_validade=null` para remover a validade. Persiste em SKIP_AUTH localStorage.
 */
export async function updateGedDocumentValidity(input: {
  document_id: string;
  data_validade: string | null;      // ISO date YYYY-MM-DD, ou null para limpar
  dias_alerta_antes?: number;        // default 30
}): Promise<void> {
  if (SKIP_AUTH) {
    // Atualiza o MOCK_GED_DOCS in-memory (não persiste entre reloads, mas
    // permite a demo simular set/clear de validade na mesma sessão)
    const doc = MOCK_GED_DOCS.find((d) => d.id === input.document_id);
    if (doc) {
      doc.data_validade = input.data_validade;
      if (input.data_validade) {
        doc.dias_para_vencimento = Math.ceil(
          (new Date(input.data_validade).getTime() - Date.now()) / 86_400_000
        );
      } else {
        doc.dias_para_vencimento = null;
      }
      doc.dias_alerta_antes = input.dias_alerta_antes ?? 30;
    }
    return;
  }
  checkSupabase();
  const r = await supabase.rpc('update_ged_document_validity', {
    p_document_id:   input.document_id,
    p_data_validade: input.data_validade,
    p_dias_alerta:   input.dias_alerta_antes ?? 30,
  });
  fail(r.error);
}

// =============================================================================
// V57 — Auditoria de divergência de preços (SINAPI/SICRO)
// =============================================================================
// Migration 060 cria v_contract_price_audit + RPC get_contract_price_audit_summary.
//
// Complementa V54 (validação por medição) e V55 (curva ABC) com terceira
// dimensão: análise consolidada do CONTRATO INTEIRO vs referência oficial.
// =============================================================================

export type PriceAuditMagnitude = 'pequena' | 'media' | 'alta' | 'critica';
export type PriceAuditSinal     = 'caro' | 'barato';

export interface PriceAuditItem {
  id: string;
  contract_id: string;
  sov_version_id: string;
  codigo: string;
  descricao: string;
  unidade: string | null;
  quantidade_contratada: number;
  quantidade_aditada: number;
  preco_contrato: number;
  fonte_contrato: string;
  ref_base: string;
  ref_codigo: string | null;
  ref_descricao: string | null;
  ref_uf: string | null;
  ref_data_base: string | null;
  preco_referencia: number;
  divergencia_pct: number;
  impacto_valor: number;
  magnitude: PriceAuditMagnitude;
  sinal: PriceAuditSinal;
}

export interface PriceAuditSummary {
  contract_id: string;
  items_auditados: number;
  items_total: number;
  cobertura_pct: number;
  magnitudes: { pequena: number; media: number; alta: number; critica: number };
  sinais:     { caros: number; baratos: number };
  impacto:    { acima: number; abaixo: number; liquido: number };
}

// =============================================================================
// SKIP_AUTH mock — gera auditoria realista a partir de MOCK_ITEMS
// =============================================================================
// Hardcode: para itens com fonte_referencia SINAPI/SICRO, simula uma referência
// próxima do preço contratado (algumas com divergência, outras OK).
const MOCK_PRICE_AUDIT_OFFSETS: Record<string, { base: string; offset_pct: number; uf: string }> = {
  // c1
  'i1-1': { base: 'SINAPI', offset_pct:  -2.1, uf: 'RJ' }, // pequena, barato
  'i1-2': { base: 'SINAPI', offset_pct: +18.4, uf: 'RJ' }, // alta, caro
  'i1-3': { base: 'SINAPI', offset_pct:  +6.8, uf: 'RJ' }, // média, caro
  'i1-4': { base: 'SINAPI', offset_pct: +34.2, uf: 'RJ' }, // crítica, caro
  'i1-5': { base: 'SINAPI', offset_pct:  +8.4, uf: 'RJ' }, // média, caro
  // c2
  'i2-1': { base: 'SINAPI', offset_pct:  -4.2, uf: 'RJ' },
  'i2-2': { base: 'SINAPI', offset_pct: +12.7, uf: 'RJ' }, // média, caro
  'i2-3': { base: 'SINAPI', offset_pct:  +2.8, uf: 'RJ' },
};

function deriveMockPriceAudit(contractId: string): PriceAuditItem[] {
  const items = MOCK_ITEMS[contractId] || [];
  const refDate = '2024-09-01';
  return items.flatMap((it) => {
    const cfg = MOCK_PRICE_AUDIT_OFFSETS[it.id];
    if (!cfg) return []; // item sem referência cadastrada — não entra na auditoria
    // preco_contrato = preco_referencia * (1 + offset/100)  ⟹  preco_referencia = preco_contrato / (1 + offset/100)
    const precoReferencia = Number((it.preco_unitario / (1 + cfg.offset_pct / 100)).toFixed(6));
    const impacto = Number(((it.preco_unitario - precoReferencia) * (it.quantidade_contratada + (it.quantidade_aditada || 0))).toFixed(2));
    const absDiv = Math.abs(cfg.offset_pct);
    const magnitude: PriceAuditMagnitude =
      absDiv <= 5  ? 'pequena' :
      absDiv <= 15 ? 'media'   :
      absDiv <= 30 ? 'alta'    : 'critica';
    const sinal: PriceAuditSinal = cfg.offset_pct > 0 ? 'caro' : 'barato';
    return [{
      id: it.id, contract_id: contractId, sov_version_id: 'sov-mock',
      codigo: it.codigo, descricao: it.descricao, unidade: it.unidade,
      quantidade_contratada: it.quantidade_contratada,
      quantidade_aditada: it.quantidade_aditada || 0,
      preco_contrato: it.preco_unitario,
      fonte_contrato: it.fonte_referencia || 'proprio',
      ref_base: cfg.base, ref_codigo: null, ref_descricao: null,
      ref_uf: cfg.uf, ref_data_base: refDate,
      preco_referencia: precoReferencia,
      divergencia_pct: cfg.offset_pct,
      impacto_valor: impacto,
      magnitude, sinal,
    }];
  });
}

export async function listContractPriceAudit(contractId: string): Promise<PriceAuditItem[]> {
  if (SKIP_AUTH) {
    return deriveMockPriceAudit(contractId)
      .sort((a, b) => Math.abs(b.divergencia_pct) - Math.abs(a.divergencia_pct));
  }
  checkSupabase();
  const r = await supabase
    .from('v_contract_price_audit')
    .select('*')
    .eq('contract_id', contractId)
    .order('divergencia_pct', { ascending: false });
  fail(r.error);
  return (r.data || []) as PriceAuditItem[];
}

export async function getContractPriceAuditSummary(contractId: string): Promise<PriceAuditSummary> {
  if (SKIP_AUTH) {
    const items = deriveMockPriceAudit(contractId);
    const total = (MOCK_ITEMS[contractId] || []).length;
    const auditados = items.length;
    const caros   = items.filter((i) => i.sinal === 'caro').length;
    const baratos = items.filter((i) => i.sinal === 'barato').length;
    const impactoAcima  = items.filter((i) => i.divergencia_pct > 0)
                              .reduce((s, i) => s + i.impacto_valor, 0);
    const impactoAbaixo = items.filter((i) => i.divergencia_pct < 0)
                              .reduce((s, i) => s + i.impacto_valor, 0);
    return {
      contract_id: contractId,
      items_auditados: auditados,
      items_total:     total,
      cobertura_pct:   total > 0 ? Number(((auditados / total) * 100).toFixed(1)) : 0,
      magnitudes: {
        pequena: items.filter((i) => i.magnitude === 'pequena').length,
        media:   items.filter((i) => i.magnitude === 'media').length,
        alta:    items.filter((i) => i.magnitude === 'alta').length,
        critica: items.filter((i) => i.magnitude === 'critica').length,
      },
      sinais: { caros, baratos },
      impacto: {
        acima:  Number(impactoAcima.toFixed(2)),
        abaixo: Number(impactoAbaixo.toFixed(2)),
        liquido: Number((impactoAcima + impactoAbaixo).toFixed(2)),
      },
    };
  }
  checkSupabase();
  const r = await supabase.rpc('get_contract_price_audit_summary', { p_contract_id: contractId });
  fail(r.error);
  return r.data as PriceAuditSummary;
}

export const PRICE_AUDIT_MAGNITUDE_LABELS: Record<PriceAuditMagnitude, string> = {
  pequena: 'Divergência pequena (≤5%)',
  media:   'Divergência média (5–15%)',
  alta:    'Divergência alta (15–30%)',
  critica: 'Divergência crítica (>30%)',
};

// =============================================================================
// V59 — Painel KPI do acervo GED
// =============================================================================
// Migration 061 cria RPC get_ged_acervo_kpis(). Tudo numa única chamada
// retornando jsonb com 8 dimensões agregadas.
// =============================================================================

export interface GedAcervoKpis {
  tenant_id: string;
  total: number;
  by_status: Partial<Record<
    'em_elaboracao' | 'em_revisao' | 'aprovado' | 'distribuido' | 'obsoleto' | 'cancelado',
    number
  >>;
  by_category: Array<{
    id: string; codigo: string; nome: string;
    cnt: number; aprovados: number; em_revisao: number; obsoletos: number;
  }>;
  validade: {
    com_validade: number;
    sem_validade: number;
    pct_com_validade: number;
  };
  extracao: {
    com_texto: number;
    sem_texto: number;
    pct_com_texto: number;
  };
  uso: {
    downloads_30d: number;
  };
  health: {
    aprovados_sem_revisao_1ano: number;
    em_revisao_mais_30d: number;
    vencidos_ativos: number;
  };
  generated_at: string;
}

// Mock SKIP_AUTH — deriva dos MOCK_GED_DOCS + MOCK_VERSIONS + MOCK_ACCESS.
// Função pura (não memoizada) para refletir mudanças se mock for editado.
function deriveMockGedAcervoKpis(): GedAcervoKpis {
  const docs = MOCK_GED_DOCS.filter((d) => !(d as { deleted_at?: string }).deleted_at);
  const total = docs.length;

  // by_status
  const byStatus: Partial<Record<string, number>> = {};
  for (const d of docs) {
    byStatus[d.status] = (byStatus[d.status] || 0) + 1;
  }

  // by_category — agrupa por category_codigo (proxy para id)
  const catMap = new Map<string, { codigo: string; nome: string; cnt: number; aprovados: number; em_revisao: number; obsoletos: number }>();
  for (const d of docs) {
    const k = d.category_codigo;
    if (!catMap.has(k)) {
      catMap.set(k, { codigo: d.category_codigo, nome: d.category_nome, cnt: 0, aprovados: 0, em_revisao: 0, obsoletos: 0 });
    }
    const c = catMap.get(k)!;
    c.cnt++;
    if (d.status === 'aprovado') c.aprovados++;
    if (d.status === 'em_revisao') c.em_revisao++;
    if (d.status === 'obsoleto') c.obsoletos++;
  }
  const byCategory = Array.from(catMap.values())
    .map((c, idx) => ({ id: `cat-mock-${idx}`, ...c }))
    .sort((a, b) => b.cnt - a.cnt)
    .slice(0, 8);

  // validade
  const comValidade = docs.filter((d) => d.data_validade).length;

  // extração — assume que doc-1 tem versões extraídas (V58 mock), resto null
  const comTexto = docs.filter((d) => d.id === 'doc-1').length;

  // downloads_30d
  const cutoff = Date.now() - 30 * 86_400_000;
  const downloads30d = (MOCK_ACCESS as Array<{ action: string; occurred_at: string }>)
    .filter((e) => e.action === 'download' && new Date(e.occurred_at).getTime() >= cutoff)
    .length;

  // health
  const oneYearAgo = Date.now() - 365 * 86_400_000;
  const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
  const aprovadosVelhos = docs.filter((d) => d.status === 'aprovado' && new Date(d.created_at).getTime() < oneYearAgo).length;
  const emRevisaoVelhos = docs.filter((d) => d.status === 'em_revisao' && new Date(d.created_at).getTime() < thirtyDaysAgo).length;
  const vencidosAtivos = docs.filter((d) => {
    if (!d.data_validade) return false;
    if (d.status === 'obsoleto' || d.status === 'cancelado') return false;
    const dias = (d.dias_para_vencimento ?? Math.ceil((new Date(d.data_validade).getTime() - Date.now()) / 86_400_000));
    return dias < 0;
  }).length;

  return {
    tenant_id: 't',
    total,
    by_status: byStatus as GedAcervoKpis['by_status'],
    by_category: byCategory,
    validade: {
      com_validade: comValidade,
      sem_validade: total - comValidade,
      pct_com_validade: total > 0 ? Number(((comValidade / total) * 100).toFixed(1)) : 0,
    },
    extracao: {
      com_texto: comTexto,
      sem_texto: total - comTexto,
      pct_com_texto: total > 0 ? Number(((comTexto / total) * 100).toFixed(1)) : 0,
    },
    uso: {
      downloads_30d: downloads30d,
    },
    health: {
      aprovados_sem_revisao_1ano: aprovadosVelhos,
      em_revisao_mais_30d: emRevisaoVelhos,
      vencidos_ativos: vencidosAtivos,
    },
    generated_at: new Date().toISOString(),
  };
}

export async function getGedAcervoKpis(): Promise<GedAcervoKpis> {
  if (SKIP_AUTH) return deriveMockGedAcervoKpis();
  checkSupabase();
  const r = await supabase.rpc('get_ged_acervo_kpis');
  fail(r.error);
  return r.data as GedAcervoKpis;
}

export const GED_STATUS_LABELS: Record<string, string> = {
  em_elaboracao: 'Em elaboração',
  em_revisao:    'Em revisão',
  aprovado:      'Aprovado',
  distribuido:   'Distribuído',
  obsoleto:      'Obsoleto',
  cancelado:     'Cancelado',
};

// =============================================================================
// V60 — Workflow aprovação de revisão GED
// =============================================================================
// Migration 062 cria ged_revision_approval_steps + 2 RPCs
// (instantiate_ged_revision_workflow, decide_ged_revision_step). Reusa magic
// link genérico de approval_magic_links (entity_type='ged_revision').
// =============================================================================

export interface GedRevisionApprovalStep {
  id: string;
  document_id: string;
  version_id: string;
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
  decided_member?:  { nome: string };
}

const MOCK_GED_REVISION_STEPS: GedRevisionApprovalStep[] = [
  // doc-1 v3 (revisão 3) — 2 steps; step 1 aprovado, step 2 pendente
  {
    id: 'grs-1', document_id: 'doc-1', version_id: 'v3', ordem: 1,
    nome: 'Revisão técnica · RT',  role_required: 'gestor_contrato',
    assigned_to: 'm-pat',
    status: 'aprovado',
    due_at: '2026-05-18T10:00:00Z',
    decided_at: '2026-05-14T16:30:00Z',
    decided_by: 'm-pat', decided_via_delegation: null, decided_for: null,
    comment: 'Conformidade com NBR 6118 e RDC 50 verificada. Sala híbrida especificada corretamente.',
    signature_method: 'magic_link',
    assigned_member: { nome: 'Patrícia Lopes', email: 'patricia@example.com' },
    decided_member:  { nome: 'Patrícia Lopes' },
  },
  {
    id: 'grs-2', document_id: 'doc-1', version_id: 'v3', ordem: 2,
    nome: 'Aprovação final · Coordenação', role_required: 'admin',
    assigned_to: 'm-coord',
    status: 'pendente',
    due_at: '2026-05-19T10:00:00Z',
    decided_at: null, decided_by: null, decided_via_delegation: null, decided_for: null,
    comment: null, signature_method: null,
    assigned_member: { nome: 'Roberto Silveira (coord.)', email: 'roberto@example.com' },
  },
];

export async function listGedRevisionApprovalSteps(versionId: string): Promise<GedRevisionApprovalStep[]> {
  if (SKIP_AUTH) {
    return MOCK_GED_REVISION_STEPS.filter((s) => s.version_id === versionId).sort((a, b) => a.ordem - b.ordem);
  }
  checkSupabase();
  const r = await supabase
    .from('ged_revision_approval_steps')
    .select('*, assigned_member:members!ged_revision_approval_steps_assigned_to_fkey(nome,email), decided_member:members!ged_revision_approval_steps_decided_by_fkey(nome)')
    .eq('version_id', versionId).is('deleted_at', null)
    .order('ordem', { ascending: true });
  fail(r.error);
  return (r.data || []) as GedRevisionApprovalStep[];
}

/**
 * Lista steps pendentes de revisão GED no tenant (para inbox global em "Minhas aprovações").
 */
export async function listMyGedRevisionApprovals(): Promise<Array<GedRevisionApprovalStep & {
  document_title?: string;
  document_revision?: string;
}>> {
  if (SKIP_AUTH) {
    const pending = MOCK_GED_REVISION_STEPS.filter((s) => s.status === 'pendente');
    return pending.map((s) => {
      const doc = MOCK_GED_DOCS.find((d) => d.id === s.document_id);
      const ver = MOCK_VERSIONS.find((v) => v.id === s.version_id);
      return { ...s, document_title: doc?.title, document_revision: ver?.revision };
    });
  }
  checkSupabase();
  const r = await supabase
    .from('ged_revision_approval_steps')
    .select('*, ged_documents(title), ged_document_versions(revision)')
    .eq('status', 'pendente').is('deleted_at', null)
    .order('due_at', { ascending: true });
  fail(r.error);
  // Flatten join
  return (r.data || []).map((row: Record<string, unknown>) => ({
    ...(row as unknown as GedRevisionApprovalStep),
    document_title:    (row as { ged_documents?: { title?: string } }).ged_documents?.title,
    document_revision: (row as { ged_document_versions?: { revision?: string } }).ged_document_versions?.revision,
  }));
}

export async function instantiateGedRevisionWorkflow(versionId: string, templateId?: string): Promise<number> {
  if (SKIP_AUTH) {
    // Demo: instantia 2 steps padrão no mock
    return 2;
  }
  checkSupabase();
  const r = await supabase.rpc('instantiate_ged_revision_workflow', {
    p_version_id: versionId, p_template_id: templateId ?? null,
  });
  fail(r.error);
  return (r.data as number) || 0;
}

export async function decideGedRevisionStep(input: {
  step_id: string;
  action: 'aprovar' | 'devolver' | 'reprovar';
  comment?: string;
}): Promise<{ step_id: string; status: string; pending_remaining: number; reproved_count: number }> {
  if (SKIP_AUTH) {
    // Demo: muta MOCK_GED_REVISION_STEPS in-memory
    const step = MOCK_GED_REVISION_STEPS.find((s) => s.id === input.step_id);
    if (step) {
      step.status = input.action === 'aprovar' ? 'aprovado' : input.action === 'devolver' ? 'devolvido' : 'reprovado';
      step.decided_at = new Date().toISOString();
      step.decided_by = 'mock-user';
      step.decided_member = { nome: 'Você (demo)' };
      step.comment = input.comment ?? null;

      // V65 — simula triggers de notificação (em produção, vem do Postgres)
      const doc = MOCK_GED_DOCS.find((d) => d.id === step.document_id);
      const ver = MOCK_VERSIONS.find((v) => v.id === step.version_id);
      const docTitle = doc?.title ?? 'documento';
      const rev = ver?.revision ?? '?';

      if (input.action === 'aprovar') {
        // Próximo step pendente, se houver
        const next = MOCK_GED_REVISION_STEPS
          .filter((s) => s.version_id === step.version_id && s.status === 'pendente')
          .sort((a, b) => a.ordem - b.ordem)[0];
        if (next) {
          MOCK_NOTIFICATIONS.unshift({
            id: 'n-auto-' + Math.random().toString(36).slice(2, 8),
            title: 'Próxima etapa GED aguarda sua aprovação',
            body: `${docTitle} · revisão ${rev} · etapa "${next.nome}" (anterior aprovada)`,
            link: `/ged/documentos/${step.document_id}/aprovar`,
            kind: 'workflow_assignment',
            read_at: null,
            created_at: new Date().toISOString(),
          });
        } else {
          // Último step → publicação
          MOCK_NOTIFICATIONS.unshift({
            id: 'n-auto-' + Math.random().toString(36).slice(2, 8),
            title: 'Revisão GED publicada',
            body: `${docTitle} · revisão ${rev} aprovada e publicada como vigente`,
            link: `/ged/documentos/${step.document_id}`,
            kind: 'success',
            read_at: null,
            created_at: new Date().toISOString(),
          });
        }
      } else if (input.action === 'devolver' || input.action === 'reprovar') {
        MOCK_NOTIFICATIONS.unshift({
          id: 'n-auto-' + Math.random().toString(36).slice(2, 8),
          title: input.action === 'reprovar' ? 'Revisão GED reprovada' : 'Revisão GED devolvida para ajustes',
          body: `${docTitle} · revisão ${rev} · etapa "${step.nome}"`
            + (input.comment ? ` · "${input.comment.slice(0, 120)}"` : ''),
          link: `/ged/documentos/${step.document_id}/aprovar`,
          kind: input.action === 'reprovar' ? 'error' : 'warning',
          read_at: null,
          created_at: new Date().toISOString(),
        });
      }
    }
    const pending = MOCK_GED_REVISION_STEPS.filter((s) => s.version_id === step?.version_id && s.status === 'pendente').length;
    const reproved = MOCK_GED_REVISION_STEPS.filter((s) => s.version_id === step?.version_id && s.status === 'reprovado').length;
    return { step_id: input.step_id, status: step?.status || 'pendente', pending_remaining: pending, reproved_count: reproved };
  }
  checkSupabase();
  const r = await supabase.rpc('decide_ged_revision_step', {
    p_step_id: input.step_id,
    p_action:  input.action,
    p_comment: input.comment ?? null,
  });
  fail(r.error);
  return r.data as { step_id: string; status: string; pending_remaining: number; reproved_count: number };
}

/**
 * Issue de magic link para aprovação externa de revisão GED.
 * Reusa approval_magic_links com entity_type='ged_revision'.
 */
export async function issueGedRevisionMagicLink(stepId: string, email: string, ttlHours = 72): Promise<string> {
  if (SKIP_AUTH) {
    return `${SITE_URL || ''}/aprovacao-externa?token=demo-token-${stepId}`;
  }
  checkSupabase();
  const r = await supabase.rpc('issue_approval_magic_link', {
    p_entity_type: 'ged_revision',
    p_entity_id:   stepId,
    p_email:       email,
    p_ttl_hours:   ttlHours,
  });
  fail(r.error);
  const token = r.data as string;
  return `${SITE_URL || ''}/aprovacao-externa?token=${token}`;
}

// =============================================================================
// V64 — Histórico item-level (audit trail) de contract_items
// =============================================================================
// Migration 063 cria trigger AFTER UPDATE em contract_items que popula
// audit_log (V01). RPC list_contract_item_history retorna lista cronológica.
// =============================================================================

export interface ContractItemHistoryEntry {
  id: string;
  changed_at: string;
  actor_id: string | null;
  actor_nome: string | null;
  action: string;
  before_value: Record<string, unknown> | null;
  after_value:  Record<string, unknown> | null;
  source: string | null;
}

// Labels pt-BR para os campos rastreados (V64)
export const CONTRACT_ITEM_FIELD_LABELS: Record<string, string> = {
  preco_unitario:        'Preço unitário',
  quantidade_contratada: 'Quantidade contratada',
  quantidade_aditada:    'Quantidade aditada',
  descricao:             'Descrição',
  codigo:                'Código',
  unidade:               'Unidade',
  locked:                'Bloqueado',
  active:                'Ativo',
  fonte_referencia:      'Fonte referência',
  bdi_percentual:        'BDI (%)',
};

// Mock SKIP_AUTH — histórico fictício realista para demonstrar UI.
const MOCK_CONTRACT_ITEM_HISTORY: Record<string, ContractItemHistoryEntry[]> = {
  'i1-2': [
    {
      id: 'h-i1-2-3',
      changed_at: '2026-03-12T14:22:00Z',
      actor_id: 'm-pat', actor_nome: 'Patrícia Lopes',
      action: 'update', source: 'sov_edit',
      before_value: { preco_unitario: 720.50 },
      after_value:  { preco_unitario: 845.20 },
    },
    {
      id: 'h-i1-2-2',
      changed_at: '2026-02-04T09:08:00Z',
      actor_id: 'm-edu', actor_nome: 'Eduardo Vargas',
      action: 'update', source: 'sov_edit',
      before_value: { quantidade_contratada: 150 },
      after_value:  { quantidade_contratada: 174 },
    },
    {
      id: 'h-i1-2-1',
      changed_at: '2026-01-15T11:30:00Z',
      actor_id: 'm-pat', actor_nome: 'Patrícia Lopes',
      action: 'update', source: 'sov_edit',
      before_value: { locked: false },
      after_value:  { locked: true },
    },
  ],
  'i1-4': [
    {
      id: 'h-i1-4-2',
      changed_at: '2026-04-02T16:10:00Z',
      actor_id: 'm-coord', actor_nome: 'Roberto Silveira',
      action: 'update', source: 'sov_import',
      before_value: { preco_unitario: 95.00, fonte_referencia: 'proprio' },
      after_value:  { preco_unitario: 128.40, fonte_referencia: 'SINAPI' },
    },
    {
      id: 'h-i1-4-1',
      changed_at: '2026-03-20T10:00:00Z',
      actor_id: 'm-pat', actor_nome: 'Patrícia Lopes',
      action: 'update', source: 'sov_edit',
      before_value: { bdi_percentual: 22.0 },
      after_value:  { bdi_percentual: 24.5 },
    },
  ],
};

export async function listContractItemHistory(itemId: string): Promise<ContractItemHistoryEntry[]> {
  if (SKIP_AUTH) {
    return MOCK_CONTRACT_ITEM_HISTORY[itemId] || [];
  }
  checkSupabase();
  const r = await supabase.rpc('list_contract_item_history', { p_item_id: itemId });
  fail(r.error);
  return (r.data || []) as ContractItemHistoryEntry[];
}

/**
 * Formata o valor de um campo conforme seu tipo (preço → BRL, qty → number, bool → sim/não, etc).
 * Aceita unknown — quem chama passa o valor cru do before/after_value jsonb.
 */
export function formatContractItemHistoryValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  if (field === 'preco_unitario' || field === 'bdi_percentual') {
    return typeof value === 'number'
      ? value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
      : String(value);
  }
  if (field === 'quantidade_contratada' || field === 'quantidade_aditada') {
    return typeof value === 'number'
      ? value.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
      : String(value);
  }
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

// =============================================================================
// V66 — Composições de preço explícitas (mão-de-obra + material + equipamento)
// =============================================================================
// Migration 065 cria contract_item_compositions + contract_item_composition_lines
// + view v_contract_item_composition_summary + 2 RPCs.
// =============================================================================

export type CompositionLineTipo =
  | 'mao_obra'
  | 'material'
  | 'equipamento'
  | 'servico_terceiro'
  | 'consumo_auxiliar';

export const COMPOSITION_TIPO_LABELS: Record<CompositionLineTipo, string> = {
  mao_obra:         'Mão de obra',
  material:         'Material',
  equipamento:      'Equipamento',
  servico_terceiro: 'Serviços de terceiros',
  consumo_auxiliar: 'Consumo auxiliar',
};

export interface CompositionLine {
  id: string;
  tenant_id: string;
  composition_id: string;
  ordem: number;
  tipo: CompositionLineTipo;
  codigo: string | null;
  descricao: string;
  unidade: string;
  coeficiente: number;
  preco_unitario: number;
  observacao: string | null;
  created_at: string;
}

export interface CompositionSummary {
  id: string;
  tenant_id: string;
  contract_item_id: string;
  codigo_composicao: string | null;
  fonte: 'SINAPI' | 'SICRO' | 'ORSE' | 'SEDOP' | 'proprio' | 'outro';
  data_base: string | null;
  observacao: string | null;
  created_at: string;
  updated_at: string;
  total_mao_obra: number;
  total_material: number;
  total_equipamento: number;
  total_terceiros: number;
  total_aux: number;
  total_sem_bdi: number;
  num_linhas: number;
}

export interface ContractItemComposition {
  summary: CompositionSummary;
  lines: CompositionLine[];
}

// Mock SKIP_AUTH — 2 composições realistas (concreto SINAPI + reboco)
// Cobrem 4 dos 5 tipos de insumo
const MOCK_COMPOSITIONS: Record<string, ContractItemComposition> = {
  // i1-2 — "Concreto estrutural fck=30 MPa - m³"
  'i1-2': {
    summary: {
      id: 'cmp-i1-2', tenant_id: 't-1', contract_item_id: 'i1-2',
      codigo_composicao: '92395', fonte: 'SINAPI', data_base: '2026-01-01',
      observacao: 'Concreto usinado, lançado e adensado convencional', created_at: '2026-01-15T10:00:00Z', updated_at: '2026-01-15T10:00:00Z',
      total_mao_obra: 67.20,
      total_material: 487.20,
      total_equipamento: 18.00,
      total_terceiros: 0,
      total_aux: 5.30,
      total_sem_bdi: 577.70,
      num_linhas: 6,
    },
    lines: [
      { id: 'cl-1', tenant_id: 't-1', composition_id: 'cmp-i1-2', ordem: 1, tipo: 'mao_obra', codigo: '88309', descricao: 'Pedreiro com encargos complementares', unidade: 'h', coeficiente: 1.6, preco_unitario: 28.50, observacao: null, created_at: '2026-01-15T10:00:00Z' },
      { id: 'cl-2', tenant_id: 't-1', composition_id: 'cmp-i1-2', ordem: 2, tipo: 'mao_obra', codigo: '88316', descricao: 'Servente com encargos complementares', unidade: 'h', coeficiente: 1.6, preco_unitario: 13.50, observacao: null, created_at: '2026-01-15T10:00:00Z' },
      { id: 'cl-3', tenant_id: 't-1', composition_id: 'cmp-i1-2', ordem: 1, tipo: 'material', codigo: '01510', descricao: 'Concreto usinado bombeável, classe C30, slump 100±20mm', unidade: 'm³', coeficiente: 1.05, preco_unitario: 420.00, observacao: 'Inclui perda de 5%', created_at: '2026-01-15T10:00:00Z' },
      { id: 'cl-4', tenant_id: 't-1', composition_id: 'cmp-i1-2', ordem: 2, tipo: 'material', codigo: '00370', descricao: 'Pino de aço CA-25 ø 4.2mm para amarração', unidade: 'kg', coeficiente: 4.8, preco_unitario: 9.40, observacao: null, created_at: '2026-01-15T10:00:00Z' },
      { id: 'cl-5', tenant_id: 't-1', composition_id: 'cmp-i1-2', ordem: 1, tipo: 'equipamento', codigo: '06095', descricao: 'Bomba lança estacionária para concreto', unidade: 'h', coeficiente: 0.1, preco_unitario: 180.00, observacao: null, created_at: '2026-01-15T10:00:00Z' },
      { id: 'cl-6', tenant_id: 't-1', composition_id: 'cmp-i1-2', ordem: 1, tipo: 'consumo_auxiliar', codigo: null, descricao: 'Desmoldante e materiais auxiliares (1% material)', unidade: 'vb', coeficiente: 1.0, preco_unitario: 5.30, observacao: null, created_at: '2026-01-15T10:00:00Z' },
    ],
  },
  // i1-4 — "Reboco interno argamassa traço 1:6 - m²"
  'i1-4': {
    summary: {
      id: 'cmp-i1-4', tenant_id: 't-1', contract_item_id: 'i1-4',
      codigo_composicao: '87529', fonte: 'SINAPI', data_base: '2026-01-01',
      observacao: 'Espessura média 2cm, paredes internas', created_at: '2026-02-10T11:00:00Z', updated_at: '2026-04-02T16:10:00Z',
      total_mao_obra: 25.20,
      total_material: 8.46,
      total_equipamento: 0,
      total_terceiros: 0,
      total_aux: 0,
      total_sem_bdi: 33.66,
      num_linhas: 4,
    },
    lines: [
      { id: 'cl-7',  tenant_id: 't-1', composition_id: 'cmp-i1-4', ordem: 1, tipo: 'mao_obra', codigo: '88309', descricao: 'Pedreiro com encargos complementares', unidade: 'h', coeficiente: 0.6, preco_unitario: 28.50, observacao: null, created_at: '2026-02-10T11:00:00Z' },
      { id: 'cl-8',  tenant_id: 't-1', composition_id: 'cmp-i1-4', ordem: 2, tipo: 'mao_obra', codigo: '88316', descricao: 'Servente com encargos complementares', unidade: 'h', coeficiente: 0.6, preco_unitario: 13.50, observacao: null, created_at: '2026-02-10T11:00:00Z' },
      { id: 'cl-9',  tenant_id: 't-1', composition_id: 'cmp-i1-4', ordem: 1, tipo: 'material', codigo: '00367', descricao: 'Areia média lavada', unidade: 'm³', coeficiente: 0.024, preco_unitario: 92.50, observacao: null, created_at: '2026-02-10T11:00:00Z' },
      { id: 'cl-10', tenant_id: 't-1', composition_id: 'cmp-i1-4', ordem: 2, tipo: 'material', codigo: '00368', descricao: 'Cimento Portland CP-II-Z-32', unidade: 'kg', coeficiente: 0.32, preco_unitario: 0.80, observacao: null, created_at: '2026-02-10T11:00:00Z' },
    ],
  },
};

export async function getContractItemComposition(itemId: string): Promise<ContractItemComposition | null> {
  if (SKIP_AUTH) {
    return MOCK_COMPOSITIONS[itemId] || null;
  }
  checkSupabase();
  const r = await supabase.rpc('get_contract_item_composition', { p_item_id: itemId });
  fail(r.error);
  return r.data as ContractItemComposition | null;
}

export async function applyCompositionPriceToItem(compositionId: string): Promise<{
  item_id: string;
  total_sem_bdi: number;
  bdi_percentual: number;
  preco_anterior: number;
  preco_novo: number;
}> {
  if (SKIP_AUTH) {
    // Demo: pega a composição pelo id e simula o cálculo
    const entry = Object.values(MOCK_COMPOSITIONS).find((c) => c.summary.id === compositionId);
    if (!entry) throw new Error('Composição não encontrada');
    const bdi = 24; // demo
    const novo = +(entry.summary.total_sem_bdi * (1 + bdi / 100)).toFixed(6);
    return {
      item_id: entry.summary.contract_item_id,
      total_sem_bdi: entry.summary.total_sem_bdi,
      bdi_percentual: bdi,
      preco_anterior: 845.20,
      preco_novo: novo,
    };
  }
  checkSupabase();
  const r = await supabase.rpc('apply_composition_price_to_item', { p_composition_id: compositionId });
  fail(r.error);
  return r.data as {
    item_id: string;
    total_sem_bdi: number;
    bdi_percentual: number;
    preco_anterior: number;
    preco_novo: number;
  };
}

/**
 * Item IDs (no demo) que têm composição. Em produção, ContractSheet pode
 * usar uma view ou um count para saber quais linhas têm o botão composição.
 */
export function hasComposition(itemId: string): boolean {
  if (SKIP_AUTH) return itemId in MOCK_COMPOSITIONS;
  // Em produção, frontend usa um endpoint dedicado ou flag na view de itens
  return false;
}

// =============================================================================
// V67 — Análise de divergência de preços (liga V57 + V64 + V66)
// =============================================================================

export type DivergenciaSeveridade = 'ok' | 'atencao' | 'alerta' | 'critico' | 'indeterminado';

export interface PriceDivergence {
  item_id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade_contratada: number;
  preco_atual: number;
  preco_calculado: number;
  divergencia_abs: number;
  divergencia_pct: number;
  severidade: DivergenciaSeveridade;
  impacto_financeiro: number;
  composition_id: string;
  codigo_composicao: string | null;
  fonte: string;
  data_base: string | null;
  bdi_percentual: number;
}

export const DIVERGENCIA_SEVERIDADE_LABELS: Record<DivergenciaSeveridade, string> = {
  ok:            'OK (≤ 2%)',
  atencao:       'Atenção (2–10%)',
  alerta:        'Alerta (10–25%)',
  critico:       'Crítico (> 25%)',
  indeterminado: 'Indeterminado',
};

export async function listContractPriceDivergences(
  contractId: string,
  severidades?: DivergenciaSeveridade[],
): Promise<PriceDivergence[]> {
  if (SKIP_AUTH) {
    // Mock derivado de MOCK_COMPOSITIONS — calcula divergência ao vivo
    const items: PriceDivergence[] = [];
    for (const [itemId, comp] of Object.entries(MOCK_COMPOSITIONS)) {
      const bdi = itemId === 'i1-2' ? 24 : itemId === 'i1-4' ? 24.5 : 0;
      const calc = +(comp.summary.total_sem_bdi * (1 + bdi / 100)).toFixed(6);
      // Preços atuais simulados (do MOCK_ITEMS — i1-2 = 845.20 era V64 history)
      const atual = itemId === 'i1-2' ? 845.20 : itemId === 'i1-4' ? 128.40 : 0;
      const qtd   = itemId === 'i1-2' ? 174    : itemId === 'i1-4' ? 980    : 0;
      const diff  = +(atual - calc).toFixed(6);
      const diffPct = calc > 0 ? +(diff * 100 / calc).toFixed(4) : 0;
      const sev: DivergenciaSeveridade = Math.abs(diffPct) <= 2 ? 'ok'
        : Math.abs(diffPct) <= 10 ? 'atencao'
        : Math.abs(diffPct) <= 25 ? 'alerta' : 'critico';
      items.push({
        item_id: itemId,
        codigo: itemId === 'i1-2' ? '02.001' : '03.012',
        descricao: itemId === 'i1-2' ? 'Concreto estrutural fck=30 MPa' : 'Reboco interno argamassa 1:6',
        unidade: itemId === 'i1-2' ? 'm³' : 'm²',
        quantidade_contratada: qtd,
        preco_atual: atual, preco_calculado: calc,
        divergencia_abs: diff, divergencia_pct: diffPct,
        severidade: sev,
        impacto_financeiro: +(diff * qtd).toFixed(4),
        composition_id: comp.summary.id,
        codigo_composicao: comp.summary.codigo_composicao,
        fonte: comp.summary.fonte,
        data_base: comp.summary.data_base,
        bdi_percentual: bdi,
      });
    }
    let filtered = items;
    if (severidades && severidades.length > 0) {
      filtered = items.filter((it) => severidades.includes(it.severidade));
    }
    return filtered.sort((a, b) => Math.abs(b.divergencia_pct) - Math.abs(a.divergencia_pct));
  }
  checkSupabase();
  const r = await supabase.rpc('list_contract_price_divergences', {
    p_contract_id: contractId,
    p_severidades: severidades || null,
  });
  fail(r.error);
  return (r.data || []) as PriceDivergence[];
}

// =============================================================================
// V67 — Helper para endpoints marcarem audit source
// =============================================================================
// Endpoints de SovImport/SovBulk chamam isso antes do bulk UPDATE para que
// o trigger V64 grave o source correto em audit_log.
// =============================================================================

export async function setAuditSource(source: 'sov_import' | 'sov_bulk' | 'sov_lock' | 'sov_unlock' | 'sov_edit'): Promise<void> {
  if (SKIP_AUTH) {
    // Em SKIP_AUTH, o trigger não dispara — só simula o caminho
    return;
  }
  checkSupabase();
  const r = await supabase.rpc('set_audit_source', { p_source: source });
  fail(r.error);
}

// =============================================================================
// V68 — Marca d'água "CÓPIA NÃO CONTROLADA"
// =============================================================================
// Migration 067 + Edge Function generate-watermarked-pdf.
// =============================================================================

export interface WatermarkSettings {
  tenant_id?: string;
  texto: string;
  texto_secundario: string | null;
  opacidade: number;        // 0.05-0.50
  angulo_graus: number;     // -90 a 90
  tamanho_fonte: number;    // 12-144
  cor_hex: string;          // #RRGGBB
  incluir_timestamp: boolean;
  incluir_fingerprint: boolean;
  icp_brasil_enabled: boolean;
  icp_brasil_signer_label: string | null;
}

const DEFAULT_WATERMARK: WatermarkSettings = {
  texto: 'CÓPIA NÃO CONTROLADA',
  texto_secundario: null,
  opacidade: 0.20,
  angulo_graus: 45,
  tamanho_fonte: 48,
  cor_hex: '#FF0000',
  incluir_timestamp: true,
  incluir_fingerprint: true,
  icp_brasil_enabled: false,
  icp_brasil_signer_label: null,
};

let MOCK_WATERMARK_SETTINGS: WatermarkSettings = { ...DEFAULT_WATERMARK };

export async function getGedWatermarkSettings(): Promise<WatermarkSettings> {
  if (SKIP_AUTH) return MOCK_WATERMARK_SETTINGS;
  checkSupabase();
  const r = await supabase.rpc('get_ged_watermark_settings');
  fail(r.error);
  return r.data as WatermarkSettings;
}

export async function upsertGedWatermarkSettings(s: Partial<WatermarkSettings>): Promise<WatermarkSettings> {
  if (SKIP_AUTH) {
    MOCK_WATERMARK_SETTINGS = { ...MOCK_WATERMARK_SETTINGS, ...s };
    return MOCK_WATERMARK_SETTINGS;
  }
  checkSupabase();
  const r = await supabase.rpc('upsert_ged_watermark_settings', { p_settings: s });
  fail(r.error);
  return r.data as WatermarkSettings;
}

export interface WatermarkLogEntry {
  id: string;
  version_id: string;
  version_revision: string | null;
  downloader_nome: string | null;
  downloader_email: string | null;
  recipient_label: string | null;
  fingerprint: string;
  icp_brasil_signed: boolean;
  created_at: string;
}

const MOCK_WATERMARK_LOG: Record<string, WatermarkLogEntry[]> = {
  'doc-1': [
    { id: 'wl-1', version_id: 'v3', version_revision: '3',
      downloader_nome: 'Patrícia Lopes', downloader_email: 'patricia@example.com',
      recipient_label: 'Para: Eng. João Silva (cliente XYZ)',
      fingerprint: 'A3F71C92B5D481E0', icp_brasil_signed: false,
      created_at: new Date(Date.now() - 86_400_000 * 2).toISOString() },
    { id: 'wl-2', version_id: 'v2', version_revision: '2',
      downloader_nome: 'Eduardo Vargas', downloader_email: 'eduardo@example.com',
      recipient_label: 'Para: Coordenação · revisão técnica',
      fingerprint: 'C8E14D7F92AA3601', icp_brasil_signed: false,
      created_at: new Date(Date.now() - 86_400_000 * 12).toISOString() },
  ],
};

export async function listGedWatermarkLog(documentId: string): Promise<WatermarkLogEntry[]> {
  if (SKIP_AUTH) return MOCK_WATERMARK_LOG[documentId] || [];
  checkSupabase();
  const r = await supabase.rpc('list_ged_watermark_log', { p_document_id: documentId });
  fail(r.error);
  return (r.data || []) as WatermarkLogEntry[];
}

/**
 * V68 — Chama Edge Function generate-watermarked-pdf, retorna Blob do PDF
 * + fingerprint do download.
 *
 * Em SKIP_AUTH, simula: cria um PDF dummy e gera fingerprint local. Útil
 * para demonstrar UI sem chamar EF real.
 */
export async function generateWatermarkedPdf(input: {
  version_id: string;
  recipient_label?: string;
  override_settings?: Partial<WatermarkSettings>;
}): Promise<{ blob: Blob; fingerprint: string }> {
  if (SKIP_AUTH) {
    // Simula: cria PDF minimal (1 página em branco)
    const dummy = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
      'xref\n0 4\n0000000000 65535 f\n' +
      'trailer<</Size 4/Root 1 0 R>>\nstartxref\n200\n%%EOF\n'
    );
    const fingerprint = (Math.random().toString(16).slice(2, 18) + '0000000000000000').slice(0, 16).toUpperCase();
    // Simula registro no log mock
    const entry: WatermarkLogEntry = {
      id: 'wl-' + Date.now(),
      version_id: input.version_id,
      version_revision: '3',
      downloader_nome: 'Você (demo)',
      downloader_email: 'demo@example.com',
      recipient_label: input.recipient_label || null,
      fingerprint,
      icp_brasil_signed: !!input.override_settings?.icp_brasil_enabled,
      created_at: new Date().toISOString(),
    };
    if (!MOCK_WATERMARK_LOG['doc-1']) MOCK_WATERMARK_LOG['doc-1'] = [];
    MOCK_WATERMARK_LOG['doc-1'].unshift(entry);
    return { blob: new Blob([dummy], { type: 'application/pdf' }), fingerprint };
  }

  checkSupabase();
  const { data, error } = await supabase.functions.invoke('generate-watermarked-pdf', {
    body: input,
  });
  fail(error);
  const blob = data instanceof Blob ? data : new Blob([data as ArrayBuffer], { type: 'application/pdf' });
  // Fingerprint não vem via invoke (só headers), gera placeholder
  const fingerprint = 'DOWNLOADED-' + Date.now().toString(36).toUpperCase();
  return { blob, fingerprint };
}

// =============================================================================
// V69 — Edição inline de composição de preço
// =============================================================================

export interface CompositionLineDraft {
  ordem: number;
  tipo: CompositionLineTipo;
  codigo: string | null;
  descricao: string;
  unidade: string;
  coeficiente: number;
  preco_unitario: number;
  observacao: string | null;
}

export async function replaceCompositionLines(
  compositionId: string,
  lines: CompositionLineDraft[],
): Promise<{ composition_id: string; lines_count: number }> {
  if (SKIP_AUTH) {
    // Atualiza mock in-memory
    const entry = Object.values(MOCK_COMPOSITIONS).find((c) => c.summary.id === compositionId);
    if (!entry) throw new Error('Composição não encontrada');
    const updated: CompositionLine[] = lines.map((l, i) => ({
      id: 'cl-' + Date.now() + '-' + i,
      tenant_id: entry.summary.tenant_id,
      composition_id: compositionId,
      ordem: l.ordem,
      tipo: l.tipo,
      codigo: l.codigo,
      descricao: l.descricao,
      unidade: l.unidade,
      coeficiente: l.coeficiente,
      preco_unitario: l.preco_unitario,
      observacao: l.observacao,
      created_at: new Date().toISOString(),
    }));
    entry.lines = updated;
    // Recalcula totais
    const byTipo = (t: CompositionLineTipo) =>
      updated.filter((x) => x.tipo === t).reduce((a, b) => a + b.coeficiente * b.preco_unitario, 0);
    entry.summary.total_mao_obra    = byTipo('mao_obra');
    entry.summary.total_material    = byTipo('material');
    entry.summary.total_equipamento = byTipo('equipamento');
    entry.summary.total_terceiros   = byTipo('servico_terceiro');
    entry.summary.total_aux         = byTipo('consumo_auxiliar');
    entry.summary.total_sem_bdi     = updated.reduce((a, b) => a + b.coeficiente * b.preco_unitario, 0);
    entry.summary.num_linhas        = updated.length;
    entry.summary.updated_at        = new Date().toISOString();
    return { composition_id: compositionId, lines_count: updated.length };
  }
  checkSupabase();
  const r = await supabase.rpc('replace_composition_lines', {
    p_composition_id: compositionId, p_lines: lines,
  });
  fail(r.error);
  return r.data as { composition_id: string; lines_count: number };
}

// =============================================================================
// V72 — Comparação composição vs proposta concorrente
// =============================================================================

export interface CompetitorComparison {
  contract_item_id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  preco_proprio: number;
  proprio_sem_bdi: number | null;
  composition_id: string | null;
  competitor_id: string;
  competitor_name: string;
  competitor_cnpj: string | null;
  preco_competitor: number;
  data_proposta: string | null;
  origem: 'manual' | 'licitacao_publica' | 'sirhad' | 'outro';
  diff_abs: number;
  diff_pct: number;
}

const MOCK_COMPETITOR: CompetitorComparison[] = [
  // i1-2: próprio 845.20; 2 concorrentes
  { contract_item_id: 'i1-2', codigo: '02.001', descricao: 'Concreto estrutural fck=30 MPa',
    unidade: 'm³', preco_proprio: 845.20, proprio_sem_bdi: 577.70, composition_id: 'cmp-i1-2',
    competitor_id: 'comp-1', competitor_name: 'Construtora Alfa LTDA', competitor_cnpj: '12.345.678/0001-00',
    preco_competitor: 698.00, data_proposta: '2026-03-15', origem: 'licitacao_publica',
    diff_abs: -147.20, diff_pct: -17.41 },
  { contract_item_id: 'i1-2', codigo: '02.001', descricao: 'Concreto estrutural fck=30 MPa',
    unidade: 'm³', preco_proprio: 845.20, proprio_sem_bdi: 577.70, composition_id: 'cmp-i1-2',
    competitor_id: 'comp-2', competitor_name: 'Empresa Beta Engenharia', competitor_cnpj: '98.765.432/0001-11',
    preco_competitor: 742.50, data_proposta: '2026-03-18', origem: 'licitacao_publica',
    diff_abs: -102.70, diff_pct: -12.15 },
  // i1-4: próprio 128.40; 1 concorrente
  { contract_item_id: 'i1-4', codigo: '03.012', descricao: 'Reboco interno argamassa 1:6',
    unidade: 'm²', preco_proprio: 128.40, proprio_sem_bdi: 33.66, composition_id: 'cmp-i1-4',
    competitor_id: 'comp-3', competitor_name: 'Construtora Alfa LTDA', competitor_cnpj: '12.345.678/0001-00',
    preco_competitor: 145.00, data_proposta: '2026-03-15', origem: 'licitacao_publica',
    diff_abs: 16.60, diff_pct: 12.93 },
];

export async function listContractCompetitorComparison(contractId: string): Promise<CompetitorComparison[]> {
  if (SKIP_AUTH) return MOCK_COMPETITOR;
  checkSupabase();
  const r = await supabase.rpc('list_contract_competitor_comparison', { p_contract_id: contractId });
  fail(r.error);
  return (r.data || []) as CompetitorComparison[];
}

export async function upsertCompetitorPrice(input: {
  id?: string;
  contract_item_id: string;
  competitor_name: string;
  competitor_cnpj?: string;
  preco_unitario: number;
  data_proposta?: string;
  origem?: 'manual' | 'licitacao_publica' | 'sirhad' | 'outro';
  observacao?: string;
}): Promise<void> {
  if (SKIP_AUTH) {
    // Demo: ignora
    return;
  }
  checkSupabase();
  const r = await supabase.from('contract_item_competitor_prices').upsert({
    id: input.id,
    contract_item_id: input.contract_item_id,
    competitor_name: input.competitor_name,
    competitor_cnpj: input.competitor_cnpj || null,
    preco_unitario: input.preco_unitario,
    data_proposta: input.data_proposta || null,
    origem: input.origem || 'manual',
    observacao: input.observacao || null,
  });
  fail(r.error);
}
