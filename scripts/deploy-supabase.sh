#!/usr/bin/env bash
# deploy-supabase.sh — aplica migrations + faz deploy de todas as Edge Functions.
#
# Pré-requisitos:
#   - Supabase CLI instalado: brew install supabase/tap/supabase
#   - Login feito:           supabase login
#   - Variáveis de ambiente (exportadas no shell):
#       SUPABASE_PROJECT_REF (ex: rmqrztozesnzaomjrpny)
#       SUPABASE_DB_PASSWORD (senha do postgres do projeto)
#
# Uso:
#   ./scripts/deploy-supabase.sh [migrate-only|functions-only|all]
set -euo pipefail

cd "$(dirname "$0")/.."

MODE="${1:-all}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-rmqrztozesnzaomjrpny}"

if ! command -v supabase >/dev/null 2>&1; then
  echo "✗ Supabase CLI não encontrado. Instale com: brew install supabase/tap/supabase"
  exit 1
fi

echo "▶ Vinculando projeto ${PROJECT_REF}…"
supabase link --project-ref "${PROJECT_REF}"

if [[ "${MODE}" == "migrate-only" || "${MODE}" == "all" ]]; then
  echo "▶ Aplicando migrations (db push)…"
  supabase db push
fi

if [[ "${MODE}" == "functions-only" || "${MODE}" == "all" ]]; then
  FNS=(
    auth-bridge
    sync-from-identity
    send-notification
    check-sla-overdue
    approve-magic-link
    import-spreadsheet
    create-measurement
    submit-measurement
    validate-measurement
    approve-measurement-step
    register-additive
    register-payment
    generate-measurement-pdf
    generate-audit-package
    generate-report
    generate-databook-export
    generate-labels-pdf
    generate-risk-analysis-pdf
    issue-grd-pdf
    extract-pdf-text
    notify-pendency
    recalc-financial-snapshot
    public-validation
    digest-daily
  )

  echo "▶ Configurando secrets (se ainda não)..."
  echo "  Lembre-se de rodar:"
  echo "    supabase secrets set RESEND_API_KEY=re_xxx"
  echo "    supabase secrets set RESEND_FROM_EMAIL=geocon@consultegeo.org"
  echo "    supabase secrets set SITE_URL=https://contratos.consultegeo.org"
  echo "    supabase secrets set MAGIC_LINK_SECRET=\$(openssl rand -hex 32)"
  echo

  for fn in "${FNS[@]}"; do
    echo "▶ Deploy: ${fn}…"
    supabase functions deploy "${fn}" --no-verify-jwt
  done

  echo
  echo "✓ Edge Functions com --no-verify-jwt: public-validation, sync-from-identity, check-sla-overdue."
  echo "  Para essas, considere rodar novamente sem --no-verify-jwt se quiser exigir JWT."
fi

echo
echo "✓ Deploy concluído."
echo "  Project URL: https://${PROJECT_REF}.supabase.co"
