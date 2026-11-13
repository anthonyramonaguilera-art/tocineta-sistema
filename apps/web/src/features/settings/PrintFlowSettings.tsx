import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Button } from '../../ui/index.js';
import { apiFetch } from '../../api/client.js';
import type { BusinessSettings, PrinterItem } from './types.js';

export interface PrintFlowSettingsProps {
  settings?: BusinessSettings;
  printers?: PrinterItem[];
  isUniquePrinting?: boolean;
  onUpdatePrintMode?: (mode: 'one' | 'two') => void;
  onUpdateSettings: (payload: Record<string, any>) => void;
}

export function formatPrinterSimpleType(printer: { connection_type?: string; name?: string; address?: string }): string {
  const conn = (printer.connection_type || '').toUpperCase();
  if (conn === 'CLIENT_BT') {
    const match = printer.name?.match(/^Bluetooth\s+(.+)$/i);
    const device = match ? match[1].trim() : (printer.address || 'dispositivo');
    return `Bluetooth de ${device}`;
  }
  if (conn.includes('TCP') || conn === 'NETWORK') {
    return 'Red';
  }
  return 'USB';
}

export function formatPrinterOptionLabel(printer: PrinterItem): string {
  const simpleType = formatPrinterSimpleType(printer);
  return `${printer.name} (${simpleType})`;
}

