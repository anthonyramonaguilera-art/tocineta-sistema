import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../api/client.js';

export function useEventStream() {
  const [isConnected, setIsConnected] = useState(false);
  const [latestSeq, setLatestSeq] = useState<number>(0);
  const queryClient = useQueryClient();
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  useEffect(() => {
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;

      const token = getAuthToken();
      if (!token) {
        setIsConnected(false);
        // Sin token: no conecta y espera al evento 'tocineta:authenticated' sin bucle ciego
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

      try {
        const socket = new WebSocket(wsUrl);
        socketRef.current = socket;

        socket.onopen = () => {
          if (unmounted) return;
          setIsConnected(true);
        };

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.event === 'CONNECTED' && data.latestSeq !== undefined) {
              setLatestSeq(data.latestSeq);
            }

            if (data.seq !== undefined) {
              setLatestSeq(data.seq);

              // Invalidar cachés operativas según el evento recibido
              queryClient.invalidateQueries({ queryKey: ['posMenu'] });
              queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
            }
          } catch {}
        };

        socket.onclose = () => {
          if (unmounted) return;
          setIsConnected(false);
          // Reconectar en 2.5 segundos
          reconnectTimeoutRef.current = setTimeout(connect, 2500);
        };

        socket.onerror = () => {
          socket.close();
        };
      } catch {
        reconnectTimeoutRef.current = setTimeout(connect, 2500);
      }
    };

    const handleAuthenticated = () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) {
        socketRef.current.close();
      }
      connect();
    };

    window.addEventListener('tocineta:authenticated', handleAuthenticated);
    connect();

    return () => {
      unmounted = true;
      window.removeEventListener('tocineta:authenticated', handleAuthenticated);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) socketRef.current.close();
    };
  }, [queryClient]);

  return { isConnected, latestSeq };
}
