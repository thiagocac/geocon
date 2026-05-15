/**
 * issue-grd-pdf — gera o PDF de uma Guia de Remessa de Documentos (GRD).
 *
 * Input: { transmittal_id: uuid }
 * Output: { storage_path, public_validation_code, validation_url, size_bytes }
 *
 * Renderiza:
 *   - Cabeçalho com partes (sender/recipient), número GRD e datas
 *   - Tabela de documentos enviados (nomenclatura, título, revisão, finalidade)
 *   - Checklist para confirmação de recebimento
 *   - QR code para validação pública
 */
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from 'https://esm.sh/pdf-lib@1.17.1';
import { encode as encodeQR } from 'https://esm.sh/qr@0.4.0';

import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, notFound, serverError } from '../_shared/response.ts';

const NAVY    = rgb(0.094, 0.157, 0.388);
const PURPLE  = rgb(0.243, 0.176, 0.443);
const MAGENTA = rgb(0.773, 0.067, 0.494);
const SLATE   = rgb(0.475, 0.514, 0.561);
const BLACK   = rgb(0.078, 0.094, 0.157);
const LIGHT   = rgb(0.960, 0.965, 0.973);

const SITE_URL = Deno.env.get('SITE_URL') || 'https://contratos.consultegeo.org';
const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 30;

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const s = iso.slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function wrapText(text: string, maxChars: number): string[] {
  const words = (text || '').split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const transmittalId = body.transmittal_id as string;
    if (!transmittalId) return fail('transmittal_id obrigatório');

    const svc = getServiceClient();

    // Busca GRD com agregações
    const { data: grd, error: grdErr } = await svc
      .from('ged_transmittals')
      .select(`*,
        contracts(id, numero, titulo, objeto,
          contratante:contract_organizations!contracts_contratante_id_fkey(nome, cnpj),
          contratada:contract_organizations!contracts_contratada_id_fkey(nome, cnpj),
          tenants(nome, brand_logo_url)
        ),
        recipient:contract_organizations!ged_transmittals_recipient_organization_id_fkey(nome, cnpj),
        sender:members!ged_transmittals_sender_id_fkey(nome, email)
      `)
      .eq('id', transmittalId)
      .maybeSingle();

    if (grdErr || !grd) return notFound('GRD não encontrada');

    // Documentos vinculados
    const { data: tdocs = [] } = await svc
      .from('ged_transmittal_documents')
      .select(`*,
        ged_document_versions(id, revision, file_size, mime_type, hash_sha256,
          ged_documents(id, title, numero, nomenclature_code,
            ged_categories(codigo, nome)
          )
        )
      `)
      .eq('transmittal_id', transmittalId)
      .is('deleted_at', null);

    // PDF setup
    const pdfDoc = await PDFDocument.create();
    const fontRegular: PDFFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold:    PDFFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Validation code
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const code = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

    let page = pdfDoc.addPage([A4.w, A4.h]);

    // Header bar
    page.drawRectangle({ x: 0, y: A4.h - 60, width: A4.w * 0.35, height: 60, color: NAVY });
    page.drawRectangle({ x: A4.w * 0.35, y: A4.h - 60, width: A4.w * 0.3, height: 60, color: PURPLE });
    page.drawRectangle({ x: A4.w * 0.65, y: A4.h - 60, width: A4.w * 0.35, height: 60, color: MAGENTA });

    page.drawText('geoCon', { x: MARGIN, y: A4.h - 35, font: fontBold, size: 22, color: rgb(1, 1, 1) });
    page.drawText('Consulte GEO · Gestão de Contratos', { x: MARGIN, y: A4.h - 52, font: fontRegular, size: 8, color: rgb(1, 1, 1) });
    page.drawText(grd.contracts?.tenants?.nome || '', { x: A4.w - 230, y: A4.h - 35, font: fontBold, size: 10, color: rgb(1, 1, 1) });

    page.drawText('GUIA DE REMESSA DE DOCUMENTOS', { x: MARGIN, y: A4.h - 88, font: fontBold, size: 14, color: BLACK });
    page.drawText(`Nº ${grd.numero} · Contrato ${grd.contracts?.numero || '—'}`, {
      x: MARGIN, y: A4.h - 104, font: fontRegular, size: 10, color: SLATE,
    });

    // Cabeçalho com partes
    let y = A4.h - 140;
    const cellH = 40;
    const cells: Array<[string, string]> = [
      ['Data de emissão', fmtDate(grd.created_at)],
      ['Data de envio',   fmtDate(grd.sent_at)],
      ['Status',          (grd.status || '').toUpperCase()],
      ['Total de documentos', String(tdocs.length)],
    ];
    const colW = (A4.w - MARGIN * 2) / 4;
    for (let i = 0; i < cells.length; i++) {
      const x = MARGIN + i * colW;
      page.drawRectangle({ x, y: y - cellH + 4, width: colW - 2, height: cellH - 2, borderColor: SLATE, borderWidth: 0.4, color: LIGHT });
      page.drawText(cells[i][0], { x: x + 6, y: y - 12, font: fontBold, size: 7, color: SLATE });
      page.drawText(cells[i][1], { x: x + 6, y: y - 28, font: fontRegular, size: 10, color: BLACK });
    }

    y -= cellH + 10;
    page.drawText('REMETENTE', { x: MARGIN, y, font: fontBold, size: 7, color: NAVY });
    page.drawText(`${grd.sender?.nome || '—'} · ${grd.sender?.email || '—'}`, {
      x: MARGIN, y: y - 12, font: fontRegular, size: 9, color: BLACK,
    });
    page.drawText(`Em nome de ${grd.contracts?.contratante?.nome || '—'} (CNPJ ${grd.contracts?.contratante?.cnpj || '—'})`, {
      x: MARGIN, y: y - 24, font: fontRegular, size: 8, color: SLATE,
    });

    y -= 44;
    page.drawText('DESTINATÁRIO', { x: MARGIN, y, font: fontBold, size: 7, color: NAVY });
    page.drawText(grd.recipient?.nome || '—', { x: MARGIN, y: y - 12, font: fontRegular, size: 9, color: BLACK });
    page.drawText(`CNPJ ${grd.recipient?.cnpj || '—'}`, { x: MARGIN, y: y - 24, font: fontRegular, size: 8, color: SLATE });

    y -= 40;
    if (grd.title) {
      page.drawText('ASSUNTO', { x: MARGIN, y, font: fontBold, size: 7, color: NAVY });
      const titleLines = wrapText(grd.title, 95);
      for (let i = 0; i < Math.min(titleLines.length, 2); i++) {
        page.drawText(titleLines[i], { x: MARGIN, y: y - 12 - i * 11, font: fontRegular, size: 9, color: BLACK });
      }
      y -= 12 + titleLines.length * 11;
    }

    // Tabela de documentos
    y -= 10;
    page.drawRectangle({ x: MARGIN, y: y - 4, width: A4.w - MARGIN * 2, height: 16, color: NAVY });
    page.drawText('#',           { x: MARGIN + 4,  y: y + 2, font: fontBold, size: 7, color: rgb(1, 1, 1) });
    page.drawText('Nomenclatura/Código', { x: MARGIN + 24, y: y + 2, font: fontBold, size: 7, color: rgb(1, 1, 1) });
    page.drawText('Título',      { x: 200, y: y + 2, font: fontBold, size: 7, color: rgb(1, 1, 1) });
    page.drawText('Rev.',        { x: 400, y: y + 2, font: fontBold, size: 7, color: rgb(1, 1, 1) });
    page.drawText('Finalidade',  { x: 430, y: y + 2, font: fontBold, size: 7, color: rgb(1, 1, 1) });
    page.drawText('☐ Recebido',  { x: 510, y: y + 2, font: fontBold, size: 7, color: rgb(1, 1, 1) });
    y -= 18;

    for (let i = 0; i < tdocs.length; i++) {
      const td = tdocs[i];
      const v = td.ged_document_versions;
      const d = v?.ged_documents;
      if (y < 100) {
        page = pdfDoc.addPage([A4.w, A4.h]);
        y = A4.h - 50;
      }
      // Linha alternada
      if (i % 2 === 0) {
        page.drawRectangle({ x: MARGIN, y: y - 4, width: A4.w - MARGIN * 2, height: 14, color: LIGHT });
      }
      page.drawText(String(i + 1), { x: MARGIN + 4, y, font: fontRegular, size: 7, color: BLACK });
      page.drawText(String(d?.nomenclature_code || d?.numero || '—').slice(0, 28), { x: MARGIN + 24, y, font: fontRegular, size: 7, color: BLACK });
      page.drawText(String(d?.title || '—').slice(0, 35), { x: 200, y, font: fontRegular, size: 7, color: BLACK });
      page.drawText(String(v?.revision || '0'), { x: 400, y, font: fontRegular, size: 7, color: BLACK });
      page.drawText(String(td.finalidade || '—').slice(0, 14), { x: 430, y, font: fontRegular, size: 7, color: BLACK });
      page.drawRectangle({ x: 510, y: y - 2, width: 8, height: 8, borderColor: BLACK, borderWidth: 0.5, color: rgb(1, 1, 1) });
      y -= 14;
    }

    // Confirmação de recebimento
    y -= 20;
    if (y < 200) {
      page = pdfDoc.addPage([A4.w, A4.h]);
      y = A4.h - 80;
    }
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.w - MARGIN, y }, thickness: 0.5, color: SLATE });
    y -= 18;
    page.drawText('CONFIRMAÇÃO DE RECEBIMENTO', { x: MARGIN, y, font: fontBold, size: 10, color: NAVY });
    y -= 18;
    page.drawText('Confirmo o recebimento dos documentos listados acima nesta data, em pleno estado de uso.', {
      x: MARGIN, y, font: fontRegular, size: 9, color: BLACK,
    });
    y -= 50;

    // Assinaturas
    const sigW = (A4.w - MARGIN * 2 - 20) / 2;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + sigW, y }, thickness: 0.6, color: BLACK });
    page.drawText('Nome do recebedor', { x: MARGIN, y: y - 11, font: fontRegular, size: 7, color: SLATE });

    page.drawLine({ start: { x: MARGIN + sigW + 20, y }, end: { x: A4.w - MARGIN, y }, thickness: 0.6, color: BLACK });
    page.drawText('Data e assinatura', { x: MARGIN + sigW + 20, y: y - 11, font: fontRegular, size: 7, color: SLATE });

    // QR code de validação no rodapé
    try {
      const url = `${SITE_URL}/v/${code}`;
      const modules = encodeQR(url, 'utf8') as unknown as boolean[][];
      if (Array.isArray(modules) && modules.length > 0) {
        const sz = 60;
        const modSize = sz / modules.length;
        const startX = A4.w - sz - MARGIN;
        const startY = 50;
        page.drawRectangle({ x: startX - 4, y: startY - 4, width: sz + 8, height: sz + 8, color: rgb(1, 1, 1), borderColor: SLATE, borderWidth: 0.5 });
        for (let r = 0; r < modules.length; r++) {
          for (let c = 0; c < modules[r].length; c++) {
            if (modules[r][c]) {
              page.drawRectangle({
                x: startX + c * modSize, y: startY + (modules.length - r - 1) * modSize,
                width: modSize, height: modSize, color: BLACK,
              });
            }
          }
        }
        page.drawText('Validação pública', { x: startX, y: startY - 14, font: fontBold, size: 6, color: SLATE });
      }
    } catch (e) {
      console.error('[QR]', (e as Error).message);
    }

    // Footer em todas as páginas
    const pages = pdfDoc.getPages();
    for (let i = 0; i < pages.length; i++) {
      pages[i].drawText(`Validação: ${code}`, { x: MARGIN, y: 24, font: fontRegular, size: 7, color: SLATE });
      pages[i].drawText(`GRD ${grd.numero}`, { x: A4.w / 2 - 30, y: 24, font: fontRegular, size: 7, color: SLATE });
      pages[i].drawText(`Página ${i + 1} de ${pages.length}`, { x: A4.w - 100, y: 24, font: fontRegular, size: 7, color: SLATE });
    }

    pdfDoc.setTitle(`GRD ${grd.numero} — Contrato ${grd.contracts?.numero || ''}`);
    pdfDoc.setAuthor('geoCon · Consulte GEO');
    pdfDoc.setProducer('geoCon EF issue-grd-pdf v1');

    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    const hash = await sha256Hex(pdfBytes);
    const storagePath = `tenants/${grd.tenant_id}/contracts/${grd.contract_id || 'no-contract'}/grds/${grd.id}/${grd.numero}.pdf`;

    const { error: upErr } = await svc.storage.from('reports').upload(storagePath, pdfBytes, {
      contentType: 'application/pdf', upsert: true,
    });
    if (upErr) throw upErr;

    // Grava metadata e public_validation_record
    await svc.from('ged_transmittals')
      .update({ metadata: { ...(grd.metadata || {}), pdf_path: storagePath, pdf_hash: hash, validation_code: code } })
      .eq('id', grd.id);

    await svc.from('public_validation_records').upsert({
      tenant_id: grd.tenant_id,
      code,
      entity_type: 'grd',
      entity_id: grd.id,
      title: `GRD ${grd.numero} — Contrato ${grd.contracts?.numero || ''}`,
      hash_sha256: hash,
      storage_path: storagePath,
      active: true,
      metadata: { docs_count: tdocs.length, recipient: grd.recipient?.nome },
    }, { onConflict: 'code' });

    return ok({
      storage_path: storagePath,
      hash_sha256: hash,
      public_validation_code: code,
      validation_url: `${SITE_URL}/v/${code}`,
      size_bytes: pdfBytes.length,
      docs_count: tdocs.length,
    });
  } catch (e) {
    return serverError(e);
  }
});
