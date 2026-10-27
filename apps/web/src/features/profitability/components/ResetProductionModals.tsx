import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button } from '../../../ui/index.js';

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

  const initProdMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/fase3/setup-wizard/init-prod', { method: 'POST' });
      return res.json();
    },
    onSuccess: () => {
      onCloseReset();
      queryClient.clear();
      window.location.reload();
    }
  });

  const seedDemoMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/fase3/setup-wizard/seed-demo', { method: 'POST' });
      return res.json();
    },
    onSuccess: () => {
      onCloseDemo();
      queryClient.clear();
      window.location.reload();
    }
  });

  return (
    <>
      <Modal
        isOpen={isResetOpen}
        onClose={onCloseReset}
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
          <div className="flex gap-2 pt-2">
            <Button variant="ghost" className="flex-1" onClick={onCloseReset}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={initProdMutation.isPending}
              onClick={() => initProdMutation.mutate()}
            >
              Confirmar Limpieza
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isDemoOpen}
        onClose={onCloseDemo}
        title="Sembrar Datos Demo para Demostración"
      >
        <div className="space-y-4 text-xs">
          <p className="text-ink">
            Se cargarán insumos y recetas de demostración con la marca oficial "TOCINETA" y se activará la marca visible de "DEMO" en pantalla.
          </p>
          <div className="flex gap-2 pt-2">
            <Button variant="ghost" className="flex-1" onClick={onCloseDemo}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              loading={seedDemoMutation.isPending}
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
