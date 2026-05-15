/**
 * generate-measurement-pdf — boletim de medição em PDF, 5 variantes.
 *
 * Variantes:
 *   - analitico    (default): todos os itens com saldos, qtds, % executada / acumulada
 *   - sintetico    : agrupado por disciplina, só itens medidos no período
 *   - complementar : só itens da medição complementar (boletim retificado)
 *   - eap          : visão por estrutura analítica do projeto (% de execução)
 *   - mapa-glosas  : boletim auxiliar listando glosas e retenções com justificativas
 *
 * Campos formais (spec seção 3.6 — 26 campos):
 *   Cabeçalho (1..15): data, número, empresa, contrato, medição, valor PO,
 *     valor reajustado, valor contrato, saldo contrato, reajuste período,
 *     período, prazo contrato, prazo decorrido, prazo restante, valor por extenso
 *   Por item (16..26): código, especificações, qtd cabeçalho, estimada,
 *     período, % executada, % acumulado, unidade, custo unitário, valor, acumulado
 */
import { PDFDocument, rgb, degrees, StandardFonts, PDFPage, PDFFont } from 'https://esm.sh/pdf-lib@1.17.1';
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';
import { encode as encodeQR } from 'https://esm.sh/qr@0.4.0';

import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, notFound, serverError } from '../_shared/response.ts';
import { INTER_REGULAR_WOFF_BASE64, INTER_BOLD_WOFF_BASE64, decodeWoff } from '../_shared/fonts.ts';
import {
  woffToSfnt, sha256Hex, formatBrl, formatNum, formatDate, diffDays, valorPorExtenso,
} from '../_shared/pdf-helpers.ts';

const NAVY    = rgb(0.094, 0.157, 0.388);
const PURPLE  = rgb(0.243, 0.176, 0.443);
const MAGENTA = rgb(0.773, 0.067, 0.494);
const SLATE   = rgb(0.475, 0.514, 0.561);
const BLACK   = rgb(0.078, 0.094, 0.157);
const RED     = rgb(0.860, 0.180, 0.180);
const GREEN   = rgb(0.063, 0.725, 0.506);
const LIGHT   = rgb(0.960, 0.965, 0.973);

const SITE_URL = Deno.env.get('SITE_URL') || 'https://contratos.consultegeo.org';
const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 25;

type Variant = 'analitico' | 'sintetico' | 'complementar' | 'eap' | 'mapa-glosas';
const VALID_VARIANTS: Variant[] = ['analitico', 'sintetico', 'complementar', 'eap', 'mapa-glosas'];

const VARIANT_LABEL: Record<Variant, string> = {
  analitico:    'Boletim analítico',
  sintetico:    'Boletim sintético (por disciplina)',
  complementar: 'Boletim complementar',
  eap:          'Boletim por EAP',
  'mapa-glosas': 'Mapa de glosas e retenções',
};

interface Ctx {
  pdfDoc: PDFDocument;
  fontRegular: PDFFont;
  fontBold: PDFFont;
  m: any;
  items: any[];
  contractItems: any[];
  glosses: any[];
  retentions: any[];
  variant: Variant;
  code: string;
  fields15: Record<string, string>;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const measurementId = body.measurement_id as string;
    const variant = ((body.variant as string) || 'analitico') as Variant;
    if (!measurementId) return fail('measurement_id obrigatório');
    if (!VALID_VARIANTS.includes(variant)) return fail(`Variante inválida. Use: ${VALID_VARIANTS.join(', ')}`);

    const svc = getServiceClient();

    const { data: m, error: me } = await svc
      .from('measurements')
      .select(`
        *,
        contracts(
          *,
          contratante:contract_organizations!contracts_contratante_id_fkey(nome,cnpj),
          contratada:contract_organizations!contracts_contratada_id_fkey(nome,cnpj),
          tenants(nome,brand_logo_url)
        )
      `)
      .eq('id', measurementId)
      .maybeSingle();
    if (me || !m) return notFound('Medição não encontrada');

    const { data: items = [] } = await svc
      .from('measurement_items')
      .select('*, contract_items(codigo,descricao,unidade,quantidade_contratada,disciplines:discipline_id(nome))')
      .eq('measurement_id', measurementId).is('deleted_at', null).order('codigo');

    const { data: contractItems = [] } = await svc
      .from('contract_items')
      .select('id,codigo,descricao,unidade,quantidade_contratada,quantidade_aditada,quantidade_medida_acumulada,preco_unitario,disciplines:discipline_id(nome),nivel,is_title')
      .eq('contract_id', m.contract_id).is('deleted_at', null).order('codigo');

