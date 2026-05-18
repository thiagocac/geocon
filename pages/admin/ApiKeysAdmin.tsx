import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound, Plus, Copy, Check, AlertTriangle, ShieldOff, CheckCircle2, Eye, EyeOff, BookOpen,
} from 'lucide-react';
import {
  listApiKeys, createApiKey, revokeApiKey,
  API_KEY_VALID_SCOPES, API_KEY_SCOPE_LABELS,
  API_KEY_STATUS_LABELS, apiKeyStatusTone,
  type ApiKeyRow, type ApiKeyCreated, type ApiKeyScope,
} from '../../lib/api';
import { humanizeError } from '../../lib/errors';
import { dtTime } from '../../lib/format';
import { Layout } from '../../components/layout/Layout';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Field } from '../../components/ui/FormField';

export function ApiKeysAdmin() {
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<ApiKeyRow | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: listApiKeys,
  });

  const mRevoke = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => {
      setRevokeConfirm(null);
      setFeedback({ tone: 'ok', message: 'Chave revogada com sucesso' });
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (e) => setFeedback({ tone: 'error', message: humanizeError(e) }),
  });

  return (
    <>
      <Layout>
        <PageHeader
          kicker="Administração"
          title="Chaves de API"
          subtitle="Tokens para integração externa · sistemas de licitação · ERPs · controles externos"
          actions={
            <>
              <Button variant="outline" onClick={() => setDocsOpen(true)}>
                <BookOpen className="h-4 w-4" />Documentação
              </Button>
              <Button onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" />Nova chave
              </Button>
            </>
          }
        />

        <Card>
          <div className="border-b border-slate-200 px-4 py-3 dark:border-border-dark">
            <p className="font-semibold dark:text-slate-200">
              {isLoading ? 'Carregando…' : `${keys.length} chave${keys.length === 1 ? '' : 's'}`}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Ativas aparecem primeiro · revogadas/expiradas ficam abaixo para auditoria
            </p>
          </div>

          {!isLoading && keys.length === 0 && (
            <div className="px-4 py-12 text-center">
              <KeyRound className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Nenhuma chave criada ainda
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Clique em "Nova chave" para criar a primeira
              </p>
            </div>
          )}

          {keys.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-border-dark">
              {keys.map((k) => (
                <ApiKeyRowItem
                  key={k.id}
                  k={k}
                  onRevoke={() => setRevokeConfirm(k)}
                />
              ))}
            </ul>
          )}
        </Card>

        {/* Aviso de segurança */}
        <Card className="mt-4 border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900/40 dark:bg-yellow-900/15">
          <div className="flex items-start gap-2 text-sm text-yellow-900 dark:text-yellow-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="font-semibold">Boas práticas de segurança</p>
              <ul className="mt-1 list-disc pl-4 space-y-0.5 text-xs">
                <li>Cada sistema integrado deve ter sua própria chave (facilita revogação se houver vazamento)</li>
                <li>O secret completo é mostrado <strong>apenas uma vez</strong> na criação — anote em local seguro</li>
                <li>Use o menor conjunto de escopos possível por chave (princípio do menor privilégio)</li>
                <li>Defina expiração quando possível, especialmente para integrações temporárias</li>
                <li>Revogue chaves imediatamente em caso de comprometimento suspeito</li>
              </ul>
            </div>
          </div>
        </Card>
      </Layout>

      {/* Modal: nova chave */}
      <NewApiKeyModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(c) => {
          setNewOpen(false);
          setCreated(c);
          qc.invalidateQueries({ queryKey: ['api-keys'] });
        }}
        onError={(e) => setFeedback({ tone: 'error', message: e })}
      />

      {/* Modal: chave criada (one-time reveal) */}
      <CreatedKeyModal
        created={created}
        onClose={() => setCreated(null)}
      />

      {/* Modal: confirmar revogação */}
      <Modal
        open={!!revokeConfirm}
        onClose={() => setRevokeConfirm(null)}
        title="Revogar chave de API"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRevokeConfirm(null)}>Cancelar</Button>
            <Button onClick={() => revokeConfirm && mRevoke.mutate(revokeConfirm.id)} loading={mRevoke.isPending}>
              <ShieldOff className="h-4 w-4" />Revogar
            </Button>
          </div>
        }
      >
        {revokeConfirm && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-error/30 bg-error/5 p-3 text-error">
              <AlertTriangle className="mr-1 inline h-4 w-4" />
              Esta ação <strong>não pode ser desfeita</strong>. Sistemas integrados perderão acesso imediatamente.
            </div>
            <div>
              <p>Confirmar revogação da chave:</p>
              <p className="mt-2 font-mono text-xs">
                <strong>{revokeConfirm.name}</strong> · prefix <code className="rounded bg-slate-100 px-1 dark:bg-muted-dark">{revokeConfirm.key_prefix}</code>
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: documentação */}
      <DocsModal open={docsOpen} onClose={() => setDocsOpen(false)} />

      {/* Feedback */}
      <Modal
        open={!!feedback}
        onClose={() => setFeedback(null)}
        title="Status"
        size="sm"
        footer={<div className="flex justify-end"><Button onClick={() => setFeedback(null)}>OK</Button></div>}
      >
        {feedback && (
          <div className={`rounded-lg border px-3 py-3 text-sm ${
            feedback.tone === 'ok'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-error/30 bg-error/10 text-error'
          }`}>
            <div className="flex items-start gap-2">
              {feedback.tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />}
              <p>{feedback.message}</p>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

// =============================================================================
// Linha de chave
// =============================================================================
function ApiKeyRowItem({ k, onRevoke }: { k: ApiKeyRow; onRevoke: () => void }) {
  const isActive = k.status === 'ativa';
  const tone = apiKeyStatusTone(k.status);
  return (
    <li className={`flex items-start gap-3 px-4 py-3 ${!isActive ? 'opacity-60' : ''}`}>
      <div className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
        tone === 'green'  ? 'bg-success/10 text-success' :
        tone === 'yellow' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30' :
                            'bg-slate-100 text-slate-500 dark:bg-muted-dark'
      }`}>
        <KeyRound className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-semibold dark:text-slate-200">{k.name}</p>
          <Badge tone={tone}>{API_KEY_STATUS_LABELS[k.status]}</Badge>
        </div>
        <p className="font-mono text-xs text-slate-500">
          gck_live_<span className="font-bold text-slate-700 dark:text-slate-300">{k.key_prefix}</span>_<span className="opacity-50">{'•'.repeat(32)}</span>
        </p>

        <div className="mt-1 flex flex-wrap gap-1">
          {k.scopes.map((s) => (
            <Badge key={s} tone="purple">{s}</Badge>
          ))}
        </div>

        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
          <span>criada por <strong>{k.created_by_nome || '—'}</strong> · {dtTime(k.created_at)}</span>
          {k.last_used_at && <span>· último uso {dtTime(k.last_used_at)}</span>}
          {k.expires_at && (
            <span className={new Date(k.expires_at) < new Date() ? 'text-yellow-700 dark:text-yellow-300' : ''}>
              · expira {dtTime(k.expires_at)}
            </span>
          )}
          {k.revoked_at && (
            <span className="text-slate-500">
              · revogada por <strong>{k.revoked_by_nome || '—'}</strong> em {dtTime(k.revoked_at)}
            </span>
          )}
        </div>
      </div>

      {isActive && (
        <Button variant="outline" size="sm" onClick={onRevoke}>
          <ShieldOff className="h-3.5 w-3.5" />Revogar
        </Button>
      )}
    </li>
  );
}

// =============================================================================
// Modal: nova chave
// =============================================================================
function NewApiKeyModal({
  open, onClose, onCreated, onError,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (k: ApiKeyCreated) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<Set<ApiKeyScope>>(new Set());
  const [hasExpiration, setHasExpiration] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');

  const mCreate = useMutation({
    mutationFn: () => createApiKey({
      name,
      scopes: Array.from(selectedScopes),
      expires_at: hasExpiration && expiresAt ? `${expiresAt}T23:59:59Z` : undefined,
    }),
    onSuccess: (data) => {
      setName(''); setSelectedScopes(new Set()); setHasExpiration(false); setExpiresAt('');
      onCreated(data);
    },
    onError: (e) => onError(humanizeError(e)),
  });

  function toggle(s: ApiKeyScope) {
    setSelectedScopes((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }

  const canSubmit = name.trim().length >= 1 && selectedScopes.size > 0
    && (!hasExpiration || !!expiresAt);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova chave de API"
      subtitle="A chave completa será mostrada apenas uma vez após criação"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mCreate.mutate()} loading={mCreate.isPending} disabled={!canSubmit}>
            <Plus className="h-4 w-4" />Gerar chave
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Nome / descrição" required hint="Identifique para qual sistema/integração esta chave será usada">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Integração Comprasnet"
            maxLength={200}
            className="input"
            autoFocus
          />
        </Field>

        <div>
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
            Escopos {selectedScopes.size > 0 && <span className="text-magenta">· {selectedScopes.size} selecionado{selectedScopes.size === 1 ? '' : 's'}</span>}
          </p>
          <div className="space-y-1.5">
            {API_KEY_VALID_SCOPES.map((s) => (
              <label key={s} className="flex items-start gap-2 cursor-pointer text-sm rounded-md p-2 hover:bg-slate-50 dark:hover:bg-muted-dark/30">
                <input
                  type="checkbox"
                  checked={selectedScopes.has(s)}
                  onChange={() => toggle(s)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs font-semibold">{s}</p>
                  <p className="text-[11px] text-slate-500">{API_KEY_SCOPE_LABELS[s]}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={hasExpiration}
              onChange={(e) => setHasExpiration(e.target.checked)}
            />
            Definir data de expiração (recomendado)
          </label>
          {hasExpiration && (
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="input mt-2 w-auto"
              min={new Date().toISOString().slice(0, 10)}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// Modal: chave criada (one-time reveal)
// =============================================================================
function CreatedKeyModal({ created, onClose }: { created: ApiKeyCreated | null; onClose: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleClose() {
    setRevealed(false); setCopied(false);
    onClose();
  }

  function copyKey() {
    if (!created) return;
    navigator.clipboard.writeText(created.full_key).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
    );
  }

  return (
    <Modal
      open={!!created}
      onClose={handleClose}
      title="Chave criada com sucesso"
      subtitle="Esta é a única oportunidade de copiar o secret completo"
      size="md"
      footer={
        <div className="flex justify-end">
          <Button onClick={handleClose}>Entendi · fechar</Button>
        </div>
      }
    >
      {created && (
        <div className="space-y-3">
          <div className="rounded-lg border-2 border-error/40 bg-error/5 p-3 text-sm text-error">
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            <strong>Atenção:</strong> Esta chave não será mostrada novamente após fechar este diálogo.
            Copie e armazene em local seguro (cofre de credenciais, variável de ambiente, etc).
          </div>

          <div>
            <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-display text-slate-500">
              Chave completa
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-border-dark dark:bg-muted-dark/30">
              <div className="mb-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setRevealed(!revealed)}
                  className="inline-flex items-center gap-1 text-xs text-magenta hover:underline"
                >
                  {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {revealed ? 'Ocultar' : 'Revelar'}
                </button>
                <button
                  type="button"
                  onClick={copyKey}
                  className="inline-flex items-center gap-1 text-xs text-magenta hover:underline"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
              <code className="block break-all font-mono text-xs text-slate-700 dark:text-slate-300">
                {revealed
                  ? created.full_key
                  : `gck_live_${created.key_prefix}_${'•'.repeat(32)}`}
              </code>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-border-dark dark:bg-muted-dark/30">
            <p className="font-mono text-[10px] uppercase tracking-display text-slate-500">Detalhes</p>
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
              <dt className="text-slate-500">Nome:</dt>
              <dd className="dark:text-slate-200 truncate">{created.name}</dd>
              <dt className="text-slate-500">Escopos:</dt>
              <dd className="dark:text-slate-200">{created.scopes.join(', ')}</dd>
              {created.expires_at && (
                <>
                  <dt className="text-slate-500">Expira:</dt>
                  <dd className="dark:text-slate-200">{new Date(created.expires_at).toLocaleString('pt-BR')}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/15 dark:text-blue-200">
            <p className="font-semibold">Exemplo de uso (cURL):</p>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px]">
{`curl -X POST {SUPABASE_URL}/functions/v1/public-api/suppliers/check \\
  -H "Authorization: Bearer ${revealed ? created.full_key : `gck_live_${created.key_prefix}_***`}" \\
  -H "Content-Type: application/json" \\
  -d '{"cnpj":"12.345.678/0001-90"}'`}
            </pre>
          </div>
        </div>
      )}
    </Modal>
  );
}

// =============================================================================
// Modal: documentação
// =============================================================================
function DocsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Documentação da API pública"
      subtitle="Endpoints disponíveis e formato"
      size="lg"
      footer={<div className="flex justify-end"><Button onClick={onClose}>Fechar</Button></div>}
    >
      <div className="space-y-4 text-sm">
        <section>
          <h3 className="mb-1 font-semibold dark:text-slate-200">Autenticação</h3>
          <p className="text-slate-600 dark:text-slate-400">
            Todas as rotas (exceto <code className="text-xs">/health</code> e <code className="text-xs">/openapi</code>) exigem header:
          </p>
          <pre className="mt-1 rounded bg-slate-50 p-2 text-xs dark:bg-muted-dark/30 dark:text-slate-300">
{`Authorization: Bearer gck_live_<prefix>_<secret>`}
          </pre>
        </section>

        <section>
          <h3 className="mb-1 font-semibold dark:text-slate-200">Base URL</h3>
          <pre className="rounded bg-slate-50 p-2 text-xs dark:bg-muted-dark/30 dark:text-slate-300">
{`{SUPABASE_URL}/functions/v1/public-api`}
          </pre>
        </section>

        <section>
          <h3 className="mb-1 font-semibold dark:text-slate-200">Endpoints</h3>

          <div className="space-y-2">
            <EndpointDoc
              method="GET"
              path="/health"
              auth="—"
              description="Liveness check"
              response={`{ "ok": true, "status": "ok", "timestamp": "...", "api_version": "1.0.0" }`}
            />
            <EndpointDoc
              method="GET"
              path="/openapi"
              auth="—"
              description="Especificação OpenAPI 3.0 dos endpoints"
              response={`OpenAPI JSON document`}
            />
            <EndpointDoc
              method="POST"
              path="/suppliers/check"
              auth="suppliers:check"
              description="Verifica se um CNPJ está bloqueado para contratação. Retorna pode_contratar=false quando há impedimento ou inidoneidade ATIVOS."
              request={`{ "cnpj": "12.345.678/0001-90" }`}
              response={`{
  "ok": true,
  "cnpj": "12345678000190",
  "nome": "Fornecedor LTDA",
  "found": true,
  "pode_contratar": false,
  "severidade": "alta",
  "impedimento_ativo": 1,
  "motivo_bloqueio": "Impedimento de licitar/contratar ativo até 15/06/2027"
}`}
            />
            <EndpointDoc
              method="GET"
              path="/suppliers/sanctioned"
              auth="suppliers:read"
              description="Lista fornecedores com sanções no tenant"
              params="severidade=critica,alta · status=ativo,historico · only_with_active=true · limit=200 (max 500)"
              response={`{ "ok": true, "suppliers": [...], "count": 42, "tenant_id": "..." }`}
            />
          </div>
        </section>

        <section>
          <h3 className="mb-1 font-semibold dark:text-slate-200">Códigos de erro</h3>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
            <dt><code className="rounded bg-slate-100 px-1 dark:bg-muted-dark">401</code></dt>
            <dd>Authorization ausente, malformado, chave inválida/expirada/revogada</dd>
            <dt><code className="rounded bg-slate-100 px-1 dark:bg-muted-dark">403</code></dt>
            <dd>Chave válida sem o escopo necessário</dd>
            <dt><code className="rounded bg-slate-100 px-1 dark:bg-muted-dark">404</code></dt>
            <dd>Rota desconhecida</dd>
            <dt><code className="rounded bg-slate-100 px-1 dark:bg-muted-dark">405</code></dt>
            <dd>Método HTTP não permitido</dd>
            <dt><code className="rounded bg-slate-100 px-1 dark:bg-muted-dark">422</code></dt>
            <dd>Body/parâmetros inválidos</dd>
            <dt><code className="rounded bg-slate-100 px-1 dark:bg-muted-dark">500</code></dt>
            <dd>Erro interno</dd>
          </dl>
        </section>
      </div>
    </Modal>
  );
}

function EndpointDoc({
  method, path, auth, description, request, response, params,
}: {
  method: 'GET' | 'POST';
  path: string;
  auth: string;
  description: string;
  request?: string;
  response: string;
  params?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-border-dark">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <Badge tone={method === 'GET' ? 'blue' : 'purple'}>{method}</Badge>
        <code className="font-mono text-xs font-bold dark:text-slate-200">{path}</code>
        <span className="ml-2 font-mono text-[10px] text-slate-500">scope: {auth}</span>
      </div>
      <p className="mb-1.5 text-xs text-slate-600 dark:text-slate-400">{description}</p>
      {params && (
        <>
          <p className="font-mono text-[10px] uppercase text-slate-500">Query params</p>
          <p className="font-mono text-[11px] dark:text-slate-300">{params}</p>
        </>
      )}
      {request && (
        <>
          <p className="mt-1 font-mono text-[10px] uppercase text-slate-500">Request body</p>
          <pre className="overflow-x-auto rounded bg-slate-50 p-1.5 font-mono text-[10px] dark:bg-muted-dark/30 dark:text-slate-300">{request}</pre>
        </>
      )}
      <p className="mt-1 font-mono text-[10px] uppercase text-slate-500">Response (200)</p>
      <pre className="overflow-x-auto rounded bg-slate-50 p-1.5 font-mono text-[10px] dark:bg-muted-dark/30 dark:text-slate-300">{response}</pre>
    </div>
  );
}
