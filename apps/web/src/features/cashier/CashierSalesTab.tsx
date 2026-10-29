import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, Button, Badge, Modal, Input, Field, Select, EmptyState, Icon } from '../../ui/index.js';
import { getPaymentMethodHumanLabel } from './payment-labels.js';
import { formatTableLabel } from '../../lib/format.js';
import { invalidateMoney } from '../finances/queryKeys.js';
import { CashierReprintModal } from './CashierReprintModal.js';

interface PaidSale {
  orderId: string;
  orderNumber: number;
  customerName?: string | null;
  tableNumber?: string | null;
  totalUsdCents: number;
  totalBsCents: number;
  paidAtMs: number;
  primaryMethod: string;
}

interface CashierSalesTabProps {
  sales: PaidSale[];
  onRefresh: () => void;
  userRole?: string;
}

export const CashierSalesTab: React.FC<CashierSalesTabProps> = ({
  sales,
  onRefresh,
  userRole: _userRole = 'cajera'
}) => {
  const queryClient = useQueryClient();

  // Modal de Reimpresión
  const [reprintingSale, setReprintingSale] = useState<PaidSale | null>(null);
  const [reprintPin, setReprintPin] = useState<string>('');
  const [reprintReason, setReprintReason] = useState<string>('CLIENTE_SOLICITA_COPIA');
  const [isReprinting, setIsReprinting] = useState<boolean>(false);
  const [reprintError, setReprintError] = useState<string | null>(null);
  const [reprintSuccess, setReprintSuccess] = useState<string | null>(null);

  // Modal de Anulación / Reembolso
  const [voidingSale, setVoidingSale] = useState<PaidSale | null>(null);
  const [voidPin, setVoidPin] = useState<string>('');
  const [voidReason, setVoidReason] = useState<string>('CLIENTE_ARREPENTIDO');
  const [isVoiding, setIsVoiding] = useState<boolean>(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  // Modal de Salida de Caja Chica
  const [showExpenseModal, setShowExpenseModal] = useState<boolean>(false);
  const [expenseCategory, setExpenseCategory] = useState<string>('hielo_pan_insumos');
  const [expenseAmountUsd, setExpenseAmountUsd] = useState<string>('');
  const [expenseDesc, setExpenseDesc] = useState<string>('');
  const [isSavingExpense, setIsSavingExpense] = useState<boolean>(false);
  const [expenseMsg, setExpenseMsg] = useState<string | null>(null);

  const handleExecuteReprint = async () => {
    if (!reprintingSale) return;
    setIsReprinting(true);
    setReprintError(null);

    try {
      const jobsRes = await fetch(`/api/print-jobs?orderId=${reprintingSale.orderId}`);
      const jobsData = await jobsRes.json();
      if (!jobsRes.ok) {
        throw new Error(jobsData.message || 'Error al buscar trabajos de impresión');
      }

      const jobs = jobsData.data || [];
      const targetJob = jobs.find((j: any) => j.job_type === 'NOTA_ENTREGA' || j.job_type === 'TICKET_CLIENTE') || jobs[0];

      if (!targetJob) {
        throw new Error('No se encontró ningún trabajo de impresión registrado para esta orden');
      }

      const res = await fetch(`/api/print-jobs/${targetJob.id}/reprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: reprintPin.trim(),
          reason: reprintReason
        })
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.message || resData.error || 'No autorizado o error al reimprimir');
      }

      setReprintingSale(null);
      setReprintPin('');
      setReprintReason('CLIENTE_SOLICITA_COPIA');
      setReprintSuccess('Comprobante re-enviado a la impresora exitosamente.');
      setTimeout(() => setReprintSuccess(null), 4000);
    } catch (err: any) {
      setReprintError(err.message || 'Error al procesar la reimpresión');
    } finally {
      setIsReprinting(false);
    }
  };

  const handleExecuteVoid = async () => {
    if (!voidingSale) return;
    setIsVoiding(true);
    setVoidError(null);

    try {
      const res = await fetch(`/api/orders/${voidingSale.orderId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supervisorPin: voidPin.trim(),
          reason: voidReason
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'PIN incorrecto o no autorizado para anular ventas');
      }

      setVoidingSale(null);
      setVoidPin('');
      await invalidateMoney(queryClient);
      onRefresh();
    } catch (err: any) {
      setVoidError(err.message || 'Error al anular la venta');
    } finally {
      setIsVoiding(false);
    }
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingExpense(true);
    setExpenseMsg(null);

    const amountCents = Math.round(parseFloat(expenseAmountUsd || '0') * 100);
    if (amountCents <= 0) {
      setExpenseMsg('Ingresa un monto válido mayor a 0');
      setIsSavingExpense(false);
      return;
    }

    try {
      const res = await fetch('/api/cash-expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountUsdCents: amountCents,
          category: expenseCategory,
          description: expenseDesc.trim() || 'Gasto operativo de caja chica'
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Error al registrar gasto');

      setShowExpenseModal(false);
      setExpenseAmountUsd('');
      setExpenseDesc('');
      await invalidateMoney(queryClient);
      onRefresh();
    } catch (err: any) {
      setExpenseMsg(err.message || 'Error al registrar salida de caja');
    } finally {
      setIsSavingExpense(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Botón superior de Caja Chica */}
      <div className="flex justify-between items-center bg-surface-alt p-3.5 rounded-2xl border border-border">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-ink block">Caja Chica Operativa</span>
          <span className="text-xs text-ink-muted">Registra salidas menores por hielo, pan o emergencias de insumos</span>
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={() => setShowExpenseModal(true)}
          leftIcon="Banknote"
        >
          Salida de Caja Chica
        </Button>
      </div>

      {reprintSuccess && (
        <div className="p-3 bg-success/10 border border-success/30 rounded-xl text-xs font-bold text-success flex items-center gap-2">
          <Icon name="CheckCircle" className="w-4 h-4 shrink-0 text-success" />
          <span>{reprintSuccess}</span>
        </div>
      )}

      {/* Listado de Ventas del Día */}
      {sales.length === 0 ? (
        <EmptyState
          title="Sin cobros registrados hoy"
          description="Aún no se han completado transacciones en la jornada activa."
          icon="Receipt"
        />
      ) : (
        <div className="space-y-3">
          {sales.map(s => {
            const timeStr = new Date(s.paidAtMs).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
            return (
              <Card key={s.orderId} variant="surface" className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-border">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-black text-ink">#{s.orderNumber}</span>
                    <Badge variant="success">Cobrado</Badge>
                    <Badge variant="neutral">{getPaymentMethodHumanLabel(s.primaryMethod)}</Badge>
                    <span className="text-xs text-ink-muted font-mono">{timeStr}</span>
                  </div>
                  <p className="text-xs font-bold text-ink-muted mt-0.5">
                    Cliente: {s.customerName || 'Mostrador'} {s.tableNumber ? `• ${formatTableLabel(s.tableNumber)}` : ''}
                  </p>
                </div>

                <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-4">
                  <div className="text-right">
                    <span className="text-lg font-black text-ink font-mono block">
                      ${(s.totalUsdCents / 100).toFixed(2)}
                    </span>
                    <span className="text-xs text-ink-muted font-mono block">
                      {(s.totalBsCents / 100).toFixed(2)} Bs
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setReprintingSale(s)}
                      leftIcon="Receipt"
                    >
                      Recibo
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setReprintingSale(s)}
                      leftIcon="Printer"
                    >
                      Reimprimir
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setVoidingSale(s)}
                      leftIcon="RotateCcw"
                    >
                      Anular
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal de Salida de Caja Chica */}
      {showExpenseModal && (
        <Modal
          isOpen={showExpenseModal}
          onClose={() => setShowExpenseModal(false)}
          title="Salida de Caja Chica"
        >
          <form onSubmit={handleSaveExpense} className="space-y-4">
            {expenseMsg && (
              <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger">
                {expenseMsg}
              </div>
            )}
            <Field label="Categoría del gasto" required>
              <Select
                value={expenseCategory}
                onChange={e => setExpenseCategory(e.target.value)}
                options={[
                  { value: 'hielo_pan_insumos', label: 'Hielo / Pan / Insumos urgentes' },
                  { value: 'servilletas_bolsas', label: 'Empaques / Servilletas / Bolsas' },
                  { value: 'transporte_emergencia', label: 'Transporte / Logística de emergencia' },
                  { value: 'otros_menores', label: 'Otros gastos menores' }
                ]}
              />
            </Field>

            <Field label="Monto en Dólares ($)" required>
              <Input
                type="number"
                step="0.01"
                min="0.10"
                value={expenseAmountUsd}
                onChange={e => setExpenseAmountUsd(e.target.value)}
                placeholder="0.00"
                className="font-mono text-lg font-bold"
              />
            </Field>

            <Field label="Descripción / Concepto">
              <Input
                value={expenseDesc}
                onChange={e => setExpenseDesc(e.target.value)}
                placeholder="Ej. 2 bolsas de hielo compradas en la esquina..."
              />
            </Field>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" size="md" onClick={() => setShowExpenseModal(false)} disabled={isSavingExpense}>
                Cancelar
              </Button>
              <Button variant="primary" size="md" type="submit" loading={isSavingExpense} leftIcon="Check">
                Registrar Gasto
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal de Anulación / Reembolso con PIN */}
      {voidingSale && (
        <Modal
          isOpen={Boolean(voidingSale)}
          onClose={() => setVoidingSale(null)}
          title={`Anular Venta #${voidingSale.orderNumber}`}
        >
          <div className="space-y-4">
            {voidError && (
              <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger">
                {voidError}
              </div>
            )}
            <p className="text-sm font-bold text-ink">
              ¿Seguro que deseas anular la venta #{voidingSale.orderNumber} ({voidingSale.customerName || 'Mostrador'}) por ${(voidingSale.totalUsdCents / 100).toFixed(2)} USD?
            </p>
            <p className="text-xs text-ink-muted">
              Esta acción devolverá los fondos a la gaveta de caja, actualizará la contabilidad de la jornada y requiere PIN de autorización.
            </p>

            <Field label="Motivo de anulación" required>
              <Select
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                options={[
                  { value: 'CLIENTE_ARREPENTIDO', label: 'Cliente se arrepintió' },
                  { value: 'ERROR_MONTO_DIGITADO', label: 'Error en monto o método de cobro' },
                  { value: 'PRODUCTO_DEFECTUOSO', label: 'Reclamo de calidad o cocina' },
                  { value: 'DUPLICADO', label: 'Cobro duplicado por error' }
                ]}
              />
            </Field>

            <Field label="PIN de Autorización (Supervisor/Admin)" required>
              <Input
                type="password"
                maxLength={6}
                value={voidPin}
                onChange={e => setVoidPin(e.target.value)}
                placeholder="Ingresa PIN..."
                className="font-mono text-center tracking-widest text-lg font-bold"
              />
            </Field>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" size="md" onClick={() => setVoidingSale(null)} disabled={isVoiding}>
                Volver
              </Button>
              <Button variant="danger" size="md" onClick={handleExecuteVoid} loading={isVoiding} leftIcon="Trash2">
                Autorizar Anulación
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <CashierReprintModal
        reprintingSale={reprintingSale}
        onClose={() => setReprintingSale(null)}
        reprintError={reprintError}
        reprintReason={reprintReason}
        setReprintReason={setReprintReason}
        reprintPin={reprintPin}
        setReprintPin={setReprintPin}
        isReprinting={isReprinting}
        onConfirm={handleExecuteReprint}
      />
    </div>
  );
};