    const { data: glosses = [] } = await svc
      .from('measurement_glosses')
      .select('*, measurement_items(codigo,descricao)')
      .in('measurement_item_id', (items || []).map((i: any) => i.id).concat(['00000000-0000-0000-0000-000000000000']))
      .is('deleted_at', null);
    const { data: retentions = [] } = await svc
      .from('measurement_retentions').select('*').eq('measurement_id', measurementId).is('deleted_at', null);

    // ---- Setup PDF ----
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    let fontRegular: PDFFont, fontBold: PDFFont;
    try {
      const r = await woffToSfnt(decodeWoff(INTER_REGULAR_WOFF_BASE64));
      const b = await woffToSfnt(decodeWoff(INTER_BOLD_WOFF_BASE64));
      fontRegular = await pdfDoc.embedFont(r, { subset: true });
      fontBold = await pdfDoc.embedFont(b, { subset: true });
    } catch (e) {
      console.error('[fonts] WOFF1 falhou, usando Helvetica:', (e as Error).message);
      fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
      fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    }

    let code = m.public_validation_code;
    if (!code) {
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      code = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    }

    const fields15 = buildHeaderFields(m, contractItems);

    const ctx: Ctx = {
      pdfDoc, fontRegular, fontBold, m, items: items || [], contractItems: contractItems || [],
      glosses: glosses || [], retentions: retentions || [], variant, code, fields15,
    };

    renderHeaderPage(ctx);
    if (variant === 'analitico')    renderAnalitico(ctx);
    if (variant === 'sintetico')    renderSintetico(ctx);
    if (variant === 'complementar') renderComplementar(ctx);
    if (variant === 'eap')          renderEap(ctx);
    if (variant === 'mapa-glosas')  renderMapaGlosas(ctx);
    renderValorPorExtenso(ctx);

    const isPreliminar = !['emitida', 'aprovada', 'paga'].includes(m.status);
    const pages = pdfDoc.getPages();
    for (let i = 0; i < pages.length; i++) {
      if (isPreliminar) {
        pages[i].drawText('PRELIMINAR', { x: 80, y: 400, font: fontBold, size: 110,
          color: rgb(0.9, 0.2, 0.3), opacity: 0.13, rotate: degrees(35) });
      }
      pages[i].drawText(`Validação: ${code}`, { x: MARGIN, y: 24, font: fontRegular, size: 7, color: SLATE });
      pages[i].drawText(`Página ${i + 1} de ${pages.length}`, { x: A4.w - 100, y: 24, font: fontRegular, size: 7, color: SLATE });
      pages[i].drawText(VARIANT_LABEL[variant], { x: A4.w / 2 - 60, y: 24, font: fontRegular, size: 7, color: SLATE });
    }
    drawQR(pages[0], fontRegular, fontBold, code);

    pdfDoc.setTitle(`Boletim ${VARIANT_LABEL[variant]} n.º ${m.numero} - ${m.contracts?.numero || ''}`);
    pdfDoc.setAuthor('geoCon · Consulte GEO');
    pdfDoc.setProducer('geoCon EF generate-measurement-pdf v2');
    pdfDoc.setSubject(`Boletim de Medição — ${VARIANT_LABEL[variant]}`);

    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    const hash = await sha256Hex(pdfBytes);

    const storagePath = `tenants/${m.contracts?.tenant_id}/contracts/${m.contract_id}/measurements/${m.id}/boletim_${variant}_${Date.now()}.pdf`;
    const { error: upErr } = await svc.storage.from('reports').upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) throw upErr;

    await svc.from('measurements').update({
      hash_documento: hash, public_validation_code: code, official_pdf_storage_path: storagePath,
    }).eq('id', m.id);

    await svc.from('public_validation_records').upsert({
      tenant_id: m.contracts?.tenant_id, code, entity_type: 'measurement', entity_id: m.id,
      title: `Boletim de medição n.º ${m.numero} (${variant}) - Contrato ${m.contracts?.numero || ''}`,
      hash_sha256: hash, storage_path: storagePath, active: true,
      metadata: { variant, contract_id: m.contract_id, valor_liquido: m.valor_liquido },
    }, { onConflict: 'code' });

    return ok({
      storage_path: storagePath, hash_sha256: hash, public_validation_code: code,
      validation_url: `${SITE_URL}/v/${code}`, size_bytes: pdfBytes.length, variant,
    });
  } catch (e) {
    return serverError(e);
  }
});

