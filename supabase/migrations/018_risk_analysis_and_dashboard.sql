-- =============================================================================
-- 018_risk_analysis_and_dashboard
-- =============================================================================
-- View enriquecida `v_contract_risk_analysis` com breakdown do score crítico
-- por dimensão (avanço, saldo, aditivos, pendências, gap físico-financeiro).
-- View `v_top_critical_contracts` para o dashboard.
-- RPC `get_contract_risk_recommendations(p_contract_id)` retornando JSONB com
-- recomendações declarativas.

-- =============================================================================
-- v_contract_risk_analysis — breakdown do score por componente
-- =============================================================================
DROP VIEW IF EXISTS public.v_contract_risk_analysis CASCADE;

CREATE OR REPLACE VIEW public.v_contract_risk_analysis WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    d.id                            AS contract_id,
    d.tenant_id,
    d.numero,
    d.objeto,
    d.contratada_nome,
    d.valor_inicial,
    d.valor_atual,
    d.valor_aditado,
    d.valor_medido_acumulado,
    d.saldo_contratual,
    d.percentual_financeiro,
    d.percentual_fisico,
    d.alertas,
    d.data_termino,
    d.status,
    -- gap financeiro vs físico (negativo = adiantado, positivo = atrasado)
    (d.percentual_financeiro - d.percentual_fisico)::numeric AS gap_fis_fin,
    -- % de aditivos sobre o inicial
    CASE WHEN d.valor_inicial > 0
      THEN ((d.valor_aditado / d.valor_inicial) * 100)::numeric
      ELSE 0
    END AS pct_aditivos_sobre_inicial,
    -- % de saldo restante
    CASE WHEN d.valor_atual > 0
      THEN ((d.saldo_contratual / d.valor_atual) * 100)::numeric
      ELSE 0
    END AS pct_saldo
  FROM public.v_contract_dashboard d
),
pendencias AS (
  SELECT
    p.contract_id,
    count(*) FILTER (WHERE p.severidade = 'high')                     AS pendencias_high,
    count(*) FILTER (WHERE p.severidade = 'medium')                   AS pendencias_medium,
    count(*)                                                          AS pendencias_total,
    max(p.dias_aberta)                                                AS pendencia_mais_antiga
  FROM public.v_pendencias p
  GROUP BY p.contract_id
),
last_snapshot AS (
  SELECT DISTINCT ON (contract_id)
    contract_id,
    forecast_3m, forecast_6m, forecast_12m,
    risk_flags,
    reference_date AS snapshot_at
  FROM public.contract_financial_snapshots
  WHERE deleted_at IS NULL
  ORDER BY contract_id, reference_date DESC
),
medicoes_atrasadas AS (
  SELECT
    contract_id,
    count(*) AS medicoes_em_aprovacao_atrasadas
  FROM public.measurements m
  WHERE m.deleted_at IS NULL
    AND m.status = 'em_aprovacao'
    AND m.updated_at < now() - interval '7 days'
  GROUP BY contract_id
)
SELECT
  b.*,
  COALESCE(pe.pendencias_high, 0)            AS pendencias_high,
  COALESCE(pe.pendencias_medium, 0)          AS pendencias_medium,
  COALESCE(pe.pendencias_total, 0)           AS pendencias_total,
  COALESCE(pe.pendencia_mais_antiga, 0)      AS pendencia_mais_antiga_dias,
  COALESCE(ma.medicoes_em_aprovacao_atrasadas, 0) AS medicoes_em_aprovacao_atrasadas,
  ls.forecast_3m, ls.forecast_6m, ls.forecast_12m,
  ls.risk_flags, ls.snapshot_at,
  -- breakdown do score
  (CASE WHEN b.percentual_financeiro >= 95 THEN 30
        WHEN b.percentual_financeiro >= 80 THEN 15
        ELSE 0
   END)::int AS score_avanco,
  (CASE WHEN cardinality(b.alertas) > 0 THEN 25 ELSE 0 END)::int AS score_alertas_legais,
  (CASE WHEN b.gap_fis_fin >= 20 THEN 25 ELSE 0 END)::int        AS score_gap,
  (CASE WHEN b.pct_saldo <= 5 THEN 20 ELSE 0 END)::int           AS score_saldo,
  -- score total replicando v_contract_critical_score (para sortear sem juntar)
  ((CASE WHEN b.percentual_financeiro >= 95 THEN 30
         WHEN b.percentual_financeiro >= 80 THEN 15
         ELSE 0
    END)
   + (CASE WHEN cardinality(b.alertas) > 0 THEN 25 ELSE 0 END)
   + (CASE WHEN b.gap_fis_fin >= 20 THEN 25 ELSE 0 END)
   + (CASE WHEN b.pct_saldo <= 5 THEN 20 ELSE 0 END)
  )::int AS score
