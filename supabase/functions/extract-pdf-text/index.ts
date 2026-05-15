/**
 * extract-pdf-text — baixa um PDF do storage e extrai texto via pdf.js.
 *
 * Quando ged_document_version_id é informado, atualiza extracted_text na versão
 * e também atualiza ged_documents.metadata para que o trigger ged_documents_update_fulltext
 * reindexe (o texto extraído é misturado no peso C do fulltext via metadata::text).
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, notFound, serverError } from '../_shared/response.ts';

import * as pdfjs from 'https://esm.sh/pdfjs-dist@4.8.69/legacy/build/pdf.mjs?bundle&exclude=canvas';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const bucket = (body.storage_bucket as string) || 'ged-documents';
    const path = body.storage_path as string;
    const versionId = body.ged_document_version_id as string | undefined;
    const maxPages = Number(body.max_pages || 0) || 0; // 0 = todas
    if (!path) return fail('storage_path obrigatório');

    const svc = getServiceClient();
    const { data: blob, error: dlErr } = await svc.storage.from(bucket).download(path);
    if (dlErr || !blob) return notFound('Arquivo não encontrado no storage');

    const bytes = new Uint8Array(await blob.arrayBuffer());

    const doc = await pdfjs.getDocument({
      data: bytes,
      useSystemFonts: false,
      disableFontFace: true,
      isEvalSupported: false,
    }).promise;
    const numPages = doc.numPages;
    const pagesToRead = maxPages > 0 ? Math.min(maxPages, numPages) : numPages;

    const pages: string[] = [];
    for (let i = 1; i <= pagesToRead; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const text = (tc.items as Array<{ str: string }>).map((it) => it.str).join(' ');
      pages.push(text);
    }
    const fullText = pages.join('\n\n').replace(/\s+/g, ' ').trim();

    let indexed = false;
    let docId: string | null = null;
    if (versionId) {
      // extracted_text é a coluna real (legado da EF usava full_text que não existe)
      const { data: ver, error: upErr } = await svc.from('ged_document_versions')
        .update({ extracted_text: fullText, updated_at: new Date().toISOString() })
        .eq('id', versionId)
        .select('document_id, status')
        .single();
      if (upErr) return fail('Falha ao atualizar versão: ' + upErr.message);
      indexed = true;
      docId = ver?.document_id || null;

      // Se a versão é vigente, propaga uma chave de texto extraído no metadata do documento
      // para o trigger ged_documents_update_fulltext indexar no peso C do fulltext.
      if (ver?.status === 'vigente' && docId) {
        const { data: docRow } = await svc.from('ged_documents').select('metadata').eq('id', docId).maybeSingle();
        const meta = (docRow?.metadata && typeof docRow.metadata === 'object') ? { ...docRow.metadata } : {};
        (meta as Record<string, unknown>)._extracted_text = fullText.slice(0, 50_000); // limita para não estourar o tsvector
        await svc.from('ged_documents')
          .update({ metadata: meta, updated_at: new Date().toISOString() })
          .eq('id', docId);
      }
    }

    return ok({
      pages: numPages,
      pages_read: pagesToRead,
      length: fullText.length,
      preview: fullText.slice(0, 500),
      indexed,
      document_id: docId,
    });
  } catch (e) {
    return serverError(e);
  }
});
