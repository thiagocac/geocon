# V56 — Validade temporal em GED

V56 fecha a tríade Medição (V54) · SOV (V55) · **GED (V56)**. Adiciona controle
de validade temporal a documentos do acervo — feature de alto valor compliance
para construção civil brasileira (ARTs, licenças ambientais, ASOs, certidões).

## Contexto

Documentos do GED têm validade na vida real, mas o schema V01-V55 não modelava
isso:

- **ART** (Anotação de Responsabilidade Técnica do CREA) vence em ~1 ano
- **Licenças ambientais** vencem em prazos variados (1-5 anos)
- **ASO** (Atestado de Saúde Ocupacional) vence em 1 ano para o trabalhador
- **Certidões fiscais/trabalhistas/INSS** vencem em 30-180 dias

Perder o vencimento de uma ART pode parar a obra. Uma licença vencida sem
renovação é problema legal. Sem controle, era responsabilidade do gestor
lembrar manualmente.

## O que V56 entrega

### 1. Migration 059 (260 linhas)

**Schema additions**:
```sql
ALTER TABLE ged_documents
  ADD COLUMN data_validade date,
  ADD COLUMN dias_alerta_antes int DEFAULT 30 CHECK (0..365);

CREATE INDEX idx_ged_documents_validade
  ON ged_documents (data_validade)
  WHERE data_validade IS NOT NULL AND deleted_at IS NULL;  -- índice parcial
```

**Estende `realtime_alerts.alert_kind`** para incluir `documento_vencendo`
(antes V52: 4 kinds; agora 5). DROP + ADD CONSTRAINT idempotente.

**Estende view `v_ged_master_list`** com 3 campos: `data_validade`,
`dias_alerta_antes`, e `dias_para_vencimento` (calculado como
`data_validade - CURRENT_DATE`).

**RPC `update_ged_document_validity`** — tenant check via members, clamp de
dias_alerta (0-365), aceita `data_validade = NULL` para limpar. SECURITY
DEFINER + GRANT EXECUTE TO authenticated.

**Função `scan_ged_documents_expiring(p_days_ahead int DEFAULT 30, p_dry_run)`**:
- Análoga ao `scan_guarantees_expiring` da V53
- Janela: `data_validade - CURRENT_DATE BETWEEN -7 AND least(dias_alerta_antes, p_days_ahead)`
  (inclui vencidos até -7d como rede de segurança se cron falhou)
- Skip docs `status IN (obsoleto, cancelado)` — não fazem sentido alertar
- Idempotência 7d via `metadata->>'document_id'`
- Severity dinâmico: `dias ≤ 7` → danger; senão warning
- Title formatado: "Documento vence em 18 dias · ART" ou "vencido há 12 dias · ASO"

**`pg_cron` schedule** `'30 6 * * *'` (06:30 UTC ≈ 03:30 BRT) — 30min depois
do scan de garantias (V53 às 06:00 UTC) para não competir vacuum/recursos.
Idempotente com `IF EXISTS unschedule` antes de `cron.schedule`.

### 2. API + types (`src/lib/api.ts`)

```ts
// Schema additions
GedDocument.data_validade: string | null;
GedDocument.dias_alerta_antes: number;

GedMasterListItem.data_validade: string | null;
GedMasterListItem.dias_alerta_antes: number | null;
GedMasterListItem.dias_para_vencimento: number | null;

// Helpers
export type GedValidityStatus = 'sem_validade' | 'ok' | 'vencendo' | 'vencendo_critico' | 'vencido';
export function gedValidityStatus(dias, dias_alerta): GedValidityStatus;
export const GED_VALIDITY_LABELS: Record<GedValidityStatus, string>;

// Mutation
export async function updateGedDocumentValidity({document_id, data_validade, dias_alerta_antes?});

// Realtime alerts
type RealtimeAlertKind = ... | 'documento_vencendo';
REALTIME_ALERT_KIND_LABELS.documento_vencendo = 'Documento vencendo';
```

Status thresholds: `vencido` (<0d), `vencendo_critico` (0-7d), `vencendo`
(7d-dias_alerta_antes), `ok` (>dias_alerta_antes).

### 3. Componente `<GedValidityBadge />`

Novo arquivo `src/components/ged/GedValidityBadge.tsx`:

- **`status === 'sem_validade'` → null** (não polui linhas sem validade — pattern
  intencional para manter lista limpa)
- 5 status com Icon + classes Tailwind (CheckCircle2, Clock, AlertTriangle, AlertOctagon)
- Variante `compact`: "−12d" / "OK" / "4d" — usado na lista (denso, scaneável)
- Variante full: "Vencido há 12 dias" / "Válido até DD/MM/YYYY" / "Vence em 4 dias"

### 4. Integração no `ged/index.tsx`

**Lista GED principal** (`Ged()`):
- **Filtro novo** "Toda validade" com 5 opções (sem_validade, ok, vencendo,
  vencendo_critico, vencido)
