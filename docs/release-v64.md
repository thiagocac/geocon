# V64 — Histórico item-level (audit trail) SOV

V64 equilibra a área SOV (que estava com 2 toques vs Medição 4× e GED 4×) e
adiciona capacidade forense fundamental: rastrear **quem mudou o quê quando**
em cada item contratual.

## Contexto

V57 trouxe auditoria de preços vs SINAPI (cross-section em um momento).
V55 trouxe curva ABC. Mas faltava a dimensão **temporal** por item:

- "Por que o preço do item 02.015 foi de R$ 720 para R$ 845?"
- "Quem alterou a quantidade contratada de 150 para 174?"
- "Quando esse item ficou locked?"

Sem audit trail, essas perguntas exigiam DBA com acesso a logs. V64
disponibiliza tudo na UI normal.

## Infraestrutura pré-existente reusada

- **Tabela `audit_log`** (V01) já é genérica: `entity_type` + `entity_id` +
  `actor_id` + `before_value` jsonb + `after_value` jsonb + `source` + 3
  índices
- 3 índices já criados: `(tenant_id, entity_type, entity_id)`, `(actor_id)`,
  `(created_at DESC)`
- Tudo que faltava era trigger + RPC consultor + UI

V64 **não cria tabela nova** — reusa o que V01 deixou pronto há 9 meses.

## O que V64 entrega

### 1. Migration 063 — Trigger + RPC

**`audit_contract_item_change()` trigger function** (AFTER UPDATE):
- Detecta mudanças em 10 campos: `preco_unitario`, `quantidade_contratada`,
  `quantidade_aditada`, `descricao`, `codigo`, `unidade`, `locked`, `active`,
  `fonte_referencia`, `bdi_percentual`
- Constrói `before_value` e `after_value` jsonb só com os campos que mudaram
  (não snapshot inteiro — economia de espaço)
- Skip explícito em soft-delete (`deleted_at IS DISTINCT FROM`) — esse evento
  já tem trigger próprio se necessário
- Resolve actor via novo helper `_current_member_id(tenant_id)` (SECURITY DEFINER
  + STABLE) que mapeia `auth.uid() → members.id`
- Insere em `audit_log` só se `v_has_change=true`

**`list_contract_item_history(p_item_id uuid) RETURNS TABLE(...)`** (RPC):
- Filtra `audit_log` por `entity_type='contract_item'` AND `entity_id=p_item_id`
- LEFT JOIN com `members` para `actor_nome`
- ORDER BY created_at DESC LIMIT 200
- SECURITY DEFINER + STABLE + GRANT EXECUTE TO authenticated

**Helper `_current_member_id(tenant_id)`** — novo helper genérico que outros
triggers (V65+) podem usar. STABLE + SECURITY DEFINER.

### 2. API + types (`src/lib/api.ts`)

```ts
export interface ContractItemHistoryEntry {
  id, changed_at, actor_id, actor_nome,
  action, before_value, after_value, source
}

export const CONTRACT_ITEM_FIELD_LABELS: Record<string, string>;
// preco_unitario → 'Preço unitário', etc.

export async function listContractItemHistory(itemId): Promise<ContractItemHistoryEntry[]>;

export function formatContractItemHistoryValue(field, value): string;
// preço/BDI → pt-BR localizado · qty → max 6 dec · bool → sim/não · etc
```

**Mock SKIP_AUTH** com 5 entries demonstrando casos reais:
- `i1-2` Concreto: locked false→true (jan), qtd 150→174 (fev), preço 720.50→845.20 (mar)
- `i1-4` Revestimento: BDI 22→24.5 (mar), preço 95→128.40 + fonte proprio→SINAPI (abr)

### 3. Componente `<ContractItemHistoryModal />`

Novo arquivo `src/components/sov/ContractItemHistoryModal.tsx`:

- **Modal** com título "Histórico do item" + subtítulo explicativo dos campos
  rastreados
- Mostra código + descrição do item no topo
- Lista cronológica reversa com:
  - Avatar circular com **ícone do `source`**:
    - `sov_import` → ImportIcon
    - `sov_edit` → Pencil
    - `sov_bulk` → Package
    - `sov_lock` / `sov_unlock` → LockIcon / Unlock
    - default → Clock
  - Linha de metadado: source label · actor (User icon) · "Xh atrás" (com title tooltip de timestamp completo)
  - **Tabela inline de diffs**: para cada campo mudado, mostra `Campo: old → new`
    com:
    - `old` em `bg-error/10` + `line-through`
    - Seta `<ArrowRight />`
    - `new` em `bg-success/10`
- Empty state quando histórico vazio
- `staleTime: 30_000` no React Query (histórico muda pouco)
- `enabled: open && !!itemId` — query só dispara quando modal abre

### 4. Integração no `ContractSheet`

- Coluna nova "Ações" (icon-only) no fim da tabela
- Botão `<History />` icon por linha, abre modal com aquele item
- Mantém compacta: a coluna tem `w-10 text-center`, só um botão de 4px
- Modal abre via state local `historyFor: { id, codigo, descricao } | null`

### 5. Source field para tracking de origem

O trigger usa `source = 'sov_edit'` como default para mudanças via UI.
Outros caminhos podem setar valores diferentes via `SET LOCAL` no Postgres
session ou via parâmetro RPC. Pattern preparado para V65+:

