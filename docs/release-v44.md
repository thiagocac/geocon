# V44 — Export de Timeline em PDF · finalização

V44 entrega a exportação auditável da Linha do Tempo de um contrato como PDF, com hash SHA-256, código de validação pública, e QR code de verificação.

## Estado herdado de sessão anterior

A maior parte do trabalho V44 já existia no diretório (vide `release-v44-prior.md` preservado):

- ✅ EF `export-contract-timeline-pdf` (695L) — completa, com pdf-lib + qr lib, gera capa, resumo executivo, eventos agrupados por mês, footer com hash, QR final
- ✅ Wrapper `exportContractTimelinePdf` + `getTimelinePdfDownloadUrl` em `api.ts`
- ✅ Botão "Exportar PDF" na ContractTimeline page (V39)
- ✅ Mutation com auto-download e modal de feedback
- ❌ **Migration faltante**: `public_validation_records.entity_type` CHECK não permitia `'contract_timeline'` → EF iria falhar no `upsert` final
- ❌ **Storage bucket `reports`** sem garantia de criação/policies
- ❌ **PublicValidation page** sem label para o novo entity_type

Esta sessão entrega **as 3 peças que faltavam** para fechar o ciclo end-to-end.

## Migration 051 (~110L)

### 1. Estende CHECK constraint de entity_type

```sql
DROP CONSTRAINT public_validation_records_entity_type_check;

ADD CONSTRAINT public_validation_records_entity_type_check
  CHECK (entity_type IN (
    'measurement_document', 'additive_document', 'ged_document_version',
    'databook_export', 'grd',
    'contract_timeline'    -- V44
  ));
```

Idempotente (verifica existência antes de DROP). Sem migração de dados — o constraint apenas valida inserts futuros.

### 2. Bucket de storage `reports`

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('reports', 'reports', false, 52428800, ARRAY['application/pdf']);
```

- `public = false` → URLs assinadas obrigatórias
- 50 MB por arquivo
- Apenas `application/pdf`

### 3. RLS no bucket

Duas policies idempotentes em `storage.objects`:

- `reports_service_role_all` — service_role tem ALL (EF grava)
- `reports_authenticated_select` — usuários autenticados leem apenas seu próprio tenant. Path padrão: `tenants/{tenant_id}/contracts/{contract_id}/timeline/{date}-{code}.pdf` — segundo segmento precisa bater com `current_tenant_id()`

A EF usa `service_role` para upload; usuários só baixam via `createSignedUrl` que respeita SELECT policy.

## UI: 1 linha em ENTITY_TYPE_LABEL

`src/pages/Auxiliary.tsx` ganha:

```ts
contract_timeline: 'Linha do tempo do contrato',
```

Garante que `/v/{code}` renderiza label bonito em vez do raw `contract_timeline`.

## Conteúdo do PDF (já existente)

| Página | Conteúdo |
|---|---|
| 1 (Capa) | Logo + nome do tenant + número do contrato + objeto + data |
| 2 (Resumo) | KPIs Lei 14.133: 10 contagens por instituto + período coberto |
| 3+ (Eventos) | Eventos cronológicos agrupados por mês/ano DESC, com severity bar |
| Última | Validação: code + URL + QR + hash SHA-256 |
| Todas | Footer com paginação + código + hash truncado |

Filtros aceitos via payload `{ contract_id, filters?: { kinds, severity, from, to } }` — exporta exatamente o que o usuário está vendo na UI.

## Output da EF

```ts
{
  storage_path: 'tenants/{tenant_id}/contracts/{contract_id}/timeline/{YYYY-MM-DD}-{CODE}.pdf',
  hash_sha256: '...',
  public_validation_code: 'ABC123...',
  validation_url: 'https://contratos.consultegeo.org/v/{code}',
  size_bytes: 145632,
  total_events: 47
}
```

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ 1765 módulos · 13.29s
```

**Bundle**:
- Main: 84.13 → **84.44 KB gzip** (+0.31 KB) — apenas a nova linha em `ENTITY_TYPE_LABEL`
- Margem até 150 KB: **65.6 KB**

## Diff V43 → V44

