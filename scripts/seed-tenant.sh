#!/usr/bin/env bash
# seed-tenant.sh — cria o primeiro tenant + usuário admin via psql.
#
# Pré-requisitos:
#   - psql instalado
#   - Variáveis exportadas:
#       SUPABASE_DB_URL="postgres://postgres.<ref>:<pwd>@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
#       ADMIN_EMAIL="seu@email.com"
#       ADMIN_AUTH_ID="<uuid do auth.users>" (gerado quando você se cadastrar via app)
#       TENANT_NOME="Sua Organização"
#       TENANT_CNPJ="00.000.000/0001-00" (opcional)
#
# Como obter ADMIN_AUTH_ID: faça signup no app → veja em auth.users no Supabase Studio.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "✗ SUPABASE_DB_URL não definido. Exporte a connection string do Supabase."
  exit 1
fi
if [[ -z "${ADMIN_EMAIL:-}" || -z "${ADMIN_AUTH_ID:-}" || -z "${TENANT_NOME:-}" ]]; then
  echo "✗ Defina ADMIN_EMAIL, ADMIN_AUTH_ID e TENANT_NOME no ambiente."
  exit 1
fi

CNPJ="${TENANT_CNPJ:-}"

cat <<SQL | psql "${SUPABASE_DB_URL}" -v ON_ERROR_STOP=1
DO \$\$
DECLARE
  v_tenant_id uuid;
  v_member_id uuid;
BEGIN
  INSERT INTO public.tenants (nome, cnpj, ativo)
  VALUES ('${TENANT_NOME}', NULLIF('${CNPJ}',''), true)
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.members (auth_id, tenant_id, email, nome, role, roles, active)
  VALUES (
    '${ADMIN_AUTH_ID}'::uuid,
    v_tenant_id,
    '${ADMIN_EMAIL}',
    split_part('${ADMIN_EMAIL}', '@', 1),
    'admin',
    ARRAY['admin']::text[],
    true
  )
  RETURNING id INTO v_member_id;

  -- Seed de indices de reajuste (IPCA/IGP-M/INCC-DI/SINAPI/IPC-A)
  PERFORM public.seed_adjustment_indices(v_tenant_id);

  RAISE NOTICE 'Tenant: % (%)', '${TENANT_NOME}', v_tenant_id;
  RAISE NOTICE 'Admin:  % (%)', '${ADMIN_EMAIL}', v_member_id;
END\$\$;
SQL

echo "✓ Tenant '${TENANT_NOME}' criado com admin ${ADMIN_EMAIL}."
echo "  Faça login no app e selecione esse tenant."
