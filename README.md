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

## V76 — release notes resumo

Detalhes em `docs/release-v76.md`.

**Hotfix tela branca pós-deploy** — corrige bug latente desde V62: o Service Worker mantinha `CACHE_NAME = 'geocon-v62'` constante em todas as versões, fazendo `/config.js` (sem hash) ficar grudado no cache do navegador para sempre. Após qualquer deploy com config alterada, usuários antigos viam tela branca silenciosa. V76 versiona o cache name, faz bypass network-only para arquivos sem hash, adiciona boot loader inline em `index.html` e `BootErrorBoundary` global no `main.tsx` — qualquer crash no boot agora mostra tela de erro com botão "Limpar cache e recarregar". Sem feature nova.

## V75 — release notes resumo

Detalhes em `docs/release-v75.md`.

**PWA install banner** — sugere instalar GeoCon na home screen, especialmente útil para fiscais usando V61+V62+V63 (apontamento campo offline).

**`<PwaInstallBanner />`** (~120 linhas, montado no root App.tsx, antes das Routes dentro Suspense):
- Captura `beforeinstallprompt` (Chrome/Edge/Samsung Internet) com botão "Instalar" funcional
- iOS Safari (sem API): hint textual "Compartilhar → Adicionar à Tela de Início" após 4s de uso
- Banner fixed bottom-center max-w-md com Smartphone avatar + título + body adaptativo + botões "Instalar"/"Agora não" + X
- Não mostra se `display-mode: standalone` (já instalado)
- Dismiss salva timestamp em `localStorage['geocon:pwa_banner_dismissed_at']`; re-aparece após 14 dias

**Decisões**:
- 4s delay iOS (dá tempo de entender o app)
- 14 dias dismiss (evita irritar)
- Banner global (qualquer página)
- iOS hint puramente textual (sem API)

Bundle main: 108.82 → **109.67** (+0.85 KB). Banner no main bundle. Margem **40.33 KB**.

**Sequência V54-V75 fecha 22 versões consecutivas**. Bundle total +16.98 KB = 34% do crescimento até 150 KB.

---

## V74 — release notes resumo

Detalhes em `docs/release-v74.md`.

**Notification preferences UI para workflow V65** — V20 já tinha infraestrutura completa de preferências. V65 disparava notifications de workflow GED, mas usuário não conseguia configurar canal porque eventos não apareciam na UI.

**API**:
- `NotificationEventType` union ganha `workflow_assignment` + `workflow_decided`
- `EVENT_DEFAULTS` + `ALL_EVENTS` atualizados (defaults true)
- `NOTIFICATION_EVENT_LABELS` (novo) — Record pt-BR com title + hint para cada event type

**Página** `/preferencias/notificacoes` (V20) ganha 2 entradas para eventos GED. Toggles in_app + email para cada.

Sem migration nova — tabela `member_notification_prefs` é genérica desde V20.

Bundle main: 108.81 → **108.82** (+0.01 KB).

---

## V73 — release notes resumo

Detalhes em `docs/release-v73.md`.

**Filtro avançado no log de marca d'água V68** — investigação de vazamento.

**WatermarkLog estendido**:
- 3 filtros client-side via useMemo: Downloader select · Período (7d/30d/90d) · Busca textual (recipient + fingerprint)
- Botões "Limpar" (XIcon) + "CSV" (reusa V71)
- Contador "N de M"
- Empty state diferenciado para "Nada nos filtros"

Caso de uso: PDF vazado com FP `A3F71C92...` → cola FP na busca → 1 resultado mostra responsável.

Bundle main: 108.81 → **108.81** (Δ ~0 — filtros no chunk lazy do WatermarkLog).

---

## V72 — release notes resumo

Detalhes em `docs/release-v72.md`.

**Comparação composição vs concorrentes** — estende V66 para benchmarking de licitação.

**Migration 069**:
- Tabela `contract_item_competitor_prices` (competitor_name, CNPJ, preço, data_proposta, origem CHECK)
- View `v_contract_item_competitor_comparison` com diff_abs/diff_pct
- RPC `list_contract_competitor_comparison(contract_id)`

**Página `/contratos/:id/comparacao-concorrentes`** (lazy):
- 3 stat cards (Mais barato/mais caro/diferença agregada)
- Filter chips por concorrente
- Tabela com CNPJ + data + origem badge + diff (% + R$)
- Export CSV reusa V71

**Integração**: botão "Concorrentes" (Trophy icon) no ContractSheet ao lado de Divergências.

Bundle main: 108.37 → **108.81** (+0.44 KB).

---

## V71 — release notes resumo

Detalhes em `docs/release-v71.md`.

**Exportar histórico V64 em CSV** — auditor externo pode levar planilha.

**Helper `src/lib/csv.ts`** (~50 linhas, sem deps):
- `csvField()` escape RFC 4180
- `generateCsv()` + BOM UTF-8 (Excel pt-BR detecta encoding)
- `downloadCsv()` + `downloadBlob()` helpers

**Integração no HistoryModal**:
- Botão "CSV" (Download) próximo ao "Limpar"
- Exporta entradas **filtradas** (respeita autor/período/source)
- Long-form: 1 linha por campo alterado (facilita pivot)
- Colunas: Data/hora · Autor · Origem · Campo · Valor anterior · Valor novo
- Nome: `historico-item-{codigo}.csv`

Sem xlsx-vendor extra (CSV nativo é 0KB).

Bundle main: 107.84 → **108.37** (+0.53 KB).

---

## V70 — release notes resumo

Detalhes em `docs/release-v70.md`.

**Settings UI watermark V68** — completa V68 com configuração visual.

**Página `/ged/configuracoes/marca-dagua`** (lazy chunk):
- 9 controles: texto + texto secundário + cor (color picker + hex sync) + opacidade range + ângulo range + tamanho range + 3 checkboxes + signer_label condicional
- Preview ao vivo via CSS rotate sobre "página A4 simulada" com lorem
- Footer simulado com FP + timestamp + ICP-Brasil conforme toggles
- Botões "Restaurar padrão" + "Salvar" com feedback "Salvo" verde 4s

Ícone Stamp ghost no header do Ged() leva para configurações.

Bundle main: 107.74 → **107.84** (+0.10 KB). Página lazy.

---

## V69 — release notes resumo

Detalhes em `docs/release-v69.md`.

**Edição inline de composição V66** — abre fase polish. V66 era read-only; agora editor permite criar/alterar/remover linhas.

**Migration 068** — RPC `replace_composition_lines(composition_id, lines jsonb)` faz delete+insert atômico via jsonb_to_recordset. Valida ownership via RLS.

**API**: `CompositionLineDraft` + `replaceCompositionLines()`. SKIP_AUTH muta mock + recalcula totais.

**Modal V66 estendido**:
- Botão "Editar linhas" (Pencil) abre modo edição
- Inputs por linha (codigo+desc+unidade+coef+preço) com steps 6-8 decimais
- "Adicionar" por tipo no header de cada grupo
- Trash2 por linha
- "Preview do total (não salvo)" em Card warning durante edição
- "Salvar N linhas" / "Cancelar"

Invalida queries de composition + price-divergence após salvar.

Bundle main: 106.51 → **107.74** (+1.23 KB). Margem **42.26 KB**.

---

## V68 — release notes resumo

Detalhes em `docs/release-v68.md`.

**Marca d'água "CÓPIA NÃO CONTROLADA" + rastreabilidade** — fecha a **trilogia das features grandes** (Apontamento campo / Composições / Marca d'água). Compliance GED encerrado. V69+ entra modo polish leve.

**Migration 067** (`067_ged_watermark.sql`):
- Tabela `ged_watermark_settings` (1:1 com tenant): texto, opacidade (0.05–0.50), ângulo (-90 a 90), tamanho fonte (12–144), cor hex regex-validado, toggles incluir_timestamp/incluir_fingerprint/icp_brasil_enabled
- Tabela `ged_watermark_log` (audit trail): fingerprint 16 chars hex, downloader_nome/email snapshot, recipient_label, ip_addr inet, user_agent, icp_brasil_signed. **INSERT só via service_role**; SELECT por tenant member. 4 índices (document/period, downloader, fingerprint, tenant/period)
- 3 RPCs: `get_ged_watermark_settings()` (com defaults), `upsert_ged_watermark_settings(jsonb)`, `list_ged_watermark_log(document_id)` LIMIT 500

**Edge Function `generate-watermarked-pdf`** (~140 linhas, Deno + pdf-lib via esm.sh):
- Valida version_id, mime PDF, autoriza via RLS user client
- Baixa PDF original via service role (storage `ged-documents`)
- Overlay com `StandardFonts.HelveticaBold` rotated `degrees(angulo)`, opacity, cor RGB
- Texto secundário menor abaixo do principal (se configurado)
- Footer cinza pequeno (size 7) com `FP: …`, timestamp pt-BR, recipient, marca ICP-Brasil
- Fingerprint = `crypto.randomUUID()` sem hífens, slice(0,16) uppercase
- Grava log com IP, user agent, downloader info
- Retorna PDF stream + header `X-Watermark-Fingerprint`
- ICP-Brasil em V68 é só flag textual; assinatura digital real exige integração PSC (V69+)

**API** em `src/lib/api.ts`:
- `WatermarkSettings`, `WatermarkLogEntry` interfaces
- `getGedWatermarkSettings`, `upsertGedWatermarkSettings`, `listGedWatermarkLog`, `generateWatermarkedPdf({version_id, recipient_label?, override_settings?})`
- SKIP_AUTH: settings mutável em memória; PDF dummy minimal; push em MOCK_WATERMARK_LOG para ver lista crescer

**Componente `<WatermarkDownloadModal />`** (~150 linhas, main bundle):
- 2 modos: (a) pré-download com 3 campos (recipient_label, texto_secundario, checkbox ICP-Brasil); (b) pós-download com fingerprint destacado + botões "Baixar novamente" / "Fechar"
- Download automático via `<a download>` programático
- Invalida queries de watermark-log após sucesso

**Página `/ged/documentos/:docId/marca-dagua-log`** (lazy 3.8 KB raw):
- Topo explicativo sobre fingerprint
- Lista cronológica reversa: Stamp avatar + FP mono bold + revisão + pill ICP-Brasil · User+email · timestamp relativo · recipient_label blockquote italica

**Integração GedDocument**:
- Botão "Marca d'água" (Stamp icon, outline) — só se versions.length > 0
- History icon ghost compact — link para `/marca-dagua-log`
- Query settings com staleTime 5min

**Decisões**:
- Overlay server-side (fingerprint integro, não falsificável)
- Helvetica embarcado pdf-lib (sem font extra)
- Opacidade 0.20 default (visível mas legível)
- Fingerprint 16 chars hex (suficiente para 1M downloads sem colisão)
- Só PDFs (415 outros mimes)
- ICP-Brasil só flag em V68 (assinatura real V69+)
- Settings 1:1 tenant, override por download
- Log INSERT service_role (imutável do ponto de vista do downloader)
- `recipient_label` campo aberto (cobre pessoas externas sem cadastro)
- Modal pré/pós + página log separadas

Bundle main: 105.65 → **106.51** (+0.86 KB). WatermarkLog lazy 3.8 KB raw.

**+13.82 KB total V54-V68** em 15 versões = 28% do crescimento até 150 KB. Cobertura: Medição 6× · SOV 6× · GED **6×**. **Trio perfeitamente equilibrado.**

**Trilogia das features grandes — fechada**:
| Trilha | Versões | Status |
|---|---|---|
| Apontamento campo mobile | V61, V62, V63 | ✓ |
| Composições bottom-up | V66 (+V67 divergência) | ✓ |
| Marca d'água + rastreio | V68 | ✓ |

---

## V67 — release notes resumo

Detalhes em `docs/release-v67.md`.

**Versão bundle**: 1 feature analítica nova (análise de divergência ligando V57+V64+V66) + 5 polish fechando limitações documentadas das versões anteriores.

### Feature principal: Análise de divergência de preços

**Migration 066** (`066_price_divergence_and_audit_source.sql`):
- View `v_contract_price_divergence` calcula preco_atual vs preco_calculado (composition.total_sem_bdi × (1 + bdi/100)) para cada item com composição
- Severidade: ok (≤2%) · atencao (2-10%) · alerta (10-25%) · critico (>25%) · indeterminado
- impacto_financeiro = divergencia_abs × quantidade_contratada
- RPC `list_contract_price_divergences(contract_id, severidades?)` filtra + ordena por |divergencia_pct| DESC

**Página `/contratos/:id/divergencias-preco`** (lazy 7.1 KB raw):
- 4 stat cards: Total · Alertas · Críticos · **Impacto líquido** (verde sobreestimado / vermelho subestimado)
- 5 filter chips com contadores
- Tabela com Item + Atual + Calculado + Divergência (% e R$) + Impacto + Badge severidade
- Footer explicando convenção: positivo = sobreestimado (vantagem comercial), negativo = subestimado (risco prejuízo)

**Liga V57 + V64 + V66**: V57 audita vs SINAPI cross-section; V64 mostra timeline; V66 tem composição bottom-up; V67 **conecta** preço atual vs cálculo bottom-up.

