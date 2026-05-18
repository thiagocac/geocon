# V67 — Análise de divergência + 5 polish

V67 é uma versão **bundle**: 1 feature analítica nova (divergência de preços
ligando V57+V64+V66) + 5 polish que completam V62/V64/V61 e dão acabamento a
limitações documentadas das versões anteriores.

## 1. Análise de divergência de preços (~150 linhas)

### Migration 066 — View + RPC

**`v_contract_price_divergence`** view: para cada `contract_item` com
composição cadastrada, calcula:
- `preco_atual` = `contract_items.preco_unitario`
- `preco_calculado` = `composition.total_sem_bdi × (1 + bdi/100)`
- `divergencia_abs` e `divergencia_pct`
- `severidade`: `ok` (≤2%) · `atencao` (2-10%) · `alerta` (10-25%) · `critico` (>25%) · `indeterminado` (preço zero)
- `impacto_financeiro` = `divergencia_abs × quantidade_contratada`

**RPC `list_contract_price_divergences(contract_id, severidades?)`** filtra
por contrato + opcional array de severidades. ORDER BY `abs(divergencia_pct) DESC`.

### Página `/contratos/:id/divergencias-preco` (lazy 7.1 KB raw)

- 4 stat cards: Total com composição · Alertas · Críticos · **Impacto líquido**
  (verde se sobreestimado positivo, vermelho se subestimado)
- 5 filter chips: Todos · Críticos · Alertas · Atenção · OK
- Tabela com colunas: Item (codigo+desc+meta) · Atual · Calculado · Divergência (% + R$) · Impacto · Badge severidade
- Footer explicando convenção positiva (preço acima = sobreestimado/vantagem comercial) vs negativa (abaixo = risco prejuízo)

**Liga V57 + V64 + V66**:
- V57 (auditoria SINAPI) compara preço atual vs referência externa
- V64 (histórico) mostra **quando/por quem** preço mudou
- V66 (composição) tem o cálculo bottom-up
- V67 **conecta os 3** — preço atual vs cálculo bottom-up

Botão "Divergências" no header do `ContractSheet` ao lado de "Auditoria de preços".

## 2. Marcar `source` em SovImport/Bulk (~30 linhas)

V64 deixou source field aberto preparado para `sov_import` / `sov_bulk` /
`sov_lock` / `sov_unlock` / `sov_edit` — mas todos UPDATEs caíam em `sov_edit`
porque trigger usava valor hardcoded.

**Migration 066** também:
- Helper `set_audit_source(text)` faz `SET LOCAL app.audit_source` — session-scoped
- Trigger V64 atualizado: `coalesce(current_setting('app.audit_source', true), 'sov_edit')`

**API**: `setAuditSource(source)` cliente chama RPC antes de bulk.

**4 endpoints atualizados** em `src/lib/api.ts`:
- `bulkLockItems` → `sov_lock` ou `sov_unlock`
- `bulkSetDiscipline` → `sov_bulk`
- `bulkAdjustPrices` → `sov_bulk`
- `bulkSoftDeleteItems` → `sov_bulk`

Agora a UI V64 (HistoryModal) mostra ícones corretos por origem:
- `ImportIcon` para sov_import
- `Pencil` para sov_edit
- `Package` para sov_bulk
- `LockIcon`/`Unlock` para lock/unlock

## 3. Dedup fila offline (~80 linhas)

V62 deixou explícito: "se fiscal salvar mesmo item 2× offline, vai
enfileirar 2 calc_lines".

**`computeDedupKey(kind, payload)`** em `offlineQueue.ts` usa hash sjis
determinístico sobre subset de campos por kind:
- `calc_line`: `measurement_item_id + metodo + formula + quantidade_calculada`
- `comment`: `measurement_item_id + body + kind`
- `evidence`: `measurement_item_id + file_name + blob_size`

`OfflineOperation.dedup_key` é novo campo persistido.

**`enqueueOperation()` atualizado**:
- Antes de inserir, busca op existente com mesmo `dedup_key` e `retries < 5`
- Se achar: **substitui payload + reseta retries** e retorna o id existente
- Se não: insere normal

Resultado: salvar mesmo item 2× offline mantém só 1 op (a mais recente).
Para evidence: foto com mesmo nome do mesmo item é substituída (sempre fica a mais nova).

## 4. UI quota IndexedDB (~60 linhas)

`navigator.storage.estimate()` retorna `{ usage, quota }`. V62 não expunha;
fiscal não sabia quando estava perto de encher o quota do dispositivo (Safari
iOS = 1 GB; Chrome Android = 60% do disco livre).

