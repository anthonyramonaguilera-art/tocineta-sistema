import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { loginAs } from './test-helpers.js';
import {
  terminalRegistry,
  clearTerminalRegistry,
  recordHeartbeat,
  isTerminalAlive,
  getTerminalPrinterId,
  listTerminals
} from '../src/modules/printing/terminal-registry.js';

describe('R2 — Registro de Terminales y Rutas de Heartbeat (@tocineta/server)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_terminal_reg_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_terminals.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let cajeraToken: string;
  let adminToken: string;
  const originalEnforce = process.env.ENFORCE_AUTH;

  beforeAll(async () => {
    process.env.ENFORCE_AUTH = 'true';
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    rawDb.prepare('UPDATE users SET must_change_pin = 0').run();

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
    adminToken = (await loginAs(app, 'admin', rawDb)).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (originalEnforce === undefined) {
      delete process.env.ENFORCE_AUTH;
    } else {
      process.env.ENFORCE_AUTH = originalEnforce;
    }
    try {
      const dbCtx = getDatabaseContext();
      if (dbCtx && dbCtx.db) {
        dbCtx.db.close();
      }
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    clearTerminalRegistry();
  });

  it('1. POST /api/terminals/heartbeat sin sesión devuelve 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals/heartbeat',
      payload: {
        terminalId: 'term_pos_01',
        label: 'Caja 1'
      }
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('2. POST /api/terminals/heartbeat con btPrinter crea la fila CLIENT_BT en la base de datos', async () => {
    const terminalId = 'term_pos_01';
    const mac = 'AA:BB:CC:DD:EE:FF';

    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals/heartbeat',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        terminalId,
        label: 'Caja Principal',
        btPrinter: {
          name: 'POS-58-BT',
          mac
        },
        capabilities: {
          bluetoothSpp: true
        }
      }
    });

    expect(res.statusCode).toBe(200);
    const responseBody = res.json();
    expect(responseBody.ok).toBe(true);
    expect(typeof responseBody.serverTimeMs).toBe('number');

    // Verificar en base de datos la fila creada en printers
    const printer = rawDb.prepare('SELECT * FROM printers WHERE id = ?').get(`print_bt_${terminalId}`) as any;
    expect(printer).toBeDefined();
    expect(printer.id).toBe(`print_bt_${terminalId}`);
    expect(printer.connection_type).toBe('CLIENT_BT');
    expect(printer.address).toBe(mac);
    expect(printer.name).toBe('Bluetooth Caja Principal');
    expect(printer.columns).toBe(32);
    expect(printer.codepage).toBe(16);
    expect(printer.has_cutter).toBe(0);
    expect(printer.has_buzzer).toBe(0);
    expect(printer.is_active).toBe(1);
    expect(printer.owner_terminal_id).toBe(terminalId);

    // Verificar helper getTerminalPrinterId
    const foundId = getTerminalPrinterId(rawDb, terminalId);
    expect(foundId).toBe(`print_bt_${terminalId}`);

    // Si cambia el label, actualiza también el name de esa fila
    const updateRes = await app.inject({
      method: 'POST',
      url: '/api/terminals/heartbeat',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        terminalId,
        label: 'Caja Rapida'
      }
    });
    expect(updateRes.statusCode).toBe(200);

    const updatedPrinter = rawDb.prepare('SELECT * FROM printers WHERE id = ?').get(`print_bt_${terminalId}`) as any;
    expect(updatedPrinter.name).toBe('Bluetooth Caja Rapida');
  });

  it('3. isTerminalAlive es true para latido reciente con btPrinter y false con nowMs + 120000 o sin btPrinter', () => {
    const terminalId = 'term_pos_02';
    const now = Date.now();

    // Sin registrar -> false
    expect(isTerminalAlive(terminalId, now)).toBe(false);

    // Registrado sin btPrinter -> false
    recordHeartbeat(rawDb, terminalId, {
      label: 'Terminal Mesero',
      capabilities: { bluetoothSpp: false }
    });
    expect(isTerminalAlive(terminalId, now)).toBe(false);

    // Registrado con btPrinter -> true
    recordHeartbeat(rawDb, terminalId, {
      label: 'Terminal Mesero',
      btPrinter: {
        name: 'BT-Printer',
        mac: '11:22:33:44:55:66'
      },
      capabilities: { bluetoothSpp: true }
    });
    expect(isTerminalAlive(terminalId, now)).toBe(true);

    // Con nowMs + 120000 (> 90000ms TTL) -> false
    expect(isTerminalAlive(terminalId, now + 120_000)).toBe(false);
  });

  it('4. POST /api/terminals/heartbeat con MAC inválida devuelve 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals/heartbeat',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        terminalId: 'term_pos_03',
        btPrinter: {
          name: 'Bad MAC Printer',
          mac: 'NO-A-VALID-MAC'
        }
      }
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('BAD_REQUEST');
  });

  it('5. GET /api/terminals lista el terminal con alive correcto y es 403 para cajera', async () => {
    // 1) Acceso denegado con rol cajera (403)
    const cajeraRes = await app.inject({
      method: 'GET',
      url: '/api/terminals',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(cajeraRes.statusCode).toBe(403);
    expect(cajeraRes.json().code).toBe('FORBIDDEN');

    // 2) Registrar terminal para probar listado
    const terminalId = 'term_pos_04';
    recordHeartbeat(rawDb, terminalId, {
      label: 'Terminal Barra',
      btPrinter: {
        name: 'Impresora Barra',
        mac: 'AA:11:BB:22:CC:33'
      },
      capabilities: { bluetoothSpp: true }
    });

    // 3) Acceso permitido para admin (200) y lista con alive correcto
    const adminRes = await app.inject({
      method: 'GET',
      url: '/api/terminals',
      headers: { authorization: `Bearer ${adminToken}` }
    });

    expect(adminRes.statusCode).toBe(200);
    const terminals = adminRes.json();
    expect(Array.isArray(terminals)).toBe(true);
    const found = terminals.find((t: any) => t.terminalId === terminalId);
    expect(found).toBeDefined();
    expect(found.label).toBe('Terminal Barra');
    expect(found.btPrinter).toEqual({
      name: 'Impresora Barra',
      mac: 'AA:11:BB:22:CC:33'
    });
    expect(found.alive).toBe(true);
    expect(typeof found.lastSeenMs).toBe('number');
  });
});
