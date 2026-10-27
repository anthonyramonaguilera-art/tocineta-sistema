import type { BrowserContext, Page, APIRequestContext } from '@playwright/test';
import { TEST_USERS } from './test-constants.js';

export interface AuthSessionData {
  token: string;
  user: {
    id: string;
    name: string;
    role: string;
    permissions?: string[];
  };
}

const sessionCache = new Map<string, AuthSessionData>();

export async function loginAs(
  request: APIRequestContext,
  roleKey: keyof typeof TEST_USERS = 'admin'
): Promise<AuthSessionData> {
  const cached = sessionCache.get(roleKey);
  if (cached) return cached;

  const userDef = TEST_USERS[roleKey];
  if (!userDef) {
    throw new Error(`Rol desconocido: ${roleKey}`);
  }

  const res = await request.post('/api/auth/login', {
    data: {
      username: userDef.username,
      password: userDef.password
    }
  });

  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`Fallo autenticando como ${roleKey}: ${res.status()} - ${text}`);
  }

  const json = await res.json();
  const sessionData: AuthSessionData = {
    token: json.token,
    user: json.user
  };

  sessionCache.set(roleKey, sessionData);
  return sessionData;
}

export async function setupAuthenticatedContext(
  context: BrowserContext,
  session: AuthSessionData
): Promise<void> {
  await context.addInitScript(
    ({ session }) => {
      localStorage.setItem('tocineta_token', session.token);
      localStorage.setItem('tocineta_user', JSON.stringify(session.user));
    },
    { session }
  );
}

export async function navigateAs(
  page: Page,
  roleKey: keyof typeof TEST_USERS,
  path: string = '/#pos'
): Promise<void> {
  const session = await loginAs(page.request, roleKey);
  await setupAuthenticatedContext(page.context(), session);
  await page.goto(path);
  await page.waitForLoadState('domcontentloaded');
}
