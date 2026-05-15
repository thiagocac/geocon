/**
 * generate-audit-package — gera pacote auditável ZIP de um contrato (ou
 * medição específica). Inclui:
 *   - contract.json (metadados normalizados)
 *   - measurements/<n>/boletim.pdf (referência via storage)
 *   - measurements/<n>/items.json
 *   - additives/<n>.json
 *   - workflow_history.json
 *   - manifest.json com hash SHA-256 de cada arquivo
 *
 * Como zip nativo Deno é limitado, usamos jszip (esm.sh).
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, notFound, serverError } from '../_shared/response.ts';
import JSZip from 'https://esm.sh/jszip@3.10.1';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const contractId = body.contract_id as string;
    const measurementId = body.measurement_id as string | undefined;
    if (!contractId) return fail('contract_id obrigatório');

    const svc = getServiceClient();

    const { data: contract, error: cErr } = await svc
      .from('contracts')
      .select('*, tenants(nome), contratante:contract_organizations!contracts_contratante_id_fkey(*), contratada:contract_organizations!contracts_contratada_id_fkey(*)')
      .eq('id', contractId)
      .maybeSingle();
    if (cErr || !contract) return notFound('Contrato não encontrado');

    const { data: measurements } = await svc
      .from('measurements')
      .select('*')
      .eq('contract_id', contractId)
      .is('deleted_at', null)
      .order('numero');

    const { data: additives } = await svc
      .from('additives')
      .select('*, additive_items(*)')
      .eq('contract_id', contractId)
      .is('deleted_at', null)
      .order('numero');

    const { data: workflowSteps } = await svc
      .from('approval_steps')
      .select('*, workflow_instances!inner(entity_type,entity_id)')
      .eq('workflow_instances.tenant_id', contract.tenant_id)
      .limit(2000);

    const zip = new JSZip();
    const manifest: Array<{ path: string; sha256: string; size: number }> = [];

    async function addToZip(path: string, content: string | Uint8Array) {
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      zip.file(path, bytes);
      manifest.push({ path, sha256: await sha256Hex(bytes), size: bytes.length });
    }

    await addToZip('contract.json', JSON.stringify(contract, null, 2));

    for (const m of measurements || []) {
      if (measurementId && m.id !== measurementId) continue;

      const { data: items } = await svc
        .from('measurement_items')
        .select('*, contract_items(codigo,descricao,unidade)')
        .eq('measurement_id', m.id)
        .is('deleted_at', null);

      await addToZip(`measurements/${m.numero}/measurement.json`, JSON.stringify(m, null, 2));
      await addToZip(`measurements/${m.numero}/items.json`, JSON.stringify(items, null, 2));

      // Anexa PDF se existir
      if (m.official_pdf_storage_path) {
        const { data: blob } = await svc.storage.from('reports').download(m.official_pdf_storage_path);
        if (blob) {
          const buf = new Uint8Array(await blob.arrayBuffer());
          await addToZip(`measurements/${m.numero}/boletim.pdf`, buf);
        }
      }
    }

    for (const a of additives || []) {
      await addToZip(`additives/${a.numero}.json`, JSON.stringify(a, null, 2));
    }

    await addToZip('workflow_history.json', JSON.stringify(workflowSteps || [], null, 2));
    await addToZip('manifest.json', JSON.stringify({
      generated_at: new Date().toISOString(),
      contract_id: contractId,
      contract_numero: contract.numero,
      tenant: contract.tenants?.nome,
      files: manifest,
    }, null, 2));

    const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const path = `tenants/${contract.tenant_id}/contracts/${contractId}/audit_${Date.now()}.zip`;

    const { error: upErr } = await svc.storage
      .from('audit-packages')
      .upload(path, zipBytes, { contentType: 'application/zip', upsert: true });
    if (upErr) throw upErr;

    const { data: signed } = await svc.storage.from('audit-packages').createSignedUrl(path, 3600);

    return ok({
      storage_path: path,
      signed_url: signed?.signedUrl,
      files_count: manifest.length,
      size_bytes: zipBytes.length,
    });
  } catch (e) {
    return serverError(e);
  }
});