// =============================================================================
// CABEÇALHO: 14 campos numerados (15º é renderizado depois com o total)
// =============================================================================
function buildHeaderFields(m: any, contractItems: any[]): Record<string, string> {
  const c = m.contracts || {};
  const valorPO = Number(c.valor_inicial || 0);
  const valorReajustado = Number(m.valor_reajuste_periodo || 0);
  const valorContrato = Number(c.valor_total_atual || c.valor_inicial || 0);
  const acumulado = contractItems.reduce((s, ci) => s + Number(ci.quantidade_medida_acumulada || 0) * Number(ci.preco_unitario || 0), 0);
  const saldo = valorContrato - acumulado;
  const hoje = new Date().toISOString().slice(0, 10);
  const inicio = c.data_ordem_inicio || c.data_assinatura;
  const prazoContrato = Number(c.prazo_execucao_dias || 0);
  const prazoDecorrido = inicio ? Math.max(0, diffDays(inicio, hoje)) : 0;
  const prazoRestante = Math.max(0, prazoContrato - prazoDecorrido);

  return {
    '1_data':              formatDate(hoje),
    '2_numero':            `${m.numero}${m.complementar_numero ? '.' + m.complementar_numero : ''}`,
    '3_empresa':           c.contratada?.nome || '—',
    '4_contrato':          c.numero || '—',
    '5_medicao':           String(m.numero),
    '6_valor_po':          formatBrl(valorPO),
    '7_valor_reajustado':  formatBrl(valorReajustado),
    '8_valor_contrato':    formatBrl(valorContrato),
    '9_saldo_contrato':    formatBrl(saldo),
    '10_reajuste_periodo': formatBrl(valorReajustado),
    '11_periodo':          `${formatDate(m.periodo_inicio)} a ${formatDate(m.periodo_fim)}`,
    '12_prazo_contrato':   `${prazoContrato} dias`,
    '13_prazo_decorrido':  `${prazoDecorrido} dias`,
    '14_prazo_restante':   `${prazoRestante} dias`,
  };
}

