import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Badge, Input, Field, WizardLayout, Icon } from '../../ui/index.js';
import { ClosurePaymentMethodsTable } from './ClosurePaymentMethodsTable.js';
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
  const [countedCashUsd, setCountedCashUsd] = useState<string>('');
  const [countedCashBs, setCountedCashBs] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [closingPin, setClosingPin] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [closureResult, setClosureResult] = useState<any | null>(null);
  const [closedJornadaId, setClosedJornadaId] = useState<string | null>(null);
  const [frozenSummary, setFrozenSummary] = useState<any | null>(null);

  const { data: settingsData } = useQuery({
    queryKey: ['business-settings'],
    queryFn: async () => {
      const res = await apiFetch('/api/business-settings');
      if (!res.ok) return { success: false, settings: { blindClosureEnabled: false } };
      return res.json();
    }
  });
  const isBlindClosure = Boolean(settingsData?.settings?.blindClosureEnabled);

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
    enabled: step !== 3 && !closedJornadaId,
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

  if (step !== 3 && !closedJornadaId) {
    if (isErrorSummary) {
      const errObj: any = summaryError;
      return (
        <Card variant="alt" className="p-8 text-center space-y-4 border-danger/40 max-w-lg mx-auto my-8">
          <div className="w-14 h-14 mx-auto rounded-full flex items-center justify-center bg-danger/10 text-danger"><Icon name="AlertTriangle" className="w-7 h-7 text-danger" /></div>
          <h3 className="text-xl font-black text-ink uppercase">Error al Cargar Cierre Z</h3>
          <p className="text-xs text-ink-muted">{errObj?.message || 'No se pudieron obtener las cifras contables del servidor. Verifica la conexión o reintenta.'}</p>
          <Button variant="primary" size="md" onClick={() => refetchSummary()} leftIcon="RotateCw">Reintentar</Button>
        </Card>
      );
    }

    if (!jornada || summaryData?.summary === null) {
      return (
        <Card variant="alt" className="p-8 text-center space-y-4 border-warning/40 max-w-lg mx-auto my-8">
          <div className="w-14 h-14 mx-auto rounded-full flex items-center justify-center bg-warning/10 text-warning"><Icon name="Info" className="w-7 h-7 text-warning" /></div>
          <h3 className="text-xl font-black text-ink uppercase">No hay jornada abierta</h3>
          <p className="text-xs text-ink-muted">No existe una jornada abierta actualmente para realizar el Cierre Z.</p>
        </Card>
      );
    }
  }

  const summary = (step === 3 && frozenSummary) ? frozenSummary : (summaryData?.summary || {
    totalOrders: 0, grossSalesUsdCents: 0, expectedCashUsdCents: 0, expectedCashBsCents: 0,
    puntoDeVentaBsCents: 0, ubiiGrossBsCents: 0, transferenciaBsCents: 0, otrosUsdCents: 0,
    byMethod: [] as Array<{ method: string; count: number; totalUsdCents: number }>,
    bySede: [] as Array<{ locationId: string; locationName?: string; totalOrders?: number; ordersCount?: number; netSalesUsdCents: number }>
  });

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
      const jornadaId = jornada?.id;
      if (!jornadaId) {
        setErrorMessage('No hay jornada abierta');
        setIsSubmitting(false);
        return;
      }
      const res = await apiFetch(`/api/jornadas/${jornadaId}/close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
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

      setClosedJornadaId(jornadaId);
      setClosureResult(data);
      setFrozenSummary(summary);
      setStep(3);
      await invalidateMoney(queryClient);
    } catch (err: any) {
      setErrorMessage(err.message || 'Fallo de conexión al procesar Cierre Z');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinalize = () => {
    setStep(1);
    setCountedCashUsd('');
    setCountedCashBs('');
    setNotes('');
    setClosingPin('');
    setErrorMessage(null);
    setClosureResult(null);
    setClosedJornadaId(null);
    setFrozenSummary(null);
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

  return (
    <div className="max-w-2xl mx-auto">
      <WizardLayout
        currentStep={step}
        totalSteps={3}
        stepTitle={step === 1 ? 'Resumen de Ventas de la Jornada' : step === 2 ? 'Conteo Físico de Caja' : 'Cierre Z Confirmado'}
        onBack={step > 1 && step < 3 ? () => setStep((step - 1) as any) : undefined}
        onNext={step === 1 ? () => setStep(2) : step === 2 ? () => handleExecuteClosure() : () => handleFinalize()}
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

          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black text-ink uppercase tracking-tight">Totales de la Jornada</h3>
                  <p className="text-xs text-ink-muted">Resumen consolidado de ventas por método de pago</p>
                </div>
                {isBlindClosure ? <Badge variant="warning">Arqueo Ciego Activo</Badge> : <Badge variant="primary">Arqueo Guiado</Badge>}
              </div>

              <div className="p-3 bg-surface-alt rounded-xl border border-border text-xs text-ink-muted flex items-center gap-2">
                <Icon name="Info" className="w-4 h-4 text-primary shrink-0" />
                <span><strong>Fórmula de efectivo esperado:</strong> Apertura + cobros en efectivo − vueltos − gastos en efectivo</span>
              </div>

              {isBlindClosure ? (
                <Card variant="alt" className="p-6 text-center space-y-2 border-warning/40">
                  <div className="w-12 h-12 mx-auto rounded-full bg-warning/10 flex items-center justify-center text-warning"><Icon name="Lock" className="w-6 h-6 text-warning" /></div>
                  <h4 className="text-sm font-bold text-ink">Modo Arqueo Ciego Activado</h4>
                  <p className="text-xs text-ink-muted max-w-md mx-auto">Por políticas de control interno de la administración, las cifras teóricas de efectivo no se muestran en pantalla hasta completar el conteo físico.</p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Card variant="surface" className="p-4 border-border">
                    <span className="text-xs font-bold text-ink-muted uppercase block">Efectivo USD Esperado</span>
                    <span className="text-2xl font-black text-primary font-mono block mt-1">${(expectedUsdCents / 100).toFixed(2)}</span>
                  </Card>
                  <Card variant="surface" className="p-4 border-border">
                    <span className="text-xs font-bold text-ink-muted uppercase block">Efectivo Bs Esperado</span>
                    <span className="text-2xl font-black text-ink font-mono block mt-1">{(expectedBsCents / 100).toFixed(2)} Bs</span>
                  </Card>
                </div>
              )}

              {!isBlindClosure && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {[
                    { label: 'Punto de Venta', val: `${((summary.puntoDeVentaBsCents || 0) / 100).toFixed(2)} Bs` },
                    { label: 'Punto Ubii', val: `${((summary.ubiiGrossBsCents || 0) / 100).toFixed(2)} Bs` },
                    { label: 'Transferencia', val: `${((summary.transferenciaBsCents || 0) / 100).toFixed(2)} Bs` },
                    { label: 'Otros Métodos', val: `$${((summary.otrosUsdCents || 0) / 100).toFixed(2)}` }
                  ].map(item => (
                    <div key={item.label} className="p-3 bg-surface rounded-xl border border-border">
                      <span className="text-ink-muted block text-[10px] uppercase font-bold">{item.label}</span>
                      <span className="font-mono font-bold text-ink text-sm">{item.val}</span>
                    </div>
                  ))}
                </div>
              )}

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

          {step === 2 && (
            <div className="space-y-4">
              <div className="p-3 bg-surface-alt rounded-xl border border-border text-xs text-ink-muted">
                <strong>Fórmula de cuadre:</strong> Apertura + cobros en efectivo − vueltos − gastos en efectivo
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Efectivo Físico USD ($)" required>
                  <Input type="number" step="0.01" min="0" placeholder="0.00" value={countedCashUsd} onChange={e => setCountedCashUsd(e.target.value)} className="font-mono text-xl font-black" />
                  {!isBlindClosure && countedCashUsd && (
                    <div className="mt-1.5 text-xs font-mono font-bold">
                      {diffUsdCents === 0 ? <span className="text-success font-bold">Exacto (Cuadra exacto)</span> : diffUsdCents > 0 ? <span className="text-success font-bold">+Sobra: ${(diffUsdCents / 100).toFixed(2)}</span> : <span className="text-danger font-bold">-Falta: ${(Math.abs(diffUsdCents) / 100).toFixed(2)}</span>}
                    </div>
                  )}
                </Field>

                <Field label="Efectivo Físico Bs" required>
                  <Input type="number" step="0.01" min="0" placeholder="0.00" value={countedCashBs} onChange={e => setCountedCashBs(e.target.value)} className="font-mono text-xl font-black" />
                  {!isBlindClosure && countedCashBs && (
                    <div className="mt-1.5 text-xs font-mono font-bold">
                      {diffBsCents === 0 ? <span className="text-success font-bold">Exacto (Cuadra exacto)</span> : diffBsCents > 0 ? <span className="text-success font-bold">+Sobra: {(diffBsCents / 100).toFixed(2)} Bs</span> : <span className="text-danger font-bold">-Falta: {(Math.abs(diffBsCents) / 100).toFixed(2)} Bs</span>}
                    </div>
                  )}
                </Field>
              </div>

              <Field label="Observaciones del Cierre">
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Detalles sobre billetes deteriorados, vueltos pendientes, etc." />
              </Field>

              <Field label="PIN de Autorización de Cierre" required hint="PIN de cajera, supervisor o administrador">
                <Input type="password" maxLength={6} value={closingPin} onChange={e => setClosingPin(e.target.value)} placeholder="Ingresa PIN..." className="font-mono text-center tracking-widest text-lg font-bold" />
              </Field>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-success/20 flex items-center justify-center text-success"><Icon name="CheckCircle2" className="w-8 h-8 text-success" /></div>
              <div>
                <h3 className="text-xl font-black text-ink uppercase">Cierre Z Registrado con Éxito</h3>
                <p className="text-xs text-ink-muted">La jornada ha sido formalmente clausurada y sellada criptográficamente en el servidor.</p>
              </div>

              {(closureResult?.zReport || closureResult?.closure) && (
                <Card variant="alt" className="p-4 text-left space-y-2 font-mono text-xs border-border">
                  {closedJornadaId && (
                    <div className="flex justify-between">
                      <span className="text-ink-muted">Jornada:</span>
                      <span className="font-bold text-ink">{closedJornadaId}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Secuencia Z:</span>
                    <span className="font-bold text-ink">#{closureResult.zReport?.zSequenceNumber || closureResult.closure?.zSequenceNumber || '1'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Hash SHA-256:</span>
                    <span className="text-[10px] text-ink truncate max-w-[200px]">{closureResult.zReport?.auditHeadHash || closureResult.closure?.hashChainHex || '00000000'}</span>
                  </div>
                </Card>
              )}

              <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
                <Button variant="secondary" size="md" onClick={() => handleExport('pdf')} leftIcon="FileText" disabled={isExporting}>
                  Descargar Informe PDF
                </Button>
                <Button variant="secondary" size="md" onClick={() => handleExport('excel')} leftIcon="FileSpreadsheet" disabled={isExporting}>
                  Exportar Excel
                </Button>
              </div>
            </div>
          )}
        </div>
      </WizardLayout>
    </div>
  );
};
