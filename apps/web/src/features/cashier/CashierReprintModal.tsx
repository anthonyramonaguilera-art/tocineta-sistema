import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Select, Field } from '../../ui/index.js';
import { apiFetch } from '../../api/client.js';
import { fetchOrderPrintJobs, pickOriginalJobs } from './useOrderPrintJobs.js';
import type { PaidSale } from './CashierSalesTab.js';

interface CashierReprintModalProps {
  reprintingSale: PaidSale | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

interface ReprintOption {
  jobId: string;
  label: string;
}

const REASON_OPTIONS = [
  { value: 'CLIENTE_SOLICITA_COPIA', label: 'Cliente solicita copia adicional' },
  { value: 'ATASCO_PAPEL_IMPRESORA', label: 'Atasco o error de papel en impresora' },
  { value: 'TICKET_ILEGIBLE', label: 'Ticket anterior ilegible' },
  { value: 'OTRO_MOTIVO', label: 'Otro motivo operativo' }
];

export const CashierReprintModal: React.FC<CashierReprintModalProps> = ({ reprintingSale, onClose, onDone }) => {
  const [options, setOptions] = useState<ReprintOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('CLIENTE_SOLICITA_COPIA');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!reprintingSale) return;
    setPin('');
    setReason('CLIENTE_SOLICITA_COPIA');
    setError(null);
    setIsLoadingJobs(true);
    fetchOrderPrintJobs(reprintingSale.orderId)
      .then((jobs) => {
        const { nota, kitchen } = pickOriginalJobs(jobs);
        const list: ReprintOption[] = [];
        if (nota) list.push({ jobId: nota.id, label: 'Nota de entrega (caja)' });
        for (const k of kitchen) {
          const label =
            k.station === 'hot_dogs' ? 'Comanda Cocina - Hot Dogs'
            : k.station === 'hamburguesas' ? 'Comanda Cocina - Hamburguesas'
            : `Comanda Cocina - ${k.station}`;
          list.push({ jobId: k.job.id, label });
        }
        setOptions(list);
        if (nota) setSelected(new Set([nota.id]));
        else if (list.length === 1) setSelected(new Set([list[0].jobId]));
        else setSelected(new Set());
      })
      .catch((err: any) => setError(err?.message || 'Error al cargar comprobantes'))
      .finally(() => setIsLoadingJobs(false));
  }, [reprintingSale]);

  if (!reprintingSale) return null;

  const allSelected = options.length > 0 && selected.size === options.length;

  const toggleJob = (jobId: string) => {
    const next = new Set(selected);
    if (next.has(jobId)) next.delete(jobId);
    else next.add(jobId);
    setSelected(next);
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(options.map((o) => o.jobId)));
  };

  const handleConfirm = async () => {
    if (selected.size === 0 || pin.trim().length < 4) return;
    setIsSubmitting(true);
    setError(null);
    const ids = Array.from(selected);
    let sent = 0;
    for (const jobId of ids) {
      try {
        const res = await apiFetch(`/api/print-jobs/${jobId}/reprint`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: pin.trim(), reason })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(`${data.message || data.error || 'No autorizado o error al reimprimir'} (${sent} de ${ids.length} reenviados)`);
          setIsSubmitting(false);
          return;
        }
        sent += 1;
      } catch (err: any) {
        setError(`${err?.message || 'Error de red'} (${sent} de ${ids.length} reenviados)`);
        setIsSubmitting(false);
        return;
      }
    }
    setIsSubmitting(false);
    onDone(`${sent} comprobante(s) reenviado(s) a la impresora.`);
  };

  const optionClass = (checked: boolean) =>
    `w-full min-h-[48px] px-4 py-2 rounded-xl border text-left text-sm font-medium transition ${
      checked ? 'border-primary bg-primary/10 text-ink' : 'border-border bg-surface text-ink'
    }`;

  return (
    <Modal isOpen={true} onClose={onClose} title={`Reimprimir Orden #${reprintingSale.orderNumber}`}>
      <div className="space-y-4">
        {isLoadingJobs && <p className="text-sm text-ink-muted">Consultando comprobantes de la orden...</p>}
        {!isLoadingJobs && options.length === 0 && (
          <p className="text-sm text-danger">No se encontraron comprobantes originales para esta orden.</p>
        )}
        {!isLoadingJobs && options.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-ink-muted">Selecciona que deseas reimprimir:</p>
            {options.length > 1 && (
              <button type="button" onClick={toggleAll} className={optionClass(allSelected)}>
                {allSelected ? '[X] Todo el paquete' : '[ ] Todo el paquete'}
              </button>
            )}
            {options.map((opt) => (
              <button key={opt.jobId} type="button" onClick={() => toggleJob(opt.jobId)} className={optionClass(selected.has(opt.jobId))}>
                {selected.has(opt.jobId) ? `[X] ${opt.label}` : `[ ] ${opt.label}`}
              </button>
            ))}
          </div>
        )}

        <Field label="Motivo de reimpresion" required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)} options={REASON_OPTIONS} />
        </Field>

        <Field label="PIN de Autorizacion (Cajera/Supervisor)" required>
          <Input type="password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Ingresa tu PIN" />
        </Field>

        {error && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs font-semibold text-danger">{error}</div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
          <Button variant="primary" onClick={handleConfirm} disabled={isSubmitting || selected.size === 0 || pin.trim().length < 4}>
            {isSubmitting ? 'Reimprimiendo...' : 'Confirmar reimpresion'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
