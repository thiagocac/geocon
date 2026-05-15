/**
 * generate-labels-pdf — gera etiquetas A4 para impressão de documentos GED
 * (até 48 etiquetas por requisição, grid 3 colunas × 8 linhas).
 *
 * Body: { document_ids: uuid[] }
 * Output: PDF binário com Content-Disposition: attachment
 */
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1';

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { getUserClient } from '../_shared/client.ts';
import { fail, unauthorized, serverError } from '../_shared/response.ts';

const NAVY   = rgb(0.094, 0.157, 0.388);
const MAGENTA = rgb(0.773, 0.067, 0.494);
const SLATE  = rgb(0.475, 0.514, 0.561);
const BLACK  = rgb(0.078, 0.094, 0.157);

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 28;
const COLS = 3;
const ROWS = 8;
const PER_PAGE = COLS * ROWS;
const LABEL_W = (A4_W - 2 * MARGIN) / COLS;
const LABEL_H = (A4_H - 2 * MARGIN) / ROWS;

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const s = iso.slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function wrap(text: string, max: number): string[] {
  const words = (text || '').split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const userClient = getUserClient(req);
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return unauthorized();

    const body = await req.json().catch(() => ({}));
    const docIds: string[] = Array.isArray(body.document_ids) ? body.document_ids.map((x: unknown) => String(x)) : [];
    if (docIds.length === 0) return fail('document_ids é obrigatório (array)');
    if (docIds.length > 48) return fail('Máximo de 48 etiquetas por requisição');

    // Busca documentos com sua versão mais recente
    const { data: docs, error: dErr } = await userClient
      .from('ged_documents')
      .select('id, title, nomenclature_code, status, created_at, ged_categories(codigo,nome), ged_document_versions(numero,created_at)')
      .in('id', docIds);
    if (dErr) return fail(dErr.message || 'Falha ao buscar documentos', 400);
    if (!docs || docs.length === 0) return fail('Documentos não encontrados', 404);

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const fontMono = await pdf.embedFont(StandardFonts.Courier);

    let page = pdf.addPage([A4_W, A4_H]);
    let idx = 0;

    for (const d of docs) {
      if (idx > 0 && idx % PER_PAGE === 0) {
        page = pdf.addPage([A4_W, A4_H]);
      }
      const slotInPage = idx % PER_PAGE;
      const col = slotInPage % COLS;
      const row = Math.floor(slotInPage / COLS);
      const x = MARGIN + col * LABEL_W;
      const y = A4_H - MARGIN - (row + 1) * LABEL_H;

      // Borda
      page.drawRectangle({
        x: x + 2, y: y + 2,
        width: LABEL_W - 4, height: LABEL_H - 4,
        borderColor: SLATE, borderWidth: 0.5,
      });

      // Faixa superior
      page.drawRectangle({
        x: x + 2, y: y + LABEL_H - 18,
        width: LABEL_W - 4, height: 16,
        color: NAVY,
      });
      page.drawText('geoCon · GED', {
        x: x + 8, y: y + LABEL_H - 14,
        size: 8, font: fontBold, color: rgb(1, 1, 1),
      });

      // Nomenclature code (mono, magenta accent)
      const nom = d.nomenclature_code || '—';
      page.drawText(nom, {
        x: x + 8, y: y + LABEL_H - 38,
        size: 11, font: fontMono, color: MAGENTA,
      });

      // Título (até 2 linhas)
      const titleLines = wrap(d.title || '—', 28).slice(0, 2);
      let ty = y + LABEL_H - 56;
      for (const line of titleLines) {
        page.drawText(line, { x: x + 8, y: ty, size: 9, font: fontBold, color: BLACK });
        ty -= 11;
      }

      // Metadados
      const lastVer = Array.isArray(d.ged_document_versions) && d.ged_document_versions.length > 0
        ? d.ged_document_versions[d.ged_document_versions.length - 1] : null;
      // deno-lint-ignore no-explicit-any
      const cat: any = (d as any).ged_categories;
      const meta = [
        ['Categoria', cat ? `${cat.codigo} — ${cat.nome}` : '—'],
        ['Revisão',   lastVer ? String(lastVer.numero) : '—'],
        ['Data',      fmtDate(d.created_at)],
        ['Status',    d.status || '—'],
      ];
      let my = y + 28;
      for (const [k, v] of meta) {
        page.drawText(k + ':', { x: x + 8, y: my, size: 7, font: fontBold, color: SLATE });
        page.drawText(String(v).slice(0, 28), { x: x + 48, y: my, size: 7, font, color: BLACK });
        my -= 9;
      }
      idx++;
    }

    const bytes = await pdf.save();
    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="etiquetas-ged-${new Date().toISOString().slice(0,10)}.pdf"`,
      },
    });
  } catch (e) {
    return serverError(e);
  }
});
