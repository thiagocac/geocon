import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Camera, Mic, MapPin, CheckCircle2,
  AlertCircle, Wifi, WifiOff, X, Send, Loader2, Cloud, Inbox,
} from 'lucide-react';
import {
  getMeasurement, listMItems, upsertCalcLine, uploadEvidence, addItemComment,
} from '../lib/api';
import {
  enqueueOperation, processQueue, listPendingOperations, fileToBase64,
  type OfflineOperation,
} from '../lib/offlineQueue';
import type { MItem } from '../lib/types';
import { num } from '../lib/format';
import { humanizeError } from '../lib/errors';
import { PageHeader } from '../components/ui/PageHeader';
import { Empty, Skeleton } from '../components/ui/Stat';

/**
 * V61 — Apontamento de medição em campo (mobile-first).
 *
 * Rota: /contratos/:id/medicoes/:medId/campo
 *
 * Interface otimizada para fiscal em obra com celular:
 *   - 1 item por vez (swipe-cards verticais via prev/next)
 *   - Big touch targets (≥44pt)
 *   - Camera direta (<input capture="environment">) + GPS automático
 *   - Voice-to-text via Web Speech API quando disponível
 *   - Indicador online/offline (sem queue persistente — V62)
 *   - Progress bar do total
 *
 * Não usa Layout normal — mobile fullscreen sem sidebar/topbar tradicional.
 */
export function MeasurementFieldEntry() {
  const { id = '', medId = '' } = useParams();
  const qc = useQueryClient();

  const { data: m } = useQuery({
    queryKey: ['measurement', medId],
    queryFn: () => getMeasurement(medId), enabled: !!medId,
  });
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['mitems', medId],
    queryFn: () => listMItems(medId), enabled: !!medId,
  });

  // Estado de navegação entre items
  const [idx, setIdx] = useState(0);
  const currentItem = items[idx] as MItem | undefined;

  // Estado de "tocou" — quais items foram editados nessa sessão
  const [tocados, setTocados] = useState<Set<string>>(new Set());

  // Online/offline
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [queue, setQueue] = useState<OfflineOperation[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function refreshQueue() {
    const ops = await listPendingOperations();
    setQueue(ops);
  }

  async function runSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await processQueue();
      if (result.attempted > 0) {
        setSyncMsg(`${result.succeeded} sincronizada${result.succeeded === 1 ? '' : 's'}${result.failed ? `, ${result.failed} falha${result.failed === 1 ? '' : 's'}` : ''}.`);
        qc.invalidateQueries({ queryKey: ['mitems', medId] });
      }
      await refreshQueue();
      // Limpa mensagem após 4s
      setTimeout(() => setSyncMsg(null), 4000);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    function up()   { setOnline(true);  runSync(); }
    function down() { setOnline(false); }
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Carrega fila no mount + tenta sync se online
  useEffect(() => {
    refreshQueue();
    if (online) runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling leve a cada 30s quando online + tem fila
  useEffect(() => {
    if (!online || queue.length === 0) return;
    const t = setInterval(() => { runSync(); }, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, queue.length]);

  function navPrev() { setIdx((i) => Math.max(0, i - 1)); }
  function navNext() { setIdx((i) => Math.min(items.length - 1, i + 1)); }
  function markTouched(id: string) { setTocados((prev) => new Set(prev).add(id)); }

  // V67 — swipe horizontal entre itens
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    const dy = e.changedTouches[0].clientY - touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    // só dispara se gesto for predominantemente horizontal e razoavelmente longo
    if (Math.abs(dx) < 60) return;
    if (Math.abs(dy) > Math.abs(dx) * 0.7) return;  // evita conflito com scroll vertical
    if (dx > 0) navPrev();
    else        navNext();
  }

  if (isLoading || !m) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 dark:bg-bg-dark">
        <Skeleton className="h-screen" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 dark:bg-bg-dark">
        <PageHeader
          kicker="Apontamento de campo"
          title="Sem itens nesta medição"
          backTo={`/contratos/${id}/medicoes/${medId}`}
          backLabel="Voltar"
        />
        <Empty title="Adicione itens antes de apontar" />
      </div>
    );
  }

  const progress = ((tocados.size / items.length) * 100).toFixed(0);

  return (
    <div
      className="flex min-h-screen flex-col bg-slate-50 pb-safe dark:bg-bg-dark"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Top bar fixo */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3 dark:border-border-dark dark:bg-card-dark">
        <div className="flex items-center justify-between">
          <Link to={`/contratos/${id}/medicoes/${medId}`} className="-ml-1 flex items-center gap-1 p-1 text-sm font-medium text-slate-600 dark:text-slate-300">
            <X className="h-5 w-5" /> Sair
          </Link>
          <div className="text-center">
            <p className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
              Apontamento · campo
            </p>
            <p className="text-sm font-bold dark:text-slate-100">
              Medição #{m.numero}{m.complementar_numero ? `.${m.complementar_numero}` : ''}
            </p>
          </div>
          <OnlineBadge online={online} />
        </div>
        {/* Progresso */}
        <div className="mt-3 flex items-center gap-2">
          <span className="font-mono tabular text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
            {idx + 1}/{items.length}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-muted-dark">
            <div
              className="h-full bg-success transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="font-mono tabular text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
            {tocados.size} ok
          </span>
        </div>
        {/* V62: fila de sincronização */}
        {queue.length > 0 && (
          <button
            type="button"
            onClick={runSync}
            disabled={syncing || !online}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-warning/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-display text-warning disabled:opacity-50"
          >
            {syncing
              ? <><Loader2 className="h-3 w-3 animate-spin" />Sincronizando…</>
              : <><Cloud className="h-3 w-3" />{queue.length} na fila {online ? '· tocar para sincronizar' : '· aguardando rede'}</>}
          </button>
        )}
        {/* V63: link para inspeção quando há operações falhando */}
        {queue.some((op) => op.retries > 0) && (
          <Link
            to="/medicoes/fila"
            className="mt-1 flex items-center justify-center gap-1 font-mono text-[10px] uppercase tracking-display text-navy dark:text-purple-300"
          >
            <Inbox className="h-3 w-3" />
            Inspecionar fila ({queue.filter((op) => op.retries > 0).length} com falha)
          </Link>
        )}
        {syncMsg && (
          <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-display text-success">
            <CheckCircle2 className="mr-1 inline h-3 w-3" />{syncMsg}
          </p>
        )}
      </header>

      {/* Card do item atual */}
      {currentItem && (
        <FieldItemCard
          key={currentItem.id}
          item={currentItem}
          measurementId={medId}
          touched={tocados.has(currentItem.id)}
          online={online}
          onSaved={() => {
            markTouched(currentItem.id);
            qc.invalidateQueries({ queryKey: ['mitems', medId] });
          }}
          onQueued={() => {
            markTouched(currentItem.id);
            refreshQueue();
          }}
        />
      )}

      {/* Navegação inferior fixa */}
      <nav className="sticky bottom-0 z-10 grid grid-cols-2 gap-px border-t border-slate-200 bg-slate-200 dark:border-border-dark dark:bg-border-dark">
        <button
          type="button"
          onClick={navPrev}
          disabled={idx === 0}
          className="flex items-center justify-center gap-2 bg-white py-4 text-base font-medium text-slate-700 disabled:opacity-30 dark:bg-card-dark dark:text-slate-200"
        >
          <ChevronLeft className="h-5 w-5" />Anterior
        </button>
        <button
          type="button"
          onClick={navNext}
          disabled={idx === items.length - 1}
          className="flex items-center justify-center gap-2 bg-white py-4 text-base font-medium text-slate-700 disabled:opacity-30 dark:bg-card-dark dark:text-slate-200"
        >
          Próximo<ChevronRight className="h-5 w-5" />
        </button>
      </nav>
    </div>
  );
}