function renderHeaderPage(ctx: Ctx) {
  const { pdfDoc, fontBold, fontRegular, m, fields15, variant } = ctx;
  const page = pdfDoc.addPage([A4.w, A4.h]);
  const c = m.contracts || {};

  page.drawRectangle({ x: 0, y: A4.h - 60, width: A4.w * 0.35, height: 60, color: NAVY });
  page.drawRectangle({ x: A4.w * 0.35, y: A4.h - 60, width: A4.w * 0.3, height: 60, color: PURPLE });
  page.drawRectangle({ x: A4.w * 0.65, y: A4.h - 60, width: A4.w * 0.35, height: 60, color: MAGENTA });

  page.drawText('geoCon', { x: MARGIN, y: A4.h - 35, font: fontBold, size: 22, color: rgb(1, 1, 1) });
  page.drawText('Consulte GEO · Gestão de Contratos', { x: MARGIN, y: A4.h - 52, font: fontRegular, size: 8, color: rgb(1, 1, 1) });
  page.drawText(c.tenants?.nome || '', { x: A4.w - 220, y: A4.h - 35, font: fontBold, size: 10, color: rgb(1, 1, 1) });

  page.drawText(VARIANT_LABEL[variant].toUpperCase(), { x: MARGIN, y: A4.h - 85, font: fontBold, size: 14, color: BLACK });
  page.drawText(`Boletim n.º ${fields15['2_numero']} · Contrato ${fields15['4_contrato']}`,
    { x: MARGIN, y: A4.h - 101, font: fontRegular, size: 10, color: SLATE });

  // Grade 14 campos (15 vem no rodapé com valor)
  const startY = A4.h - 130;
  const cellH = 28;
  const cells: Array<[string, string]> = [
    ['1. Data',                  fields15['1_data']],
    ['2. Número',                fields15['2_numero']],
    ['3. Empresa',               fields15['3_empresa']],
    ['4. Contrato n.º',          fields15['4_contrato']],
    ['5. Medição n.º',           fields15['5_medicao']],
    ['6. Valor PO',              fields15['6_valor_po']],
    ['7. Valor reajustado',      fields15['7_valor_reajustado']],
    ['8. Valor do contrato',     fields15['8_valor_contrato']],
    ['9. Saldo do contrato',     fields15['9_saldo_contrato']],
    ['10. Reajuste do período',  fields15['10_reajuste_periodo']],
    ['11. Período',              fields15['11_periodo']],
    ['12. Prazo do contrato',    fields15['12_prazo_contrato']],
    ['13. Prazo decorrido',      fields15['13_prazo_decorrido']],
    ['14. Prazo restante',       fields15['14_prazo_restante']],
  ];

  const colW = (A4.w - MARGIN * 2) / 2;
  for (let i = 0; i < cells.length; i++) {
    const [label, value] = cells[i];
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * colW;
    const y = startY - row * cellH;
    page.drawRectangle({ x, y: y - cellH + 4, width: colW - 2, height: cellH - 2, borderColor: SLATE, borderWidth: 0.4, color: LIGHT });
    page.drawText(label, { x: x + 4, y: y - 8, font: fontBold, size: 6.5, color: SLATE });
    page.drawText(String(value).slice(0, 50), { x: x + 4, y: y - 20, font: fontRegular, size: 9, color: BLACK });
  }

  const partesY = startY - 7 * cellH - 10;
  page.drawText('CONTRATANTE', { x: MARGIN, y: partesY, font: fontBold, size: 7, color: NAVY });
  page.drawText(`${c.contratante?.nome || '—'}  ·  CNPJ ${c.contratante?.cnpj || '—'}`,
    { x: MARGIN, y: partesY - 11, font: fontRegular, size: 9, color: BLACK });
  page.drawText('CONTRATADA', { x: MARGIN, y: partesY - 28, font: fontBold, size: 7, color: NAVY });
  page.drawText(`${c.contratada?.nome || '—'}  ·  CNPJ ${c.contratada?.cnpj || '—'}`,
    { x: MARGIN, y: partesY - 39, font: fontRegular, size: 9, color: BLACK });

  page.drawText('OBJETO', { x: MARGIN, y: partesY - 56, font: fontBold, size: 7, color: NAVY });
  const objLines = wrapText(c.objeto || '—', 110);
  for (let i = 0; i < Math.min(objLines.length, 3); i++) {
    page.drawText(objLines[i], { x: MARGIN, y: partesY - 67 - i * 11, font: fontRegular, size: 9, color: BLACK });
  }
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

function pageTitle(page: PDFPage, fontBold: PDFFont, fontRegular: PDFFont, title: string, subtitle: string) {
  page.drawText(title, { x: MARGIN, y: A4.h - 50, font: fontBold, size: 12, color: NAVY });
  page.drawText(subtitle, { x: MARGIN, y: A4.h - 65, font: fontRegular, size: 8, color: SLATE });
}

// =============================================================================
// VARIANTE: ANALÍTICO
// =============================================================================
function renderAnalitico(ctx: Ctx) {
  const { pdfDoc, fontBold, fontRegular, items, contractItems } = ctx;
  let page = pdfDoc.addPage([A4.w, A4.h]);
  pageTitle(page, fontBold, fontRegular, 'ITENS MEDIDOS — ANALÍTICO', 'Todos os itens contratuais com qtd no período, acumulada e percentuais');
  let y = A4.h - 90;
  drawAnaliticoHeader(page, fontBold, y); y -= 16;

  const measuredByItemId = new Map<string, any>();
  for (const it of items) if (it.contract_item_id) measuredByItemId.set(it.contract_item_id, it);

  let totalPeriodo = 0, totalAcumulado = 0;
  for (const ci of contractItems) {
    if (ci.is_title) continue;
    if (y < 60) {
      page = pdfDoc.addPage([A4.w, A4.h]);
      y = A4.h - 50;
      drawAnaliticoHeader(page, fontBold, y); y -= 16;
    }
    const measured = measuredByItemId.get(ci.id);
    const qtdContratada = Number(ci.quantidade_contratada || 0) + Number(ci.quantidade_aditada || 0);
    const qtdPeriodo = Number(measured?.quantidade_periodo || 0);
    const qtdAcumulado = Number(ci.quantidade_medida_acumulada || 0);
    const preco = Number(measured?.preco_unitario_snapshot || ci.preco_unitario || 0);
    const valorPeriodo = qtdPeriodo * preco;
    const valorAcumulado = qtdAcumulado * preco;
    const pctPeriodo = qtdContratada > 0 ? (qtdPeriodo / qtdContratada) * 100 : 0;
    const pctAcumulado = qtdContratada > 0 ? (qtdAcumulado / qtdContratada) * 100 : 0;
    totalPeriodo += valorPeriodo; totalAcumulado += valorAcumulado;

    page.drawText(String(ci.codigo).slice(0, 12), { x: MARGIN + 2, y, font: fontRegular, size: 6, color: BLACK });
    page.drawText(String(ci.descricao).slice(0, 38), { x: 70, y, font: fontRegular, size: 6, color: BLACK });
    page.drawText(String(ci.unidade || '').toUpperCase().slice(0, 4), { x: 235, y, font: fontRegular, size: 6, color: BLACK });
    page.drawText(formatNum(qtdContratada, 2), { x: 260, y, font: fontRegular, size: 6, color: BLACK });
    page.drawText(formatNum(qtdPeriodo, 2), { x: 305, y, font: fontRegular, size: 6, color: BLACK });
    page.drawText(formatNum(pctPeriodo, 1) + '%', { x: 355, y, font: fontRegular, size: 6, color: BLACK });
    page.drawText(formatNum(qtdAcumulado, 2), { x: 380, y, font: fontRegular, size: 6, color: BLACK });
    page.drawText(formatNum(pctAcumulado, 1) + '%', { x: 420, y, font: fontRegular, size: 6, color: BLACK });
    page.drawText(formatNum(preco, 2), { x: 445, y, font: fontRegular, size: 6, color: BLACK });
    page.drawText(formatNum(valorPeriodo, 2), { x: 488, y, font: fontRegular, size: 6, color: BLACK });
    page.drawText(formatNum(valorAcumulado, 2), { x: 532, y, font: fontRegular, size: 6, color: BLACK });
    y -= 12;
  }

  y -= 4;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.w - MARGIN, y }, thickness: 0.5, color: SLATE });
  y -= 14;
  page.drawText('TOTAL DO PERÍODO', { x: 380, y, font: fontBold, size: 9, color: NAVY });
  page.drawText(formatBrl(totalPeriodo), { x: 490, y, font: fontBold, size: 9, color: NAVY });
  y -= 12;
  page.drawText('TOTAL ACUMULADO', { x: 380, y, font: fontBold, size: 9, color: NAVY });
  page.drawText(formatBrl(totalAcumulado), { x: 490, y, font: fontBold, size: 9, color: NAVY });
}

