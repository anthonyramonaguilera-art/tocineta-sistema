import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Badge, Icon } from '../../ui/index.js';
import type { BusinessSettings } from './types.js';
import { PrintFlowSettings } from './PrintFlowSettings.js';

interface PrinterItem {
  id: string;
  name: string;
  connection_type: string;
  address: string;
  columns: number;
  codepage: number;
  has_cutter: number;
  has_buzzer: number;
  is_active: number;
}

interface PrintersPanelProps {
  token?: string | null;
}

interface WindowsPrinter {
  Name: string;
  PortName?: string;
  DriverName?: string;
  PrinterStatus?: string | number;
}

export const PrintersPanel: React.FC<PrintersPanelProps> = ({ token }) => {
  const queryClient = useQueryClient();
  const [testResults, setTestResults] = useState<Record<string, { diagnostic: string; message?: string; simulated?: boolean }>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: printersRes, isLoading: isLoadingPrinters } = useQuery<{ success: boolean; data: PrinterItem[] }>({
    queryKey: ['printersConfig'],
    queryFn: async () => {
      const res = await fetch('/api/printers');
      if (!res.ok) throw new Error('Error al cargar impresoras configuradas');
      return res.json();
    }
  });

  const { data: windowsPrinters = [], isLoading: isLoadingWindows } = useQuery<WindowsPrinter[]>({
    queryKey: ['windowsPrinters'],
    queryFn: async () => {
      const res = await fetch('/api/printers/windows');
      if (!res.ok) return [];
      return res.json();
    }
  });

  const { data: settingsRes } = useQuery<{ success: boolean; settings: BusinessSettings }>({
    queryKey: ['businessSettings'],
    queryFn: async () => {
      const res = await fetch('/api/business-settings');
      if (!res.ok) throw new Error('Error al cargar ajustes del negocio');
      return res.json();
    }
  });

  const printers = printersRes?.data || [];
  const settings = settingsRes?.settings;
  const printMode = settings?.print_mode || 'one';

  const cajaPrinter = printers.find((p) => p.id === 'print_caja_usb') || printers[0];
  const cocinaPrinter = printers.find((p) => p.id === 'print_cocina');
  const isUniquePrinting = printMode === 'one' || (settings?.kitchen_printer_id === settings?.receipt_printer_id);

  const updatePrinterMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: any }) => {
      const res = await fetch(`/api/printers/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Error al actualizar impresora');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['printersConfig'] });
      setActionError(null);
    },
    onError: (err: any) => {
      setActionError(err.message || 'Error al actualizar impresora');
    }
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      const res = await fetch('/api/business-settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Error al actualizar ajustes');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businessSettings'] });
      setActionError(null);
    },
    onError: (err: any) => {
      setActionError(err.message || 'Error al actualizar ajustes');
    }
  });

  const testPrinterMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/printers/${id}/test`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.diagnostic || 'Error en prueba de impresión');
      }
      return { id, data };
    },
    onSuccess: ({ id, data }) => {
      setTestResults((prev) => ({ ...prev, [id]: data }));
      setTestErrors((prev) => ({ ...prev, [id]: '' }));
    },
    onError: (err: any, id) => {
      setTestErrors((prev) => ({ ...prev, [id]: err.message || 'Error desconocido en prueba' }));
    }
  });

  if (isLoadingPrinters) {
    return (
      <div className="p-6 text-center text-xs text-ink-muted">
        Cargando configuración de impresoras térmicas...
      </div>
    );
  }

  const hasWindowsPrinters = windowsPrinters.length > 0;

  return (
    <Card variant="surface" className="p-5 border border-border space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Icon name="Printer" size={18} className="text-primary" />
          <h3 className="font-extrabold text-sm text-ink uppercase tracking-wide">
            Impresoras de Windows y Hardware Térmico
          </h3>
        </div>
        <Badge variant={hasWindowsPrinters ? 'success' : 'warning'}>
          {hasWindowsPrinters ? `${windowsPrinters.length} Impresoras Detectadas` : 'Sin Impresoras Detectadas'}
        </Badge>
      </div>

      {actionError && (
        <div className="p-3 rounded-xl bg-danger/15 border border-danger/30 text-xs font-bold text-danger">
          {actionError}
        </div>
      )}

      <PrintFlowSettings
        settings={settings}
        isUniquePrinting={isUniquePrinting}
        onUpdatePrintMode={(mode) => updateSettingsMutation.mutate({ print_mode: mode })}
        onUpdateSettings={(payload) => updateSettingsMutation.mutate(payload)}
      />

      {/* Selector Impresora de Caja */}
      {cajaPrinter && (
        <div className="p-4 rounded-2xl border border-border space-y-4 bg-surface">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                <Icon name="Printer" size={18} />
              </div>
              <div>
                <h4 className="font-black text-xs text-ink uppercase tracking-tight">
                  Impresora de Caja (USB / Recibos)
                </h4>
                <p className="text-[11px] text-ink-muted">
                  Vinculada actualmente: <span className="font-mono font-bold text-ink">{cajaPrinter.address || 'Ninguna'}</span>
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={testPrinterMutation.isPending}
              onClick={() => testPrinterMutation.mutate(cajaPrinter.id)}
              className="min-h-[48px] px-4 text-xs font-bold"
              leftIcon={<Icon name="Printer" size={16} />}
            >
              {testPrinterMutation.isPending ? 'Probando...' : 'Imprimir Ticket de Prueba'}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-2">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-ink-muted mb-1">
                Seleccionar Impresora del Spooler de Windows
              </label>
              <select
                value={cajaPrinter.address}
                onChange={(e) => updatePrinterMutation.mutate({ id: cajaPrinter.id, payload: { address: e.target.value, name: e.target.value, connection_type: 'SPOOLER_RAW_USB' } })}
                className="w-full min-h-[48px] rounded-xl border border-border bg-surface px-3 text-xs font-bold text-ink outline-none focus:border-primary"
              >
                <option value="">-- Seleccionar Impresora Windows --</option>
                {windowsPrinters.map((wp) => (
                  <option key={wp.Name} value={wp.Name}>
                    {wp.Name} {wp.PrinterStatus ? `(${wp.PrinterStatus})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-ink-muted mb-1">
                Codificación (Codepage)
              </label>
              <select
                value={cajaPrinter.codepage ?? 16}
                onChange={(e) => updatePrinterMutation.mutate({ id: cajaPrinter.id, payload: { codepage: parseInt(e.target.value, 10) } })}
                className="w-full min-h-[48px] rounded-xl border border-border bg-surface px-3 text-xs font-bold text-ink outline-none focus:border-primary"
              >
                <option value={16}>16 (WPC1252 / Español)</option>
                <option value={2}>2 (Katakana / Estándar)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Selector Impresora de Cocina (Solo si printMode === 'two') */}
      {printMode === 'two' && cocinaPrinter && (
        <div className="p-4 rounded-2xl border border-border space-y-4 bg-surface animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                <Icon name="Utensils" size={18} />
              </div>
              <div>
                <h4 className="font-black text-xs text-ink uppercase tracking-tight">
                  Impresora de Cocina (Comandas)
                </h4>
                <p className="text-[11px] text-ink-muted">
                  Vinculada actualmente: <span className="font-mono font-bold text-ink">{cocinaPrinter.address || 'Ninguna'}</span>
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={testPrinterMutation.isPending}
              onClick={() => testPrinterMutation.mutate(cocinaPrinter.id)}
              className="min-h-[48px] px-4 text-xs font-bold"
              leftIcon={<Icon name="Printer" size={16} />}
            >
              {testPrinterMutation.isPending ? 'Probando...' : 'Imprimir Ticket de Prueba'}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-2">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-ink-muted mb-1">
                Seleccionar Impresora del Spooler de Windows
              </label>
              <select
                value={cocinaPrinter.address}
                onChange={(e) => updatePrinterMutation.mutate({ id: cocinaPrinter.id, payload: { address: e.target.value, name: e.target.value, connection_type: 'SPOOLER_RAW_USB' } })}
                className="w-full min-h-[48px] rounded-xl border border-border bg-surface px-3 text-xs font-bold text-ink outline-none focus:border-primary"
              >
                <option value="">-- Seleccionar Impresora Windows --</option>
                {windowsPrinters.map((wp) => (
                  <option key={wp.Name} value={wp.Name}>
                    {wp.Name} {wp.PrinterStatus ? `(${wp.PrinterStatus})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-ink-muted mb-1">
                Codificación (Codepage)
              </label>
              <select
                value={cocinaPrinter.codepage ?? 16}
                onChange={(e) => updatePrinterMutation.mutate({ id: cocinaPrinter.id, payload: { codepage: parseInt(e.target.value, 10) } })}
                className="w-full min-h-[48px] rounded-xl border border-border bg-surface px-3 text-xs font-bold text-ink outline-none focus:border-primary"
              >
                <option value={16}>16 (WPC1252 / Español)</option>
                <option value={2}>2 (Katakana / Estándar)</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};

export default PrintersPanel;
