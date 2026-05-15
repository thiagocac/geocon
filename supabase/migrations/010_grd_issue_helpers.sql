-- =============================================================================
-- 010_grd_issue_helpers — RPCs para emitir GRDs (schema alinhado com 001)
-- =============================================================================

-- Helper: gera próximo número de GRD por tenant
CREATE OR REPLACE FUNCTION public.next_grd_numero(p_tenant uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_seq int;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(numero, '\D', '', 'g'), '')::int), 0) + 1
  INTO v_seq
  FROM public.ged_transmittals
  WHERE tenant_id = p_tenant AND deleted_at IS NULL;

  RETURN 'GRD-' || lpad(v_seq::text, 5, '0');
END;
$$;

-- RPC principal: emite uma GRD com seus documentos (em rascunho)
CREATE OR REPLACE FUNCTION public.issue_grd(
  p_contract_id uuid,
  p_recipient_organization_id uuid,
  p_title text,
  p_document_version_ids uuid[],
  p_finalidades text[] DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_member uuid;
  v_grd_id uuid;
  v_numero text;
  v_ver_id uuid;
  v_idx int := 1;
  v_finalidade text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.contracts WHERE id = p_contract_id AND deleted_at IS NULL;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;

  SELECT id INTO v_member
  FROM public.members
  WHERE auth_id = auth.uid() AND tenant_id = v_tenant AND active = true AND deleted_at IS NULL
  LIMIT 1;
  IF v_member IS NULL THEN RAISE EXCEPTION 'Usuário não é membro ativo deste tenant'; END IF;

  IF coalesce(array_length(p_document_version_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma versão de documento';
  END IF;

  v_numero := public.next_grd_numero(v_tenant);
  v_grd_id := gen_random_uuid();

  INSERT INTO public.ged_transmittals (
    id, tenant_id, contract_id, numero, title, status,
    sender_id, recipient_organization_id, metadata, created_at, updated_at
  ) VALUES (
    v_grd_id, v_tenant, p_contract_id, v_numero, p_title, 'rascunho',
    v_member, p_recipient_organization_id, coalesce(p_metadata, '{}'::jsonb), now(), now()
  );

  FOREACH v_ver_id IN ARRAY p_document_version_ids LOOP
    v_finalidade := CASE
      WHEN p_finalidades IS NOT NULL AND v_idx <= array_length(p_finalidades, 1)
      THEN p_finalidades[v_idx]
      ELSE 'informacao'
    END;
    INSERT INTO public.ged_transmittal_documents (
      id, tenant_id, transmittal_id, document_version_id, finalidade, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_tenant, v_grd_id, v_ver_id, v_finalidade, now(), now()
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN v_grd_id;
END;
$$;

-- send_grd: transição rascunho → enviada + cria 1 receipt pendente (fallback genérico)
CREATE OR REPLACE FUNCTION public.send_grd(p_grd_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_status text;
  v_recipient_org uuid;
BEGIN
  SELECT tenant_id, status, recipient_organization_id
  INTO v_tenant, v_status, v_recipient_org
  FROM public.ged_transmittals WHERE id = p_grd_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'GRD não encontrada'; END IF;
  IF v_status <> 'rascunho' THEN
    RAISE EXCEPTION 'GRD só pode ser enviada se estiver em rascunho (atual: %)', v_status;
  END IF;

  -- Cria um receipt pendente (sem destinatário específico, fluxo de confirmação manual)
  INSERT INTO public.ged_receipts (
    id, tenant_id, transmittal_id, status, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_tenant, p_grd_id, 'pendente', now(), now()
  );

  UPDATE public.ged_transmittals
  SET status = 'enviada', sent_at = now(), updated_at = now()
  WHERE id = p_grd_id;

  RETURN jsonb_build_object('grd_id', p_grd_id, 'status', 'enviada', 'receipts_created', 1);
END;
$$;

-- cancel_grd: cancela uma GRD em rascunho ou enviada
CREATE OR REPLACE FUNCTION public.cancel_grd(p_grd_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.ged_transmittals WHERE id = p_grd_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'GRD não encontrada'; END IF;
  IF v_status NOT IN ('rascunho', 'enviada') THEN
    RAISE EXCEPTION 'GRD não pode ser cancelada (status: %)', v_status;
  END IF;

  UPDATE public.ged_transmittals
  SET status = 'cancelada',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cancel_reason', p_reason, 'cancelled_at', now()),
      updated_at = now()
  WHERE id = p_grd_id;
END;
$$;

-- confirm_grd_receipt: destinatário confirma recebimento
CREATE OR REPLACE FUNCTION public.confirm_grd_receipt(p_receipt_id uuid, p_comment text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.ged_receipts
  SET status = 'confirmado',
      confirmed_at = now(),
      comment = coalesce(p_comment, comment),
      updated_at = now()
  WHERE id = p_receipt_id AND status = 'pendente';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt não encontrado ou já confirmado';
  END IF;
END;
$$;

-- View agregada para listagens
CREATE OR REPLACE VIEW public.v_ged_transmittals AS
SELECT
  t.id, t.tenant_id, t.contract_id, t.numero, t.title, t.status,
  t.sender_id, t.recipient_organization_id, t.sent_at, t.created_at, t.updated_at,
  c.numero AS contract_numero,
  c.objeto AS contract_objeto,
  org.nome AS recipient_nome,
  org.cnpj AS recipient_cnpj,
  m.nome AS sender_nome,
  (SELECT count(*) FROM public.ged_transmittal_documents td
   WHERE td.transmittal_id = t.id AND td.deleted_at IS NULL) AS docs_count,
  (SELECT count(*) FROM public.ged_receipts r
   WHERE r.transmittal_id = t.id AND r.deleted_at IS NULL) AS receipts_total,
  (SELECT count(*) FROM public.ged_receipts r
   WHERE r.transmittal_id = t.id AND r.status = 'confirmado' AND r.deleted_at IS NULL) AS receipts_confirmed
FROM public.ged_transmittals t
LEFT JOIN public.contracts c ON c.id = t.contract_id
LEFT JOIN public.contract_organizations org ON org.id = t.recipient_organization_id
LEFT JOIN public.members m ON m.id = t.sender_id
WHERE t.deleted_at IS NULL;

GRANT SELECT ON public.v_ged_transmittals TO authenticated;

GRANT EXECUTE ON FUNCTION public.next_grd_numero(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_grd(uuid, uuid, text, uuid[], text[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_grd(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_grd(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_grd_receipt(uuid, text) TO authenticated;
