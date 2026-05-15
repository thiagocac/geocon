/**
 * public-validation — endpoint público (sem JWT) que recupera registro de
 * validação pelo código. Retorna metadados + URL assinada para download
 * do PDF original quando aplicável.
 *
 * IMPORTANTE: a Edge Function usa SERVICE_ROLE_KEY internamente para gerar
 * a signed URL, mas a RLS em public_validation_records permite leitura
 * pelo role 'anon' (ver migration 004).
 */
import { handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/client.ts';
import { ok, fail, notFound, serverError } from '../_shared/response.ts';

function bucketFor(entity: string): string {
  if (entity === 'databook_export') return 'databook-exports';
  if (entity === 'ged_document_version') return 'ged-documents';
  return 'reports';
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const url = new URL(req.url);
    let code = url.searchParams.get('code');
    if (!code && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      code = body.code;
    }
    if (!code) return fail('code obrigatório');

    const svc = getServiceClient();
    const { data: record, error } = await svc
      .from('public_validation_records')
      .select('*')
      .eq('code', code)
      .eq('active', true)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !record) return notFound('Registro não encontrado ou inativo');

    let signed_url: string | null = null;
    if (record.storage_path) {
      const bucket = bucketFor(record.entity_type);
      const { data: signed } = await svc.storage
        .from(bucket)
        .createSignedUrl(record.storage_path, 3600);
      signed_url = signed?.signedUrl || null;
    }

    return ok({ record, signed_url });
  } catch (e) {
    return serverError(e);
  }
});
