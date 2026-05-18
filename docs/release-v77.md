# V77 — Fix: Realtime Alerts subscribed em múltiplos consumidores

V76 entregou visibilidade de erros de boot via `BootErrorBoundary`. Imediatamente
o erro real apareceu:

```
Error: cannot add `postgres_changes` callbacks for
realtime:realtime_alerts:tenant=<uuid> after `subscribe()`.
```

V77 conserta a causa.

## O que entrega

### `subscribeToRealtimeAlerts` agora multiplexa callbacks por tenant

Bug: o hook `useRealtimeAlerts` é consumido **simultaneamente** por dois
componentes do layout:

- `RealtimeAlertToasts.tsx` (toasts de alerta no canto)
- `NotificationDropdown.tsx` (sininho no header)

Cada chamada invocava `subscribeToRealtimeAlerts(tenantId, callback)`, que
fazia:

```ts
supabase.channel(`realtime_alerts:tenant=${tenantId}`)
  .on('postgres_changes', ..., cb)
  .subscribe();
```

Como o **nome do channel é determinístico** (mesmo tenantId nos dois lugares),
o cliente Supabase JS **reutiliza o channel existente** na segunda chamada.
O primeiro chamador faz `.on().subscribe()` com sucesso. O segundo encontra
o channel já em estado SUBSCRIBED, tenta `.on('postgres_changes', ...)`, e
o protocolo Realtime joga:

> cannot add postgres_changes callbacks ... after subscribe()

Em V76 isso explodia durante o boot do dashboard (layout monta os dois
componentes ao mesmo tempo) e o `BootErrorBoundary` capturava — mas a tela
de erro substituía o app, então parecia que nada funcionava.

### Solução: singleton com multiplexação local

`api.ts` agora mantém um `Map<tenantId, { channel, subscribers }>`:

- Primeira chamada cria o channel, faz `.on().subscribe()`, registra o
  callback no `Set`
- Chamadas subsequentes para o mesmo tenant **apenas adicionam o callback**
  ao Set existente
- O callback central do channel itera sobre todos os subscribers ao receber
  uma linha nova (com `try/catch` para isolar exceções de um subscriber)
- Cleanup remove o callback do Set; quando o Set fica vazio, o channel é
  fechado e a entrada do Map é apagada

Resultado: N consumidores → 1 channel WebSocket → N callbacks chamados.

## Decisões

**Por que singleton em module-level e não Context React?**

Context exigiria envolver `<RealtimeAlertsProvider>` no root da árvore e
mudar a API do hook. O singleton em api.ts é invisível para os callers
existentes (mesma assinatura `subscribeToRealtimeAlerts`) e o estado é o
módulo, que tem o ciclo de vida certo para WebSockets (vive enquanto o
bundle existe, sobrevive a re-renders).

**Por que `Array.from(subscribers)` antes de iterar?**

Um callback pode chamar `dismiss()` ou outra ação que indiretamente
desinscreva outro componente — mutaria o Set durante `for..of`. Snapshot
antes de iterar garante semântica previsível.

**Por que isolar exceções de callback com try/catch?**

Se um subscriber joga, os outros ainda devem receber. Comportamento padrão
de event emitters em Node/DOM, replicado aqui.

**Por que não usar UUID no nome do channel para forçar canais separados?**

Funciona, mas desperdiça uma conexão WebSocket por consumidor. Multiplexar
é estritamente melhor: 1 conexão, 1 RLS check no servidor, N callbacks no
cliente.

**Por que `unknown` no tipo `channel`?**

`@supabase/supabase-js` não exporta o tipo `RealtimeChannel` em todos os
paths de import. Em vez de criar uma dependência frágil de tipos, isolamos
o tipo no struct interno e fazemos cast no único ponto de uso
(`removeChannel`). Não há type-erasure no callsite — `subscribeToRealtimeAlerts`
mantém a assinatura tipada original.

## Bundle V76 → V77

```
main (gzipped):  110.67 KB → 110.78 KB   (+0.11 KB, margem restante: 39.22 KB)
```

Aumento mínimo (o singleton em si é ~30 linhas). Não há migration nova.

## Arquivos modificados

- `src/lib/api.ts` — `subscribeToRealtimeAlerts` refatorado para usar
  `registerRealtimeAlertSubscriber` (singleton de canais por tenant)

## Como verificar

```bash
npm run build && npm run preview
# DevTools → Network → WS → confirmar UMA única conexão WebSocket pro
# Supabase, não duas (era o sintoma colateral em produção).
# DevTools → Console: nenhum erro "cannot add postgres_changes callbacks".
# Dashboard renderiza normalmente.
```

Em produção, após deploy o erro desaparece sem ação do usuário — o SW V76
já força revalidação de assets via cache busting por hash novo.