// =============================================================================
// Card do item — todos os controles de entrada
// =============================================================================

function FieldItemCard({
  item, measurementId, touched, online, onSaved, onQueued,
}: {
  item: MItem;
  measurementId: string;
  touched: boolean;
  online: boolean;
  onSaved: () => void;
  onQueued?: () => void;
}) {
  const [qty, setQty] = useState<string>(item.quantidade_periodo > 0 ? String(item.quantidade_periodo) : '');
  const [observacao, setObservacao] = useState<string>('');
  const [photos, setPhotos] = useState<Array<{ id: string; url: string; lat?: number; lng?: number; takenAt: string; queued?: boolean }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);

  // Reset quando muda item
  useEffect(() => {
    setQty(item.quantidade_periodo > 0 ? String(item.quantidade_periodo) : '');
    setObservacao('');
    setPhotos([]);
    setErr(null);
  }, [item.id, item.quantidade_periodo]);

  const saldoAntes = item.quantidade_acumulada_antes;
  const contratada = item.quantidade_acumulada_antes + item.saldo_disponivel_snapshot;
  const qtyNum = parseFloat(qty.replace(',', '.')) || 0;

  function getGps() {
    if (!navigator.geolocation) {
      setErr('GPS não disponível neste dispositivo.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (e) => setErr(`GPS: ${e.message}`),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  }

  // Pega GPS automaticamente quando carrega o item (uma vez por item)
  useEffect(() => { getGps(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [item.id]);

  async function onPhotoChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy('photo');
    setErr(null);
    try {
      const takenAt = new Date().toISOString();
      let id: string;
      if (online) {
        id = await uploadEvidence({
          measurement_id: measurementId,
          measurement_item_id: item.id,
          file,
          observacao: observacao || undefined,
          latitude: gps?.lat,
          longitude: gps?.lng,
          taken_at: takenAt,
        });
      } else {
        // V62 — offline: serializa e enfileira
        const file_blob_base64 = await fileToBase64(file);
        id = await enqueueOperation('evidence', {
          measurement_id: measurementId,
          measurement_item_id: item.id,
          file_name: file.name,
          file_type: file.type,
          file_blob_base64,
          observacao: observacao || undefined,
          latitude: gps?.lat,
          longitude: gps?.lng,
          taken_at: takenAt,
        });
      }
      const url = URL.createObjectURL(file);
      setPhotos((p) => [...p, { id, url, lat: gps?.lat, lng: gps?.lng, takenAt, queued: !online }]);
      if (!online) onQueued?.();
    } catch (e) {
      setErr(humanizeError(e as Error));
    } finally {
      setBusy(null);
      e.target.value = '';
    }
  }

  async function onSave() {
    if (qtyNum < 0) { setErr('Quantidade inválida.'); return; }
    setBusy('save');
    setErr(null);
    try {
      if (online) {
        // Online: chama APIs direto
        await upsertCalcLine({
          measurement_item_id: item.id,
          local: gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'campo',
          metodo: 'contagem',
          formula: String(qtyNum),
          variaveis: {},
          quantidade_calculada: qtyNum,
          observacao: observacao || null,
        });
        if (observacao.trim()) {
          await addItemComment({
            measurement_id: measurementId,
            measurement_item_id: item.id,
            body: observacao.trim(),
            kind: 'campo',
          });
        }
      } else {
        // V62 — offline: enfileira
        await enqueueOperation('calc_line', {
          measurement_item_id: item.id,
          local: gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'campo',
          metodo: 'contagem',
          formula: String(qtyNum),
          variaveis: {},
          quantidade_calculada: qtyNum,
          observacao: observacao || null,
        });
        if (observacao.trim()) {
          await enqueueOperation('comment', {
            measurement_id: measurementId,
            measurement_item_id: item.id,
            body: observacao.trim(),
            kind: 'campo',
          });
        }
        onQueued?.();
      }
      onSaved();
    } catch (e) {
      setErr(humanizeError(e as Error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex-1 px-4 py-4 space-y-4">
      {/* Cabeçalho do item */}
      <div>
        <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{item.codigo}</p>
        <h2 className="mt-1 text-lg font-bold leading-tight dark:text-slate-100">
          {item.descricao}
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Unidade: <span className="font-mono uppercase">{item.unidade}</span>
          {' · '}Saldo: <span className="font-mono tabular">{num(item.saldo_disponivel_snapshot, 4)}</span>
        </p>
      </div>

      {/* Input grande de quantidade */}
      <div className="rounded-xl border-2 border-slate-200 bg-white p-4 dark:border-border-dark dark:bg-card-dark">
        <label className="block font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
          Quantidade medida no período
        </label>
        <input
          type="text"
          inputMode="decimal"
          pattern="[0-9.,]*"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="0"
          className="mt-1 w-full bg-transparent font-mono tabular text-4xl font-bold text-slate-900 outline-none dark:text-slate-100"
        />
        {qtyNum > item.saldo_disponivel_snapshot && (
          <p className="mt-1 flex items-center gap-1 text-xs text-warning">
            <AlertCircle className="h-3 w-3" /> Acima do saldo disponível ({num(item.saldo_disponivel_snapshot, 4)})
          </p>
        )}
        <p className="mt-2 font-mono text-[10px] text-slate-500 dark:text-slate-400">
          Acumulado antes: <span className="tabular">{num(saldoAntes, 4)}</span>
          {' · '}contratada: <span className="tabular">{num(contratada, 4)}</span>
        </p>
      </div>

      {/* Foto + GPS */}
      <div className="rounded-xl border-2 border-slate-200 bg-white p-4 dark:border-border-dark dark:bg-card-dark">
        <div className="flex items-center justify-between">
          <label className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
            Evidência fotográfica
          </label>
          {gps && (
            <span className="flex items-center gap-1 font-mono text-[10px] tabular text-success">
              <MapPin className="h-3 w-3" />
              {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}
            </span>
          )}
        </div>

        <label className="mt-2 flex h-14 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-base font-semibold text-slate-700 dark:border-border-dark dark:bg-muted-dark dark:text-slate-200">
          {busy === 'photo' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
          {busy === 'photo' ? 'Enviando…' : 'Tirar foto'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onPhotoChosen}
            disabled={busy !== null}
          />
        </label>

        {photos.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <figure key={p.id} className="relative aspect-square overflow-hidden rounded-lg bg-slate-100 dark:bg-muted-dark">
                <img src={p.url} alt="" className="h-full w-full object-cover" />
                {p.lat && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 font-mono text-[8px] text-white">
                    GPS
                  </span>
                )}
                {p.queued && (
                  <span className="absolute right-1 top-1 rounded bg-warning/90 px-1 font-mono text-[8px] uppercase tracking-display text-white">
                    Fila
                  </span>
                )}
              </figure>
            ))}
          </div>
        )}

        {!gps && (
          <button type="button" onClick={getGps}
                  className="mt-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-display text-navy dark:text-purple-300">
            <MapPin className="h-3 w-3" />Capturar GPS
          </button>
        )}
      </div>

      {/* Observação com voz */}
      <div className="rounded-xl border-2 border-slate-200 bg-white p-4 dark:border-border-dark dark:bg-card-dark">
        <div className="flex items-center justify-between">
          <label className="font-mono text-[10px] uppercase tracking-display text-slate-500 dark:text-slate-400">
            Observação
          </label>
          <VoiceButton onTranscript={(t) => setObservacao((cur) => cur ? `${cur} ${t}` : t)} />
        </div>
        <textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          rows={3}
          placeholder="Ex: Pavimento 2, ala norte. Concretagem concluída até a coluna P-12."
          className="mt-1 w-full resize-none bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
        />
      </div>

      {/* Erro */}
      {err && (
        <div className="rounded-lg bg-error/10 p-3 dark:bg-error/15">
          <p className="flex items-start gap-2 text-sm text-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{err}
          </p>
        </div>
      )}

      {/* Botão Salvar */}
      <button
        type="button"
        onClick={onSave}
        disabled={busy !== null || qty === ''}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-navy text-base font-bold text-white disabled:opacity-50 dark:bg-purple-600"
      >
        {busy === 'save' ? <Loader2 className="h-5 w-5 animate-spin" /> : touched ? <CheckCircle2 className="h-5 w-5" /> : <Send className="h-5 w-5" />}
        {busy === 'save' ? 'Salvando…' : touched ? 'Atualizar item' : 'Salvar item'}
      </button>

      {!online && (
        <p className="text-center text-xs text-warning">
          <WifiOff className="mr-1 inline h-3 w-3" />
          Sem conexão · ao salvar, a operação será guardada na fila e sincronizada quando voltar online
        </p>
      )}
    </main>
  );
}

// =============================================================================
// Sub-componentes
// =============================================================================

function OnlineBadge({ online }: { online: boolean }) {
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-display
        ${online
          ? 'bg-success/15 text-success'
          : 'bg-warning/15 text-warning'}`}
      title={online ? 'Online — alterações sincronizam' : 'Offline — operações falharão'}
    >
      {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
      {online ? 'Online' : 'Offline'}
    </span>
  );
}

/**
 * Botão de gravação por voz. Usa Web Speech API quando disponível.
 * Não disponível em alguns navegadores (Firefox sem flag) — botão fica disabled.
 */
function VoiceButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [supported, setSupported] = useState<boolean>(false);
  const recognitionRef = useRef<unknown>(null);

  // Web Speech API tem ambos os prefixos
  type SpeechRecognitionEvent = { results: Array<Array<{ transcript: string }>> };
  type SpeechRecognitionInstance = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    start(): void;
    stop(): void;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onend: (() => void) | null;
  };
  type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

  useEffect(() => {
    type Win = Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const w = window as Win;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  function toggleRecord() {
    type Win = Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const w = window as Win;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    if (recording) {
      const cur = recognitionRef.current as SpeechRecognitionInstance | null;
      cur?.stop();
      return;
    }
    const recognition = new SR();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      onTranscript(transcript);
    };
    recognition.onerror = () => setRecording(false);
    recognition.onend = () => setRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  }

  if (!supported) return (
    <span className="font-mono text-[10px] text-slate-400">voz não disponível</span>
  );

  return (
    <button
      type="button"
      onClick={toggleRecord}
      className={`flex items-center gap-1 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-display transition-colors
        ${recording
          ? 'bg-error text-white animate-pulse'
          : 'bg-navy/10 text-navy dark:bg-purple-900/30 dark:text-purple-300'}`}
    >
      <Mic className="h-3 w-3" />
      {recording ? 'Gravando…' : 'Ditar'}
    </button>
  );
}
