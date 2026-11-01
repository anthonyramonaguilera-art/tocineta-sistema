import type { OutboxOrder, OutboxItem } from './types.js';

export type { OutboxOrder, OutboxItem };

const DB_NAME = 'tocineta_pos_offline';
const DB_VERSION = 1;
const STORE_NAME = 'outbox_orders';
const REJECTED_RING_KEY = 'tocineta_outbox_rejected';
const REJECTED_RING_MAX = 20;

let dbPromise: Promise<IDBDatabase> | null = null;
const listeners: Array<(count: number) => void> = [];

function recordOutboxRejected(idempotencyKey: string, status: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(REJECTED_RING_KEY);
    let list: Array<{ idempotencyKey: string; status: number; ts: number }> = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          list = parsed;
        }
      } catch {}
    }
    list.push({ idempotencyKey, status, ts: Date.now() });
    if (list.length > REJECTED_RING_MAX) {
      list = list.slice(list.length - REJECTED_RING_MAX);
    }
    localStorage.setItem(REJECTED_RING_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('[Outbox] Error al registrar orden rechazada en localStorage:', err);
  }
}

export function isNetworkFailure(err: unknown, res?: Response | { status: number }): boolean {
  if (res && (res.status === 502 || res.status === 503 || res.status === 504)) {
    return true;
  }

  // Falso para errores de código (ReferenceError, JSON SyntaxError, RangeError, etc.)
  if (
    err instanceof ReferenceError ||
    err instanceof SyntaxError ||
    err instanceof RangeError
  ) {
    return false;
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }

  if (err instanceof TypeError) {
    const msg = err.message || '';
    if (/cannot read|undefined is not|is not a function|null is not/i.test(msg)) {
      return false;
    }
    return true;
  }

  if (err && typeof err === 'object') {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && /failed to fetch|network|load failed|timeout|aborted/i.test(msg)) {
      return true;
    }
  }

  if (typeof err === 'string' && /failed to fetch|network|load failed|timeout|aborted/i.test(err)) {
    return true;
  }

  return false;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB no está disponible en este entorno'));
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'idempotencyKey' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });

  return dbPromise;
}

export async function saveOrderToOutbox(order: OutboxOrder): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(order);

    req.onsuccess = () => {
      notifyCountChange();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingOutboxOrders(): Promise<OutboxOrder[]> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function removeOrderFromOutbox(idempotencyKey: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(idempotencyKey);

    req.onsuccess = () => {
      notifyCountChange();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getOutboxCount(): Promise<number> {
  try {
    const orders = await getPendingOutboxOrders();
    return orders.length;
  } catch {
    return 0;
  }
}

export function subscribeToOutboxCount(listener: (count: number) => void): () => void {
  listeners.push(listener);
  // Emitir conteo inicial
  getOutboxCount().then(c => listener(c)).catch(() => {});

  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

async function notifyCountChange() {
  const count = await getOutboxCount();
  for (const listener of listeners) {
    try {
      listener(count);
    } catch {}
  }
}

export async function clearOutbox(): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => {
        notifyCountChange();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {}
}

export async function purgeCorruptedOutboxOrders(): Promise<number> {
  try {
    const pending = await getPendingOutboxOrders();
    let purged = 0;
    for (const item of pending) {
      const items = item.payload?.lines ?? item.payload?.items;
      if (
        !item.idempotencyKey ||
        !item.payload ||
        !Array.isArray(items)
      ) {
        await removeOrderFromOutbox(item.idempotencyKey);
        purged++;
      }
    }
    return purged;
  } catch {
    return 0;
  }
}

/**
 * Worker para reintentar sincronización de pedidos pendientes
 */
let isFlushing = false;

export async function flushOutbox(fallbackToken?: string): Promise<{ sent: number; failed: number }> {
  if (isFlushing) return { sent: 0, failed: 0 };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { sent: 0, failed: 0 };
  }

  isFlushing = true;
  let sent = 0;
  let failed = 0;

  try {
    const pending = await getPendingOutboxOrders();
    if (pending.length === 0) return { sent: 0, failed: 0 };

    for (const item of pending) {
      try {
        const activeToken = typeof localStorage !== 'undefined' ? localStorage.getItem('tocineta_token') : null;
        const token = activeToken || fallbackToken || item.token;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Idempotency-Key': item.idempotencyKey
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch('/api/orders', {
          method: 'POST',
          headers,
          body: JSON.stringify(item.payload)
        });

        if (res.ok || res.status === 409) {
          // Si respondió 200/201 (creada) o 409 (ya procesada/idempotente)
          await removeOrderFromOutbox(item.idempotencyKey);
          sent++;
        } else if (res.status === 401 || res.status === 403) {
          // 401, 403 -> CONSERVAR, needsAttention=true, attentionReason='AUTH', no incrementes como definitivo, y break
          item.needsAttention = true;
          item.attentionReason = 'AUTH';
          item.lastError = `Status ${res.status}`;
          await saveOrderToOutbox(item);
          break;
        } else if (res.status === 408 || res.status === 429 || (res.status >= 500 && res.status < 600)) {
          // 408, 429, 5xx -> CONSERVAR, attempts++, lastError, attentionReason 'RATE_LIMIT' (429) o 'SERVER' (5xx); en 429 y 503 haz break
          item.attempts += 1;
          item.lastError = `Status ${res.status}`;
          if (res.status === 429) {
            item.attentionReason = 'RATE_LIMIT';
          } else if (res.status >= 500) {
            item.attentionReason = 'SERVER';
          }
          await saveOrderToOutbox(item);
          failed++;
          if (res.status === 429 || res.status === 503) {
            break;
          }
        } else if (res.status === 400 || res.status === 404 || res.status === 422 || (res.status >= 400 && res.status < 500)) {
          // 400, 404, 422 (rechazo definitivo de payload) -> borrar, failed++, ring en localStorage y console.warn
          recordOutboxRejected(item.idempotencyKey, res.status);
          console.warn(`[Outbox] Descartando pedido rechazado definitivamente por el servidor con status ${res.status}:`, item.idempotencyKey);
          await removeOrderFromOutbox(item.idempotencyKey);
          failed++;
        } else {
          // Código imprevisto: conservar
          item.attempts += 1;
          item.lastError = `Status ${res.status}`;
          await saveOrderToOutbox(item);
          failed++;
        }
      } catch (err: unknown) {
        if (isNetworkFailure(err)) {
          // Excepción de red (isNetworkFailure) -> conservar y break como hoy
          item.attempts += 1;
          item.lastError = err instanceof Error ? err.message : 'Error de red';
          await saveOrderToOutbox(item);
          failed++;
          break; // Detener reintentos si no hay conexión real
        } else {
          // Excepción NO de red -> conservar con lastError y continúa con el siguiente (no pierdas el pedido)
          item.attempts += 1;
          item.lastError = err instanceof Error ? err.message : String(err);
          await saveOrderToOutbox(item);
          failed++;
        }
      }
    }
  } finally {
    isFlushing = false;
    notifyCountChange();
  }

  return { sent, failed };
}

// Escuchar eventos globales de reconexión de red y purgar corruptos al iniciar
if (typeof window !== 'undefined') {
  purgeCorruptedOutboxOrders().catch(() => {});

  window.addEventListener('online', () => {
    void flushOutbox();
  });

  window.addEventListener('tocineta:authenticated', () => {
    void flushOutbox();
  });

  // Reintento periódico cada 12 segundos si hay cola
  setInterval(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      getOutboxCount().then(c => {
        if (c > 0) void flushOutbox();
      }).catch(() => {});
    }
  }, 12000);
}
