# V42 — Pendências tenant-level estendidas para Lei 14.133

V42 conecta o trabalho de 9 institutos (V30-V38) à página `/pendencias` tenant-level que existia desde V12. Antes do V42, a Pendencias mostrava apenas 4 tipos antigos: medições atrasadas, GRDs sem confirmação, itens não previstos parados, contratos em risco. **Os 9 novos institutos da Lei 14.133 não geravam pendências visíveis no nível do tenant** — gestores precisavam abrir contrato por contrato para descobrir vícios abertos, garantias vencendo, PARs em curso, etc.

V42 é puramente compositivo: **estende a view `v_pendencias` com 5 novos `UNION ALL`**, e a UI absorve automaticamente porque já itera sobre `PENDENCIA_META`.

## 5 novos tipos de pendência

| Tipo | Fonte | Critérios de severidade |
|---|---|---|
| `vicio_aberto` | `contract_receipt_vicios` em aberto/em_saneamento | **high**: severidade vício=alta/critica OU prazo de saneamento vencido · **medium**: aberto há >20 dias · **low**: caso contrário |
| `par_defesa` | `contract_par_processes` status=em_defesa | **high**: prazo vencido OU ≤7d · **medium**: ≤14d · **low**: >14d |
| `garantia_vencendo` | `contract_guarantees` ativa/estendida com vigência ≤60d | **high**: vencida OU ≤7d · **medium**: ≤30d · **low**: 31-60d |
| `sancao_multa_pendente` | `contract_sanctions` tipo=multa, não paga, ativa/suspensa | **high**: valor >R$ 100k OU data_vencimento_multa vencida · **medium**: vencimento ≤15d · **low**: caso contrário |
| `recebimento_definitivo_atrasado` | provisórios `data_limite_definitivo < today` sem definitivo | sempre **high** (art. 140 §3º) |

## Migration 047

DROPa e recria `v_pendencias` (necessário porque CREATE OR REPLACE não suporta novos UNION ALL). View herda RLS das tabelas-fonte, segurança automática.

Os 4 UNIONs originais (V12) foram preservados literalmente sem mudanças. Os 5 novos seguem o mesmo schema (`tenant_id · contract_id · contract_numero · pendencia_tipo · entity_id · descricao · desde · dias_aberta · severidade`).

Adicionado `COMMENT ON VIEW` documentando as 9 fontes para discoverability via Supabase Studio.

## Atualizações UI

### `src/lib/api.ts`

Tipo `Pendencia.pendencia_tipo` agora aceita 9 valores em vez de 4:
```ts
pendencia_tipo:
  | 'medicao_aprovacao' | 'grd_recebimento' | 'unforeseen_analise' | 'risco_alto'
  | 'vicio_aberto' | 'par_defesa' | 'garantia_vencendo'
  | 'sancao_multa_pendente' | 'recebimento_definitivo_atrasado';
```

### `src/pages/Pendencias.tsx`

- 5 novas entradas em `PENDENCIA_META` com label · ícone · linkBase
  - vicio_aberto → /recebimentos (ícone FileCheck vermelho)
  - par_defesa → /processos-administrativos (Gavel roxo)
  - garantia_vencendo → /garantias (Shield amarelo)
  - sancao_multa_pendente → /sancoes (Hammer vermelho)
  - recebimento_definitivo_atrasado → /recebimentos (FileCheck vermelho)
- Contagens (`counts`) automaticamente computadas
- Chips de filtro **renderizam automaticamente** porque iteram `Object.keys(PENDENCIA_META)`

### Dashboard.tsx

Sem mudanças necessárias. Mostra `pendencias.length` e filtros por severidade — herda das 9 fontes automaticamente. Badge vermelho no botão "Pendências" reflete agora pendências dos novos institutos também.

## Build status

```
typecheck  ✓ 0 erros
vite build ✓ módulos OK · 10.18s
```

**Bundle**:
- Main: 80.94 → **81.15 KB gzip** (+0.21 KB)
- Pendencias chunk: ~3 KB (sem novos imports pesados — apenas 3 ícones extra de lucide-react já no main)
- Margem até 150 KB: **68.9 KB**

## Diff V41 → V42

- **+1 migration** (047 pendencias_lei14133 · ~230L) — DROPa view e recria com 9 UNION ALL
- **api.ts**: extensão do tipo `Pendencia.pendencia_tipo` (4 → 9 valores)
- **Pendencias.tsx**: 5 entradas adicionadas a `PENDENCIA_META`, contagens correspondentes, 3 ícones importados (Shield/Gavel/Hammer)
- **0 tabelas novas**, **0 RPCs novas**, **0 cron jobs** — terceira versão consecutiva puramente compositiva (V39, V41 também foram)

## Decisões arquiteturais

### Por que estender view existente em vez de criar nova?

`v_pendencias` é o ponto canônico de "pendências do tenant" desde V12. Já é consumida por:
- `/pendencias` (UI principal)
- Dashboard (KPI de total + badge de severidade)
- EF `digest-daily` (V12) para email diário
- `v_digest_daily_data` (V12)

Criar uma view paralela `v_pendencias_lei14133` exigiria atualizar todos os 4 consumers. Estender a view existente faz tudo herdar automaticamente, incluindo o email digest — gestores começam a receber alertas dos 9 institutos no email diário sem mudanças adicionais.

### Por que UI renderiza chips automaticamente?

