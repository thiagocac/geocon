/**
 * download-economic-indices — pull mensal automático de séries do IBGE.
 *
 * Fontes suportadas:
 *   - IBGE/SIDRA: IPCA (série 1737) e IPCA-15 (série 7060) via API pública
 *     https://servicodados.ibge.gov.br/api/v3/agregados/{tabela}/...
 *   - FGV (INCC, IGP-M): NÃO suportada — FGV não expõe API pública gratuita.
 *     Admins continuam usando CSV manual ou paid feed.
 *
 * Body opcional: { dry_run?: bool, tenant_id?: uuid, codigo?: string, months_back?: int }
 *   - dry_run: busca dados mas não persiste
 *   - tenant_id: limita a um tenant
 *   - codigo: limita a um índice ('IPCA' ou 'IPCA-15')
 *   - months_back: quantos meses pra trás buscar (default 3, max 24)
 *
 * Idempotência: usa upsert_index_value_external (V48) — mesmo valor não atualiza.
 *
 * Cada par (tenant × índice) gera 1 entrada em adjustment_index_fetch_log com
 * status (success/partial/failed/skipped) e contagens.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, serverError } from '../_shared/response.ts';

const DEFAULT_MONTHS_BACK = 3;
const MAX_MONTHS_BACK     = 24;

interface TenantIndex {
  tenant_id: string;
  index_codigo: string;
  ibge_serie: string | null;
}

interface IbgeRow {
  reference_month: string;  // YYYY-MM-01
  index_value: number;
}

/**
 * Constrói período YYYYMM/YYYYMM para a API SIDRA.
 * IBGE espera formato 202301-202312 para janela mensal.
 */