Botão "Divergências" no header do ContractSheet.

### Polish #1: Marcar source em SovImport/Bulk

V64 deixou source aberto mas todos UPDATEs caíam em `sov_edit`. Migration 066:
- Helper `set_audit_source(text)` faz SET LOCAL app.audit_source
- Trigger V64 atualizado lê `current_setting('app.audit_source', true)` com fallback sov_edit

4 endpoints client-side chamam `setAuditSource()` antes do bulk:
- bulkLockItems → sov_lock/sov_unlock
- bulkSetDiscipline → sov_bulk
- bulkAdjustPrices → sov_bulk
- bulkSoftDeleteItems → sov_bulk

UI V64 (HistoryModal) agora mostra ícones corretos por origem (ImportIcon/Pencil/Package/LockIcon/Unlock).

### Polish #2: Dedup fila offline V62

`computeDedupKey(kind, payload)` em offlineQueue.ts usa hash sjis determinístico sobre subset de campos por kind. `OfflineOperation.dedup_key` novo campo persistido. `enqueueOperation` substitui payload + reseta retries se achar op existente com mesmo key. Resultado: salvar 2× offline mantém só 1 op (a mais recente).

### Polish #3: UI quota IndexedDB V62

`getStorageQuotaInfo()` em offlineQueue.ts via `navigator.storage.estimate()` com fallback gracioso. OfflineQueueInspector ganhou Card no topo com texto "X MB de Y MB · Z%" + barra colorida (verde <70% / amarelo 70-90% / vermelho ≥90%) + alerta laranja se ≥80%.

### Polish #4: Swipe gestures campo V61

MeasurementFieldEntry ganhou touchStartXRef/YRef + onTouchStart/onTouchEnd no div root. Threshold 60px horizontal mínimo, filtra gesto vertical (preserva scroll). Direita=navPrev, esquerda=navNext. Sem libs.

### Polish #5: Filtro actor/período/source no histórico V64

ContractItemHistoryModal ganhou 3 selects: Autor (derivado), Período (Todos/7d/30d/90d), Origem (só aparece se >1 source). Filtro client-side via useMemo. Footer "N de M". Botão Limpar condicional.

### Limitações fechadas com V67

5 limitações documentadas resolvidas: V62 dedup ✓ · V62 quota UI ✓ · V64 source aberto ✓ · V64 filtros histórico ✓ · V61 swipe gestures ✓.

Bundle main: 104.39 → **105.65** (+1.26 KB). Divergence em lazy 7.1 KB. Margem 150 − 105.65 = **44.35 KB**.

**+12.96 KB total V54-V67** em 14 versões = 26% do crescimento até 150 KB. Cobertura: Medição 6× · SOV 6× · GED 5×. **SOV passa a liderar levemente.**

---

## V66 — release notes resumo

Detalhes em `docs/release-v66.md`.

**Composições de preço explícitas SOV** — última feature grande pendente. Liga V57 (auditoria SINAPI/SICRO) com decomposição real **mão-de-obra + material + equipamento + terceiros + consumo auxiliar**. Modelo paralelo a SINAPI/SICRO oficiais.

**Migration 065** (`065_contract_item_compositions.sql`):
- Tabela `contract_item_compositions` (header) com UNIQUE em `contract_item_id WHERE deleted_at IS NULL`, fonte CHECK (SINAPI/SICRO/ORSE/SEDOP/proprio/outro), data_base, observacao, metadata jsonb
- Tabela `contract_item_composition_lines` (1:N, ON DELETE CASCADE) com tipo CHECK 5 valores (mao_obra/material/equipamento/servico_terceiro/consumo_auxiliar), codigo, descricao, unidade, `coeficiente numeric(18,8)` (8 decimais p/ precisão SINAPI), preco_unitario numeric(18,6), ordem
- View `v_contract_item_composition_summary` agrega por composition_id: totais por tipo + total_sem_bdi + num_linhas
- RPC `get_contract_item_composition(item_id)` retorna jsonb único `{ summary, lines }`
- RPC `apply_composition_price_to_item(composition_id)` calcula `total × (1 + bdi/100)`, UPDATE em contract_items.preco_unitario — **trigger V64 grava audit_log automaticamente** (continuidade item-history)
- RLS habilitado em ambas as tabelas
- Sem trigger automático no apply (preço de proposta pode divergir do calculado por estratégia comercial)

**API** em `src/lib/api.ts`:
- `CompositionLineTipo` union + `COMPOSITION_TIPO_LABELS` pt-BR
- `CompositionLine`, `CompositionSummary`, `ContractItemComposition` interfaces
- `getContractItemComposition(itemId)`, `applyCompositionPriceToItem(compositionId)`, `hasComposition(itemId)`

**Mock SKIP_AUTH** com 2 composições realistas SINAPI:
- i1-2 "Concreto fck=30 MPa - m³" — 6 linhas cobrindo 4 tipos (códigos 92395, 88309, 88316, 01510, 00370, 06095)
- i1-4 "Reboco interno 1:6 - m²" — 4 linhas (87529, 88309, 88316, 00367, 00368)

**Componente `<ContractItemCompositionModal />`** (~250 linhas, main bundle):
- Header com Database icon + codigo_composicao + pill fonte (navy) + Calendar + data_base + num_linhas
- Linhas agrupadas por tipo na ordem mão-de-obra → material → equipamento → terceiros → aux
- Cada grupo: header com ícone próprio (HardHat/Package/Wrench/Briefcase/MoreHorizontal) + subtotal alinhado direita
- Cada linha: código mono + descrição + observação italica · direita `coef × preço_unit` small + total destaque
- Totais finais Card: subtotal sem BDI · BDI (%) com valor · **Total com BDI verde grande**
- Botão "Aplicar preço calculado" (Calculator) → RPC apply → banner verde `preço_anterior → preço_novo`, invalida queries items + history
- Empty state explicando import via Excel + cadastro manual (V67+)

**Integração no ContractSheet**:
- Coluna "Ações" agora abriga 2 ícones: Calculator (V66) + History (V64)
- Calculator só aparece se `hasComposition(item.id)`
- Layout flex compact `gap-0.5`

**Decisões**:
- Tabela 1:N, não jsonb (composições têm 5-15 linhas; tabela permite query/index)
- UNIQUE no contract_item_id (1 composição ativa por item)
- coeficiente numeric(18,8) — SINAPI usa 6-8 decimais
- View agregada server-side (PostgreSQL aggregate ~2ms vs round-trip ~100ms)
- RPC retorna jsonb único (1 chamada vs 2)
- Sem trigger automático no apply (preço comercial pode divergir do calculado)
- Reusa V64 audit log (trigger automático em update do preco_unitario — sem código extra)
- V66 = read-only + sync (edição inline em V67+)
- Mock com códigos SINAPI reais (92395, 87529, 88309, 01510...)
- 5 tipos de linha (não 3) — SINAPI tem servico_terceiro e consumo_auxiliar

Bundle main: 101.73 → **104.39** (+2.66 KB). **Δ maior da série** — Modal (~250 linhas) entra no main bundle (tight coupling com ContractSheet).

**+11.70 KB total V54-V66** em 13 versões = 23% do crescimento até 150 KB. Cobertura: Medição 4× · SOV **4×** · GED 5×. **SOV chega ao pé de igualdade.**

---

## V65 — release notes resumo

Detalhes em `docs/release-v65.md`.

**Notificação automática workflow GED** — ativa V60 em produção. Workflow estava funcional mas passivo: assigned_to só descobria pendência navegando manualmente. V65 adiciona triggers de banco que populam `notifications` automaticamente, ativando stack já existente (V20 preferences · V24 broadcast · V53 real-time bell counter).

**Migration 064** (`064_ged_revision_workflow_notifications.sql`):
- Trigger 1 **AFTER INSERT** `notify_ged_revision_step_assigned`: cria notification para `assigned_to` quando step pendente é criado
- Trigger 2 **AFTER UPDATE** `notify_ged_revision_step_decided` (status sai de `pendente`):
  - Aprovado → busca próximo step pendente (ordem ASC LIMIT 1). Se existe, notifica próximo aprovador "Próxima etapa GED aguarda sua aprovação". Se não (último), notifica autor (`uploaded_by`) "Revisão GED publicada"
  - Devolvido/Reprovado → notifica autor com title/kind distintos (warning/error), body inclui decided_by + 120 chars do comment
- Reusa **`notify_recipient`** (V04) — helper já existente

**Mocks SKIP_AUTH**:
- `MOCK_NOTIFICATIONS.n5` (workflow_assignment) inicial correspondente ao mock `grs-2` pendente V60
- `decideGedRevisionStep` simula triggers: unshift em MOCK_NOTIFICATIONS com lógica idêntica ao PL/pgSQL — demo flow interativo

**Demo flow**:
1. Inbox mostra notification "Revisão GED aguardando sua aprovação"
2. Click → `/ged/documentos/doc-1/aprovar`
3. Aprova step 2 → notification "Revisão publicada" aparece imediatamente
4. Bell counter incrementa unread

**Decisões**:
- Triggers de banco, não Edge Function (Postgres dispara em qualquer caminho)
- Reusa notify_recipient — não duplica INSERT logic
- Branch "publicada" separado de "próxima etapa" (autor merece notif especial)
- Comment truncado a 120 chars (cabe em push/email subject)
- Kind semântico (workflow_assignment/success/warning/error)
- Trigger só notifica quando sai de `pendente` (evita re-notificar em edição lateral)
- Mock simula 1:1 a lógica do trigger (consistência demo↔produção)
- Sem notificação por email/webhook explícita — `notifications` já é consumida por digest (V21) e broadcast (V24); usuário com preferences recebe automaticamente

**Limitações conhecidas (V66+)**:
- Sem agrupamento (2 steps simultâneos = 2 notifications; UI agrupa por kind mas não dentro)
- Magic link recipients não recebem via notifications (V60 já cuida via email separado)

Bundle main: 101.28 → **101.73** (+0.45 KB). Trabalho majoritariamente backend (~150 linhas SQL).

**+9.04 KB total V54-V65** em 12 versões = 18% do crescimento até 150 KB. Cobertura: Medição 4× · SOV 3× · GED **5×**. GED ficou robusto: V52 realtime · V56 validade · V58 diff · V59 KPI · V60 workflow · V65 notif workflow. **Workflow agora é end-to-end.**

---

## V64 — release notes resumo

Detalhes em `docs/release-v64.md`.

**Histórico item-level (audit trail) SOV** — equilibra área SOV (estava 2× vs Medição 4× / GED 4×). Adiciona capacidade forense: quem mudou o quê quando em cada `contract_item`. **Reusa `audit_log`** (V01 genérica) — sem tabela nova.

**Migration 063** (`063_contract_item_audit_trigger.sql`):
- Helper `_current_member_id(tenant_id)` — mapeia `auth.uid() → members.id` (reutilizável V65+)
- Trigger function `audit_contract_item_change()` AFTER UPDATE detecta mudanças em **10 campos**: preco_unitario, quantidade_contratada, quantidade_aditada, descricao, codigo, unidade, locked, active, fonte_referencia, bdi_percentual
- before_value / after_value parciais (só campos mudados — economia ~10× espaço)
- Skip explícito de soft-delete (trigger separado se necessário)
- RPC `list_contract_item_history(item_id)` retorna LEFT JOIN com members, ORDER BY DESC, LIMIT 200

**API + types** em `src/lib/api.ts`:
- `ContractItemHistoryEntry` interface (8 campos)
- `CONTRACT_ITEM_FIELD_LABELS` pt-BR (Preço unitário, BDI %, etc.)
- `listContractItemHistory(itemId)`
- `formatContractItemHistoryValue(field, value)` — preço/BDI pt-BR, qty max 6 dec, bool sim/não

**Mock SKIP_AUTH**: 5 entries realistas em i1-2 e i1-4 demonstrando locked/qty/preço/BDI/fonte+preço.

**Componente `<ContractItemHistoryModal />`** (~170 linhas):
- Modal com título + subtítulo explicando campos rastreados
- Lista cronológica reversa com avatar circular **ícone do source** (ImportIcon/Pencil/Package/LockIcon/Unlock/Clock)
- Metadado: source label · actor (User icon) · "Xh atrás" com title tooltip
- **Tabela inline de diffs**: `Campo: old(line-through bg-error/10) → new(bg-success/10)` por campo mudado
- `staleTime 30s` + `enabled: open && !!itemId` (lazy query)

**Integração no ContractSheet**:
- Coluna nova "Ações" (icon-only, `w-10`) no fim da tabela
- Botão `<History />` por linha abre modal com aquele item
- State local `historyFor: { id, codigo, descricao } | null`

**Source field aberto** (não enum): preparado para `sov_import` / `sov_edit` / `sov_bulk` / `sov_lock` / `sov_unlock` com ícones distintos. V65 pode setar valores específicos via `SET LOCAL` nos endpoints respectivos.

