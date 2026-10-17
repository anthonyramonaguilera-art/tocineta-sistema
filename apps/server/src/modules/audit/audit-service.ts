import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import type { AuditEvent } from '../../db/schema.js';

export const GENESIS_HASH = 'GENESIS';

export interface AppendAuditEventParams {
  eventId?: string;
  actorUserId?: string | null;
  authorizerUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown> | unknown[];
  createdAtMs?: number;
}

export function computeEntryHash(
  prevHash: string,
  eventId: string,
  actorUserId: string | null | undefined,
  authorizerUserId: string | null | undefined,
  action: string,
  entityType: string,
  entityId: string,
  payloadJson: string,
  createdAtMs: number
): string {
  const content = [
    prevHash,
    eventId,
    actorUserId || '',
    authorizerUserId || '',
    action,
    entityType,
    entityId,
    payloadJson,
    createdAtMs.toString()
  ].join('|');

  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Agrega un evento a la cadena de auditoría inmutable calculando el eslabón SHA-256
 */
export function appendAuditEvent(
  rawDb: Database.Database,
  params: AppendAuditEventParams
): AuditEvent {
  const eventId = params.eventId || `aud_${generateUuidV7()}`;
  const createdAtMs = params.createdAtMs || Date.now();
  const payloadJson = JSON.stringify(params.payload);

  // Obtener el hash del último eslabón registrado
  const lastRow = rawDb.prepare(`
    SELECT seq, entry_hash 
    FROM audit_events 
    ORDER BY seq DESC 
    LIMIT 1
  `).get() as { seq: number; entry_hash: string } | undefined;

  const prevHash = lastRow ? lastRow.entry_hash : GENESIS_HASH;

  const entryHash = computeEntryHash(
    prevHash,
    eventId,
    params.actorUserId,
    params.authorizerUserId,
    params.action,
    params.entityType,
    params.entityId,
    payloadJson,
    createdAtMs
  );

  const insertStmt = rawDb.prepare(`
    INSERT INTO audit_events (
      event_id, actor_user_id, authorizer_user_id, action,
      entity_type, entity_id, payload_json, created_at_ms,
      prev_hash, entry_hash
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
    )
  `);

  const info = insertStmt.run(
    eventId,
    params.actorUserId || null,
    params.authorizerUserId || null,
    params.action,
    params.entityType,
    params.entityId,
    payloadJson,
    createdAtMs,
    prevHash,
    entryHash
  );

  return {
    seq: Number(info.lastInsertRowid),
    eventId,
    actorUserId: params.actorUserId || null,
    authorizerUserId: params.authorizerUserId || null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    payloadJson,
    createdAtMs,
    prevHash,
    entryHash
  };
}

export interface AuditChainVerificationResult {
  valid: boolean;
  count: number;
  headHash: string | null;
  brokenSeq?: number;
  reason?: string;
}

/**
 * Verifica la integridad criptográfica de la cadena completa de auditoría SHA-256
 */
export function verifyAuditChain(rawDb: Database.Database): AuditChainVerificationResult {
  const rows = rawDb.prepare(`
    SELECT seq, event_id, actor_user_id, authorizer_user_id, action,
           entity_type, entity_id, payload_json, created_at_ms,
           prev_hash, entry_hash
    FROM audit_events
    ORDER BY seq ASC
  `).all() as Array<{
    seq: number;
    event_id: string;
    actor_user_id: string | null;
    authorizer_user_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string;
    payload_json: string;
    created_at_ms: number;
    prev_hash: string;
    entry_hash: string;
  }>;

  if (rows.length === 0) {
    return {
      valid: true,
      count: 0,
      headHash: null
    };
  }

  let expectedPrevHash = GENESIS_HASH;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    // Verificar coincidencia de eslabón previo
    if (r.prev_hash !== expectedPrevHash) {
      return {
        valid: false,
        count: rows.length,
        headHash: rows[rows.length - 1].entry_hash,
        brokenSeq: r.seq,
        reason: `Eslabón roto en seq=${r.seq}: prev_hash esperado "${expectedPrevHash}", encontrado "${r.prev_hash}"`
      };
    }

    // Recalcular hash de la fila
    const recalculated = computeEntryHash(
      r.prev_hash,
      r.event_id,
      r.actor_user_id,
      r.authorizer_user_id,
      r.action,
      r.entity_type,
      r.entity_id,
      r.payload_json,
      r.created_at_ms
    );

    if (recalculated !== r.entry_hash) {
      return {
        valid: false,
        count: rows.length,
        headHash: rows[rows.length - 1].entry_hash,
        brokenSeq: r.seq,
        reason: `Firma corrupta en seq=${r.seq}: entry_hash recalculado "${recalculated}" no coincide con "${r.entry_hash}"`
      };
    }

    expectedPrevHash = r.entry_hash;
  }

  return {
    valid: true,
    count: rows.length,
    headHash: rows[rows.length - 1].entry_hash
  };
}
