# V60 — Workflow aprovação de revisão GED

V60 abre a primeira **feature transacional não-analítica** da sequência V54-V59.
Implementa workflow de aprovação para revisões de documentos GED, reusando
pattern de `measurement_approval_steps` (V01) e magic link (V07/V09).

## Contexto

Até V59, mudanças de status do GED eram **diretas**: clicar em "Aprovar"
mudava `status='aprovado'` sem registro de quem decidiu, quando, por quê. Sem
gate, sem auditoria, sem aprovador externo. Para compliance real
(especialmente em órgãos públicos com Lei 14.133), preciso de:

1. Workflow multi-step (1-N aprovadores configuráveis por categoria/contrato)
2. Registro completo: quem decidiu, quando, com que comentário
3. Magic link para aprovador externo (supervisor de outro sistema)
4. Lifecycle automático: última aprovação → publica revisão e obsoleta a anterior

## Infraestrutura pré-existente reusada

- **`workflow_templates`** (V01) já aceita `entity_type='ged_document'` — só
  precisei criar o template padrão como dado seed (não criado nessa migration,
  fica para configuração de tenant)
- **`workflow_steps`** (V01) já modela steps (ordem, role_required, sla_hours,
  assinatura_obrigatoria, actions)
- **`approval_magic_links`** (V01) já é genérico com `entity_type` + `entity_id`
  — V60 usa `entity_type='ged_revision'`
- **`approval_delegations`** (V01) já existe — workflow GED pode aproveitar
  delegação registrada

V60 só adiciona a tabela de steps específica para GED e os RPCs de orquestração.

## O que V60 entrega

### 1. Migration 062 — `ged_revision_approval_steps` + 2 RPCs

**Tabela paralela a `measurement_approval_steps`** com mesmos campos:

```sql
CREATE TABLE ged_revision_approval_steps (
  id, tenant_id, document_id, version_id, template_step_id,
  ordem, nome, role_required, assigned_to,
  status text CHECK ('pendente','aprovado','devolvido','reprovado','ignorado'),
  due_at, decided_at, decided_by,
  decided_via_delegation, decided_for,  -- suporte a delegações
  comment, signature_method, signature_storage_path,
  created_at, updated_at, deleted_at
);

-- 2 índices: lookup por versão + inbox de pendentes por tenant
CREATE INDEX ... ON (version_id) WHERE deleted_at IS NULL;
CREATE INDEX ... ON (tenant_id, due_at) WHERE status='pendente' AND deleted_at IS NULL;
```

**RLS habilitado** — tenant_id check em SELECT/ALL via members.

**RPC `instantiate_ged_revision_workflow(version_id, template_id?)`**:
- Resolve template: param → tenant default → fallback "Aprovação técnica" single-step
- Cria 1 step por workflow_step, com due_at = now + sla_hours
- Marca versão como `em_aprovacao` + documento como `em_revisao`

**RPC `decide_ged_revision_step(step_id, action, comment?)`**:
- Action: `aprovar | devolver | reprovar`
- Atualiza step com decided_at/decided_by
- **Lifecycle automático**:
  - Qualquer **reprovação** → versão fica `reprovada`, documento volta a `em_revisao`
  - Todas **aprovadas** → versão fica `vigente`, anterior `obsoleta`, documento `aprovado`, `revisao_atual` atualizado
- Idempotente: rejeita decision em step já decidido

### 2. API + types

```ts
export interface GedRevisionApprovalStep {
  id, document_id, version_id, ordem, nome, role_required,
  assigned_to, status, due_at, decided_at, decided_by,
  decided_via_delegation, decided_for, comment, signature_method,
  assigned_member?, decided_member?
}

export async function listGedRevisionApprovalSteps(versionId): Promise<...[]>;
export async function listMyGedRevisionApprovals(): Promise<...[]>;
  // para inbox global "Minhas aprovações" (V61 pode adicionar tab)

export async function instantiateGedRevisionWorkflow(versionId, templateId?): Promise<number>;

export async function decideGedRevisionStep({step_id, action, comment?}):
  Promise<{ status, pending_remaining, reproved_count }>;

export async function issueGedRevisionMagicLink(stepId, email, ttlHours=72):
  Promise<string>;  // URL pronta para enviar
```

