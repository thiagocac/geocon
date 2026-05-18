/**
 * V62 — Fila offline para apontamento de campo.
 *
 * Persiste operações em IndexedDB quando offline e re-tenta quando volta
 * online. Sem libs (no Dexie, no idb) — wrapper minimal sobre IDB nativo.
 *
 * Schema:
 *   DB: 'geocon-offline-queue' v1
 *   Stores:
 *     - 'operations' (keyPath 'id') — operações pendentes
 *
 * Cada operação tem:
 *   id: string (uuid local)
 *   kind: 'calc_line' | 'evidence' | 'comment'
 *   payload: data + metadata necessária
 *   created_at: ISO
 *   retries: number
 *   last_error?: string
 *
 * NÃO usa Service Worker Background Sync (ainda experimental em iOS).
 * Em vez disso, dispara `processQueue()` em:
 *   - mount da página
 *   - evento 'online' do window
 *   - polling a cada 30s quando online
 */

import { upsertCalcLine, uploadEvidence, addItemComment } from './api';

const DB_NAME = 'geocon-offline-queue';
const DB_VERSION = 1;
const STORE = 'operations';

export type OfflineOpKind = 'calc_line' | 'evidence' | 'comment';

export interface OfflineOperation {
  id: string;
  kind: OfflineOpKind;
  payload: Record<string, unknown>;
  created_at: string;
  retries: number;
  last_error?: string;
  /** V67 — hash do payload para dedup. Não inclui campos voláteis (taken_at, file_blob). */
  dedup_key?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB indisponível'));
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * V67 — Calcula hash determinístico do payload, ignorando campos voláteis
 * (taken_at, file_blob_base64). Permite detectar enqueue duplicado.
 *
 * Para evidence, considera apenas measurement_item_id + file_name + size.
 */
function computeDedupKey(kind: OfflineOpKind, payload: Record<string, unknown>): string {
  let relevantKeys: string[] = [];
  switch (kind) {
    case 'calc_line':
      relevantKeys = ['measurement_item_id', 'metodo', 'formula', 'quantidade_calculada'];
      break;
    case 'comment':
      relevantKeys = ['measurement_item_id', 'body', 'kind'];
      break;
    case 'evidence':
      relevantKeys = ['measurement_item_id', 'file_name'];
      // Inclui size do blob para diferenciar fotos iguais por nome
      break;
  }
  const obj: Record<string, unknown> = {};
  for (const k of relevantKeys) obj[k] = payload[k];
  if (kind === 'evidence') {
    const blob = payload.file_blob_base64;
    if (typeof blob === 'string') obj.size = blob.length;
  }
  // Hash simples sjis-style — não criptográfico, só estável dentro do device
  const json = JSON.stringify(obj, Object.keys(obj).sort());
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return `${kind}-${(h >>> 0).toString(36)}`;
}

// =============================================================================
// API pública
// =============================================================================

/**
 * Adiciona uma operação à fila. Retorna o id da operação.
 * NÃO tenta executar imediatamente — o caller que chama processQueue().
 *
 * V67 — Dedup: se já existe operação pendente com mesmo dedup_key (ainda
 * não-sincronizada), **substitui o payload** em vez de criar nova. Evita
 * 2 calc_lines idênticas se usuário salvar 2× offline.
 *
 * Para evidence (fotos), a substituição troca o blob — sempre fica a foto
 * mais recente com mesmo nome do mesmo item.
 *
 * Retorna o id da operação efetivamente persistida (novo ou existente).
 */
export async function enqueueOperation(kind: OfflineOpKind, payload: Record<string, unknown>): Promise<string> {
  const db = await getDb();
  const dedup_key = computeDedupKey(kind, payload);

  // Procura existente
  const existing = await new Promise<OfflineOperation | null>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const list = (req.result as OfflineOperation[]) || [];
      const hit = list.find((o) => o.dedup_key === dedup_key && o.retries < 5);
      resolve(hit || null);
    };
    req.onerror = () => resolve(null);
  });

  if (existing) {
    // Atualiza payload + reset retries + retorna id existente
    existing.payload = payload;
    existing.retries = 0;
    existing.last_error = undefined;
    await updateOperation(existing);
    return existing.id;
  }

  const op: OfflineOperation = {
    id: uuid(),
    kind,
    payload,
    created_at: new Date().toISOString(),
    retries: 0,
    dedup_key,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(op);
    tx.oncomplete = () => resolve(op.id);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Lista todas as operações pendentes.
 */
export async function listPendingOperations(): Promise<OfflineOperation[]> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as OfflineOperation[])
        .sort((a, b) => a.created_at.localeCompare(b.created_at)));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function deleteOperation(id: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function updateOperation(op: OfflineOperation): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(op);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Executa 1 operação chamando o endpoint apropriado.
 */
async function executeOperation(op: OfflineOperation): Promise<void> {
  switch (op.kind) {
    case 'calc_line':
      await upsertCalcLine(op.payload as Parameters<typeof upsertCalcLine>[0]);
      break;
    case 'comment':
      await addItemComment(op.payload as Parameters<typeof addItemComment>[0]);
      break;
    case 'evidence': {
      // payload tem { ...evidenceArgs, file_blob_base64 } — desserializa o blob
      const p = op.payload as {
        measurement_id: string;
        measurement_item_id: string;
        file_name: string;
        file_type: string;
        file_blob_base64: string;
        observacao?: string;
        latitude?: number;
        longitude?: number;
        taken_at?: string;
      };
      const bytes = atob(p.file_blob_base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const file = new File([arr], p.file_name, { type: p.file_type });
      await uploadEvidence({
        measurement_id: p.measurement_id,
        measurement_item_id: p.measurement_item_id,
        file,
        observacao: p.observacao,
        latitude: p.latitude,
        longitude: p.longitude,
        taken_at: p.taken_at,
      });
      break;
    }
    default:
      throw new Error(`Tipo de operação desconhecido: ${op.kind}`);
  }
}

let processing = false;

/**
 * Tenta processar todas as operações pendentes em ordem cronológica.
 * Idempotente: se já está processando, retorna imediatamente.
 *
 * Em caso de falha de 1 operação, incrementa retries e continua com a próxima.
 * Após 5 retries falhos, mantém na fila (operador resolve manualmente).
 */
export async function processQueue(): Promise<{
  attempted: number; succeeded: number; failed: number; remaining: number;
}> {
  if (processing) return { attempted: 0, succeeded: 0, failed: 0, remaining: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { attempted: 0, succeeded: 0, failed: 0, remaining: (await listPendingOperations()).length };
  }

  processing = true;
  let succeeded = 0, failed = 0, attempted = 0;
  try {
    const ops = await listPendingOperations();
    for (const op of ops) {
      if (op.retries >= 5) continue;
      attempted++;
      try {
        await executeOperation(op);
        await deleteOperation(op.id);
        succeeded++;
      } catch (e) {
        op.retries = (op.retries || 0) + 1;
        op.last_error = (e as Error).message;
        await updateOperation(op);
        failed++;
      }
    }
    const remaining = (await listPendingOperations()).length;
    return { attempted, succeeded, failed, remaining };
  } finally {
    processing = false;
  }
}

/**
 * Reseta retries para 0 numa operação (para retry manual após falha).
 */
export async function resetOperationRetries(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const req = store.get(id);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const op = req.result as OfflineOperation | undefined;
      if (op) {
        op.retries = 0;
        op.last_error = undefined;
        store.put(op);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Remove uma operação da fila sem executar (descarte manual).
 */
export async function discardOperation(id: string): Promise<void> {
  return deleteOperation(id);
}

/**
 * Helper para serializar File em base64 (necessário para evidence offline).
 * IndexedDB suporta Blob, mas alguns navegadores móveis perdem a referência;
 * base64 é mais seguro embora ocupe ~33% mais espaço.
 */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result = "data:image/jpeg;base64,XXX..." — extrai só o base64
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// =============================================================================
// V67 — Storage Quota
// =============================================================================
// Permite UI mostrar uso de IndexedDB. Útil para alertar fiscal antes de
// encher quota do dispositivo (Safari iOS = 1 GB, Chrome Android = 60% do
// disco livre, etc).
// =============================================================================

export interface StorageQuotaInfo {
  /** Bytes usados pela origin (todos os tipos de storage) */
  usage: number;
  /** Bytes disponíveis no quota */
  quota: number;
  /** Percentual usado (0–100) */
  usage_pct: number;
  /** True se navegador suporta navigator.storage.estimate() */
  supported: boolean;
}

export async function getStorageQuotaInfo(): Promise<StorageQuotaInfo> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usage: 0, quota: 0, usage_pct: 0, supported: false };
  }
  try {
    const est = await navigator.storage.estimate();
    const usage = est.usage || 0;
    const quota = est.quota || 0;
    return {
      usage,
      quota,
      usage_pct: quota > 0 ? +((usage * 100) / quota).toFixed(2) : 0,
      supported: true,
    };
  } catch {
    return { usage: 0, quota: 0, usage_pct: 0, supported: false };
  }
}
