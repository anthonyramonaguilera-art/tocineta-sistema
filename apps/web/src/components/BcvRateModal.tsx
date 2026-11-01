import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Field, Icon } from '../ui/index.js';
import { apiFetch } from '../api/client.js';
import { queryClient } from '../App.js';

interface BcvRateModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
  formattedRate: string;
}

export const BcvRateModal: React.FC<BcvRateModalProps> = ({
  isOpen,
  onClose,
  token,
  formattedRate
}) => {
  const [manualBcvInput, setManualBcvInput] = useState(() => formattedRate.replace(',', '.'));
  const [bcvModalMsg, setBcvModalMsg] = useState<string | null>(null);
  const [isSavingBcv, setIsSavingBcv] = useState(false);
  const [isSyncingBcv, setIsSyncingBcv] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setManualBcvInput(formattedRate.replace(',', '.'));
      setBcvModalMsg(null);
    }
  }, [isOpen, formattedRate]);

  const handleSaveManualBcv = async () => {
    const parsed = parseFloat(manualBcvInput.replace(',', '.'));
    if (isNaN(parsed) || parsed <= 0) {
      setBcvModalMsg('Ingresa una tasa numérica válida');
      return;
    }
    setIsSavingBcv(true);
    try {
      const rateMicroBs = Math.round(parsed * 1_000_000);
      const res = await apiFetch('/api/menu/exchange-rate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ rateMicroBs })
      });
      const data = await res.json();
      if (res.ok) {
        setBcvModalMsg(`Tasa guardada: ${data.formattedRate} Bs/$`);
        queryClient.invalidateQueries({ queryKey: ['posMenu'] });
        queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
        setTimeout(() => onClose(), 1000);
      } else {
        setBcvModalMsg(data.error || 'Error al guardar tasa');
      }
    } catch {
      setBcvModalMsg('Error de conexión al servidor');
    } finally {
      setIsSavingBcv(false);
    }
  };

  const handleSyncBcv = async () => {
    setIsSyncingBcv(true);
    setBcvModalMsg(null);
    try {
      const res = await apiFetch('/api/menu/exchange-rate/sync-now', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (data.updated) {
        setBcvModalMsg(`Tasa BCV sincronizada: ${data.formattedRate}`);
        queryClient.invalidateQueries({ queryKey: ['posMenu'] });
        queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
        setTimeout(() => onClose(), 1200);
      } else {
        setBcvModalMsg(data.message || data.error || 'La tasa BCV ya se encuentra actualizada');
      }
    } catch {
      setBcvModalMsg('Fallo al contactar el servidor para sincronizar BCV');
    } finally {
      setIsSyncingBcv(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Actualizar Tasa Oficial BCV"
    >
      <div className="space-y-4">
        <p className="text-xs text-ink-muted">
          Define la tasa de cambio oficial en Bolívares por Dólar (Bs/USD) que regirá todos los cobros del sistema.
        </p>

        <button
          type="button"
          onClick={handleSyncBcv}
          disabled={isSyncingBcv}
          className="w-full min-h-[48px] rounded-xl bg-surface border border-border hover:border-primary/50 text-ink font-bold text-xs transition-all flex items-center justify-center gap-2"
        >
          <Icon name="RefreshCw" size={16} className={isSyncingBcv ? 'animate-spin' : ''} />
          <span>{isSyncingBcv ? 'Sincronizando con BCV oficial...' : 'Sincronizar con BCV (automático)'}</span>
        </button>

        <Field label="Tasa BCV (Bs/$)" hint="Solo si falla el automático" required>
          <Input
            type="text"
            value={manualBcvInput}
            onChange={(e) => setManualBcvInput(e.target.value)}
            placeholder="Ej: 42.50"
            leftIcon={<Icon name="DollarSign" size={18} />}
            autoFocus
          />
        </Field>

        {bcvModalMsg && (
          <div className={`p-3 rounded-xl text-xs font-bold text-center ${
            bcvModalMsg.includes('guardada') || bcvModalMsg.includes('sincronizada')
              ? 'bg-success/10 border border-success/30 text-success'
              : 'bg-danger/10 border border-danger/30 text-danger'
          }`}>
            {bcvModalMsg}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            variant="ghost"
            className="flex-1 min-h-[48px]"
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="flex-1 min-h-[48px]"
            loading={isSavingBcv}
            onClick={handleSaveManualBcv}
          >
            Guardar Tasa
          </Button>
        </div>
      </div>
    </Modal>
  );
};
