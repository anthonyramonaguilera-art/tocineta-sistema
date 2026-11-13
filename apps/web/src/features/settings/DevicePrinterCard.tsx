import React, { useState, useEffect, useCallback } from 'react';
import { Card, Badge, Icon, Button } from '../../ui/index.js';
import {
  hasNativePrinting,
  listPairedPrintersOnDevice,
  selectPrinterOnDevice,
  testPrintOnDevice,
  getBluetoothStatusOnDevice,
  type PairedPrinterInfo,
  type DeviceBluetoothStatus
} from '../../lib/mobile-print-bridge.js';

export const DevicePrinterCard: React.FC = () => {
  const isApk = hasNativePrinting();
  const [printers, setPrinters] = useState<PairedPrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<{ name: string; mac: string } | null>(null);
  const [btStatus, setBtStatus] = useState<DeviceBluetoothStatus>({ enabled: false, hasPermission: false, connected: false });
  const [loading, setLoading] = useState<boolean>(true);
  const [actionMessage, setActionMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const refreshState = useCallback(async () => {
    if (!hasNativePrinting()) return;
    try {
      const [list, status, current] = await Promise.all([
        listPairedPrintersOnDevice(),
        getBluetoothStatusOnDevice(),
        typeof window !== 'undefined' && window.TocinetaNative?.getSelectedPrinter
          ? window.TocinetaNative.getSelectedPrinter()
          : null
      ]);
      setPrinters(list);
      setBtStatus(status);
      setSelectedPrinter(current);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isApk) void refreshState();
  }, [isApk, refreshState]);

  if (!isApk) return null;

  const handleSelect = async (mac: string) => {
    const res = await selectPrinterOnDevice(mac);
    if (res.ok) {
      setActionMessage({ text: 'Impresora seleccionada' });
      await refreshState();
    } else {
      setActionMessage({ text: res.error || 'Error al seleccionar', error: true });
    }
    setTimeout(() => setActionMessage(null), 3000);
  };

  const handleTestPrint = async () => {
    const res = await testPrintOnDevice();
    if (res.ok) {
      setActionMessage({ text: 'Prueba de impresión enviada' });
    } else {
      setActionMessage({ text: res.error || 'Error en prueba de impresión', error: true });
    }
    setTimeout(() => setActionMessage(null), 3000);
  };

  const renderStatus = () => {
    if (!btStatus.hasPermission) {
      return <Badge variant="danger">Sin permiso</Badge>;
    }
    if (!btStatus.enabled) {
      return <Badge variant="warning">Bluetooth apagado</Badge>;
    }
    if (selectedPrinter && btStatus.connected) {
      return <Badge variant="success">Conectada</Badge>;
    }
    return <Badge variant="neutral">Desconectada</Badge>;
  };

  return (
    <Card variant="surface" className="p-4 rounded-xl border border-border space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="Printer" size={18} className="text-primary" />
          <h4 className="font-extrabold text-xs text-ink uppercase tracking-wide">
            Impresora de este dispositivo
          </h4>
        </div>
        {renderStatus()}
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-bold text-ink-muted">Impresoras vinculadas</p>
        {loading ? (
          <p className="text-xs text-ink-muted">Cargando...</p>
        ) : printers.length === 0 ? (
          <p className="text-xs text-ink-muted">No hay impresoras vinculadas en este dispositivo.</p>
        ) : (
          <div className="space-y-1.5">
            {printers.map((p) => {
              const isSelected = selectedPrinter?.mac === p.mac;
              return (
                <Button
                  key={p.mac}
                  type="button"
                  variant={isSelected ? 'primary' : 'secondary'}
                  onClick={() => void handleSelect(p.mac)}
                  className="w-full min-h-[48px] justify-between text-xs px-3"
                  leftIcon="Printer"
                >
                  <span className="font-bold truncate">{p.name}</span>
                  <span className="text-[11px] opacity-80">{isSelected ? 'Seleccionada' : p.mac}</span>
                </Button>
              );
            })}
          </div>
        )}
      </div>

      <div className="pt-2 flex flex-col sm:flex-row gap-2 items-center justify-between">
        <Button
          type="button"
          variant="secondary"
          onClick={() => void handleTestPrint()}
          className="w-full sm:w-auto min-h-[48px] px-4 text-xs font-bold"
          leftIcon="FileText"
        >
          Imprimir prueba
        </Button>
        {actionMessage && (
          <p className={`text-xs font-bold ${actionMessage.error ? 'text-danger' : 'text-success'}`}>
            {actionMessage.text}
          </p>
        )}
      </div>

      <p className="text-xs text-ink-muted border-t border-border pt-2">
        Si no aparece tu impresora, empárejala primero en los ajustes de Bluetooth del teléfono.
      </p>
    </Card>
  );
};
