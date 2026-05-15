/**
 * generate-report — relatórios operacionais consolidados.
 *
 * Body: { variant: 'carteira'|'pendencias'|'curva_s'|'glosas'|'top_glosas'|'health',
 *         format?: 'json'|'csv', contract_id?: uuid }
 *
 * Output JSON: { ok, meta: { variant, total_rows, generated_at }, data: [...] }
 * Output CSV : text/csv com BOM UTF-8 (Excel-compatível) + Content-Disposition
 */
import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { getUserClient } from '../_shared/client.ts';
import { ok, fail, unauthorized, serverError } from '../_shared/response.ts';

type Variant = 'carteira' | 'pendencias' | 'curva_s' | 'glosas' | 'top_glosas' | 'health';

const VIEW_FOR: Record<Variant, { view: string; filter?: 'contract_id' | null }> = {
  carteira:   { view: 'v_report_portfolio', filter: 'contract_id' },
  pendencias: { view: 'v_report_pendencies', filter: 'contract_id' },
  curva_s:    { view: 'v_report_curva_s', filter: 'contract_id' },
  glosas:     { view: 'v_report_glosses', filter: 'contract_id' },
  top_glosas: { view: 'v_report_glosses', filter: 'contract_id' },
  health:     { view: 'v_report_portfolio', filter: 'contract_id' },
};

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const head = cols.join(',');
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n');
  return '\uFEFF' + head + '\n' + body;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const userClient = getUserClient(req);
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return unauthorized();

    const body = await req.json().catch(() => ({}));
    const variant = String(body.variant || '') as Variant;
    const format = (body.format === 'csv' ? 'csv' : 'json') as 'json' | 'csv';
    const contractId = body.contract_id ? String(body.contract_id) : null;

    if (!VIEW_FOR[variant]) return fail(`variant inválida (use ${Object.keys(VIEW_FOR).join(', ')})`);

    const cfg = VIEW_FOR[variant];
    let q = userClient.from(cfg.view).select('*');
    if (contractId && cfg.filter) q = q.eq(cfg.filter, contractId);

    // top_glosas: ordena por valor desc, limita a 50
    if (variant === 'top_glosas') q = q.order('valor_glosado', { ascending: false }).limit(50);

    // health: só linhas com risk_flags não vazia
    if (variant === 'health') q = q.not('risk_flags', 'eq', '[]');

    const { data: rows, error } = await q;
    if (error) return fail(error.message || 'Falha ao consultar relatório', 400);

    const data = (rows || []) as Record<string, unknown>[];

    if (format === 'csv') {
      const csv = toCsv(data);
      return new Response(csv, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${variant}-${new Date().toISOString().slice(0,10)}.csv"`,
        },
      });
    }

    return ok({
      meta: {
        variant,
        total_rows: data.length,
        generated_at: new Date().toISOString(),
        contract_id: contractId,
      },
      data,
    });
  } catch (e) {
    return serverError(e);
  }
});