function drawAnaliticoHeader(page: PDFPage, font: PDFFont, y: number) {
  page.drawRectangle({ x: MARGIN, y: y - 4, width: A4.w - MARGIN * 2, height: 14, color: LIGHT });
  page.drawText('16.Cód', { x: MARGIN + 2, y, font, size: 6, color: SLATE });
  page.drawText('17.Especificação', { x: 70, y, font, size: 6, color: SLATE });
  page.drawText('23.Un', { x: 235, y, font, size: 6, color: SLATE });
  page.drawText('18.Cab', { x: 260, y, font, size: 6, color: SLATE });
  page.drawText('20.Período', { x: 305, y, font, size: 6, color: SLATE });
  page.drawText('21.%', { x: 355, y, font, size: 6, color: SLATE });
  page.drawText('19.Acum', { x: 380, y, font, size: 6, color: SLATE });
  page.drawText('22.%a', { x: 420, y, font, size: 6, color: SLATE });
  page.drawText('24.Unit', { x: 445, y, font, size: 6, color: SLATE });
  page.drawText('25.Valor', { x: 488, y, font, size: 6, color: SLATE });
  page.drawText('26.Acum.', { x: 532, y, font, size: 6, color: SLATE });
}

// =============================================================================
// VARIANTE: SINTÉTICO
// =============================================================================
function renderSintetico(ctx: Ctx) {
  const { pdfDoc, fontBold, fontRegular, items } = ctx;
  let page = pdfDoc.addPage([A4.w, A4.h]);
  pageTitle(page, fontBold, fontRegular, 'BOLETIM SINTÉTICO', 'Itens medidos no período, agrupados por disciplina');
  let y = A4.h - 90;

  const byDisc: Record<string, any[]> = {};
  for (const it of items) {
    if (Number(it.quantidade_periodo || 0) <= 0) continue;
    const d = it.contract_items?.disciplines?.nome || 'Sem disciplina';
    (byDisc[d] = byDisc[d] || []).push(it);
  }

  let totalGeral = 0;
  for (const [disciplina, list] of Object.entries(byDisc)) {
    if (y < 100) { page = pdfDoc.addPage([A4.w, A4.h]); y = A4.h - 50; }
    page.drawRectangle({ x: MARGIN, y: y - 4, width: A4.w - MARGIN * 2, height: 14, color: PURPLE });
    page.drawText(disciplina, { x: MARGIN + 4, y: y - 1, font: fontBold, size: 9, color: rgb(1, 1, 1) });
    y -= 18;

    let totalDisc = 0;
    for (const it of list) {
      if (y < 60) { page = pdfDoc.addPage([A4.w, A4.h]); y = A4.h - 50; }
      const ci = it.contract_items || {};
      const qtd = Number(it.quantidade_periodo || 0);
      const preco = Number(it.preco_unitario_snapshot || 0);
      const total = qtd * preco;
      totalDisc += total;
      page.drawText(ci.codigo || '', { x: MARGIN, y, font: fontRegular, size: 7, color: BLACK });
      page.drawText(String(ci.descricao || '').slice(0, 65), { x: 90, y, font: fontRegular, size: 7, color: BLACK });
      page.drawText(ci.unidade || '', { x: 360, y, font: fontRegular, size: 7, color: BLACK });
      page.drawText(formatNum(qtd, 3), { x: 395, y, font: fontRegular, size: 7, color: BLACK });
      page.drawText(formatBrl(preco), { x: 445, y, font: fontRegular, size: 7, color: BLACK });
      page.drawText(formatBrl(total), { x: 510, y, font: fontRegular, size: 7, color: BLACK });
      y -= 11;
    }
    y -= 2;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.w - MARGIN, y }, thickness: 0.3, color: SLATE });
    y -= 12;
    page.drawText(`Subtotal ${disciplina}`, { x: 380, y, font: fontBold, size: 8, color: PURPLE });
    page.drawText(formatBrl(totalDisc), { x: 510, y, font: fontBold, size: 8, color: PURPLE });
    y -= 16;
    totalGeral += totalDisc;
  }

  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.w - MARGIN, y }, thickness: 1, color: NAVY });
  y -= 14;
  page.drawText('TOTAL DO PERÍODO', { x: 380, y, font: fontBold, size: 10, color: NAVY });
  page.drawText(formatBrl(totalGeral), { x: 510, y, font: fontBold, size: 10, color: NAVY });
}

