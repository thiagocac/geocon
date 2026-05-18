# V61 — Apontamento de campo mobile-first

V61 abre a **8ª versão consecutiva** com a feature mais transformadora pendente:
permitir que o fiscal aponte medições direto do celular em obra. Reusa toda a
infraestrutura existente (measurement_items, calc_lines, evidences,
item_comments) — sem schema novo.

## Contexto e motivação

Até V60, o apontamento de medição era desktop-oriented:
- `MeasurementMemoryPage` (635 linhas) com formula evaluator AST seguro
- Multiplas linhas por item (locais físicos diferentes)
- Upload de fotos via drag-and-drop, sem GPS automático
- Sem suporte a entrada por voz

Fiscal no canteiro com celular não consegue usar essa interface bem:
- Botões pequenos, fórmulas com teclado completo
- Drag-and-drop não funciona em mobile
- Não há captura direta da câmera + GPS
- Sem sinalização de offline/online

V61 entrega **interface paralela** otimizada para o cenário de campo, sem
substituir a página de memória detalhada (que continua para apontamento de
escritório / cálculos complexos).

## O que V61 entrega

### 1. Página `/contratos/:id/medicoes/:medId/campo` (lazy chunk 12 KB raw)

**Layout mobile-first**: sem Layout normal (sidebar/topbar). Fullscreen com
top bar fixa + bottom navigation fixa.

**Top bar**:
- Botão "Sair" (X) no canto esquerdo
- Centro: "Apontamento · campo" + `Medição #N`
- Direita: badge online/offline (Wifi/WifiOff ícone)
- Linha inferior: barra de progresso (% items tocados) com contadores
  `idx+1/total` e `tocados ok`

**Card do item atual** com 4 seções:

1. **Cabeçalho** — código + descrição (texto grande) + unidade + saldo disponível
2. **Quantidade** — input numeric com `inputMode="decimal"` + pattern,
   font-size 4xl (font-mono tabular). Alerta inline se quantidade > saldo
3. **Evidência fotográfica**:
   - Botão grande "Tirar foto" com `<input type="file" accept="image/*" capture="environment">`
   - GPS automático via `navigator.geolocation.getCurrentPosition()` (high accuracy, timeout 10s)
   - Indicador de GPS capturado (latitude/longitude truncadas)
   - Grid de thumbnails das fotos tiradas na sessão
   - Botão manual "Capturar GPS" se localização não foi obtida automaticamente
4. **Observação** com botão "Ditar" (voz-para-texto via Web Speech API)

**Bottom nav** (sticky):
- 2 colunas: "Anterior" (disabled em idx=0) · "Próximo" (disabled em idx=length-1)

**Botão Salvar** (fixo no card):
- Altura 14 (56pt) — supera o mínimo 44pt
- Ícone dinâmico: Send (primeira vez) → CheckCircle2 (atualizar) → Loader2 (salvando)
- Disabled se quantidade vazia ou outra operação em andamento

### 2. Componente `<VoiceButton />`

Voz-para-texto via Web Speech API. Detecta suporte ao carregar:
- `window.SpeechRecognition || window.webkitSpeechRecognition`
- Se não suportado: mostra "voz não disponível" (cinza)
- Quando ativo: pulse vermelho + texto "Gravando…"
- Linguagem: `pt-BR`
- `continuous: false` + `interimResults: false` — captura uma frase completa
  e retorna

Browsers suportados: Chrome/Edge/Safari iOS. Firefox sem flag → fallback gracioso.

### 3. Reuso de APIs existentes

Nenhum endpoint novo. Salvar dispara:

```ts
// 1. CalcLine "campo" — quantidade única por item, traceabilidade
await upsertCalcLine({
  measurement_item_id: item.id,
  local: gps ? `${lat}, ${lng}` : 'campo',
  metodo: 'contagem',
  formula: String(qty),
  variaveis: {},
  quantidade_calculada: qty,
  observacao: observacao || null,
});

// 2. Comentário kind='campo' se observação não-vazia
if (observacao.trim()) await addItemComment({ ..., kind: 'campo' });

// 3. Evidence (foto) — feito separadamente no momento da captura,
//    não no salvar. Já registra lat/lng/taken_at.
```

Vantagens do reuso:
- Sem migration nova (8 versões consecutivas sem schema — V51 a V53 + V57)
- Auditoria automática via `measurement_calc_lines` (traceability ↔ MeasurementMemoryPage)
- Validações da V54 disparam normalmente (engine não distingue origem campo vs desktop)
- Aprovação magic link (V20+) funciona end-to-end

### 4. Indicador online/offline

`window.addEventListener('online' | 'offline')` mantém state local.

**Sem queue persistente nesta versão** — V62 adicionará IndexedDB + Service
Worker para fila offline. V61 apenas:
- Mostra badge online/offline no header
- Mostra aviso "Sem conexão · ao salvar, operação pode falhar" abaixo do botão
  quando offline
- Não bloqueia salvar (em caso de blip momentâneo, deixa tentar)

