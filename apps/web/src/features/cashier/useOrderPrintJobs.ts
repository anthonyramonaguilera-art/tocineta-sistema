import { apiFetch } from '../../api/client.js';

export interface OrderPrintJob {
  id: string;
  job_type: string;
  station: string | null;
  status: string;
  created_at_ms: number;
}

export function pickOriginalJobs(jobs: OrderPrintJob[]) {
  const originals = jobs
    .filter((j) => j.job_type === 'NOTA_ENTREGA' || j.job_type === 'TICKET_COCINA')
    .sort((a, b) => a.created_at_ms - b.created_at_ms);
  const nota = originals.find((j) => j.job_type === 'NOTA_ENTREGA') ?? null;
  const byStation = new Map<string, OrderPrintJob>();
  for (const j of originals) {
    if (j.job_type !== 'TICKET_COCINA') continue;
    const key = j.station || 'cocina';
    if (!byStation.has(key)) byStation.set(key, j);
  }
  return {
    nota,
    kitchen: Array.from(byStation.entries()).map(([station, job]) => ({ station, job }))
  };
}

export async function fetchOrderPrintJobs(orderId: string): Promise<OrderPrintJob[]> {
  const res = await apiFetch(`/api/print-jobs?orderId=${encodeURIComponent(orderId)}&limit=100`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Error al consultar los comprobantes de la orden');
  return data.data || [];
}
