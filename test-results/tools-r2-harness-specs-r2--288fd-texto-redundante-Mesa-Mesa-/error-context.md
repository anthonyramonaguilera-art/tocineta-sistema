# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tools\r2-harness\specs\r2-defects.spec.ts >> Ronda 2 — 30 Defectos en ROJO (P0-B Harness) >> [B06] No existe en la interfaz el texto redundante "Mesa Mesa"
- Location: tools\r2-harness\specs\r2-defects.spec.ts:104:3

# Error details

```
TypeError: apiRequestContext.post: Invalid URL
```

# Test source

```ts
  1  | import type { BrowserContext, Page, APIRequestContext } from '@playwright/test';
  2  | import { TEST_USERS } from './test-constants.js';
  3  | 
  4  | export interface AuthSessionData {
  5  |   token: string;
  6  |   user: {
  7  |     id: string;
  8  |     name: string;
  9  |     role: string;
  10 |     permissions?: string[];
  11 |   };
  12 | }
  13 | 
  14 | const sessionCache = new Map<string, AuthSessionData>();
  15 | 
  16 | export async function loginAs(
  17 |   request: APIRequestContext,
  18 |   roleKey: keyof typeof TEST_USERS = 'admin'
  19 | ): Promise<AuthSessionData> {
  20 |   const cached = sessionCache.get(roleKey);
  21 |   if (cached) return cached;
  22 | 
  23 |   const userDef = TEST_USERS[roleKey];
  24 |   if (!userDef) {
  25 |     throw new Error(`Rol desconocido: ${roleKey}`);
  26 |   }
  27 | 
> 28 |   const res = await request.post('/api/auth/login', {
     |                             ^ TypeError: apiRequestContext.post: Invalid URL
  29 |     data: {
  30 |       username: userDef.username,
  31 |       password: userDef.password
  32 |     }
  33 |   });
  34 | 
  35 |   if (!res.ok()) {
  36 |     const text = await res.text();
  37 |     throw new Error(`Fallo autenticando como ${roleKey}: ${res.status()} - ${text}`);
  38 |   }
  39 | 
  40 |   const json = await res.json();
  41 |   const sessionData: AuthSessionData = {
  42 |     token: json.token,
  43 |     user: json.user
  44 |   };
  45 | 
  46 |   sessionCache.set(roleKey, sessionData);
  47 |   return sessionData;
  48 | }
  49 | 
  50 | export async function setupAuthenticatedContext(
  51 |   context: BrowserContext,
  52 |   session: AuthSessionData
  53 | ): Promise<void> {
  54 |   await context.addInitScript(
  55 |     ({ session }) => {
  56 |       localStorage.setItem('tocineta_token', session.token);
  57 |       localStorage.setItem('tocineta_user', JSON.stringify(session.user));
  58 |     },
  59 |     { session }
  60 |   );
  61 | }
  62 | 
  63 | export async function navigateAs(
  64 |   page: Page,
  65 |   roleKey: keyof typeof TEST_USERS,
  66 |   path: string = '/#pos'
  67 | ): Promise<void> {
  68 |   const session = await loginAs(page.request, roleKey);
  69 |   await setupAuthenticatedContext(page.context(), session);
  70 |   await page.goto(path);
  71 |   await page.waitForLoadState('domcontentloaded');
  72 | }
  73 | 
```