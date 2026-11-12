import React from 'react';
import { Card, Button, Icon } from '../../ui/index.js';
import { ClosurePaymentMethodsTable } from './ClosurePaymentMethodsTable.js';
import { ZCloseStep } from './ZCloseStep.js';

interface ClosureDoneStepProps {
  closureResult: any | null;
  currentSession: any | null;
  jornada: any | null;
  zClosed: boolean;
  isExporting: boolean;
  onExport: (type: 'pdf' | 'excel') => void;
  onZClosed: (jornadaId: string) => void;
}

export const ClosureDoneStep: React.FC<ClosureDoneStepProps> = ({
  closureResult, currentSession, jornada, zClosed, isExporting, onExport, onZClosed
}) => (
  <div className="space-y-4 text-center">
    <div className="w-16 h-16 mx-auto rounded-full bg-success/20 flex items-center justify-center text-success">
      <Icon name="CheckCircle2" className="w-8 h-8 text-success" />
    </div>
    <div>
      <h3 className="text-xl font-black text-ink uppercase">Cierre de Caja Confirmado</h3>
      <p className="text-xs text-ink-muted">El turno de caja ha sido formalmente cerrado y auditado.</p>
    </div>

    {closureResult?.methodCounts && <ClosurePaymentMethodsTable methodCounts={closureResult.methodCounts} />}

    {currentSession?.id && (
      <Card variant="alt" className="p-4 text-left space-y-2 font-mono text-xs border-border">
        <div className="flex justify-between">
          <span className="text-ink-muted">Sesion de Caja:</span>
          <span className="font-bold text-ink">{currentSession.id}</span>
        </div>
        {jornada?.id && (
          <div className="flex justify-between">
            <span className="text-ink-muted">Jornada:</span>
            <span className="font-bold text-ink">{jornada.id}</span>
          </div>
        )}
      </Card>
    )}

    {!zClosed && jornada?.id && <ZCloseStep jornadaId={jornada.id} onClosed={() => onZClosed(jornada.id)} />}
    {zClosed && (
      <p className="text-sm font-bold text-success mt-3">Jornada cerrada. El reporte quedo guardado en Historial.</p>
    )}

    <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
      <Button variant="secondary" size="md" onClick={() => onExport('pdf')} leftIcon="FileText" disabled={isExporting}>
        Descargar Informe PDF
      </Button>
      <Button variant="secondary" size="md" onClick={() => onExport('excel')} leftIcon="FileSpreadsheet" disabled={isExporting}>
        Exportar Excel
      </Button>
    </div>
  </div>
);