function buildPeriod(monthsBack: number): string {
  const now = new Date();
  // Buscamos do mês (M-monthsBack) até o último mês fechado (M-1)
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (monthsBack - 1), 1));
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${fmt(start)}-${fmt(end)}`;
}

/**
 * Chama API SIDRA do IBGE para uma série.
 *
 * Endpoint usado:
 *   https://apisidra.ibge.gov.br/values/t/{tabela}/p/{periodo}/v/{variavel}/n1/all
 *
 * Tabela 1737 = IPCA mensal, variável 2266 = Número-índice (dez/93=100)
 * Tabela 7060 = IPCA-15, variável 1119 = Número-índice
 */
async function fetchIbgeSeries(codigo: string, monthsBack: number): Promise<IbgeRow[]> {
  let tabela: string;
  let variavel: string;
  if (codigo === 'IPCA') {
    tabela = '1737';
    variavel = '2266';
  } else if (codigo === 'IPCA-15') {
    tabela = '7060';
    variavel = '1119';
  } else {
    throw new Error(`Código IBGE não suportado: ${codigo}`);
  }

  const periodo = buildPeriod(monthsBack);
  const url = `https://apisidra.ibge.gov.br/values/t/${tabela}/p/${periodo}/v/${variavel}/n1/all`;

  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`IBGE API ${tabela}/${periodo} retornou ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();

  // SIDRA retorna array onde [0] é header e [1..] são linhas
  // Cada linha tem: { "D2C": "201912", "V": "5320.25" } (entre outros campos)
  if (!Array.isArray(json) || json.length < 2) {
    throw new Error(`IBGE retornou payload inesperado: ${JSON.stringify(json).slice(0, 200)}`);
  }

  const rows: IbgeRow[] = [];
  for (let i = 1; i < json.length; i++) {
    const r = json[i] as Record<string, string>;
    const periodoStr = r['D2C'];   // YYYYMM
    const valor       = r['V'];    // string numérica
    if (!periodoStr || !valor || valor === '...' || valor === '-') continue;

    const y = periodoStr.slice(0, 4);
    const m = periodoStr.slice(4, 6);
    const value = parseFloat(valor.replace(',', '.'));
    if (!isFinite(value) || value <= 0) continue;

    rows.push({
      reference_month: `${y}-${m}-01`,
      index_value: value,
    });
  }
  return rows;
}

interface DispatchResult {
  tenant_id: string;
  index_codigo: string;
  source: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  rows_inserted: number;
  rows_updated: number;
  rows_skipped: number;
  rows_unchanged: number;
  error_message?: string;
  reference_month_from?: string;
  reference_month_to?: string;
}

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const svc = getServiceClient();

    let body: { dry_run?: boolean; tenant_id?: string; codigo?: string; months_back?: number } = {};
    try {
      const text = await req.text();
      body = text ? JSON.parse(text) : {};
    } catch {}

    const monthsBack = Math.max(1, Math.min(body.months_back || DEFAULT_MONTHS_BACK, MAX_MONTHS_BACK));

    // Resolve targets
    const { data: targetsRaw, error: tErr } = await svc.rpc('list_tenants_with_ibge_indices');
    if (tErr) return serverError(tErr.message);
    let targets = (targetsRaw || []) as TenantIndex[];

    if (body.tenant_id) targets = targets.filter((t) => t.tenant_id === body.tenant_id);
    if (body.codigo)    targets = targets.filter((t) => t.index_codigo === body.codigo);
    targets = targets.filter((t) => !!t.ibge_serie);

    if (targets.length === 0) {
      return ok({
        dispatched: 0,
        message: 'Nenhum tenant com índices IBGE configurados encontrado',
        filters: body,
      });
    }

    // Cache de dados IBGE por código (uma chamada serve N tenants)
    const cache = new Map<string, IbgeRow[] | { error: string }>();

    const results: DispatchResult[] = [];

    for (const t of targets) {
      let rows: IbgeRow[];
      let cached = cache.get(t.index_codigo);
      if (!cached) {
        try {
          rows = await fetchIbgeSeries(t.index_codigo, monthsBack);
          cache.set(t.index_codigo, rows);
        } catch (e) {
          const err = (e as Error).message;
          cache.set(t.index_codigo, { error: err });
          const result: DispatchResult = {
            tenant_id: t.tenant_id,
            index_codigo: t.index_codigo,
            source: 'ibge-api',
            status: 'failed',
            rows_inserted: 0,
            rows_updated: 0,
            rows_skipped: 0,
            rows_unchanged: 0,
            error_message: err,
          };
          results.push(result);
          if (!body.dry_run) {
            await svc.rpc('record_fetch_log_entry', {
              p_tenant_id: t.tenant_id,
              p_index_codigo: t.index_codigo,
              p_source: 'ibge-api',
              p_status: 'failed',
              p_rows_inserted: 0,
              p_rows_updated: 0,
              p_rows_skipped: 0,
              p_error_message: err,
              p_metadata: { ibge_serie: t.ibge_serie },
            });
          }
          continue;
        }
      } else if ('error' in cached) {
        // Falha anterior pra este código, propaga
        const result: DispatchResult = {
          tenant_id: t.tenant_id,
          index_codigo: t.index_codigo,
          source: 'ibge-api',
          status: 'failed',
          rows_inserted: 0, rows_updated: 0, rows_skipped: 0, rows_unchanged: 0,
          error_message: cached.error,
        };
        results.push(result);
        continue;
      } else {
        rows = cached;
      }

      // Persiste cada linha
      let inserted = 0, updated = 0, unchanged = 0, skipped = 0;
      let firstMonth: string | undefined;
      let lastMonth: string | undefined;

      for (const r of rows) {
        if (!firstMonth || r.reference_month < firstMonth) firstMonth = r.reference_month;
        if (!lastMonth  || r.reference_month > lastMonth)  lastMonth = r.reference_month;

        if (body.dry_run) {
          inserted++;
          continue;
        }

        try {
          const { data: upRes, error: upErr } = await svc.rpc('upsert_index_value_external', {
            p_tenant_id:       t.tenant_id,
            p_index_codigo:    t.index_codigo,
            p_reference_month: r.reference_month,
            p_index_value:     r.index_value,
            p_source:          'ibge-api',
            p_published_at:    new Date().toISOString(),
          });
          if (upErr) {
            skipped++;
            console.error(`[download-economic-indices] upsert error tenant=${t.tenant_id} idx=${t.index_codigo}:`, upErr.message);
            continue;
          }
          const action = (upRes as any)?.action;
          if (action === 'inserted')      inserted++;
          else if (action === 'updated')  updated++;
          else if (action === 'unchanged') unchanged++;
          else                             skipped++;
        } catch (e) {
          skipped++;
          console.error(`[download-economic-indices] exception:`, e);
        }
      }

      const status: DispatchResult['status'] =
        rows.length === 0 ? 'skipped' :
        skipped > 0 && (inserted + updated) === 0 ? 'failed' :
        skipped > 0 ? 'partial' :
                      'success';

      const result: DispatchResult = {
        tenant_id: t.tenant_id,
        index_codigo: t.index_codigo,
        source: 'ibge-api',
        status,
        rows_inserted: inserted,
        rows_updated: updated,
        rows_skipped: skipped,
        rows_unchanged: unchanged,
        reference_month_from: firstMonth,
        reference_month_to: lastMonth,
      };
      results.push(result);

      if (!body.dry_run) {
        await svc.rpc('record_fetch_log_entry', {
          p_tenant_id: t.tenant_id,
          p_index_codigo: t.index_codigo,
          p_source: 'ibge-api',
          p_status: status,
          p_rows_inserted: inserted,
          p_rows_updated: updated,
          p_rows_skipped: skipped,
          p_metadata: {
            ibge_serie: t.ibge_serie,
            months_back: monthsBack,
            rows_unchanged: unchanged,
          },
          p_reference_month_from: firstMonth || null,
          p_reference_month_to:   lastMonth  || null,
        });
      }
    }

    return ok({
      dispatched: results.length,
      results,
      dry_run: body.dry_run === true,
      months_back: monthsBack,
    });
  } catch (e) {
    return serverError(e);
  }
});