FROM base b
LEFT JOIN pendencias pe       ON pe.contract_id = b.contract_id
LEFT JOIN last_snapshot ls    ON ls.contract_id = b.contract_id
LEFT JOIN medicoes_atrasadas ma ON ma.contract_id = b.contract_id;

GRANT SELECT ON public.v_contract_risk_analysis TO authenticated;

-- =============================================================================
-- v_top_critical_contracts — top 10 por score
-- =============================================================================
DROP VIEW IF EXISTS public.v_top_critical_contracts CASCADE;

CREATE OR REPLACE VIEW public.v_top_critical_contracts WITH (security_invoker = true) AS
SELECT
  contract_id AS id,
  tenant_id,
  numero,
  objeto,
  contratada_nome,
  valor_atual,
  saldo_contratual,
  percentual_financeiro,
  percentual_fisico,
  score,
  score_avanco,
  score_alertas_legais,
  score_gap,
  score_saldo,
  pendencias_high,
  alertas,
  CASE
    WHEN score >= 70 THEN 'critico'
    WHEN score >= 40 THEN 'atencao'
    WHEN score >= 20 THEN 'monitorar'
    ELSE 'estavel'
  END AS nivel
FROM public.v_contract_risk_analysis
ORDER BY score DESC, valor_atual DESC;

GRANT SELECT ON public.v_top_critical_contracts TO authenticated;

