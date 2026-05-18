/**
 * export-contract-timeline-pdf — gera PDF auditável da Linha do Tempo de um
 * contrato (Lei 14.133 · 9 institutos · view V39).
 *
 * Input: {
 *   contract_id: uuid,
 *   filters?: {
 *     kinds?: string[],
 *     severity?: string[],
 *     from?: date,
 *     to?: date,
 *   }
 * }
 *
 * Output: {
 *   storage_path,
 *   hash_sha256,
 *   public_validation_code,
 *   validation_url,
 *   size_bytes,
 *   total_events
 * }
 *
 * Renderiza:
 *   - Capa com logo + nome do tenant + número/objeto do contrato + data emissão
 *   - Página de resumo executivo (KPIs Lei 14.133, contagens por instituto)
 *   - Páginas seguintes com eventos cronológicos agrupados por mês
 *   - Footer em todas as páginas: código de validação + hash + paginação
 *   - QR code de validação pública na última página
 */
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from 'https://esm.sh/pdf-lib@1.17.1';
import { encode as encodeQR } from 'https://esm.sh/qr@0.4.0';

import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, notFound, serverError } from '../_shared/response.ts';
import { sha256Hex } from '../_shared/pdf-helpers.ts';

const NAVY    = rgb(0.094, 0.157, 0.388);
const PURPLE  = rgb(0.243, 0.176, 0.443);
const MAGENTA = rgb(0.773, 0.067, 0.494);
const SLATE   = rgb(0.475, 0.514, 0.561);
const BLACK   = rgb(0.078, 0.094, 0.157);
const LIGHT   = rgb(0.960, 0.965, 0.973);
const LIGHTER = rgb(0.980, 0.985, 0.992);
const ERROR   = rgb(0.871, 0.176, 0.196);
const WARNING = rgb(0.945, 0.604, 0.114);
const SUCCESS = rgb(0.118, 0.518, 0.169);
const INFO    = rgb(0.231, 0.510, 0.965);

const SITE_URL = Deno.env.get('SITE_URL') || 'https://contratos.consultegeo.org';
const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 40;

