import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import { apiFetch } from '../../api/client.js';
import { Modal } from '../../ui/Modal.js';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/Icon.js';
import type { AdminProduct } from '../../types/menu.js';

export interface DeleteProductDialogProps {
  product: AdminProduct | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccessMessage?: (msg: string) => void;
  onError?: (msg: string) => void;
}

export const DeleteProductDialog: React.FC<DeleteProductDialogProps> = ({
  product,
  isOpen,
  onClose,
  onSuccessMessage,
  onError
}) => {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!product) return;
      setErrorMessage(null);
      const res = await apiFetch(`/api/menu/products/${product.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al eliminar el producto');
      }
      return data as { success: boolean; mode: 'deleted' | 'archived' };
    },
    onSuccess: (data) => {
      if (!data) return;
      queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
      queryClient.invalidateQueries({ queryKey: ['posMenu'] });
      const feedback =
        data.mode === 'deleted'
          ? 'Producto eliminado'
          : 'El producto tenía ventas: quedó oculto';
      onSuccessMessage?.(feedback);
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.message || 'Error al procesar la eliminación';
      setErrorMessage(msg);
      onError?.(msg);
    }
  });

  const handleClose = () => {
    if (deleteMutation.isPending) return;
    setErrorMessage(null);
    onClose();
  };

  if (!isOpen || !product) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={
        <span className="flex items-center gap-2 text-ink font-black text-base">
          <Icon name="Trash2" size={20} className="text-danger" />
          <span>Eliminar producto</span>
        </span>
      }
      maxWidth="sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-ink leading-relaxed">
          ¿Estás seguro de que deseas eliminar <span className="font-black text-ink">{product.name}</span>?
        </p>

        <div className="p-3 rounded-xl bg-surface-alt border border-border flex items-start gap-2.5">
          <Icon name="Info" size={18} className="text-ink-muted shrink-0 mt-0.5" />
          <p className="text-xs text-ink-muted leading-relaxed">
            Si el producto ya tiene ventas se ocultará en lugar de borrarse para conservar el historial.
          </p>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-xl bg-danger-subtle border border-danger/40 flex items-start gap-2 text-xs text-danger font-bold">
            <Icon name="AlertCircle" size={16} className="shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Button
            type="button"
            variant="secondary"
            size="md"
            fullWidth
            disabled={deleteMutation.isPending}
            onClick={handleClose}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="danger"
            size="md"
            fullWidth
            isLoading={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            Eliminar
          </Button>
        </div>
      </div>
    </Modal>
  );
};