**Tipo `GedDocumentVersion.status` estendido** de `'vigente' | 'obsoleta' | 'rascunho'`
para incluir `'em_aprovacao' | 'reprovada'` (não muda schema; só refina TS).

### 3. Página `/ged/documentos/:docId/aprovar` (lazy chunk 9.9 KB raw)

**Estrutura paralela ao `MeasurementApprovePage.tsx`**:

- Header com revisão alvo (mais recente com status em_aprovacao)
- 4 KPI cards: Total · Aprovadas · Pendentes · Reprovadas (cells com opacidade
  reduzida em zeros)
- Lista de steps ordenada por `ordem`:
  - Bola numerada (8x8 rounded-full) com ordem
  - Nome do step + status badge + role_required
  - Atribuído a (member nome+email)
  - Prazo: `dtTime(due_at)` + relativeTime quando pendente
  - Decidido em: `dtTime(decided_at)` por member quando concluído
  - `<blockquote>` com comment quando presente
  - 4 botões quando pendente: Aprovar (primary) · Devolver (outline) ·
    Reprovar (ghost error) · Magic link
  - Conector `<ArrowDown />` entre steps consecutivos

**Modal de decisão**:
- Subtítulo dinâmico por action explicando consequência
- Campo comentário (textarea, opcional para aprovar, obrigatório p/ devolver/reprovar)
- Confirma → `decideMut.mutate`, invalida queries

**Modal de magic link**:
- 2-step: (a) form (email + TTL hours 1-168) → (b) URL pronta para copiar
- Botões: Copiar · Abrir externo · Fechar
- Validação de email com regex simples

### 4. Integração no `GedDocument()` detail

Botão **"Aprovar revisão"** (primary) aparece **só quando** há
`versions.some(v => v.status === 'em_aprovacao')`. Link relativo `aprovar`.
Posicionado após "Comparar revisões" para fluxo natural: ver diff → aprovar.

### 5. Mock SKIP_AUTH

- **`MOCK_VERSIONS.v3`** mudou de `status: 'vigente'` para **`'em_aprovacao'`**
- **`MOCK_GED_REVISION_STEPS`** com 2 steps para v3:
  - `grs-1` Revisão técnica · RT → **aprovado** por Patrícia Lopes em 14/05/2026
    com comentário "Conformidade com NBR 6118 e RDC 50 verificada..."
  - `grs-2` Aprovação final · Coordenação → **pendente** com Roberto Silveira
- `decideGedRevisionStep` em SKIP_AUTH **muta o array in-memory** — usuário
  pode aprovar o step pendente na sessão demo e ver o workflow concluir

Demo flow:
1. Lista GED → clicar doc-1 (Planta arquitetônica)
2. Detail mostra botão "Aprovar revisão" porque v3 está em_aprovacao
3. Click → /ged/documentos/doc-1/aprovar
4. Vê 2 steps (1 aprovado, 1 pendente)
5. Pode aprovar step 2 → vê toast/invalidação → workflow conclui
6. Magic link demo: gera token-demo URL copiável

## Decisões

1. **Tabela paralela, não polimorfismo** — `measurement_approval_steps` +
   `ged_revision_approval_steps` ao invés de `approval_steps_polymorphic`.
   Trade-off: duplica schema mas mantém referential integrity forte e
   permite triggers específicos por domínio. Mesma escolha de V01 para
   `additive_approval_steps`.

2. **Fallback single-step "Aprovação técnica"** — se tenant não configurou
   template `ged_document`, RPC cria step único genérico. Garante que upload
   de revisão sempre tem fluxo, mesmo sem setup prévio.

3. **`comment` opcional para aprovar, obrigatório para devolver/reprovar** —
   aprovar sem comentário é fluido; rejeitar exige justificativa por boas
   práticas de compliance. Validation no frontend (`disabled={!comment.trim()}`).