**Decisões**:
- Reusa audit_log (V01 já genérica) — sem duplicação
- before/after parciais — só campos que mudaram
- 10 campos auditados (metadata jsonb interno, nivel, ordem, parent ficam de fora)
- Skip soft-delete
- LIMIT 200 (99% dos casos cobertos)
- Modal vs página dedicada — mantém usuário no contexto da planilha
- Helper `_current_member_id` reutilizável (V65+ outros audits)
- Trigger AFTER (não BEFORE) — só registra fato consumado

Bundle main: 99.63 → **101.28** (+1.65 KB). Δ maior que V61-V63 (+0.09 cada): Modal entra no main bundle (tight coupling com ContractSheet), não lazy chunk. Decisão consciente — lazy daria latência ao abrir.

**+8.59 KB total V54-V64** em 11 versões = 17% do crescimento até 150 KB. Cobertura: Medição 4× · SOV **3×** · GED 4×. **Balanço restaurado.**

---

## V63 — release notes resumo

Detalhes em `docs/release-v63.md`.

**UI inspeção da fila offline** — completa V62 fechando primeira das 3 limitações documentadas. Operações que ficavam bloqueadas (>5 retries) precisavam de DevTools para diagnosticar; agora têm tela dedicada.

**Página `/medicoes/fila`** (lazy chunk 7.5 KB raw):
- Layout normal (não mobile-first) — tela de admin/operador, geralmente desktop
- PageHeader com actions "Atualizar" + "Sincronizar tudo" (disabled se offline)
- Status banner: pill Online/Offline + mensagem contextual + toast pós-sync (5s auto-hide)
- 4 stat cards: Total · Aguardando (retries=0) · Re-tentando (1-4) · Bloqueadas (≥5)
- Lista de operações com **background tonal por estado** (vermelho bloqueada, amarelo retrying, neutro fresh)

Cada `<OpRow>`:
- Avatar circular com ícone do kind (Calculator/Camera/MessageSquare)
- Título + metadado "criada Xh atrás · DD/MM HH:mm"
- Pill de retries quando >0 (yellow/red conforme bloqueio)
- Summary inline sanitizado do payload (UUIDs truncados, body limitado a 80 chars)
- last_error em vermelho quando presente
- Botões: "Tentar" (RefreshCcw, reseta retries+processQueue) / "Resetar" para bloqueadas / "Descartar" (Trash2, ghost error, confirm() nativo)

**`summarizePayload(op)`** sanitiza por kind:
- `calc_line`: `Item mi-1a2b3c… · qtd 312 · −22.91, −43.18`
- `comment`: `Item mi-1a2b3c… · "Pavimento 2..." ` (80 chars)
- `evidence`: `IMG_4521.jpg · 384 KB · GPS −22.911, −43.179`

Evita vazar texto completo ou base64 da foto.

**Integração no MeasurementFieldEntry**:
- Abaixo do badge "X na fila" (V62), link novo **só quando há retries > 0**: "Inspecionar fila (N com falha)" com ícone Inbox
- Discreto (font-mono 10px) mas chamativo (cor navy)

**Acesso**:
- URL direta `/medicoes/fila` (sem `:id` — fila é local no device, não por contrato)
- Não adicionado à sidebar (manter menu enxuto)
- Entry points: badge no field entry · URL bookmark

**Decisões**:
- Layout normal vs mobile-first (fila é tela de problema, desktop por suporte)
- `confirm()` nativo para descartar (operação destrutiva)
- Sem detalhes expansíveis (quem precisa ver tudo abre DevTools)
- Retry chama reset+process (operador quer retentar manualmente)
- Background tonal por estado (scan visual rápido sem ler labels)
- Sem polling automático (espera "mexer e sair", não confunde ações manuais)
- Sem entry point na Sidebar (menu enxuto; field entry tem badge)

Bundle main: 99.54 → **99.63** (+0.09 KB). Inspector lazy 7.5 KB raw separado.

**Trio mobile-first V61+V62+V63 fecha o ciclo completo**: interface (V61) + persistência (V62) + observabilidade (V63). **+6.94 KB total V54-V63** em 10 versões = 14% do crescimento até 150 KB. Cobertura: Medição **4×** · SOV 2× · GED 4×.

---

## V62 — release notes resumo

Detalhes em `docs/release-v62.md`.

**Offline queue + PWA basic** — completa V61. Transforma "operações podem falhar" em resiliência real: fiscal grava no celular offline em obra remota, operações sincronizam automaticamente ao voltar online.

**Helper `src/lib/offlineQueue.ts`** (~270 linhas, sem libs — IndexedDB nativo):
- DB `geocon-offline-queue` v1, store `operations` (keyPath 'id')
- Tipo `OfflineOperation { id, kind, payload, created_at, retries, last_error? }` com 3 kinds (`calc_line`, `evidence`, `comment`)
- API: `enqueueOperation`, `listPendingOperations`, `processQueue` (idempotente com lock interno), `resetOperationRetries`, `discardOperation`, `fileToBase64`
- Retry: 5 máximo, depois skip (operador resolve manualmente)
- Evidence usa base64 (Safari iOS perde Blob reference) — custo +33% espaço

**Service Worker `public/sw.js`** (~70 linhas, sem Workbox):
- Cache-first para JS/CSS/font/img · network-first para HTML · não interfere em Supabase/POST
- `install` → precache `/`, manifest, logo SVG → `skipWaiting`
- `activate` → limpa caches antigos → `clients.claim`

**PWA manifest** `public/manifest.webmanifest`:
- name, theme_color #182863, display standalone, orientation portrait, lang pt-BR
- Icons SVG (logo-mark) com purpose "any maskable"
- Shortcut "Apontamento de campo" → `/medicoes`

**Meta tags PWA** no `index.html`:
- `<link rel="manifest" href="/manifest.webmanifest" />`
- `apple-mobile-web-app-capable`, status bar style, title, touch-icon
- `viewport-fit=cover` para safe-area iOS

**SW registration** no `main.tsx`: só em production (`!import.meta.env.DEV`), após `window load`.

**Integração no MeasurementFieldEntry**:
- `onSave()` em online → APIs direto; em offline → `enqueueOperation`
- `onPhotoChosen()` em offline → `fileToBase64` + enqueue
- Listener `window 'online'` → `runSync()` imediato; polling 30s quando online + fila não-vazia
- Header badge "X na fila · tocar para sincronizar" (clicável), `Loader2` durante sync, toast "N sincronizada(s)" auto-hide 4s
- Foto enfileirada com badge laranja "Fila" no thumbnail
- Mensagem offline atualizada: "operação será guardada na fila e sincronizada quando voltar online" (vs V61 "pode falhar")

**Decisões**:
- IndexedDB nativo, não Dexie/idb (-10KB)
- base64 para Blob (Safari iOS lose reference)
- Sem Background Sync API (experimental iOS em 2026); window.online listener + polling
- SW conservador (não cacheia API; só app shell)
- 5 retries máximo; não bloqueia próxima operação se uma falha
- Polling 30s, não imediato (evita spam se rede flutuar)
- Não registra SW em dev (HMR conflict)
- `geocon-v62` como CACHE_NAME (versionar manualmente em V63+ para forçar refresh)
- Shortcut leva a `/medicoes` (lista), não página de campo (requer contexto)

**Limitações conhecidas (V63+)**: sem UI inspeção da fila (`/medicoes/fila`); sem dedup; sem progress do quota IndexedDB.

Bundle main: 99.42 → **99.54** (+0.12 KB). Field chunk 12→16 KB. SW + manifest são arquivos estáticos não-bundled.

---

## V61 — release notes resumo

Detalhes em `docs/release-v61.md`.

**Apontamento campo mobile-first** — feature mais transformadora pendente. Permite fiscal apontar medições direto do celular em obra. **Zero schema novo** (reusa measurement_items + calc_lines + evidences + item_comments).

**Página `/contratos/:id/medicoes/:medId/campo`** (lazy chunk 12 KB raw):
- Layout fullscreen mobile (sem sidebar/topbar normal)
- Top bar fixa: botão Sair (X) · "Medição #N" · badge online/offline (Wifi/WifiOff)
- Barra de progresso (% items tocados na sessão) com contadores `idx+1/total` e `tocados ok`
- Card por item com 4 seções:
  - Header: código + descrição + unidade + saldo
  - Quantidade: input `inputMode="decimal"` font 4xl tabular, alerta se >saldo
  - Evidência: botão "Tirar foto" (`<input capture="environment">`) + GPS automático (`navigator.geolocation`) + thumbnails grid das fotos da sessão
  - Observação: textarea + botão "Ditar" voz-para-texto (Web Speech API pt-BR)
- Botão Salvar 56pt altura (`h-14`) com ícone dinâmico Send → CheckCircle2 → Loader2
- Bottom nav fixa: Anterior · Próximo (disabled em borders)

**Reuso de APIs**:
- `upsertCalcLine` com `metodo='contagem'` + formula=str(qty) cria/atualiza 1 calc_line por item (auditoria preservada)
- `addItemComment` com `kind='campo'` se observação não-vazia
- `uploadEvidence` com lat/lng/taken_at (já suportava desde V01)

**Componente `<VoiceButton />`**:
- Detecta `window.SpeechRecognition || window.webkitSpeechRecognition`
- Fallback "voz não disponível" em Firefox sem flag
- `continuous: false` + `interimResults: false` — frase completa, retorna texto
- Pulse vermelho + "Gravando…" quando ativo
- Concatena com espaço se já há observação

**Online/offline**:
- `window.addEventListener('online' | 'offline')` atualiza state local
- Badge no header + aviso abaixo do botão Salvar quando offline
- **Sem queue persistente nesta versão** — V62 adicionará IndexedDB + Service Worker

**Integração no MeasurementDetail**:
- Botão "Campo" com ícone Smartphone aparece quando `isPreliminar` (medição editável)
- Posicionado **antes** de "Copiar saldo / Copiar anterior" — marca como ação primária do fluxo de obra

**Decisões**:
- Página standalone (sem Layout) — fullscreen mobile com top/bottom bars próprias
- Toque ≥44pt em tudo (Apple HIG mínimo), botões 56pt (uso com luva/sol)
- 1 calc_line por item no fluxo campo (vs múltiplos locais no MeasurementMemoryPage) — auditoria preservada, complexidade 10× menor
- GPS automático ao carregar item via useEffect [item.id]
- Foto com `capture="environment"` força câmera traseira; sem galeria (apontamento "agora")
- Voz captura 1 frase, não contínua (evita travas, ambient noise)
- Sem swipe gesture nem animação (conflitos com scroll vertical; lib animação ~25 KB)
- Tocado = local state Set (resetar ao sair; persistência real via calc_lines no backend)

Bundle main: 99.32 → **99.42** (+0.10 KB). Field page lazy 12 KB raw separado — Δ no main quase imperceptível porque a página é lazy e reusa APIs existentes.

**+6.73 KB total V54-V61** em 8 versões = 13% do crescimento até 150 KB. Cobertura: Medição **2×** · SOV 2× · GED 4×.

---

## V60 — release notes resumo

Detalhes em `docs/release-v60.md`.

**Workflow aprovação de revisão GED** — primeira feature transacional não-analítica da sequência V54-V59. Reusa pattern measurement_approval_steps (V01) + magic link (V07/V09). Alto valor compliance.

**Infraestrutura pré-existente reusada**:
- `workflow_templates` já aceita `entity_type='ged_document'`
- `workflow_steps` já modela steps (ordem, role, sla_hours, actions)
- `approval_magic_links` já é genérico (entity_type='ged_revision')
- `approval_delegations` já existe

**Migration 062** (`062_ged_revision_approval_workflow.sql`):
- Tabela `ged_revision_approval_steps` paralela a measurement_approval_steps com mesmos campos (id, tenant_id, document_id, version_id, template_step_id, ordem, nome, role_required, assigned_to, status CHECK, due_at, decided_at, decided_by, decided_via_delegation, decided_for, comment, signature_method)
- 2 índices: lookup por version_id + inbox pendentes por tenant
- RLS habilitado com tenant check via members
- RPC `instantiate_ged_revision_workflow(version_id, template_id?)` resolve template, cria steps, marca versão `em_aprovacao` + doc `em_revisao`. Fallback single-step "Aprovação técnica" se sem template
- RPC `decide_ged_revision_step(step_id, action, comment?)`: lifecycle automático — reprovação→versão `reprovada`+doc `em_revisao`; todas aprovadas→versão `vigente`+anterior `obsoleta`+doc `aprovado`+revisao_atual atualizado

**API + types**:
- `GedRevisionApprovalStep` interface (15 campos com assigned_member/decided_member joined)
- `GedDocumentVersion.status` estendido com `'em_aprovacao' | 'reprovada'`
- 5 funções: `listGedRevisionApprovalSteps`, `listMyGedRevisionApprovals`, `instantiateGedRevisionWorkflow`, `decideGedRevisionStep`, `issueGedRevisionMagicLink`

