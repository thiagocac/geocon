# Checklist de deploy — geoCon em contratos.consultegeo.org

Use este documento na primeira instalação em produção e em cada mudança grande.

---

## Pré-flight

- [ ] Node 20+ instalado (`node -v`)
- [ ] Supabase CLI instalado (`supabase --version` ≥ 1.180)
- [ ] Acesso ao projeto Supabase `rmqrztozesnzaomjrpny`
- [ ] Acesso ao DNS de `consultegeo.org` (para criar `contratos.`)
- [ ] Conta no Netlify
- [ ] Conta Resend com API key (re_xxx)

---

## 1. Backend — Supabase

### 1.1 Variáveis de ambiente locais

```bash
export SUPABASE_PROJECT_REF=rmqrztozesnzaomjrpny
export SUPABASE_DB_PASSWORD='<senha do postgres>'  # vista em Studio > Settings > Database
```

### 1.2 Login

```bash
supabase login
```

### 1.3 Aplicar migrations

```bash
./scripts/deploy-supabase.sh migrate-only
```

Verifique no Studio (SQL Editor):

```sql
select count(*) from pg_tables where schemaname='public';  -- ~ 60+
select count(*) from pg_proc where pronamespace = (select oid from pg_namespace where nspname='public');  -- ~ 20+
select count(*) from storage.buckets;  -- ≥ 5
```

### 1.4 Configurar secrets

```bash
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set RESEND_FROM_EMAIL=geocon@consultegeo.org
supabase secrets set SITE_URL=https://contratos.consultegeo.org
supabase secrets set MAGIC_LINK_SECRET=$(openssl rand -hex 32)
```

### 1.5 Deploy de Edge Functions

```bash
./scripts/deploy-supabase.sh functions-only
```

Teste cada uma rapidamente:

```bash
curl -X OPTIONS "https://rmqrztozesnzaomjrpny.supabase.co/functions/v1/public-validation"   # esperado: 200 com CORS
```

### 1.6 Auth — provedores

No Studio > Authentication > Providers:

- **Email** habilitado, "Confirm email" habilitado
- **Redirect URLs**: adicione `https://contratos.consultegeo.org/**`
- **Site URL**: `https://contratos.consultegeo.org`

### 1.7 Primeiro admin

```bash
export SUPABASE_DB_URL='postgres://postgres.rmqrztozesnzaomjrpny:<senha>@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
export ADMIN_EMAIL='admin@consultegeo.org'
export ADMIN_AUTH_ID='<uuid de auth.users após signup>'
export TENANT_NOME='Consulte GEO'
./scripts/seed-tenant.sh
```

---

## 2. Frontend — Netlify

### 2.1 Build local

```bash
npm install
npm run check:source   # gate
npm run typecheck
npm run build          # gera dist/
```

### 2.2 Configurar `.env.local` (build-time)

```ini
VITE_SUPABASE_URL=https://rmqrztozesnzaomjrpny.supabase.co
VITE_SUPABASE_ANON_KEY=<sua-anon-key>
VITE_SITE_URL=https://contratos.consultegeo.org
VITE_IDENTITY_HUB_URL=https://hub.consultegeo.org
```

### 2.3 Deploy

**Opção A — Drop (recomendado para validar rápido)**

1. Acesse https://app.netlify.com/drop
2. Arraste a pasta `dist/`
3. Renomeie o site para `geocon-contratos`

**Opção B — CLI**

```bash
npx netlify-cli deploy --prod --dir=dist
```

### 2.4 Configurar domínio

1. No Netlify, em Site settings > Domain management, adicione `contratos.consultegeo.org`.
2. No DNS de `consultegeo.org`, crie um registro CNAME:
   ```
   contratos.consultegeo.org   CNAME   <site>.netlify.app
   ```
3. Aguarde o certificado SSL ser provisionado (3-5 min).

---

## 3. Testes de fumaça

Depois do deploy completo:

- [ ] Acesse https://contratos.consultegeo.org → redireciona para `/login`
- [ ] Signup com seu e-mail → redireciona para `/dashboard` com tenant ativo
- [ ] Sidebar mostra Carteira, Contratos, GED, Notificações
- [ ] Crie 1 contrato manual no Studio (table `contracts`) → aparece no dashboard
- [ ] Importe SOV: `/contratos/<id>/planilha` > importar Excel
- [ ] Crie medição: `/contratos/<id>/medicoes` > Nova medição → recurso retorna ID
- [ ] Valide: clique em "Validar" → status_agregado preenchido
- [ ] Gere PDF: "Gerar PDF" → `measurements.hash_documento` e `public_validation_code` populados
- [ ] Abra `/v/<code>` em janela anônima → mostra metadados + signed URL do PDF

---

## 4. Operação contínua

- **Cron `check-sla-overdue`**: agende para rodar a cada 1h no painel Supabase > Edge Functions > Schedules.
- **Backup**: configurar PITR (Point In Time Recovery) no Studio > Database > Backups.
- **Monitoring**: Studio > Logs filtra por função; Resend Dashboard mostra entregabilidade de e-mails.

---

## 5. Rollback

Se algum deploy quebrar:

```bash
# Frontend: Netlify > Deploys > selecione deploy anterior > "Publish"
# Backend (functions): refaça deploy de uma versão anterior do código
# Migrations: NUNCA reverta DDL em produção sem backup. Use db push apenas para forward migrations.
```

---

## 6. Contatos do projeto

- **Repositório**: este ZIP / repo a ser criado
- **Supabase**: rmqrztozesnzaomjrpny.supabase.co
- **Suporte interno**: consulte o backlog em `/admin/backlog`
