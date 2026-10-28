import { useState, useEffect, useRef, useCallback } from 'react';
import type { KdsOrder } from './KdsView.js';
import { kdsSound } from './sound-effects.js';

export function useKdsAlerts(orders: KdsOrder[] | undefined) {
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef(true);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const [isAudioSuspended, setIsAudioSuspended] = useState(kdsSound.isSuspended());
  const [soundEnabled, setSoundEnabled] = useState(kdsSound.isEnabled());

  // Escuchar primer gesto para desbloquear audio
  const handleUnlockAudio = useCallback(async () => {
    const unlocked = await kdsSound.unlock();
    if (unlocked) {
      setIsAudioSuspended(false);
    }
  }, []);

  useEffect(() => {
    const onUserInteraction = () => {
      void handleUnlockAudio();
    };
    window.addEventListener('click', onUserInteraction, { once: true, passive: true });
    window.addEventListener('touchstart', onUserInteraction, { once: true, passive: true });
    return () => {
      window.removeEventListener('click', onUserInteraction);
      window.removeEventListener('touchstart', onUserInteraction);
    };
  }, [handleUnlockAudio]);

  // Alertas ante nuevas órdenes
  useEffect(() => {
    if (!orders) return;

    // Si es la carga inicial, sembramos las órdenes existentes sin disparar alertas
    if (isInitialLoadRef.current) {
      for (const ord of orders) {
        knownOrderIdsRef.current.add(ord.orderId);
      }
      isInitialLoadRef.current = false;
      return;
    }

    const brandNewIds: string[] = [];
    let hasRefire = false;

    for (const ord of orders) {
      if (!knownOrderIdsRef.current.has(ord.orderId)) {
        brandNewIds.push(ord.orderId);
        knownOrderIdsRef.current.add(ord.orderId);
        if (ord.isRefire) {
          hasRefire = true;
        }
      }
    }

    if (brandNewIds.length > 0) {
      // 1. Alerta Sonora
      if (soundEnabled) {
        if (hasRefire) {
          kdsSound.playRefireUrgentSound();
        } else {
          kdsSound.playNewOrderSound();
        }
      }

      // 2. Alerta de Vibración háptica
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate([200, 100, 200]);
        } catch {
          // Ignorar error de permisos
        }
      }

      // 3. Alerta Visual
      setNewOrderIds((prev) => {
        const next = new Set(prev);
        for (const id of brandNewIds) {
          next.add(id);
        }
        return next;
      });
    }
  }, [orders, soundEnabled]);

  const acknowledgeOrder = useCallback((orderId: string) => {
    setNewOrderIds((prev) => {
      if (!prev.has(orderId)) return prev;
      const next = new Set(prev);
      next.delete(orderId);
      return next;
    });
  }, []);

  const toggleSound = useCallback(() => {
    const next = !soundEnabled;
    kdsSound.setEnabled(next);
    setSoundEnabled(next);
    if (next) {
      void handleUnlockAudio();
    }
  }, [soundEnabled, handleUnlockAudio]);

  return {
    newOrderIds,
    acknowledgeOrder,
    soundEnabled,
    toggleSound,
    isAudioSuspended,
    unlockAudio: handleUnlockAudio
  };
}

