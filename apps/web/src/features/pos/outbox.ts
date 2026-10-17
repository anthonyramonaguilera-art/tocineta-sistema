import type { OutboxOrder } from './types.js';

const DB_NAME = 'tocineta_pos_offline';
const DB_VERSION = 1;
const STORE_NAME = 'outbox_orders';

let dbPromise: Promise<IDBDatabase> | null = null;
const listeners: Array<(count: number) => void> = [];

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

/**
 * Worker para reintentar sincronización de pedidos pendientes
 */
let isFlushing = false;

export async function flushOutbox(fallbackToken?: string): Promise<{ sent: number; failed: number }> {
  if (isFlushing) return { sent: 0, failed: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
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
        const token = item.token || fallbackToken || localStorage.getItem('tocineta_session_token');
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
        } else {
          // Error 4xx/5xx del servidor
          item.attempts += 1;
          item.lastError = `Status ${res.status}`;
          await saveOrderToOutbox(item);
          failed++;
        }
      } catch (err: any) {
        // Falló de nuevo por red
        item.attempts += 1;
        item.lastError = err?.message || 'Error de red';
        await saveOrderToOutbox(item);
        failed++;
        break; // Detener reintentos si no hay conexión real
      }
    }
  } finally {
    isFlushing = false;
    notifyCountChange();
  }

  return { sent, failed };
}

// Escuchar eventos globales de reconexión de red
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    flushOutbox();
  });

  // Reintento periódico cada 12 segundos si hay cola
  setInterval(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      getOutboxCount().then(c => {
        if (c > 0) flushOutbox();
      }).catch(() => {});
    }
  }, 12000);
}