// =============================================================================
// VARIANTE: COMPLEMENTAR
// =============================================================================
function renderComplementar(ctx: Ctx) {
  const { pdfDoc, fontBold, fontRegular, m, items } = ctx;
  const page = pdfDoc.addPage([A4.w, A4.h]);
  pageTitle(page, fontBold, fontRegular, 'BOLETIM COMPLEMENTAR',
    `Complemento da medição original n.º ${m.numero}${m.complementar_numero ? ' — complementar ' + m.complementar_numero : ''}`);

  let y = A4.h - 100;
  const complementarItems = items.filter((it) => it.is_complementar === true || (it.tipo && it.tipo === 'complementar'));

  if (complementarItems.length === 0) {
    page.drawText('Esta medição não possui itens complementares.', { x: MARGIN, y, font: fontRegular, size: 10, color: SLATE });
    return;
  }

  page.drawRectangle({ x: MARGIN, y: y - 4, width: A4.w - MARGIN * 2, height: 14, color: LIGHT });
  page.drawText('Código', { x: MARGIN + 2, y, font: fontBold, size: 7, color: SLATE });
  page.drawText('Descrição', { x: 90, y, font: fontBold, size: 7, color: SLATE });
  page.drawText('Un', { x: 360, y, font: fontBold, size: 7, color: SLATE });
  page.drawText('Qtd', { x: 395, y, font: fontBold, size: 7, color: SLATE });
  page.drawText('P.unit.', { x: 445, y, font: fontBold, size: 7, color: SLATE });
  page.drawText('Total', { x: 510, y, font: fontBold, size: 7, color: SLATE });
  y -= 16;

  let total = 0;
  for (const it of complementarItems) {
    const ci = it.contract_items || {};
    const qtd = Number(it.quantidade_periodo || 0);
    const preco = Number(it.preco_unitario_snapshot || 0);
    const v = qtd * preco;
    total += v;
    page.drawText(ci.codigo || '', { x: MARGIN, y, font: fontRegular, size: 7, color: BLACK });
    page.drawText(String(ci.descricao || '').slice(0, 65), { x: 90, y, font: fontRegular, size: 7, color: BLACK });
    page.drawText(ci.unidade || '', { x: 360, y, font: fontRegular, size: 7, color: BLACK });
    page.drawText(formatNum(qtd, 3), { x: 395, y, font: fontRegular, size: 7, color: BLACK });
    page.drawText(formatBrl(preco), { x: 445, y, font: fontRegular, size: 7, color: BLACK });
    page.drawText(formatBrl(v), { x: 510, y, font: fontRegular, size: 7, color: BLACK });
    y -= 11;
  }

  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.w - MARGIN, y }, thickness: 0.5, color: NAVY });
  y -= 14;
  page.drawText('TOTAL COMPLEMENTAR', { x: 380, y, font: fontBold, size: 9, color: NAVY });
  page.drawText(formatBrl(total), { x: 510, y, font: fontBold, size: 9, color: NAVY });
}

