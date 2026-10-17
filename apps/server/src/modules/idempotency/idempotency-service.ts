import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { isValidIdempotencyKey } from '@tocineta/shared';
import type { IdempotencyRecord } from '../../db/schema.js';

export const IDEMPOTENCY_TTL_MS = 72 * 3600 * 1000; // 72 horas

export function computeRequestHash(method: string, route: string, body: unknown): string {
  const normalizedMethod = method.toUpperCase();
  const normalizedRoute = route.split('?')[0].toLowerCase();
  const payloadString = body !== undefined && body !== null ? JSON.stringify(body) : '';
  const payload = `${normalizedMethod}:${normalizedRoute}:${payloadString}`;

  return crypto.createHash('sha256').update(payload).digest('hex');
}

export interface CheckIdempotencyResult {
  isCached: boolean;
  isConflict: boolean;
  cachedResponse?: {
    statusCode: number;
    body: unknown;
  };
  requestHash: string;
}

export function checkIdempotency(
  rawDb: Database.Database,
  idempotencyKey: string,
  method: string,
  route: string,
  body: unknown,
  nowUtcMs = Date.now()
): CheckIdempotencyResult {
  const requestHash = computeRequestHash(method, route, body);

  if (!isValidIdempotencyKey(idempotencyKey)) {
    throw new Error(`Clave de idempotencia inválida: "${idempotencyKey}". Debe cumplir el formato {entidad}:{uuidv7}`);
  }

  const existing = rawDb.prepare(`
    SELECT idempotency_key, method, route, request_hash, status_code, response_json, expires_at_ms
    FROM idempotency_keys
    WHERE idempotency_key = ?
  `).get(idempotencyKey) as {
    idempotency_key: string;
    method: string;
    route: string;
    request_hash: string;
    status_code: number;
    response_json: string;
    expires_at_ms: number;
  } | undefined;

  if (!existing) {
    return { isCached: false, isConflict: false, requestHash };
  }

  // Si ya expiró, se puede reutilizar o sobreescribir
  if (existing.expires_at_ms <= nowUtcMs) {
    return { isCached: false, isConflict: false, requestHash };
  }

  // Si el hash coincide, devolver respuesta en caché
  if (existing.request_hash === requestHash) {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(existing.response_json);
    } catch {
      parsedBody = existing.response_json;
    }

    return {
      isCached: true,
      isConflict: false,
      cachedResponse: {
        statusCode: existing.status_code,
        body: parsedBody
      },
      requestHash
    };
  }

  // Conflicto: misma clave enviada con payload diferente
  return {
    isCached: false,
    isConflict: true,
    requestHash
  };
}

export function saveIdempotentResponse(
  rawDb: Database.Database,
  idempotencyKey: string,
  method: string,
  route: string,
  requestHash: string,
  statusCode: number,
  responseBody: unknown,
  nowUtcMs = Date.now(),
  ttlMs = IDEMPOTENCY_TTL_MS
): IdempotencyRecord {
  const expiresAtMs = nowUtcMs + ttlMs;
  const responseJson = JSON.stringify(responseBody);

  rawDb.prepare(`
    INSERT INTO idempotency_keys (
      idempotency_key, method, route, request_hash,
      status_code, response_json, created_at_ms, expires_at_ms
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?
    )
    ON CONFLICT(idempotency_key) DO UPDATE SET
      method = excluded.method,
      route = excluded.route,
      request_hash = excluded.request_hash,
      status_code = excluded.status_code,
      response_json = excluded.response_json,
      created_at_ms = excluded.created_at_ms,
      expires_at_ms = excluded.expires_at_ms
  `).run(
    idempotencyKey,
    method.toUpperCase(),
    route.split('?')[0].toLowerCase(),
    requestHash,
    statusCode,
    responseJson,
    nowUtcMs,
    expiresAtMs
  );

  return {
    idempotencyKey,
    method: method.toUpperCase(),
    route: route.split('?')[0].toLowerCase(),
    requestHash,
    statusCode,
    responseJson,
    createdAtMs: nowUtcMs,
    expiresAtMs
  };
}