- `sov_import` — Wizard de import populou
- `sov_bulk` — Operação em lote (V23)
- `sov_lock` / `sov_unlock` — Bulk lock/unlock
- `sov_edit` — Edição manual (default)

A UI já tem labels e ícones para os 5 valores — quando o V65 fizer os
endpoints específicos setarem `source` distintos, a UI já está pronta.

## Decisões

1. **Reusar `audit_log`, não tabela nova** — V01 deixou genérico justamente
   para casos como esse. Tabela nova `contract_item_history` seria
   duplicação. Trade-off: queries em `audit_log` podem ser mais pesadas em
   tenants com muito tráfego de outros entity_types; índices existentes
   atendem bem.

2. **before/after parciais, não snapshot completo** — só campos que mudaram.
   Economiza ~10× espaço em audit_log para mudanças típicas (1-2 campos
   por vez). Trade-off: não dá para "reconstruir o item completo em qualquer
   ponto no tempo" — só ver diffs.

3. **10 campos auditados, não todos** — `metadata jsonb` interno, `nivel`,
   `ordem`, `parent_id`, `lot_id` etc. ficam de fora. Reduz ruído visual no
   audit. V65+ pode adicionar se houver demanda.

4. **Skip em soft-delete** — `deleted_at` mudanças não geram entrada no
   audit_log. Soft-delete é evento separado que pode ter trigger próprio
   se necessário (não tem hoje, mas pode adicionar sem mexer no V64).

5. **LIMIT 200 no RPC** — items com histórico extremo (mais de 200
   alterações) ficam truncados. Para uso real, 200 cobre 99% dos casos.
   Pagination pode ser adicionada em V65 se necessário.

6. **Modal, não página dedicada** — `/contratos/:id/historico/:itemId`
   seria mais navegável mas exige saltar de contexto. Modal mantém usuário
   na planilha onde estava editando. Trade-off aceitável; modal max-h-60vh
   com scroll suporta histórico longo.

7. **Mock dataset realista** — 5 entries mostrando preço/qty/locked/BDI/fonte
   mudando. Demonstra todos os tipos de diff que a UI sabe formatar.

8. **`source` campo aberto, não enum** — flexibilidade para sistema crescer.
   UI mapeia 5 valores conhecidos + fallback "Alteração" genérico para
   outros.

9. **Helper `_current_member_id` reutilizável** — não fica privado ao
   trigger V64. V65+ pode usar para outros audits (medição, GED, etc.).

10. **Trigger é AFTER, não BEFORE** — só registra fato consumado.
    Performance: AFTER permite o INSERT em audit_log usar valores garantidos
    pós-COMMIT do UPDATE original.

## Bundle V63 → V64

| Chunk | V63 | V64 | Δ |
|---|---:|---:|---:|
| Main | 99.63 | **101.28** | +1.65 |
| Migration 063 | — | 5.9 KB | (não-bundled) |

Δ mais expressivo da série V61-V63 (que tinham +0.10/+0.12/+0.09). Justifica:
- `<ContractItemHistoryModal />` (~170 linhas) entra no main bundle, não
  lazy chunk. Decisão consciente: Modal é dependência tight-coupling do
  ContractSheet; lazy daria latência ao abrir.
- 5 entries de mock realistas (~50 linhas) + helpers de format

Margem 150 − 101.28 = **48.72 KB**.

## Sequência V54-V64 cumulativa

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
| V64 | SOV | **Histórico item-level** | 101.28 | +1.65 |

**+8.59 KB total** em 11 versões = 17% do crescimento até 150 KB.
Cobertura: Medição 4× · SOV **3×** · GED 4×. **Balanço restaurado.**

## Próximas oportunidades (V65+)

**SOV grande pendente**:
1. **Composições de preço explícitas** (~400 linhas) — schema novo
   `contract_item_compositions` (mão-de-obra + material + equipamento).
   Liga V57 + SINAPI compositions oficiais.

**Ativar V60 em produção**:
2. **Notificação automática workflow GED** (~150 linhas) — trigger
   AFTER INSERT em `ged_revision_approval_steps` cria notification para
   `assigned_to`. Reusa stack notification existente.

**Compliance GED**:
3. **Marca d'água "CÓPIA NÃO CONTROLADA"** (~300 linhas) — Edge Function
   `generate-watermarked-pdf`. Opcional ICP-Brasil.

**Completar V62**:
4. **Deduplicação na fila offline** (~80 linhas) — hash de payload evita
   2 calc_lines idênticas.
5. **UI quota IndexedDB** (~60 linhas) — `navigator.storage.estimate()`.

**SOV polish (extensões de V64)**:
6. **Marcar `source` em SovImport/Bulk** (~30 linhas) — usar `SET LOCAL
   audit.source='sov_import'` nos endpoints para que a UI mostre ícone certo.
7. **Filtro por actor / período no histórico** (~80 linhas) — buscar quem
   editou em janela de tempo.

V65 natural: **Composições de preço (1)** — features SOV grande pendente há
muitas versões; agora SOV está com 3 toques e pode receber feature complexa.
Ou **Notificação workflow (2)** ativa V60.

Continuar com qual?
