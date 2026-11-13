import React from 'react';
import { Button } from '../../ui/index.js';
import type { OrderPrintJob } from './useOrderPrintJobs.js';
import { formatStationName, formatJobStatus, getDeviceName } from './postPaymentPrintHelpers.js';

interface PostPaymentKitchenSectionProps {
  kitchenJobs: OrderPrintJob[];
  isPrinting: boolean;
  thisTerminalId: string;
  actionErrorJobId?: string | null;
  onPrintKitchen: () => void;
}

export const PostPaymentKitchenSection: React.FC<PostPaymentKitchenSectionProps> = ({
  kitchenJobs,
  isPrinting,
  thisTerminalId,
  actionErrorJobId,
  onPrintKitchen
}) => {
  if (kitchenJobs.length === 0) return null;

  const allKitchenPrinted = kitchenJobs.every((j) => j.status === 'impreso');
  const allKitchenPending = kitchenJobs.some((j) => j.status === 'pending');
  const anyKitchenAttention = kitchenJobs.some((j) => j.status === 'requiere_atencion');
  const allKitchenOtherDevice =
    kitchenJobs.every(
      (j) => j.target === 'client' && j.target_terminal_id !== thisTerminalId && j.status !== 'pending'
    );

  let kitchenLabel = 'Imprimir comanda en cocina';
  if (anyKitchenAttention) {
    kitchenLabel = 'Revisar impresora';
  } else if (allKitchenPrinted) {
    kitchenLabel = 'Impreso';
  } else if (allKitchenOtherDevice && kitchenJobs[0]) {
    kitchenLabel = `Se imprimirá en ${getDeviceName(kitchenJobs[0].target_terminal_id, kitchenJobs[0].printer_name)}`;
  } else if (!allKitchenPending && kitchenJobs.some((j) => j.status === 'en_cola' || j.status === 'imprimiendo')) {
    kitchenLabel = 'Imprimiendo...';
  }

  return (
    <div className="space-y-1.5">
      <Button
        variant={allKitchenPrinted ? 'ghost' : 'primary'}
        size="lg"
        className="w-full justify-between min-h-[48px]"
        onClick={onPrintKitchen}
        disabled={
          isPrinting ||
          allKitchenPrinted ||
          anyKitchenAttention ||
          allKitchenOtherDevice ||
          !allKitchenPending
        }
        leftIcon={allKitchenPrinted ? 'Check' : anyKitchenAttention ? 'AlertTriangle' : 'Printer'}
      >
        <span>{kitchenLabel}</span>
      </Button>

      {/* Texto pequeño con estado por estación y destino */}
      <div className="px-1 text-[11px] text-ink-muted space-y-0.5">
        {kitchenJobs.map((kj) => {
          const hasErr = actionErrorJobId === kj.id;
          const statusTxt = formatJobStatus(kj, hasErr);
          const destName =
            kj.printer_name || (kj.target === 'client' ? 'Impresora Bluetooth' : 'Impresora Cocina');
          return (
            <div key={kj.id} className="flex items-center justify-between">
              <span>
                {formatStationName(kj.station)}:{' '}
                <span className={`font-semibold ${statusTxt === 'error' ? 'text-danger' : ''}`}>
                  {statusTxt}
                </span>
              </span>
              <span className="truncate max-w-[180px] font-medium text-ink/80">{destName}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
