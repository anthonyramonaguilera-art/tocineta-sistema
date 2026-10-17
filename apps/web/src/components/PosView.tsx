import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.js';
import type { PosMenuResponse, PosProduct } from '../types/menu.js';

export const PosView: React.FC = () => {
  const { currency } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const { data: menu, isLoading, error } = useQuery<PosMenuResponse>({
    queryKey: ['posMenu'],
    queryFn: async () => {
      const res = await fetch('/api/menu/pos');
      if (!res.ok) throw new Error('Error al consultar catálogo POS');
      return res.json();
    },
    staleTime: 5000
  });

  if (isLoading) {
    return (
      <div className="py-20 text-center text-tocineta-yellow">
        <span className="text-3xl animate-spin inline-block">🍔</span>
        <p className="mt-3 text-sm font-semibold">Cargando menú operativo del Food Truck...</p>
      </div>
    );
  }

  if (error || !menu || !menu.success) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-2xl text-center text-red-400">
        <p className="font-bold">Error al cargar el catálogo de venta</p>
        <p className="text-xs text-tocineta-muted mt-1">Verifique la conexión LAN con el servidor local Fastify</p>
      </div>
    );
  }

  const formatPrice = (usdCents: number, bsCents: number) => {
    if (currency === 'BS') {
      return `${(bsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`;
    }
    return `$${(usdCents / 100).toFixed(2)}`;
  };

  const categories = menu.categories || [];
  const allProducts: (PosProduct & { categoryName: string })[] = [];
  for (const cat of categories) {
    for (const p of cat.products) {
      allProducts.push({ ...p, categoryName: cat.name });
    }
  }

  const filteredProducts = allProducts.filter(p => {
    const matchCat = selectedCategory === 'all' || categories.find(c => c.id === selectedCategory)?.products.some(cp => cp.id === p.id);
    const matchSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="space-y-6">
      {/* Barra de Filtros por Categoría y Buscador */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Pills de Categorías */}
        <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
              selectedCategory === 'all'
                ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white'
            }`}
          >
            Todos ({allProducts.length})
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
                selectedCategory === cat.id
                  ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                  : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white'
              }`}
            >
              {cat.name} ({cat.products.length})
            </button>
          ))}
        </div>

        {/* Buscador Rápido */}
        <div className="w-full md:w-64">
          <input
            type="text"
            placeholder="Buscar producto..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-tocineta-card border border-tocineta-border rounded-xl px-4 py-2 text-xs text-white placeholder-tocineta-muted focus:border-tocineta-yellow outline-none"
          />
        </div>
      </div>

      {/* Grilla de Productos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredProducts.map(p => (
          <div
            key={p.id}
            className={`bg-tocineta-card border rounded-2xl p-4 flex flex-col justify-between transition-all shadow-md relative overflow-hidden ${
              p.isAvailable
                ? 'border-tocineta-border hover:border-tocineta-yellow/50 hover:shadow-lg'
                : 'border-red-950/60 bg-red-950/10 opacity-70'
            }`}
          >
            {/* Banner Agotado */}
            {!p.isAvailable && (
              <div className="absolute top-3 right-3 bg-red-600 text-white text-[10px] font-extrabold uppercase px-2 py-0.5 rounded shadow">
                Agotado
              </div>
            )}

            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold text-tocineta-muted tracking-wider">
                    {p.categoryName}
                  </span>
                  <h3 className="font-bold text-base text-white mt-0.5 leading-snug">{p.name}</h3>
                </div>
              </div>

              {p.description && (
                <p className="text-xs text-tocineta-muted mt-1.5 line-clamp-2">{p.description}</p>
              )}

              {/* Sabores si aplica (ej. Refresco 1 Lt) */}
              {p.allowsFlavors && p.flavors.length > 0 && (
                <div className="mt-3 pt-2 border-t border-tocineta-border/60">
                  <span className="text-[10px] font-bold text-tocineta-muted uppercase tracking-wider block mb-1">
                    Sabores Disponibles:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {p.flavors.map(f => (
                      <span
                        key={f.id}
                        className={`text-[10px] px-2 py-0.5 rounded-md border ${
                          f.isAvailable
                            ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                            : 'bg-red-500/10 border-red-500/30 text-red-400 line-through'
                        }`}
                      >
                        {f.flavorName}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Precio y Estación */}
            <div className="mt-4 pt-3 border-t border-tocineta-border flex items-center justify-between">
              <div>
                <span className="text-[10px] text-tocineta-muted uppercase font-semibold block">Precio:</span>
                <span className="text-lg font-black text-tocineta-yellow font-mono">
                  {formatPrice(p.priceUsdCents, p.priceBsCents)}
                </span>
              </div>
              <span className="text-[10px] px-2.5 py-1 rounded-full bg-tocineta-border text-tocineta-muted font-mono uppercase">
                {p.station}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Sección Informativa de Barra Libre ($0.00) y Tarifas Delivery */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-tocineta-border">
        {/* Barra Libre */}
        <div className="bg-tocineta-card border border-tocineta-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">🥗</span>
            <div>
              <h4 className="text-sm font-bold text-white">Barra Libre Oficial ($0.00 Venta)</h4>
              <p className="text-xs text-tocineta-muted">Ingredientes adicionales sin costo para Hot Dogs y Hamburguesas</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {menu.barraLibreIngredients.map(b => (
              <span
                key={b.id}
                className="text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-medium px-2.5 py-1 rounded-lg"
              >
                + {b.name}
              </span>
            ))}
          </div>
        </div>

        {/* Zonas de Delivery */}
        <div className="bg-tocineta-card border border-tocineta-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">🛵</span>
            <div>
              <h4 className="text-sm font-bold text-white">Tarifas de Delivery (Fondo Motorizado)</h4>
              <p className="text-xs text-tocineta-muted">Zonas rápidas oficiales liquidadas a motorizados externos</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-2">
            {menu.deliveryQuickTiers.map(t => (
              <div
                key={t.usdCents}
                className="bg-tocineta-bg border border-tocineta-border rounded-xl p-2 text-center"
              >
                <div className="text-xs font-bold text-white">{t.label}</div>
                <div className="text-[10px] text-tocineta-yellow font-mono">{formatPrice(t.usdCents, t.bsCents)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
