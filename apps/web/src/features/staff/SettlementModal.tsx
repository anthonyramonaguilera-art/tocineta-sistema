import React, { useState, useEffect } from 'react';
import { Modal } from '../../ui/Modal.js';
import { Button } from '../../ui/Button.js';
import { Select } from '../../ui/Select.js';
import { Field } from '../../ui/Field.js';
import { Icon } from '../../ui/Icon.js';
import type { StaffUser, PayrollAdjustment, StaffConsumption } from './types.js';

interface SettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffList: StaffUser[];
  token: string | null;
  onSuccess: () => void;
}

export const SettlementModal: React.FC<SettlementModalProps> = ({
  isOpen,
  onClose,
  staffList,
  token,
  onSuccess
}) => {
  const activeEmployees = staffList.filter((s) => s.isActive !== false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [adjustments, setAdjustments] = useState<PayrollAdjustment[]>([]);
  const [consumptions, setConsumptions] = useState<StaffConsumption[]>([]);
  const [chargedIds, setChargedIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settledResult, setSettledResult] = useState<{ id: string; netUsdCents: number } | null>(null);

  const selectedEmployee = activeEmployees.find((e) => e.id === selectedUserId) || activeEmployees[0];

  useEffect(() => {
    if (selectedEmployee && isOpen) {
      loadDetails(selectedEmployee.id);
    }
  }, [selectedEmployee?.id, isOpen]);

  const loadDetails = async (userId: string) => {
    setIsLoadingDetails(true);
    setError(null);
    setSettledResult(null);

    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [adjRes, consRes] = await Promise.all([
        fetch(`/api/staff/payroll/adjustments/${userId}`, { headers }),
        fetch(`/api/staff/consumptions/${userId}`, { headers })
      ]);

      const adjData = await adjRes.json();
      const consData = await consRes.json();

      const adjs: PayrollAdjustment[] = (adjData.adjustments || []).map((a: any) => ({
        id: a.id,
        type: a.type,
        amountUsdCents: a.amountUsdCents ?? a.amount_usd_cents ?? 0,
        concept: a.concept,
        createdAtMs: a.createdAtMs ?? a.created_at_ms ?? Date.now()
      }));

      const conss: StaffConsumption[] = (consData.consumptions || []).map((c: any) => ({
        id: c.id,
        concept: c.concept,
        amountUsdCents: c.amountUsdCents ?? c.amount_usd_cents ?? 0,
        isFixedDinner: Boolean(c.isFixedDinner ?? c.is_fixed_dinner),
        status: c.status,
        createdAtMs: c.createdAtMs ?? c.created_at_ms ?? Date.now()
      }));

      setAdjustments(adjs);
      setConsumptions(conss);

      // Por defecto, consumos adicionales marcados para cobrar; cenas fijas nunca se cobran
      const initialCharged = conss
        .filter((c) => !c.isFixedDinner && c.status === 'PENDIENTE')
        .map((c) => c.id);
      setChargedIds(initialCharged);
    } catch {
      setError('Error al cargar datos del trabajador');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const toggleCharge = (id: string) => {
    if (chargedIds.includes(id)) {
      setChargedIds(chargedIds.filter((cid) => cid !== id));
    } else {
      setChargedIds([...chargedIds, id]);
    }
  };

  // Cálculos matemáticos en vivo
  const baseCents = selectedEmployee?.payrollProfile?.baseSalaryUsdCents || (selectedEmployee as any)?.payrollProfile?.base_salary_usd_cents || 0;
  const bonusesCents = adjustments
    .filter((a) => (a.type || '').toUpperCase() === 'BONO')
    .reduce((sum, a) => sum + (a.amountUsdCents || 0), 0);
  const advancesCents = adjustments
    .filter((a) => (a.type || '').toUpperCase() === 'ADELANTO')
    .reduce((sum, a) => sum + (a.amountUsdCents || 0), 0);

  const additionalConsumptions = consumptions.filter((c) => !c.isFixedDinner);
  const fixedDinners = consumptions.filter((c) => c.isFixedDinner);

  const chargedCents = additionalConsumptions
    .filter((c) => chargedIds.includes(c.id))
    .reduce((sum, c) => sum + c.amountUsdCents, 0);

  const netCents = baseCents + bonusesCents - advancesCents - chargedCents;

  const handleExecute = async () => {
    if (!selectedEmployee) return;
    try {
      setIsSubmitting(true);
      setError(null);

      const res = await fetch('/api/staff/settlements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          userId: selectedEmployee.id,
          periodStartMs: Date.now() - 7 * 86400000,
          periodEndMs: Date.now(),
          chargedConsumptionIds: chargedIds,
          notes
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al emitir liquidación');
      }

      const data = await res.json();
      setSettledResult({ id: data.settlementId, netUsdCents: data.netUsdCents });
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Error en la liquidación');
    } finally {
      setIsSubmitting(false);
    }
  };

  const downloadPdf = () => {
    if (!settledResult) return;
    window.open(`/api/staff/settlements/${settledResult.id}/pdf`, '_blank');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Liquidación de Nómina y Pagos"
      description="Revisa haberes, deducciones y elige qué consumos cobrar o perdonar"
      maxWidth="lg"
    >
      {settledResult ? (
        <div className="text-center py-6 space-y-4">
          <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto text-success">
            <Icon name="CheckCircle2" size={36} />
          </div>
          <h3 className="text-lg font-black text-ink">¡Liquidación Emitida Exitosamente!</h3>
          <p className="text-sm text-ink-muted">
            Neto pagado a {selectedEmployee?.name}: ${(settledResult.netUsdCents / 100).toFixed(2)} USD
          </p>
          <div className="flex gap-2 justify-center pt-4">
            <Button variant="primary" onClick={downloadPdf} leftIcon={<Icon name="FileDown" size={18} />}>
              Descargar Recibo en PDF
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {error && (
            <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger">
              {error}
            </div>
          )}

          <Field label="Seleccionar Empleado">
            <Select
              value={selectedEmployee?.id || ''}
              onChange={(e) => {
                setSelectedUserId(e.target.value);
                loadDetails(e.target.value);
              }}
              options={activeEmployees.map((s) => ({
                value: s.id,
                label: `${s.name} — ${s.role.toUpperCase()} (Base: $${((s.payrollProfile?.baseSalaryUsdCents || 0) / 100).toFixed(2)})`
              }))}
            />
          </Field>

          {isLoadingDetails ? (
            <div className="py-8 text-center text-ink-muted text-sm">Cargando cuentas del empleado...</div>
          ) : (
            <>
              {/* Resumen de Haberes */}
              <div className="p-3 bg-surface-alt rounded-xl border border-border space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-ink-muted font-medium">Salario Base ({selectedEmployee?.payrollProfile?.frequency || 'SEMANAL'})</span>
                  <span className="font-bold text-ink">+${(baseCents / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-ink-muted font-medium">Bonificaciones acumuladas</span>
                  <span className="font-bold text-success">+${(bonusesCents / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-ink-muted font-medium">Adelantos y vales entregados</span>
                  <span className="font-bold text-danger">-${(advancesCents / 100).toFixed(2)}</span>
                </div>
              </div>

              {/* Consumos: Dueña elige cobrar o perdonar */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-ink uppercase tracking-wider">
                  Consumos Adicionales (Elige cuáles cobrar o perdonar):
                </p>

                {additionalConsumptions.length === 0 ? (
                  <p className="text-xs text-ink-muted italic py-1">Sin consumos adicionales pendientes.</p>
                ) : (
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {additionalConsumptions.map((c) => {
                      const isCharged = chargedIds.includes(c.id);
                      return (
                        <div
                          key={c.id}
                          onClick={() => toggleCharge(c.id)}
                          className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer select-none transition-all ${
                            isCharged
                              ? 'bg-danger/5 border-danger/30 text-ink'
                              : 'bg-surface border-border text-ink-muted'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isCharged}
                              onChange={() => {}}
                              className="w-4 h-4 accent-danger cursor-pointer"
                            />
                            <div>
                              <p className="text-xs font-bold text-ink">{c.concept}</p>
                              <p className="text-[10px] text-ink-muted">
                                {isCharged ? 'Se descontará del neto' : 'Perdonado / Cortesía del local'}
                              </p>
                            </div>
                          </div>
                          <span className={`text-xs font-bold ${isCharged ? 'text-danger' : 'line-through text-ink-muted'}`}>
                            ${(c.amountUsdCents / 100).toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Cenas del turno */}
                {fixedDinners.length > 0 && (
                  <div className="p-2 bg-primary/5 border border-primary/20 rounded-xl text-xs flex justify-between items-center">
                    <span className="text-ink font-medium">
                      {fixedDinners.length} Cena(s) de personal (Asumida por TOCINETA):
                    </span>
                    <span className="font-bold text-primary">$0.00 (Gasto del Local)</span>
                  </div>
                )}
              </div>

              {/* Campo de Notas */}
              <Field label="Observaciones (Opcional)">
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Nota informativa de la liquidación"
                  className="w-full px-3 py-2 bg-surface border border-border rounded-xl text-xs text-ink"
                />
              </Field>

              {/* Total Neto Destacado */}
              <div className="p-4 bg-primary/10 border border-primary/30 rounded-xl flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold text-ink-muted uppercase">Neto Total a Liquidar</p>
                  <p className="text-[11px] text-ink-muted">Fórmula: Base + Bonos − Adelantos − Consumos Cobrados</p>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black text-primary">
                    ${(Math.max(0, netCents) / 100).toFixed(2)} USD
                  </span>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t border-border">
                <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button variant="primary" onClick={handleExecute} loading={isSubmitting}>
                  Emitir Liquidación
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};
