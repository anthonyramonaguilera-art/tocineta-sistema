/**
 * Generador canónico de UUIDv7 (RFC 9562) sin dependencias externas
 * Garantiza orden cronológico por timestamp de 48 bits en milisegundos + aleatoriedad criptográfica
 */
export function generateUuidV7(timestampMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // 48-bit timestamp en milisegundos (bytes 0 a 5)
  bytes[0] = Math.floor(timestampMs / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestampMs / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestampMs / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestampMs / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestampMs / 2 ** 8) & 0xff;
  bytes[5] = timestampMs & 0xff;

  // Versión 7: bits 48..51 = 0b0111 (0x70)
  bytes[6] = (bytes[6] & 0x0f) | 0x70;

  // Variante RFC 9562 / 4122: bits 64..65 = 0b10 (0x80)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function isValidUuid(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}

export function isValidUuidV7(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
}

const IDEMPOTENCY_KEY_REGEX = /^([a-z0-9_-]+):([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

/**
 * Crea una clave de idempotencia estandarizada con formato {entidad}:{uuidv7}
 */
export function createIdempotencyKey(entity: string, uuidV7?: string): string {
  const cleanEntity = entity.trim().toLowerCase();
  if (!cleanEntity || !/^[a-z0-9_-]+$/.test(cleanEntity)) {
    throw new Error(`Nombre de entidad inválido para clave de idempotencia: "${entity}"`);
  }

  const id = uuidV7 ? uuidV7.toLowerCase() : generateUuidV7();
  if (!isValidUuidV7(id)) {
    throw new Error(`El identificador no cumple con el formato UUIDv7: "${id}"`);
  }

  return `${cleanEntity}:${id}`;
}

/**
 * Valida y descompone una clave de idempotencia {entidad}:{uuidv7}
 */
export function parseIdempotencyKey(key: string): { entity: string; uuidV7: string } {
  const match = key.trim().match(IDEMPOTENCY_KEY_REGEX);
  if (!match) {
    throw new Error(`Formato de clave de idempotencia inválido: "${key}". Se esperaba "{entidad}:{uuidv7}".`);
  }
  return {
    entity: match[1].toLowerCase(),
    uuidV7: match[2].toLowerCase()
  };
}

export function isValidIdempotencyKey(key: string): boolean {
  return IDEMPOTENCY_KEY_REGEX.test(key.trim());
}