**Página `/ged/documentos/:docId/aprovar`** (lazy chunk 9.9 KB raw):
- 4 KPI cards: Total · Aprovadas · Pendentes · Reprovadas
- Lista de steps com bola numerada + status badge + assigned member + prazo + decisor + blockquote de comentário
- 4 botões em pendentes: Aprovar · Devolver · Reprovar · Magic link
- Conector ArrowDown entre steps consecutivos
- Modal de decisão: subtítulo dinâmico por action, textarea comentário (obrigatório p/ devolver/reprovar), confirma → invalida queries
- Modal de magic link 2-step: form (email + TTL 1-168h) → URL pronta com Copiar + Abrir externo

**Integração no GedDocument**:
- Botão "Aprovar revisão" (primary) só aparece quando `versions.some(v => v.status === 'em_aprovacao')`
- Posicionado após "Comparar revisões" — fluxo natural: ver diff → aprovar

**Mock SKIP_AUTH**: MOCK_VERSIONS.v3 status='em_aprovacao'. MOCK_GED_REVISION_STEPS com 2 steps para v3 (grs-1 aprovado por Patrícia 14/05/2026, grs-2 pendente para Roberto). decideGedRevisionStep muta in-memory para demo interativa.

**Decisões**:
- Tabela paralela, não polimorfismo (mesma escolha de V01 para additive_approval_steps)
- Fallback single-step se sem template (garante fluxo sem setup prévio)
- Comentário opcional para aprovar, obrigatório para devolver/reprovar
- em_aprovacao na versão, em_revisao no documento (granularidade certa)
- Magic link reusa approval_magic_links completo
- Lifecycle no RPC, não em trigger (debug mais fácil)
- Mock muta in-memory (padrão de updateGedDocumentValidity V56)

Bundle main: 98.67 → **99.32** (+0.65 KB). Approve lazy 9.9 KB raw separado. **+6.63 KB total V54-V60** = 13% do crescimento até 150 KB.

---

## V59 — release notes resumo

Detalhes em `docs/release-v59.md`.

**Painel KPI do acervo GED** — dashboard operacional consolidando 8 dimensões em uma tela. Fecha sequência analítica V54-V58. Identifica gargalos de workflow e oportunidades de manutenção.

**Migration 061** (`061_ged_acervo_kpis.sql`):
- RPC `get_ged_acervo_kpis()` retorna jsonb único com 8 dimensões em 6 queries agregadas
- `STABLE` + `SECURITY DEFINER` + tenant-scoped via auth.uid() → members
- `HAVING count > 0` exclui categorias vazias
- `count() FILTER (WHERE ...)` evita múltiplos scans em ged_documents

**Dimensões retornadas**:
1. Total ativos
2. Distribuição por status (6 estados)
3. Top 8 categorias (com decomposição aprovado/em_revisao/obsoleto)
4. Validade (% com data_validade definida)
5. Extração (% com extracted_text em ≥1 versão)
6. Uso (downloads/30d via ged_access_log)
7. Health alerts: aprovados >1 ano sem revisão · em_revisao >30d · vencidos ativos

**API**: `getGedAcervoKpis(): Promise<GedAcervoKpis>` + `GED_STATUS_LABELS` pt-BR

**Página `/ged/dashboard`** (lazy chunk 8.4 KB raw):
- 4 KPI cards no header (Total · Validade % · Texto extraído % · Downloads/30d) com tones dinâmicos baseados em thresholds (>50% validade=verde, >70% extração=verde)
- Distribuição por status: barra stacked multi-segmento + legenda grid 3 cols (oculta status com count=0)
- Top categorias: lista com barras proporcionais + drill-down "aprovado: X · em revisão: Y · obsoleto: Z"
- Saúde do acervo: 3 cells (aprovados >1ano · em_revisao >30d · vencidos_ativos) com cor dinâmica (red/yellow/green)
- Timestamp pt-BR no footer

**Integração no Ged() list**:
- Botão "Painel" com ícone BarChart3 como **primeiro** no header (sinaliza ponto de partida recomendado)
- Link `/ged/dashboard`

**Mocks SKIP_AUTH**: `deriveMockGedAcervoKpis()` recalcula a partir de MOCK_GED_DOCS + MOCK_VERSIONS + MOCK_ACCESS. Para 7 docs: aprovado=4, em_elaboracao=1, em_revisao=1, distribuido=1. Validade 42.9%, extração 14.3% (só doc-1 V58), 1 vencido ativo (doc-7 ASO).

**Decisões**:
- 1 RPC, não 6 (minimiza round-trips)
- STABLE, não IMMUTABLE (depende de auth.uid + CURRENT_DATE)
- Top 8 hard-coded (Pareto aplica também a categorias)
- Sem chart lib (bars inline + stacked seguros até 95% dos casos)
- `staleTime: 30_000` no React Query (KPIs mudam pouco)
- Health alerts qualitativos (só conta, não classifica como "muito/pouco")
- Botão "Painel" como primeiro (ergonômico: dashboard antes da lista)

Bundle main: 98.23 → **98.67** (+0.44 KB). Dashboard lazy 8.4 KB raw separado. Δ menor que V58 — arquitetura modular continua disciplinada.

---

## V58 — release notes resumo

Detalhes em `docs/release-v58.md`.

**Diff entre revisões GED (R01 vs R02 vs R03)** — primeira capacidade analítica sobre o **conteúdo** dos documentos GED, não só metadados. Reusa `extracted_text` que V52 já populava (OCR via pdf.js).

**Algoritmo** (`src/lib/diff.ts`):
- LCS (Longest Common Subsequence) manual, ~60 linhas, **~1KB minified**, zero deps
- Alternativas descartadas: diff-match-patch (~15KB), jsdiff (~12KB) — overkill para line-level
- Normalização: CRLF→LF, linhas vazias múltiplas, trim
- `diffLines(textA, textB) → { ops, stats }` retorna ops `equal | insert | delete`
- `diffToSideBySide(ops)` converte para pares (lineA, lineB)
- Complexidade O(m·n) — adequado para PDFs típicos (~1000-5000 linhas)

**API**:
- `getGedVersionExtractedText(versionId)` — retorna apenas 4 campos (id, revision, extracted_text, uploaded_at), não traz storage_path/hash/etc

**Página `/ged/documentos/:docId/diff`** (lazy chunk 7.7 KB raw):
- Seletores de Revisão A (antes) e B (depois) com ícone ArrowLeftRight
- Default: B = mais recente, A = anterior
- 4 stat cards: Total · Adicionadas · Removidas · Mantidas
- Diff table 2-colunas com scroll vertical max-h-70vh
- Cada célula: número da linha + marker (+/−/espaço) + conteúdo
- Background colorido: bg-error/10 em removidas, bg-success/10 em adicionadas
- Empty states diferenciados (1 revisão · sem extracted_text)

**Integração no GedDocument**:
- Botão "Comparar revisões" no header (ícone GitCompare) só aparece quando há ≥2 revisões
- Link relativo "diff" mantém contexto do documento

**Mock SKIP_AUTH** com 3 revisões realistas de Memorial Descritivo do Bloco Cirúrgico:
- R01: escopo mínimo (3 disciplinas)
- R02: + ala recuperação, normas NBR 7117, RDC 50, 6 itens
- R03: + sala híbrida, fck 25→30, HEPA H13→H14, NBR 7256, prazo 180→240d

Demo: `/ged/documentos/doc-1/diff` compara R02 vs R03 automaticamente — ~15 linhas adicionadas, 5 removidas, 12 mantidas.

**Decisões**:
- LCS manual (1KB) vs lib externa (12-15KB) — sem perda de qualidade para line-level
- Line-level, não char-level (engenharia é estruturada em linhas: cláusulas, normas, specs)
- Diff client-side via useMemo (backend não tem lógica de diff)
- 2 selects independentes permitem comparar revisões não-adjacentes
- Renderização condicional do botão (só ≥2 revisões)

Bundle main: 97.50 → **98.23** (+0.73 KB). Diff page lazy 7.7 KB raw separado. Menor delta da série V54-V58 — arquitetura modular (lazy chunks) preserva orçamento.

---

## V57 — release notes resumo

Detalhes em `docs/release-v57.md`.

**Polish V54/V55 + Auditoria de preços SINAPI/SICRO** — começou como bundle de polimento (3 itens), mas auditoria descobriu que todos já estavam implementados. Pivotou para feature nova de valor real.

**Auditoria de descobertas durante V57**:
- Bloqueio backend submit: já existia em V16 (`016_submit_measurement_and_report_views.sql` linha guard `IF v_blocked > 0`)
- "a mais recente" em price_refs: já aplicado em V56 leftover na EF validate-measurement (ORDER BY data_base DESC NULLS LAST)
- Filtros + busca SOV: já implementado em V56 leftover no ContractSheet (5 filtros: busca textual, disciplina, fonte, saldo, classe ABC)

**Migration 060** (`060_contract_price_audit.sql`):
- View `v_contract_price_audit` com DISTINCT ON (contract_item_id) ORDER BY data_base DESC NULLS LAST pegando ref mais recente por item
- Recalcula `divergencia_pct` na hora (não confia no campo armazenado que pode estar desatualizado)
- `impacto_valor = (preço_contrato − preço_ref) × (qtd_contratada + qtd_aditada)` — impacto potencial
- Magnitude 4 buckets: pequena ≤5%, média 5-15%, alta 15-30%, crítica >30%
- Sinal caro/barato (positivo/negativo)
- RPC `get_contract_price_audit_summary(contract_id)` retorna jsonb com cobertura_pct, magnitudes, sinais, impacto

**API + types**:
- `PriceAuditMagnitude`, `PriceAuditSinal` enums
- `PriceAuditItem` (18 campos), `PriceAuditSummary` (cobertura + buckets + impacto)
- `listContractPriceAudit(contractId)`, `getContractPriceAuditSummary(contractId)`
- `PRICE_AUDIT_MAGNITUDE_LABELS` pt-BR

**Página `/contratos/:id/auditoria-precos`** (lazy chunk 8.6 KB raw):
- 4 cards de KPI no header: Cobertura, Crítica, Impacto acima, Impacto abaixo
- 4 filtros: busca textual, magnitude, sinal, limpar
- Tabela ordenada por |divergencia_pct| DESC com 9 colunas (código, descrição+ref, un., preço contrato, ref, fonte+UF+data, divergência ±%, impacto R$, magnitude)
- Empty states diferenciados (sem auditoria vs sem itens nos filtros)

**Mock SKIP_AUTH**: `MOCK_PRICE_AUDIT_OFFSETS` hardcode 8 items demonstrando todas 4 magnitudes + ambos sinais. Para c1: i1-1 (-2.1%), i1-2 (+18.4%), i1-3 (+6.8%), i1-4 (+34.2% crítica), i1-5 (+8.4%).

**Botão "Auditoria de preços"** no ContractSheet header (FileSearch icon) ao lado de "Comparar versões".

**Decisões**:
- Recalcular divergência sempre (campo armazenado pode estar stale)
- DISTINCT ON com NULLS LAST + created_at fallback para determinismo
- Magnitude calibrada por experiência de fiscalização pública
- Impacto = qtd_total (potencial, não realizado)
- Cobertura % chave no resumo (sinaliza se faltam refs cadastradas)
- Página lazy-loaded (padrão V55+)
- Sem chart formal (magnitude já categorizada; cards-de-resumo suficientes)

Bundle main: 95.79 → **97.50** (+1.71 KB). Página lazy 8.6 KB raw separado.

---

## V56 — release notes resumo

Detalhes em `docs/release-v56.md`.

**Validade temporal em GED** — controle de expiração de documentos legais (ARTs, licenças ambientais, ASOs, alvarás). Reusa stack cron + realtime_alerts V52/V53. Alto valor compliance.

**Migration 059** (`059_ged_validade_temporal.sql`):
- `ged_documents.data_validade date` + `dias_alerta_antes int DEFAULT 30 CHECK 0-365`
- Índice parcial `WHERE data_validade NOT NULL`
- `v_ged_master_list` estendida com `data_validade`, `dias_alerta_antes`, `dias_para_vencimento` (calculado)
- CHECK constraint `realtime_alerts.alert_kind` ampliada com `'documento_vencendo'` (5º valor, antes 4)
- RPC `update_ged_document_validity(doc_id, data, dias)` SECURITY DEFINER + tenant-check
- SQL function `scan_ged_documents_expiring(p_days_ahead=30, p_dry_run)` análoga V53 garantias — idempotência 7d via metadata->>document_id, severity dinâmica (≤7d=danger), skip docs obsoleto/cancelado, window inclui -7d para pegar já-vencidos recentes
- pg_cron `scan_ged_documents_expiring_daily '30 6 * * *'` (escalonado 30min após garantias V53)

**API**:
- `GedDocument`, `GedDocumentDetail`, `GedMasterListItem` ganharam validity fields
- `RealtimeAlertKind` estendido com `'documento_vencendo'` + label pt-BR
- `gedValidityStatus(dias, alerta_dias)` retorna 5 estados (sem_validade, ok, vencendo, vencendo_critico, vencido)
- `GED_VALIDITY_LABELS` pt-BR
- `updateGedDocumentValidity(input)` — RPC wrapper; SKIP_AUTH muta MOCK in-memory

