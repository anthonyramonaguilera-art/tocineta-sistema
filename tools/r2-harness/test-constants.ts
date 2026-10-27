import type { UserRole } from '../../apps/server/src/db/schema.js';

export interface TestUserDef {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  pin: string;
  password: string;
}

export const TEST_USERS: Record<string, TestUserDef> = {
  admin: {
    id: 'usr_test_admin',
    username: 'test_admin',
    name: 'ADMIN PRUEBAS',
    role: 'admin',
    pin: '777777',
    password: 'testpassword123'
  },
  supervisor: {
    id: 'usr_test_supervisor',
    username: 'test_supervisor',
    name: 'SUPERVISOR PRUEBAS',
    role: 'supervisor',
    pin: '7555',
    password: 'testpassword123'
  },
  cajera: {
    id: 'usr_test_cajera',
    username: 'test_cajera',
    name: 'CAJERA PRUEBAS',
    role: 'cajera',
    pin: '7111',
    password: 'testpassword123'
  },
  mesero: {
    id: 'usr_test_mesero',
    username: 'test_mesero',
    name: 'MESERO PRUEBAS',
    role: 'mesonero',
    pin: '7222',
    password: 'testpassword123'
  },
  plancha: {
    id: 'usr_test_plancha',
    username: 'test_plancha',
    name: 'PLANCHA PRUEBAS',
    role: 'cocinero',
    pin: '7333',
    password: 'testpassword123'
  },
  despacho: {
    id: 'usr_test_despacho',
    username: 'test_despacho',
    name: 'DESPACHO PRUEBAS',
    role: 'despachador',
    pin: '7444',
    password: 'testpassword123'
  }
};

export const TEST_SCENARIO_CONFIG = {
  defaultDbPath: './data/tocineta.r2-harness.db',
  rateMicroBs: 500_000_000, // 500 Bs/USD
  initialCashUsdCents: 10_000, // $100.00
  initialCashBsCents: 1_000_000, // Bs 10.000 (en centavos = 10,000 * 100)
  jornadaId: 'jor_r2_scenario',
  cashSessionId: 'cs_r2_scenario'
};
