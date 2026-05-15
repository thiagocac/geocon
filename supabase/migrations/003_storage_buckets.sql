-- Buckets e policies de storage do geoCon.
-- Convenção de path: {tenant_id}/{dominio}/{entity_id}/{arquivo}

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('ged-documents', 'ged-documents', false, 104857600, ARRAY['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/msword','application/vnd.ms-excel','text/plain']),
  ('measurement-evidences', 'measurement-evidences', false, 52428800, ARRAY['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain']),
  ('reports', 'reports', false, 52428800, ARRAY['application/pdf','application/zip','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv']),
  ('audit-packages', 'audit-packages', false, 209715200, ARRAY['application/zip']),
  ('databook-exports', 'databook-exports', false, 524288000, ARRAY['application/zip'])
ON CONFLICT (id) DO UPDATE SET public=EXCLUDED.public, file_size_limit=EXCLUDED.file_size_limit, allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS geocon_storage_select ON storage.objects;
CREATE POLICY geocon_storage_select ON storage.objects FOR SELECT USING (
  bucket_id IN ('ged-documents','measurement-evidences','reports','audit-packages','databook-exports')
  AND EXISTS (SELECT 1 FROM public.members m WHERE m.auth_id=auth.uid() AND m.active=true AND m.deleted_at IS NULL AND m.tenant_id::text = split_part(name,'/',1))
);

DROP POLICY IF EXISTS geocon_storage_insert ON storage.objects;
CREATE POLICY geocon_storage_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id IN ('ged-documents','measurement-evidences','reports','audit-packages','databook-exports')
  AND EXISTS (SELECT 1 FROM public.members m WHERE m.auth_id=auth.uid() AND m.active=true AND m.deleted_at IS NULL AND m.tenant_id::text = split_part(name,'/',1) AND (m.role IN ('admin','gestor_contrato','fiscal_contrato','fiscal_campo','contratada','ged_admin') OR m.roles && ARRAY['admin','gestor_contrato','fiscal_contrato','fiscal_campo','contratada','ged_admin']))
);

DROP POLICY IF EXISTS geocon_storage_update ON storage.objects;
CREATE POLICY geocon_storage_update ON storage.objects FOR UPDATE USING (
  bucket_id IN ('ged-documents','measurement-evidences','reports','audit-packages','databook-exports')
  AND EXISTS (SELECT 1 FROM public.members m WHERE m.auth_id=auth.uid() AND m.active=true AND m.deleted_at IS NULL AND m.tenant_id::text = split_part(name,'/',1) AND (m.role IN ('admin','gestor_contrato','ged_admin') OR m.roles && ARRAY['admin','gestor_contrato','ged_admin']))
) WITH CHECK (
  bucket_id IN ('ged-documents','measurement-evidences','reports','audit-packages','databook-exports')
  AND EXISTS (SELECT 1 FROM public.members m WHERE m.auth_id=auth.uid() AND m.active=true AND m.deleted_at IS NULL AND m.tenant_id::text = split_part(name,'/',1) AND (m.role IN ('admin','gestor_contrato','ged_admin') OR m.roles && ARRAY['admin','gestor_contrato','ged_admin']))
);