**Componente** (`src/components/ged/GedValidityBadge.tsx`):
- Retorna null em `sem_validade` — não polui linhas sem data
- 4 visuais (slate ok / yellow vencendo / orange crítico / red vencido)
- Variantes `compact` (só dias: −12d, 4d, OK) e full (Vencido há X dias, Vence em X dias, Válido até DD/MM/YYYY)
- title attr com data formatada pt-BR

**Integração na lista `Ged()`**:
- Filtro novo "Status validade" (5 opções) em grid `[2fr_1fr_1fr_1fr_auto]`
- Filtragem client-side via useMemo (`gedValidityStatus` é pura)
- Badge compact ao lado do título de cada linha
- Empty state considera filterValidity

**Integração em `GedDocument()` (detalhe)**:
- Botão "Validade" no header (CalendarClock icon) abre Modal
- Badge full abaixo do StatusPill quando `data_validade` preenchido
- Modal: input date + input number dias_alerta + botão "Limpar validade" (condicional)
- Invalidação dupla pós-save: `['ged-doc']` + `['ged-master']`

**Mock SKIP_AUTH**:
- doc-1 a doc-4: validity fields null
- doc-5 ART CREA-RJ (vence em 18d, status=vencendo)
- doc-6 Licença LO 045/2024 (vence em 4d, status=vencendo_critico) + rta-mock-3 alerta documento_vencendo danger
- doc-7 ASO Marcelo Souza (vencido há 12d, status=vencido, contrato c2)
- MOCK_DOC_DETAIL_BY_ID map permite detail page ler doc-5/6/7

**Decisões**:
- Bell + Toasts ZERO mudanças — desacoplamento via REALTIME_ALERT_KIND_LABELS funcionou
- Validade no documento, não na versão (ARTs expiram independente da revisão do PDF)
- Filtragem client-side (regra derivada determinística)
- Modal preferível a página dedicada (2 campos, simples)
- CHECK constraint substituída via DROP+ADD (Postgres não permite ALTER direto)

Bundle main: 94.63 → **95.79** (+1.16 KB).

---

## V55 — release notes resumo

Detalhes em `docs/release-v55.md`.

**Curva ABC de itens (SOV)** — primeira análise quantitativa na área SOV. Identifica concentração de valor por item (Pareto: ~20% items = ~80% valor) para focar auditoria/fiscalização.

**Migration 058** (`058_contract_items_abc.sql`):
- View `v_contract_items_abc` com window functions calculando `pct_individual`, `pct_acumulado`, `classe` (A ≤80% / B 80-95% / C 95-100%), `rank`
- Filtros embutidos: `is_title=false`, `active=true`, `deleted_at IS NULL`, `sov_versions.status='vigente'`
- Tiebreaker por código ASC garante ordem determinística
- RPC `get_contract_abc_summary(contract_id)` retorna jsonb agregado por classe

**API**:
- `listContractItemsAbc(contractId)`, `getContractAbcSummary(contractId)`
- Tipos: `AbcClasse`, `ContractItemAbc`, `AbcClasseStats`, `ContractAbcSummary`
- Labels + descriptions pt-BR

**Componentes** (`src/components/sov/AbcPanel.tsx`):
- `<AbcSummaryPanel />` — header com heuristic check ("N items controlam X% valor" ou "cauda concentrada"), Pareto inline bar 3-segmentos coloridos, expansível para 3 cards detalhados
- `<AbcBadge classe="A" />` — pequeno badge circular reutilizável

**Integração no `ContractSheet.tsx`**:
- Botão "Análise ABC" no header (toggle, secondary quando ativo)
- Queries condicionais `enabled: abcMode` — não fetcha se modo desligado
- Quando ativo: items ordenados por rank + 3 colunas novas (ABC badge, Valor total, % acum.)

**Mock SKIP_AUTH**: `deriveAbcFromMockItems` recalcula via função pura sobre `MOCK_ITEMS`. Para c1 (5 items): A=2 items (65.4% valor), B=1 item (24.7%), C=2 items (9.9%). Demonstra Pareto real.

**Decisões**:
- View + RPC pattern (consultável WHERE + agregado barato)
- Toggle não persiste (ferramenta de análise pontual)
- Sem chart Pareto formal (barra inline suficiente; Recharts custaria +20 KB)
- Heuristic check sinaliza distribuição anômala (60% items em A = fragmentação)

Bundle main: 92.69 → **94.63** (+1.94 KB).

---

## V54 — release notes resumo

Detalhes em `docs/release-v54.md`.

**Validações automáticas de medição** — primeira versão focada em área Medição após análise solicitada. A V53 tinha engine de validação com 4 regras + EF + badge na tabela, mas UI não mostrava POR QUÊ o item estava bloqueado. V54 fecha o gap.

**2 regras novas na engine** (EF `validate-measurement` ampliada):
- `quantidade_acima_25pct` (alerta) — período > 25% do saldo disponível antes
- `preco_divergente_referencia` (alerta) — preço diverge >5% da fonte de referência SINAPI/SICRO via JOIN com `contract_item_price_references`

Engine completa cobre 6 regras nomeadas (4 antigas + 2 V54).

**Componente `<ValidationsPanel />`** (~180 linhas):
- Header com badge agregado + 4 cells (OK/Alerta/Bloqueado/Pendente)
- Lista expandível **por REGRA** (não por item) — mais navegável quando 1 regra afeta 20 itens
- Cada item linka para `/contratos/:id/medicoes/:medId/memoria/:item_id`
- Botão "Re-validar" disabilitado em medições finais

**Helpers** em `api.ts`:
- `VALIDATION_RULE_LABELS` pt-BR
- `summarizeMeasurementValidation(items): MeasurementValidationSummary` — agrega contadores
- `groupValidationIssuesByRule(items)` — agrupa por regra com items afetados, upgrade automático de severidade

**Integração no MeasurementDetail.tsx**:
- `<ValidationsPanel />` acima da tabela de itens
- **Auto-validate** via `useEffect` quando medição editável tem items pendentes (1× por sessão via `useRef`)
- **Botão "Emitir" desabilitado** com tooltip quando `validationSummary.bloqueados > 0`

**Mock SKIP_AUTH expandido**:
- `m1-6`: 4 items demonstrando glosa+qtd_25pct, preco_divergente, memoria_ausente, OK
- `m2-2`: 1 item bloqueado por saldo + 1 OK — demonstra bloqueio do submit em medição preliminar

**Decisões**:
- Sem migration nova (4ª versão consecutiva no padrão V49-V51 + ampliação de EF)
- Bloqueio do submit no frontend (V55 pode adicionar guard SQL)
- Lista expandida por regra, não por item (UX mais navegável)
- Auto-validate 1× por sessão via useRef (não re-valida em loop)

Bundle main: 90.44 → **92.69** (+2.25 KB).

---

## V53 — release notes resumo

Detalhes em `docs/release-v53.md`.

**Bell counter integration + cron de garantias vencendo** — fechamento da V52. Toast efêmero agora se traduz em contador persistente; o 4º alert_kind reservado na V52 finalmente dispara via cron.

**Migration 057** (`057_scan_guarantees_expiring_cron.sql`):
- Função SQL `scan_guarantees_expiring(days_ahead, dry_run)` SECURITY DEFINER
- Idempotência 7d via `metadata->>'guarantee_id'` check
- Severity dinâmico: ≤3d → danger, 4-7d → warning
- pg_cron job `scan_guarantees_expiring_daily` schedule `0 6 * * *` (06:00 UTC) — setup idempotente com handler de ambiente sem pg_cron
- GRANT EXECUTE em `_insert_realtime_alert` para service_role (estava sem GRANT explícito na V52)

**Edge Function alternativa** (`supabase/functions/scan-guarantees-expiring/`):
- Mesma lógica em TS/Deno, expõe POST endpoint
- Body opcional: `{ dry_run, tenant_id, days_ahead }`
- Para ambientes sem pg_cron ou orquestração HTTP unificada

**Bell counter integration** (`NotificationDropdown.tsx`):
- Consome `useRealtimeAlerts` paralelo a `listNotifications`
- Badge unificado `totalCount = unreadCount + realtimeCount`; cor `error animate-pulse` quando há realtime, magenta caso contrário
- Header: linha "X ao vivo" em vermelho antes do "Y não lidas · Z totais"
- Seção dedicada "Lei 14.133 · ao vivo" acima das notifications, com banner vermelho leve e ícone Zap
- `<RealtimeAlertRow />`: dot tone-aware, "Ver" navega + dismissa, "Dismissar" só dismissa

**Decisões**:
- Realtime acima de notifications no dropdown (hierarquia de urgência)
- "Ver" dismissa implicitamente (visualizar = ciência)
- SQL function como primary, EF como alternativa (ambientes sem pg_cron)
- Idempotência 7d permite re-alerta após dismiss (admin viu mas não resolveu)
- Severity dinâmico gradient: warning planejamento → danger ação urgente

**Demo SKIP_AUTH**: 2 alertas históricos (multa c2, vício c3) aparecem no sino com timestamps relativos. Toast continua aparecendo 8s após carregar para garantia c4. Demonstra os 2 mecanismos lado a lado.

Bundle main: 90.04 → **90.44** (+0.40 KB).

---

## V52 — release notes resumo

Detalhes em `docs/release-v52.md`.

**Realtime alerts Lei 14.133** — primeira feature nova desde V48 (após 3 versões consecutivas de mock hardening). Backend + frontend + demo simulation.

**Migration 056** (`056_realtime_alerts_lei14133.sql`):
- Tabela `realtime_alerts` (tenant-scoped, RLS) com índices parciais para query "minhas pendentes"
- 3 triggers Postgres em `contract_receipt_vicios`, `contract_sanctions`, `contract_par_processes` — fires automático em INSERT/UPDATE com dedup OLD vs NEW
- Helper `_insert_realtime_alert` SECURITY DEFINER faz snapshot de `contract_numero` (preserva exibição após delete)
- 2 RPCs: `dismiss_realtime_alert(id)` + `dismiss_all_realtime_alerts()`
- Tabela adicionada à publication `supabase_realtime` (idempotente)

**Frontend**:
- `useRealtimeAlerts(tenantId)` hook — fetch inicial + subscribe + dedup
- `<RealtimeAlertToasts />` componente — stack bottom-right, max 3 visíveis, auto-hide 12s, animação CSS slide-in (`geocon-toast-in` keyframe), dismiss permanente via X
- Filtro server-side via `filter: 'tenant_id=eq.${tenantId}'` no channel
- Montado uma vez em `<Layout>`

**Demo (SKIP_AUTH)**:
- 2 alertas históricos auto-hide imediatamente (representam "já visto")
- 1 alerta incoming dispara via `setTimeout(8000)` — demonstra slide-in
- Dismissal + fired persistem em localStorage (não re-aparecem ao recarregar)

**Decisões**:
- Tabela intermediária vs subscribe direto: filtragem server-side via trigger, multi-tenant safety, audit trail
- Threshold multa = R$ 100k hardcoded (alinhado com dashboard V42)
- Auto-hide 12s local-only (dismiss explícito é ação intencional)
- Sem cron de garantias vencendo ainda (alert_kind reservado; V53)
- Sem badge counter no sino (integração V53)

Bundle main: 88.22 → **90.04** (+1.82 KB).

---

## V51 — release notes resumo

Detalhes em `docs/release-v51.md`.

**Hardening de SKIP_AUTH (Lei 14.133 sub-resources)** — fecha o último gap estrutural do demo mode. Após V50 mostrar c2/c3/c4 críticos em Dashboard/Portfolio, clicar neles ainda levava a abas PARs/Sanções/Recebimentos/Garantias/Timeline vazias.

**Estado herdado**:
- ✅ Migrations 042-055: backend Lei 14.133 completo
- ✅ V49 + V50: pendencias + portfolio mocks alinhados

**Gaps preenchidos no V51**:
- ❌ → ✅ 14 fetchers Lei 14.133 retornavam `[]` em SKIP_AUTH (recebimentos, vícios, garantias, eventos, PARs, steps, sanções, eventos, timeline contract + tenant + summary + contracts)
- ❌ → ✅ Bug crítico descoberto: `MOCK_CONTRACTS` em `mockData.ts` tinha c1-c4 com numero/objeto **diferentes** da narrativa V49+V50 (clicar c2 mostrava "Pavimentação Ribeirão Preto" em vez de "Reforma escolas Niterói")
- ❌ → ✅ Alinhamento secundário: `listOrganizations`, `listLots`, MOCK_DOCS.d6, MOCK_ITEMS.i2-*

**Substituição de MOCK_CONTRACTS**:
- c1 CT-2024/0042 Hospital Regional Rio (SES/RJ)
- c2 CT-2024/0107 Reforma escolas Niterói (SEEDUC/RJ)
- c3 CT-2024/0211 Hospital Universitário Bloco B (SES/RJ)
- c4 CT-2024/0298 UPA Petrópolis fase 2 (SES/RJ)
- c5 CT-2024/0334 Praça Nova Iguaçu (Prefeitura)

