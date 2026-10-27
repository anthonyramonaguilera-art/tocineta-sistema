import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';

export interface LocationRecord {
  id: string;
  name: string;
  type: 'production' | 'sale' | 'mixed';
  isActive: boolean;
  address?: string | null;
  phone?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export const OFFICIAL_LOCATIONS = [
  {
    id: 'loc_los_olivos',
    name: 'Sede A: Los Olivos',
    type: 'mixed' as const,
    isActive: 1,
    address: 'Los Olivos, Puerto Ordaz',
    phone: '0424-9000001'
  },
  {
    id: 'loc_alta_vista',
    name: 'Sede B: Alta Vista',
    type: 'sale' as const,
    isActive: 1,
    address: 'Detrás de Torre Movistar, Alta Vista, Puerto Ordaz',
    phone: '0424-9728209'
  },
  {
    id: 'sede_alta_vista',
    name: 'Sede B: Alta Vista (Alias)',
    type: 'sale' as const,
    isActive: 1,
    address: 'Detrás de Torre Movistar, Alta Vista, Puerto Ordaz',
    phone: '0424-9728209'
  }
];

export function ensureOfficialLocations(rawDb: Database.Database): void {
  const now = Date.now();
  const insertStmt = rawDb.prepare(`
    INSERT OR IGNORE INTO locations (id, name, type, is_active, address, phone, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const loc of OFFICIAL_LOCATIONS) {
    insertStmt.run(loc.id, loc.name, loc.type, loc.isActive, loc.address, loc.phone, now, now);
  }
}

export function getAllLocations(rawDb: Database.Database, onlyActive = false): LocationRecord[] {
  ensureOfficialLocations(rawDb);
  const sql = onlyActive
    ? 'SELECT * FROM locations WHERE is_active = 1 ORDER BY name ASC'
    : 'SELECT * FROM locations ORDER BY name ASC';
  
  const rows = rawDb.prepare(sql).all() as any[];
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    type: r.type,
    isActive: Boolean(r.is_active),
    address: r.address,
    phone: r.phone,
    createdAtMs: r.created_at_ms,
    updatedAtMs: r.updated_at_ms
  }));
}

export function getLocationById(rawDb: Database.Database, id: string): LocationRecord | null {
  ensureOfficialLocations(rawDb);
  const row = rawDb.prepare('SELECT * FROM locations WHERE id = ?').get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    isActive: Boolean(row.is_active),
    address: row.address,
    phone: row.phone,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

export function createLocation(
  rawDb: Database.Database,
  input: { id?: string; name: string; type: 'production' | 'sale' | 'mixed'; address?: string; phone?: string }
): LocationRecord {
  const id = input.id || `loc_${generateUuidV7()}`;
  const now = Date.now();
  rawDb.prepare(`
    INSERT INTO locations (id, name, type, is_active, address, phone, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `).run(id, input.name.trim(), input.type, input.address || null, input.phone || null, now, now);

  return getLocationById(rawDb, id)!;
}

export function updateLocation(
  rawDb: Database.Database,
  id: string,
  input: { name?: string; type?: 'production' | 'sale' | 'mixed'; isActive?: boolean; address?: string; phone?: string }
): LocationRecord {
  const loc = getLocationById(rawDb, id);
  if (!loc) {
    const err: any = new Error(`Sede '${id}' no encontrada`);
    err.statusCode = 404;
    throw err;
  }

  const newName = input.name !== undefined ? input.name.trim() : loc.name;
  const newType = input.type !== undefined ? input.type : loc.type;
  const newActive = input.isActive !== undefined ? (input.isActive ? 1 : 0) : (loc.isActive ? 1 : 0);
  const newAddress = input.address !== undefined ? input.address : loc.address;
  const newPhone = input.phone !== undefined ? input.phone : loc.phone;
  const now = Date.now();

  rawDb.prepare(`
    UPDATE locations
    SET name = ?, type = ?, is_active = ?, address = ?, phone = ?, updated_at_ms = ?
    WHERE id = ?
  `).run(newName, newType, newActive, newAddress, newPhone, now, id);

  return getLocationById(rawDb, id)!;
}

export function getUserLocations(rawDb: Database.Database, userId: string): {
  defaultLocationId: string;
  allowedLocationIds: string[];
  locations: LocationRecord[];
} {
  ensureOfficialLocations(rawDb);
  const user = rawDb.prepare('SELECT default_location_id, allowed_locations_json FROM users WHERE id = ?').get(userId) as any;
  const defaultLocId = user?.default_location_id || 'loc_alta_vista';
  let allowedIds: string[] = ['loc_los_olivos', 'loc_alta_vista'];
  
  if (user?.allowed_locations_json) {
    try {
      allowedIds = JSON.parse(user.allowed_locations_json);
    } catch {
      // fallback
    }
  }

  const allLocs = getAllLocations(rawDb, false);
  return {
    defaultLocationId: defaultLocId,
    allowedLocationIds: allowedIds,
    locations: allLocs
  };
}

export function setUserLocations(
  rawDb: Database.Database,
  userId: string,
  defaultLocationId: string,
  allowedLocationIds: string[]
): void {
  rawDb.prepare(`
    UPDATE users
    SET default_location_id = ?,
        allowed_locations_json = ?,
        updated_at_ms = ?
    WHERE id = ?
  `).run(defaultLocationId, JSON.stringify(allowedLocationIds), Date.now(), userId);
}
