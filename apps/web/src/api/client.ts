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
