import React, { useState } from 'react';

interface AuthorizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  orderNumber: number;
  tableNumber: string;
  totalUsdCents: number;
  onSuccess: () => void;
}

export const AuthorizeModal: React.FC<AuthorizeModalProps> = ({
  isOpen,
  onClose,
  orderId,
  orderNumber,
  tableNumber,
  totalUsdCents,
  onSuccess
}) => {
  if (!isOpen) return null;

  const [pin, setPin] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleKeyPress = (num: string) => {
    if (pin.length < 6) {
      setPin(prev => prev + num);
      setError(null);
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
    setError(null);
  };

  const handleClear = () => {
    setPin('');
    setError(null);
  };

  const handleSubmit = async () => {
    if (pin.length < 4) {
      setError('Ingrese un PIN válido de al menos 4 dígitos');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/orders/${orderId}/authorize-without-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'PIN no autorizado para despacho sin pago');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Error al autorizar pedido');
      setPin('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-tocineta-card border border-tocineta-border rounded-3xl w-full max-w-sm flex flex-col shadow-2xl overflow-hidden">
        
        {/* Cabecera */}
        <div className="p-4 bg-tocineta-bg border-b border-tocineta-border flex items-center justify-between">
          <div>
            <h3 className="font-black text-sm text-white">Autorizar Despacho Sin Pago</h3>
            <p className="text-xs text-tocineta-muted">
              Orden #{orderNumber} • {tableNumber} • ${(totalUsdCents / 100).toFixed(2)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-tocineta-card hover:bg-tocineta-border text-tocineta-muted hover:text-white flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* Mensaje de advertencia */}
        <div className="p-4 bg-amber-500/10 border-b border-amber-500/30 text-amber-300 text-xs space-y-1">
          <p className="font-bold flex items-center gap-1">
            <span>⚠️</span> Envío Inmediato a Cocina con Deuda Abierta
          </p>
          <p className="text-amber-300/80">
            Requiere PIN de Admin o Supervisor. El pedido pasará a "En Preparación" pero la deuda quedará pendiente en Caja.
          </p>
        </div>

        {/* Display de PIN */}
        <div className="p-4 flex flex-col items-center">
          <div className="w-full bg-tocineta-bg border border-tocineta-border rounded-2xl py-3 px-4 flex items-center justify-center gap-3 min-h-[52px]">
            {[0, 1, 2, 3, 4, 5].map(idx => (
              <span
                key={idx}
                className={`w-3.5 h-3.5 rounded-full transition-all ${
                  idx < pin.length
                    ? 'bg-tocineta-yellow scale-110 shadow-[0_0_8px_#FFE600]'
                    : 'bg-tocineta-border'
                }`}
              />
            ))}
          </div>

          {error && (
            <p className="text-xs text-red-400 font-bold mt-2 text-center">
              {error}
            </p>
          )}
        </div>

        {/* Teclado Táctil (Mínimo 48x48px) */}
        <div className="px-6 pb-4">
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
              <button
                key={num}
                type="button"
                onClick={() => handleKeyPress(num)}
                className="min-h-[52px] rounded-2xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow text-white font-bold text-lg active:scale-95 transition-all flex items-center justify-center shadow"
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              onClick={handleClear}
              className="min-h-[52px] rounded-2xl bg-tocineta-bg border border-tocineta-border text-tocineta-muted hover:text-white font-bold text-xs active:scale-95 transition-all flex items-center justify-center"
            >
              Borrar
            </button>
            <button
              type="button"
              onClick={() => handleKeyPress('0')}
              className="min-h-[52px] rounded-2xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow text-white font-bold text-lg active:scale-95 transition-all flex items-center justify-center shadow"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              className="min-h-[52px] rounded-2xl bg-tocineta-bg border border-tocineta-border text-tocineta-muted hover:text-white font-bold text-lg active:scale-95 transition-all flex items-center justify-center"
            >
              ⌫
            </button>
          </div>
        </div>

        {/* Botón de Confirmación */}
        <div className="p-4 bg-tocineta-bg border-t border-tocineta-border">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pin.length < 4 || isSubmitting}
            className="w-full min-h-[52px] rounded-2xl bg-tocineta-yellow text-tocineta-bg font-black text-sm disabled:opacity-40 disabled:pointer-events-none hover:bg-tocineta-yellow-hover active:scale-95 transition-all flex items-center justify-center gap-2 shadow-xl"
          >
            {isSubmitting ? (
              <span className="animate-spin">⏳</span>
            ) : (
              <span>✓ Confirmar Autorización</span>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
