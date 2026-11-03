import { useInfiniteQuery } from '@tanstack/react-query';
import { apiJson } from '../../api/client.js';

export interface MethodCountHistoryItem {
  method: string;
  currency: string;
  expectedCents: number;
  countedCents: number;
  diffCents: number;
}

export interface SessionHistoryItem {
  sessionId: string;
  userName: string;
  hasDiff: boolean;
  methods: MethodCountHistoryItem[];
}

export interface JornadaHistoryItem {
  jornadaId: string;
  openedAtMs: number;
  closedAtMs: number;
  closedByName: string | null;
  ordersCount: number;
  netSalesUsdCents: number;
  sessions: SessionHistoryItem[];
}

export interface ClosureHistoryResponse {
  items: JornadaHistoryItem[];
  nextBefore: number | null;
}

export function useClosureHistory(limit = 20) {
  return useInfiniteQuery({
    queryKey: ['closureHistory', limit],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (limit) params.set('limit', String(limit));
      if (pageParam !== undefined && pageParam !== null) {
        params.set('before', String(pageParam));
      }
      const qs = params.toString();
      const endpoint = qs ? `/api/jornadas/history?${qs}` : '/api/jornadas/history';
      return apiJson<ClosureHistoryResponse>(endpoint);
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextBefore ?? undefined
  });
}
