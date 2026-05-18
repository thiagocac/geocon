# V74 — Notification preferences UI para workflow V65

V74 completa V65 expondo os eventos de workflow GED na UI já existente de notification preferences.

## Contexto

V20 criou infraestrutura completa de notification preferences: tabela `member_notification_prefs`, RPC `should_send_notification`, `upsert_notification_pref`, page `NotificationPreferences.tsx` com lista de 8 event types.

V65 adicionou 2 triggers em `ged_revision_approval_steps` que disparam notificações via `notify_recipient`, mas elas usavam `kind` arbitrário (`workflow_assignment`, `workflow_decided`). Usuário não conseguia configurar canal (in_app vs email) para esses eventos porque eles não estavam na lista da UI.

V74 fecha o gap.

## O que entrega

**API** em `src/lib/api.ts`:
- `NotificationEventType` union estendido com 2 novos: `workflow_assignment` e `workflow_decided`
- `EVENT_DEFAULTS` ganha entries (true para ambos)
- `ALL_EVENTS` array atualizado
- `NOTIFICATION_EVENT_LABELS` (novo export) — Record pt-BR com title + hint para cada event type (10 entradas)

**Página `/preferencias/notificacoes`** (existente desde V20):
- Lista `EVENTS` ganha 2 entradas para os eventos GED
- UI mostra cada event como row com label + description + 2 toggles (in_app + email)

**Sem migration nova** — tabela já é genérica desde V20. RPC `should_send_notification` aceita qualquer `event_type` sem precisar de migration.

## Decisões

- Sem adicionar event types ao schema (CHECK constraint não existe — flexibilidade preservada)
- Defaults `true` para ambos (V65 envia por default; usuário pode optar opt-out)
- Labels separados em `NOTIFICATION_EVENT_LABELS` para reuso futuro (digest emails, dashboard de notificações)
- Reusa página existente (sem duplicação)

## Bundle V73 → V74

Main 108.81 → **108.82** (+0.01 KB). Mudança quase 100% string constants.
