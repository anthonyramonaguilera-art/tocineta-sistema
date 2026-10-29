import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Badge, Icon } from '../../ui/index.js';
import type { BusinessSettings } from './types.js';

/**
 * Nota técnica sobre worker.ts:
 * El worker decide enviar por Windows RAW (sendWindowsRawEscPos) cuando connection_type es 'windows_raw' o 'spooler_raw_usb',
 * utilizando el campo address como el nombre exacto de la impresora de Windows en el spooler.
 */

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

interface WindowsPrinter {
  Name: string;
  PortName?: string;
  DriverName?: string;
  PrinterStatus?: string | number;
}

export const PrintersPanel: React.FC = () => {
  const queryClient = useQueryClient();
  const [testResults, setTestResults] = useState<Record<string, { diagnostic: string; message?: string; simulated?: boolean }>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  // 1. Cargar impresoras configuradas
  const { data: printersRes, isLoading: isLoadingPrinters } = useQuery<{ success: boolean; data: PrinterItem[] }>({
    queryKey: ['printersConfig'],
    queryFn: async () => {
      const res = await fetch('/api/printers');
      if (!res.ok) throw new Error('Error al cargar impresoras configuradas');
      return res.json();
    }
  });

  // 2. Cargar impresoras detectadas en Windows
  const { data: windowsPrinters = [], isLoading: isLoadingWindows } = useQuery<WindowsPrinter[]>({
    queryKey: ['windowsPrinters'],
    queryFn: async () => {
      const res = await fetch('/api/printers/windows');
      if (!res.ok) return [];
      return res.json();
    }
  });

  // 3. Cargar business settings (para print_mode)
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

  // Mutación para actualizar impresora
  const updatePrinterMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: any }) => {
      const res = await fetch(`/api/printers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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

  // Mutación para actualizar print_mode
  const updateSettingsMutation = useMutation({
    mutationFn: async (newMode: 'one' | 'two') => {
      const res = await fetch('/api/business-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ print_mode: newMode })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Error al actualizar modo de impresión');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businessSettings'] });
      setActionError(null);
    },
    onError: (err: any) => {
      setActionError(err.message || 'Error al actualizar modo de impresión');
    }
  });

  // Mutación para test de impresión
  const testPrinterMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/printers/${id}/test`, {
        method: 'POST'
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

  const handleSelectCajaWindowsPrinter = (winPrinterName: string) => {
    if (!cajaPrinter) return;
    updatePrinterMutation.mutate({
      id: cajaPrinter.id,
      payload: {
        address: winPrinterName,
        name: winPrinterName,
        connection_type: 'SPOOLER_RAW_USB'
      }
    });
  };

  const handleSelectCocinaWindowsPrinter = (winPrinterName: string) => {
    if (!cocinaPrinter) return;
    updatePrinterMutation.mutate({
      id: cocinaPrinter.id,
      payload: {
        address: winPrinterName,
        name: winPrinterName,
        connection_type: 'SPOOLER_RAW_USB'
      }
    });
  };

  const handleTogglePrintMode = (newMode: 'one' | 'two') => {
    updateSettingsMutation.mutate(newMode);
  };

  const handleUpdatePrinterField = (printerId: string, fields: Record<string, any>) => {
    updatePrinterMutation.mutate({
      id: printerId,
      payload: fields
    });
  };

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

      {!hasWindowsPrinters && !isLoadingWindows && (
        <div className="p-4 rounded-xl bg-warning/10 border border-warning/30 text-xs text-ink font-medium space-y-1">
          <div className="font-bold flex items-center gap-1.5 text-warning-dark">
            <Icon name="AlertTriangle" size={16} />
            <span>Aviso de Impresoras de Windows</span>
          </div>
          <p>
            No se detectaron impresoras instaladas en el spooler de Windows. Las pruebas funcionarán en modo simulado.
          </p>
        </div>
      )}

      {/* Switch Usar una sola impresora (todo por Caja) */}
      <div className="p-4 rounded-2xl bg-surface-alt/50 border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <span className="font-extrabold text-xs text-ink block">
            Usar una sola impresora (Todo por Caja)
          </span>
          <span className="text-[11px] text-ink-muted block leading-relaxed">
            Modo 1 Impresión: Las comandas de cocina y notas de entrega salen por la impresora de Caja.
            Modo 2 Impresiones: Envía comandas a cocina y notas de entrega a caja por separado.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleTogglePrintMode(printMode === 'one' ? 'two' : 'one')}
            className={`min-h-[48px] px-4 py-2 rounded-xl text-xs font-black uppercase transition-all flex items-center gap-2 ${
              printMode === 'one'
                ? 'bg-primary text-surface shadow-xs'
                : 'bg-surface border border-border text-ink hover:border-primary'
            }`}
          >
            <Icon name={printMode === 'one' ? 'Check' : 'Circle'} size={16} />
            <span>Modo Único (Caja)</span>
          </button>
          <button
            type="button"
            onClick={() => handleTogglePrintMode(printMode === 'two' ? 'one' : 'two')}
            className={`min-h-[48px] px-4 py-2 rounded-xl text-xs font-black uppercase transition-all flex items-center gap-2 ${
              printMode === 'two'
                ? 'bg-primary text-surface shadow-xs'
                : 'bg-surface border border-border text-ink hover:border-primary'
            }`}
          >
            <Icon name={printMode === 'two' ? 'Check' : 'Circle'} size={16} />
            <span>Modo Dos Impresoras</span>
          </button>
        </div>
      </div>

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
                onChange={(e) => handleSelectCajaWindowsPrinter(e.target.value)}
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
                onChange={(e) => handleUpdatePrinterField(cajaPrinter.id, { codepage: parseInt(e.target.value, 10) })}
                className="w-full min-h-[48px] rounded-xl border border-border bg-surface px-3 text-xs font-bold text-ink outline-none focus:border-primary"
              >
                <option value={16}>16 (WPC1252 / Español)</option>
                <option value={2}>2 (Katakana / Estándar)</option>
              </select>
            </div>
          </div>

          {/* Opciones Avanzadas Caja */}
          <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-border text-xs">
            <label className="flex items-center gap-2 cursor-pointer min-h-[48px]">
              <input
                type="checkbox"
                checked={Boolean(cajaPrinter.has_cutter)}
                onChange={(e) => handleUpdatePrinterField(cajaPrinter.id, { has_cutter: e.target.checked })}
                className="w-5 h-5 rounded cursor-pointer accent-primary"
              />
              <span className="font-bold text-ink">Tiene Guillotina (Auto-Corte)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer min-h-[48px]">
              <input
                type="checkbox"
                checked={Boolean(cajaPrinter.has_buzzer)}
                onChange={(e) => handleUpdatePrinterField(cajaPrinter.id, { has_buzzer: e.target.checked })}
                className="w-5 h-5 rounded cursor-pointer accent-primary"
              />
              <span className="font-bold text-ink">Tiene Buzzer (Zumbador)</span>
            </label>
          </div>

          {/* Resultados de Test Caja */}
          {testResults[cajaPrinter.id] && (
            <div className="p-3 rounded-xl bg-success/10 border border-success/30 text-xs text-success font-medium space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <Icon name="CheckCircle" size={16} />
                <span>Prueba de Impresión Exitosa</span>
              </div>
              <p>
                Diagnóstico: <span className="font-mono font-bold">{testResults[cajaPrinter.id].diagnostic}</span>
                {testResults[cajaPrinter.id].simulated && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-warning/20 text-warning-dark text-[10px] font-bold">
                    SIMULADO (Sin hardware físico conectado)
                  </span>
                )}
              </p>
            </div>
          )}

          {testErrors[cajaPrinter.id] && (
            <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-xs text-danger font-medium space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <Icon name="AlertCircle" size={16} />
                <span>Error en Prueba de Impresión</span>
              </div>
              <p>{testErrors[cajaPrinter.id]}</p>
            </div>
          )}
        </div>
      )}

      {/* Selector Impresora de Cocina (Solo si printMode === 'two') */}
      {printMode === 'two' && (
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
                  Vinculada actualmente: <span className="font-mono font-bold text-ink">{cocinaPrinter?.address || 'Ninguna'}</span>
                </p>
              </div>
            </div>
            {cocinaPrinter && (
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
            )}
          </div>

          {cocinaPrinter && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-2">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-ink-muted mb-1">
                    Seleccionar Impresora del Spooler de Windows
                  </label>
                  <select
                    value={cocinaPrinter.address}
                    onChange={(e) => handleSelectCocinaWindowsPrinter(e.target.value)}
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
                    onChange={(e) => handleUpdatePrinterField(cocinaPrinter.id, { codepage: parseInt(e.target.value, 10) })}
                    className="w-full min-h-[48px] rounded-xl border border-border bg-surface px-3 text-xs font-bold text-ink outline-none focus:border-primary"
                  >
                    <option value={16}>16 (WPC1252 / Español)</option>
                    <option value={2}>2 (Katakana / Estándar)</option>
                  </select>
                </div>
              </div>

              {/* Opciones Avanzadas Cocina */}
              <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-border text-xs">
                <label className="flex items-center gap-2 cursor-pointer min-h-[48px]">
                  <input
                    type="checkbox"
                    checked={Boolean(cocinaPrinter.has_cutter)}
                    onChange={(e) => handleUpdatePrinterField(cocinaPrinter.id, { has_cutter: e.target.checked })}
                    className="w-5 h-5 rounded cursor-pointer accent-primary"
                  />
                  <span className="font-bold text-ink">Tiene Guillotina (Auto-Corte)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer min-h-[48px]">
                  <input
                    type="checkbox"
                    checked={Boolean(cocinaPrinter.has_buzzer)}
                    onChange={(e) => handleUpdatePrinterField(cocinaPrinter.id, { has_buzzer: e.target.checked })}
                    className="w-5 h-5 rounded cursor-pointer accent-primary"
                  />
                  <span className="font-bold text-ink">Tiene Buzzer (Zumbador)</span>
                </label>
              </div>

              {/* Resultados de Test Cocina */}
              {testResults[cocinaPrinter.id] && (
                <div className="p-3 rounded-xl bg-success/10 border border-success/30 text-xs text-success font-medium space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <Icon name="CheckCircle" size={16} />
                    <span>Prueba de Impresión Exitosa</span>
                  </div>
                  <p>
                    Diagnóstico: <span className="font-mono font-bold">{testResults[cocinaPrinter.id].diagnostic}</span>
                    {testResults[cocinaPrinter.id].simulated && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-warning/20 text-warning-dark text-[10px] font-bold">
                        SIMULADO (Sin hardware físico conectado)
                      </span>
                    )}
                  </p>
                </div>
              )}

              {testErrors[cocinaPrinter.id] && (
                <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-xs text-danger font-medium space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <Icon name="AlertCircle" size={16} />
                    <span>Error en Prueba de Impresión</span>
                  </div>
                  <p>{testErrors[cocinaPrinter.id]}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
};

export default PrintersPanel;
