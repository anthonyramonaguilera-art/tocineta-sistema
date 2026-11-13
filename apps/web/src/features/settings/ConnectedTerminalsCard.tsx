import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Badge, Icon, Button } from '../../ui/index.js';
import { apiFetch } from '../../api/client.js';
import { getTerminalLabel, setTerminalLabel } from '../../lib/terminal-identity.js';
import { hasNativePrinting } from '../../lib/mobile-print-bridge.js';
import { DevicePrinterCard } from './DevicePrinterCard.js';

interface TerminalItem {
  terminalId: string;
  label?: string;
  btPrinter?: { name: string; mac: string };
  lastSeenMs: number;
  alive: boolean;
}

interface ConnectedTerminalsCardProps {
  token?: string | null;
}

function formatLastSeen(lastSeenMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - lastSeenMs) / 1000));
  if (diffSec < 60) return 'Hace unos segundos';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;
  return new Date(lastSeenMs).toLocaleDateString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export const ConnectedTerminalsCard: React.FC<ConnectedTerminalsCardProps> = ({ token }) => {
  const isApk = hasNativePrinting();
  const [deviceLabel, setDeviceLabel] = useState<string>(() => getTerminalLabel() || '');
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  const { data: terminals = [], isLoading, refetch } = useQuery<TerminalItem[]>({
    queryKey: ['terminalsList'],
    queryFn: async () => {
      const res = await apiFetch('/api/terminals', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 10000
  });

  const handleRefreshAll = () => {
    void refetch();
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleSaveLabel = (e: React.FormEvent) => {
    e.preventDefault();
    setTerminalLabel(deviceLabel.trim());
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  return (
    <Card variant="surface" className="p-5 border border-border space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Icon name="Smartphone" size={18} className="text-primary" />
          <h3 className="font-extrabold text-sm text-ink uppercase tracking-wide">
            Dispositivos conectados
          </h3>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleRefreshAll}
          className="min-h-[48px] px-3 text-xs"
          leftIcon="RefreshCw"
        >
          Actualizar
        </Button>
      </div>

      {/* Impresora exclusiva de este dispositivo */}
      <DevicePrinterCard
        onPrinterConfigured={() => void refetch()}
        refreshTrigger={refreshTrigger}
      />

      {/* Campo exclusivo dentro de la APK */}
      {isApk && (
        <form onSubmit={handleSaveLabel} className="p-4 rounded-xl border border-border bg-surface/50 space-y-3">
          <div>
            <label className="block text-[11px] font-bold text-ink-muted mb-1">
              Nombre de este dispositivo
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
                placeholder="Ej. Caja Móvil 1"
                maxLength={40}
                className="flex-1 min-h-[48px] rounded-xl border border-border bg-surface px-3 text-xs font-bold text-ink outline-none focus:border-primary"
              />
              <Button
                type="submit"
                variant="primary"
                size="md"
                className="min-h-[48px] px-5 text-xs font-bold"
              >
                Guardar nombre
              </Button>
            </div>
          </div>
          {savedSuccess && (
            <p className="text-[11px] font-bold text-success flex items-center gap-1">
              <Icon name="Check" size={14} />
              Nombre del terminal guardado correctamente
            </p>
          )}
        </form>
      )}

      {/* Lista de solo lectura de terminales */}
      {isLoading ? (
        <div className="flex justify-center py-6">
          <span className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : terminals.length === 0 ? (
        <p className="text-xs text-ink-muted py-4 text-center">
          No hay terminales registrados en este momento.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {terminals.map((term) => {
            const displayName = term.label && term.label.trim().length > 0 ? term.label : term.terminalId;
            const printerInfo = term.btPrinter
              ? `${term.btPrinter.name} (${term.btPrinter.mac})`
              : 'Ninguna';

            return (
              <div key={term.terminalId} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-ink">{displayName}</span>
                    <Badge variant={term.alive ? 'success' : 'neutral'}>
                      {term.alive ? 'Conectado' : 'Desconectado'}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-ink-muted flex flex-wrap gap-x-4 gap-y-0.5">
                    <span>
                      Impresora Bluetooth: <strong className="text-ink">{printerInfo}</strong>
                    </span>
                    <span>
                      Última conexión: <strong className="text-ink">{formatLastSeen(term.lastSeenMs)}</strong>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};
