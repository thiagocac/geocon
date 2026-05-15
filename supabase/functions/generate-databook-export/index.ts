/**
 * generate-databook-export — exporta o DataBook (todos os documentos da GED
 * de um contrato em estrutura organizada por categoria/disciplina, com
 * manifest e hash SHA-256). Resultado: ZIP no bucket databook-exports.
 *
 * Body:
 *   { contract_id?: string, tenant_id?: string, filter?: { category?: string, disciplina?: string } }
 */
import JSZip from 'https://esm.sh/jszip@3.10.1';

import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, serverError } from '../_shared/response.ts';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100);
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const contractId = body.contract_id as string | undefined;
    const tenantId = body.tenant_id as string | undefined;
    if (!contractId && !tenantId) return fail('contract_id ou tenant_id obrigatório');

    const svc = getServiceClient();

    let q = svc
      .from('ged_documents')
      .select('*, ged_categories(nome,codigo), contracts(numero,tenant_id), disciplines(nome), latest_version:ged_document_versions(id,revisao,storage_path,storage_bucket,file_name,sha256,created_at)')
      .is('deleted_at', null);
    if (contractId) q = q.eq('contract_id', contractId);
    if (tenantId) q = q.eq('tenant_id', tenantId);

    const { data: docs, error } = await q;
    if (error) throw error;
    if (!docs || docs.length === 0) return fail('Nenhum documento encontrado', 404);

    // Resolve tenant para storage de saída
    const resolvedTenantId = tenantId || docs[0]?.contracts?.tenant_id;

    const zip = new JSZip();
    const manifest: Array<{ path: string; sha256: string; size: number; metadata: Record<string, unknown> }> = [];

    for (const d of docs) {
      const ver = Array.isArray(d.latest_version) ? d.latest_version[d.latest_version.length - 1] : d.latest_version;
      if (!ver?.storage_path) continue;

      const bucket = ver.storage_bucket || 'ged-documents';
      const { data: blob } = await svc.storage.from(bucket).download(ver.storage_path);
      if (!blob) continue;

      const bytes = new Uint8Array(await blob.arrayBuffer());
      const cat = safeFilename(d.ged_categories?.nome || 'sem_categoria');
      const disc = safeFilename(d.disciplines?.nome || 'sem_disciplina');
      const fname = safeFilename(ver.file_name || `${d.codigo}_rev${ver.revisao}.pdf`);
      const zipPath = `${cat}/${disc}/${fname}`;

      zip.file(zipPath, bytes);
      manifest.push({
        path: zipPath,
        sha256: ver.sha256 || await sha256Hex(bytes),
        size: bytes.length,
        metadata: {
          codigo: d.codigo,
          titulo: d.titulo,
          revisao: ver.revisao,
          categoria: d.ged_categories?.nome,
          disciplina: d.disciplines?.nome,
          contrato: d.contracts?.numero,
          created_at: ver.created_at,
        },
      });
    }

    zip.file('manifest.json', JSON.stringify({
      generated_at: new Date().toISOString(),
      tenant_id: resolvedTenantId,
      contract_id: contractId || null,
      total_files: manifest.length,
      files: manifest,
    }, null, 2));

    const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const outPath = `tenants/${resolvedTenantId}/${contractId ? `contracts/${contractId}/` : ''}databook_${Date.now()}.zip`;

    const { error: upErr } = await svc.storage
      .from('databook-exports')
      .upload(outPath, zipBytes, { contentType: 'application/zip', upsert: true });
    if (upErr) throw upErr;

    const { data: signed } = await svc.storage.from('databook-exports').createSignedUrl(outPath, 3600);

    // Cria registro de validação pública para o DataBook
    const hash = await sha256Hex(zipBytes);
    const codeBytes = new Uint8Array(8);
    crypto.getRandomValues(codeBytes);
    const code = Array.from(codeBytes).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

    await svc.from('public_validation_records').insert({
      tenant_id: resolvedTenantId,
      code,
      entity_type: 'databook_export',
      entity_id: contractId || resolvedTenantId,
      title: `DataBook — ${contractId ? 'contrato' : 'tenant'} (${manifest.length} arquivos)`,
      hash_sha256: hash,
      storage_path: outPath,
      active: true,
      metadata: { files: manifest.length, contract_id: contractId },
    });

    return ok({
      storage_path: outPath,
      signed_url: signed?.signedUrl,
      files_count: manifest.length,
      size_bytes: zipBytes.length,
      validation_code: code,
    });
  } catch (e) {
    return serverError(e);
  }
});
