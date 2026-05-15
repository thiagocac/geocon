/**
 * import-spreadsheet — importa planilha contratual (SOV) a partir de um
 * arquivo Excel/CSV em base64. Espera colunas:
 *   codigo | descricao | unidade | quantidade | preco_unitario [| disciplina | bdi | fonte_referencia]
 *
 * Recusa importação quando há medições emitidas (a SOV está travada).
 */
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';

import { handleCors } from '../_shared/cors.ts';
import { getServiceClient, getUserClient } from '../_shared/client.ts';
import { ok, fail, unauthorized, serverError } from '../_shared/response.ts';

interface SheetRow {
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  preco_unitario: number;
  disciplina?: string;
  bdi?: number;
  fonte_referencia?: string;
}

function normalizeKey(k: string): string {
  return k.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function rowFromRaw(raw: Record<string, unknown>): SheetRow | null {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) r[normalizeKey(k)] = v;

  const codigo = String(r.codigo ?? r.code ?? r.item ?? '').trim();
  const descricao = String(r.descricao ?? r.description ?? r.servico ?? '').trim();
  const unidade = String(r.unidade ?? r.un ?? r.unit ?? '').trim();
  const qtd = Number(r.quantidade ?? r.qtd ?? r.quantity ?? 0);
  const preco = Number(r.preco_unitario ?? r.preco ?? r.unit_price ?? r.valor_unitario ?? 0);

  if (!codigo || !descricao || !unidade) return null;
  if (!Number.isFinite(qtd) || qtd < 0) return null;
  if (!Number.isFinite(preco) || preco < 0) return null;

  return {
    codigo, descricao, unidade,
    quantidade: qtd, preco_unitario: preco,
    disciplina: r.disciplina ? String(r.disciplina) : undefined,
    bdi: r.bdi !== undefined ? Number(r.bdi) : undefined,
    fonte_referencia: r.fonte_referencia ? String(r.fonte_referencia) : 'proprio',
  };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const userClient = getUserClient(req);
    const { data: userResult, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userResult?.user) return unauthorized('JWT inválido');

    const body = await req.json();
    const contractId = body.contract_id as string;
    const fileB64 = body.file_base64 as string;
    const format = (body.format as string) || 'xlsx';

    if (!contractId || !fileB64) return fail('contract_id e file_base64 são obrigatórios');

    const svc = getServiceClient();

    // Verifica se há medições emitidas (SOV travada)
    const { data: emit } = await svc
      .from('measurements')
      .select('id', { count: 'exact', head: false })
      .eq('contract_id', contractId)
      .in('status', ['emitida', 'aprovada', 'paga'])
      .limit(1);
    if (emit && emit.length > 0) {
      return fail('Planilha travada — há medições emitidas. Use aditivo para alterar itens.', 409);
    }

    // Decodifica arquivo
    const bin = atob(fileB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const wb = XLSX.read(bytes, { type: 'array', cellDates: false });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true }) as Record<string, unknown>[];

    const rows: SheetRow[] = [];
    const errors: Array<{ index: number; reason: string }> = [];
    raw.forEach((r, i) => {
      const parsed = rowFromRaw(r);
      if (!parsed) errors.push({ index: i + 2, reason: 'Linha incompleta ou inválida' });
      else rows.push(parsed);
    });

    if (rows.length === 0) {
      return fail('Nenhuma linha válida encontrada', 422, { errors });
    }

    // Carrega disciplinas existentes para resolver ID por nome
    const { data: tenantData } = await svc.from('contracts').select('tenant_id').eq('id', contractId).maybeSingle();
    const tenantId = tenantData?.tenant_id;

    const { data: disciplines } = await svc
      .from('disciplines')
      .select('id,nome')
      .eq('tenant_id', tenantId);
    const discMap = new Map((disciplines || []).map((d) => [d.nome.toLowerCase(), d.id]));

    // Insert em lote
    const payload = rows.map((r) => ({
      tenant_id: tenantId,
      contract_id: contractId,
      codigo: r.codigo,
      descricao: r.descricao,
      unidade: r.unidade,
      quantidade_contratada: r.quantidade,
      preco_unitario: r.preco_unitario,
      bdi: r.bdi ?? 0,
      fonte_referencia: r.fonte_referencia || 'proprio',
      discipline_id: r.disciplina ? discMap.get(r.disciplina.toLowerCase()) || null : null,
      created_by: userResult.user.id,
    }));

    const { data: inserted, error: insErr } = await svc
      .from('contract_items')
      .insert(payload)
      .select('id');

    if (insErr) throw insErr;

    return ok({
      imported: inserted?.length || 0,
      errors,
      format,
      contract_id: contractId,
    });
  } catch (e) {
    return serverError(e);
  }
});
