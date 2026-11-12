import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Badge, WizardLayout, Icon } from '../../ui/index.js';
import { ClosurePaymentMethodsTable } from './ClosurePaymentMethodsTable.js';
import { ClosureCountStep, CLOSURE_METHODS } from './ClosureCountStep.js';
import { ClosureDoneStep } from './ClosureDoneStep.js';
import { invalidateMoney } from '../finances/queryKeys.js';
import { apiFetch } from '../../api/client.js';

interface CashierClosureWizardProps {
  onClosureCompleted: () => void;
  userRole?: string;
  token?: string | null;
}

export const CashierClosureWizard: React.FC<CashierClosureWizardProps> = ({
  onClosureCompleted,
  userRole: _userRole = 'cajera',
  token
}) => {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Estado del arqueo por los 9 métodos
  const [methodValues, setMethodValues] = useState<Record<string, string>>({});
  const [confirmEmpty, setConfirmEmpty] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');
  const [closingPin, setClosingPin] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recountMessage, setRecountMessage] = useState<string | null>(null);
  const [closureResult, setClosureResult] = useState<any | null>(null);
  const [zClosed, setZClosed] = useState<boolean>(false);
  const [closedJornadaId, setClosedJornadaId] = useState<string | null>(null);

  const { data: sessionData } = useQuery({
    queryKey: ['current-cash-session'],
    queryFn: async () => {
      const res = await apiFetch('/api/cash-sessions/current', {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (!res.ok) return { cashSession: null };
      return res.json();
    }
  });
  const currentSession = sessionData?.cashSession;

  const { data: jornadaData } = useQuery({
    queryKey: ['current-jornada'],
    queryFn: async () => {
      const res = await apiFetch('/api/jornadas/current');
      if (!res.ok) return { jornada: null };
      return res.json();
    }
  });
  const jornada = jornadaData?.jornada;

  const {
    data: summaryData,
    isError: isErrorSummary,
    error: summaryError,
    refetch: refetchSummary
  } = useQuery({
    queryKey: ['z-report-summary'],
    enabled: step === 1,
    queryFn: async () => {
      const res = await apiFetch('/api/reports/z-report/summary', {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(data.error || 'Error al consultar resumen contable');
        err.status = res.status;
        throw err;
      }
      return data;
    }
  });

  const handleMethodChange = (method: string, val: string) => {
    setMethodValues((prev) => ({
      ...prev,
      [method]: val
    }));
  };

  // Cálculo D13: convertir a centavos enteros
  const counts = CLOSURE_METHODS.map((m) => ({
    method: m.method,
    countedCents: Math.round(parseFloat(methodValues[m.method] || '0') * 100)
  }));
  const totalCountedCents = counts.reduce((acc, c) => acc + c.countedCents, 0);
  const isAllZero = totalCountedCents === 0;
  const isCloseDisabled = isAllZero && !confirmEmpty;

  if (step === 1) {
    if (isErrorSummary) {
      const errObj: any = summaryError;
      return (
        <Card variant="alt" className="p-8 text-center space-y-4 border-danger/40 max-w-lg mx-auto my-8">
          <div className="w-14 h-14 mx-auto rounded-full flex items-center justify-center bg-danger/10 text-danger">
            <Icon name="AlertTriangle" className="w-7 h-7 text-danger" />
          </div>
          <h3 className="text-xl font-black text-ink uppercase">Error al Cargar Cierre Z</h3>
          <p className="text-xs text-ink-muted">{errObj?.message || 'No se pudieron obtener las cifras contables del servidor.'}</p>
          <Button variant="primary" size="md" onClick={() => refetchSummary()} leftIcon="RotateCw">
            Reintentar
          </Button>
        </Card>
      );
    }

    if (!jornada && !currentSession) {
      return (
        <Card variant="alt" className="p-8 text-center space-y-4 border-warning/40 max-w-lg mx-auto my-8">
          <div className="w-14 h-14 mx-auto rounded-full flex items-center justify-center bg-warning/10 text-warning">
            <Icon name="Info" className="w-7 h-7 text-warning" />
          </div>
          <h3 className="text-xl font-black text-ink uppercase">No hay caja ni jornada abierta</h3>
          <p className="text-xs text-ink-muted">No existe una sesión de caja ni jornada abierta actualmente para realizar el cierre.</p>
        </Card>
      );
    }
  }

  const summary = summaryData?.summary;

  const handleExecuteClosure = async () => {
    if (isSubmitting) return;

    const sessionId = currentSession?.id;
    if (!sessionId) {
      setErrorMessage(
        jornada
          ? 'No hay una caja abierta en esta jornada. Un administrador o supervisor debe abrir caja primero.'
          : 'No hay jornada ni caja abierta.'
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setRecountMessage(null);

    try {
      const res = await apiFetch(`/api/cash-sessions/${sessionId}/blind-count`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          counts,
          confirmEmpty,
          notes: notes.trim(),
          ...(closingPin.trim() ? { pin: closingPin.trim(), supervisorPin: closingPin.trim() } : {})
        })
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setErrorMessage(data?.error || data?.message || 'Error al procesar el arqueo ciego de caja');
        return;
      }

      if (data?.status === 'RECOUNT_REQUIRED') {
        setRecountMessage(data.message || 'Por favor realiza una segunda verificación del conteo físico.');
        return;
      }

      if (data?.status === 'CLOSED') {
        setClosureResult(data);
        setStep(3);
        await invalidateMoney(queryClient);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Fallo de conexión al procesar el cierre de caja');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinalize = async () => {
    setZClosed(false);
    setClosedJornadaId(null);
    await invalidateMoney(queryClient);
    queryClient.removeQueries({ queryKey: ['z-report-summary'] });
    setStep(1);
    setMethodValues({});
    setConfirmEmpty(false);
    setNotes('');
    setClosingPin('');
    setErrorMessage(null);
    setRecountMessage(null);
    setClosureResult(null);
    onClosureCompleted();
  };

  const handleExport = async (type: 'pdf' | 'excel') => {
    const targetJornadaId = closedJornadaId || jornada?.id;
    if (!targetJornadaId) {
      setErrorMessage('No hay jornada abierta o identificador de jornada');
      return;
    }
    setIsExporting(true);
    setErrorMessage(null);
    try {
      const ext = type === 'pdf' ? 'pdf' : 'xlsx';
      const res = await apiFetch(`/api/reports/jornada/${targetJornadaId}/${type}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (!res.ok) throw new Error(`Error ${res.status} al descargar el archivo ${type.toUpperCase()}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cierre-z-${targetJornadaId}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMessage(err.message || `No se pudo descargar el archivo ${type.toUpperCase()}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleZClosed = async (jId: string) => {
    setClosedJornadaId(jId);
    setZClosed(true);
    await invalidateMoney(queryClient);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <WizardLayout
        currentStep={step}
        totalSteps={3}
        stepTitle={
          step === 1
            ? 'Resumen de Ventas de la Jornada'
            : step === 2
            ? 'Conteo Físico de Caja'
            : 'Cierre Confirmado'
        }
        onBack={step > 1 && step < 3 ? () => setStep((step - 1) as any) : undefined}
        onNext={
          step === 1
            ? () => setStep(2)
            : step === 2
            ? () => handleExecuteClosure()
            : () => handleFinalize()
        }
        nextLabel={step === 1 ? 'Iniciar Conteo' : step === 2 ? 'Cerrar caja' : 'Finalizar'}
        isNextDisabled={step === 2 && isCloseDisabled}
        nextDisabledReason={
          step === 2 && isCloseDisabled
            ? 'Ingresa los montos contados o confirma turno sin movimientos'
            : undefined
        }
        isNextLoading={isSubmitting}
      >
        <div className="space-y-4">
          {step === 1 && (
            <div className="space-y-4">
              {sessionData?.ownedByCurrentUser === false && (
                <p className="text-xs font-semibold text-warning">
                  Caja abierta por {sessionData?.openedByName || 'otro usuario'}. Estas cerrando esa misma caja.
                </p>
              )}
              {!summary?.byMethod ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-black text-ink uppercase tracking-tight">Turno de Caja</h3>
                      <p className="text-xs text-ink-muted">
                        Total de órdenes: <span className="font-bold text-ink">{summary?.ordersCount ?? summary?.totalOrders ?? 0}</span>
                      </p>
                    </div>
                    <Badge variant="warning">Arqueo Ciego Activo</Badge>
                  </div>

                  <Card variant="surface" className="p-4 border-border">
                    <p className="text-sm text-ink-muted">
                      Cuenta el efectivo y los medios de pago de tu turno; en el siguiente paso los registras
                    </p>
                  </Card>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-black text-ink uppercase tracking-tight">Totales de la Jornada</h3>
                      <p className="text-xs text-ink-muted">Resumen consolidado de ventas por método de pago</p>
                    </div>
                    <Badge variant="primary">Arqueo Guiado</Badge>
                  </div>

                  <div className="p-3 bg-surface-alt rounded-xl border border-border text-xs text-ink-muted flex items-center gap-2">
                    <Icon name="Info" className="w-4 h-4 text-primary shrink-0" />
                    <span><strong>Fórmula de efectivo esperado:</strong> Apertura + cobros en efectivo − vueltos − gastos en efectivo</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Card variant="surface" className="p-4 border-border">
                      <span className="text-xs font-bold text-ink-muted uppercase block">Efectivo USD Esperado</span>
                      <span className="text-2xl font-black text-primary font-mono block mt-1">${((summary.expectedCashUsdCents || 0) / 100).toFixed(2)}</span>
                    </Card>
                    <Card variant="surface" className="p-4 border-border">
                      <span className="text-xs font-bold text-ink-muted uppercase block">Efectivo Bs Esperado</span>
                      <span className="text-2xl font-black text-ink font-mono block mt-1">{((summary.expectedCashBsCents || 0) / 100).toFixed(2)} Bs</span>
                    </Card>
                  </div>

                  <ClosurePaymentMethodsTable byMethod={summary.byMethod} receivablesUsdCents={summary.receivablesUsdCents} />

                  {summary.bySede && summary.bySede.length > 0 && (
                    <Card variant="surface" className="p-4 space-y-2 border-border">
                      <span className="text-xs font-bold uppercase tracking-wider text-ink-muted block">Ventas por sede</span>
                      {summary.bySede.map((s: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center text-sm py-1 border-b border-border/40 last:border-0">
                          <span className="text-ink font-medium">{s.locationName || s.locationId} ({s.totalOrders ?? 0} órdenes)</span>
                          <span className="font-mono font-bold text-ink">${(s.netSalesUsdCents / 100).toFixed(2)}</span>
                        </div>
                      ))}
                    </Card>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <ClosureCountStep
              methodValues={methodValues}
              onMethodChange={handleMethodChange}
              confirmEmpty={confirmEmpty}
              onConfirmEmptyChange={setConfirmEmpty}
              notes={notes}
              onNotesChange={setNotes}
              closingPin={closingPin}
              onClosingPinChange={setClosingPin}
              recountMessage={recountMessage}
              errorMessage={errorMessage}
            />
          )}

          {step === 3 && (
            <ClosureDoneStep
              closureResult={closureResult}
              currentSession={currentSession}
              jornada={jornada}
              zClosed={zClosed}
              isExporting={isExporting}
              onExport={handleExport}
              onZClosed={handleZClosed}
            />
          )}
        </div>
      </WizardLayout>
    </div>
  );
};
