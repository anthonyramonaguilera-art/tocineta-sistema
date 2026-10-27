import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Button, Badge, Input, Field, WizardLayout, Icon } from '../../ui/index.js';
import { getPaymentMethodHumanLabel } from './payment-labels.js';

interface CashierClosureWizardProps {
  onClosureCompleted: () => void;
  userRole?: string;
}

export const CashierClosureWizard: React.FC<CashierClosureWizardProps> = ({
  onClosureCompleted,
  userRole: _userRole = 'cajera'
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [countedCashUsd, setCountedCashUsd] = useState<string>('');
  const [countedCashBs, setCountedCashBs] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [closingPin, setClosingPin] = useState<string>('2026');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [closureResult, setClosureResult] = useState<any | null>(null);

  // Consultar configuración de negocio (arqueo ciego / guiado)
  const { data: settingsData } = useQuery({
    queryKey: ['business-settings'],
    queryFn: async () => {
      const res = await fetch('/api/business-settings');
      if (!res.ok) return { success: false, settings: { blindClosureEnabled: false } };
      return res.json();
    }
  });

  const isBlindClosure = Boolean(settingsData?.settings?.blindClosureEnabled);

  // Consultar resumen del día
  const { data: summaryData } = useQuery({
    queryKey: ['z-report-summary'],
    queryFn: async () => {
      const res = await fetch('/api/reports/z-report/summary');
      if (!res.ok) return null;
      return res.json();
    }
  });

  const summary = summaryData?.summary || {
    jornadaId: 'jornada_activa',
    totalOrders: 0,
    grossSalesUsdCents: 0,
    expectedCashUsdCents: 0,
    expectedCashBsCents: 0,
    byMethod: [] as Array<{ method: string; count: number; totalUsdCents: number }>
  };

  const expectedUsdCents = summary.expectedCashUsdCents || 0;
  const expectedBsCents = summary.expectedCashBsCents || 0;

  const countedUsdCents = Math.round(parseFloat(countedCashUsd || '0') * 100);
  const countedBsCents = Math.round(parseFloat(countedCashBs || '0') * 100);

  const diffUsdCents = countedUsdCents - expectedUsdCents;
  const diffBsCents = countedBsCents - expectedBsCents;

  const handleExecuteClosure = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const jornadaId = summary.jornadaId || 'jornada_activa';
      const res = await fetch(`/api/jornadas/${jornadaId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: closingPin.trim(),
          countedCashUsdCents: countedUsdCents,
          countedCashBsCents: countedBsCents,
          notes: notes.trim()
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'PIN incorrecto o error al cerrar jornada');
      }

      setClosureResult(data);
      setStep(3);
      onClosureCompleted();
    } catch (err: any) {
      setErrorMessage(err.message || 'Fallo de conexión al procesar Cierre Z');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExport = (type: 'pdf' | 'excel') => {
    const jornadaId = summary.jornadaId || 'jornada_activa';
    window.open(`/api/reports/jornada/${jornadaId}/${type}`, '_blank');
  };

  return (
    <div className="max-w-2xl mx-auto">
      <WizardLayout
        currentStep={step}
        totalSteps={3}
        stepTitle={
          step === 1 ? 'Resumen de Ventas de la Jornada' : step === 2 ? 'Conteo Físico de Caja' : 'Cierre Z Confirmado'
        }
        onBack={step > 1 && step < 3 ? () => setStep((step - 1) as any) : undefined}
        onNext={
          step === 1
            ? () => setStep(2)
            : step === 2
            ? () => handleExecuteClosure()
            : () => setStep(1)
        }
        nextLabel={step === 1 ? 'Iniciar Conteo' : step === 2 ? 'Cerrar Jornada (Cierre Z)' : 'Finalizar'}
        isNextLoading={isSubmitting}
      >
        <div className="space-y-4">
          {errorMessage && (
            <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger flex items-center gap-2">
              <Icon name="AlertTriangle" className="w-4 h-4 shrink-0 text-danger" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* PASO 1: RESUMEN DE VENTAS */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black text-ink uppercase tracking-tight">Totales de la Jornada</h3>
                  <p className="text-xs text-ink-muted">Resumen consolidado de ventas por método de pago</p>
                </div>
                {isBlindClosure ? (
                  <Badge variant="warning">Arqueo Ciego Activo</Badge>
                ) : (
                  <Badge variant="primary">Arqueo Guiado</Badge>
                )}
              </div>

              {isBlindClosure ? (
                <Card variant="alt" className="p-6 text-center space-y-2 border-warning/40">
                  <div className="w-12 h-12 mx-auto rounded-full bg-warning/10 flex items-center justify-center text-warning">
                    <Icon name="Lock" className="w-6 h-6 text-warning" />
                  </div>
                  <h4 className="text-sm font-bold text-ink">Modo Arqueo Ciego Activado</h4>
                  <p className="text-xs text-ink-muted max-w-md mx-auto">
                    Por políticas de control interno de la administración, las cifras teóricas de efectivo no se muestran en pantalla hasta completar el conteo físico.
                  </p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Card variant="surface" className="p-4 border-border">
                    <span className="text-xs font-bold text-ink-muted uppercase block">Efectivo USD Esperado</span>
                    <span className="text-2xl font-black text-primary font-mono block mt-1">
                      ${(expectedUsdCents / 100).toFixed(2)}
                    </span>
                  </Card>
                  <Card variant="surface" className="p-4 border-border">
                    <span className="text-xs font-bold text-ink-muted uppercase block">Efectivo Bs Esperado</span>
                    <span className="text-2xl font-black text-ink font-mono block mt-1">
                      {(expectedBsCents / 100).toFixed(2)} Bs
                    </span>
                  </Card>
                </div>
              )}

              {/* Métodos de pago desglosados */}
              <Card variant="surface" className="p-4 space-y-2 border-border">
                <span className="text-xs font-bold uppercase tracking-wider text-ink-muted block">Desglose por método</span>
                {summary.byMethod && summary.byMethod.length > 0 ? (
                  summary.byMethod.map((m: any, idx: number) => (
                    <div key={idx} className="flex justify-between items-center text-sm py-1.5 border-b border-border/40 last:border-0">
                      <span className="text-ink font-medium">{getPaymentMethodHumanLabel(m.method)} ({m.count} pagos)</span>
                      <span className="font-mono font-bold text-ink">${(m.totalUsdCents / 100).toFixed(2)}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-ink-muted py-2">No hay transacciones registradas aún en este turno.</p>
                )}
              </Card>
            </div>
          )}

          {/* PASO 2: CONTEO FÍSICO */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs text-ink-muted">
                Ingresa el dinero en efectivo contado en la gaveta. El sistema calculará automáticamente cualquier diferencia.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Efectivo Físico USD ($)" required>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={countedCashUsd}
                    onChange={e => setCountedCashUsd(e.target.value)}
                    className="font-mono text-xl font-black"
                  />
                  {!isBlindClosure && countedCashUsd && (
                    <div className="mt-1.5 text-xs font-mono font-bold">
                      {diffUsdCents === 0 ? (
                        <span className="text-success">Exacto (Sin diferencia)</span>
                      ) : diffUsdCents > 0 ? (
                        <span className="text-success">Sobrante: +${(diffUsdCents / 100).toFixed(2)}</span>
                      ) : (
                        <span className="text-danger">Faltante: -${(Math.abs(diffUsdCents) / 100).toFixed(2)}</span>
                      )}
                    </div>
                  )}
                </Field>

                <Field label="Efectivo Físico Bs" required>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={countedCashBs}
                    onChange={e => setCountedCashBs(e.target.value)}
                    className="font-mono text-xl font-black"
                  />
                  {!isBlindClosure && countedCashBs && (
                    <div className="mt-1.5 text-xs font-mono font-bold">
                      {diffBsCents === 0 ? (
                        <span className="text-success">Exacto (Sin diferencia)</span>
                      ) : diffBsCents > 0 ? (
                        <span className="text-success">Sobrante: +{(diffBsCents / 100).toFixed(2)} Bs</span>
                      ) : (
                        <span className="text-danger">Faltante: -{(Math.abs(diffBsCents) / 100).toFixed(2)} Bs</span>
                      )}
                    </div>
                  )}
                </Field>
              </div>

              <Field label="Observaciones del Cierre">
                <Input
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Detalles sobre billetes deteriorados, vueltos pendientes, etc."
                />
              </Field>

              <Field label="PIN de Autorización de Cierre" required>
                <Input
                  type="password"
                  maxLength={6}
                  value={closingPin}
                  onChange={e => setClosingPin(e.target.value)}
                  placeholder="Ingresa PIN..."
                  className="font-mono text-center tracking-widest text-lg font-bold"
                />
              </Field>
            </div>
          )}

          {/* PASO 3: CONFIRMACIÓN Y EXPORTACIÓN */}
          {step === 3 && (
            <div className="space-y-5 text-center">
              <Card variant="alt" className="p-6 space-y-3 border-success/40">
                <div className="w-14 h-14 mx-auto rounded-full bg-success/10 flex items-center justify-center text-success">
                  <Icon name="CheckCircle" className="w-8 h-8 text-success" />
                </div>
                <h3 className="text-xl font-black text-ink uppercase tracking-tight">Cierre Z Ejecutado con Éxito</h3>
                <p className="text-xs text-ink-muted">
                  La jornada fue cerrada e inscrita en el libro inmutable de auditoría.
                </p>
                {closureResult?.auditHash && (
                  <div className="p-2.5 bg-surface border border-border rounded-xl text-[11px] font-mono text-ink-muted break-all">
                    <span className="font-bold text-ink">Firma Criptográfica SHA-256:</span><br />
                    {closureResult.auditHash}
                  </div>
                )}
              </Card>

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => handleExport('pdf')}
                  leftIcon="FileText"
                >
                  Descargar Reporte PDF
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => handleExport('excel')}
                  leftIcon="FileSpreadsheet"
                >
                  Exportar a Excel
                </Button>
              </div>
            </div>
          )}
        </div>
      </WizardLayout>
    </div>
  );
};
