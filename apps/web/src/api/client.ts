import { SystemHealthResponseSchema, type SystemHealthResponse } from '@tocineta/shared';

export const TOKEN_KEY = 'tocineta_token';

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  body: any;

  constructor(status: number, body: any, message?: string) {
    super(message || (body?.message || body?.error || `HTTP ${status}`));
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers);

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (
    init?.body &&
    typeof init.body === 'string' &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (
    response.status === 401 &&
    typeof window !== 'undefined' &&
    input !== '/api/auth/login' &&
    input !== '/api/auth/register' &&
    !input.startsWith('/api/auth/login?') &&
    !input.startsWith('/api/auth/register?')
  ) {
    window.dispatchEvent(new CustomEvent('tocineta:unauthorized', { detail: { path: input } }));
  }

  return response;
}

export async function apiJson<T = unknown>(input: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init);
  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      // ignore json parse error
    }
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

export async function fetchSystemHealth(): Promise<SystemHealthResponse> {
  const res = await apiFetch('/api/system-health', {
    headers: {
      'Accept': 'application/json'
    }
  });

  if (!res.ok) {
    throw new Error(`Error HTTP al consultar estado del sistema: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  return SystemHealthResponseSchema.parse(json);
}
