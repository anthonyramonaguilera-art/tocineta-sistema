import React, { useState, useMemo } from 'react';
import type { PosProduct, PosCategory } from '../../types/menu.js';
import type { CartItem } from './types.js';
import { Card, Input, Money, Icon, Chips, Button } from '../../ui/index.js';
import { ProductImagePlaceholder } from '../../components/ProductImagePlaceholder.js';
import { useAuth } from '../../context/AuthContext.js';
import { FreeItemModal } from './FreeItemModal.js';

interface Step2CatalogProps {
  categories: PosCategory[];
  products: Array<PosProduct & { categoryId?: string }>;
  cart: CartItem[];
  onAddProduct: (product: PosProduct) => void;
  onDecrementProduct: (productId: string) => void;
  onOpenCustomize: (product: PosProduct) => void;
  onOpenCombo: (product: PosProduct) => void;
  formattedRate: string;
  onAddFreeItem?: (name: string, priceUsdCents: number, quantity: number, station: string) => void;
}

export const Step2Catalog: React.FC<Step2CatalogProps> = ({
  categories,
  products,
  cart,
  onAddProduct,
  onDecrementProduct,
  onOpenCustomize,
  onOpenCombo,
  formattedRate,
  onAddFreeItem
}) => {
  const { user } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isFreeItemModalOpen, setIsFreeItemModalOpen] = useState(false);

  const canAddFree = Boolean(
    user?.role === 'admin' ||
    (Array.isArray(user?.permissions) && user.permissions.includes('canAddFreeItem')) ||
    ((user as any)?.permissions_json?.canAddFreeItem === true) ||
    (user?.role && ['cajera', 'supervisor'].includes(user.role) && !user?.permissions?.includes('canAddFreeItem') && (user as any)?.permissions_json?.canAddFreeItem !== false)
  );

  // Filtrado de productos por categoría y búsqueda
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (selectedCategory !== 'all' && p.categoryId && p.categoryId !== selectedCategory) {
        return false;
      }
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(query);
        const matchesDesc = (p.description || '').toLowerCase().includes(query);
        return matchesName || matchesDesc;
      }
      return true;
    });
  }, [products, selectedCategory, searchTerm]);

  // Mapa de cantidades por producto en el carrito
  const cartQtyByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of cart) {
      map.set(item.productId, (map.get(item.productId) || 0) + item.quantity);
    }
    return map;
  }, [cart]);

  const categoryChips = useMemo(() => {
    return [
      { id: 'all', label: 'Todos' },
      ...categories.map((c) => ({ id: c.id, label: c.name }))
    ];
  }, [categories]);

  const handleProductClick = (product: PosProduct) => {
    if (product.isAvailable === false) return;
    if (product.isCombo) {
      onOpenCombo(product);
    } else {
      onAddProduct(product);
    }
  };

  const handleOpenCustomizeModal = (e: React.MouseEvent, product: PosProduct) => {
    e.stopPropagation();
    if (product.isAvailable === false) return;
    if (product.isCombo) {
      onOpenCombo(product);
    } else {
      onOpenCustomize(product);
    }
  };

  return (
    <div className="space-y-4 pb-6 max-w-4xl mx-auto">
      {/* 1. Barra de Búsqueda y Filtros */}
      <div className="space-y-2 sticky top-14 bg-surface-alt/95 backdrop-blur-xs py-2 z-10">
        <div className="flex gap-2 items-center">
          <div className="flex-1 min-w-0">
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar plato, ingrediente o combo..."
              leftIcon={<Icon name="Search" size={18} />}
              rightIcon={
                searchTerm ? (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="text-ink-muted hover:text-ink p-1"
                  >
                    <Icon name="X" size={16} />
                  </button>
                ) : undefined
              }
            />
          </div>
          {canAddFree && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsFreeItemModalOpen(true)}
              leftIcon={<Icon name="Plus" size={16} />}
              className="min-h-[48px] shrink-0 font-bold whitespace-nowrap"
            >
              Ítem libre
            </Button>
          )}
        </div>

        {/* Chips Desplazables de Categoría */}
        <div className="pt-1">
          <Chips
            items={categoryChips}
            selectedId={selectedCategory}
            onSelect={setSelectedCategory}
          />
        </div>
      </div>

      {/* 2. Grilla de 2 Columnas de Productos */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-4">
        {filteredProducts.map((product) => {
          const soldOut = product.isAvailable === false;
          const inCartQty = cartQtyByProduct.get(product.id) || 0;
          return (
            <Card
              key={product.id}
              variant={soldOut ? 'surface' : inCartQty > 0 ? 'interactive' : 'surface'}
              onClick={() => handleProductClick(product)}
              aria-disabled={soldOut ? 'true' : undefined}
              className={`p-2.5 sm:p-3 flex flex-col justify-between rounded-2xl border-2 transition-all relative group ${
                soldOut
                  ? 'border-border/60 opacity-60 cursor-not-allowed select-none'
                  : inCartQty > 0
                  ? 'border-primary shadow-sm bg-primary/5 cursor-pointer'
                  : 'border-border hover:border-primary/50 cursor-pointer'
              }`}
            >
              {/* Foto 4:3 o Fondo de Marca */}
              <div className="relative">
                <ProductImagePlaceholder
                  imageUrl={product.imageUrl}
                  name={product.name}
                  aspectRatio="4/3"
                  className="w-full"
                />

                {/* Badge de Combo o Agotado */}
                {soldOut ? (
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-danger-subtle text-danger border border-danger/30 text-[10px] font-black uppercase shadow-xs flex items-center gap-1">
                    <Icon name="PowerOff" size={11} />
                    <span>Agotado</span>
                  </span>
                ) : product.isCombo ? (
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-primary text-primary-ink text-[10px] font-black uppercase shadow-xs">
                    Combo
                  </span>
                ) : null}

                {/* Botón Personalizar */}
                <button
                  type="button"
                  onClick={(e) => handleOpenCustomizeModal(e, product)}
                  disabled={soldOut}
                  title={soldOut ? 'Producto agotado' : 'Personalizar ingredientes'}
                  className={`absolute bottom-2 right-2 p-1.5 rounded-xl bg-surface/90 text-ink border border-border shadow-xs backdrop-blur-xs transition-transform ${
                    soldOut ? 'opacity-40 cursor-not-allowed' : 'hover:bg-surface active:scale-90'
                  }`}
                >
                  <Icon name="Sliders" size={14} />
                </button>
              </div>

              {/* Nombre y Precio */}
              <div className="mt-2.5 flex-1 flex flex-col justify-between">
                <div>
                  <h3 className="font-black text-xs sm:text-sm text-ink line-clamp-2 leading-snug">
                    {product.name}
                  </h3>
                  {product.description && (
                    <p className="text-[10px] text-ink-muted line-clamp-1 mt-0.5">
                      {product.description}
                    </p>
                  )}
                </div>

                <div className="mt-2 pt-2 border-t border-border flex items-end justify-between gap-1">
                  <div>
                    <Money
                      cents={product.priceUsdCents}
                      rate={formattedRate}
                      size="sm"
                    />
                  </div>

                  {/* Controles Táctiles − y + si ya está en el pedido */}
                  {soldOut ? (
                    <button
                      type="button"
                      disabled
                      aria-label="Producto agotado"
                      className="w-7 h-7 rounded-xl bg-surface-alt border border-border text-ink-muted/40 flex items-center justify-center cursor-not-allowed"
                    >
                      <Icon name="PowerOff" size={13} />
                    </button>
                  ) : inCartQty > 0 ? (
                    <div
                      className="flex items-center gap-1 bg-surface rounded-xl border border-border p-0.5 shadow-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onDecrementProduct(product.id)}
                        className="w-7 h-7 rounded-lg bg-surface-alt hover:bg-danger/10 hover:text-danger text-ink flex items-center justify-center font-black transition-colors"
                        aria-label="Restar 1"
                      >
                        <Icon name="Minus" size={13} />
                      </button>
                      <span className="w-5 text-center text-xs font-black font-mono text-ink">
                        {inCartQty}
                      </span>
                      <button
                        type="button"
                        onClick={() => onAddProduct(product)}
                        className="w-7 h-7 rounded-lg bg-primary text-primary-ink flex items-center justify-center font-black transition-colors"
                        aria-label="Sumar 1"
                      >
                        <Icon name="Plus" size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-xl bg-surface-alt border border-border group-hover:bg-primary group-hover:border-primary group-hover:text-primary-ink text-ink-muted flex items-center justify-center transition-colors">
                      <Icon name="Plus" size={14} />
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {filteredProducts.length === 0 && (
        <div className="p-8 text-center bg-surface rounded-2xl border border-border space-y-2">
          <Icon name="Search" size={32} className="mx-auto text-ink-muted opacity-40" />
          <h4 className="font-bold text-sm text-ink">No se encontraron productos</h4>
          <p className="text-xs text-ink-muted">Prueba buscando con otro término o categoría.</p>
        </div>
      )}

      {canAddFree && (
        <FreeItemModal
          isOpen={isFreeItemModalOpen}
          onClose={() => setIsFreeItemModalOpen(false)}
          onAdd={(name, priceUsdCents, quantity, station) => {
            onAddFreeItem?.(name, priceUsdCents, quantity, station);
          }}
        />
      )}

    </div>
  );
};

export default Step2Catalog;