4. **`em_aprovacao` na versão, `em_revisao` no documento** — versão é o que
   está sendo aprovado especificamente; documento reflete o estado macro.
   Quando workflow conclui, versão vai a `vigente` ou `reprovada`, doc vai
   a `aprovado` ou volta a `em_revisao`.

5. **Magic link reusa `approval_magic_links`** — entity_type='ged_revision'
   + entity_id=step_id. Endpoint `consume_approval_magic_link` (V09) decide
   action sem precisar de auth.uid(). Reusa toda a stack de magic link de
   medição.

6. **Mock muta in-memory** — `decideGedRevisionStep` em SKIP_AUTH altera
   `MOCK_GED_REVISION_STEPS` para que a demo seja interativa. Padrão de
   `updateGedDocumentValidity` (V56).

7. **Sem worker para automation** — não disparei email automaticamente em
   `instantiate_ged_revision_workflow`. Notificação é responsabilidade do
   sistema de notificações existente (V20+). Plano: trigger no INSERT da
   tabela notifica assigned_to via notification_preferences. V61 pode
   conectar.

8. **Lifecycle no RPC, não em trigger** — `decide_ged_revision_step` faz o
   trabalho de marcar versão vigente/obsoleta inline. Trigger seria mais
   "automágico" mas torna debug mais difícil. RPC explícito → comportamento
   óbvio.

## Bundle V59 → V60

| Chunk | V59 | V60 | Δ |
|---|---:|---:|---:|
| Main | 98.67 | **99.32** | +0.65 |
| Approve (lazy) | — | 9.9 KB raw | — |

Margem 150 − 99.32 = **50.68 KB**. Custo no main: tipos + 5 funções API.
Página em chunk lazy separado.

## Sequência V54-V60 cumulativa

| Versão | Área | Tema | Bundle | Δ |
|---|---|---|---:|---:|
| V54 | Medição | Validações automáticas | 92.69 | +2.25 |
| V55 | SOV | Curva ABC + Pareto | 94.63 | +1.94 |
| V56 | GED | Validade temporal + cron | 95.79 | +1.16 |
| V57 | SOV | Auditoria preços SINAPI/SICRO | 97.50 | +1.71 |
| V58 | GED | Diff entre revisões | 98.23 | +0.73 |
| V59 | GED | Painel KPI do acervo | 98.67 | +0.44 |
| V60 | GED | **Workflow aprovação revisão** | 99.32 | +0.65 |

**+6.63 KB total** em 7 versões = 13% do crescimento até 150 KB.
Cobertura: Medição 1× · SOV 2× · **GED 4×**. GED está agora muito bem coberto.

## Próximas oportunidades (V61+)

**Medição agora urgente** (1× das 7 versões):
1. **Apontamento campo mobile-first** (~600 linhas) — feature grande transformadora.
   Swipe-cards + foto direta + GPS + voice-to-text + Service Worker offline.
   Abre superfície completamente nova de uso (fiscal em canteiro).

**SOV** (2× das 7):
2. **Composições de preço explícitas** (~400 linhas) — schema novo
   `contract_item_compositions` (mão-de-obra + material + equipamento).
   Liga V57 (auditoria de preços) com SINAPI compositions oficiais.

**GED remanescente**:
3. **Marca d'água "CÓPIA NÃO CONTROLADA"** (~300 linhas) — Edge Function
   adiciona overlay + assinatura ICP-Brasil opcional. Compliance.
4. **Notificação automática** (~150 linhas) — trigger no INSERT de
   ged_revision_approval_steps dispara notification para assigned_to.
   Quick win que ativa workflow real.

Por valor/esforço, **(1) Apontamento mobile-first** é a feature mais
transformadora pendente — abre uso em campo. Mas escopo grande (600 linhas).
**(4) Notificação automática** é o quick win que ativa V60 na prática
(sem notificação, workflow só "existe" passivamente). Continuar com qual?
