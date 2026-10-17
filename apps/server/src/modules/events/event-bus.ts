import type Database from 'better-sqlite3';

export interface DomainEventInput {
  eventType: string;
  entityId: string;
  payload?: Record<string, unknown> | null;
}

export interface DomainEventRecord {
  seq: number;
  eventType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAtMs: number;
}

// Conjunto de sockets WebSocket activos en el Food Truck
const activeSockets = new Set<any>();

export function registerWebSocket(socket: any): void {
  activeSockets.add(socket);
}

export function unregisterWebSocket(socket: any): void {
  activeSockets.delete(socket);
}

export function getActiveSocketCount(): number {
  return activeSockets.size;
}

export function broadcastWs(message: unknown): void {
  const json = JSON.stringify(message);
  for (const socket of activeSockets) {
    try {
      if (socket.readyState === 1 /* OPEN */) {
        socket.send(json);
      }
    } catch {
      activeSockets.delete(socket);
    }
  }
}

/**
 * Publica un evento de dominio secuencial:
 * 1. Lo persiste de forma atómica en SQLite (tabla events_log con autoincrement seq).
 * 2. Lo difunde inmediatamente por WebSocket a todos los teléfonos/pantallas conectados.
 */
export function publishDomainEvent(
  db: Database.Database,
  event: DomainEventInput
): DomainEventRecord {
  const now = Date.now();
  const payload = event.payload ?? {};
  const payloadJson = JSON.stringify(payload);

  const stmt = db.prepare(`
    INSERT INTO events_log (event_type, entity_id, payload_json, created_at_ms)
    VALUES (?, ?, ?, ?)
  `);

  const result = stmt.run(event.eventType, event.entityId, payloadJson, now);
  const seq = Number(result.lastInsertRowid);

  const eventRecord: DomainEventRecord = {
    seq,
    eventType: event.eventType,
    entityId: event.entityId,
    payload,
    createdAtMs: now
  };

  broadcastWs(eventRecord);

  return eventRecord;
}

/**
 * Obtiene el último número de secuencia (seq) registrado en events_log
 */
export function getLatestEventSeq(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(seq) as max_seq FROM events_log').get() as { max_seq: number | null } | undefined;
  return row?.max_seq ?? 0;
}

/**
 * Obtiene eventos ocurridos desde `sinceSeq` para recuperación tras desconexión LAN
 */
export function getEventsSince(
  db: Database.Database,
  sinceSeq: number,
  limit = 500
): { events: DomainEventRecord[]; fullReloadRequired: boolean; latestSeq: number } {
  const latestSeq = getLatestEventSeq(db);

  if (sinceSeq < 0) {
    sinceSeq = 0;
  }

  // Si la brecha de eventos es mayor a limit, forzar recarga completa de estado
  if (latestSeq - sinceSeq > limit) {
    return {
      events: [],
      fullReloadRequired: true,
      latestSeq
    };
  }

  const rows = db.prepare(`
    SELECT seq, event_type, entity_id, payload_json, created_at_ms
    FROM events_log
    WHERE seq > ?
    ORDER BY seq ASC
    LIMIT ?
  `).all(sinceSeq, limit + 1) as Array<{
    seq: number;
    event_type: string;
    entity_id: string;
    payload_json: string;
    created_at_ms: number;
  }>;

  if (rows.length > limit) {
    return {
      events: [],
      fullReloadRequired: true,
      latestSeq
    };
  }

  const events: DomainEventRecord[] = rows.map(r => {
    let payload = {};
    try {
      payload = JSON.parse(r.payload_json);
    } catch {}
    return {
      seq: r.seq,
      eventType: r.event_type,
      entityId: r.entity_id,
      payload,
      createdAtMs: r.created_at_ms
    };
  });

  return {
    events,
    fullReloadRequired: false,
    latestSeq
  };
}
