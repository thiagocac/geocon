# V47 — Email digest de alertas Lei 14.133

V47 entrega o item #8 da lista V41 (saltando o #6 OKLCH/Tier 3 — débito técnico declinado 16 vezes desde V14 — e #7 EF FGV/IBGE — menor valor imediato): admin/gestor opta por receber resumo periódico dos alertas críticos da Lei 14.133 por email + notification in-app.

Reaproveita 100% da lógica de alertas das V41/V43 num cron diário + EF batch dispatcher.

## Arquitetura

### Migration 054 (~360L)

**1 nova tabela** `member_alert_digest_settings`:
- PK (member_id UNIQUE — 1 setting por user)
- `enabled` (boolean default true ao opt-in)
- `frequency` ('daily' | 'weekly' | 'monthly')
- `severity_threshold` ('warning' | 'danger')
- `last_sent_at`, `last_alert_count` (audit + idempotência)
- 2 indexes parciais (tenant_id e last_sent_at, ambos `WHERE enabled = true`)

**RLS user-scoped**: SELECT + UPSERT só pra `member_id = current_member_id()`.

**5 RPCs**:

1. `upsert_alert_digest_settings(enabled, frequency, severity_threshold)` — self-service, valida enums
2. `get_alert_digest_settings()` — retorna jsonb com defaults caso ainda não configurado
3. `get_alert_digest_data_for_member(member_id)` — **service_role only** — gera o conteúdo do digest. Aceita member_id explícito porque a EF não tem JWT
4. `preview_alert_digest()` — versão self-service que chama `get_alert_digest_data_for_member(current_member_id())`. Permite ao user ver exatamente o que receberia
5. `list_pending_alert_digest_recipients()` — **service_role only** — retorna members opted-in com janela de frequência cumprida
6. `record_alert_digest_sent(member_id, alert_count, email_status)` — **service_role only** — chamada pela EF após envio

**Janelas de frequência** (com pequena margem pra evitar drift):
- `daily` → re-envia se `last_sent_at < now() - 22h`
- `weekly` → re-envia se `last_sent_at < now() - 6 dias`
- `monthly` → re-envia se `last_sent_at < now() - 28 dias`

**Filtro por threshold**:
- `warning`: inclui todos os 5 alertas (vícios graves, garantias 7d, PARs sem sanção, PARs prazo vencido, multas grandes)
- `danger`: apenas vícios graves + garantias 7d (alertas que bloqueiam operação)

**pg_cron**: agenda diária 9h UTC (6h Brasília) chamando a EF via `net.http_post`. Idempotente (drop+create do job). Falha silenciosa com NOTICE se `pg_cron` indisponível (deixa pra admin agendar manualmente).

### Edge Function `dispatch-alert-digest` (~310L Deno)

Service role client. Body opcional:
- `dry_run`: monta conteúdo sem enviar
- `member_id`: limita a single member (teste)
- `force`: ignora janela de frequência (não implementado neste MVP, RPC já filtra)

**Fluxo**:
1. CORS preflight
2. Resolve recipients (single via DB direto se `member_id` no body, senão RPC list_pending)
3. Para cada recipient:
   - Chama `get_alert_digest_data_for_member`
   - **Se `alert_count > 0`**: cria notification in-app + envia email via Resend (HTML inline com cores Lei 14.133)
   - **Se `alert_count == 0`**: nem notification nem email (evita inbox/sino poluído quando carteira saudável)
   - Em ambos casos: `record_alert_digest_sent` atualiza `last_sent_at` (evita re-disparo na próxima janela)
4. Retorna sumário de results: count, status por member, erros

**Resend opcional**: se `RESEND_API_KEY` ausente, só cria notifications. Erros de email logam mas não falham o batch.

**Email HTML**: inline-style (compat máxima de clientes), header navy + cards de alerta com border-left color por severity + tabelas de top critical contracts + próximos vencimentos + footer com link pra `/me` (gerenciar preferências). Layout ≤600px wide, sem CSS externo.

### Frontend: seção em `/me`

Nova seção `AlertDigestSection` no perfil do usuário, abaixo do card de tenants:

- **Toggle** "Habilitar digest periódico" + sub-texto explicando "só recebe email quando há alertas"
- **Chips de frequência** (Diário · Semanal · Mensal) com ativo magenta
- **Radio de threshold** (Todos vs Apenas críticos) com explicação inline
- Card de "Último envio" se já houve dispatch (timestamp + count)
- **Botões**: "Salvar preferências" (disabled se não dirty) + "Preview" (modal)

**Modal Preview**:
- Carrega `previewAlertDigest()` (RPC SECURITY DEFINER que respeita threshold atual do user)
- Se `alert_count === 0`: card verde "Carteira saudável" com explicação
- Se há alertas: card magenta de resumo + lista de alerts ativos (vermelho para danger, amarelo para warning) + tabelas de top critical + próximos vencimentos

