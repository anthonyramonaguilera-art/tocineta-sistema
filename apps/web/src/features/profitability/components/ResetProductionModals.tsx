import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input, Field } from '../../../ui/index.js';
import { apiFetch } from '../../../api/client.js';

interface ResetProductionModalsProps {
  isResetOpen: boolean;
  onCloseReset: () => void;
  isDemoOpen: boolean;
  onCloseDemo: () => void;
}

export const ResetProductionModals: React.FC<ResetProductionModalsProps> = ({
  isResetOpen,
  onCloseReset,
  isDemoOpen,
  onCloseDemo
}) => {
  const queryClient = useQueryClient();
  const [resetPin, setResetPin] = useState('');
  const [demoPin, setDemoPin] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

  const handleCloseReset = () => {
    setResetPin('');
    setResetError(null);
    onCloseReset();
  };

  const handleCloseDemo = () => {
    setDemoPin('');
    setDemoError(null);
    onCloseDemo();
  };

  const initProdMutation = useMutation({
    mutationFn: async () => {
      setResetError(null);
      const res = await apiFetch('/api/fase3/setup-wizard/init-prod', {
        method: 'POST',
        body: JSON.stringify({ pin: resetPin })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Error al restablecer la base de datos');
      }
      return data;
    },
    onSuccess: () => {
      handleCloseReset();
      queryClient.clear();
      window.location.reload();
    },
    onError: (err: any) => {
      setResetError(err.message || 'Error de autenticación o validación');
    }
  });

  const seedDemoMutation = useMutation({
    mutationFn: async () => {
      setDemoError(null);
      const res = await apiFetch('/api/fase3/setup-wizard/seed-demo', {
        method: 'POST',
        body: JSON.stringify({ pin: demoPin })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Error al sembrar datos demo');
      }
      return data;
    },
    onSuccess: () => {
      handleCloseDemo();
      queryClient.clear();
      window.location.reload();
    },
    onError: (err: any) => {
      setDemoError(err.message || 'Error de autenticación o validación');
    }
  });

  return (
    <>
      <Modal
        isOpen={isResetOpen}
        onClose={handleCloseReset}
        title="Restablecer Base Limpia para Producción"
      >
        <div className="space-y-4 text-xs">
          <p className="text-ink">
            Esta acción eliminará todos los datos de prueba, proveedores demo y costos ficticios,
            dejando la base lista para operar en producción real.
          </p>
          <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger font-bold">
            Esta acción es irreversible y deja el sistema en modo Producción Real.
          </div>

          <Field label="PIN de Administrador" required error={resetError || undefined}>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={resetPin}
              onChange={(e) => setResetPin(e.target.value.replace(/\D/g, ''))}
              placeholder="PIN de 6 dígitos"
              autoFocus
            />
          </Field>

          <div className="flex gap-2 pt-2">
            <Button variant="ghost" className="flex-1 min-h-[48px]" onClick={handleCloseReset}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              className="flex-1 min-h-[48px]"
              loading={initProdMutation.isPending}
              disabled={resetPin.length !== 6 || initProdMutation.isPending}
              onClick={() => initProdMutation.mutate()}
            >
              Confirmar Limpieza
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isDemoOpen}
        onClose={handleCloseDemo}
        title="Sembrar Datos Demo para Demostración"
      >
        <div className="space-y-4 text-xs">
          <p className="text-ink">
            Se cargarán insumos y recetas de demostración con la marca oficial "TOCINETA" y se activará la marca visible de "DEMO" en pantalla.
          </p>

          <Field label="PIN de Administrador" required error={demoError || undefined}>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={demoPin}
              onChange={(e) => setDemoPin(e.target.value.replace(/\D/g, ''))}
              placeholder="PIN de 6 dígitos"
              autoFocus
            />
          </Field>

          <div className="flex gap-2 pt-2">
            <Button variant="ghost" className="flex-1 min-h-[48px]" onClick={handleCloseDemo}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              className="flex-1 min-h-[48px]"
              loading={seedDemoMutation.isPending}
              disabled={demoPin.length !== 6 || seedDemoMutation.isPending}
              onClick={() => seedDemoMutation.mutate()}
            >
              Cargar Modo Demo
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