Cada um com `valor_*` casando com `MOCK_TENANT_DASHBOARD.totals` e `top_critical_contracts`.

**Decisões**:
- Mock por contract_id (não array global) — preserva narrativa Lei 14.133 (só c2/c3/c4 têm dados)
- Helper `filterTimeline<T>` compartilhado entre contract + tenant timelines
- `MOCK_TENANT_TIMELINE` derivado via flatMap, não duplicado
- Items de c3/c4/c5 deixados vazios (escopo, V52 se necessário)
- 27 stubs vazios restantes catalogados como "intencionalmente vazios" para fresh tenant em demo

**3ª versão consecutiva sem migration nova** (V49, V50, V51). Backend Lei 14.133 100% completo; frontend 100% completo; demo mode agora acompanha.

Bundle main: 85.63 → **88.22** (+2.59 KB).

---

## V50 — release notes resumo

Detalhes em `docs/release-v50.md`.

**Completar Carteira V12** — fecha débito órfão da migration 050 (preservada em `release-v43-prior`). Mesmo padrão de V49: trabalho puramente frontend / mock data, sem migration nova. Demo / dev mode finalmente mostra a feature Lei 14.133 do Portfolio.

**Estado herdado**:
- ✅ Migration 050: 3 views agregadas + RPC `get_tenant_lei14133_kpis` + view auxiliar `v_contract_lei14133_status`
- ✅ Portfolio.tsx: KPI banner global, `Lei14133Badges` por linha, filtro "apenas críticos"
- ✅ Dashboard.tsx: `TenantAlerts` componente já consumia `getTenantDashboard`

**Gaps preenchidos no V50**:
- ❌ → ✅ 4 fetchers Lei 14.133 retornavam vazio em `SKIP_AUTH` → mock realista (3 contratos críticos, narrativa coerente com `MOCK_PENDENCIAS` V49)
- ❌ → ✅ `getTenantDashboard` retornava tudo zerado em `SKIP_AUTH` → mock completo (totals, alerts, 8 per_axis, top critical, next_dates, recent_events)
- ❌ → ✅ `MOCK_SUMMARY.pendencias_total/_high` stale desde V49 (4/2 → 9/5)

**Decisões**:
- Narrativa única ao invés de números aleatórios — 3 contratos críticos (c2 PAR+multa+grave / c3 vício / c4 garantia ≤30d) distribuídos em 2 programas / 2 órgãos / 3 municípios
- Soma exata em todas as dimensões — trocar tab Programa↔Órgão↔Município preserva totais
- Datas absolutas vs `new Date()` — demo "fresca" sem precisar regenerar mocks
- Mockou `getTenantDashboard` (fora do escopo "Carteira V12") porque também era stub zerado

**Segunda versão consecutiva sem migration nova** (após V49). Todos os débitos órfãos preservados em `release-v43-prior` agora estão honrados.

Bundle main: 84.44 → **85.63** (+1.19 KB).

---

## V49 — release notes resumo

Detalhes em `docs/release-v49.md`.

**Completar Pendencias V35-V38** — fecha débito órfão da migration 047 (preservada por 7 versões desde V42). Trabalho de finalização: a base de UI já existia parcialmente, V49 entrega os 4 gaps restantes.

**Estado herdado**:
- ✅ Migration 047 estende `v_pendencias` com 5 novos tipos (vicio_aberto, par_defesa, garantia_vencendo, sancao_multa_pendente, recebimento_definitivo_atrasado)
- ✅ Type union TS + PENDENCIA_META já cobriam os 9 tipos
- ✅ Filter chips dinâmicos + contagens por tipo

**Gaps preenchidos no V49**:
- ❌ → ✅ Mock data estendido com 5 exemplos realistas (cobre 9 pendências em 5 contratos para demo SKIP_AUTH)
- ❌ → ✅ Agrupamento visual: 2 categorias **Operação corrente** (azul) vs **Lei 14.133** (magenta) com labels coloridos
- ❌ → ✅ 2 KPIs categóricos acima dos chips (`operacao_total` + `lei14133_total`)
- ❌ → ✅ Export CSV das pendências filtradas — 8 colunas com BOM UTF-8 + escape de aspas + categoria dinâmica · filename `pendencias_YYYY-MM-DD.csv`

**Decisões**:
- 2 KPIs categóricos vs 9 por tipo — KPIs servem pra "olhar 10s", 9 cards quebrariam hierarquia visual
- Chips em 2 blocos rotulados — 9 chips lado a lado pareciam lista heterogênea; agora hierarquia clara (compliance vs fluxo operacional)
- Ordem estável via `PENDENCIA_TYPES_ORDER` const — não depende de Object.keys (frágil)
- Mock realista (CNPJs/valores) vs placeholder — vendável para demos/screenshots/onboarding
- CSV ao invés de PDF — use cases típicos (Excel, email, reunião) não justificam HTML template extra

**Primeira versão sem migration nova** desde V40 (9 versões atrás). Puramente trabalho frontend de UX + finalização de débito histórico.

Bundle main: 83.26 → **84.44** (+1.18 KB). Pendencias permanece no main por ser rota frequente.

---

## V48 — release notes resumo

Detalhes em `docs/release-v48.md`.

**Download automático de índices IBGE** — fecha o ciclo de automação da família reajuste (V30-V33). Admins não baixam mais manualmente IPCA do IBGE todo mês: cron mensal puxa via API SIDRA e popula `adjustment_index_values` automaticamente.

**Suporte**:
- ✅ IBGE/SIDRA: IPCA (série 1737) e IPCA-15 (série 7060) via API pública gratuita
- ❌ FGV (INCC, IGP-M): não suportada — FGV não tem API pública gratuita. Admins continuam usando CSV manual V31

**Componentes**:
- **Tabela `adjustment_index_fetch_log`** (audit) com status (success/partial/failed/skipped) · contagens · error_message · período coberto · 2 indexes
- **4 RPCs**: `upsert_index_value_external` (service_role, sem JWT) · `list_tenants_with_ibge_indices` (resolve série default 1737/7060 ou override via metadata) · `record_fetch_log_entry` · `list_fetch_log` (admin lê histórico)
- **EF `download-economic-indices`** (~270L Deno) com cache por código (1 chamada IBGE serve N tenants) · timeout 15s · trata `'...'` e `'-'` (dados ausentes IBGE) · status agregado (success/partial/failed) · audit em adjustment_index_fetch_log
- **pg_cron `0 11 15 * *`** (dia 15, 11h UTC) — IBGE publica IPCA dia 10-12 do mês corrente, dia 15 dá folga
- **Frontend**: botão "Atualizar do IBGE" no header da página `/admin/indices-economicos` · modal com input "meses para trás" (1-24, default 3) · auto-filtra pelo índice atual se IPCA/IPCA-15 · resultado em cards por índice com badges + contagens + período + erro · seção de histórico abaixo da tabela de valores (últimas 20 tentativas)

**Decisões**:
- IBGE/SIDRA é fonte oficial (índices IPCA são IBGE) — gratuita, estável, sem auth
- FGV declinada: sem API pública, scraping frágil; estrutura preparada para adicionar paid feed
- Cache request-scoped por código — evita N chamadas idênticas
- Variante `_external` separada da V31 (mesmo padrão V46/V47) — service_role only
- Dia 15 do cron (não 10) — folga para garantir publicação do IBGE

**Família reajuste agora 100% automatizada**: V30 (cálculo) → V31 (CSV bulk + cron de aplicação) → V32 (bulk massa) → V33 (repactuação) → **V48 (pull IBGE)**.

Migration adicionada: **055** (economic_indices_auto). EF nova: **download-economic-indices**.

---

## V47 — release notes resumo

Detalhes em `docs/release-v47.md`.

**Email digest de alertas Lei 14.133** — admin/gestor opta por receber resumo periódico dos alertas críticos da carteira por email + notification in-app, reaproveitando 100% da lógica de alertas V41/V43 num cron diário 9h UTC:

- **1 tabela `member_alert_digest_settings`** (PK member_id UNIQUE) com `enabled` · `frequency` (daily/weekly/monthly) · `severity_threshold` (warning/danger) · audit (last_sent_at, last_alert_count) · 2 indexes parciais
- **6 RPCs**: 2 self-service (`upsert_settings`, `get_settings`, `preview_alert_digest`) + 3 service_role only para a EF (`get_alert_digest_data_for_member`, `list_pending_alert_digest_recipients`, `record_alert_digest_sent`)
- **EF `dispatch-alert-digest`** (~310L Deno) — itera recipients pendentes · chama RPC com tenant_id explícito · cria notification + envia email HTML inline-style via Resend · **NÃO envia se alert_count==0** (evita inbox poluído) mas registra last_sent_at sempre (evita re-disparo)
- **Email HTML**: header navy + cards de alerta com border-left por severity + tabelas de top critical + footer com link pra `/me`
- **pg_cron 9h UTC** chamando EF via `net.http_post` — idempotente, falha silenciosa se pg_cron indisponível
- **Seção `/me`**: toggle enabled + chips de frequência + radio threshold + card "último envio" + botões Save/Preview · modal preview mostra exatamente o que seria enviado

**Janelas de frequência** com margem anti-drift: daily=22h · weekly=6d · monthly=28d

**Threshold filtering**:
- `warning`: todos os 5 alertas (vícios graves + garantias 7d + PARs sem sanção + PARs prazo vencido + multas grandes)
- `danger`: apenas vícios + garantias 7d (postura "só o que bloqueia operação")

**Bundle**: **otimização Auxiliary lazy** — Auxiliary.tsx (Me + Notifications + PublicValidation) tirado do eager-load. **Main caiu de 85.24 → 83.13** (-2.11 KB líquido apesar de +V47), gerou chunk `Auxiliary` de 6.19 KB carregado sob demanda.

**Decisões**:
- Tabela própria (não estende V20 member_notification_prefs) — precisa de frequency+threshold, não só boolean
- digest_sends V21 não compartilhado — UNIQUE (member_id, sent_date) impediria múltiplos digests no mesmo dia
- Email não enviado se 0 alertas — inbox poluído é o pior inimigo do sistema
- Cron único 9h UTC (não local) — V48+ pode evoluir pra timezone-aware

Migration adicionada: **054** (alert_digest). EF nova: **dispatch-alert-digest**. Primeira tabela com cron pós-V46.

---

## V46 — release notes resumo

Detalhes em `docs/release-v46.md`.

**API keys + REST público** — primeira superfície externa do GeoCon para integração com sistemas de licitação, ERPs e controles externos:

- **Formato `gck_live_<8-prefix>_<32-secret>`** — Stripe-style, prefix indexado pra lookup O(1) + bcrypt cost 10 do secret. Único momento em que o secret completo aparece é na resposta de `create_api_key`
- **1 tabela `api_keys`** com tenant_id · name · key_prefix UNIQUE · key_hash · scopes[] · audit fields (created_by, last_used_at, expires_at, revoked_at)
- **6 RPCs**: `create_api_key` (gera prefix+secret server-side via `gen_random_bytes`) · `list_api_keys` (admin only, computa status) · `revoke_api_key` · `verify_api_key` (service_role only, constant-time via `crypt()`) · `touch_api_key_last_used` · variantes `_external` das RPCs V45 que aceitam `tenant_id` explícito
- **EF `public-api`** com roteamento interno · CORS · auth Bearer · scope check · 4 endpoints MVP:
  - `GET /health` (sem auth) · `GET /openapi` (sem auth)
  - `POST /suppliers/check` (scope `suppliers:check`)
  - `GET /suppliers/sanctioned` (scope `suppliers:read`)
- **Página `/admin/api-keys`** (admin only): listagem com avatares por status (ativa/revogada/expirada) · modal de criação com checkboxes de scopes + expiração opcional · **modal pós-criação com one-time reveal** (toggle revelar, copy-to-clipboard, exemplo cURL pronto) · modal de revogação com confirmação dupla · modal de documentação com endpoints + códigos de erro
- **RLS dupla camada**: SELECT admin-only + INSERT/UPDATE/DELETE bloqueado direto (`USING (false)`) — única forma é via RPC SECURITY DEFINER

**Decisões arquiteturais**:
- Prefix + bcrypt (não só bcrypt): permite lookup eficiente sem comparar com todas as chaves
- RPCs `_external` separadas (não passar tenant_id como segundo param nas existentes): princípio do menor privilégio, GRANT só pra service_role
- Scopes granulares (`suppliers:check` ≠ `suppliers:read`): chave de licitação só verifica CNPJ pontual, não expõe base inteira
- Touch last_used fire-and-forget: não bloqueia resposta ao cliente

**Primeira tabela nova pós-V30** — saindo da fase puramente compositiva V39-V45. Necessário porque auth externa não pode ser só view.

Migration adicionada: **053** (api_keys). EF nova: **public-api**.

---

## V45 — release notes resumo

Detalhes em `docs/release-v45.md`.

**Cadastro de fornecedores sancionados** — visão cross-contract por CNPJ das sanções aplicadas (V38). Útil para próximas licitações, due diligence interna e exportação para cadastros nacionais (CEIS/CNEP):