Aviso visual de "alterações não salvas" se user mudou settings sem clicar Save.

## Otimização de bundle: Auxiliary lazy

A página `/me` (Auxiliary.tsx) estava eager-loaded desde sempre. Antes do V47 ela tinha ~200L e justificava-se eager. Mas a seção V47 adicionou ~300L (settings + preview modal + componentes) e empurraria o main bundle de 85.24 → 87.54.

**Solução**: Auxiliary.tsx (com `Me`, `Notifications`, `PublicValidation`) virou lazy. As 3 rotas (`/me`, `/notifications`, `/v/:code`) já estavam dentro do `<Suspense>` global, então funciona automaticamente.

**Resultado**: main bundle saiu de 85.24 → **83.13** (líquido **-2.11 KB**) e nasceu chunk `Auxiliary-*.js` de 6.19 KB que carrega sob demanda. Trade-off: 1 RTT extra na primeira navegação a `/me` (mas é navegação rara, não rota landing).

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ 1769 módulos · 13.16s
```

**Bundle**:
- Main: 85.24 → **83.13 KB gzip** (-2.11 KB líquido — otimização Auxiliary lazy compensou +V47)
- Auxiliary (novo chunk lazy): **6.19 KB gzip** (Me + Notifications + PublicValidation + AlertDigestSection)
- Margem até 150 KB: **66.9 KB** (recuperou +2.1 KB de margem)

## Diff V46 → V47

- **+1 migration** (054 alert_digest · ~360L · 1 tabela + 6 RPCs + pg_cron schedule)
- **+1 Edge Function** (`dispatch-alert-digest` · ~310L Deno · HTML email + notifications + record)
- **+1 seção em /me** (`AlertDigestSection` · ~250L · settings + preview modal)
- **+1 conversão lazy** (Auxiliary.tsx · removido eager-load, ganho de 2KB no main)
- **api.ts**: 3 wrappers + 4 interfaces + 2 enums de labels

## Decisões arquiteturais

### Por que tabela própria em vez de reusar `member_notification_prefs` (V20)?

A V20 tem schema `(member_id, event_type, channel, enabled)` — só boolean por evento+canal. Não comporta `frequency` e `severity_threshold` que são específicos do digest. Adicionar metadata jsonb ali poluiria a abstração.

Tabela própria mantém V20 focada em "deve-se enviar este evento?" e V47 em "como/quando o digest é montado?".

### Por que `digest_sends` (V21) não é usada?

V21 é específica para `digest-daily` (resumo geral diário com aprovações pendentes, GRDs etc). Misturar V47 ali criaria fricção:
- Mesma `UNIQUE (member_id, sent_date)` impediria o user de receber ambos os digests no mesmo dia
- `email_status` seria ambíguo (qual digest?)

A audit de V47 vive no próprio `member_alert_digest_settings` (`last_sent_at`, `last_alert_count`). Mais simples e local.

### Por que dois tipos de severity threshold (warning vs danger)?

- **warning** (default): admin quer ver tudo que pode escalar (PARs sem sanção, prazo vencido, multas pendentes) — postura proativa
- **danger**: gestor focado quer só o que bloqueia operação agora (vícios graves, garantias prestes a vencer) — evita ruído

Permite que **diferentes papéis no mesmo tenant** configurem digest apropriado sem politicagem central.

### Por que não enviar email quando alert_count == 0?

Inbox poluído é o pior inimigo de qualquer sistema de notificação. Se o sistema manda "tudo OK" toda semana, o user filtra automaticamente e perde os emails realmente importantes.

Trade-off: user pode achar que o sistema parou de funcionar. Mitigação: tela `/me` mostra `last_sent_at` mesmo quando não houve email enviado (audit do dispatch).

### Por que cron 9h UTC e não horário local do tenant?

Sistema multi-tenant com tenants em fuso global em teoria deveria customizar. Mas 9h UTC = 6h Brasília = boa hora pra começar o dia no mercado brasileiro (primary user base). Cron único é mais simples e debugável.

V48+ pode evoluir pra `digest_time_local` no settings + cron rodando de hora em hora filtrando por timezone do user.

## Para deployar

```bash
# 1. Migration
./scripts/deploy-supabase.sh migrate-only   # 054

# 2. Edge function
supabase functions deploy dispatch-alert-digest

# 3. Secrets (Resend)
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set RESEND_FROM_EMAIL=geocon@consultegeo.org
supabase secrets set SITE_URL=https://contratos.consultegeo.org

# 4. Verificar pg_cron schedule
SELECT * FROM cron.job WHERE jobname = 'dispatch-alert-digest-daily';

