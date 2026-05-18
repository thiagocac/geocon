# V44 — Export de Linha do Tempo em PDF

V44 entrega o item #3 da lista V41: exportar a linha do tempo de um contrato em PDF auditável. Documento legal completo para fiscalização interna, controle externo (TCU/TCEs), instrução processual administrativa e processos judiciais.

## Arquitetura

### Edge Function: `export-contract-timeline-pdf`

Geração server-side em Deno usando **`pdf-lib`** (já no projeto via outras EFs). Reusa o helper compartilhado `_shared/pdf-helpers.ts` com `woffToSfnt`, `sha256Hex`, etc.

Fluxo da EF:

1. **Input**: `{ contract_id, filters: { kinds, severity, from, to } }`
2. Busca `contracts` + `tenants` (nome do tenant pra cabeçalho)
3. **Chama RPC `list_contract_timeline`** (V39) com filtros · limit 2000
4. Chama RPC `get_contract_timeline_summary` (V39) para KPIs
5. **Renderiza PDF em 2 passes**:
   - 1º pass: gera PDF para calcular hash final (sem footer com hash)
   - 2º pass: re-renderiza com hash + paginação correta no footer
6. **Storage**: salva em `reports/tenants/{tenant_id}/contracts/{contract_id}/timeline/{date}-{code}.pdf`
7. Registra em `public_validation_records` (validação pública por código + hash)
8. Tenta registrar em `generated_reports` (catalogação interna · best-effort)
9. **Output**: `{ storage_path, hash_sha256, public_validation_code, validation_url, size_bytes, total_events }`

### Por que 2 passes?

PDF-lib não permite editar PDFs depois de salvos. O footer mostra o hash SHA-256 do PDF inteiro — para esse hash ser correto, o footer NÃO pode estar no PDF cujo hash está sendo calculado. Solução: gera primeiro pra obter o hash, depois regenera com o hash no footer.

Custo: 2× CPU + 2× memória. Para timelines de até 2000 eventos (limite), tempo total ainda fica <3s em produção. Tradeoff aceitável.

### Anatomia do PDF

**Página 1 — Capa**:
- Banner azul-marinho no topo: "LINHA DO TEMPO · Lei 14.133/2021 · TENANT"
- Número do contrato em destaque (size 22)
- Título do contrato com wrap (até 3 linhas)
- Metadados: data de emissão, total de eventos, período coberto, filtros aplicados
- Resumo por instituto (2 colunas com contagens)
- Caixa "IMPORTÂNCIA LEGAL" com nota sobre uso auditável

**Páginas 2+ — Eventos cronológicos**:
- Header em cada página: "Contrato #N · Linha do Tempo · Página X"
- Agrupamento por mês: box cinza com nome do mês + contagem
- Cada evento:
  - Bolinha colorida (severity: info/warning/danger/success/neutral)
  - Linha 1: KIND (uppercase) · subtype (colorido) · timestamp à direita
  - Linha 2: título (bold)
  - Linha 3+: subtítulo (com wrap)
  - Linha final: "por {actor_name}"
  - Linha divisora sutil entre eventos

**Última página — Validação**:
- Texto explicando o sistema de validação
- Hash SHA-256 em destaque (em 2 linhas, monospace)
- QR Code (100×100px) com URL `{SITE_URL}/v/{code}` no canto direito

**Footer em todas as páginas** (exceto capa):
- Código de validação
- Hash SHA-256
- URL de validação pública (magenta)

### Validação pública

Cada PDF gerado registra em `public_validation_records`:
- `code` (8 bytes hex aleatórios = 16 chars)
- `entity_type` = `'contract_timeline'`
- `entity_id` = `contract_id`
- `hash_sha256` (do PDF final)
- `storage_path`

Qualquer pessoa com a URL `/v/{code}` pode validar:
- Que o documento foi gerado pelo sistema
- Em que data
- Por qual contrato
- Que não foi adulterado (hash check)

### Frontend

**Botão "Exportar PDF"** adicionado ao `<PageHeader actions>` em `ContractTimeline.tsx`. Click dispara mutation que:
1. Invoca `exportContractTimelinePdf(contract_id, filters)` — passa os filtros atuais da página
2. EF retorna `TimelinePdfExportResult` com `storage_path`
3. Mutation chama `getTimelinePdfDownloadUrl(storage_path, 300)` — URL assinada (5min)
4. Trigger automático de download via `<a>` element programático
5. Modal de feedback aparece com confirmação, tamanho, link de validação, hash

Em caso de erro: modal de feedback com mensagem humanizada.

### Filtros respeitados

O PDF reflete os mesmos filtros aplicados na página:
- `kinds[]` — tipo de instituto (Aditivo, PAR, Sanção, ...)
- `severity[]` — info/warning/danger/success/neutral
- `from` / `to` — recorte temporal

