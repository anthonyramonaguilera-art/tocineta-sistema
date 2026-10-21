import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.js';
import type { AdminMenuResponse, AdminProduct, Station } from '../types/menu.js';
import { PedagogicalGuideBanner } from './PedagogicalGuideBanner.js';

export const MenuAdminView: React.FC = () => {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'products' | 'coupons' | 'bcv'>('products');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);

  // Formulario nuevo/editar producto
  const [formName, setFormName] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formPriceUsd, setFormPriceUsd] = useState('');
  const [formCostUsd, setFormCostUsd] = useState('');
  const [formStation, setFormStation] = useState<Station>('hot_dogs');
  const [formDescription, setFormDescription] = useState('');

  // Formulario nueva tasa BCV
  const [newRateInput, setNewRateInput] = useState('');
  const [rateMessage, setRateMessage] = useState<string | null>(null);

  const [couponCode, setCouponCode] = useState('');
  const [couponType, setCouponType] = useState<'DISCOUNT' | 'COURTESY_ITEM'>('DISCOUNT');
  const [discountMode, setDiscountMode] = useState<'FIXED_USD' | 'PERCENTAGE_BPS'>('PERCENTAGE_BPS');
  const [discountValue, setDiscountValue] = useState('10');
  const [couponDesc, setCouponDesc] = useState('');
  const [showAllCoupons, setShowAllCoupons] = useState<boolean>(false);
  const [isSyncingBcv, setIsSyncingBcv] = useState<boolean>(false);

  const { data: adminMenu, isLoading } = useQuery<AdminMenuResponse>({
    queryKey: ['adminMenu'],
    queryFn: async () => {
      const res = await fetch('/api/menu/admin', {
        headers: { authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Error al consultar catálogo de administración');
      return res.json();
    },
    enabled: Boolean(token)
  });

  // Mutación: Toggle Categoría Activa (Línea Malteadas)
  const toggleCategoryMutation = useMutation({
    mutationFn: async (categoryId: string) => {
      const res = await fetch(`/api/menu/categories/${categoryId}/toggle-active`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}` }
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
      queryClient.invalidateQueries({ queryKey: ['posMenu'] });
    }
  });

  // Mutación: Toggle Disponibilidad Producto (Agotado/Disponible)
  const toggleAvailabilityMutation = useMutation({
    mutationFn: async ({ productId, isAvailable }: { productId: string; isAvailable: boolean }) => {
      const res = await fetch(`/api/menu/products/${productId}/availability`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ isAvailable })
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
      queryClient.invalidateQueries({ queryKey: ['posMenu'] });
    }
  });

  // Mutación: Toggle Disponibilidad Sabor
  const toggleFlavorMutation = useMutation({
    mutationFn: async ({ flavorId, isAvailable }: { flavorId: string; isAvailable: boolean }) => {
      const res = await fetch(`/api/menu/flavors/${flavorId}/availability`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ isAvailable })
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
      queryClient.invalidateQueries({ queryKey: ['posMenu'] });
    }
  });

  // Mutación: Guardar Producto (Crear o Actualizar)
  const saveProductMutation = useMutation({
    mutationFn: async () => {
      const priceUsdCents = Math.round(parseFloat(formPriceUsd || '0') * 100);
      const costUsdCents = Math.round(parseFloat(formCostUsd || '0') * 100);

      let savedProductId = editingProduct?.id;

      if (editingProduct) {
        // Actualizar
        const res = await fetch(`/api/menu/products/${editingProduct.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            name: formName,
            priceUsdCents,
            estimatedCostUsdCents: costUsdCents,
            station: formStation,
            description: formDescription
          })
        });
        const d = await res.json();
        if (!d.success) throw new Error(d.error);
      } else {
        // Crear
        const res = await fetch('/api/menu/products', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            categoryId: formCategoryId,
            name: formName,
            priceUsdCents,
            estimatedCostUsdCents: costUsdCents,
            station: formStation,
            description: formDescription
          })
        });
        const d = await res.json();
        if (!d.success) throw new Error(d.error);
        savedProductId = d.product.id;
      }

      // Si se cargó foto, subirla
      if (photoBase64 && savedProductId) {
        await fetch(`/api/menu/products/${savedProductId}/photo`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ base64: photoBase64 })
        });
      }
    },
    onSuccess: () => {
      closeProductModal();
      queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
      queryClient.invalidateQueries({ queryKey: ['posMenu'] });
    }
  });

  // Mutación: Actualizar Tasa BCV
  const updateRateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/menu/exchange-rate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ rateStr: newRateInput })
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setRateMessage(`Tasa BCV actualizada exitosamente a ${data.formattedRate} Bs/$`);
        setNewRateInput('');
        queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
        queryClient.invalidateQueries({ queryKey: ['posMenu'] });
      } else {
        setRateMessage(data.error || 'Error al actualizar tasa');
      }
    }
  });

  // Mutación: Crear Cupón
  const createCouponMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        code: couponCode,
        couponType,
        description: couponDesc
      };
      if (couponType === 'DISCOUNT') {
        payload.discountMode = discountMode;
        if (discountMode === 'PERCENTAGE_BPS') {
          payload.discountValue = Math.round(parseFloat(discountValue || '0') * 100);
        } else {
          payload.discountValue = Math.round(parseFloat(discountValue || '0') * 100);
        }
      } else {
        payload.courtesyProductId = 'prod_cafe_cortesia';
      }

      const res = await fetch('/api/menu/coupons', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setCouponCode('');
        setCouponDesc('');
        queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
      }
    }
  });

  // Mutación: Toggle Cupón
  const toggleCouponMutation = useMutation({
    mutationFn: async (couponId: string) => {
      const res = await fetch(`/api/menu/coupons/${couponId}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}` }
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
    }
  });

  // Mutación: Eliminar Cupón
  const deleteCouponMutation = useMutation({
    mutationFn: async (couponId: string) => {
      const res = await fetch(`/api/menu/coupons/${couponId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` }
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
    }
  });

  const openCreateModal = () => {
    setEditingProduct(null);
    setFormName('');
    setFormCategoryId(adminMenu?.categories[0]?.id || 'cat_hot_dogs');
    setFormPriceUsd('');
    setFormCostUsd('');
    setFormStation('hot_dogs');
    setFormDescription('');
    setPhotoBase64(null);
    setIsCreatingProduct(true);
  };

  const openEditModal = (p: AdminProduct) => {
    setEditingProduct(p);
    setFormName(p.name);
    setFormCategoryId(p.category_id);
    setFormPriceUsd((p.price_usd_cents / 100).toFixed(2));
    setFormCostUsd((p.estimated_cost_usd_cents / 100).toFixed(2));
    setFormStation(p.station);
    setFormDescription(p.description || '');
    setPhotoBase64(null);
    setIsCreatingProduct(true);
  };

  const closeProductModal = () => {
    setEditingProduct(null);
    setIsCreatingProduct(false);
    setPhotoBase64(null);
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert('La imagen no debe superar los 2 MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPhotoBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  if (isLoading || !adminMenu) {
    return (
      <div className="py-20 text-center text-tocineta-yellow">
        <span className="text-3xl animate-spin inline-block">⚙️</span>
        <p className="mt-3 text-sm font-semibold">Cargando Gestor de Menú y Catálogo Admin...</p>
      </div>
    );
  }

  const malteadasCat = adminMenu.categories.find(c => c.id === 'cat_malteadas');
  const isMalteadasActive = Boolean(malteadasCat?.is_active);

  const filteredProducts = adminMenu.products.filter(p => {
    if (selectedCategory === 'all') return true;
    return p.category_id === selectedCategory;
  });

  return (
    <div className="space-y-6">
      {/* Guía Rápida Pedagógica */}
      <PedagogicalGuideBanner
        title="Guía Rápida de la Carta"
        description="Aquí puedes agregar nuevos platos o cambiar precios. Si un producto se acaba en la noche, toca el botón verde 'Disponible' para apagarlo al instante."
        storageKey="tocineta_guide_menu"
      />

      {/* -------------------------------------------------------------------- */}
      {/* 1. SECCIÓN MALTEADAS Y HELADOS                                       */}
      {/* -------------------------------------------------------------------- */}
      <div
        className={`border rounded-2xl p-5 shadow-lg transition-all flex flex-col sm:flex-row items-center justify-between gap-4 ${
          isMalteadasActive
            ? 'bg-gradient-to-r from-pink-950/40 via-purple-950/20 to-tocineta-card border-pink-500/50'
            : 'bg-tocineta-card border-tocineta-border'
        }`}
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-pink-500/10 border border-pink-500/30 text-pink-400 flex items-center justify-center text-2xl shadow-inner">
            🥤
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-extrabold text-white">Línea Malteadas y Helados</h3>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${
                  isMalteadasActive
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                    : 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                }`}
              >
                {isMalteadasActive ? 'Activo en POS y Caja' : 'Guardado (No visible para mesoneros)'}
              </span>
            </div>
            <p className="text-xs text-tocineta-muted mt-1 max-w-xl">
              {isMalteadasActive
                ? 'La categoría está visible en las pantallas de Comandero y Caja. Puedes registrar pedidos de malteadas.'
                : 'La categoría permanece oculta para los mesoneros mientras la Sra. Olinelcys valida costos e insumos. Actívala en 1 clic cuando esté lista.'}
            </p>
          </div>
        </div>

        <button
          onClick={() => malteadasCat && toggleCategoryMutation.mutate(malteadasCat.id)}
          disabled={toggleCategoryMutation.isPending}
          className={`px-5 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all shadow-md shrink-0 ${
            isMalteadasActive
              ? 'bg-red-500/20 border border-red-500 text-red-300 hover:bg-red-500/30'
              : 'bg-tocineta-yellow text-tocineta-bg hover:bg-tocineta-yellow/90'
          }`}
        >
          {toggleCategoryMutation.isPending
            ? 'Cambiando...'
            : isMalteadasActive
            ? 'Ocultar en POS'
            : 'Activar en POS'}
        </button>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* 2. PESTAÑAS DEL PANEL ADMIN                                          */}
      {/* -------------------------------------------------------------------- */}
      <div className="flex items-center gap-2 border-b border-tocineta-border pb-3">
        <button
          onClick={() => setActiveTab('products')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'products'
              ? 'bg-tocineta-yellow text-tocineta-bg shadow-sm'
              : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white'
          }`}
        >
          🍔 Catálogo de Productos ({adminMenu.products.length})
        </button>
        <button
          onClick={() => setActiveTab('coupons')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'coupons'
              ? 'bg-tocineta-yellow text-tocineta-bg shadow-sm'
              : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white'
          }`}
        >
          🎟️ Cupones Para Ti ({adminMenu.coupons.length})
        </button>
        <button
          onClick={() => setActiveTab('bcv')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'bcv'
              ? 'bg-tocineta-yellow text-tocineta-bg shadow-sm'
              : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white'
          }`}
        >
          💵 Tasa Oficial BCV ({adminMenu.formattedRate} Bs/$)
        </button>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* VISTA 1: CATÁLOGO DE PRODUCTOS                                       */}
      {/* -------------------------------------------------------------------- */}
      {activeTab === 'products' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            {/* Filtros por Categoría */}
            <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 ${
                  selectedCategory === 'all'
                    ? 'bg-tocineta-yellow text-tocineta-bg'
                    : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted'
                }`}
              >
                Todos
              </button>
              {adminMenu.categories.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCategory(c.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 ${
                    selectedCategory === c.id
                      ? 'bg-tocineta-yellow text-tocineta-bg'
                      : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>

            <button
              onClick={openCreateModal}
              className="px-4 py-2 rounded-xl bg-tocineta-yellow text-tocineta-bg text-xs font-extrabold uppercase tracking-wider hover:bg-tocineta-yellow/90 transition-all shrink-0 shadow-md"
            >
              + Nuevo Producto
            </button>
          </div>

          {/* Grilla de Productos */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProducts.map(p => {
              const productFlavors = adminMenu.flavors.filter(f => f.product_id === p.id);

              return (
                <div
                  key={p.id}
                  className={`bg-tocineta-card border rounded-2xl p-4 flex flex-col justify-between shadow-md transition-all ${
                    p.isAvailable ? 'border-tocineta-border' : 'border-red-950/60 bg-red-950/10'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-white text-base leading-snug">{p.name}</h4>
                        <span className="text-[10px] text-tocineta-muted uppercase font-semibold">
                          Estación: {p.station}
                        </span>
                      </div>
                      <button
                        onClick={() => openEditModal(p)}
                        className="text-xs bg-tocineta-border hover:bg-tocineta-border-light text-white px-2 py-1 rounded-md"
                      >
                        Editar
                      </button>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-tocineta-muted block text-[10px]">Precio Venta:</span>
                        <span className="font-extrabold text-tocineta-yellow text-base font-mono">
                          ${(p.price_usd_cents / 100).toFixed(2)}
                        </span>
                        <span className="text-[10px] text-tocineta-muted font-mono block">
                          {(p.priceBsCents / 100).toFixed(2)} Bs
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-tocineta-muted block text-[10px]">Costo Est.:</span>
                        <span className="font-bold text-white font-mono">
                          ${(p.estimated_cost_usd_cents / 100).toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Sabores Pepsi con Toggle Rápido si es Refresco 1 Lt */}
                    {productFlavors.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-tocineta-border/60">
                        <span className="text-[10px] font-bold text-tocineta-muted uppercase block mb-1.5">
                          Disponibilidad de Sabores (Pepsi):
                        </span>
                        <div className="grid grid-cols-2 gap-1.5">
                          {productFlavors.map(f => (
                            <button
                              key={f.id}
                              onClick={() =>
                                toggleFlavorMutation.mutate({
                                  flavorId: f.id,
                                  isAvailable: !f.is_available
                                })
                              }
                              className={`px-2 py-1 rounded text-[11px] font-medium border flex items-center justify-between transition-all ${
                                f.is_available
                                  ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                                  : 'bg-red-500/10 border-red-500/30 text-red-400 line-through'
                              }`}
                            >
                              <span>{f.flavor_name}</span>
                              <span className="text-[9px] font-bold">
                                {f.is_available ? '✓' : '✗'}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Switch Rápido Disponible / Agotado */}
                  <div className="mt-4 pt-3 border-t border-tocineta-border flex items-center justify-between">
                    <span className="text-xs font-semibold text-tocineta-muted">
                      Estado Operativo:
                    </span>
                    <button
                      onClick={() =>
                        toggleAvailabilityMutation.mutate({
                          productId: p.id,
                          isAvailable: !p.isAvailable
                        })
                      }
                      className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                        p.isAvailable
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : 'bg-red-500/20 text-red-400 border border-red-500/40'
                      }`}
                    >
                      {p.isAvailable ? '● Disponible' : '○ Agotado'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* VISTA 2: GESTIÓN DE CUPONES                                          */}
      {/* -------------------------------------------------------------------- */}
      {activeTab === 'coupons' && (
        <div className="space-y-6">
          {/* Formulario Crear Cupón */}
          <div className="bg-tocineta-card border border-tocineta-border rounded-2xl p-5 shadow-md">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <span>🎟️</span>
              <span>Crear Nuevo Cupón ("Cupones Para Ti")</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] text-tocineta-muted uppercase font-bold block mb-1">
                  Código (ej. PROMO10):
                </label>
                <input
                  type="text"
                  value={couponCode}
                  onChange={e => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="CODIGO"
                  className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white font-mono"
                />
              </div>

              <div>
                <label className="text-[10px] text-tocineta-muted uppercase font-bold block mb-1">
                  Tipo de Cupón:
                </label>
                <select
                  value={couponType}
                  onChange={e => setCouponType(e.target.value as any)}
                  className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value="DISCOUNT">🏷️ Descuento ($ o %)</option>
                  <option value="COURTESY_ITEM">🎁 Regalo / Cortesía</option>
                </select>
              </div>

              {couponType === 'DISCOUNT' && (
                <>
                  <div>
                    <label className="text-[10px] text-tocineta-muted uppercase font-bold block mb-1">
                      Modalidad:
                    </label>
                    <select
                      value={discountMode}
                      onChange={e => setDiscountMode(e.target.value as any)}
                      className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white"
                    >
                      <option value="PERCENTAGE_BPS">% de Descuento</option>
                      <option value="FIXED_USD">Monto Fijo en USD ($)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] text-tocineta-muted uppercase font-bold block mb-1">
                      {discountMode === 'PERCENTAGE_BPS' ? 'Porcentaje (%):' : 'Monto en USD ($):'}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={discountValue}
                      onChange={e => setDiscountValue(e.target.value)}
                      className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <input
                type="text"
                placeholder="Descripción del cupón..."
                value={couponDesc}
                onChange={e => setCouponDesc(e.target.value)}
                className="flex-1 bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white"
              />
              <button
                onClick={() => createCouponMutation.mutate()}
                disabled={!couponCode || createCouponMutation.isPending}
                className="px-4 py-2 rounded-xl bg-tocineta-yellow text-tocineta-bg text-xs font-bold hover:bg-tocineta-yellow/90 disabled:opacity-50"
              >
                Crear Cupón
              </button>
            </div>
          </div>

          {/* Listado de Cupones */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">
                Cupones ({adminMenu.coupons.filter(c => {
                  const isExhausted = c.max_uses !== null && c.max_uses !== undefined && c.used_count >= c.max_uses;
                  if (showAllCoupons) return true;
                  return c.is_active === 1 && !isExhausted;
                }).length} de {adminMenu.coupons.length})
              </span>
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-tocineta-muted hover:text-white">
                <input
                  type="checkbox"
                  checked={showAllCoupons}
                  onChange={e => setShowAllCoupons(e.target.checked)}
                  className="rounded bg-tocineta-bg border-tocineta-border text-tocineta-yellow focus:ring-0"
                />
                <span>Mostrar cupones agotados / inactivos</span>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {adminMenu.coupons
                .filter(c => {
                  const isExhausted = c.max_uses !== null && c.max_uses !== undefined && c.used_count >= c.max_uses;
                  if (showAllCoupons) return true;
                  return c.is_active === 1 && !isExhausted;
                })
                .map(c => {
                  const isExhausted = c.max_uses !== null && c.max_uses !== undefined && c.used_count >= c.max_uses;
                  return (
                    <div
                      key={c.id}
                      className="bg-tocineta-card border border-tocineta-border rounded-2xl p-4 flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-extrabold text-sm text-tocineta-yellow">
                            {c.code}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-tocineta-border text-tocineta-muted uppercase font-bold">
                            {c.coupon_type === 'COURTESY_ITEM' ? '🎁 Regalo / Cortesía' : '🏷️ Descuento ($ o %)'}
                          </span>
                        </div>
                        <p className="text-xs text-tocineta-muted mt-1">{c.description || 'Sin descripción'}</p>
                        <div className="text-[10px] text-tocineta-muted font-mono mt-1">
                          Usos: {c.used_count} {c.max_uses ? `/ ${c.max_uses}` : ''}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isExhausted ? (
                          <span className="px-3 py-1 rounded-full text-xs font-bold border bg-amber-500/20 text-amber-300 border-amber-500/40">
                            Agotado ({c.used_count}/{c.max_uses})
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleCouponMutation.mutate(c.id)}
                            className={`px-3 py-1 rounded-full text-xs font-bold border transition-all ${
                              c.is_active
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                : 'bg-red-500/20 text-red-400 border-red-500/40'
                            }`}
                          >
                            {c.is_active ? 'Activo' : 'Inactivo'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`¿Deseas eliminar el cupón "${c.code}" permanentemente?`)) {
                              deleteCouponMutation.mutate(c.id);
                            }
                          }}
                          className="p-1.5 rounded-lg text-xs font-bold text-tocineta-muted hover:text-red-400 hover:bg-red-500/10 transition-all flex items-center gap-1"
                          title="Eliminar cupón"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* VISTA 3: ACTUALIZACIÓN TASA BCV                                      */}
      {/* -------------------------------------------------------------------- */}
      {activeTab === 'bcv' && (
        <div className="max-w-md mx-auto bg-tocineta-card border border-tocineta-border rounded-2xl p-6 shadow-xl space-y-4">
          <div className="text-center">
            <span className="text-3xl">💵</span>
            <h3 className="text-lg font-extrabold text-white mt-1">Tasa Oficial BCV del Food Truck</h3>
            <p className="text-xs text-tocineta-muted mt-0.5">
              Tasa vigente: <strong className="text-tocineta-yellow font-mono">{adminMenu.formattedRate} Bs/$</strong>
            </p>
          </div>

          <div>
            <label className="text-xs text-tocineta-muted uppercase font-bold block mb-1">
              Nueva Tasa BCV (ej. 42.50):
            </label>
            <input
              type="text"
              placeholder="42.50"
              value={newRateInput}
              onChange={e => setNewRateInput(e.target.value)}
              className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-4 py-3 text-lg font-mono text-center text-white focus:border-tocineta-yellow outline-none"
            />
          </div>

          {rateMessage && (
            <p className="text-xs text-center text-tocineta-yellow font-medium">{rateMessage}</p>
          )}

          <div className="space-y-2 pt-2">
            <button
              onClick={() => updateRateMutation.mutate()}
              disabled={!newRateInput || updateRateMutation.isPending}
              className="w-full min-h-[48px] rounded-xl bg-tocineta-yellow text-tocineta-bg font-extrabold text-xs uppercase tracking-wider hover:bg-tocineta-yellow/90 transition-all disabled:opacity-50 flex items-center justify-center shadow"
            >
              {updateRateMutation.isPending ? 'Actualizando Tasa...' : 'Actualizar Tasa BCV Oficial'}
            </button>

            <button
              type="button"
              onClick={async () => {
                setIsSyncingBcv(true);
                try {
                  const res = await fetch('/api/menu/exchange-rate/sync-now', {
                    method: 'POST',
                    headers: { authorization: `Bearer ${token}` }
                  });
                  const data = await res.json();
                  if (data.updated) {
                    setRateMessage(`✓ Tasa BCV sincronizada automáticamente por internet: ${data.formattedRate} Bs/$`);
                    queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
                    queryClient.invalidateQueries({ queryKey: ['posMenu'] });
                  } else {
                    setRateMessage(data.message || data.error || 'La tasa BCV ya se encuentra actualizada');
                  }
                } catch {
                  setRateMessage('Fallo al contactar el servidor para sincronizar BCV');
                } finally {
                  setIsSyncingBcv(false);
                }
              }}
              disabled={isSyncingBcv}
              className="w-full min-h-[46px] rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow/50 text-white font-bold text-xs transition-all flex items-center justify-center gap-2"
            >
              <span>🔄</span>
              <span>{isSyncingBcv ? 'Sincronizando con BCV oficial...' : 'Sincronizar BCV por Internet'}</span>
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* MODAL EDITOR / CREADOR DE PRODUCTO CON SUBIDA DE FOTO               */}
      {/* -------------------------------------------------------------------- */}
      {isCreatingProduct && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-tocineta-card border border-tocineta-border rounded-2xl p-6 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-tocineta-border">
              <h3 className="text-base font-extrabold text-white">
                {editingProduct ? `Editar: ${editingProduct.name}` : 'Crear Nuevo Producto'}
              </h3>
              <button onClick={closeProductModal} className="text-tocineta-muted hover:text-white text-lg">
                ✕
              </button>
            </div>

            <div className="space-y-4 my-4">
              <div>
                <label className="text-xs text-tocineta-muted uppercase font-bold block mb-1">Nombre:</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>

              {!editingProduct && (
                <div>
                  <label className="text-xs text-tocineta-muted uppercase font-bold block mb-1">Categoría:</label>
                  <select
                    value={formCategoryId}
                    onChange={e => setFormCategoryId(e.target.value)}
                    className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white"
                  >
                    {adminMenu.categories.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-tocineta-muted uppercase font-bold block mb-1">
                    Precio Venta ($):
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formPriceUsd}
                    onChange={e => setFormPriceUsd(e.target.value)}
                    className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                  {formPriceUsd && (
                    <span className="text-[10px] text-tocineta-yellow font-mono mt-1 block">
                      ≈ {(parseFloat(formPriceUsd) * (adminMenu.rateMicroBs / 1000000)).toFixed(2)} Bs
                    </span>
                  )}
                </div>

                <div>
                  <label className="text-xs text-tocineta-muted uppercase font-bold block mb-1">
                    Costo Estimado ($):
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formCostUsd}
                    onChange={e => setFormCostUsd(e.target.value)}
                    className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-tocineta-muted uppercase font-bold block mb-1">Estación:</label>
                <select
                  value={formStation}
                  onChange={e => setFormStation(e.target.value as any)}
                  className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value="hot_dogs">Hot Dogs</option>
                  <option value="hamburguesas">Hamburguesas</option>
                  <option value="caja_bebidas">Caja Bebidas</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-tocineta-muted uppercase font-bold block mb-1">Descripción:</label>
                <textarea
                  rows={2}
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white resize-none"
                />
              </div>

              {/* Subida Local de Fotografía */}
              <div>
                <label className="text-xs text-tocineta-muted uppercase font-bold block mb-1">
                  Fotografía del Plato (JPG, PNG, WEBP máx 2MB):
                </label>
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/webp"
                  onChange={handlePhotoSelect}
                  className="w-full text-xs text-tocineta-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border file:border-tocineta-border file:bg-tocineta-bg file:text-white file:text-xs hover:file:border-tocineta-yellow cursor-pointer"
                />
                {photoBase64 && (
                  <div className="mt-2 text-[10px] text-tocineta-green flex items-center gap-1 font-semibold">
                    <span>✓</span> Foto seleccionada y lista para cargar localmente
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-3 border-t border-tocineta-border">
              <button
                onClick={closeProductModal}
                className="flex-1 py-2.5 rounded-xl border border-tocineta-border text-xs font-bold text-tocineta-muted hover:text-white hover:bg-tocineta-bg"
              >
                Cancelar
              </button>
              <button
                onClick={() => saveProductMutation.mutate()}
                disabled={saveProductMutation.isPending || !formName || !formPriceUsd}
                className="flex-1 py-2.5 rounded-xl bg-tocineta-yellow text-tocineta-bg text-xs font-extrabold uppercase hover:bg-tocineta-yellow/90 disabled:opacity-50 shadow-md"
              >
                {saveProductMutation.isPending ? 'Guardando...' : 'Guardar Producto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
