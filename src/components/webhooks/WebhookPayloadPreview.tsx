import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Code2, RefreshCw, AlertCircle, Search, X } from 'lucide-react';
import {
  buildWebhookSamplePayload,
  searchEntitiesForWebhook,
  WEBHOOK_DOMAIN_EVENT_OPTIONS,
  type SamplePayloadResult,
  type WebhookEntity,
} from '../../lib/api';
import { Skeleton } from '../ui/Stat';

interface Props {
  /** Eventos atualmente selecionados no form */
  selectedEvents: string[];
  /** Kind do webhook (afeta a nota sobre formato) */
  kind: 'slack' | 'teams' | 'generic';
  /** Se há payload_template customizado pra generic */
  hasCustomTemplate: boolean;
}

/**
 * Painel de preview que mostra o JSON que será enviado pelo webhook,
 * computado server-side via RPC `build_webhook_sample_payload`.
 *
 * V28: aceita seleção de uma entidade real do tenant (combobox com search)
 * pra mostrar o JSON EXATO que seria enviado em produção. Sem entidade,
 * usa dados sintéticos (flag synthetic: true).
 *
 * Admin escolhe um evento dentre os selecionados, vê o JSON.
 * Para 'slack' e 'teams' o real payload é construído pela EF;
 * aqui mostramos apenas o `payload` cru do evento (entry de domínio)
 * pra explicar o contexto.
 */
export function WebhookPayloadPreview({ selectedEvents, kind, hasCustomTemplate }: Props) {
  const initialEvent = selectedEvents[0] || 'broadcast_sent';
  const [event, setEvent] = useState(initialEvent);
  const [selectedEntity, setSelectedEntity] = useState<WebhookEntity | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Reset entity quando evento muda (incompatível)
  useEffect(() => {
    setSelectedEntity(null);
    setSearchQuery('');
    setSearchOpen(false);
  }, [event]);

  const availableEvents = WEBHOOK_DOMAIN_EVENT_OPTIONS.filter((o) =>
    selectedEvents.includes(o.value),
  );

  const { data: entityCandidates = [], isLoading: entitiesLoading } = useQuery({
    queryKey: ['webhook-entity-search', event, searchQuery],
    queryFn: () => searchEntitiesForWebhook(event, searchQuery, 8),
    enabled: searchOpen && event !== 'digest_failed' && event !== 'broadcast_sent' || (searchOpen && searchQuery.length > 0),
    staleTime: 30_000,
  });

  const { data, isLoading, error, refetch } = useQuery<SamplePayloadResult>({
    queryKey: ['webhook-sample-payload', event, selectedEntity?.id || 'synthetic'],
    queryFn: () => buildWebhookSamplePayload(event, selectedEntity?.id),
    enabled: selectedEvents.includes(event),
    staleTime: 60_000,
  });

  if (selectedEvents.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center dark:border-border-dark">
        <Code2 className="mx-auto h-5 w-5 text-slate-400" />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Selecione ao menos um evento acima pra ver o payload de exemplo
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5 text-slate-500" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-display text-slate-600 dark:text-slate-300">
            Payload de exemplo
          </span>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-navy dark:hover:bg-muted-dark dark:hover:text-purple-300"
          title="Regenerar exemplo"
          aria-label="Regenerar payload de exemplo"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {availableEvents.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {availableEvents.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setEvent(o.value)}
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-display transition ${
                event === o.value
                  ? 'bg-magenta text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-muted-dark dark:text-slate-200 dark:hover:bg-muted-dark/70'
              }`}
            >
              {o.value}
            </button>
          ))}
        </div>
      )}

      {/* V28: entity picker — resolve dados reais de uma entidade do tenant */}
      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-border-dark dark:bg-card-dark">
            <Search className="h-3 w-3 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              placeholder={
                selectedEntity
                  ? `Entidade real: ${selectedEntity.label}`
                  : 'Usar entidade real (opcional — buscar por número, status, etc)'
              }
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400 dark:text-slate-200"
            />
            {selectedEntity && (
              <button
                type="button"
                onClick={() => { setSelectedEntity(null); setSearchQuery(''); }}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-error dark:hover:bg-muted-dark"
                title="Limpar — voltar pra dados sintéticos"
                aria-label="Limpar entidade selecionada"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        {searchOpen && entityCandidates.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg dark:border-border-dark dark:bg-card-dark">
            {entityCandidates.map((entity) => (
              <button
                key={entity.id}
                type="button"
                onClick={() => {
                  setSelectedEntity(entity);
                  setSearchQuery('');
                  setSearchOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-muted-dark"
              >
                <p className="text-xs font-medium dark:text-slate-200">{entity.label}</p>
                {entity.hint && (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">{entity.hint}</p>
                )}
              </button>
            ))}
          </div>
        )}
        {searchOpen && !entitiesLoading && entityCandidates.length === 0 && searchQuery.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border border-slate-200 bg-white p-2 text-[10px] text-slate-500 shadow-lg dark:border-border-dark dark:bg-card-dark dark:text-slate-400">
            Nenhum candidato para "{searchQuery}"
          </div>
        )}
      </div>

      {kind !== 'generic' && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-[10px] text-blue-800 dark:border-blue-900/40 dark:bg-blue-900/15 dark:text-blue-200">
          <AlertCircle className="mr-0.5 inline h-3 w-3" />
          {kind === 'slack'
            ? 'Slack recebe um Block Kit derivado desses dados — não este JSON cru.'
            : 'Teams recebe um MessageCard derivado desses dados — não este JSON cru.'}
        </div>
      )}

      {kind === 'generic' && hasCustomTemplate && (
        <div className="rounded-md border border-purple-200 bg-purple-50 px-2 py-1.5 text-[10px] text-purple-800 dark:border-purple-900/40 dark:bg-purple-900/15 dark:text-purple-200">
          <AlertCircle className="mr-0.5 inline h-3 w-3" />
          Template customizado ativo — o JSON enviado será o resultado da interpolação do template, não o payload bruto abaixo.
        </div>
      )}

      {isLoading && <Skeleton className="h-32" />}
      {error && (
        <p className="rounded-md border border-error/30 bg-error/5 px-2 py-1.5 text-[11px] text-error">
          {error instanceof Error ? error.message : 'Falha ao carregar exemplo'}
        </p>
      )}
      {data && !isLoading && (
        <>
          <pre className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-3 font-mono text-[10px] leading-relaxed text-green-300 dark:border-slate-700">
            {JSON.stringify(data.payload, null, 2)}
          </pre>
          {data.synthetic && (
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              <strong>Sintético:</strong> não foi possível resolver dados reais — campos preenchidos com valores de demonstração.
            </p>
          )}
        </>
      )}
    </div>
  );
}