function brl(n: number | null | undefined): string {
  const v = Number(n || 0);
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const s = iso.slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function fmtMonthYear(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function wrapText(text: string, maxChars: number): string[] {
  if (!text) return [''];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function randomCode(): string {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function severityColor(sev: string) {
  if (sev === 'danger')  return ERROR;
  if (sev === 'warning') return WARNING;
  if (sev === 'success') return SUCCESS;
  if (sev === 'info')    return INFO;
  return SLATE;
}

const KIND_LABELS: Record<string, string> = {
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

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  cur_y: number;
  page_num: number;
  total_pages: number;
  font: PDFFont;
  fontBold: PDFFont;
  contractNumero: number;
  contractTitulo: string;
  tenantName: string;
  code: string;
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([A4.w, A4.h]);
  ctx.cur_y = A4.h - MARGIN;
  ctx.page_num++;
  drawHeader(ctx);
}

function drawHeader(ctx: Ctx) {
  if (ctx.page_num === 1) return;  // capa não tem header
  // Topo: contrato + página
  ctx.page.drawText(
    `Contrato #${ctx.contractNumero} · Linha do Tempo`,
    { x: MARGIN, y: A4.h - 25, size: 8, font: ctx.fontBold, color: SLATE },
  );
  const pageLabel = `Página ${ctx.page_num}`;
  const w = ctx.font.widthOfTextAtSize(pageLabel, 8);
  ctx.page.drawText(pageLabel, { x: A4.w - MARGIN - w, y: A4.h - 25, size: 8, font: ctx.font, color: SLATE });
  // Linha
  ctx.page.drawLine({
    start: { x: MARGIN, y: A4.h - 32 },
    end:   { x: A4.w - MARGIN, y: A4.h - 32 },
    thickness: 0.5, color: LIGHT,
  });
  ctx.cur_y = A4.h - 50;
}

function drawFooter(ctx: Ctx, hash: string) {
  const txt1 = `Código de validação: ${ctx.code}`;
  const txt2 = `Hash SHA-256: ${hash}`;
  const txt3 = `Validação pública: ${SITE_URL}/v/${ctx.code}`;
  ctx.page.drawLine({
    start: { x: MARGIN, y: 38 },
    end:   { x: A4.w - MARGIN, y: 38 },
    thickness: 0.5, color: LIGHT,
  });
  ctx.page.drawText(txt1, { x: MARGIN, y: 28, size: 7, font: ctx.font, color: SLATE });
  ctx.page.drawText(txt2, { x: MARGIN, y: 18, size: 6, font: ctx.font, color: SLATE });
  ctx.page.drawText(txt3, { x: MARGIN, y:  8, size: 6, font: ctx.font, color: MAGENTA });
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.cur_y - needed < 60) newPage(ctx);
}

// Reserva pra altura do badge de severity
function drawSeverityBadge(ctx: Ctx, sev: string, x: number, y: number) {
  const color = severityColor(sev);
  ctx.page.drawCircle({ x: x + 4, y: y + 4, size: 4, color });
}

// =============================================================================
// Capa
// =============================================================================
function drawCover(ctx: Ctx, summary: any, filters: any, totalEvents: number) {
  // Page 1 já é a primeira
  ctx.page.drawRectangle({
    x: 0, y: A4.h - 120, width: A4.w, height: 120,
    color: NAVY,
  });
  // Título
  ctx.page.drawText('LINHA DO TEMPO', {
    x: MARGIN, y: A4.h - 60, size: 12, font: ctx.fontBold, color: rgb(1, 1, 1),
  });
  ctx.page.drawText('Processo contratual · Lei 14.133/2021', {
    x: MARGIN, y: A4.h - 76, size: 9, font: ctx.font, color: rgb(0.85, 0.85, 0.9),
  });
  // Tenant
  ctx.page.drawText(ctx.tenantName.toUpperCase(), {
    x: MARGIN, y: A4.h - 100, size: 7, font: ctx.fontBold, color: rgb(0.7, 0.75, 0.85),
  });

  let y = A4.h - 180;

  // Contract info
  ctx.page.drawText(`Contrato nº ${ctx.contractNumero}`, {
    x: MARGIN, y, size: 22, font: ctx.fontBold, color: NAVY,
  });
  y -= 22;

  // Título do contrato (com wrap)
  const titleLines = wrapText(ctx.contractTitulo, 65);
  for (const line of titleLines.slice(0, 3)) {
    ctx.page.drawText(line, { x: MARGIN, y, size: 11, font: ctx.font, color: BLACK });
    y -= 14;
  }
  y -= 12;

  // Metadados
  ctx.page.drawLine({
    start: { x: MARGIN, y: y + 4 },
    end:   { x: A4.w - MARGIN, y: y + 4 },
    thickness: 0.5, color: LIGHT,
  });
  y -= 14;

  function metaRow(label: string, value: string) {
    ctx.page.drawText(label.toUpperCase(), { x: MARGIN, y, size: 7, font: ctx.fontBold, color: SLATE });
    ctx.page.drawText(value, { x: MARGIN + 130, y, size: 9, font: ctx.font, color: BLACK });
    y -= 13;
  }

  metaRow('Emitido em', fmtDateTime(new Date().toISOString()));
  metaRow('Total de eventos', String(totalEvents));
  if (summary?.first_at && summary?.last_at) {
    metaRow('Período coberto', `${fmtDate(summary.first_at)} a ${fmtDate(summary.last_at)}`);
  }
  if (filters?.kinds?.length) {
    metaRow('Tipos filtrados', filters.kinds.map((k: string) => KIND_LABELS[k] || k).join(' · '));
  }
  if (filters?.severity?.length) {
    metaRow('Severidades', filters.severity.join(' · '));
  }
  if (filters?.from || filters?.to) {
    metaRow('Recorte', `${filters.from ? fmtDate(filters.from) : '—'} → ${filters.to ? fmtDate(filters.to) : '—'}`);
  }

  y -= 12;
  ctx.page.drawLine({
    start: { x: MARGIN, y: y + 4 },
    end:   { x: A4.w - MARGIN, y: y + 4 },
    thickness: 0.5, color: LIGHT,
  });
  y -= 18;

  // Resumo por instituto
  ctx.page.drawText('Eventos por instituto Lei 14.133', {
    x: MARGIN, y, size: 10, font: ctx.fontBold, color: NAVY,
  });
  y -= 14;

  if (summary?.by_kind) {
    const items = Object.entries(summary.by_kind) as [string, number][];
    items.sort((a, b) => b[1] - a[1]);
    const col_w = (A4.w - 2 * MARGIN) / 2;
    let col = 0;
    let row_y = y;
    for (const [k, count] of items) {
      const x = MARGIN + col * col_w;
      ctx.page.drawText(`${KIND_LABELS[k] || k}:`, { x, y: row_y, size: 8, font: ctx.font, color: BLACK });
      const ctText = String(count);
      const ctW = ctx.fontBold.widthOfTextAtSize(ctText, 8);
      ctx.page.drawText(ctText, { x: x + col_w - 40 - ctW, y: row_y, size: 8, font: ctx.fontBold, color: NAVY });
      col++;
      if (col >= 2) { col = 0; row_y -= 13; }
    }
    y = row_y - 13;
  }

  y -= 18;

  // Observação legal
  ctx.page.drawRectangle({
    x: MARGIN, y: y - 50, width: A4.w - 2 * MARGIN, height: 50,
    color: LIGHTER,
  });
  ctx.page.drawText('IMPORTÂNCIA LEGAL', {
    x: MARGIN + 10, y: y - 12, size: 7, font: ctx.fontBold, color: PURPLE,
  });
  const noteLines = wrapText(
    'Este documento consolida cronologicamente os eventos contratuais registrados no sistema geoCon — Consulte GEO. ' +
    'O conteúdo serve como evidência auditável para fiscalização interna, controle externo (TCU/TCEs), ' +
    'instrução processual administrativa (PAR) e processos judiciais. Validação por hash SHA-256 e código público.',
    100,
  );
  let nY = y - 24;
  for (const line of noteLines) {
    ctx.page.drawText(line, { x: MARGIN + 10, y: nY, size: 7, font: ctx.font, color: BLACK });
    nY -= 9;
  }
}

// =============================================================================
// Evento individual
// =============================================================================
function drawEvent(ctx: Ctx, e: any) {
  // Calcula altura necessária
  const titleLines = wrapText(e.title || '', 80);
  const subtitleLines = e.subtitle ? wrapText(e.subtitle, 90) : [];
  const actorLine = e.actor_name ? 1 : 0;
  const eventHeight = 14 + (titleLines.length * 11) + (subtitleLines.length * 9) + (actorLine * 9) + 8;

  ensureSpace(ctx, eventHeight + 4);

  // Severity dot
  drawSeverityBadge(ctx, e.severity, MARGIN, ctx.cur_y - 5);

  // Header da linha: kind + subtype + timestamp
  const headerY = ctx.cur_y;
  const kindLabel = KIND_LABELS[e.event_kind] || e.event_kind;
  ctx.page.drawText(kindLabel.toUpperCase(), {
    x: MARGIN + 14, y: headerY, size: 7, font: ctx.fontBold, color: NAVY,
  });
  const kindW = ctx.fontBold.widthOfTextAtSize(kindLabel.toUpperCase(), 7);
  if (e.event_subtype) {
    ctx.page.drawText('·', { x: MARGIN + 14 + kindW + 4, y: headerY, size: 7, font: ctx.font, color: SLATE });
    ctx.page.drawText(e.event_subtype, {
      x: MARGIN + 14 + kindW + 10, y: headerY, size: 7, font: ctx.font, color: severityColor(e.severity),
    });
  }
  // Timestamp à direita
  const tsText = fmtDateTime(e.event_at);
  const tsW = ctx.font.widthOfTextAtSize(tsText, 7);
  ctx.page.drawText(tsText, { x: A4.w - MARGIN - tsW, y: headerY, size: 7, font: ctx.font, color: SLATE });

  ctx.cur_y -= 11;

  // Title
  for (const line of titleLines) {
    ctx.page.drawText(line, { x: MARGIN + 14, y: ctx.cur_y, size: 9, font: ctx.fontBold, color: BLACK });
    ctx.cur_y -= 11;
  }

  // Subtitle
  if (subtitleLines.length > 0) {
    for (const line of subtitleLines) {
      ctx.page.drawText(line, { x: MARGIN + 14, y: ctx.cur_y, size: 7, font: ctx.font, color: SLATE });
      ctx.cur_y -= 9;
    }
  }

  // Actor
  if (actorLine) {
    ctx.page.drawText(`por ${e.actor_name}`, {
      x: MARGIN + 14, y: ctx.cur_y, size: 6, font: ctx.font, color: SLATE,
    });
    ctx.cur_y -= 9;
  }

  // Linha divisora sutil
  ctx.cur_y -= 4;
  ctx.page.drawLine({
    start: { x: MARGIN + 14, y: ctx.cur_y },
    end:   { x: A4.w - MARGIN, y: ctx.cur_y },
    thickness: 0.3, color: LIGHTER,
  });
  ctx.cur_y -= 4;
}

// =============================================================================
// Month group header
// =============================================================================
function drawMonthHeader(ctx: Ctx, monthIso: string, count: number) {
  ensureSpace(ctx, 30);
  // Box magenta
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.cur_y - 18, width: A4.w - 2 * MARGIN, height: 22,
    color: LIGHTER,
  });
  ctx.page.drawText(fmtMonthYear(monthIso + '-01').toUpperCase(), {
    x: MARGIN + 8, y: ctx.cur_y - 12, size: 10, font: ctx.fontBold, color: NAVY,
  });
  const ctText = `${count} evento${count === 1 ? '' : 's'}`;
  const ctW = ctx.font.widthOfTextAtSize(ctText, 8);
  ctx.page.drawText(ctText, {
    x: A4.w - MARGIN - 8 - ctW, y: ctx.cur_y - 11, size: 8, font: ctx.font, color: SLATE,
  });
  ctx.cur_y -= 28;
}

// =============================================================================
// QR Code page
// =============================================================================
async function drawQrFinalSection(ctx: Ctx, hash: string) {
  ensureSpace(ctx, 200);

  // Linha
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.cur_y },
    end:   { x: A4.w - MARGIN, y: ctx.cur_y },
    thickness: 1, color: NAVY,
  });
  ctx.cur_y -= 20;

  ctx.page.drawText('Validação pública', {
    x: MARGIN, y: ctx.cur_y, size: 11, font: ctx.fontBold, color: NAVY,
  });
  ctx.cur_y -= 14;

  const url = `${SITE_URL}/v/${ctx.code}`;
  const lines = wrapText(
    `Para verificar a autenticidade deste documento, acesse ${url} ou escaneie o QR Code. ` +
    `A hash SHA-256 abaixo identifica unicamente este arquivo PDF.`,
    105,
  );
  for (const line of lines) {
    ctx.page.drawText(line, { x: MARGIN, y: ctx.cur_y, size: 8, font: ctx.font, color: BLACK });
    ctx.cur_y -= 11;
  }
  ctx.cur_y -= 6;

  // Hash em destaque
  ctx.page.drawText('Hash SHA-256:', { x: MARGIN, y: ctx.cur_y, size: 7, font: ctx.fontBold, color: SLATE });
  ctx.cur_y -= 10;
  // Hash em 2 linhas se necessário
  const hashLen = 64;
  ctx.page.drawText(hash.substring(0, 32), { x: MARGIN, y: ctx.cur_y, size: 8, font: ctx.font, color: BLACK });
  ctx.cur_y -= 10;
  ctx.page.drawText(hash.substring(32, hashLen), { x: MARGIN, y: ctx.cur_y, size: 8, font: ctx.font, color: BLACK });
  ctx.cur_y -= 20;

  // QR Code
  try {
    const qrBytes = await encodeQR(url, { ecc: 'M' });
    const qrImg = await ctx.doc.embedPng(qrBytes);
    const qrSize = 100;
    ctx.page.drawImage(qrImg, {
      x: A4.w - MARGIN - qrSize,
      y: ctx.cur_y - qrSize + 30,
      width: qrSize,
      height: qrSize,
    });
  } catch (e) {
    console.error('[export-timeline-pdf] qr error:', e);
  }
}

