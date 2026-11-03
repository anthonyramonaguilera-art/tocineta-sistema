import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import { apiFetch } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/Icon.js';
import type { AdminProduct } from '../../types/menu.js';

export interface ProductStatusControlsProps {
  product: AdminProduct;
  isCategoryInactive: boolean;
  categoryId: string;
  toggleAvailabilityMutation: {
    mutate: (vars: { productId: string; isAvailable: boolean }) => void;
    isPending?: boolean;
  };
  onDeleteClick?: () => void;
  onError?: (message: string) => void;
}

export const ProductStatusControls: React.FC<ProductStatusControlsProps> = ({
  product,
  isCategoryInactive,
  categoryId,
  toggleAvailabilityMutation,
  onDeleteClick,
  onError
}) => {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const togglePublishMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      const res = await apiFetch(`/api/menu/products/${product.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ isActive })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al cambiar publicación del producto');
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
      queryClient.invalidateQueries({ queryKey: ['posMenu'] });
    },
    onError: (err: any) => {
      onError?.(err?.message || 'Error al cambiar publicación del producto');
    }
  });

  const activateCategoryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/menu/categories/${categoryId}/toggle-active`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al activar categoría');
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
      queryClient.invalidateQueries({ queryKey: ['posMenu'] });
    },
    onError: (err: any) => {
      onError?.(err?.message || 'Error al activar categoría');
    }
  });

  const isPublished = Boolean(product.isActive);
  const isAvailable = Boolean(product.isAvailable);

  return (
    <div className="mt-4 pt-3 border-t border-border flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink-muted">Estado Operativo:</span>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {isCategoryInactive ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold border bg-warning-subtle text-warning border-warning/30 flex items-center gap-1">
              <Icon name="EyeOff" size={13} />
              <span>Categoría oculta</span>
            </span>
          ) : !isPublished ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold border bg-warning-subtle text-warning border-warning/30 flex items-center gap-1">
              <Icon name="EyeOff" size={13} />
              <span>Oculto en POS</span>
            </span>
          ) : isAvailable ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold border bg-success-subtle text-success border-success/40 flex items-center gap-1">
              <Icon name="CheckCircle2" size={13} />
              <span>Publicado</span>
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold border bg-danger-subtle text-danger border-danger/40 flex items-center gap-1">
              <Icon name="AlertCircle" size={13} />
              <span>Agotado</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {isCategoryInactive ? (
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="flex-1"
            iconStart="Eye"
            isLoading={activateCategoryMutation.isPending}
            onClick={() => activateCategoryMutation.mutate()}
          >
            Activar categoría
          </Button>
        ) : !isPublished ? (
          <Button
            type="button"
            variant="primary"
            size="md"
            className="flex-1"
            iconStart="Eye"
            isLoading={togglePublishMutation.isPending}
            onClick={() => togglePublishMutation.mutate(true)}
          >
            Publicar en POS
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant={isAvailable ? 'secondary' : 'primary'}
              size="md"
              className="flex-1"
              iconStart={isAvailable ? 'PowerOff' : 'RotateCcw'}
              disabled={toggleAvailabilityMutation.isPending}
              onClick={() =>
                toggleAvailabilityMutation.mutate({
                  productId: product.id,
                  isAvailable: !isAvailable
                })
              }
            >
              {isAvailable ? 'Agotar' : 'Reactivar'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              iconStart="EyeOff"
              isLoading={togglePublishMutation.isPending}
              onClick={() => togglePublishMutation.mutate(false)}
              aria-label="Ocultar del POS"
            >
              Ocultar del POS
            </Button>
          </>
        )}

        {onDeleteClick && (
          <Button
            type="button"
            variant="danger"
            size="md"
            iconStart="Trash2"
            onClick={onDeleteClick}
            aria-label={`Eliminar ${product.name}`}
          >
            Eliminar
          </Button>
        )}
      </div>
    </div>
  );
};
