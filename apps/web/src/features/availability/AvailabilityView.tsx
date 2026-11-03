import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import { apiFetch } from '../../api/client.js';
import { Card, Button, Input, Badge, Icon, EmptyState } from '../../ui/index.js';
import type { PosMenuResponse, PosCategory } from '../../types/menu.js';

const normalizeText = (text: string) =>
  text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export const AvailabilityView: React.FC = () => {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [onlySoldOut, setOnlySoldOut] = useState(false);

  // Consulta de menú operativo
  const { data: menuData, isLoading } = useQuery<PosMenuResponse>({
    queryKey: ['posMenu'],
    queryFn: async () => {
      const res = await apiFetch('/api/menu/pos');
      if (!res.ok) throw new Error('Error al cargar menú');
      return res.json();
    },
    staleTime: 30000
  });

  // Mutación optimista: Toggle disponibilidad de producto
  const toggleProductMutation = useMutation({
    mutationFn: async ({ productId, isAvailable }: { productId: string; isAvailable: boolean }) => {
      const res = await apiFetch(`/api/menu/products/${productId}/availability`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ isAvailable })
      });
      if (!res.ok) throw new Error('Error al actualizar disponibilidad');
      return res.json();
    },
    onMutate: async ({ productId, isAvailable }) => {
      await queryClient.cancelQueries({ queryKey: ['posMenu'] });
      const previousMenu = queryClient.getQueryData<PosMenuResponse>(['posMenu']);

      if (previousMenu) {
        queryClient.setQueryData<PosMenuResponse>(['posMenu'], {
          ...previousMenu,
          categories: previousMenu.categories.map((cat) => ({
            ...cat,
            products: cat.products.map((prod) =>
              prod.id === productId ? { ...prod, isAvailable } : prod
            )
          }))
        });
      }

      return { previousMenu };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousMenu) {
        queryClient.setQueryData(['posMenu'], context.previousMenu);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posMenu'] });
      queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
    }
  });

  // Mutación optimista: Toggle disponibilidad de sabor
  const toggleFlavorMutation = useMutation({
    mutationFn: async ({ flavorId, isAvailable }: { flavorId: string; isAvailable: boolean }) => {
      const res = await apiFetch(`/api/menu/flavors/${flavorId}/availability`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ isAvailable })
      });
      if (!res.ok) throw new Error('Error al actualizar sabor');
      return res.json();
    },
    onMutate: async ({ flavorId, isAvailable }) => {
      await queryClient.cancelQueries({ queryKey: ['posMenu'] });
      const previousMenu = queryClient.getQueryData<PosMenuResponse>(['posMenu']);

      if (previousMenu) {
        queryClient.setQueryData<PosMenuResponse>(['posMenu'], {
          ...previousMenu,
          categories: previousMenu.categories.map((cat) => ({
            ...cat,
            products: cat.products.map((prod) => ({
              ...prod,
              flavors: prod.flavors
                ? prod.flavors.map((flv) =>
                    flv.id === flavorId ? { ...flv, isAvailable } : flv
                  )
                : []
            }))
          }))
        });
      }

      return { previousMenu };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousMenu) {
        queryClient.setQueryData(['posMenu'], context.previousMenu);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posMenu'] });
      queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
    }
  });

  // Filtrado de productos y categorías
  const filteredCategories = useMemo(() => {
    if (!menuData?.categories) return [];

    const normQuery = normalizeText(searchQuery.trim());

    return menuData.categories
      .map((cat: PosCategory) => {
        const matchingProducts = cat.products.filter((prod) => {
          const nameMatches =
            !normQuery ||
            normalizeText(prod.name).includes(normQuery) ||
            normalizeText(cat.name).includes(normQuery) ||
            prod.flavors?.some((f) => normalizeText(f.flavorName).includes(normQuery));

          if (!nameMatches) return false;

          if (onlySoldOut) {
            const productSoldOut = !prod.isAvailable;
            const hasSoldOutFlavor = prod.flavors?.some((f) => !f.isAvailable);
            return productSoldOut || hasSoldOutFlavor;
          }

          return true;
        });

        return {
          ...cat,
          products: matchingProducts
        };
      })
      .filter((cat) => cat.products.length > 0);
  }, [menuData?.categories, searchQuery, onlySoldOut]);

  const totalProducts = useMemo(() => {
    return (menuData?.categories || []).reduce((acc, cat) => acc + cat.products.length, 0);
  }, [menuData?.categories]);

  const totalSoldOut = useMemo(() => {
    return (menuData?.categories || []).reduce(
      (acc, cat) => acc + cat.products.filter((p) => !p.isAvailable).length,
      0
    );
  }, [menuData?.categories]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Cabecera y Resumen de Estado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-surface p-5 rounded-2xl border border-border shadow-xs">
        <div>
          <h2 className="text-lg font-black text-ink uppercase tracking-tight flex items-center gap-2">
            <Icon name="Power" size={20} className="text-primary" />
            Control de Disponibilidad
          </h2>
          <p className="text-xs text-ink-muted mt-1">
            Activa o agota productos y sabores con un toque. Los cambios se aplican de inmediato en caja y mesoneros.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-surface-alt px-3 py-2 rounded-xl border border-border text-center">
            <span className="block text-[10px] font-bold text-ink-muted uppercase">Agotados</span>
            <span className={`text-base font-black ${totalSoldOut > 0 ? 'text-danger' : 'text-ink'}`}>
              {totalSoldOut}
            </span>
          </div>
          <div className="bg-surface-alt px-3 py-2 rounded-xl border border-border text-center">
            <span className="block text-[10px] font-bold text-ink-muted uppercase">Total Carta</span>
            <span className="text-base font-black text-ink">{totalProducts}</span>
          </div>
        </div>
      </div>

      {/* Barra de Filtros y Búsqueda */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="flex-1">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar producto o sabor..."
            leftIcon={<Icon name="Search" size={16} />}
          />
        </div>
        <button
          type="button"
          onClick={() => setOnlySoldOut((prev) => !prev)}
          className={`min-h-[48px] px-4 rounded-xl border font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer ${
            onlySoldOut
              ? 'bg-danger text-surface border-danger shadow-xs'
              : 'bg-surface border-border text-ink hover:bg-surface-alt'
          }`}
        >
          <Icon name={onlySoldOut ? 'PowerOff' : 'Power'} size={16} />
          <span>Solo Agotados {onlySoldOut ? '(Activo)' : ''}</span>
        </button>
      </div>

      {/* Lista de Categorías y Productos */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Icon name="RefreshCw" size={28} className="animate-spin text-primary" />
          <span className="text-xs font-bold text-ink-muted">Cargando disponibilidad...</span>
        </div>
      ) : filteredCategories.length === 0 ? (
        <EmptyState
          icon="Package"
          title="Sin resultados"
          description={
            onlySoldOut
              ? 'Todos los productos se encuentran disponibles actualmente.'
              : 'No hay productos que coincidan con la búsqueda.'
          }
        />
      ) : (
        <div className="space-y-6">
          {filteredCategories.map((cat) => (
            <div key={cat.id} className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <span className="text-xs font-black text-ink-muted uppercase tracking-wider">
                  {cat.name}
                </span>
                <span className="text-[10px] text-ink-muted font-bold">
                  ({cat.products.length})
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {cat.products.map((prod) => {
                  const isAvailable = prod.isAvailable;
                  const isPending = toggleProductMutation.isPending;

                  return (
                    <Card
                      key={prod.id}
                      variant="surface"
                      className={`p-4 border transition-colors flex flex-col justify-between gap-4 ${
                        isAvailable
                          ? 'border-border'
                          : 'border-danger/40 bg-danger-subtle/30'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-bold text-sm text-ink leading-tight">
                              {prod.name}
                            </h4>
                            <Badge
                              variant={isAvailable ? 'primary' : 'danger'}
                              size="sm"
                            >
                              {isAvailable ? 'Disponible' : 'Agotado'}
                            </Badge>
                          </div>
                          {prod.description && (
                            <p className="text-[11px] text-ink-muted line-clamp-2">
                              {prod.description}
                            </p>
                          )}
                        </div>

                        {/* Botón de Toque Rápido para el Producto */}
                        <Button
                          variant={isAvailable ? 'secondary' : 'primary'}
                          size="md"
                          className="min-h-[48px] shrink-0"
                          disabled={isPending}
                          onClick={() =>
                            toggleProductMutation.mutate({
                              productId: prod.id,
                              isAvailable: !isAvailable
                            })
                          }
                          leftIcon={
                            <Icon
                              name={isAvailable ? 'PowerOff' : 'Power'}
                              size={16}
                            />
                          }
                        >
                          {isAvailable ? 'Agotar' : 'Activar'}
                        </Button>
                      </div>

                      {/* Sección de Sabores / Variantes si aplica */}
                      {prod.allowsFlavors && prod.flavors && prod.flavors.length > 0 && (
                        <div className="pt-3 border-t border-border space-y-2">
                          <span className="text-[10px] font-black text-ink-muted uppercase tracking-wider block">
                            Disponibilidad por Sabor
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {prod.flavors.map((flavor) => {
                              const flvAvailable = flavor.isAvailable;
                              return (
                                <button
                                  key={flavor.id}
                                  type="button"
                                  onClick={() =>
                                    toggleFlavorMutation.mutate({
                                      flavorId: flavor.id,
                                      isAvailable: !flvAvailable
                                    })
                                  }
                                  className={`min-h-[48px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 transition-all cursor-pointer ${
                                    flvAvailable
                                      ? 'bg-surface border-border text-ink hover:bg-surface-alt'
                                      : 'bg-danger/10 border-danger/30 text-danger hover:bg-danger/20'
                                  }`}
                                >
                                  <span className="truncate">{flavor.flavorName}</span>
                                  <Badge
                                    variant={flvAvailable ? 'primary' : 'danger'}
                                    size="sm"
                                  >
                                    {flvAvailable ? 'Sí' : 'No'}
                                  </Badge>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AvailabilityView;