// =============================================================================
// VARIANTE: EAP
// =============================================================================
function renderEap(ctx: Ctx) {
  const { pdfDoc, fontBold, fontRegular, contractItems } = ctx;
  const page = pdfDoc.addPage([A4.w, A4.h]);
  pageTitle(page, fontBold, fontRegular, 'BOLETIM POR EAP', 'Estrutura Analítica do Projeto — execução acumulada por nível hierárquico');

  let y = A4.h - 100;
  const roots: Record<string, { children: any[]; valor_total: number; valor_executado: number }> = {};
  for (const ci of contractItems) {
    const root = String(ci.codigo || '').split('.')[0] || 'ROOT';
    if (!roots[root]) roots[root] = { children: [], valor_total: 0, valor_executado: 0 };
    roots[root].children.push(ci);
    if (!ci.is_title) {
      const qc = Number(ci.quantidade_contratada || 0) + Number(ci.quantidade_aditada || 0);
      const qm = Number(ci.quantidade_medida_acumulada || 0);
      const preco = Number(ci.preco_unitario || 0);
      roots[root].valor_total += qc * preco;
      roots[root].valor_executado += qm * preco;
    }
  }

  page.drawRectangle({ x: MARGIN, y: y - 4, width: A4.w - MARGIN * 2, height: 14, color: LIGHT });
  page.drawText('Nível 1', { x: MARGIN + 2, y, font: fontBold, size: 7, color: SLATE });
  page.drawText('Descrição', { x: 80, y, font: fontBold, size: 7, color: SLATE });
  page.drawText('Itens', { x: 320, y, font: fontBold, size: 7, color: SLATE });
  page.drawText('Previsto', { x: 365, y, font: fontBold, size: 7, color: SLATE });
  page.drawText('Executado', { x: 450, y, font: fontBold, size: 7, color: SLATE });
  page.drawText('% Exec.', { x: 525, y, font: fontBold, size: 7, color: SLATE });
  y -= 16;

  let totalPrev = 0, totalExec = 0;
  for (const [root, info] of Object.entries(roots).sort()) {
    const pct = info.valor_total > 0 ? (info.valor_executado / info.valor_total) * 100 : 0;
    const firstTitle = info.children.find((c: any) => c.is_title);
    const desc = firstTitle?.descricao || info.children[0]?.descricao || '';
    page.drawText(root, { x: MARGIN, y, font: fontBold, size: 8, color: NAVY });
    page.drawText(String(desc).slice(0, 50), { x: 80, y, font: fontRegular, size: 8, color: BLACK });
    page.drawText(String(info.children.length), { x: 320, y, font: fontRegular, size: 8, color: BLACK });
    page.drawText(formatBrl(info.valor_total), { x: 365, y, font: fontRegular, size: 8, color: BLACK });
    page.drawText(formatBrl(info.valor_executado), { x: 450, y, font: fontRegular, size: 8, color: GREEN });
    page.drawText(formatNum(pct, 1) + '%', { x: 525, y, font: fontBold, size: 8,
      color: pct >= 80 ? GREEN : (pct >= 30 ? PURPLE : SLATE) });

    const barX = MARGIN, barY = y - 6, barW = A4.w - MARGIN * 2;
    page.drawRectangle({ x: barX, y: barY, width: barW, height: 3, color: LIGHT });
    page.drawRectangle({ x: barX, y: barY, width: barW * Math.min(pct, 100) / 100, height: 3,
      color: pct >= 80 ? GREEN : (pct >= 30 ? PURPLE : SLATE) });
    y -= 22;
    totalPrev += info.valor_total; totalExec += info.valor_executado;
  }

  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.w - MARGIN, y }, thickness: 0.5, color: NAVY });
  y -= 14;
  const pctGlobal = totalPrev > 0 ? (totalExec / totalPrev) * 100 : 0;
  page.drawText('TOTAL GERAL', { x: 80, y, font: fontBold, size: 10, color: NAVY });
  page.drawText(formatBrl(totalPrev), { x: 365, y, font: fontBold, size: 9, color: NAVY });
  page.drawText(formatBrl(totalExec), { x: 450, y, font: fontBold, size: 9, color: GREEN });
  page.drawText(formatNum(pctGlobal, 2) + '%', { x: 525, y, font: fontBold, size: 10, color: NAVY });
}

