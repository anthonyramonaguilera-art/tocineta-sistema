import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';

interface ApplyCouponModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  orderNumber: number;
  currentCouponId?: string | null;
  currentDiscountCents?: number;
  hasCourtesyLine?: boolean;
  onSuccess: () => void;
}

export const ApplyCouponModal: React.FC<ApplyCouponModalProps> = ({
  isOpen,
  onClose,
  orderId,
  orderNumber,
  currentCouponId,
  currentDiscountCents = 0,
  hasCourtesyLine = false,
  onSuccess
}) => {
  const { token } = useAuth();
  const [couponCodeInput, setCouponCodeInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleApplyCoupon = async (codeToApply: string) => {
    const cleanCode = codeToApply.trim().toUpperCase();
    if (!cleanCode) {
      setErrorMsg('Por favor ingrese un código de cupón');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/orders/${orderId}/apply-coupon`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ couponCode: cleanCode })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'No se pudo aplicar el cupón');
      }

      setSuccessMsg(data.message || `Cupón ${cleanCode} aplicado con éxito`);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 700);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al validar cupón');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveCoupon = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/orders/${orderId}/remove-coupon`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'No se pudo quitar el cupón');
      }

      setSuccessMsg('Cupón removido con éxito');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 600);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al remover cupón');
    } finally {
      setIsLoading(false);
    }
  };

  const popularCoupons = [
    { code: 'PARATI10', label: 'PARATI10', desc: '10% de Descuento en Comida', icon: '🏷️' },
    { code: 'BIENVENIDA1', label: 'BIENVENIDA1', desc: '$1.00 OFF en la Orden', icon: '💵' },
    { code: 'CAFEGRATIS', label: 'CAFEGRATIS', desc: '1x Café de Cortesía ($0.00)', icon: '☕' },
    { code: 'SNACKSGRATIS', label: 'SNACKSGRATIS', desc: '1x Doritos Dog Snacks ($0.00)', icon: '🌭' }
  ];

  const hasActiveCoupon = Boolean(currentCouponId) || currentDiscountCents > 0 || hasCourtesyLine;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in">
      <div className="bg-tocineta-card border border-tocineta-border rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5">
        
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-tocineta-border pb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎁</span>
            <div>
              <h3 className="font-black text-base text-white">
                Cupones para ti • Orden #{orderNumber}
              </h3>
              <p className="text-xs text-tocineta-muted">
                Aplica descuentos automáticos o ítems de cortesía al 100% en local
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-tocineta-bg text-tocineta-muted hover:text-white flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* Notificaciones */}
        {errorMsg && (
          <div className="p-3 rounded-2xl bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-bold flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2">
            <span>✓</span>
            <span>{successMsg}</span>
          </div>
        )}

        {/* Si ya tiene cupón aplicado: Permitir removerlo */}
        {hasActiveCoupon && (
          <div className="p-3.5 bg-tocineta-bg border border-tocineta-yellow/40 rounded-2xl flex items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-tocineta-yellow block">
                Cupón Actualmente Aplicado
              </span>
              <span className="text-sm font-black text-white">
                {currentDiscountCents > 0 ? `Descuento: -$${(currentDiscountCents / 100).toFixed(2)}` : 'Ítem de Cortesía [OBSEQUIO CUPÓN - $0.00]'}
              </span>
            </div>
            <button
              type="button"
              disabled={isLoading}
              onClick={handleRemoveCoupon}
              className="px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 text-xs font-bold transition-all disabled:opacity-50"
            >
              {isLoading ? 'Quitando...' : '✕ Quitar Cupón'}
            </button>
          </div>
        )}

        {/* Input Manual de Código */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-tocineta-muted block">
            Ingresar Código de Cupón:
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Ej: PARATI10, CAFEGRATIS..."
              value={couponCodeInput}
              onChange={e => setCouponCodeInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleApplyCoupon(couponCodeInput)}
              className="w-full min-h-[48px] bg-tocineta-bg border border-tocineta-border rounded-xl px-4 font-mono font-bold text-sm text-tocineta-yellow uppercase outline-none focus:border-tocineta-yellow"
            />
            <button
              type="button"
              disabled={isLoading || !couponCodeInput.trim()}
              onClick={() => handleApplyCoupon(couponCodeInput)}
              className="min-h-[48px] px-5 rounded-xl bg-tocineta-yellow text-tocineta-bg font-black text-xs hover:bg-tocineta-yellow-hover active:scale-95 transition-all disabled:opacity-40 shrink-0"
            >
              {isLoading ? 'Validando...' : 'Aplicar'}
            </button>
          </div>
        </div>

        {/* Botones Táctiles de Cupones Rápidos */}
        <div className="space-y-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-muted block">
            Cupones Populares de la Campaña:
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {popularCoupons.map(c => (
              <button
                key={c.code}
                type="button"
                disabled={isLoading}
                onClick={() => {
                  setCouponCodeInput(c.code);
                  handleApplyCoupon(c.code);
                }}
                className="p-3 rounded-2xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow text-left transition-all active:scale-95 flex items-center gap-3 disabled:opacity-50"
              >
                <span className="text-2xl">{c.icon}</span>
                <div>
                  <span className="font-mono font-black text-xs text-tocineta-yellow block">
                    {c.label}
                  </span>
                  <span className="text-[11px] text-tocineta-muted block">
                    {c.desc}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Pie de modal */}
        <div className="pt-2 border-t border-tocineta-border flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 rounded-xl bg-tocineta-bg border border-tocineta-border text-white text-xs font-bold hover:border-white transition-all"
          >
            Cerrar
          </button>
        </div>

      </div>
    </div>
  );
};