Limit interno da EF: 2000 eventos (vs 1000 da página). Acima disso, footer no PDF mostra essa info.

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ módulos OK · 25.62s
```

**Bundle**:
- Main: 84.13 → **84.43 KB gzip** (+0.30 KB)
- ContractTimeline lazy: 3.13 → **3.62 KB gzip** (+0.49 KB — modal + mutation + 4 wrappers)
- Margem até 150 KB: **65.6 KB**

## Diff V43 → V44

- **+1 Edge Function** `export-contract-timeline-pdf` (~500L Deno)
- **api.ts**: 2 wrappers (`exportContractTimelinePdf` + `getTimelinePdfDownloadUrl`) + 2 interfaces
- **ContractTimeline.tsx**: +50L (mutation, modal de feedback, botão no header) · +5 imports
- **0 migrations** — V44 é puramente Edge Function + frontend
- **0 cron, 0 triggers**

## Reutilização de infraestrutura

V44 reusa:
- `_shared/pdf-helpers.ts` (V12+) — woffToSfnt, sha256Hex, formatters
- `_shared/cors.ts` (V01) — handleCors
- `_shared/client.ts` (V01) — getServiceClient
- `_shared/response.ts` (V01) — ok/fail/notFound/serverError
- RPCs `list_contract_timeline` + `get_contract_timeline_summary` da V39
- Bucket Storage `reports` (já existente)
- Tabela `public_validation_records` (já existente)
- Tabela `generated_reports` (já existente, best-effort)

**Apenas o handler novo (`index.ts` da nova EF)** é trabalho original. Tudo o mais é composição.

## Para deployar

```bash
./scripts/deploy-supabase.sh functions export-contract-timeline-pdf
```

Variáveis de ambiente necessárias (já configuradas para outras EFs):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SITE_URL` (default `https://contratos.consultegeo.org`)

## Como testar (acceptance)

### Smoke
1. `/contratos/:id/timeline`
2. Click "Exportar PDF"
3. Aguardar ~2-3 segundos
4. Download automático começa
5. Modal mostra confirmação com tamanho do arquivo
6. PDF abre em viewer com capa + eventos cronológicos + QR code

### Filtros respeitados
1. Aplicar filtro: tipos = [Sanção, PAR], severity = [danger]
2. Click "Exportar PDF"
3. PDF gerado contém apenas eventos desses filtros
4. Capa mostra "Tipos filtrados: Sanção · PAR" e "Severidades: danger"

### Validação pública
1. Após download, abrir link "Validação pública" no modal
2. Página externa (`/v/{code}`) confirma:
   - Origem do documento (tenant + contrato)
   - Data de emissão
   - Hash SHA-256

### Edge cases
1. Contrato sem eventos: PDF gerado com capa + "Nenhum evento encontrado" + página de validação
2. Muito eventos (>200): PDF com várias páginas, paginação correta no footer
3. Filtros excluem todos os eventos: PDF curto com aviso

### Mobile
1. Botão "Exportar PDF" aparece no header
2. Em mobile, botão fica abaixo do título (flex-col)
3. Modal de feedback respeita layout mobile do `<Modal>` (V01 já é mobile-friendly)

## Retrospectiva V30 → V44 (15 versões)

| Versão | Tema | Mig/EF | Bundle main |
|---|---|---|---:|
| V30-V38 | Lei 14.133 9 institutos | 036-044 | 75-80 |
| V39 | Timeline contrato | 045 | 80.43 |
| V40 | Mobile audit | — | 80.47 |
| V41 | Dashboard contrato | 046 | 80.94 |
| V42 | Timeline tenant | 048 | 81.43 |
| V43 | Dashboard tenant | 049 | 84.13 |
| **V44** | **Timeline PDF export** | **EF** | **84.43** |

Bundle main +9.30 KB gzip em 15 versões. 0 typecheck errors em todas.

## Próximas oportunidades (V45+)

Continuando a ordem V41:

1. ~~Timeline global do tenant~~ — V42 ✅
2. ~~Dashboard global do tenant~~ — V43 ✅
3. ~~Export de timeline em PDF~~ — V44 ✅
4. **Cadastro de fornecedores sancionados** ← próximo — view global cruzando contratos. Útil para verificar antes de novas licitações
5. API keys + REST público
6. OKLCH migration
7. EF download FGV/IBGE
8. Email digest de alertas (usaria RPC V41/V43 em cron)
9. Completar Pendencias V35-V38 (047 órfã + UI)
10. Completar Carteira V12 com KPIs Lei 14.133 (release-v43-prior preservado)

**V45 sugerido: Cadastro de fornecedores sancionados** — view global agregando sanções de todos os contratos por fornecedor (CNPJ/razão social), com filtros pra "fornecedores com impedimento ativo agora". Útil pré-licitação. Médio porte: 1 view + 1 RPC + 1 página.