# 5. Smoke test
curl -X POST https://<projeto>.supabase.co/functions/v1/dispatch-alert-digest \
  -H "Authorization: Bearer <service_role_key>" \
  -H "Content-Type: application/json" \
  -d '{"dry_run":true}'
```

## Como testar (acceptance)

### Self-service
1. Login → `/me`
2. Seção "Digest de alertas Lei 14.133" aparece abaixo dos tenants
3. Toggle on → chips de frequência ativam → escolher "Semanal"
4. Radio "Todos" (warning + danger)
5. "Salvar preferências" — feedback verde
6. Refresh — settings persistem
7. "Preview" — modal mostra exatamente o que seria enviado agora

### Preview com carteira saudável
1. User em tenant novo sem alertas
2. Click "Preview"
3. Card verde "Carteira saudável · Nenhum alerta no momento"

### Preview com alertas
1. User em tenant com vícios + garantias vencendo
2. Click "Preview"
3. Resumo magenta "N alertas"
4. Cards individuais por tipo de alerta (vermelho/amarelo)
5. Listas de top critical + próximos vencimentos

### Dispatch manual (admin)
```bash
# Dry run - sem efeito colateral
curl -X POST .../dispatch-alert-digest -d '{"dry_run":true}'
# Vê quem seria atingido + alert_count que cada um teria

# Real dispatch
curl -X POST .../dispatch-alert-digest -d '{}'

# Para um member específico (teste)
curl -X POST .../dispatch-alert-digest -d '{"member_id":"<uuid>"}'
```

### Cron diário
1. Verificar `SELECT * FROM cron.job_run_details WHERE jobname = 'dispatch-alert-digest-daily' ORDER BY start_time DESC LIMIT 5`
2. Status deve ser `succeeded`
3. Verificar emails recebidos por members opted-in com alertas

### Threshold filtering
1. User configura threshold = "danger"
2. Tenant tem 2 vícios graves + 3 PARs sem sanção
3. Email recebido só lista os 2 vícios; PARs não aparecem
4. Mudar para "warning" → preview agora mostra ambos

### Janela de frequência
1. User com frequency=daily, last_sent_at=ontem 23h
2. Cron roda hoje 9h → user é elegível (>22h passaram)
3. User com frequency=daily, last_sent_at=hoje 5h
4. Cron roda hoje 9h → user NÃO é elegível (<22h)

## Retrospectiva V30 → V47 (18 versões)

| Versão | Tema | Mig | Bundle main |
|---|---|---|---:|
| V30-V38 | Lei 14.133 (9 institutos) | 036-044 | 75.13 → 80.03 |
| V39 | Timeline por contrato | 045 | 80.43 |
| V40 | Mobile audit | — | 80.47 |
| V41 | Dashboard por contrato | 046 | 80.94 |
| V42 | Timeline global tenant | 048 | 81.43 |
| V43 | Dashboard global tenant | 049 | 84.13 |
| V44 | Export Timeline PDF | 051 | 84.44 |
| V45 | Fornecedores sancionados | 052 | 84.89 |
| V46 | API keys + REST público | 053 | 85.24 |
| **V47** | **Email digest de alertas** | **054** | **83.13** ⬇ |

Bundle main **+8.00 KB gzip** em 18 versões. Primeira redução de bundle desde V40 (via otimização lazy).

**Marcos arquiteturais**:
- V30-V38: fundação Lei 14.133 (9 tabelas novas)
- V39-V45: 7 versões compositivas (views + RPCs sobre fundação)
- V46: superfície externa (1 tabela nova)
- V47: automação periódica (1 tabela nova + EF + cron)

## Próximas oportunidades (V48+)

Continuando ordem V41 (5 itens restantes):

6. **OKLCH migration** — DS Tier 3 (declinada 16x — pode permanecer pendente)
7. **EF download FGV/IBGE** — automatiza CSV import V31 (cron mensal puxa IPCA, INCC etc)
9. **Completar Pendencias V35-V38** (047 órfã + UI)
10. **Completar Carteira V12** (050 órfã / release-v43-prior)

**Possíveis extensões V47**:
- Configurar horário local (settings.send_hour_local + cron a cada hora)
- Anexar PDF do tenant dashboard ao email (reusa pattern do V44)
- Digest semanal/mensal de fornecedores sancionados (novo entity)
- Webhook outbound quando alert_count atravessa threshold (integração com Slack/Teams)

**Recomendação V48**: **EF download FGV/IBGE** (item 7). Completa automação da família reajuste/repactuação (V30-V33). Baixo risco, alto valor — admins atualmente fazem CSV manual mensal.

Alternativa: **Completar Pendencias V35-V38** (item 9) — finaliza trabalho órfão da 047 que já tem migration pronta mas UI desatualizada. Trabalho rápido (~1 sessão).