- **1 view `v_sanctioned_suppliers`** — 1 linha por CNPJ contratada com sanção registrada · 18 colunas agregadas (contagens por status, tipo, financeiro, temporal) · 2 campos derivados: `status_agregado` (ativo/histórico) e `severidade_atual` (crítica/alta/média/baixa/nenhuma)
- **4 RPCs**: `list_sanctioned_suppliers` (filtros + ordenação críticos primeiro) · `get_sanctioned_supplier_detail` (jsonb com summary + sanctions individuais + contratos afetados) · **`check_cnpj_sanctioned`** (verificação rápida pra fluxo de licitação: `pode_contratar` + motivo legal) · `get_sanctioned_suppliers_summary` (KPIs do header)
- **Página `/fornecedores-sancionados`** com 4 KPIs (total/críticos/impedimentos/multas pendentes), painel de filtros (search + chips de severidade com contagens + checkboxes de status + checkbox especial "apenas com bloqueio ativo"), tabela compacta com avatar colorido por severity e meta-line densa
- **Modal de detalhe** (size xl): cabeçalho rico + 4 KPI cards por tipo + card de vigência ativa com borda por urgência + lista de contratos afetados (clicáveis) + cronologia de sanções com fundamentação
- **Modal "Verificar CNPJ"**: input livre · resultado em card verde (✓ pode contratar) ou vermelho (✗ bloqueado) com motivo legal citando art. 156 III/IV
- **Export CSV** com 15 colunas (BOM UTF-8 para Excel)

**Decisões**:
- CNPJ como chave (não organization_id) — identidade legal estável, padrão CEIS/CNEP
- `check_cnpj_sanctioned` separada de detail — endpoint candidato para REST público (V46)
- `pode_contratar = (impedimento_ativo == 0 AND inidoneidade_ativa == 0)` — só tipos graves bloqueiam
- View sempre consistente vs materializada com triggers (volume baixo)

Migration adicionada: **052** (sanctioned_suppliers). **0 tabelas, 0 cron, 0 EFs** — quinta versão consecutiva puramente compositiva.

---

## V44 — release notes resumo

Detalhes em `docs/release-v44.md`. (Há também `docs/release-v44-prior.md` documentando o trabalho da Edge Function feito em sessão anterior.)

**Export de Linha do Tempo em PDF · finalização** — V44 fecha o ciclo end-to-end ativando o fluxo que estava 95% pronto de sessão anterior. EF, wrappers e UI já existiam; faltava migration de suporte:

- **EF `export-contract-timeline-pdf` (preexistente, ~700L Deno)** — gera PDF auditável com pdf-lib + QR code: capa + resumo executivo Lei 14.133 + eventos cronológicos agrupados por mês + footer com hash em todas as páginas + página final de validação com QR
- **Frontend (preexistente)**: botão "Exportar PDF" no header da ContractTimeline respeitando filtros aplicados, mutation com auto-download, modal de feedback com hash + código + link de validação
- **Migration 050 (NOVA)**: estende `public_validation_records.entity_type` CHECK para incluir `'contract_timeline'` (sem isso a EF falhava no `upsert` final) + garante bucket de storage `reports` com 50MB/PDF limit + 2 policies idempotentes (`service_role_all` + `authenticated_select` filtrado por tenant via path-prefix)
- **PublicValidation (NOVA)**: adicionado label "Linha do tempo do contrato" em `ENTITY_TYPE_LABEL` (Auxiliary.tsx) para renderizar bonito em `/v/{code}`

**Características do PDF**:
- Validação pública via `public_validation_records` (code + hash + storage_path); URL `/v/{code}` confirma autenticidade sem login
- Storage path: `tenants/{tenant_id}/contracts/{id}/timeline/{date}-{code}.pdf`
- QR code de validação na última página (padrão TCU/Receita)
- Hash SHA-256 calculado e embutido no footer

**Decisões**:
- Server-side (Edge Function) evita +150KB de jspdf no bundle
- Storage com URL assinada (não público) + RLS path-prefix por tenant
- Validação pública mantida fora da RLS (rota `/v/`) — propositalmente

Migration adicionada: **051** (timeline_pdf_support).

---

## V43 — release notes resumo

Detalhes em `docs/release-v43.md`. (Há também um `docs/release-v43-prior.md` descrevendo uma versão alternativa abandonada da V43 — "Carteira por programa estendida".)

**Dashboard global do tenant** — enriquece o `/dashboard` (Carteira) existente com 3 novas seções alimentadas pela Lei 14.133, **sem mexer no conteúdo legacy**:

- **1 RPC `get_tenant_dashboard()`** que retorna jsonb único agregando 8 institutos cross-contract + 5 tipos de alertas + top 8 contratos críticos (score ponderado) + 10 próximos vencimentos da carteira + 12 eventos recentes. ~25 sub-queries internas em 1 round-trip.
- **TenantAlerts**: banner com até 5 cards de alerta (vícios graves, garantias <7d, PARs procedente sem sanção, prazo defesa vencido, multas > R$ 100k). Cada card mostra contagem + sample de top 3 contratos (`#N`). Click navega direto se 1 contrato afetado, vai pra /timeline se múltiplos.
- **TenantAxisGrid**: card com grid 2×4 dos 8 institutos. Cada tile com 2-3 stats coloridos + footer agregado. Click → `/timeline?kinds={instituto}` (deep-link com filtro pré-aplicado no Timeline V42).
- **TenantNextDates**: card lateral com top 10 vencimentos cross-contract, código de cor por urgência (≤7d vermelho, 8-30d amarelo, 31-60d azul). Click → módulo do contrato.

**Estrutura final do `/dashboard`**: PageHeader → **TenantAlerts (V43)** → Stats grid 4-col (legacy) → **TenantAxisGrid + TenantNextDates (V43)** → Contratos críticos (legacy) → Portfolio (legacy) → Risco trend (legacy).

**Decisões**:
- Enriquecimento aditivo, não substituição (zero risco de breakage)
- Score de top critical: 3×vícios graves + 2×PARs procedentes + 2×garantias <7d + 1×multas + 1×PARs em curso
- Dashboard eager-loaded (landing route) — V43 sub-components entram no main bundle (+2.70KB)
- Cobertura tenant-level: 9/9 institutos em **4 visões** (timeline contrato V39, dashboard contrato V41, timeline tenant V42, dashboard tenant V43)

Migration adicionada: **049** (tenant_dashboard). **0 tabelas/views/cron/triggers**.

---

## V42 — release notes resumo

Detalhes em `docs/release-v42.md`.

**Pendências tenant-level estendidas para Lei 14.133** — antes do V42, `/pendencias` só conhecia 4 fontes antigas (medições, GRDs, itens não previstos, risco). Os 9 institutos V30-V38 não geravam pendências visíveis no tenant.

- **5 novos tipos** adicionados ao `v_pendencias` via 5 UNION ALL:
  - `vicio_aberto` — vícios em recebimento (severidade variável por gravidade + prazo saneamento)
  - `par_defesa` — PARs em fase de defesa (severidade por proximidade do prazo)
  - `garantia_vencendo` — garantias ativas ≤60d (severidade por proximidade)
  - `sancao_multa_pendente` — multas não pagas (high se >R$ 100k ou vencida)
  - `recebimento_definitivo_atrasado` — provisórios sem definitivo após limite (sempre high · art. 140 §3º)
- **Critérios de severity espelham V41 Dashboard alerts** (consistência cross-views)
- **UI absorve automaticamente** — `PENDENCIA_META` é fonte única, chips/contagens/ícones aparecem sozinhos
- **Email digest (V12 antigo) herda** — gestores opted-in passam a receber alertas dos 9 institutos no email diário sem mudanças no template

**Decisões**:
- Estender view existente (não criar paralela) — 4 consumers herdam (Pendencias UI, Dashboard, EF digest-daily, v_digest_daily_data)
- DROP+CREATE (não CREATE OR REPLACE) — necessário para adicionar UNION ALL
- RLS herdada das tabelas-fonte (segurança automática)
- 0 tabelas novas, 0 RPCs, 0 cron — terceira versão consecutiva puramente compositiva

Migration adicionada: **047** (pendencias_lei14133).

**Mapa de cobertura tenant-level**: timeline por contrato (V39), dashboard por contrato (V41), pendências tenant (V42), email digest (V12 herdado) → **9/9 institutos cobertos em todas**. Carteira por programa (V12 antigo) ainda só cobre 4/9 — candidato a V43.

---

## V41 — release notes resumo

Detalhes em `docs/release-v41.md`.

**Dashboard agregado por contrato** — visão executiva consolidada respondendo "o que precisa de atenção agora?":

- 1 RPC `get_contract_dashboard` que retorna jsonb único com tudo: contract, alerts, KPIs financeiros + pendência + recent, per_axis (8 institutos), next_dates (top 10 vencimentos unificados), recent_events (top 15 da timeline V39)
- 5 tipos de alertas críticos com severity (danger/warning/info): vícios graves abertos · garantias vencendo ≤7d · PARs procedentes sem sanção · prazo de defesa vencido · multas > R$ 100k pendentes
- Top 10 próximos vencimentos consolidados de 6 fontes (garantia, limite definitivo, vício, prazo defesa PAR, fim de vigência sanção, vencimento multa) com código de cor por urgência (≤7d vermelho, 8-30d amarelo, 31-60d azul, 60+ cinza)
- 8 cards de eixo Lei 14.133 com stats coloridos, clicáveis para módulo
- Mini-timeline dos últimos 30 dias com link para timeline completa V39
- Card "Dashboard" como **primeiro card** do ContractDetail (Gauge icon)

**Decisões arquiteturais**:
- Single RPC com jsonb completo (1 round-trip vs ~10 chamadas)
- Lógica de alertas em SQL (reutilizável para emails futuros)
- CTE com UNION ALL para próximos vencimentos (ordenação correta cross-eixo)

Migration adicionada: **046** (contract_dashboard). **0 tabelas novas, 0 cron** — segunda versão consecutiva puramente compositiva (V39 também foi).

---

## V40 — release notes resumo

Detalhes em `docs/release-v40.md`.

**Mobile audit V30-V39** (pedido recorrente desde V32):

- **3 novos componentes UI**: `<KpiGrid>` + `<KpiCard>` (substituem `grid md:grid-cols-N` por layout responsivo 2x2 em mobile, N colunas em desktop) · `<ScrollShadow>` (gradient nas bordas indicando overflow horizontal em tabelas) · `<MobileListItem>` (card-row pattern disponível para futuras refatorações)
- **1 hook**: `useMediaQuery` + atalhos `useIsMobile/useIsTablet/useIsDesktop` para casos onde estrutura DOM precisa mudar
- **10 páginas patcheadas** via sed automatizado: KPI grids responsivos · paddings reduzidos em mobile · font sizes responsivos · action buttons com hit area 40px (acima do mínimo WCAG)
- **6 tabelas principais** com `<ScrollShadow>` (Sanctions, ParProcesses, Guarantees, Receipts, Reajustes, Repactuacoes, Reequilibrios)
- **1 utility CSS**: `.table` com padding responsivo

**Decisões pragmáticas**:
- `<Modal>` (V01) já era mobile-friendly: bottom-sheet pattern, `w-full`, `max-h-95vh` — não precisou de mudança
- `<PageHeader>` já tinha `flex-col md:flex-row` — não precisou
- Não aplicado `<MobileListItem>` por enquanto: ScrollShadow é mais barato e suficiente. Disponível para futuro

Build cresceu apenas **+0.72 KB gzip** total (main +0.04 · CSS +0.68) para cobertura mobile completa.

Nenhuma migration adicionada. V40 é puramente frontend.

---

## V39 — release notes resumo

Detalhes em `docs/release-v39.md`.

**Linha do tempo unificada** (primeira versão compositiva pós-V30):

- View SQL `v_contract_timeline` com 10 UNION ALL normalizando eventos de aditivos · itens não previstos · medições · reajustes (V30) · repactuações (V33) · reequilíbrios (V34) · recebimentos (V35) · garantias (V36) · PARs (V37) · sanções (V38)
- Schema comum: event_kind · subtype · date · timestamp · title · subtitle · severity · valor · ref_id · ref_link · actor
- 2 RPCs: `list_contract_timeline` com filtros (kinds, from/to, severity, limit) + `get_contract_timeline_summary` para KPIs
- RLS herdada das tabelas-fonte (segurança automática)
- UI: 3 KPIs (total · período · módulos com atividade X/10) · 3 painéis de filtros (chips de tipo com contagem, chips de severity, range de datas) · lista agrupada por mês com timeline visual conectada · click navega para subpath do módulo
- Card "Linha do tempo" como **primeiro card** do ContractDetail (destaque executivo)

Migration adicionada: **045** (contract_timeline). **0 tabelas novas, 0 CHECKs, 0 cron** — puramente compositiva.

---

## V38 — release notes resumo

Detalhes em `docs/release-v38.md`.

**🎉 Sanções e impedimentos (Lei 14.133 art. 156) — fecha 100% Lei 14.133:**

