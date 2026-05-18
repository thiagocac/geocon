-- =============================================================================
-- 061_ged_acervo_kpis
-- =============================================================================
-- Painel KPI do acervo GED — métricas operacionais agregadas.
--
-- Visão consolidada de 8 dimensões:
--   1. Total de documentos (ativos + soft-deleted excluídos)
--   2. Distribuição por status (6 estados)
--   3. Top categorias com contagem
--   4. % com validade definida (sinaliza maturidade do controle)
--   5. % com texto extraído (sinaliza qualidade da busca FTS)
--   6. Downloads / 30 dias (taxa de uso)
--   7. Alertas de saúde:
--      - Aprovados há >365d sem nova revisão (potencialmente obsoletos)
--      - Em_revisao há >30d (gargalo de workflow)
--      - Vencidos não-marcados obsoleto
--   8. Pipeline de aprovação (counts por estado de workflow)
--
-- Tudo em 1 RPC para minimizar round-trips. Tenant-scoped via members.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_ged_acervo_kpis()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_total int;
  v_by_status jsonb;
  v_by_category jsonb;
  v_with_validade int;
  v_with_extracted int;
  v_downloads_30d int;
  v_aprovados_velhos int;
  v_em_revisao_velhos int;
  v_vencidos_ativos int;
BEGIN
  -- Tenant do usuário
  SELECT tenant_id INTO v_tenant_id
  FROM public.members
  WHERE user_id = auth.uid() AND deleted_at IS NULL
  LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('error', 'sem tenant');
  END IF;

  -- Total ativos
  SELECT count(*) INTO v_total
  FROM public.ged_documents
  WHERE tenant_id = v_tenant_id AND deleted_at IS NULL;

  -- Por status
  SELECT coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) INTO v_by_status
  FROM (
    SELECT status, count(*)::int AS cnt
    FROM public.ged_documents
    WHERE tenant_id = v_tenant_id AND deleted_at IS NULL
    GROUP BY status
  ) s;

  -- Top 8 categorias
  SELECT coalesce(jsonb_agg(row_to_json(c) ORDER BY c.cnt DESC), '[]'::jsonb)
    INTO v_by_category
  FROM (
    SELECT
      cat.id, cat.codigo, cat.nome,
      count(d.id)::int AS cnt,
      count(*) FILTER (WHERE d.status = 'aprovado')::int   AS aprovados,
      count(*) FILTER (WHERE d.status = 'em_revisao')::int AS em_revisao,
      count(*) FILTER (WHERE d.status = 'obsoleto')::int   AS obsoletos
    FROM public.ged_categories cat
    LEFT JOIN public.ged_documents d
      ON d.category_id = cat.id
      AND d.tenant_id = v_tenant_id
      AND d.deleted_at IS NULL
    WHERE cat.tenant_id = v_tenant_id
      AND cat.deleted_at IS NULL
    GROUP BY cat.id, cat.codigo, cat.nome
    HAVING count(d.id) > 0
    ORDER BY cnt DESC
    LIMIT 8
  ) c;

  -- Com validade definida
  SELECT count(*) INTO v_with_validade
  FROM public.ged_documents
  WHERE tenant_id = v_tenant_id AND deleted_at IS NULL
    AND data_validade IS NOT NULL;

  -- Com texto extraído (ao menos 1 versão com extracted_text não-null)
  SELECT count(DISTINCT d.id) INTO v_with_extracted
  FROM public.ged_documents d
  JOIN public.ged_document_versions v
    ON v.document_id = d.id AND v.deleted_at IS NULL AND v.extracted_text IS NOT NULL
  WHERE d.tenant_id = v_tenant_id AND d.deleted_at IS NULL;

  -- Downloads nos últimos 30d
  SELECT count(*) INTO v_downloads_30d
  FROM public.ged_access_log
  WHERE tenant_id = v_tenant_id
    AND action = 'download'
    AND created_at >= now() - interval '30 days';

  -- Health: aprovados há >365 dias sem nova revisão posterior
  SELECT count(*) INTO v_aprovados_velhos
  FROM public.ged_documents d
  WHERE d.tenant_id = v_tenant_id AND d.deleted_at IS NULL
    AND d.status = 'aprovado'
    AND d.updated_at < now() - interval '365 days';

  -- Health: em_revisao há >30 dias (gargalo)
  SELECT count(*) INTO v_em_revisao_velhos
  FROM public.ged_documents d
  WHERE d.tenant_id = v_tenant_id AND d.deleted_at IS NULL
    AND d.status = 'em_revisao'
    AND d.updated_at < now() - interval '30 days';

  -- Health: vencidos mas ainda em status ativo (não obsoleto/cancelado)
  SELECT count(*) INTO v_vencidos_ativos
  FROM public.ged_documents d
  WHERE d.tenant_id = v_tenant_id AND d.deleted_at IS NULL
    AND d.data_validade IS NOT NULL
    AND d.data_validade < CURRENT_DATE
    AND d.status NOT IN ('obsoleto', 'cancelado');

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'total', v_total,
    'by_status', v_by_status,
    'by_category', v_by_category,
    'validade', jsonb_build_object(
      'com_validade', v_with_validade,
      'sem_validade', greatest(v_total - v_with_validade, 0),
      'pct_com_validade', CASE WHEN v_total > 0 THEN round(v_with_validade::numeric * 100 / v_total, 1) ELSE 0 END
    ),
    'extracao', jsonb_build_object(
      'com_texto', v_with_extracted,
      'sem_texto', greatest(v_total - v_with_extracted, 0),
      'pct_com_texto', CASE WHEN v_total > 0 THEN round(v_with_extracted::numeric * 100 / v_total, 1) ELSE 0 END
    ),
    'uso', jsonb_build_object(
      'downloads_30d', v_downloads_30d
    ),
    'health', jsonb_build_object(
      'aprovados_sem_revisao_1ano', v_aprovados_velhos,
      'em_revisao_mais_30d', v_em_revisao_velhos,
      'vencidos_ativos', v_vencidos_ativos
    ),
    'generated_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ged_acervo_kpis() TO authenticated;

COMMENT ON FUNCTION public.get_ged_acervo_kpis() IS
'V59 — Painel KPI do acervo GED. Retorna agregação de 8 dimensões em jsonb. ' ||
'Tenant-scoped via auth.uid() → members.';
