import { SystemHealthResponseSchema, type SystemHealthResponse } from '@tocineta/shared';

export async function fetchSystemHealth(): Promise<SystemHealthResponse> {
  const res = await fetch('/api/system-health', {
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

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('tocineta_token') : null;
  const headers = new Headers(init?.headers || {});

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

  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('tocineta:unauthorized'));
  }

  return response;
}

export async function apiJson<T = unknown>(input: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init);
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.message) errMsg = data.message;
      else if (data?.error) errMsg = data.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(errMsg);
  }
  return res.json() as Promise<T>;
}