- 4 tipos legais: advertência · multa (com cálculo base × percentual ou direto) · impedimento (≤3 anos) · inidoneidade (≤6 anos)
- Caps legais aplicados em CHECK constraints + RPC: 36 meses (impedimento), 72 meses (inidoneidade)
- Impedimento e inidoneidade exigem PAR procedente vinculado obrigatoriamente (FK validada · art. 158)
- 9 RPCs cobrindo ciclo completo: register · pay multa · suspend · reactivate · **revoke (apenas admin · efeito retroativo)** · mark_fulfilled · list · timeline · summary
- View `v_sancoes_vigentes` + pg_cron mensal (dia 1, 9h UTC) com cooldown 21d
- UI com 4 KPIs (total/ativas com breakdown A/M/I/IN · multas total · pagas/pendentes · próximo vencimento) · tabela expansível com timeline · modal de aplicação com lógica condicional por tipo (preview de cálculo, Select de PAR filtrado)
- Card no ContractDetail entre Apuração administrativa e Itens não previstos

Migration adicionada: **044** (contract_sanctions).

**Status Lei 14.133: 9/9 institutos cobertos** (V30-V38).

---

## V37 — release notes resumo

Detalhes em `docs/release-v37.md`.

**Apuração administrativa / PAR (Lei 14.133 art. 158):**

- Workflow 9-status com 4 etapas legais (instauração · defesa · instrução · decisão) + recurso opcional
- 13 RPCs com gates de role distintos por etapa: admin/gestor instauram · admin/fiscal registram defesa · admin/gestor concluem instrução · **apenas admin decide e julga recurso** (autoridade)
- 2 tabelas: `contract_par_processes` (40+ colunas denormalizadas) + `contract_par_steps` (audit trail)
- 9 tipos de infração + 3 resultados decisão + 4 tipos de sanção propostos (advertência/multa/impedimento/inidoneidade)
- Suporte a revelia, recurso opcional, vínculos cross-module (aditivos/medições/garantias via metadata)
- Validações progressivas: fato ≥50 chars · defesa ≥30 · decisão ≥30 · instrução ≥100 chars
- UI XL: detalhe modal com workflow inteiro em uma tela · cards por fase concluída · 7 action panels inline · timeline completa
- Card no ContractDetail entre Garantias e Itens não previstos

Migration adicionada: **043** (contract_par_processes).

---

## V36 — release notes resumo

Detalhes em `docs/release-v36.md`.

**Garantias contratuais (Lei 14.133 art. 96-101):**

- 4 modalidades cobertas: caução em dinheiro/títulos, seguro-garantia, fiança bancária
- Validação de percentual legal: rejeita registro > 30% do contrato (art. 99)
- 8 RPCs cobrindo ciclo completo: registrar · estender (vinculado a aditivo) · liberar (vinculado a recebimento) · executar · cancelar · listar · histórico · summary
- Schema com 2 tabelas: `contract_guarantees` + `contract_guarantee_events` (audit financeiro)
- View `v_guarantees_vencendo` + RPC `notify_guarantee_due` com pg_cron dias 1/15 às 9h (cooldown 14d por admin)
- UI: 4 KPIs (ativas · valor disponível · executado/liberado · próximo vencimento com cor por urgência) · tabela expansível com timeline · modal de ação unificado (extend/release/execute/cancel)
- Role `financeiro` ganha permissões neste módulo · execução restrita a admin/gestor
- Card no ContractDetail entre Recebimentos e Itens não previstos

Migration adicionada: **042** (contract_guarantees).

---

## V35 — release notes resumo

Detalhes em `docs/release-v35.md`.

**Recebimento provisório e definitivo (Lei 14.133 art. 140):**

- Tabelas `contract_receipts` + `contract_receipt_vicios` com 8 RPCs cobrindo todo ciclo
- Regras de negócio: definitivo exige provisório precedente sem vícios abertos; cancelamento de provisório bloqueado se há definitivo vinculado; transição automática para `com_pendencias` ao adicionar vício
- Vícios com severidade, prazo de saneamento, evidência; podem ser sanados ou aceitos como residual
- Garantia inicia automaticamente na emissão do definitivo (prazo 1-120 meses opcional)
- UI: 4 KPIs (provisórios · definitivos · vícios abertos · garantia ativa com dias restantes) · tabela expansível · 3 modals
- Card no ContractDetail entre Reequilíbrios e Itens não previstos

Migration adicionada: **041** (contract_receipts).

---

## V34 — release notes resumo

Detalhes em `docs/release-v34.md`.

**Reequilíbrio econômico-financeiro (Lei 14.133 art. 124)** — fecha o tripé de ajustes contratuais (reajuste + repactuação + reequilíbrio):

- Workflow completo: `rascunho → em_analise_tecnica → em_aprovacao → aprovado → aplicado` (com ramificações `recusado` e `cancelado`)
- 9 RPCs com validação de transição + role-based per gate (fiscal analisa · admin/gestor decide e aplica)
- Action panels inline no detalhe modal — workflow visível em uma tela só
- Caracterização legal: tipo_evento (alta_insumo, fato_principe, força maior, álea econômica…), descrição ≥30 chars, parecer ≥50 chars, motivação ≥20 chars
- Aplicação opcional com link pra aditivo formal (FK `applied_via_additive_id`)
- 4 KPIs (total · open · aplicado · valor aprovado total) + tabela com badge de aditivo

Migration adicionada: **040** (contract_reequilibrio).

---

## V33 — release notes resumo

Detalhes em `docs/release-v33.md`.

**Repactuação contratual (Lei 14.133 art. 135)** — figura legal distinta de reajuste:

- Recalcula preços com base em CCT/convenção coletiva (não em índice externo)
- Item-a-item, com motivação obrigatória (mínimo 10 chars — §2º)
- **Atualiza preco_unitario** dos itens da SOV (medições futuras pegam novo automaticamente)
- Audit completo via `contract_repactuacao_events` + `contract_repactuacao_items`
- Wizard 2-step: edita preços (cálculo client-side) → revisa e confirma (simulate server-side + motivação + aplica)
- Histórico expansível com detalhe item-a-item

Migration adicionada: **039** (contract_repactuacao).

---

## V32 — release notes resumo

Detalhes em `docs/release-v32.md`.

**Reajuste em massa — fecha o tema iniciado na V30:**

- **Página `/admin/reajustes-em-massa`** com filtros (janela em dias, índice, only_due), KPIs, tabela com seleção múltipla + bulk-action toolbar
- **RPCs**: `list_reajuste_candidates` (filtros flexíveis), `bulk_simulate_reajuste` (cap 200, tolerante a erros), `bulk_apply_reajuste` (cap 100, flag `create_additive` global)
- **Wizard de 4 etapas** no mesmo componente: filter → simulate → review (modal com edição de data+notes+createAdditive) → result (3 cards + tabela com links pros aditivos criados)

Migration adicionada: **038** (bulk_reajuste).

---

## V31 — release notes resumo

Detalhes em `docs/release-v31.md`.

**Fecha o loop de Reajustes iniciado na V30:**

- **Aditivo formal automático**: checkbox no apply gera `additive` tipo `reajuste` com link bidirecional pro event (Lei 14.133 art. 125)
- **Import CSV de índices**: parser client-side aceita YYYY-MM/MM/YYYY/YYYY-MM-DD, vírgula/ponto decimal, separadores `,;\t`; modal de 2 etapas (preview com warnings → resultado com 3 cards inserted/updated/skipped)
- **Cron de aniversário**: pg_cron quinzenal (`0 9 1,15 * *`) notifica admins/gestores 30 dias antes via `notify_reajuste_due` com cooldown de 30 dias por destinatário

Migration adicionada: **037** (reajuste_closes_loop).

---

## V30 — release notes resumo

Detalhes em `docs/release-v30.md`.

**Pivot pra domínio após 6 versões em webhooks (V24–V29):**

- **Reajuste contratual** (Lei 14.133 art. 25/92/124-127): série temporal de índices (IPCA/IGP-M/INCC/SINAPI), simulação prévia, aplicação com audit trail
- **`/admin/indices-economicos`**: gestão da série mensal de valores
- **`/contratos/:id/reajustes`**: configura regra + simula + aplica + histórico
- Reaproveita `adjustment_indices` e `contract_adjustment_rules` que já existiam no schema 001 sem RPCs/UI

Migration adicionada: **036** (contract_reajuste).

---

## V29 — release notes resumo

Detalhes em `docs/release-v29.md`.

- **Bulk requeue do dead-letter**: checkbox por linha + toolbar magenta + RPC `bulk_requeue_webhook_events` (cap 500 IDs)
- **Webhook health score**: view `v_webhook_health` computa 0-100 com 3 dimensões (error_rate, recency, dead-letter); badge inline na `/admin/webhooks` com tooltip de breakdown
- **Mobile audit**: `/admin/webhooks` e `/admin/webhooks-fila` ganham hidden classes por breakpoint; meta inline preserva info crítica no mobile

Migration adicionada: **035** (webhook_bulk_ops_and_health).

---

## V28 — release notes resumo

Detalhes em `docs/release-v28.md`.

- **Auto-rotate de signing secrets**: coluna `auto_rotate_after_days` + pg_cron diário às 04:00 UTC; admin recebe notification `kind=system` com novo secret (caminho equivalente ao modal manual write-once)
- **Real-entity preview**: combobox de search no `WebhookPayloadPreview` resolve entidade real do tenant; payload retorna `synthetic=false` com dados de produção
- **Test event isolado**: re-envio pra UM webhook específico via `enqueueWebhookTest` + EF `dispatch-single-event`; drain principal pula `event LIKE 'test:%'`
- **Dead-letter CSV export**: botão na `/admin/webhooks-fila` baixa CSV RFC 4180 com BOM UTF-8 dos eventos travados

Migration adicionada: **034** (webhook_operability).
EFs novas: `dispatch-single-event`.

---

## V27 — release notes resumo

Detalhes em `docs/release-v27.md`.

- **3 eventos novos** de webhook: `measurement_emitted`, `unforeseen_pending`, `digest_failed` (totaliza 7)
- **Dead-letter alerting** automático: pg_cron a cada 1h chama `alert_webhook_dead_letter()` que cria notification `kind=system` pros admins do tenant com 24h de cooldown
- **Payload preview** no compositor: RPC `build_webhook_sample_payload` mostra o JSON real que será enviado, com fallback sintético se não há entidade real
- **Replay protection doc** colapsável no modal de revelação de secret: snippet Node.js com timing-safe HMAC + janela de timestamp ±5min

Migration adicionada: **033** (webhook_events_expanded).

---

## V26 — release notes resumo

Detalhes em `docs/release-v26.md`.

- **Webhook event queue + retry/backoff**: triggers de domínio (risk_critico_changed, measurement_decided, additive_approved) enfileiram em `webhook_event_queue`; EF `drain-webhook-queue` processa com backoff exponencial (5min → 30min → 2h → 12h → 24h, max 5 tentativas)
- **Página `/admin/webhooks-fila`**: KPIs em tempo real, inspeção de payload, requeue manual de dead-letter
- **Sidebar admin reorganizado** em 4 subgrupos: Pessoas & cadastro · Comunicação · Integrações · Operação interna
- **pg_cron a cada 1 min** chama drain via pg_net.http_post (idempotente; pula se extensões ausentes)

Migrations adicionadas: **032** (webhook_event_queue).
EFs novas: `drain-webhook-queue`.

---

## V25 — release notes resumo

Detalhes em `docs/release-v25.md`.

- **HMAC signing nos webhooks**: header `X-Consultegeo-Signature: sha256=…` opcional por webhook; rotação via UI com modal write-once-read-once
- **Payload customizável** (kind=generic): editor JSON com sandbox de validação, vars `{{ … }}` interpoladas no servidor
- **Aliases hot-link** no broadcast: `/admin/broadcast?alias=equipe-medicao` pré-popula roles
- **Notification grouping com collapse**: clique no header recolhe; estado persiste em localStorage
- **pg_cron wiring** para risk snapshots batch (idempotente, auto-detecta extensão)

Migrations adicionadas: **030** (webhook_signing_and_templates) · **031** (cron_risk_snapshots).

---

## V24 — release notes resumo

Detalhes em `docs/release-v24.md`.

- **Preview pane no broadcast**: title/body renderizados ao vivo com vars globais resolvidas e per-user como badges
- **Bell grouping**: notificações no dropdown agrupadas por kind, com pill "N novas" e badge Broadcast
- **Role aliases** (`/admin/alias-papeis`): admin nomeia conjuntos de papéis usados no compositor
- **Webhooks outgoing** (`/admin/webhooks`): Slack / MS Teams / genérico, com payload-builder por tipo, log de disparos e botão de teste
- **Risk batch** (`/admin/risco-batch`): EF `refresh-risk-snapshots` invocável manualmente; ready pra Supabase Scheduled Functions

Migrations adicionadas: **028** (role_aliases) · **029** (webhooks + scheduled risk).
EFs novas: `dispatch-broadcast-webhooks` · `refresh-risk-snapshots`.

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