- Badge compact ao lado do título do documento
- Filtro funciona client-side via `gedValidityStatus()` (não nova query)

**Detalhe do documento** (`GedDocument()`):
- Botão **"Validade"** no header (ícone CalendarClock)
- Badge full no card de cabeçalho quando há validade
- **Modal "Validade temporal do documento"**:
  - `<input type="date">` — HTML nativo, sem date-picker lib
  - `<input type="number" min={0} max={365}>` — dias_alerta_antes
  - Botão "Limpar validade" (ghost) quando já há validade
  - Botão "Salvar" disabled quando data vazia

### 5. Mock SKIP_AUTH expandido

`MOCK_GED_DOCS` ganhou 3 documentos demonstrando os 3 estados ativos
(datas relativas a hoje, 16/05/2026):

| Doc | Categoria | data_validade | dias | Status |
|---|---|---|---:|---|
| `doc-5` ART Eduardo Vargas | ART | 2026-06-03 | +18 | `vencendo` |
| `doc-6` Licença LO 045/2024 | LIC | 2026-05-20 | +4 | `vencendo_critico` |
| `doc-7` ASO Marcelo Souza | ASO | 2026-05-04 | -12 | `vencido` |

`MOCK_REALTIME_ALERTS_INITIAL` ganhou **`rta-mock-3`** documento_vencendo
linkando para `doc-6` — fechamento da cadeia badge → cron → alert → sino V53.

Demo: ao abrir GED com SKIP_AUTH, lista mostra 3 badges coloridos diferentes;
filtros "Vencendo crítico (≤7d)" / "Vencidos" funcionam; bell counter mostra
+1 alerta `documento_vencendo`; detalhe de doc-6 permite editar/limpar validade.

## Decisões

1. **Vencidos incluídos no scan até -7d** — rede de segurança se o cron pular
   um dia. Após -7d, documento provavelmente já foi tratado manualmente.

2. **Cron 06:30 UTC, não 06:00** — distância de 30min do scan de garantias V53
   para não competir vacuum em instâncias compartilhadas.

3. **Filter client-side, não server-side** — view já retorna `dias_para_vencimento`,
   filtrar via JS evita recompilação de query. Trade-off aceitável até ~500
   docs/contrato.

4. **`return null` para `sem_validade`** — não desenhar "—" em cada linha;
   mantém lista limpa, mostra só o que importa.

5. **HTML `<input type="date">`** — sem date-picker lib (react-datepicker
   pesa ~30 KB). UX diferente entre navegadores mas formato ISO consistente.

6. **`dias_alerta_antes` no documento, não global** — categorias precisam de
   antecedência diferente (ART 30d natural; licença 60d para renovar). Default
   30 cobre maioria.

7. **`updateGedDocumentValidity` aceita `null` para limpar** — pattern "set or
   clear" via mesma RPC, sem rota separada DELETE.

8. **Edge function alternativa não criada** — cron SQL é suficiente. Quem
   precisar de scan manual via HTTP pode chamar `supabase.rpc('scan_ged_documents_expiring')`
   diretamente.

## Bundle V55 → V56

| Chunk | V55 | V56 | Δ |
|---|---:|---:|---:|
| Main | 94.63 | **95.79** | +1.16 |

Margem 150 − 95.79 = **54.21 KB**. Custo cobre `<GedValidityBadge />` (~95 linhas),
API helpers (~80 linhas), modal + estados (~100 linhas), atualização dos mocks.

## Sequência V54-V56

| Versão | Área | Tema | Bundle | Δ |
|---|---|---|---:|---:|
| V54 | Medição | Validações automáticas (6 regras) | 92.69 | +2.25 |
| V55 | SOV | Curva ABC + Pareto | 94.63 | +1.94 |
| V56 | GED | Validade temporal + cron diário | 95.79 | +1.16 |

Tríade completa em 3 versões consecutivas dentro do orçamento (+5.35 KB total
= 11% do crescimento até 150 KB).

## Próximas oportunidades (V57+)

Sempre dentro de Medição/SOV/GED:

**Medição**:
1. **Bloqueio backend submit** (~30 linhas) — guard SQL fecha gap V54.
2. **Apontamento campo mobile-first** (~600 linhas) — feature grande.

**SOV**:
3. **Filtros + busca na tabela SOV** (~150 linhas) — complementa V55.
4. **Auditoria divergência preços SINAPI/SICRO** (~200 linhas).

**GED**:
5. **Diff entre revisões R01 vs R02** (~250 linhas) — sobre `extracted_text`.
6. **Workflow aprovação de revisão GED** (~500 linhas).
7. **Marca d'água "CÓPIA NÃO CONTROLADA"** (~300 linhas) — Edge Function.
8. **Painel KPI do acervo GED** — view + dashboard.

Por valor/esforço imediato: **(1) Bloqueio backend submit** fecha gap em 30
linhas; **(3) Filtros SOV** complementa V55 em 150; **(5) Diff revisões** abre
nova capacidade em 250. Continuar com qual?
