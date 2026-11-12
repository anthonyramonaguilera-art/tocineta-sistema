import React, { useState } from 'react';
import { Button, Input, Field } from '../../ui/index.js';
import { apiFetch } from '../../api/client.js';

interface ZCloseStepProps {
  jornadaId: string;
  onClosed: () => void;
}

export const ZCloseStep: React.FC<ZCloseStepProps> = ({ jornadaId, onClosed }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCloseJornada = async () => {
    if (pin.trim().length < 4 || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setPendingCount(null);
    try {
      const res = await apiFetch(`/api/jornadas/${jornadaId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim(), supervisorPin: pin.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || data.message || 'No se pudo ejecutar el Cierre Z de la jornada.');
        if (data.code === 'UNPAID_ORDERS_PENDING' && typeof data.pendingCount === 'number') {
          setPendingCount(data.pendingCount);
        }
        setIsSubmitting(false);
        return;
      }
      setIsSubmitting(false);
      onClosed();
    } catch (err: any) {
      setError(err?.message || 'Error de conexion al cerrar la jornada.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface p-5 space-y-4 text-left">
      <h4 className="text-base font-bold text-ink">Termino el dia? Cierre Z de la jornada</h4>
      <p className="text-xs text-ink-muted">
        El Cierre Z sella las ventas del dia, guarda el reporte en Historial y deja el sistema en cero para la proxima jornada. Esta accion no se puede deshacer.
      </p>
      <div className="max-w-xs">
        <Field label="PIN de supervisor o administrador" required>
          <Input type="password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Ingresa PIN autorizador" />
        </Field>
      </div>
      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs font-bold text-danger space-y-1">
          <p>{error}</p>
          {pendingCount !== null && <p>Pedidos pendientes: {pendingCount}</p>}
        </div>
      )}
      <Button variant="danger" size="lg" leftIcon="Lock" onClick={handleCloseJornada} disabled={isSubmitting || pin.trim().length < 4}>
        {isSubmitting ? 'Cerrando jornada...' : 'Cerrar jornada (Cierre Z)'}
      </Button>
    </div>
  );
};
