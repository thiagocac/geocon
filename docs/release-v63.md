# V63 — UI inspeção da fila offline

V63 completa V62 fechando o gap explícito: agora o fiscal/operador consegue
**ver e gerenciar** operações pendentes no IndexedDB, não só o badge agregado.

## Contexto

V62 deixou 3 limitações documentadas:
1. **Sem UI de inspeção da fila** — só badge agregado no header do field entry
2. **Sem deduplicação** — apontar 2× offline cria 2 operações
3. **Sem progress do quota IndexedDB**

V63 resolve (1). Operações que ficam bloqueadas (>5 retries) precisavam de
console DevTools para inspecionar; agora têm tela própria.

## O que V63 entrega

### 1. Página `/medicoes/fila` (lazy chunk 7.5 KB raw)

**Layout normal (Layout component)** — não mobile-first, pois é tela de
admin/operador, normalmente acessada de desktop quando há problema.

**Estrutura**:

- **PageHeader** com kicker "Apontamento de campo", título "Fila offline",
  back para `/contratos`. Actions:
  - `Atualizar` (RefreshCcw) — re-lista IDB
  - `Sincronizar tudo` (Send) — chama `processQueue()`, disabled se offline ou fila vazia
- **Status banner**: pill Online/Offline + mensagem "Re-tentativas pausadas até voltar a conexão" + toast pós-sync
- **4 stat cards**: Total · Aguardando (retries=0) · Re-tentando (1-4) · Bloqueadas (≥5)
- **Lista** com background tonal: vermelho claro para bloqueadas, amarelo para retrying, neutro para fresh

Cada linha (`<OpRow>`):
- Avatar com ícone do kind (`Calculator | Camera | MessageSquare`)
- Título: "Linha de cálculo" / "Foto / evidência" / "Comentário"
- Metadado: "criada Xh atrás · DD/MM HH:mm"
- Pill de retries quando >0 (yellow/red conforme bloqueio)
- **Summary inline** do payload (truncado, sanitizado)
- **last_error** em vermelho quando presente
- Botões à direita:
  - **Tentar agora** (RefreshCcw, outline) — chama `resetOperationRetries` + `processQueue`
  - **Resetar** quando bloqueada (label diferente)
  - **Descartar** (Trash2, ghost error) — com `confirm()` exigindo confirmação explícita

### 2. Summarização sanitizada de payload

`summarizePayload(op)` extrai informação útil sem vazar dados sensíveis:

| Kind | Sumário gerado |
|---|---|
| `calc_line` | `Item mi-1a2b3c… · qtd 312 · −22.91, −43.18` |
| `comment` | `Item mi-1a2b3c… · "Pavimento 2, ala norte. Concretagem…"` (80 chars) |
| `evidence` | `IMG_4521.jpg · 384 KB · GPS −22.911, −43.179` |

Trim para 80 chars no body do comentário, `slice(0, 8)` no UUID do item.
Evita stack traces longos ou texto inteiro de observação.

### 3. Link no MeasurementFieldEntry

V62 mostrava só badge "X na fila". V63 adiciona link **abaixo do badge** quando
há operações com `retries > 0`:

```tsx
{queue.some((op) => op.retries > 0) && (
  <Link to="/medicoes/fila">
    <Inbox className="h-3 w-3" />
    Inspecionar fila ({queue.filter(op => op.retries > 0).length} com falha)
  </Link>
)}
```

Discreto (font-mono 10px) mas chamativo (cor navy) quando aparece.

### 4. Acesso direto

A rota `/medicoes/fila` é acessível diretamente — útil para:
- Suporte abrir DevTools no celular do fiscal e acessar para diagnosticar
- Admin checar saúde da fila sem precisar entrar em medição específica
- Bookmark/atalho para usuários power

Não adicionei à sidebar (poluiria menu) — entry points são (a) badge no field
entry, (b) URL direta. Padrão de "página secundária do operador".

## Decisões

1. **Layout normal, não mobile-first** — fila é tela de problema, geralmente
   resolvida em desktop por suporte/admin. Reuso de Card/Button/PageHeader.

2. **`confirm()` nativo para descartar** — operação destrutiva (dados serão
   perdidos). Modal customizado seria mais visual, mas `confirm()` força
   leitura e bloqueia ação acidental. ~0 KB.

3. **Sem detalhes expansíveis no payload** — só summary truncado. Quem
   precisa ver tudo abre DevTools. Trade-off: simplifica UI + evita exibir
   base64 enorme da foto enfileirada.

4. **Retry chama `resetOperationRetries` + `processQueue`** — reseta retries=0
   antes de tentar de novo. Trade-off: pode "esconder" problema crônico, mas
   é o que o operador quer (retentar manualmente).

5. **Background tonal por estado** — vermelho/amarelo/neutro sinaliza
   prioridade visual sem precisar ler labels. Operador identifica
   bloqueadas no scan rápido.

6. **Polling não automático** — V62 polla 30s no field entry; V63 inspector
   não. Aqui a expectativa é "fui ver, manipulo, saio". Auto-refresh
   confundiria se um ação manual está acontecendo. Botão Atualizar explícito.

7. **Sem entry point na Sidebar** — manter menu enxuto. Field entry → badge
   "X com falha" é a porta natural. Acesso direto via URL é fallback.

## Bundle V62 → V63

| Chunk | V62 | V63 | Δ |
|---|---:|---:|---:|
| Main | 99.54 | **99.63** | +0.09 |
| OfflineQueueInspector (lazy) | — | 7.5 KB raw | — |

Δ no main quase imperceptível — toda a UI fica em chunk lazy. Margem 150 − 99.63 = **50.37 KB**.

## Sequência V54-V63 cumulativa

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
| V63 | Medição | **UI inspeção da fila** | 99.63 | +0.09 |

**+6.94 KB total** em 10 versões = 14% do crescimento até 150 KB.
Cobertura: Medição **4×** · SOV 2× · GED 4×. **Trio mobile-first V61+V62+V63
fecha o ciclo completo** — interface + persistência + observabilidade.

## Próximas oportunidades (V64+)

**Quick wins ativando versões antigas**:
1. **Notificação automática workflow GED** (~150 linhas) — trigger no INSERT
   de `ged_revision_approval_steps` dispara notification para assigned_to.
   Ativa V60 em produção (workflow só "existe" passivamente sem isso).

**Features grandes pendentes**:
2. **Composições de preço explícitas SOV** (~400 linhas) — schema novo
   `contract_item_compositions` (mão-de-obra + material + equipamento). Liga
   V57 com SINAPI compositions oficiais.
3. **Marca d'água "CÓPIA NÃO CONTROLADA" GED** (~300 linhas) — Edge Function +
   ICP-Brasil opcional.

**SOV / Medição**:
4. **Histórico item-level audit trail SOV** (~200 linhas) — quem mudou
   o preço de quando para quando.
5. **Deduplicação na fila offline V62** (~80 linhas) — hash de payload
   evita 2 calc_lines idênticas. Completa V62 com a segunda limitação documentada.
6. **UI de quota IndexedDB** (~60 linhas) — `navigator.storage.estimate()`
   mostra uso. Última limitação V62 documentada.

V64 natural: **Notificação automática workflow (1)** ativa V60; ou
**Dedup fila (5)** completa V62 com mais uma das 3 limitações conhecidas.
Continuar com qual?