Trade-off aceitável: V61 foca na **interface** mobile; offline pesado vai
para V62.

### 5. Integração no `MeasurementDetail`

Botão **"Campo"** (com ícone `Smartphone`) aparece quando `isPreliminar`
(medição editável: não em emitida/aprovada/paga). Posicionado **antes** dos
botões "Copiar saldo / Copiar anterior", marcando-o como ação primária do
fluxo de obra.

Link relativo `campo` mantém contexto na URL.

## Decisões

1. **Página standalone, não dentro do Layout** — fullscreen mobile com top/bottom
   bars próprias. Layout sidebar polui em 5" de tela.

2. **Toque > 44pt em tudo** — Apple HIG mínimo. Botões 56pt (h-14) garantem
   uso com luva, dedos sujos, sob sol.

3. **Sem queue offline persistente em V61** — IndexedDB + Service Worker
   adicionaria ~200 linhas. V62 isolado.

4. **1 calc_line por item** — em vez de "+ Adicionar local" como MeasurementMemoryPage,
   o fluxo campo cria/atualiza apenas 1 calc_line com método='contagem' e
   fórmula = string da quantidade. Auditoria preservada; complexidade
   reduzida 10×.

5. **GPS automático ao carregar item** — `useEffect` com [item.id] dispara
   `getCurrentPosition`. Trade-off: precisão "approximate" em alguns devices;
   `enableHighAccuracy: true` força GPS chip se disponível.

6. **Foto com `capture="environment"`** — força câmera traseira em Android.
   Em iOS Safari, abre câmera nativa. Sem upload de galeria — V61 é
   apontamento "agora" no local.

7. **Voz captura 1 frase, não contínua** — `continuous: false` evita travas
   ou interferência ambiental. Usuário diz uma frase, vê texto, pode dizer
   outra (concatena com espaço).

8. **Sem swipe gesture (touchstart/touchend)** — só botões prev/next. Swipe
   é tentador mas conflita com scroll vertical do conteúdo. Botões são
   acessíveis também.

9. **Tocado = local state, não persistido** — `tocados: Set<string>` reseta
   se navegar para outra página. Para feedback "X items ok" na sessão atual.
   Persistência real está no backend via calc_lines.

10. **Sem swipe-cards animados** — re-render via `key={currentItem.id}` é
    suficiente. Animações exigem framer-motion (~25 KB). V62 pode adicionar.

## Bundle V60 → V61

| Chunk | V60 | V61 | Δ |
|---|---:|---:|---:|
| Main | 99.32 | **99.42** | +0.10 |
| MeasurementFieldEntry (lazy) | — | 12 KB raw | — |

Δ no main quase imperceptível porque a página é lazy e reusa APIs existentes.
Margem 150 − 99.42 = **50.58 KB**.

## Sequência V54-V61 cumulativa

| Versão | Área | Tema | Bundle | Δ |
|---|---|---|---:|---:|
| V54 | Medição | Validações automáticas | 92.69 | +2.25 |
| V55 | SOV | Curva ABC + Pareto | 94.63 | +1.94 |
| V56 | GED | Validade temporal + cron | 95.79 | +1.16 |
| V57 | SOV | Auditoria preços SINAPI/SICRO | 97.50 | +1.71 |
| V58 | GED | Diff entre revisões | 98.23 | +0.73 |
| V59 | GED | Painel KPI do acervo | 98.67 | +0.44 |
| V60 | GED | Workflow aprovação revisão | 99.32 | +0.65 |
| V61 | Medição | **Apontamento campo mobile** | 99.42 | +0.10 |

**+6.73 KB total** em 8 versões = 13% do crescimento até 150 KB.
Cobertura: Medição **2×** · SOV 2× · GED 4×.

## Próximas oportunidades (V62+)

**V61 follow-ups**:
1. **Service Worker + IndexedDB offline queue** (~200 linhas) — completa a
   promessa "field-first": fiscal grava no celular sem internet, sync
   automático quando volta a ter. Reusa V61 page.
2. **Swipe gesture entre items** (~50 linhas) — touchstart/touchmove/touchend,
   sem libs. UX melhor.

**Medição**:
3. **Validação backend submit gate** — já existe desde V16, confirmado V57.

**SOV**:
4. **Composições de preço explícitas** (~400 linhas) — schema novo
   `contract_item_compositions`. Liga V57 com SINAPI compositions oficiais.

**GED**:
5. **Marca d'água "CÓPIA NÃO CONTROLADA"** (~300 linhas) — Edge Function +
   ICP-Brasil opcional.
6. **Notificação automática workflow** (~150 linhas) — trigger no INSERT
   de ged_revision_approval_steps dispara notification → ativa V60 na
   prática.

**Estratégico**:
7. **Modo "campo PWA"** — V61 + manifest.json + Service Worker base para
   instalar como app na home screen do celular. ~100 linhas + 1 arquivo.

V62 natural: **Service Worker offline queue (1)** completa V61. Outra
alternativa: **Notificação automática workflow (6)** ativa V60 em produção.
Continuar com qual?
