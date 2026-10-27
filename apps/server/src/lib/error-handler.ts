import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './app-error.js';
import { getDatabaseContext } from '../db/connection.js';
import { extractSessionToken, hashToken } from '../routes/auth.js';

/**
 * Redacta claves sensibles en objetos anidados para auditoría segura.
 */
export function redactSensitiveData(data: unknown): unknown {
  if (!data || typeof data !== 'object') {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item));
  }
  const sensitiveKeys = new Set(['pin', 'password', 'token', 'authorization', 'secret']);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      result[key] = '***REDACTED***';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitiveData(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export interface ClassifiedErrorInfo {
  status: number;
  code: string;
  message: string;
  field?: string;
  isInternal: boolean;
}

/**
 * Clasifica y mapea excepciones hacia códigos HTTP y códigos de error estándar.
 */
export function classifyError(error: any): ClassifiedErrorInfo {
  if (error instanceof AppError) {
    return {
      status: error.httpStatus,
      code: error.code,
      message: error.message,
      field: error.field,
      isInternal: error.httpStatus >= 500
    };
  }

  const rawMessage = typeof error?.message === 'string' ? error.message : '';
  const rawCode = typeof error?.code === 'string' ? error.code : '';

  // 1. Mapeo SQLite: FOREIGN KEY constraint failed -> 409 REFERENCE_MISSING
  if (rawCode === 'SQLITE_CONSTRAINT_FOREIGNKEY' || rawMessage.includes('FOREIGN KEY constraint failed')) {
    return {
      status: 409,
      code: 'REFERENCE_MISSING',
      message: 'El registro referenciado no existe o no se puede eliminar porque tiene datos vinculados',
      isInternal: false
    };
  }

  // 2. Mapeo SQLite: UNIQUE constraint failed -> 409 DUPLICATE
  if (
    rawCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    rawCode === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    rawMessage.includes('UNIQUE constraint failed') ||
    rawMessage.includes('PRIMARY KEY constraint failed')
  ) {
    return {
      status: 409,
      code: 'DUPLICATE',
      message: 'Ya existe un registro con estos datos únicos',
      isInternal: false
    };
  }

  // 3. Mapeo SQLite: CHECK constraint failed -> 422 INVALID_VALUE
  if (rawCode === 'SQLITE_CONSTRAINT_CHECK' || rawMessage.includes('CHECK constraint failed')) {
    return {
      status: 422,
      code: 'INVALID_VALUE',
      message: 'El valor proporcionado no cumple con las restricciones de validación',
      isInternal: false
    };
  }

  // 4. Mapeo SQLite: NOT NULL constraint failed -> 422 FIELD_REQUIRED con field = columna
  if (rawCode === 'SQLITE_CONSTRAINT_NOTNULL' || rawMessage.includes('NOT NULL constraint failed')) {
    const match = rawMessage.match(/NOT NULL constraint failed:\s*(?:[\w]+\.)?([\w]+)/i);
    const field = match ? match[1] : undefined;
    return {
      status: 422,
      code: 'FIELD_REQUIRED',
      message: field ? `El campo '${field}' es obligatorio` : 'El campo es obligatorio',
      field,
      isInternal: false
    };
  }

  // 5. Errores de validación de esquemas Fastify -> 400 VALIDATION_ERROR
  if (
    error.validation ||
    rawCode === 'FST_ERR_VALIDATION' ||
    (error.statusCode === 400 && error.name === 'ValidationError')
  ) {
    const field =
      error.validation?.[0]?.params?.missingProperty ||
      error.validation?.[0]?.instancePath?.replace(/^\//, '') ||
      undefined;
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: error.message || 'Error de validación en la solicitud',
      field,
      isInternal: false
    };
  }

  // 6. Errores HTTP con status < 500
  if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
    let defaultCode = 'BAD_REQUEST';
    if (error.statusCode === 401) defaultCode = 'UNAUTHORIZED';
    else if (error.statusCode === 403) defaultCode = 'FORBIDDEN';
    else if (error.statusCode === 404) defaultCode = 'NOT_FOUND';
    else if (error.statusCode === 409) defaultCode = 'CONFLICT';
    else if (error.statusCode === 422) defaultCode = 'UNPROCESSABLE_ENTITY';

    return {
      status: error.statusCode,
      code: rawCode || defaultCode,
      message: rawMessage || 'Solicitud inválida',
      isInternal: false
    };
  }

  // 7. Lo demás -> 500 INTERNAL
  return {
    status: 500,
    code: 'INTERNAL',
    message: 'Error interno del servidor',
    isInternal: true
  };
}

/**
 * Manejador global de errores para Fastify (server.setErrorHandler).
 * Garantiza respuesta JSON estructurada y registro auditado en server_errors.
 */
export async function globalErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const info = classifyError(error);

  // Registro en tabla server_errors
  try {
    const dbCtx = getDatabaseContext();
    const rawDb = dbCtx.rawDb;

    const redactedBody = redactSensitiveData(request.body);
    const bodyJson = redactedBody !== undefined ? JSON.stringify(redactedBody) : null;

    let userId: string | null = null;
    const authHeader = request.headers.authorization;
    if (authHeader) {
      try {
        const rawToken = extractSessionToken(authHeader);
        if (rawToken) {
          const tokenHash = hashToken(rawToken);
          const row = rawDb
            .prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at_ms > ?')
            .get(tokenHash, Date.now()) as { user_id: string } | undefined;
          if (row) userId = row.user_id;
        }
      } catch {}
    }

    const errId = `serr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    rawDb.prepare(`
      INSERT INTO server_errors (
        id, request_id, method, url, status, code, message, stack, body_json, user_id, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      errId,
      String(request.id),
      request.method,
      request.url,
      info.status,
      info.code,
      error?.message || info.message,
      error?.stack || null,
      bodyJson,
      userId,
      now
    );

    // Retener exclusivamente los últimos 500 registros
    rawDb.prepare(`
      DELETE FROM server_errors
      WHERE id NOT IN (
        SELECT id FROM server_errors
        ORDER BY created_at_ms DESC, rowid DESC
        LIMIT 500
      )
    `).run();
  } catch (logErr) {
    request.log.error({ err: logErr }, 'No se pudo guardar server_error en SQLite');
  }

  // Respuesta al cliente: NUNCA enviar stack ni SQL
  const payload: Record<string, unknown> = {
    success: false,
    error: info.message,
    code: info.code,
    message: info.message,
    requestId: request.id
  };

  if (info.field) {
    payload.field = info.field;
  }

  return reply.status(info.status).send(payload);
}
