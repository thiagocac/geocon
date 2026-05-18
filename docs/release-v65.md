# V65 — Notificação automática workflow GED

V65 **ativa V60 em produção**. O workflow de aprovação de revisão GED estava
funcionalmente completo mas passivo: assigned_to só descobria pendência se
navegasse manualmente para o documento. V65 adiciona triggers de banco que
populam `notifications` automaticamente, ativando toda a stack de notification
já existente (V20+ tem preferências, V24 tem broadcast, V53 tem real-time).

## Contexto

V60 entregou:
- Tabela `ged_revision_approval_steps` com lifecycle
- 2 RPCs (`instantiate_ged_revision_workflow`, `decide_ged_revision_step`)
- Página `/ged/documentos/:docId/aprovar`
- Magic link para aprovador externo

Mas **nenhum efeito colateral**. Quando step era criado/decidido, nada acontecia
além do INSERT/UPDATE. Sem notificação:
- Aprovador interno (logado no app) não sabia que tinha pendência
- Autor da revisão não sabia se foi aprovada/reprovada
- O sistema de notification + push (V20+) não conectava

V65 fecha o loop com triggers no banco — sem mudança no frontend.

## O que V65 entrega

### Migration 064 — 2 triggers no `ged_revision_approval_steps`

**Trigger 1: AFTER INSERT** (`notify_ged_revision_step_assigned`)
- Dispara em todo INSERT com `assigned_to NOT NULL` e `status='pendente'`
- Cria 1 notification para `assigned_to`:
  - **title**: "Revisão GED aguardando sua aprovação"
  - **body**: `{doc_title} · revisão {N} · etapa "{step_nome}"`
  - **link**: `/ged/documentos/{id}/aprovar`
  - **kind**: `workflow_assignment`
  - **metadata** jsonb: entity_type, step_id, document_id, version_id, ordem, due_at

**Trigger 2: AFTER UPDATE** (`notify_ged_revision_step_decided`)
- Dispara só quando status sai de `pendente` para outro
- **Branch `aprovado`**:
  - Busca próximo step pendente (ORDER BY ordem ASC LIMIT 1)
  - Se existe → notifica próximo aprovador: "Próxima etapa GED aguarda sua aprovação"
  - Se não existe (último) → notifica autor (`uploaded_by`): "Revisão GED publicada"
- **Branch `devolvido` / `reprovado`**:
  - Notifica autor da revisão com título distinto + body inclui decided_by + 120 chars do comment
  - kind = `error` (reprovado) ou `warning` (devolvido)

**Reusa `notify_recipient(recipient_id, title, body, link, kind, metadata)`** (V04)
— helper já existente que insere na tabela `notifications` e retorna id.

**Sem mudança no frontend** — toda a stack de notification (V20 preferences,
V24 broadcast, V53 real-time alerts via bell counter) já consome `notifications`
e funciona automaticamente.

### SKIP_AUTH demo — notificações simuladas

`decideGedRevisionStep` agora simula os triggers no mock:
- Aprovar step pendente → cria notification "Próxima etapa" ou "Revisão publicada"
- Devolver/reprovar → cria notification para autor com title/kind apropriados

Notification é `unshift` em `MOCK_NOTIFICATIONS` — aparece imediatamente no
bell counter ao recarregar/refetch.

**Notificação inicial** adicionada em `MOCK_NOTIFICATIONS`:
- `n5` "Revisão GED aguardando sua aprovação" para doc-1 revisão 3 etapa
  "Aprovação final · Coordenação" — corresponde ao mock `grs-2` pendente
- Aparece com 2 horas de idade

Demo flow:
1. Abre Inbox de notifications → vê n5 (workflow GED)
2. Click → vai para `/ged/documentos/doc-1/aprovar`
3. Aprova step 2 → notification "Revisão publicada" aparece no inbox
4. Bell counter mostra unread incrementado

## Decisões

1. **Triggers de banco, não Edge Function** — Postgres dispara em qualquer
   caminho (RPC, UI direta, importação batch). Edge Function exigiria que
   o frontend chamasse explicitamente após o RPC, abre brecha. Triggers
   são fonte única de verdade.

2. **Reusa `notify_recipient`** — não duplica lógica de INSERT. Helper V04
   já resolve tenant_id via member. SECURITY DEFINER permite invocar de
   trigger SECURITY DEFINER aninhado.

3. **Branch separado para `publicada`** — quando última aprovação acontece,
   o autor merece notificação especial ("revisão publicada"), não só
   "próxima etapa". Trigger UPDATE detecta isso via `NEXT step IS NULL`.

4. **Comment truncado a 120 chars** — body de notification não deve ter
   parágrafos inteiros. 120 chars cabem em push notification mobile e
   email subject line típico.

5. **`kind` semântico** — workflow_assignment (azul), success (verde),
   warning (amarelo), error (vermelho). UI da NotificationDropdown
   (V53 com bell counter) já formata por kind.

6. **Sem trigger AFTER INSERT em workflow_templates / workflow_steps** —
   só steps individuais ativos disparam notification. Template setup é
   evento administrativo.