-- =============================================================================
-- RPC: get_contract_risk_recommendations
-- =============================================================================
-- Retorna JSONB com array de recomendações declarativas baseadas no score
-- e nos componentes acionáveis. As recomendações são puramente textuais —
-- a regra de negócio fica em um lugar só, no SQL.
CREATE OR REPLACE FUNCTION public.get_contract_risk_recommendations(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  recs jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO r FROM public.v_contract_risk_analysis WHERE contract_id = p_contract_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Contrato não encontrado', 'recommendations', '[]'::jsonb);
  END IF;

  IF r.score_avanco >= 30 THEN
    recs := recs || jsonb_build_object(
      'tipo', 'avanco_alto', 'prioridade', 'alta',
      'titulo', 'Contrato próximo do encerramento (≥ 95% medido)',
      'descricao', 'Conduza pré-fechamento: validação documental, livro de medição encerrado, devolução de cauções e termo de recebimento.',
      'acao_label', 'Ver financeiro', 'acao_href', '/contratos/' || p_contract_id || '/financeiro'
    );
  ELSIF r.score_avanco = 15 THEN
    recs := recs || jsonb_build_object(
      'tipo', 'avanco_medio', 'prioridade', 'media',
      'titulo', 'Avanço alto (≥ 80% medido)',
      'descricao', 'Planeje o pré-encerramento e revise pendências de aditivos antes que o saldo se esgote.',
      'acao_label', 'Ver pendências', 'acao_href', '/pendencias'
    );
  END IF;

  IF r.score_alertas_legais > 0 THEN
    recs := recs || jsonb_build_object(
      'tipo', 'alertas_legais', 'prioridade', 'alta',
      'titulo', 'Alertas legais ativos',
      'descricao', 'Há ' || coalesce(cardinality(r.alertas), 0) || ' alerta(s) que requerem revisão jurídica/contratual: ' || array_to_string(r.alertas, '; '),
      'acao_label', 'Editar contrato', 'acao_href', '/contratos/' || p_contract_id || '/editar'
    );
  END IF;

  IF r.score_gap > 0 THEN
    recs := recs || jsonb_build_object(
      'tipo', 'gap_fis_fin', 'prioridade', 'alta',
      'titulo', 'Avanço financeiro descolado do físico (gap ≥ 20pp)',
      'descricao', 'Financeiro está ' || round(r.gap_fis_fin, 1) || 'pp à frente do físico. Revise medições recentes, antecipações indevidas ou erro de boletim. Considere glosas se confirmado pagamento por serviço não executado.',
      'acao_label', 'Ver medições', 'acao_href', '/contratos/' || p_contract_id || '/medicoes'
    );
  END IF;

  IF r.score_saldo > 0 THEN
    recs := recs || jsonb_build_object(
      'tipo', 'saldo_baixo', 'prioridade', 'alta',
      'titulo', 'Saldo contratual crítico (≤ 5%)',
      'descricao', 'Saldo de ' || round(r.pct_saldo, 2) || '% do valor atual. Decisão urgente: aditivo de valor, recomposição contratual ou encerramento.',
      'acao_label', 'Ver aditivos', 'acao_href', '/contratos/' || p_contract_id || '/aditivos'
    );
  END IF;

  IF r.pendencias_high > 0 THEN
    recs := recs || jsonb_build_object(
      'tipo', 'pendencias_high', 'prioridade', 'alta',
      'titulo', r.pendencias_high || ' pendência(s) de alta severidade',
      'descricao', 'Há decisões pendentes há ' || r.pendencia_mais_antiga_dias || ' dia(s) que travam o ciclo. Resolva pelo painel central de pendências.',
      'acao_label', 'Abrir pendências', 'acao_href', '/pendencias'
    );
  END IF;

  IF r.medicoes_em_aprovacao_atrasadas > 0 THEN
    recs := recs || jsonb_build_object(
      'tipo', 'medicoes_atrasadas', 'prioridade', 'media',
      'titulo', r.medicoes_em_aprovacao_atrasadas || ' medição(ões) em aprovação há mais de 7 dias',
      'descricao', 'O ciclo de aprovação está estagnado. Cobre os aprovadores ou redelegue.',
      'acao_label', 'Minhas aprovações', 'acao_href', '/aprovacoes'
    );
  END IF;

  IF r.pct_aditivos_sobre_inicial > 24 THEN
    recs := recs || jsonb_build_object(
      'tipo', 'aditivos_acima_limite', 'prioridade', 'alta',
      'titulo', 'Aditivos somam ' || round(r.pct_aditivos_sobre_inicial, 1) || '% do valor inicial',
      'descricao', 'Limite legal da Lei 14.133/8.666 (25%) próximo ou excedido. Confirme enquadramento e justificativas técnicas antes de novos aditivos.',
      'acao_label', 'Ver aditivos', 'acao_href', '/contratos/' || p_contract_id || '/aditivos'
    );
  ELSIF r.pct_aditivos_sobre_inicial > 15 THEN
    recs := recs || jsonb_build_object(
      'tipo', 'aditivos_proximo_limite', 'prioridade', 'media',
      'titulo', 'Aditivos somam ' || round(r.pct_aditivos_sobre_inicial, 1) || '% do valor inicial',
      'descricao', 'Monitorar — próximo do limite legal de 25%.',
      'acao_label', 'Ver aditivos', 'acao_href', '/contratos/' || p_contract_id || '/aditivos'
    );
  END IF;

  IF jsonb_array_length(recs) = 0 THEN
    recs := recs || jsonb_build_object(
      'tipo', 'estavel', 'prioridade', 'baixa',
      'titulo', 'Contrato em condição saudável',
      'descricao', 'Não há sinais de risco operacional, contratual ou financeiro neste momento. Manter monitoramento periódico.',
      'acao_label', 'Ver financeiro', 'acao_href', '/contratos/' || p_contract_id || '/financeiro'
    );
  END IF;

  RETURN jsonb_build_object(
    'contract_id', p_contract_id,
    'score', r.score,
    'nivel', CASE
      WHEN r.score >= 70 THEN 'critico'
      WHEN r.score >= 40 THEN 'atencao'
      WHEN r.score >= 20 THEN 'monitorar'
      ELSE 'estavel'
    END,
    'computed_at', now(),
    'recommendations', recs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_contract_risk_recommendations(uuid) TO authenticated;
