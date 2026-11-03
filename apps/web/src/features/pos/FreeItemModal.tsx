import React, { useState, useEffect } from 'react';
import { Modal } from '../../ui/Modal.js';
import { Button } from '../../ui/Button.js';
import { Input } from '../../ui/Input.js';
import { Select } from '../../ui/Select.js';
import { Icon } from '../../ui/Icon.js';

interface FreeItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string, priceUsdCents: number, quantity: number, station: string) => void;
}

const STATION_OPTIONS = [
  { value: 'hamburguesas', label: 'Hamburguesas / Plancha' },
  { value: 'hot_dogs', label: 'Hot Dogs / Cocina' },
  { value: 'caja_bebidas', label: 'Bebidas / Caja' }
];

export const FreeItemModal: React.FC<FreeItemModalProps> = ({
  isOpen,
  onClose,
  onAdd
}) => {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [station, setStation] = useState('hamburguesas');
  const [touched, setTouched] = useState<{ name?: boolean; price?: boolean; quantity?: boolean }>({});

  useEffect(() => {
    if (isOpen) {
      setName('');
      setPrice('');
      setQuantity('1');
      setStation('hamburguesas');
      setTouched({});
    }
  }, [isOpen]);

  const trimmedName = name.trim();
  const nameError = !trimmedName
    ? 'El nombre es obligatorio'
    : trimmedName.length > 60
      ? 'Máximo 60 caracteres'
      : null;

  const parsedPrice = parseFloat(price);
  const priceCents = Math.round(parsedPrice * 100);
  const priceError = !price.trim()
    ? 'El precio es obligatorio'
    : isNaN(parsedPrice) || priceCents < 1 || priceCents > 50000
      ? 'Precio debe estar entre $0.01 y $500.00'
      : null;

  const parsedQty = parseInt(quantity, 10);
  const quantityError = !quantity.trim()
    ? 'La cantidad es obligatoria'
    : isNaN(parsedQty) || parsedQty < 1 || parsedQty > 99
      ? 'Cantidad debe ser un entero entre 1 y 99'
      : null;

  const isValid = !nameError && !priceError && !quantityError;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isValid) return;
    onAdd(trimmedName, priceCents, parsedQty, station);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Agregar Ítem Libre"
      description="Registra un producto fuera de carta con precio y estación personalizada"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="free-item-name" className="block text-xs font-bold text-ink mb-1.5 uppercase">
            Nombre del Ítem
          </label>
          <Input
            id="free-item-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
            placeholder="Ej: Torta de tres leches, Ensalada especial..."
            maxLength={60}
            hasError={Boolean(touched.name && nameError)}
            autoFocus
          />
          {touched.name && nameError && (
            <p role="alert" className="text-xs text-danger font-semibold mt-1">
              {nameError}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="free-item-price" className="block text-xs font-bold text-ink mb-1.5 uppercase">
              Precio USD
            </label>
            <Input
              id="free-item-price"
              type="number"
              step="0.01"
              min="0.01"
              max="500.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, price: true }))}
              placeholder="0.00"
              leftIcon={<span className="text-sm font-black text-ink-muted">$</span>}
              hasError={Boolean(touched.price && priceError)}
            />
            {touched.price && priceError && (
              <p role="alert" className="text-xs text-danger font-semibold mt-1">
                {priceError}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="free-item-quantity" className="block text-xs font-bold text-ink mb-1.5 uppercase">
              Cantidad
            </label>
            <Input
              id="free-item-quantity"
              type="number"
              step="1"
              min="1"
              max="99"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, quantity: true }))}
              placeholder="1"
              hasError={Boolean(touched.quantity && quantityError)}
            />
            {touched.quantity && quantityError && (
              <p role="alert" className="text-xs text-danger font-semibold mt-1">
                {quantityError}
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="free-item-station" className="block text-xs font-bold text-ink mb-1.5 uppercase">
            Estación de Preparación
          </label>
          <Select
            id="free-item-station"
            value={station}
            onChange={(e) => setStation(e.target.value)}
            options={STATION_OPTIONS}
          />
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t border-border mt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="min-h-[48px]"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!isValid}
            leftIcon={<Icon name="Plus" size={16} />}
            className="min-h-[48px]"
          >
            Agregar al pedido
          </Button>
        </div>
      </form>
    </Modal>
  );
};
