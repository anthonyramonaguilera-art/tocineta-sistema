import { useState, useEffect, useRef } from 'react';

/**
 * Hook de protección multi-pestaña para la Caja usando BroadcastChannel
 * Evita tener dos pestañas de Caja operando simultáneamente en la misma laptop/dispositivo.
 */
export function useMultiTabCashierGuard() {
  const [isBlocked, setIsBlocked] = useState<boolean>(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef<string>(`tab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.BroadcastChannel) {
      return;
    }

    const channel = new BroadcastChannel('tocineta_cashier');
    channelRef.current = channel;
    const currentTabId = tabIdRef.current;

    channel.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'CASHIER_PING' && data.senderTabId !== currentTabId) {
        // Otra pestaña acaba de abrirse: responderle que esta pestaña ya tiene la caja abierta
        channel.postMessage({
          type: 'CASHIER_PONG',
          activeTabId: currentTabId
        });
      } else if (data.type === 'CASHIER_PONG' && data.activeTabId !== currentTabId) {
        // Hay otra pestaña activa: bloquear esta pestaña
        setIsBlocked(true);
      } else if (data.type === 'CASHIER_TAKEOVER' && data.newActiveTabId !== currentTabId) {
        // Otra pestaña tomó el control: bloquear esta
        setIsBlocked(true);
      } else if (data.type === 'CASHIER_CLOSED') {
        // La otra pestaña se cerró: desbloquear esta
        setIsBlocked(false);
      }
    };

    // Al montar: preguntar si hay otra pestaña activa
    channel.postMessage({
      type: 'CASHIER_PING',
      senderTabId: currentTabId
    });

    const handleBeforeUnload = () => {
      channel.postMessage({
        type: 'CASHIER_CLOSED',
        senderTabId: currentTabId
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      channel.postMessage({
        type: 'CASHIER_CLOSED',
        senderTabId: currentTabId
      });
      channel.close();
    };
  }, []);

  const takeControl = () => {
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: 'CASHIER_TAKEOVER',
        newActiveTabId: tabIdRef.current
      });
    }
    setIsBlocked(false);
  };

  return { isBlocked, takeControl };
}
