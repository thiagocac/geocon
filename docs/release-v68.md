# V68 — Marca d'água "CÓPIA NÃO CONTROLADA"

V68 fecha a **trilogia das features grandes** pendentes:
- V61–V63 (Apontamento campo mobile + offline + UI) ✓
- V66 (Composições de preço explícitas) ✓
- V68 (Marca d'água + rastreabilidade) ← **agora**

Capítulo GED compliance encerrado. V69+ entra modo polish/quick-wins.

## Contexto

Documentos GED (memorial descritivo, plantas, ARTs, especificações técnicas)
frequentemente saem do sistema impressos ou em PDF para clientes, fiscais
externos, projetistas terceirizados. Sem controle, esses PDFs circulam
indistinguíveis dos originais oficiais — risco real:

- "Esse PDF da revisão 2 é o vigente?" — sem marca, qualquer cópia parece oficial
- "Quem vazou o memorial confidencial?" — sem rastreio, impossível identificar
- Norma RDC 50/ANVISA (saúde), Lei 14.133 e práticas TCU exigem que cópias
  controladas sejam marcadas

V68 entrega o cenário canônico de gestão documental industrial: **toda cópia
saindo do sistema é marcada com fingerprint único** que permite rastrear
vazamentos até o downloader original.

## O que V68 entrega

### 1. Migration 067 — 2 tabelas + 3 RPCs

**`ged_watermark_settings` (1:1 com tenant)**:
- `texto` (default 'CÓPIA NÃO CONTROLADA') + `texto_secundario` opcional
- `opacidade` (0.05-0.50), `angulo_graus` (-90 a 90), `tamanho_fonte` (12-144)
- `cor_hex` (validado por regex `^#[0-9A-Fa-f]{6}$`, default vermelho)
- Toggles: `incluir_timestamp`, `incluir_fingerprint`, `icp_brasil_enabled`
- `icp_brasil_signer_label` para nome do PSC quando aplicável
- RLS habilitado, escrita por tenant member

**`ged_watermark_log` (audit trail de downloads)**:
- `fingerprint` (16 chars hex uppercase, impresso no rodapé do PDF)
- `downloader_*` snapshot (nome+email preservados mesmo se membro removido)
- `recipient_label` ("Para: Eng. João Silva (cliente XYZ)")
- `ip_addr` (inet), `user_agent`, `icp_brasil_signed`
- 4 índices: por document/period, por downloader, por fingerprint (lookup
  rápido em vazamento), por tenant+period
- INSERT só via service_role (Edge Function)
- SELECT via auth member (rastreabilidade do tenant)

**3 RPCs**:
- `get_ged_watermark_settings()` retorna config ou defaults
- `upsert_ged_watermark_settings(jsonb)` faz UPSERT em settings
- `list_ged_watermark_log(document_id)` retorna histórico ordenado DESC, LIMIT 500

### 2. Edge Function `generate-watermarked-pdf`

`supabase/functions/generate-watermarked-pdf/index.ts` (~140 linhas):

**Stack**: pdf-lib via esm.sh (Deno), reusa Inter font padrão Helvetica
(embed via `StandardFonts`).

**Fluxo**:
1. Valida `version_id` no body
2. Carrega versão via cliente RLS do usuário (garante autorização)
3. Valida mime_type='application/pdf' (415 se outro)
4. Carrega settings via RPC (com override_settings opcional)
5. Identifica downloader via `auth.getUser()` + lookup em members
6. Baixa PDF original do Storage (service role)
7. **Aplica overlay com pdf-lib**:
   - Texto principal em diagonal no centro de cada página
   - Texto secundário menor abaixo (se configurado)
   - Cor + opacidade + ângulo conforme settings
   - Footer cinza no canto inferior: `FP: ABCD1234… · timestamp pt-BR · recipient · [ICP-Brasil ativado]`
8. Grava log com fingerprint, IP, user agent
9. Retorna PDF stream com header `X-Watermark-Fingerprint`

**Fingerprint**: `crypto.randomUUID()` sem hífens, 16 chars uppercase. Curto
o suficiente para caber no rodapé legível, longo o suficiente para ser único
e não-trivial de adivinhar.

**ICP-Brasil**: V68 só registra a flag e adiciona marca textual no rodapé.
Assinatura digital real exige integração com PSC autorizado (AC Certisign,
Serasa, Soluti, etc.) — fora do escopo. V69+ pode adicionar via DocSign API
ou similar.

### 3. API + types (`src/lib/api.ts`)

```ts
export interface WatermarkSettings {
  texto, texto_secundario, opacidade, angulo_graus, tamanho_fonte, cor_hex,
  incluir_timestamp, incluir_fingerprint,
  icp_brasil_enabled, icp_brasil_signer_label
}

export interface WatermarkLogEntry {
  id, version_id, version_revision,
  downloader_nome, downloader_email,
  recipient_label, fingerprint,
  icp_brasil_signed, created_at
}

export async function getGedWatermarkSettings(): Promise<WatermarkSettings>;
export async function upsertGedWatermarkSettings(s): Promise<WatermarkSettings>;
export async function listGedWatermarkLog(documentId): Promise<WatermarkLogEntry[]>;
export async function generateWatermarkedPdf({version_id, recipient_label?, override_settings?}):
  Promise<{ blob: Blob; fingerprint: string }>;
```

**Mock SKIP_AUTH**:
- Settings em memória, mutável via `upsert`
- Log mock para `doc-1` com 2 entries realistas (downloads de revisão 3 para cliente, revisão 2 para coordenação)
- `generateWatermarkedPdf` cria um PDF dummy minimal + push em MOCK_WATERMARK_LOG (permite ver o log crescer na demo)

### 4. Componente `<WatermarkDownloadModal />`

`src/components/ged/WatermarkDownloadModal.tsx` (~150 linhas):

**2 modos**:

**(a) Pré-download**:
- 3 campos:
  - `Destinatário (opcional)` — texto livre para rastreabilidade ("Para: …")
  - `Texto secundário (opcional)` — ex: número do contrato, nome empresa
  - Checkbox `Marcar como assinado ICP-Brasil` (só se tenant habilitou)
- Botão "Gerar PDF marcado" → invoca `generateWatermarkedPdf`

**(b) Pós-download**:
- Banner verde "PDF gerado e baixado"
- Box destacado com `FP: ABCD1234…` em fonte mono
- Explicação "Este código aparece no rodapé do PDF. Use-o para identificar a origem em caso de vazamento."
- Botões "Baixar novamente" (mesma blob URL) e "Fechar"

Após sucesso: download automático via `<a download>` programático, invalida
queries de `ged-watermark-log` (Log page atualiza ao reabrir).

### 5. Página `/ged/documentos/:docId/marca-dagua-log` (lazy 3.8 KB raw)

`src/pages/ged/WatermarkLog.tsx`:

**Lista cronológica reversa de cada download**:
- Avatar circular com `<Stamp />` icon
- Linha 1: `FP: ABCD1234…` (mono bold) · `Revisão N` (caps) · pill ICP-Brasil se signed
- Linha 2: User icon + nome · Mail icon + email · timestamp relativo
- Linha 3: `recipient_label` em blockquote italica (se presente)

**Topo explicativo** com `<Stamp />` icon:
> "Cada PDF baixado tem um fingerprint único impresso no rodapé. Se um PDF
> vazar, busque o fingerprint nesta lista para identificar o responsável
> original pelo download."

### 6. Integração no `GedDocument`

3 botões novos no header de actions:
- **"Marca d'água"** (Stamp icon, outline) — abre `WatermarkDownloadModal`. Só
  aparece se `versions.length > 0`
- **History icon ghost** (sem label, compact) — link para `/marca-dagua-log`

Settings carregadas via React Query `staleTime: 5min` — cacheia entre múltiplos
downloads.

## Decisões

1. **Overlay com pdf-lib server-side, não client-side** — fingerprint precisa
   ser registrado em log inacessível ao usuário. Client-side teria fingerprint
   no JavaScript, falsificável. Edge Function garante integridade.

2. **Inter font NÃO embarcada na EF** — uso `StandardFonts.HelveticaBold` /
   `Helvetica` que vêm com pdf-lib. Watermark não precisa de tipografia
   premium; texto é grande e em diagonal.

3. **Rotação via `degrees()` do pdf-lib** — sem dependência de cálculo manual
   de matriz. 45° default é vértice cobrindo área útil sem desfocar conteúdo.

4. **Opacidade 0.20 default** — visível mas não bloqueia leitura. Faixa
   permitida 0.05–0.50 evita extremos (invisível ou tampa tudo).

5. **Fingerprint 16 chars hex** — `crypto.randomUUID()` sem hífens slice(0,16)
   uppercase. ~5×10¹⁹ permutações, suficiente para tenant com 1M downloads
   sem colisão prática.

6. **Footer cinza pequeno (size 7)** — não compete com conteúdo do documento.
   Posicionado no canto inferior-esquerdo. Inclui apenas info essencial.

7. **Só PDFs** (415 outros) — V68 não tenta marcar Word/Excel. Workflow real
   converte para PDF antes via outra ferramenta.

8. **ICP-Brasil só flag em V68** — assinatura digital real é projeto separado
   (~500 linhas + integração PSC). V68 prepara infra (campo flag,
   `icp_brasil_signer_label`); V69+ pode plugar.

9. **Settings 1:1 por tenant, não por documento** — todos documentos usam
   mesma marca padrão. Override por download via `override_settings` cobre
   casos específicos sem complicar schema.

10. **`recipient_label` campo aberto** — não é FK para cliente/usuário. Texto
    livre permite "Para: João Silva (cliente novo, sem cadastro)" sem exigir
    pré-cadastro de pessoa externa.

11. **Log INSERT só via service_role** — RLS policy força que apenas Edge
    Function (com service key) grave. Usuários autenticados podem SELECT mas
    não INSERT/UPDATE/DELETE. Garante que log é imutável do ponto de vista
    do downloader.

12. **`<WatermarkDownloadModal>` + log separados** — modal foca em ação;
    página de log foca em consulta. Separação reduz complexidade da modal e
    permite operador acessar log sem precisar abrir modal.

## Bundle V67 → V68

| Chunk | V67 | V68 | Δ |
|---|---:|---:|---:|
| Main | 105.65 | **106.51** | +0.86 |
| WatermarkLog (lazy) | — | 3.8 KB raw | — |

Δ no main moderado — WatermarkDownloadModal (~150 linhas) entra no main,
WatermarkLog (~120 linhas) é lazy. Edge Function não bundlea.

Margem 150 − 106.51 = **43.49 KB**.

## Sequência V54-V68 cumulativa

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
| V67 | SOV/Med | Divergência + 5 polish | 105.65 | +1.26 |
| V68 | GED | **Marca d'água + rastreio** | 106.51 | +0.86 |

**+13.82 KB total** em 15 versões = 28% do crescimento até 150 KB.
Cobertura: Medição 6× · SOV 6× · GED **6×**. **Trio perfeitamente
equilibrado** após V68.

## Trilogia das features grandes — fechada

| Trilha | Versões | Status |
|---|---|---|
| Apontamento campo mobile + persistência | V61, V62, V63 | ✓ Fechada |
| Composições de preço bottom-up | V66 (+V67 divergência) | ✓ Fechada |
| Marca d'água + rastreabilidade | V68 | ✓ Fechada |

GED agora tem **6 capacidades complementares**:
1. Validade temporal (V56)
2. Diff entre revisões (V58)
3. Painel KPI (V59)
4. Workflow aprovação (V60)
5. Notificação automática (V65)
6. **Marca d'água + audit trail (V68)**

## Próximas oportunidades (V69+)

**Fase polish leve** (todas <250 linhas):

1. **Edição inline de composição V66** (~200 linhas) — torna V66 produtivo
   além de read-only. Insert/delete linhas, autocomplete códigos SINAPI.
2. **Exportar histórico V64 em CSV/PDF** (~120 linhas) — auditor externo precisa
   levar planilha. Reusa xlsx-vendor (já no bundle).
3. **Settings UI para watermark** (~100 linhas) — gestor configura texto/cor/opacidade
   visualmente. V68 só tem RPC; UI seria página de configurações.
4. **Comparação composição vs proposta concorrente** (~250 linhas) — V66
   estendido para benchmarking de licitação.
5. **Filtro avançado no log V68** (~80 linhas) — filtrar por período,
   downloader, recipient. Útil em vazamento real.
6. **Notification preferences UI para workflow V65** (~80 linhas) — usuário
   configura se quer notificação via email/Slack/in-app.
7. **PWA install banner explícito** (~40 linhas) — UI sugere instalar app
   mobile para fiscal usar V61+V62.

V69 natural: **edição inline composição (1)** torna V66 produtivo, ou
**settings UI watermark (3)** completa V68 com config visual. Continuar com
qual?
