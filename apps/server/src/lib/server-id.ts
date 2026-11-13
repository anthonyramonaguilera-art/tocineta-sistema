import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { getServerIdPath } from '../config/paths.js';

let cachedServerId: string | null = null;

const SERVER_ID_HEX_REGEX = /^[0-9a-f]{32}$/i;

export function getServerId(): string {
  if (cachedServerId) {
    return cachedServerId;
  }

  const filePath = getServerIdPath();

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (SERVER_ID_HEX_REGEX.test(content)) {
        cachedServerId = content.toLowerCase();
        return cachedServerId;
      }
    }
  } catch {
    // Si falla la lectura, proceder a generar uno nuevo
  }

  const newId = crypto.randomUUID().replace(/-/g, '').toLowerCase();

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, newId, 'utf-8');
  } catch {
    // Ignorar si falla el disco para no lanzar error
  }

  cachedServerId = newId;
  return cachedServerId;
}

export function resetServerIdCacheForTests(): void {
  cachedServerId = null;
}
