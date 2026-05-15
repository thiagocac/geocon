# geoCon — Consulte GEO · Gestão de Contratos

Sistema SaaS multi-tenant para gestão de contratos de obras e serviços de engenharia, alinhado visualmente com o produto **geoRDO** da plataforma Consulte GEO.

> **Status**: refatoração v1 a partir do código gerado pelo GPT-PRO, com migrations completas, Edge Functions reescritas, frontend não-minificado em React 18 + Vite + TS + Tailwind + TanStack Query + Supabase + pdf-lib.

---

## Stack

- **Frontend**: React 18, Vite 5, TypeScript 5, Tailwind 3, TanStack Query 5, React Router 6, lucide-react.
- **Backend**: Supabase (Postgres 15, Auth, Storage, Edge Functions Deno).
- **PDFs**: pdf-lib + @pdf-lib/fontkit + Inter WOFF1 (embarcada via base64).
- **E-mail**: Resend (transacional).

### Proibido neste projeto

- Next.js, Remix, Prisma, Drizzle ORM, Redux, styled-components, Emotion, fontes WOFF2.

---

## Instalação local

```bash
npm install
cp .env.example .env.local
# Edite .env.local:
#   VITE_SUPABASE_URL=https://rmqrztozesnzaomjrpny.supabase.co
#   VITE_SUPABASE_ANON_KEY=<sua-anon-key>
#   VITE_SITE_URL=https://contratos.consultegeo.org
#   VITE_IDENTITY_HUB_URL=https://hub.consultegeo.org

npm run dev
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev`            | Vite dev server em http://localhost:5173 |
| `npm run build`          | Build de produção em `dist/` |
| `npm run preview`        | Servir o build local |
| `npm run typecheck`      | Verificação TypeScript sem build |
| `npm run lint`           | ESLint zero-warning |
| `npm run check:source`   | Gate de qualidade (WOFF1, kebab-case, stack proibida) |

## Deploy

### 1. Frontend — Netlify Drop

```bash
npm run build
# arraste a pasta dist/ em https://app.netlify.com/drop
```

Configure o domínio `contratos.consultegeo.org` apontando para o site Netlify.

### 2. Backend — Supabase

```bash
export SUPABASE_PROJECT_REF=rmqrztozesnzaomjrpny
./scripts/deploy-supabase.sh all
```

Antes do deploy das functions, configure os secrets:

```bash
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set RESEND_FROM_EMAIL=geocon@consultegeo.org
supabase secrets set SITE_URL=https://contratos.consultegeo.org
supabase secrets set MAGIC_LINK_SECRET=$(openssl rand -hex 32)
```

### 3. Primeiro admin

Depois de fazer signup no app (`/login` → reset-password gera conta), pegue seu `auth_id` em `auth.users` no Supabase Studio:

```bash
export SUPABASE_DB_URL='postgres://postgres.rmqrztozesnzaomjrpny:<senha>@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
export ADMIN_EMAIL='seu@email.com'
export ADMIN_AUTH_ID='<uuid-do-auth-users>'
export TENANT_NOME='Sua Organização'
./scripts/seed-tenant.sh
```

---

## Estrutura

```
geocon-final/
├── src/
│   ├── App.tsx                  Router
│   ├── main.tsx                 Bootstrap (React + Query + Router)
│   ├── styles.css               Tailwind + @font-face Inter WOFF1
│   ├── lib/
│   │   ├── supabase.ts          Cliente único (PKCE)
│   │   ├── api.ts               Funções de leitura/escrita (normalizadores)
│   │   ├── errors.ts            humanizeError(unknown) → string em PT-BR
│   │   ├── format.ts            brl, num, dt, dtTime, pct, bytes, relativeTime
│   │   ├── status.ts            Mapeamento status → label/tone
│   │   └── types.ts             Tipos TS para entidades de domínio
│   ├── hooks/useAuth.tsx        Auth + tenant switcher + roles
│   ├── components/
│   │   ├── layout/              Sidebar (256px) · Topbar (64px) · Layout · ProtectedRoute
│   │   └── ui/                  Card · Button · Badge · Stat · Empty · Progress · Skeleton
│   └── pages/                   28 rotas (login, dashboard, contratos, ged, admin…)
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql        ~60 tabelas + RLS + seeds
│   │   ├── 002_rpc_helpers.sql           RPCs e views
│   │   ├── 003_storage_buckets.sql       Buckets + policies
│   │   └── 004_corrections_and_seed.sql  Patches multi-tenant
│   └── functions/
│       ├── _shared/             cors · client · response · fonts (WOFF1 base64)
│       └── <17 functions>       Cada uma legível em ~30-400 linhas
├── public/
│   ├── fonts/                   Inter-Regular.woff · Inter-Bold.woff
│   └── logos/                   logo-mark · logo-color · logo-white
├── scripts/
│   ├── check-source.mjs         Gate de qualidade
│   ├── deploy-supabase.sh       Aplicar migrations + deploy functions
│   └── seed-tenant.sh           Criar primeiro tenant + admin
└── docs/
    └── deploy-checklist.md      Passo a passo de produção
```

---

## Permissões e tenants

O sistema é multi-tenant **estrito**: toda tabela tem `tenant_id` e políticas RLS que filtram por `current_tenant_id()` (lê do JWT claim `active_tenant`, com fallback para o primeiro tenant ativo do membro).

Trocar de tenant no app: avatar → perfil → seleciona outro tenant. O localStorage guarda `geocon:active_member` e `geocon:active_tenant`.

### Papéis (`members.role` + `members.roles[]`)

- `admin` · `gestor_contrato` · `fiscal_contrato` · `fiscal_campo` · `contratada` · `gerenciadora` · `financeiro` · `controle_interno` · `auditor` · `ged_admin` · `ged_reader` · `viewer`.

### Validação pública

Toda medição emitida tem um `public_validation_code` (16 hex) acessível **sem login** em `/v/<code>`. O endpoint `public-validation` retorna metadados + signed URL para o PDF original. O hash SHA-256 garante a integridade.

---

## Não negociáveis técnicos

1. **Inter WOFF1** é a única fonte tipográfica em PDF e Web. Não usar WOFF2.
2. **Edge Functions em kebab-case**. Nomes em snake_case ou camelCase são rejeitados pelo `check-source`.
3. **SOV travada após 1ª medição vigente**: o trigger `block_locked_sov_edit` impede UPDATE/DELETE em `contract_items` quando há medições em status emitida/aprovada/paga. Alterações exigem aditivo.
4. **Limites legais aditivos**: 25% (acréscimo/supressão), 50% (reforma de edifício/equipamento) — validado em `register_additive`.
5. **PDFs com watermark "PRELIMINAR"** quando status ∉ {emitida, aprovada, paga}.

---

## Licença

Proprietário — Consulte GEO.