7. **Trigger só notifica quando status muda DE `pendente`** — evita
   re-notificar se step for editado por outro motivo (raro mas possível).

8. **Mock simula 1:1 a lógica do trigger** — `decideGedRevisionStep` em
   SKIP_AUTH faz unshift em MOCK_NOTIFICATIONS com a mesma lógica do PL/pgSQL.
   Garante consistência entre demo e produção.

9. **`uploaded_by` como recipient em "publicada"** — o autor da revisão é
   `ged_document_versions.uploaded_by`. Quem fez upload da R03 quer saber
   quando R03 vira vigente.

10. **Sem notificação por email/webhook explícita** — `notifications` já
    é consumida pelo digest (V21) e pelo broadcast (V24). Usuário com
    `notification_preferences.email = true` recebe automaticamente.
    Webhook Slack/Teams (V24) também.

## Limitações conhecidas (V66+)

- **Sem notificação ao instantiate** — `instantiate_ged_revision_workflow`
  cria múltiplos steps em transação; o trigger AFTER INSERT dispara N vezes.
  Aceitável: cada step tem assigned_to diferente; só 1ª etapa fica `pendente`
  na maioria dos templates (resto fica pendente mas ordem > 1). Notificação
  vai para todos com ordem=1 — ok.
- **Sem agrupamento** — 2 steps simultâneos = 2 notifications. UI da
  NotificationDropdown (V53) já agrupa por kind, mas dentro do mesmo kind
  ainda lista individualmente.
- **Não envia para magic link recipients** — magic link é convite externo
  via email separado (não member do sistema). V60 já cuida disso via
  `issue_approval_magic_link` + função de email externa.

## Bundle V64 → V65

| Chunk | V64 | V65 | Δ |
|---|---:|---:|---:|
| Main | 101.28 | **101.73** | +0.45 |

Δ pequeno porque o trabalho é majoritariamente backend (migration 064 com
~150 linhas SQL). Frontend só ganha 1 notification mock + lógica de
simulação no decideGedRevisionStep (~50 linhas).

Margem 150 − 101.73 = **48.27 KB**.

## Sequência V54-V65 cumulativa

| Versão | Área | Tema | Bundle | Δ |
|---|---|---|---:|---:|
| V54 | Medição | Validações automáticas | 92.69 | +2.25 |
| V55 | SOV | Curva ABC + Pareto | 94.63 | +1.94 |
| V56 | GED | Validade temporal + cron | 95.79 | +1.16 |
| V57 | SOV | Auditoria preços SINAPI/SICRO | 97.50 | +1.71 |
| V58 | GED | Diff entre revisões | 98.23 | +0.73 |
| V59 | GED | Painel KPI do acervo | 98.67 | +0.44 |
| V60 | GED | Workflow aprovação revisão | 99.32 | +0.65 |
| V61 | Medição | Apontamento campo mobile | 99.42 | +0.10 |
| V62 | Medição | Offline queue + PWA | 99.54 | +0.12 |
| V63 | Medição | UI inspeção da fila | 99.63 | +0.09 |
| V64 | SOV | Histórico item-level | 101.28 | +1.65 |
| V65 | GED | **Notif. automática workflow** | 101.73 | +0.45 |

**+9.04 KB total** em 12 versões = 18% do crescimento até 150 KB.
Cobertura: Medição 4× · SOV 3× · GED **5×**.

GED ficou robusto: V52 (realtime) · V56 (validade) · V58 (diff) · V59 (KPI) ·
V60 (workflow) · V65 (notif workflow). O workflow agora é end-to-end.

## Próximas oportunidades (V66+)

**Compliance GED** (último item da área):
1. **Marca d'água "CÓPIA NÃO CONTROLADA"** (~300 linhas) — Edge Function
   `generate-watermarked-pdf` + assinatura ICP-Brasil opcional. Fecha o
   capítulo GED.

**SOV grande pendente**:
2. **Composições de preço explícitas** (~400 linhas) — schema novo
   `contract_item_compositions`. Liga V57 + SINAPI compositions oficiais.

**SOV polish** (extensões de V64):
3. **Marcar `source` em SovImport/Bulk** (~30 linhas) — UI já tem ícones
   distintos por origem (sov_import, sov_bulk, etc.); falta os endpoints
   setarem `SET LOCAL` ou parâmetro source. Trivial.

**Completar V62**:
4. **Dedup fila offline** (~80 linhas) — hash de payload.
5. **UI quota IndexedDB** (~60 linhas) — `navigator.storage.estimate()`.

**Medição**:
6. **Apontamento mobile — swipe gestures** (~50 linhas) — touchstart/end
   para navegação prev/next sem botões.

V66 natural: **Composições de preço (2)** — única feature grande pendente,
escopo 400 linhas. SOV ainda tem 3 toques vs Medição/GED 4-5×.

Alternativas mais curtas: **Marca d'água (1)** fecha capítulo GED;
**Dedup fila (4)** completa V62 com 80 linhas; **Marcar source (3)** é
trivial. Continuar com qual?
