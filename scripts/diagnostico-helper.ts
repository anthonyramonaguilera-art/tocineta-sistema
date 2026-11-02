/**
 * SISTEMA OPERATIVO LOCAL TOCINETA
 * Helper para Extracción de Diagnóstico del Sistema (R1)
 *
 * TAREA 2:
 * - Extrae los últimos 50 errores de server_errors sin PINs ni datos personales.
 * - Copia los logs de las últimas 24 horas de apps/server/logs.
 * - Lee la versión actual del sistema de package.json.
 * - Deposita los artefactos sanitizados en la carpeta de staging para el empaquetado .zip.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import DatabaseConstructor from 'better-sqlite3';

interface CliOptions {
  stageDir?: string;
  dbPath?: string;
  envPath?: string;
  logsDir?: string;
}

function parseCliArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stage' && args[i + 1]) {
      opts.stageDir = args[++i];
    } else if (args[i] === '--db' && args[i + 1]) {
      opts.dbPath = args[++i];
    } else if (args[i] === '--env' && args[i + 1]) {
      opts.envPath = args[++i];
    } else if (args[i] === '--logs' && args[i + 1]) {
      opts.logsDir = args[++i];
    }
  }
  return opts;
}

function loadEnvFile(envPath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return result;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq !== -1) {
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  }
  return result;
}

const SENSITIVE_KEY_PATTERNS = [
  'pin',
  'password',
  'token',
  'secret',
  'authorization',
  'auth',
  'jwt',
  'credit_card',
  'tarjeta',
  'phone',
  'telefono',
  'celular',
  'cedula',
  'dni',
  'ci'
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pat) => lower.includes(pat));
}

function sanitizeString(val: string): string {
  if (!val) return val;
  let sanitized = val;

  // Sanitizar parámetros sensibles en URLs
  sanitized = sanitized.replace(
    /([?&](?:pin|password|token|auth|secret|adminPin)=)[^&\s]+/gi,
    '$1***REDACTED***'
  );

  // Sanitizar pares clave-valor tipo JSON embebidos en cadenas
  sanitized = sanitized.replace(
    /"(pin|adminPin|oldPin|newPin|password|token|secret|authorization|pin_hash|pin_salt)"\s*:\s*(?:"[^"]*"|\d+)/gi,
    '"$1":"***REDACTED***"'
  );

  // Sanitizar frases como "pin: 123456" o "PIN = 1234"
  sanitized = sanitized.replace(
    /\b(pin|adminPin|password|token)\s*[:=]\s*\S+/gi,
    '$1: ***REDACTED***'
  );

  return sanitized;
}

function sanitizeJsonObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeJsonObject);
  }

  if (typeof obj === 'object') {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (isSensitiveKey(k)) {
        clean[k] = '***REDACTED***';
      } else if (typeof v === 'object' && v !== null) {
        clean[k] = sanitizeJsonObject(v);
      } else if (typeof v === 'string') {
        clean[k] = sanitizeString(v);
      } else {
        clean[k] = v;
      }
    }
    return clean;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  return obj;
}

function sanitizeJsonField(rawJson: string | null | undefined): any {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson);
    return sanitizeJsonObject(parsed);
  } catch {
    return sanitizeString(rawJson);
  }
}

function sanitizeErrorRecord(row: any) {
  return {
    id: row.id,
    requestId: row.request_id,
    method: row.method,
    url: sanitizeString(row.url || ''),
    status: row.status,
    code: row.code,
    message: sanitizeString(row.message || ''),
    stack: row.stack ? sanitizeString(row.stack) : null,
    body: sanitizeJsonField(row.body_json),
    userId: row.user_id ? sanitizeString(row.user_id) : null,
    createdAtMs: row.created_at_ms,
    createdAtIso: row.created_at_ms ? new Date(row.created_at_ms).toISOString() : null
  };
}

export function generateDiagnosticArtifacts(options: CliOptions) {
  const repoRoot = path.resolve(process.cwd());
  const envFile = options.envPath ? path.resolve(options.envPath) : path.resolve(repoRoot, '.env');
  const fileEnv = loadEnvFile(envFile);

  const stageDir = path.resolve(
    options.stageDir || path.resolve(repoRoot, './data/temp/diagnostic-staging')
  );

  if (!fs.existsSync(stageDir)) {
    fs.mkdirSync(stageDir, { recursive: true });
  }

  const dbPath = path.resolve(
    options.dbPath || process.env.DB_PATH || fileEnv.DB_PATH || './data/tocineta.db'
  );

  const logsDir = path.resolve(
    options.logsDir || path.resolve(repoRoot, 'apps/server/logs')
  );

  console.log(`[DIAGNOSTICO] Generando artefactos en: ${stageDir}`);

  // 1. Versión del sistema (package.json)
  const pkgPath = path.resolve(repoRoot, 'package.json');
  let pkgVersion = '1.0.0';
  let pkgName = 'tocineta';
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      pkgVersion = pkg.version || pkgVersion;
      pkgName = pkg.name || pkgName;
    } catch {}
  }

  const sistemaInfo = {
    sistema: 'TOCINETA',
    nombrePaquete: pkgName,
    version: pkgVersion,
    fechaDiagnosticoIso: new Date().toISOString(),
    fechaDiagnosticoMs: Date.now(),
    nodeVersion: process.version,
    plataforma: process.platform,
    arquitectura: process.arch,
    memoriaUsoMb: Math.round(process.memoryUsage().rss / (1024 * 1024))
  };

  fs.writeFileSync(
    path.join(stageDir, 'sistema-info.json'),
    JSON.stringify(sistemaInfo, null, 2),
    'utf-8'
  );
  console.log(`- Version del sistema documentada (${pkgVersion})`);

  // 2. Extraer últimos 50 errores de server_errors (sin PINs ni datos personales)
  let sanitizedErrors: any[] = [];
  if (fs.existsSync(dbPath)) {
    let db: any = null;
    try {
      db = new DatabaseConstructor(dbPath, { readonly: true });
      db.pragma('busy_timeout = 3000');

      const rawErrors = db.prepare(`
        SELECT id, request_id, method, url, status, code, message, stack, body_json, user_id, created_at_ms
        FROM server_errors
        ORDER BY created_at_ms DESC
        LIMIT 50
      `).all();

      sanitizedErrors = rawErrors.map(sanitizeErrorRecord);
    } catch (dbErr: any) {
      console.warn(`[AVISO] No se pudo leer la tabla server_errors: ${dbErr.message}`);
    } finally {
      if (db) {
        try { db.close(); } catch {}
      }
    }
  } else {
    console.warn(`[AVISO] Archivo de base de datos no encontrado en: ${dbPath}`);
  }

  fs.writeFileSync(
    path.join(stageDir, 'server-errors.json'),
    JSON.stringify(sanitizedErrors, null, 2),
    'utf-8'
  );
  console.log(`- ${sanitizedErrors.length} errores sanitizados guardados en server-errors.json`);

  // 3. Logs de las últimas 24 horas de apps/server/logs
  const targetLogsDir = path.join(stageDir, 'logs');
  if (!fs.existsSync(targetLogsDir)) {
    fs.mkdirSync(targetLogsDir, { recursive: true });
  }

  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  let copiedLogsCount = 0;

  if (fs.existsSync(logsDir)) {
    try {
      const files = fs.readdirSync(logsDir);
      for (const file of files) {
        const fullPath = path.join(logsDir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile() && stat.mtimeMs >= twentyFourHoursAgo) {
            fs.copyFileSync(fullPath, path.join(targetLogsDir, file));
            copiedLogsCount++;
          }
        } catch {}
      }
    } catch (readErr: any) {
      console.warn(`[AVISO] Error al leer directorio de logs: ${readErr.message}`);
    }
  }

  if (copiedLogsCount === 0) {
    fs.writeFileSync(
      path.join(targetLogsDir, 'sin-logs-recientes.txt'),
      'No se registraron archivos de logs con modificaciones en las ultimas 24 horas.',
      'utf-8'
    );
    console.log(`- Carpeta de logs inicializada (sin archivos recientes en las ultimas 24h)`);
  } else {
    console.log(`- ${copiedLogsCount} archivo(s) de log de las ultimas 24 horas copiados`);
  }

  return {
    stageDir,
    errorsCount: sanitizedErrors.length,
    logsCount: copiedLogsCount,
    version: pkgVersion
  };
}

if (process.argv[1] && process.argv[1].endsWith('diagnostico-helper.ts')) {
  try {
    const opts = parseCliArgs();
    generateDiagnosticArtifacts(opts);
    process.exit(0);
  } catch (err: any) {
    console.error('[ERROR CRITICO EN DIAGNOSTICO HELPER]', err.message);
    process.exit(1);
  }
}