// =============================================================================
// VARIANTE: MAPA-GLOSAS
// =============================================================================
function renderMapaGlosas(ctx: Ctx) {
  const { pdfDoc, fontBold, fontRegular, glosses, retentions } = ctx;
  const page = pdfDoc.addPage([A4.w, A4.h]);
  pageTitle(page, fontBold, fontRegular, 'MAPA DE GLOSAS E RETENÇÕES',
    'Boletim auxiliar para auditoria — glosas por item e retenções aplicadas');
  let y = A4.h - 100;

  page.drawText('GLOSAS', { x: MARGIN, y, font: fontBold, size: 10, color: RED });
  y -= 14;
  if (glosses.length === 0) {
    page.drawText('Sem glosas registradas nesta medição.', { x: MARGIN, y, font: fontRegular, size: 9, color: SLATE });
    y -= 16;
  } else {
    page.drawRectangle({ x: MARGIN, y: y - 4, width: A4.w - MARGIN * 2, height: 14, color: LIGHT });
    page.drawText('Item', { x: MARGIN + 2, y, font: fontBold, size: 7, color: SLATE });
    page.drawText('Motivo', { x: 250, y, font: fontBold, size: 7, color: SLATE });
    page.drawText('Valor glosado', { x: 470, y, font: fontBold, size: 7, color: SLATE });
    y -= 14;
    let totalGlosa = 0;
    for (const g of glosses) {
      if (y < 60) break;
      const item = g.measurement_items || {};
      const v = Number(g.valor || 0);
      totalGlosa += v;
      page.drawText((item.codigo || '') + ' ' + String(item.descricao || '').slice(0, 30), { x: MARGIN, y, font: fontRegular, size: 7, color: BLACK });
      page.drawText(String(g.motivo || '').slice(0, 50), { x: 250, y, font: fontRegular, size: 7, color: BLACK });
      page.drawText(formatBrl(v), { x: 470, y, font: fontRegular, size: 7, color: RED });
      y -= 11;
    }
    y -= 4;
    page.drawText('Total glosado:', { x: 380, y, font: fontBold, size: 9, color: RED });
    page.drawText(formatBrl(totalGlosa), { x: 470, y, font: fontBold, size: 9, color: RED });
    y -= 20;
  }

  y -= 6;
  page.drawText('RETENÇÕES', { x: MARGIN, y, font: fontBold, size: 10, color: NAVY });
  y -= 14;
  if (retentions.length === 0) {
    page.drawText('Sem retenções aplicadas nesta medição.', { x: MARGIN, y, font: fontRegular, size: 9, color: SLATE });
  } else {
    page.drawRectangle({ x: MARGIN, y: y - 4, width: A4.w - MARGIN * 2, height: 14, color: LIGHT });
    page.drawText('Tipo', { x: MARGIN + 2, y, font: fontBold, size: 7, color: SLATE });
    page.drawText('Base de cálculo', { x: 200, y, font: fontBold, size: 7, color: SLATE });
    page.drawText('Alíquota', { x: 350, y, font: fontBold, size: 7, color: SLATE });
    page.drawText('Valor retido', { x: 470, y, font: fontBold, size: 7, color: SLATE });
    y -= 14;
    let totalRet = 0;
    for (const r of retentions) {
      if (y < 60) break;
      const v = Number(r.valor || 0);
      totalRet += v;
      page.drawText(String(r.tipo || '').toUpperCase(), { x: MARGIN, y, font: fontRegular, size: 7, color: BLACK });
      page.drawText(formatBrl(Number(r.base_calculo || 0)), { x: 200, y, font: fontRegular, size: 7, color: BLACK });
      page.drawText(formatNum(Number(r.aliquota || 0), 2) + '%', { x: 350, y, font: fontRegular, size: 7, color: BLACK });
      page.drawText(formatBrl(v), { x: 470, y, font: fontRegular, size: 7, color: BLACK });
      y -= 11;
    }
    y -= 4;
    page.drawText('Total retido:', { x: 380, y, font: fontBold, size: 9, color: NAVY });
    page.drawText(formatBrl(totalRet), { x: 470, y, font: fontBold, size: 9, color: NAVY });
  }
}

// =============================================================================
// CAMPO 15: valor por extenso
// =============================================================================
function renderValorPorExtenso(ctx: Ctx) {
  const { pdfDoc, fontBold, fontRegular, m } = ctx;
  const pages = pdfDoc.getPages();
  const page = pages[pages.length - 1];
  const valor = Number(m.valor_liquido || 0);
  const extenso = valorPorExtenso(valor);

  const y = 90;
  page.drawRectangle({ x: MARGIN, y: y - 4, width: A4.w - MARGIN * 2, height: 36, color: LIGHT, borderColor: NAVY, borderWidth: 0.6 });
  page.drawText('15. VALOR POR EXTENSO (R$ ' + formatNum(valor, 2) + ')', { x: MARGIN + 4, y: y + 24, font: fontBold, size: 7, color: NAVY });

  const lines = wrapText(extenso, 105);
  for (let i = 0; i < Math.min(lines.length, 2); i++) {
    page.drawText(lines[i], { x: MARGIN + 4, y: y + 10 - i * 11, font: fontRegular, size: 9, color: BLACK });
  }
}

// =============================================================================
// QR Code
// =============================================================================
function drawQR(page: PDFPage, fontRegular: PDFFont, fontBold: PDFFont, code: string) {
  try {
    const url = `${SITE_URL}/v/${code}`;
    const modules = encodeQR(url, 'utf8') as unknown as boolean[][];
    if (!Array.isArray(modules) || modules.length === 0) return;
    const sz = 70;
    const modSize = sz / modules.length;
    const startX = A4.w - sz - MARGIN;
    const startY = 60;
    page.drawRectangle({ x: startX - 4, y: startY - 4, width: sz + 8, height: sz + 8, color: rgb(1, 1, 1), borderColor: SLATE, borderWidth: 0.5 });
    for (let r = 0; r < modules.length; r++) {
      for (let c = 0; c < modules[r].length; c++) {
        if (modules[r][c]) {
          page.drawRectangle({
            x: startX + c * modSize,
            y: startY + (modules.length - r - 1) * modSize,
            width: modSize, height: modSize, color: BLACK,
          });
        }
      }
    }
    page.drawText('Validação pública', { x: startX, y: startY - 14, font: fontBold, size: 6, color: SLATE });
    page.drawText(url.replace('https://', ''), { x: startX, y: startY - 22, font: fontRegular, size: 6, color: NAVY });
  } catch (e) {
    console.error('[QR]', (e as Error).message);
  }
}