- **+1 migration** (051 timeline_pdf_support · ~110L · estende CHECK + cria bucket + 2 policies)
- **+1 linha** em `ENTITY_TYPE_LABEL` (Auxiliary.tsx)
- **0 mudanças** na EF (já existia completa)
- **0 mudanças** em api.ts (já tinha wrappers)
- **0 mudanças** em ContractTimeline.tsx (já tinha botão + modal)

V44 é principalmente **deployment**: ativa fluxo que estava 95% pronto.

## Para deployar

```bash
# 1. Aplicar migration 051
./scripts/deploy-supabase.sh migrate-only

# 2. Deploy da EF (já existe no diretório)
supabase functions deploy export-contract-timeline-pdf

# 3. Verificar bucket
supabase storage list reports
```

## Como testar (acceptance)

### Smoke
1. `/contratos/:id/timeline`
2. Clicar "Exportar PDF" (header)
3. Modal "PDF gerado" mostra hash + código + link de validação
4. Download dispara automaticamente
5. Abrir PDF: capa + resumo + eventos por mês + footer com hash

### Com filtros aplicados
1. Selecionar tipo "Sanção" + severity "danger"
2. Range de datas Q1 2025
3. Click "Exportar PDF"
4. PDF inclui apenas eventos correspondentes

### Validação pública (sem login)
1. Copiar `validation_url` do modal
2. Abrir em aba anônima
3. `/v/{code}` mostra: "Linha do tempo do contrato", hash, código, data
4. Botão "Baixar PDF" funciona sem login

### RLS
1. Como usuário do tenant A, gerar PDF → upload em `tenants/A/contracts/...`
2. Como usuário do tenant B, tentar `createSignedUrl` no path do tenant A → falha (RLS bloqueia)
3. Validação pública (rota `/v/`) não é afetada por RLS — propositalmente

### Edge cases
1. Contrato com 0 eventos: PDF gera com mensagem "Nenhum evento encontrado"
2. Contrato com 1000+ eventos: PDF gera com paginação correta (pode levar 5-10s)
3. Sem permissão no contrato: 403

## Decisões arquiteturais

### Por que armazenar PDF no Storage e não em coluna BLOB?

- Tamanhos típicos: 100-500 KB. Múltiplos PDFs por contrato ao longo do tempo acumulam
- Supabase Storage otimizado para arquivos; PG fica leve
- URLs assinadas com validação de tenant via RLS no `storage.objects`
- Cache CDN automático

### Por que public_validation_records em vez de hash inline na EF?

- Centraliza validação pública (1 tabela, 1 rota `/v/:code`, 1 EF `public-validation`)
- Permite revogação posterior (campo `active`)
- Suporta expiração (campo `expires_at`)
- Consistência com outros 5 tipos (medição, aditivo, GED, databook, GRD) desde V01

### Por que QR code no PDF?

- Verificação rápida via celular sem transcrever código
- Padrão em órgãos públicos brasileiros (Receita, Detran, TCU)
- Suporta auditorias remotas (TCU pode validar in loco)

## Retrospectiva V30 → V44 (15 versões)

| Versão | Tema | Mig | Bundle main |
|---|---|---|---:|
| V30-V38 | Lei 14.133 (9 institutos) | 036-044 | 75.13 → 80.03 |
| V39 | Timeline por contrato | 045 | 80.43 |
| V40 | Mobile audit | — | 80.47 |
| V41 | Dashboard por contrato | 046 | 80.94 |
| V42 | Timeline global do tenant | 048 | 81.43 |
| V43 | Dashboard global do tenant | 049 | 84.13 |
| **V44** | **Export Timeline PDF** | **051** | **84.44** |

Bundle main +9.31 KB gzip em 15 versões. 0 typecheck errors em todas.

## Próximas oportunidades (V45+)

Continuando a ordem V41:

1. ~~Timeline global do tenant~~ — V42 ✅
2. ~~Dashboard global do tenant~~ — V43 ✅
3. ~~Export de timeline em PDF~~ — V44 ✅
4. **Cadastro de fornecedores sancionados** ← próximo — view global cruzando contratos. Útil pra próximas licitações (verificar histórico de inidoneidade/impedimento de um CNPJ específico)
5. API keys + REST público
6. OKLCH migration
7. EF download FGV/IBGE
8. Email digest de alertas (usa RPC V41/V43)
9. Completar Pendencias V35-V38 (047 órfã)
10. Completar Carteira V12 com KPIs Lei 14.133 (release-v43-prior preservado)
