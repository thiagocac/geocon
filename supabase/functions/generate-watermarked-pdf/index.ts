/**
 * generate-watermarked-pdf — V68
 *
 * Aplica overlay "CÓPIA NÃO CONTROLADA" + footer com fingerprint sobre um PDF
 * armazenado no GED Storage. Retorna o PDF marcado em streaming + grava
 * audit em ged_watermark_log.
 *
 * Body:
 *   {
 *     version_id: uuid,
 *     recipient_label?: string,      // ex: "Para: Eng. João Silva"
 *     override_settings?: {          // opcional, sobrepõe defaults do tenant
 *       texto?, texto_secundario?, opacidade?, angulo_graus?,
 *       tamanho_fonte?, cor_hex?, incluir_timestamp?, incluir_fingerprint?
 *     }
 *   }
 *
 * Output: application/pdf stream, header X-Watermark-Fingerprint contém o id.
 *
 * Notas de ICP-Brasil: se settings.icp_brasil_enabled=true, esta versão V68
 * grava apenas o flag no log; assinatura digital real fica para V69+ (exige
 * integração com PSC autorizado).
 */
import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  PDFDocument, StandardFonts, rgb, degrees,
} from 'https://esm.sh/pdf-lib@1.17.1';

interface WatermarkSettings {
  texto: string;
  texto_secundario: string | null;
  opacidade: number;
  angulo_graus: number;
  tamanho_fonte: number;
  cor_hex: string;
  incluir_timestamp: boolean;
  incluir_fingerprint: boolean;
  icp_brasil_enabled: boolean;
  icp_brasil_signer_label: string | null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.match(/^#([0-9A-Fa-f]{6})$/);
  if (!m) return { r: 1, g: 0, b: 0 }; // fallback vermelho
  const n = parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}

function shortFingerprint(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userToken   = req.headers.get('Authorization')?.replace('Bearer ', '') || '';

    // Cliente com token do usuário (para RLS e auth.uid())
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });
    // Cliente service role para storage + INSERT no log
    const adminClient = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { version_id, recipient_label, override_settings } = body;

    if (!version_id) {
      return new Response(JSON.stringify({ error: 'version_id obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1) Carrega versão + valida acesso via RLS
    const { data: version, error: vErr } = await userClient
      .from('ged_document_versions')
      .select('id, document_id, storage_path, mime_type, tenant_id, revision, ged_documents(title)')
      .eq('id', version_id)
      .is('deleted_at', null)
      .single();
    if (vErr || !version) {
      return new Response(JSON.stringify({ error: 'Versão não encontrada ou sem acesso' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (version.mime_type !== 'application/pdf') {
      return new Response(JSON.stringify({ error: 'Apenas PDFs suportam marca d\'água' }), {
        status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2) Carrega settings (com override)
    const { data: settingsRaw } = await userClient.rpc('get_ged_watermark_settings');
    const settings: WatermarkSettings = { ...(settingsRaw as WatermarkSettings), ...(override_settings || {}) };

    // 3) Identifica downloader
    const { data: { user } } = await userClient.auth.getUser();
    let downloaderMember: { id: string; nome: string; email: string } | null = null;
    if (user) {
      const { data: m } = await adminClient
        .from('members').select('id,nome,email')
        .eq('user_id', user.id).eq('tenant_id', version.tenant_id)
        .maybeSingle();
      downloaderMember = m as { id: string; nome: string; email: string } | null;
    }

    // 4) Baixa PDF original do Storage
    const { data: blob, error: dlErr } = await adminClient.storage
      .from('ged-documents').download(version.storage_path);
    if (dlErr || !blob) {
      return new Response(JSON.stringify({ error: 'Falha ao baixar PDF do storage' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5) Carrega pdf-lib + aplica overlay
    const buf = await blob.arrayBuffer();
    const pdf = await PDFDocument.load(buf);
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    const fontReg = await pdf.embedFont(StandardFonts.Helvetica);
    const { r, g, b } = hexToRgb(settings.cor_hex);
    const fingerprint = shortFingerprint();

    const pages = pdf.getPages();
    for (const page of pages) {
      const { width, height } = page.getSize();

      // Texto principal grande no centro, em diagonal
      const textWidth = font.widthOfTextAtSize(settings.texto, settings.tamanho_fonte);
      page.drawText(settings.texto, {
        x: width / 2 - textWidth / 2,
        y: height / 2 - settings.tamanho_fonte / 2,
        size: settings.tamanho_fonte,
        font,
        color: rgb(r, g, b),
        opacity: settings.opacidade,
        rotate: degrees(settings.angulo_graus),
      });

      // Texto secundário (menor, abaixo do principal)
      if (settings.texto_secundario) {
        const sub = settings.texto_secundario;
        const subSize = Math.max(12, Math.round(settings.tamanho_fonte * 0.4));
        const subWidth = fontReg.widthOfTextAtSize(sub, subSize);
        page.drawText(sub, {
          x: width / 2 - subWidth / 2,
          y: height / 2 - settings.tamanho_fonte / 2 - subSize * 1.5,
          size: subSize,
          font: fontReg,
          color: rgb(r, g, b),
          opacity: settings.opacidade,
          rotate: degrees(settings.angulo_graus),
        });
      }

      // Footer com fingerprint + timestamp
      const footerParts: string[] = [];
      if (settings.incluir_fingerprint) footerParts.push(`FP: ${fingerprint}`);
      if (settings.incluir_timestamp)   footerParts.push(new Date().toLocaleString('pt-BR'));
      if (recipient_label)              footerParts.push(recipient_label);
      if (settings.icp_brasil_enabled)  footerParts.push('[ICP-Brasil ativado]');
      const footer = footerParts.join(' · ');
      if (footer) {
        page.drawText(footer, {
          x: 24, y: 12,
          size: 7,
          font: fontReg,
          color: rgb(0.4, 0.4, 0.4),
          opacity: 0.8,
        });
      }
    }

    const outBytes = await pdf.save();

    // 6) Grava log (service role)
    const { error: logErr } = await adminClient
      .from('ged_watermark_log')
      .insert({
        tenant_id: version.tenant_id,
        document_id: version.document_id,
        version_id: version.id,
        downloader_id: downloaderMember?.id || null,
        downloader_nome: downloaderMember?.nome || null,
        downloader_email: downloaderMember?.email || null,
        recipient_label: recipient_label || null,
        fingerprint,
        ip_addr: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        user_agent: req.headers.get('user-agent') || null,
        icp_brasil_signed: settings.icp_brasil_enabled,
        metadata: { revision: version.revision },
      });
    if (logErr) {
      // Não bloqueia download; só registra
      console.error('[watermark] failed to log download', logErr);
    }

    // 7) Retorna PDF
    return new Response(outBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="watermarked-${fingerprint}.pdf"`,
        'X-Watermark-Fingerprint': fingerprint,
        'X-Watermark-Pages': String(pages.length),
      },
    });
  } catch (err) {
    console.error('[watermark] error', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