// =============================================================================
// Main handler
// =============================================================================
Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const contractId: string = body.contract_id;
    const filters = body.filters || {};

    if (!contractId) {
      return fail('contract_id é obrigatório');
    }

    const svc = getServiceClient();

    // Busca contract
    const { data: contract, error: cErr } = await svc
      .from('contracts')
      .select('id, tenant_id, numero, titulo, status')
      .eq('id', contractId)
      .is('deleted_at', null)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!contract) return notFound('contrato não encontrado');

    // Busca tenant
    const { data: tenant } = await svc
      .from('tenants')
      .select('name')
      .eq('id', contract.tenant_id)
      .maybeSingle();
    const tenantName = (tenant as any)?.name || 'Tenant';

    // RPC: list_contract_timeline com filtros
    const { data: events, error: eErr } = await svc.rpc('list_contract_timeline', {
      p_contract_id: contractId,
      p_kinds:     filters.kinds    && filters.kinds.length    ? filters.kinds    : null,
      p_from:      filters.from    ?? null,
      p_to:        filters.to      ?? null,
      p_severity:  filters.severity && filters.severity.length ? filters.severity : null,
      p_limit:     2000,
    });
    if (eErr) throw eErr;

    // RPC: summary
    const { data: summary } = await svc.rpc('get_contract_timeline_summary', {
      p_contract_id: contractId,
    });

    const allEvents = events || [];

    // Cria PDF
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const code = randomCode();

    const ctx: Ctx = {
      doc,
      page: doc.addPage([A4.w, A4.h]),
      cur_y: A4.h - MARGIN,
      page_num: 1,
      total_pages: 0,
      font, fontBold,
      contractNumero: (contract as any).numero,
      contractTitulo: (contract as any).titulo || '',
      tenantName,
      code,
    };

    // Capa
    drawCover(ctx, summary, filters, allEvents.length);

    // Agrupar por mês
    if (allEvents.length > 0) {
      newPage(ctx);
      ctx.page.drawText('EVENTOS CRONOLÓGICOS', {
        x: MARGIN, y: ctx.cur_y, size: 11, font: ctx.fontBold, color: NAVY,
      });
      ctx.cur_y -= 18;

      const groups = new Map<string, any[]>();
      for (const e of allEvents) {
        const key = (e.event_date as string).slice(0, 7);
        const arr = groups.get(key) || [];
        arr.push(e);
        groups.set(key, arr);
      }
      const orderedGroups = Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));

      for (const [month, items] of orderedGroups) {
        drawMonthHeader(ctx, month, items.length);
        for (const e of items) {
          drawEvent(ctx, e);
        }
      }
    } else {
      newPage(ctx);
      ctx.page.drawText('Nenhum evento encontrado com os filtros aplicados.', {
        x: MARGIN, y: ctx.cur_y, size: 10, font: ctx.font, color: SLATE,
      });
      ctx.cur_y -= 16;
    }

    // QR code section
    await drawQrFinalSection(ctx, '0'.repeat(64));  // placeholder; hash real após save

    // Total pages
    ctx.total_pages = doc.getPageCount();

    // Salva PDF
    doc.setTitle(`Linha do Tempo · Contrato ${ctx.contractNumero}`);
    doc.setAuthor(tenantName);
    doc.setProducer('geoCon EF export-contract-timeline-pdf v1');
    doc.setSubject(`Timeline · ${allEvents.length} eventos · ${new Date().toISOString()}`);

    const pdfBytes = await doc.save({ useObjectStreams: false });
    const hash = await sha256Hex(pdfBytes);

    // Re-renderiza footer com hash real em todas as páginas
    // (pdf-lib não suporta edição depois do save; gera novamente)
    const doc2 = await PDFDocument.create();
    const font2 = await doc2.embedFont(StandardFonts.Helvetica);
    const fontBold2 = await doc2.embedFont(StandardFonts.HelveticaBold);

    const ctx2: Ctx = {
      doc: doc2,
      page: doc2.addPage([A4.w, A4.h]),
      cur_y: A4.h - MARGIN,
      page_num: 1,
      total_pages: ctx.total_pages,
      font: font2, fontBold: fontBold2,
      contractNumero: (contract as any).numero,
      contractTitulo: (contract as any).titulo || '',
      tenantName,
      code,
    };

    drawCover(ctx2, summary, filters, allEvents.length);
    drawFooter(ctx2, hash);

    if (allEvents.length > 0) {
      newPage(ctx2);
      ctx2.page.drawText('EVENTOS CRONOLÓGICOS', {
        x: MARGIN, y: ctx2.cur_y, size: 11, font: fontBold2, color: NAVY,
      });
      ctx2.cur_y -= 18;

      const groups = new Map<string, any[]>();
      for (const e of allEvents) {
        const key = (e.event_date as string).slice(0, 7);
        const arr = groups.get(key) || [];
        arr.push(e);
        groups.set(key, arr);
      }
      const orderedGroups = Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));

      let lastPageNum = ctx2.page_num;
      for (const [month, items] of orderedGroups) {
        drawMonthHeader(ctx2, month, items.length);
        for (const e of items) {
          drawEvent(ctx2, e);
          if (ctx2.page_num !== lastPageNum) {
            drawFooter(ctx2, hash);
            lastPageNum = ctx2.page_num;
          }
        }
      }
    } else {
      newPage(ctx2);
      ctx2.page.drawText('Nenhum evento encontrado com os filtros aplicados.', {
        x: MARGIN, y: ctx2.cur_y, size: 10, font: font2, color: SLATE,
      });
      ctx2.cur_y -= 16;
    }

    await drawQrFinalSection(ctx2, hash);
    drawFooter(ctx2, hash);

    const finalBytes = await doc2.save({ useObjectStreams: false });
    const finalHash = await sha256Hex(finalBytes);

    // Storage
    const storagePath =
      `tenants/${contract.tenant_id}/contracts/${contractId}/timeline/` +
      `${new Date().toISOString().slice(0, 10)}-${code}.pdf`;

    const { error: upErr } = await svc.storage
      .from('reports')
      .upload(storagePath, finalBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });
    if (upErr) throw upErr;

    // Registra para validação pública
    await svc.from('public_validation_records').upsert({
      tenant_id: contract.tenant_id,
      code,
      entity_type: 'contract_timeline',
      entity_id: contractId,
      title: `Linha do Tempo — Contrato ${(contract as any).numero}`,
      hash_sha256: finalHash,
      storage_path: storagePath,
      active: true,
      metadata: {
        total_events: allEvents.length,
        filters,
        generated_at: new Date().toISOString(),
      },
    }, { onConflict: 'code' });

    // Registra como generated_report (se tabela existir)
    try {
      await svc.from('generated_reports').insert({
        tenant_id: contract.tenant_id,
        contract_id: contractId,
        report_type: 'contract_timeline',
        title: `Linha do Tempo — Contrato ${(contract as any).numero} — ${new Date().toLocaleDateString('pt-BR')}`,
        storage_path: storagePath,
        mime_type: 'application/pdf',
        filters,
        status: 'gerado',
      });
    } catch (_e) {
      // tabela pode não existir em todos os ambientes
    }

    return ok({
      storage_path:           storagePath,
      hash_sha256:            finalHash,
      public_validation_code: code,
      validation_url:         `${SITE_URL}/v/${code}`,
      size_bytes:             finalBytes.byteLength,
      total_events:           allEvents.length,
    });
  } catch (e) {
    console.error('[export-contract-timeline-pdf] error:', e);
    return serverError((e as Error).message || 'erro inesperado');
  }
});