`PENDENCIA_META` é a fonte única de verdade. O loop `Object.keys(PENDENCIA_META).map((tipo) => ...)` significa que adicionar tipo no MAP basta — chips, contadores, ícones, e roteamento aparecem automaticamente. Padrão consistente desde V12.

### Critérios de severidade espelham V41 alerts

Os critérios "high" dos 5 novos tipos espelham as regras de alert do Dashboard executivo V41:
- garantia ≤7d → V41 alerta vermelho · V42 severidade high
- multa >R$ 100k pendente → V41 warning · V42 high
- prazo defesa vencido → V41 warning · V42 high
- vício alta/crítica → V41 danger · V42 high

Mantém consistência entre as duas visões. Se um gerente vê alert no Dashboard executivo (V41), vê o mesmo item na lista de pendências tenant (V42).

## Para deployar

```bash
./scripts/deploy-supabase.sh migrate-only   # 047
```

Sem EFs novas, sem cron. Migration é puramente DDL (DROP VIEW + CREATE VIEW).

## Como testar (acceptance)

### Visão básica
1. `/pendencias`
2. Painel de filtros mostra agora 9 chips (4 antigos + 5 novos) com ícones e contagens
3. Click em chip "Vício em recebimento" → filtra apenas vícios abertos
4. Click em chip "Garantia vencendo" → filtra apenas garantias <60d
5. Click em chip "PAR em defesa" → filtra apenas PARs com defesa em curso
6. Click em pendência → navega para o sub-path correto (`/contratos/X/recebimentos`, etc)

### Severidade em ação
1. Contrato com vício "critica" aberto → aparece na lista com badge vermelho "high"
2. Contrato com garantia vencendo em 5 dias → badge vermelho "high"
3. Contrato com multa de R$ 50k vencimento em 20d → badge cinza "low" (não é alta nem vencendo logo)
4. Contrato com multa de R$ 500k pendente → badge vermelho "high" (>R$ 100k threshold)
5. Provisório com data_limite_definitivo no passado → SEMPRE high (art. 140 §3º crítico)

### Dashboard tenant
1. `/dashboard`
2. KPI "Pendências" agora soma 9 fontes em vez de 4
3. Badge vermelho no botão "Pendências" reflete soma de high de TODOS os tipos
4. Card "Contratos críticos" do dashboard continua mostrando o que mostrava (alimentado por outras views)

### Email digest (herdado de V12)
1. Se admin estiver opted-in para digest diário, o email vai automaticamente incluir contagem das 9 fontes
2. Quiet hours respeitadas
3. Sem mudanças no template — `v_digest_daily_data` consome `v_pendencias`, herda automaticamente

## Mapa de cobertura tenant-level vs contract-level

| Visão | Eixo Lei 14.133 |
|---|---|
| Dashboard executivo por contrato (V41) | 9/9 ✅ |
| Pendências tenant (V42) | 9/9 ✅ |
| Timeline cronológica por contrato (V39) | 9/9 ✅ |
| Carteira por programa/órgão (V12 antigo) | 4/9 (apenas financeiro, sem novos institutos) |
| Email digest (V12 antigo) | 9/9 ✅ (herda via v_pendencias) |

**Coverage agora**: gestores podem detectar problemas dos 9 institutos sem abrir contrato individual, no email diário, na pendencias tenant, ou no dashboard executivo.

## Retrospectiva V30 → V42 (13 versões consecutivas)

| Versão | Tema | Mig | Bundle main |
|---|---|---|---:|
| V30-V38 | Lei 14.133 (9 institutos) | 036-044 | 75-80 |
| V39 | Timeline unificada por contrato | 045 | 80.43 |
| V40 | Mobile audit V30-V39 | — | 80.47 |
| V41 | Dashboard agregado por contrato | 046 | 80.94 |
| **V42** | **Pendências tenant Lei 14.133** | **047** | **81.15** |

13 versões. Bundle main: 75.13 → 81.15 = **+6.02 KB gzip** para cobertura legal completa + 3 visões consolidadas (timeline por contrato, dashboard por contrato, pendências tenant) + mobile coverage. **0 typecheck errors** em todas.

## Próximas oportunidades (V43+)

Com pendências tenant integradas, próximos passos:

1. **Carteira por programa estendida** — atualizar `/carteira` (Portfolio.tsx) com KPIs agregados dos 9 institutos por programa/órgão (ex: "Programa X tem 12 vícios abertos, 3 garantias vencendo")
2. **Dashboard executivo do tenant** — versão "carteira inteira" da V41. Diferente de Portfolio que agrega por categoria, esse seria visão de presidência com alertas agregados de todos os contratos
3. **Cadastro de fornecedores sancionados** — view global cruzando contracts + sanctions: "Empresa X tem 3 contratos, 2 sanções ativas, 1 inidoneidade"
4. **Export de timeline em PDF** — arquivo legal completo de um contrato
5. **API keys + REST público** — superfície externa
6. **OKLCH migration** — DS Tier 3 (oferecida 16 vezes desde V14)

**Recomendação V43**: **Carteira por programa estendida**. A página `/carteira` (Portfolio.tsx, 305L) já agrupa contratos por programa/órgão/município, mas não conhece os 9 institutos. Adicionar KPIs por agrupamento ("3 vícios abertos no programa X, 12 garantias vencendo no órgão Y") fecha o ciclo tenant-level: gestores seniores vêem problemas distribuídos pela carteira.

Alternativa: **Cadastro de fornecedores sancionados**. Novo, mas valor alto para próximas licitações.