export const PrintFlowSettings: React.FC<PrintFlowSettingsProps> = ({
  settings,
  printers: propPrinters,
  onUpdateSettings
}) => {
  const { data: printersRes } = useQuery<{ success: boolean; data: PrinterItem[] }>({
    queryKey: ['printersConfig'],
    queryFn: async () => {
      const res = await apiFetch('/api/printers');
      if (!res.ok) return { success: true, data: [] };
      return res.json();
    },
    enabled: !propPrinters
  });

  const allPrinters = propPrinters || printersRes?.data || [];
  const activePrinters = allPrinters.filter(
    (p) => p.is_active === 1 || p.is_active === undefined || (p as any).is_active === true
  );

  const printDeliveryNote = settings?.print_delivery_note ?? 1;
  const printFlow = settings?.print_flow || 'manual';
  const receiptDestination = settings?.receipt_destination || 'payer_device';
  const kitchenDestination = settings?.kitchen_destination || 'payer_device';
  const receiptPrinterId = settings?.receipt_printer_id || '';
  const kitchenPrinterId = settings?.kitchen_printer_id || '';

  const handleUpdate = (partial: Record<string, any>) => {
    const nextKitchenId = 'kitchen_printer_id' in partial
      ? partial.kitchen_printer_id
      : (settings?.kitchen_printer_id || '');
    const nextReceiptId = 'receipt_printer_id' in partial
      ? partial.receipt_printer_id
      : (settings?.receipt_printer_id || '');

    const nextPrintMode = nextKitchenId !== nextReceiptId ? 'two' : 'one';

    onUpdateSettings({
      ...partial,
      print_mode: nextPrintMode
    });
  };

  const receiptPrinter = activePrinters.find((p) => p.id === receiptPrinterId)
    || allPrinters.find((p) => p.id === receiptPrinterId);
  const receiptPrinterName = receiptPrinter?.name || receiptPrinterId || 'impresora no asignada';
  const receiptStatusText = receiptDestination === 'payer_device'
    ? 'Ahora: cada ticket sale por el dispositivo que cobra'
    : `Ahora: sale por ${receiptPrinterName}`;

  const kitchenPrinter = activePrinters.find((p) => p.id === kitchenPrinterId)
    || allPrinters.find((p) => p.id === kitchenPrinterId);
  const kitchenPrinterName = kitchenPrinter?.name || kitchenPrinterId || 'impresora no asignada';
  const kitchenStatusText = kitchenDestination === 'payer_device'
    ? 'Ahora: cada ticket sale por el dispositivo que cobra'
    : `Ahora: sale por ${kitchenPrinterName}`;

  return (
    <Card variant="alt" className="p-4 space-y-4 border border-border">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-ink">Ajustes de Impresión y Flujo</h4>
          <p className="text-xs text-ink-muted">Configura el destino de los tickets y el flujo al cobrar.</p>
        </div>
      </div>

      {/* Interruptor: Mostrar todas las opciones al cobrar */}
      <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-ink block">Mostrar todas las opciones al cobrar</span>
          <span className="text-[11px] text-ink-muted block mt-0.5">
            Activado: al cobrar aparece el panel para imprimir la nota y la comanda. Desactivado: se imprime todo automáticamente.
          </span>
        </div>
        <Button
          variant={printFlow === 'manual' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => handleUpdate({ print_flow: printFlow === 'manual' ? 'auto' : 'manual' })}
          className="min-h-[48px] px-4 font-bold shrink-0"
        >
          {printFlow === 'manual' ? 'Activado' : 'Desactivado'}
        </Button>
      </div>

      {/* Interruptor: Imprimir nota de entrega */}
      <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-ink block">Imprimir nota de entrega</span>
          <span className="text-[11px] text-ink-muted block mt-0.5">Generar ticket de venta/caja al cobrar órdenes</span>
        </div>
        <Button
          variant={printDeliveryNote === 1 ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => handleUpdate({ print_delivery_note: printDeliveryNote === 1 ? 0 : 1 })}
          className="min-h-[48px] px-4 font-bold shrink-0"
        >
          {printDeliveryNote === 1 ? 'Activado' : 'Desactivado'}
        </Button>
      </div>

      {/* Selector: La nota de entrega sale por */}
      <div className="pt-3 border-t border-border/60 space-y-2">
        <label htmlFor="receipt-destination-select" className="text-xs font-bold text-ink block">
          La nota de entrega sale por:
        </label>
        <select
          id="receipt-destination-select"
          value={receiptDestination}
          onChange={(e) => {
            const val = e.target.value as 'payer_device' | 'fixed_printer';
            if (val === 'fixed_printer') {
              const targetPrinter = receiptPrinterId || (activePrinters[0]?.id ?? '');
              handleUpdate({
                receipt_destination: val,
                ...(targetPrinter ? { receipt_printer_id: targetPrinter } : {})
              });
            } else {
              handleUpdate({ receipt_destination: val });
            }
          }}
          className="w-full min-h-[48px] rounded-xl border border-border bg-surface px-3 text-xs font-bold text-ink outline-none focus:border-primary"
        >
          <option value="payer_device">La impresora del dispositivo que cobra</option>
          <option value="fixed_printer">Una impresora fija</option>
        </select>

        {receiptDestination === 'fixed_printer' && (
          <div className="pt-1">
            <select
              id="receipt-printer-select"
              aria-label="Impresora fija para nota de entrega"
              value={receiptPrinterId || (activePrinters[0]?.id ?? '')}
              onChange={(e) => handleUpdate({
                receipt_destination: 'fixed_printer',
                receipt_printer_id: e.target.value
              })}
              className="w-full min-h-[48px] rounded-xl border border-border bg-surface px-3 text-xs font-bold text-ink outline-none focus:border-primary animate-in fade-in duration-200"
            >
              {activePrinters.length === 0 ? (
                <option value="">Sin impresoras disponibles</option>
              ) : (
                activePrinters.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatPrinterOptionLabel(p)}
                  </option>
                ))
              )}
            </select>
          </div>
        )}

        <div className="text-[11px] text-ink-muted font-medium pt-0.5">
          {receiptStatusText}
        </div>
      </div>

      {/* Selector: Las comandas salen por */}
      <div className="pt-3 border-t border-border/60 space-y-2">
        <label htmlFor="kitchen-destination-select" className="text-xs font-bold text-ink block">
          Las comandas salen por:
        </label>
        <select
          id="kitchen-destination-select"
          value={kitchenDestination}
          onChange={(e) => {
            const val = e.target.value as 'payer_device' | 'fixed_printer';
            if (val === 'fixed_printer') {
              const targetPrinter = kitchenPrinterId || (activePrinters[0]?.id ?? '');
              handleUpdate({
                kitchen_destination: val,
                ...(targetPrinter ? { kitchen_printer_id: targetPrinter } : {})
              });
            } else {
              handleUpdate({ kitchen_destination: val });
            }
          }}
          className="w-full min-h-[48px] rounded-xl border border-border bg-surface px-3 text-xs font-bold text-ink outline-none focus:border-primary"
        >
          <option value="payer_device">La impresora del dispositivo que cobra</option>
          <option value="fixed_printer">Una impresora fija</option>
        </select>

        {kitchenDestination === 'fixed_printer' && (
          <div className="pt-1">
            <select
              id="kitchen-printer-select"
              aria-label="Impresora fija para comandas"
              value={kitchenPrinterId || (activePrinters[0]?.id ?? '')}
              onChange={(e) => handleUpdate({
                kitchen_destination: 'fixed_printer',
                kitchen_printer_id: e.target.value
              })}
              className="w-full min-h-[48px] rounded-xl border border-border bg-surface px-3 text-xs font-bold text-ink outline-none focus:border-primary animate-in fade-in duration-200"
            >
              {activePrinters.length === 0 ? (
                <option value="">Sin impresoras disponibles</option>
              ) : (
                activePrinters.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatPrinterOptionLabel(p)}
                  </option>
                ))
              )}
            </select>
          </div>
        )}

        <div className="text-[11px] text-ink-muted font-medium pt-0.5">
          {kitchenStatusText}
        </div>
      </div>

      {/* Texto de apoyo general */}
      <div className="pt-2 border-t border-border/60">
        <p className="text-[11px] text-ink-muted">
          Si el dispositivo que cobra no puede imprimir, el ticket sale por la impresora fija configurada aquí.
        </p>
      </div>
    </Card>
  );
};