**`getStorageQuotaInfo()`** novo em `offlineQueue.ts`:
- Retorna `{ usage, quota, usage_pct, supported }`
- Fallback gracioso se `navigator.storage` indisponível

**`OfflineQueueInspector`** ganhou Card no topo:
- Texto: "Espaço usado no dispositivo · X MB de Y MB · Z%"
- Barra de progresso colorida (verde <70% · amarelo 70-90% · vermelho ≥90%)
- Alerta laranja se ≥80%: "Aproximando do limite. Sincronize a fila para liberar espaço."

**`formatBytes()`** helper local — formata 0–GB.

## 5. Swipe gestures no campo (~50 linhas)

V61 deixou só botões Anterior/Próximo. Em mobile, swipe horizontal é mais
natural.

**`MeasurementFieldEntry`** ganhou:
- `touchStartXRef` / `touchStartYRef` (useRef)
- `onTouchStart` / `onTouchEnd` aplicados ao `<div>` root
- Threshold: 60px de movimento horizontal mínimo
- Filtro: gesto vertical (`|dy| > |dx| × 0.7`) é ignorado para preservar scroll
- Direita = `navPrev`, esquerda = `navNext`

Sem libs (sem react-swipeable ~6KB). Touch handler nativo dá conta.

## 6. Filtro actor/período/source no histórico (~80 linhas)

V64 mostrava lista plana sem filtragem — em items com muito histórico, ruim
para "quem editou nos últimos 7 dias".

**`ContractItemHistoryModal`** ganhou 3 selects:
- **Autor**: derivado dinamicamente de `history` (Map dedup por actor_id)
- **Período**: Todos · 7d · 30d · 90d
- **Origem**: derivado dinamicamente (só aparece se >1 source no histórico)

Filtro é client-side (`useMemo`) — histórico é finito (LIMIT 200 RPC).

Footer mostra "N de M" com contador.

Botão "Limpar" aparece só com filtro ativo (XIcon vermelho hover).

## Bundle V66 → V67

| Chunk | V66 | V67 | Δ |
|---|---:|---:|---:|
| Main | 104.39 | **105.65** | +1.26 |
| ContractPriceDivergence (lazy) | — | 7.1 KB raw | — |

Margem 150 − 105.65 = **44.35 KB**. Δ médio — a página de divergência é
lazy (não pesa no main), mas filtros + quota + dedup acumulam no main bundle.

## Sequência V54-V67 cumulativa

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
| V65 | GED | Notificação automática workflow | 101.73 | +0.45 |
| V66 | SOV | Composições de preço | 104.39 | +2.66 |
| V67 | SOV/Med/Med/SOV | **Divergência + 5 polish** | 105.65 | +1.26 |

**+12.96 KB total** em 14 versões = 26% do crescimento até 150 KB.
Cobertura: Medição **6×** (V61+V62+V63 já contadas, V67 toca 2: swipe + dedup
+ quota) · SOV **6×** (V67 toca divergência + source + filtro hist) · GED 5×.

**SOV agora lidera ligeiramente** depois de V66+V67.

## Limitações fechadas com V67

| Origem | Limitação | Fechada em V67 |
|---|---|---|
| V62 | Sem dedup na fila | ✓ |
| V62 | Sem UI quota IndexedDB | ✓ |
| V64 | Source field aberto (todos ficavam sov_edit) | ✓ |
| V64 | Sem filtros no histórico | ✓ |
| V61 | Sem swipe gestures | ✓ |

5 limitações documentadas fechadas. Resta:
- V62: ainda sem Background Sync API (cobertura limitada por browsers)
- V66: ainda read-only (edição inline de composição → V68+)

## Próximas oportunidades (V68+)

**Única feature grande pendente**:
1. **Marca d'água "CÓPIA NÃO CONTROLADA" GED** (~300 linhas) — Edge Function
   `generate-watermarked-pdf` + ICP-Brasil opcional. Fecha trilogia "grandes".

**Polish residual**:
2. **Edição inline composição** (~200 linhas) — completa V66
3. **Sidebar entry para fila** (~10 linhas)
4. **Notification preferences UI** para workflow V65 (~80 linhas)

**Features médias novas**:
5. **Exportar histórico V64 em CSV/PDF** (~120 linhas) — auditor externo precisa
6. **Comparação composição vs proposta concorrente** (~250 linhas) — extensão V66

V68 natural: **Marca d'água GED (1)** completa a trilogia "grandes" e marca
fim da fase de features substanciais. Depois disso V69+ é polish leve.

Continuar com qual?
