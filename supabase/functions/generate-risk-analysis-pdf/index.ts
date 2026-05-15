/**
 * generate-risk-analysis-pdf — gera o PDF auditável da Análise de Risco de um contrato.
 *
 * Input: { contract_id: uuid }
 * Output: { storage_path, hash_sha256, public_validation_code, validation_url, size_bytes }
 *
 * Renderiza:
 *   - Cabeçalho com tenant + número/objeto do contrato
 *   - Score grande + nível colorido
 *   - Breakdown dos 4 componentes do score (avanço, alertas, gap, saldo)
 *   - Sinais operacionais (pendências, aditivos, medições atrasadas)
 *   - Forecast 3/6/12 vs saldo
 *   - Recomendações (de get_contract_risk_recommendations)
 *   - Tabela com últimos 10 snapshots históricos (evolução do score)
 *   - QR code de validação pública + hash SHA-256 + footer
 *
 * Captura snapshot 'pdf_export' antes de gerar.
 */
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1';
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
const ERROR   = rgb(0.871, 0.176, 0.196);
const WARNING = rgb(0.945, 0.604, 0.114);
const SUCCESS = rgb(0.118, 0.518, 0.169);

const SITE_URL = Deno.env.get('SITE_URL') || 'https://contratos.consultegeo.org';
const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 40;

function brl(n: number | null | undefined): string {
  const v = Number(n || 0);
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function num(n: number | null | undefined, digits = 2): string {
  const v = Number(n || 0);
  return v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

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

function randomCode(): string {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function nivelColor(nivel: string) {
  switch (nivel) {
    case 'critico':   return { fill: rgb(0.992, 0.890, 0.890), border: ERROR,   label: 'CRÍTICO' };
    case 'atencao':   return { fill: rgb(1.000, 0.957, 0.835), border: WARNING, label: 'ATENÇÃO' };
    case 'monitorar': return { fill: rgb(0.866, 0.929, 0.988), border: rgb(0.235, 0.510, 0.961), label: 'MONITORAR' };
    default:          return { fill: rgb(0.870, 0.955, 0.890), border: SUCCESS, label: 'ESTÁVEL' };
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const contractId = body.contract_id as string;
    if (!contractId) return fail('contract_id obrigatório');

    const svc = getServiceClient();

    // Captura snapshot 'pdf_export' antes
    let snap = null;
    try {
      const { data: snapRow } = await svc.rpc('capture_risk_snapshot', {
        p_contract_id: contractId, p_source: 'pdf_export',
      });
      snap = snapRow;
    } catch (e) {
      console.warn('[snapshot]', (e as Error).message);
    }

    // Busca análise de risco
    const { data: r, error: rErr } = await svc
      .from('v_contract_risk_analysis')
      .select('*')
      .eq('contract_id', contractId)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!r) return notFound('Contrato não encontrado na análise de risco');

    // Recomendações
    const { data: recsData } = await svc.rpc('get_contract_risk_recommendations', { p_contract_id: contractId });
    const recommendations = Array.isArray(recsData?.recommendations) ? recsData.recommendations : [];
    const nivel = (recsData?.nivel as string) || 'estavel';

    // Histórico (últimos 10)
    const { data: history } = await svc
      .from('contract_risk_snapshots')
      .select('captured_at, captured_date, score, nivel, source')
      .eq('contract_id', contractId)
      .order('captured_at', { ascending: false })
      .limit(10);

    // Tenant info para cabeçalho
    const { data: tenant } = await svc
      .from('tenants')
      .select('nome, brand_logo_url')
      .eq('id', r.tenant_id)
      .maybeSingle();

    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([A4.w, A4.h]);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontMono    = await pdfDoc.embedFont(StandardFonts.Courier);

    let y = A4.h - MARGIN;

    // === CABEÇALHO ===
    page.drawRectangle({ x: 0, y: A4.h - 60, width: A4.w, height: 60, color: NAVY });
    page.drawText('ANÁLISE DE RISCO CONTRATUAL', {
      x: MARGIN, y: A4.h - 30, font: fontBold, size: 16, color: rgb(1, 1, 1),
    });
    page.drawText(tenant?.nome || 'geoCon · Consulte GEO', {
      x: MARGIN, y: A4.h - 48, font: fontRegular, size: 9, color: rgb(0.85, 0.85, 0.95),
    });
    page.drawText(new Date().toLocaleString('pt-BR'), {
      x: A4.w - MARGIN - 100, y: A4.h - 30, font: fontRegular, size: 8, color: rgb(0.85, 0.85, 0.95),
    });

    y = A4.h - 80;

    // === IDENTIFICAÇÃO DO CONTRATO ===
    page.drawText(`Contrato ${r.numero}`, { x: MARGIN, y, font: fontBold, size: 13, color: BLACK });
    y -= 14;
    const objLines = wrapText(r.objeto || '', 95);
    for (const line of objLines.slice(0, 3)) {
      page.drawText(line, { x: MARGIN, y, font: fontRegular, size: 9, color: SLATE });
      y -= 11;
    }
    if (r.contratada_nome) {
      page.drawText(`Contratada: ${r.contratada_nome}`, { x: MARGIN, y, font: fontRegular, size: 9, color: SLATE });
      y -= 11;
    }
    y -= 5;

    // === SCORE + NÍVEL ===
    const nivelMeta = nivelColor(nivel);
    const boxH = 80;
    page.drawRectangle({ x: MARGIN, y: y - boxH, width: A4.w - MARGIN * 2, height: boxH,
      color: nivelMeta.fill, borderColor: nivelMeta.border, borderWidth: 1.5 });

    // Score grande à esquerda
    page.drawText(String(r.score), {
      x: MARGIN + 20, y: y - 55, font: fontBold, size: 42, color: nivelMeta.border,
    });
    page.drawText('/ 100', { x: MARGIN + 105, y: y - 50, font: fontRegular, size: 12, color: SLATE });
    page.drawText('SCORE DE RISCO', { x: MARGIN + 20, y: y - 70, font: fontBold, size: 8, color: SLATE });

    // Nível e dados à direita
    page.drawRectangle({
      x: MARGIN + 170, y: y - 38, width: 90, height: 18,
      color: nivelMeta.border,
    });
    page.drawText(nivelMeta.label, {
      x: MARGIN + 175, y: y - 33, font: fontBold, size: 10, color: rgb(1, 1, 1),
    });

    page.drawText(`Valor atual: ${brl(r.valor_atual)}`, {
      x: MARGIN + 170, y: y - 56, font: fontRegular, size: 10, color: BLACK,
    });
    page.drawText(`Saldo: ${brl(r.saldo_contratual)} (${num(r.pct_saldo, 1)}%)`, {
      x: MARGIN + 170, y: y - 70, font: fontRegular, size: 9, color: SLATE,
    });

    // Mini-trend ao lado direito
    if (history && history.length > 1) {
      const sx = A4.w - MARGIN - 130;
      const sy = y - 25;
      const sw = 110;
      const sh = 40;
      const scores = history.slice().reverse().map((h) => h.score as number);
      const maxS = 100;
      page.drawRectangle({ x: sx, y: sy - sh, width: sw, height: sh, borderColor: SLATE, borderWidth: 0.5 });
      page.drawText('Evolução (10 últimos)', { x: sx, y: sy + 5, font: fontBold, size: 7, color: SLATE });
      const step = sw / Math.max(1, scores.length - 1);
      for (let i = 0; i < scores.length - 1; i++) {
        const x1 = sx + i * step;
        const x2 = sx + (i + 1) * step;
        const y1 = sy - sh + (scores[i] / maxS) * sh;
        const y2 = sy - sh + (scores[i + 1] / maxS) * sh;
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1.2, color: nivelMeta.border });
      }
      // Marcador final
      const lastX = sx + (scores.length - 1) * step;
      const lastY = sy - sh + (scores[scores.length - 1] / maxS) * sh;
      page.drawCircle({ x: lastX, y: lastY, size: 2.5, color: nivelMeta.border });
    }

    y -= boxH + 15;

    // === BREAKDOWN DOS 4 COMPONENTES ===
    page.drawText('COMPOSIÇÃO DO SCORE', { x: MARGIN, y, font: fontBold, size: 11, color: NAVY });
    y -= 14;
    page.drawText('Cada componente é independente. Componentes em zero não indicam problema.',
      { x: MARGIN, y, font: fontRegular, size: 8, color: SLATE });
    y -= 14;

    const components = [
      { label: 'Avanço financeiro',     score: r.score_avanco,         max: 30,
        detail: `${num(r.percentual_financeiro)}% medido / ${num(r.percentual_fisico)}% físico` },
      { label: 'Alertas legais',        score: r.score_alertas_legais, max: 25,
        detail: r.alertas?.length ? `${r.alertas.length} alerta(s) ativo(s)` : 'Sem alertas legais' },
      { label: 'Gap físico-financeiro', score: r.score_gap,            max: 25,
        detail: `${num(r.gap_fis_fin)}pp ${(r.gap_fis_fin || 0) >= 0 ? 'à frente' : 'atrás'}` },
      { label: 'Saldo remanescente',    score: r.score_saldo,          max: 20,
        detail: `${brl(r.saldo_contratual)} (${num(r.pct_saldo, 1)}% do valor atual)` },
    ];

    for (const c of components) {
      const rowH = 22;
      const isProblem = c.score > 0;
      const color = isProblem ? ERROR : SLATE;

      page.drawText(c.label, { x: MARGIN, y, font: fontBold, size: 9, color: BLACK });
      page.drawText(`${c.score} / ${c.max}`, {
        x: A4.w - MARGIN - 50, y, font: fontMono, size: 9, color,
      });
      y -= 11;

      // barra de progresso
      const barW = A4.w - MARGIN * 2;
      const pct = c.max > 0 ? c.score / c.max : 0;
      page.drawRectangle({ x: MARGIN, y: y - 4, width: barW, height: 4, color: LIGHT });
      if (pct > 0) {
        page.drawRectangle({ x: MARGIN, y: y - 4, width: barW * pct, height: 4, color });
      }
      y -= 8;
      page.drawText(c.detail, { x: MARGIN, y, font: fontRegular, size: 8, color: SLATE });
      y -= rowH - 11;
    }

    y -= 8;

    // === SINAIS OPERACIONAIS ===
    page.drawText('SINAIS OPERACIONAIS', { x: MARGIN, y, font: fontBold, size: 11, color: NAVY });
    y -= 16;

    const signals = [
      { label: 'Pendências alta severidade', value: String(r.pendencias_high),
        critical: r.pendencias_high > 0 },
      { label: 'Pendências média',           value: String(r.pendencias_medium),
        critical: r.pendencias_medium > 0 },
      { label: 'Medições em aprovação > 7d', value: String(r.medicoes_em_aprovacao_atrasadas),
        critical: r.medicoes_em_aprovacao_atrasadas > 0 },
      { label: 'Aditivos vs. inicial',       value: `${num(r.pct_aditivos_sobre_inicial, 1)}%`,
        critical: (r.pct_aditivos_sobre_inicial || 0) > 15 },
    ];

    const sigCellW = (A4.w - MARGIN * 2) / 4;
    for (let i = 0; i < signals.length; i++) {
      const s = signals[i];
      const x = MARGIN + i * sigCellW;
      const fill = s.critical ? rgb(0.992, 0.890, 0.890) : LIGHT;
      page.drawRectangle({ x: x + 2, y: y - 36, width: sigCellW - 4, height: 36, color: fill, borderColor: SLATE, borderWidth: 0.3 });
      page.drawText(s.label, { x: x + 6, y: y - 12, font: fontRegular, size: 7, color: SLATE });
      page.drawText(s.value, { x: x + 6, y: y - 28, font: fontBold, size: 14, color: s.critical ? ERROR : BLACK });
    }
    y -= 50;

    // === FORECAST ===
    if (r.forecast_3m != null || r.forecast_6m != null || r.forecast_12m != null) {
      page.drawText('FORECAST VS. SALDO', { x: MARGIN, y, font: fontBold, size: 11, color: NAVY });
      y -= 16;

      const forecasts = [
        { label: '3 meses',  v: Number(r.forecast_3m || 0) },
        { label: '6 meses',  v: Number(r.forecast_6m || 0) },
        { label: '12 meses', v: Number(r.forecast_12m || 0) },
      ];
      const saldo = Number(r.saldo_contratual || 0);
      const fcW = (A4.w - MARGIN * 2) / 3;
      for (let i = 0; i < forecasts.length; i++) {
        const f = forecasts[i];
        const x = MARGIN + i * fcW;
        const excede = f.v > saldo;
        const color = excede ? ERROR : BLACK;
        page.drawRectangle({ x: x + 2, y: y - 38, width: fcW - 4, height: 38,
          borderColor: excede ? ERROR : SLATE, borderWidth: excede ? 1 : 0.3,
          color: excede ? rgb(0.998, 0.957, 0.957) : rgb(1, 1, 1) });
        page.drawText(`Próximos ${f.label}`, { x: x + 6, y: y - 12, font: fontRegular, size: 7, color: SLATE });
        page.drawText(brl(f.v), { x: x + 6, y: y - 25, font: fontBold, size: 11, color });
        const hint = excede ? `excede saldo em ${brl(f.v - saldo)}` : `${num(saldo > 0 ? (f.v / saldo) * 100 : 0, 1)}% do saldo`;
        page.drawText(hint, { x: x + 6, y: y - 34, font: fontRegular, size: 7, color: excede ? ERROR : SLATE });
      }
      y -= 50;
    }

    // === RECOMENDAÇÕES ===
    page.drawText('RECOMENDAÇÕES', { x: MARGIN, y, font: fontBold, size: 11, color: NAVY });
    y -= 14;

    for (const rec of recommendations) {
      // Quebra de página se necessário
      if (y < 140) {
        const newPage = pdfDoc.addPage([A4.w, A4.h]);
        page = newPage;
        y = A4.h - MARGIN;
      }

      const prioColor = rec.prioridade === 'alta' ? ERROR : rec.prioridade === 'media' ? WARNING : SLATE;
      page.drawRectangle({ x: MARGIN, y: y - 3, width: 3, height: -45, color: prioColor });

      page.drawText(`[${(rec.prioridade as string || 'media').toUpperCase()}]`, {
        x: MARGIN + 8, y, font: fontBold, size: 7, color: prioColor,
      });
      page.drawText(rec.titulo || '', { x: MARGIN + 42, y, font: fontBold, size: 9, color: BLACK });
      y -= 12;
      const descLines = wrapText(rec.descricao || '', 110);
      for (const line of descLines.slice(0, 3)) {
        page.drawText(line, { x: MARGIN + 8, y, font: fontRegular, size: 8, color: SLATE });
        y -= 10;
      }
      y -= 8;
    }

    // === HISTÓRICO ===
    if (history && history.length > 0) {
      if (y < 200) {
        const newPage = pdfDoc.addPage([A4.w, A4.h]);
        page = newPage;
        y = A4.h - MARGIN;
      }
      page.drawText('HISTÓRICO DE SNAPSHOTS', { x: MARGIN, y, font: fontBold, size: 11, color: NAVY });
      y -= 14;
      page.drawText('Últimas 10 capturas do score, mais recente primeiro', { x: MARGIN, y, font: fontRegular, size: 8, color: SLATE });
      y -= 12;

      // Header tabela
      page.drawRectangle({ x: MARGIN, y: y - 14, width: A4.w - MARGIN * 2, height: 14, color: LIGHT });
      page.drawText('Data',   { x: MARGIN + 6,   y: y - 10, font: fontBold, size: 8, color: SLATE });
      page.drawText('Score',  { x: MARGIN + 120, y: y - 10, font: fontBold, size: 8, color: SLATE });
      page.drawText('Nível',  { x: MARGIN + 170, y: y - 10, font: fontBold, size: 8, color: SLATE });
      page.drawText('Origem', { x: MARGIN + 250, y: y - 10, font: fontBold, size: 8, color: SLATE });
      y -= 16;

      for (const h of history) {
        page.drawText(fmtDate((h as { captured_date: string }).captured_date) + ' ' + new Date((h as { captured_at: string }).captured_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), {
          x: MARGIN + 6, y, font: fontRegular, size: 8, color: BLACK,
        });
        page.drawText(String((h as { score: number }).score), { x: MARGIN + 120, y, font: fontMono, size: 8, color: BLACK });
        page.drawText(((h as { nivel: string }).nivel || '').toUpperCase(), { x: MARGIN + 170, y, font: fontRegular, size: 8, color: nivelColor((h as { nivel: string }).nivel).border });
        page.drawText((h as { source: string }).source, { x: MARGIN + 250, y, font: fontMono, size: 7, color: SLATE });
        y -= 12;
      }
    }

    // === Validação pública ===
    const code = randomCode();

    // QR + hash no rodapé da última página
    try {
      const url = `${SITE_URL}/v/${code}`;
      const modules = encodeQR(url, 'utf8') as unknown as boolean[][];
      if (Array.isArray(modules) && modules.length > 0) {
        const sz = 55;
        const modSize = sz / modules.length;
        const startX = A4.w - sz - MARGIN;
        const startY = 60;
        page.drawRectangle({ x: startX - 4, y: startY - 4, width: sz + 8, height: sz + 8,
          color: rgb(1, 1, 1), borderColor: SLATE, borderWidth: 0.5 });
        for (let row = 0; row < modules.length; row++) {
          for (let col = 0; col < modules[row].length; col++) {
            if (modules[row][col]) {
              page.drawRectangle({
                x: startX + col * modSize,
                y: startY + (modules.length - row - 1) * modSize,
                width: modSize, height: modSize, color: BLACK,
              });
            }
          }
        }
        page.drawText('Validação pública', { x: startX, y: startY - 12, font: fontBold, size: 6, color: SLATE });
      }
    } catch (e) {
      console.error('[QR]', (e as Error).message);
    }

    // Footer em todas as páginas
    const pages = pdfDoc.getPages();
    for (let i = 0; i < pages.length; i++) {
      pages[i].drawText(`Validação: ${code}`, { x: MARGIN, y: 24, font: fontRegular, size: 7, color: SLATE });
      pages[i].drawText(`Contrato ${r.numero}`, { x: A4.w / 2 - 40, y: 24, font: fontRegular, size: 7, color: SLATE });
      pages[i].drawText(`Página ${i + 1} de ${pages.length}`, { x: A4.w - 100, y: 24, font: fontRegular, size: 7, color: SLATE });
    }

    pdfDoc.setTitle(`Análise de Risco — Contrato ${r.numero}`);
    pdfDoc.setAuthor('geoCon · Consulte GEO');
    pdfDoc.setProducer('geoCon EF generate-risk-analysis-pdf v1');
    pdfDoc.setSubject(`Score ${r.score} (${nivel}) em ${new Date().toISOString()}`);

    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    const hash = await sha256Hex(pdfBytes);
    const storagePath = `tenants/${r.tenant_id}/contracts/${contractId}/risk/${new Date().toISOString().slice(0, 10)}-${code}.pdf`;

    const { error: upErr } = await svc.storage.from('reports').upload(storagePath, pdfBytes, {
      contentType: 'application/pdf', upsert: true,
    });
    if (upErr) throw upErr;

    // Registra para validação pública
    await svc.from('public_validation_records').upsert({
      tenant_id: r.tenant_id,
      code,
      entity_type: 'risk_analysis',
      entity_id: contractId,
      title: `Análise de Risco — Contrato ${r.numero}`,
      hash_sha256: hash,
      storage_path: storagePath,
      active: true,
      metadata: {
        score: r.score, nivel,
        snapshot_id: snap?.id || null,
        generated_at: new Date().toISOString(),
      },
    }, { onConflict: 'code' });

    // Registra como generated_report (se houver tabela)
    try {
      await svc.from('generated_reports').insert({
        tenant_id: r.tenant_id,
        contract_id: contractId,
        report_type: 'risk_analysis',
        title: `Análise de Risco — ${r.numero} — ${new Date().toLocaleDateString('pt-BR')}`,
        storage_path: storagePath,
        mime_type: 'application/pdf',
        filters: { score: r.score, nivel },
        status: 'gerado',
        generated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[generated_reports]', (e as Error).message);
    }

    return ok({
      storage_path: storagePath,
      hash_sha256: hash,
      public_validation_code: code,
      validation_url: `${SITE_URL}/v/${code}`,
      size_bytes: pdfBytes.length,
      score: r.score,
      nivel,
    });
  } catch (e) {
    console.error('[generate-risk-analysis-pdf]', e);
    return serverError(e);
  }
});
