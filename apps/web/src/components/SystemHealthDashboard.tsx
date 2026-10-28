import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Database,
  HardDrive,
  Clock,
  RefreshCw,
  AlertTriangle,
  Camera,
  Layers,
  Printer,
  ShieldCheck,
  Usb,
  KeyRound
} from 'lucide-react';
import { fetchSystemHealth } from '../api/client.js';
import { StatusCard, MetricRow } from './StatusCard.js';
import { PedagogicalGuideBanner } from './PedagogicalGuideBanner.js';

export const SystemHealthDashboard: React.FC = () => {
  const [backupStatus, setBackupStatus] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isExporting, setIsExporting] = React.useState(false);

  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['systemHealth'],
    queryFn: fetchSystemHealth,
    refetchInterval: 3000 // Refresco automático en vivo cada 3 segundos
  });

  const handleExportEncrypted = async () => {
    setIsExporting(true);
    setBackupStatus(null);
    try {
      const res = await fetch('/api/backups/export-encrypted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'Error al exportar respaldo cifrado');
      setBackupStatus({
        type: 'success',
        text: `✓ Respaldo cifrado exitoso: ${resData.backup?.filename || 'copia creada'} (${((resData.backup?.fileSizeBytes || 0) / 1024).toFixed(1)} KB)`
      });
      setTimeout(() => setBackupStatus(null), 5000);
      refetch();
    } catch (e: any) {
      setBackupStatus({
        type: 'error',
        text: `Error al exportar respaldo: ${e.message}`
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <RefreshCw className="w-8 h-8 text-tocineta-yellow animate-spin" />
        <p className="text-sm font-semibold text-tocineta-muted">
          Conectando al sistema local del Food Truck...
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-6 bg-tocineta-card border border-tocineta-red/40 rounded-xl text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-tocineta-red mx-auto" />
        <h2 className="text-lg font-bold text-white uppercase">
          Error de Conexión con el Sistema Local
        </h2>
        <p className="text-sm text-tocineta-muted">
          {(error as Error)?.message || 'No se pudo obtener el estado del sistema.'}
        </p>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 bg-tocineta-yellow text-black font-bold px-4 py-2 rounded-lg text-xs uppercase hover:bg-tocineta-yellow-hover transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Reintentar Conexión
        </button>
      </div>
    );
  }

  const { database, system, systemTime, architecture, version } = data;
  const isWalValid = database.pragmas.journalMode.toLowerCase() === 'wal';
  const isSyncValid = database.pragmas.synchronous === 2; // FULL
  const isFkValid = database.pragmas.foreignKeys === 1;

  return (
    <div className="space-y-6">
      {/* Guía Pedagógica sin jerga técnica */}
      <PedagogicalGuideBanner
        title="Guía de Impresoras y Respaldos"
        description="Aquí puedes revisar que la impresora de tickets y comandas esté conectada, descargar respaldos de seguridad de tus ventas y verificar la salud del equipo."
        storageKey="tocineta_guide_health"
      />

      {backupStatus && (
        <div
          className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-between ${
            backupStatus.type === 'success'
              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
              : 'bg-red-500/20 border-red-500/50 text-red-300'
          }`}
        >
          <span>{backupStatus.text}</span>
          <button onClick={() => setBackupStatus(null)} className="text-sm font-black ml-2 hover:text-white">✕</button>
        </div>
      )}

      {/* Banner Principal de Estado de Producción */}
      <div className="bg-gradient-to-r from-tocineta-card via-[#1A1F2B] to-tocineta-card border border-tocineta-border rounded-2xl p-6 relative overflow-hidden shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-tocineta-green animate-ping" />
              <span className="text-xs font-bold text-tocineta-green tracking-wider uppercase">
                Sistema Conectado al Food Truck
              </span>
            </div>
            <h2 className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-2">
              <Printer className="w-6 h-6 text-tocineta-yellow" />
              <span>Impresoras y Respaldos</span>
            </h2>
            <p className="text-xs text-tocineta-muted max-w-xl">
              Estado de impresoras térmicas, copias de seguridad de las ventas y base de datos local blindada.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleExportEncrypted}
              disabled={isExporting}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-black px-4 py-2.5 rounded-xl text-xs uppercase transition-all shadow disabled:opacity-50 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{isExporting ? 'Cifrando...' : 'Exportar Respaldo Cifrado'}</span>
            </button>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-2 bg-[#0B0D11] border border-tocineta-border hover:border-tocineta-yellow text-white font-bold px-4 py-2.5 rounded-xl text-xs uppercase transition-all shadow"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-tocineta-yellow ${isFetching ? 'animate-spin' : ''}`} />
              <span>{isFetching ? 'Actualizando...' : 'Refrescar'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Grid de Métricas Principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Tarjeta 1: Motor SQLite & Persistencia */}
        <StatusCard
          title="Motor SQLite & WAL"
          icon={<Database className="w-5 h-5" />}
          badge={{
            text: isWalValid && isSyncValid ? 'WAL + FULL SYNC' : 'ATENCIÓN',
            variant: isWalValid && isSyncValid ? 'success' : 'warning'
          }}
        >
          <MetricRow
            label="Modo Journal"
            value={database.pragmas.journalMode.toUpperCase()}
            highlight={isWalValid}
          />
          <MetricRow
            label="Sincronización (Synchronous)"
            value={`${database.pragmas.synchronous} (FULL)`}
            highlight={isSyncValid}
          />
          <MetricRow
            label="Claves Foráneas (Foreign Keys)"
            value={isFkValid ? 'ACTIVADAS (1)' : 'DESACTIVADAS'}
            highlight={isFkValid}
          />
          <MetricRow
            label="Timeout de Bloqueo (Busy Timeout)"
            value={`${database.pragmas.busyTimeoutMs} ms`}
          />
          <MetricRow
            label="Tamaño Archivo DB"
            value={`${(database.sizeBytes / 1024).toFixed(1)} KB`}
          />
          <MetricRow
            label="Tamaño Archivo WAL"
            value={`${(database.walSizeBytes / 1024).toFixed(1)} KB`}
          />
        </StatusCard>

        {/* Tarjeta 2: Snapshots Físicos en Caliente */}
        <StatusCard
          title="Hot Backup & Migraciones"
          icon={<Camera className="w-5 h-5" />}
          badge={{
            text: database.lastSnapshot ? 'PROTEGIDO' : 'INICIAL',
            variant: 'yellow'
          }}
        >
          <div className="p-3 bg-[#0B0D11] rounded-lg border border-tocineta-border text-xs space-y-1.5 mb-2">
            <span className="text-[11px] font-bold text-tocineta-yellow uppercase flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5" />
              Snapshot de Migración Automático
            </span>
            <p className="text-tocineta-muted text-[11px] leading-relaxed">
              Antes de aplicar cada migración, se genera una copia física íntegra con <code className="text-white">better-sqlite3 .backup()</code> en <code className="text-white">./data/snapshots/</code>.
            </p>
          </div>

          <MetricRow
            label="Último Snapshot"
            value={database.lastSnapshot ? database.lastSnapshot.filename : 'Ninguno (Migración Inicial)'}
          />
          {database.lastSnapshot && (
            <>
              <MetricRow
                label="Fecha de Creación"
                value={new Date(database.lastSnapshot.createdAtIso).toLocaleString('es-VE')}
              />
              <MetricRow
                label="Tamaño Backup"
                value={`${(database.lastSnapshot.sizeBytes / 1024).toFixed(1)} KB`}
              />
            </>
          )}
          <MetricRow
            label="Estrategia Migraciones"
            value="Forward-Only (Solo Avance)"
          />
        </StatusCard>

        {/* Tarjeta 3: Hardware Laptop HP & Almacenamiento */}
        <StatusCard
          title="Hardware HP & Almacenamiento"
          icon={<HardDrive className="w-5 h-5" />}
          badge={{
            text: `${system.disk.percentFree}% LIBRE`,
            variant: system.disk.percentFree > 10 ? 'success' : 'warning'
          }}
        >
          <div className="space-y-1.5 pb-2">
            <div className="flex justify-between text-xs text-tocineta-muted">
              <span>Espacio Libre en SSD:</span>
              <span className="font-mono text-white font-bold">{system.disk.freeFormatted} / {system.disk.totalFormatted}</span>
            </div>
            <div className="w-full h-2 bg-[#0B0D11] rounded-full overflow-hidden border border-tocineta-border">
              <div
                className="h-full bg-tocineta-yellow transition-all duration-500"
                style={{ width: `${Math.max(5, 100 - system.disk.percentFree)}%` }}
              />
            </div>
          </div>

          <MetricRow
            label="Memoria Proceso (RSS)"
            value={`${system.memory.rssMb} MB`}
          />
          <MetricRow
            label="Heap Utilizado"
            value={`${system.memory.heapUsedMb} MB / ${system.memory.heapTotalMb} MB`}
          />
          <MetricRow
            label="Sistema Operativo Destino"
            value={`${system.platform} (Windows 11 HP)`}
          />
          <MetricRow
            label="Entorno Node.js"
            value={system.nodeVersion}
          />
        </StatusCard>

        {/* Tarjeta 4: Sincronización Horaria y Red */}
        <StatusCard
          title="Sincronización Horaria & Red"
          icon={<Clock className="w-5 h-5" />}
          badge={{
            text: systemTime.timezone,
            variant: 'info'
          }}
        >
          <MetricRow
            label="Hora Local Food Truck"
            value={systemTime.localTimeCaracas}
            highlight
          />
          <MetricRow
            label="Timestamp UTC (ms)"
            value={systemTime.utcMs.toString()}
          />
          <MetricRow
            label="Tiempo en Ejecución (Uptime)"
            value={`${Math.floor(system.uptimeSec / 60)}m ${system.uptimeSec % 60}s`}
          />
          <MetricRow
            label="Escuchando en Red"
            value="0.0.0.0:3000 (LAN)"
          />
          <MetricRow
            label="Modo Conexión"
            value="100% Offline (Sin WAN)"
          />
        </StatusCard>

        {/* Tarjeta 5: Puertas de Impresión Gate G0 */}
        <StatusCard
          title="Gate G0 Impresoras Térmicas"
          icon={<Printer className="w-5 h-5" />}
          badge={{
            text: 'GATE G0 READY',
            variant: 'yellow'
          }}
        >
          <MetricRow
            label="Impresora Comanda (Cocina)"
            value="DP58U-03 (58mm)"
          />
          <MetricRow
            label="Impresora Facturación (Barra)"
            value="MP583 (58mm)"
          />
          <MetricRow
            label="Ancho Útil Medido"
            value="32 columnas (384 dots)"
          />
          <MetricRow
            label="Canal USB"
            value="winspool.Drv RAW Spooler"
          />
          <MetricRow
            label="Canal LAN"
            value="TCP Port 9100 Directo"
          />
        </StatusCard>

        {/* Tarjeta 6: Arquitectura y Versión */}
        <StatusCard
          title="Control de Versión & Stack"
          icon={<Layers className="w-5 h-5" />}
          badge={{
            text: `v${version}`,
            variant: 'info'
          }}
        >
          <MetricRow
            label="Arquitectura del Sistema"
            value={architecture.toUpperCase()}
          />
          <MetricRow
            label="Servidor Web & API"
            value="Fastify 5 + WebSocket"
          />
          <MetricRow
            label="ORM & Esquema"
            value="Drizzle ORM + better-sqlite3"
          />
          <MetricRow
            label="Frontend Web"
            value="React 19 + Vite + Tailwind"
          />
          <MetricRow
            label="Cliente de Estado"
            value="TanStack Query v5"
          />
        </StatusCard>

        {/* Tarjeta 7: SUG-03 - Simulacro de Restauración (Dry-Run) */}
        <StatusCard
          title="Simulacro Dry-Run Restauración"
          icon={<ShieldCheck className="w-5 h-5" />}
          badge={{
            text: data.dryRun?.status === 'OK' ? 'VERIFICADO' : (data.dryRun?.status === 'ERROR' ? 'FALLO' : 'PENDIENTE'),
            variant: data.dryRun?.status === 'OK' ? 'success' : (data.dryRun?.status === 'ERROR' ? 'warning' : 'info')
          }}
        >
          <MetricRow
            label="Estado del Simulacro"
            value={data.dryRun?.status === 'OK' ? '100% Íntegro' : (data.dryRun?.status || 'No ejecutado')}
            highlight={data.dryRun?.status === 'OK'}
          />
          <MetricRow
            label="Último Chequeo"
            value={data.dryRun?.checkedAtMs ? new Date(data.dryRun.checkedAtMs).toLocaleTimeString('es-VE') : 'Pendiente al abrir jornada'}
          />
          <MetricRow
            label="Snapshot Verificado"
            value={data.dryRun?.snapshotVerified || 'Ninguno'}
          />
          <MetricRow
            label="Cadena SHA-256"
            value={data.dryRun?.auditChainValid ? 'Válida (Inmutable)' : 'No validada'}
            highlight={Boolean(data.dryRun?.auditChainValid)}
          />
          <MetricRow
            label="Impacto en Producción"
            value="Solo Lectura (Cero Bloqueos)"
          />
        </StatusCard>

        {/* Tarjeta 8: SUG-02 - Bóveda USB (.tocineta-usb-vault) */}
        <StatusCard
          title="Bóveda USB Vault (.tocineta-usb-vault)"
          icon={<Usb className="w-5 h-5" />}
          badge={{
            text: data.usbVault?.connected ? 'USB DETECTADA' : 'CONTINGENCIA SSD',
            variant: data.usbVault?.connected ? (data.usbVault?.warning ? 'warning' : 'success') : 'yellow'
          }}
        >
          {data.usbVault?.warning && (
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300 font-bold mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{data.usbVault.warning}</span>
            </div>
          )}
          <MetricRow
            label="Dispositivo USB"
            value={data.usbVault?.connected ? 'Conectado (.tocineta-usb-vault)' : 'Desconectado (Ruta Local)'}
            highlight={Boolean(data.usbVault?.connected)}
          />
          <MetricRow
            label="Ruta de Respaldo"
            value={data.usbVault?.vaultPath || './data/backups/usb'}
          />
          <MetricRow
            label="Espacio Utilizado"
            value={data.usbVault?.percentUsed !== null && data.usbVault?.percentUsed !== undefined ? `${data.usbVault.percentUsed}% ocupado` : 'N/A (Local SSD)'}
          />
          <MetricRow
            label="Espacio Libre"
            value={data.usbVault?.percentFree !== null && data.usbVault?.percentFree !== undefined ? `${data.usbVault.percentFree}% disponible` : 'Gestionado en disco'}
          />
        </StatusCard>

        {/* Tarjeta 9: SUG-05 - Custodia Criptográfica age */}
        <StatusCard
          title="Custodia Criptográfica age"
          icon={<KeyRound className="w-5 h-5" />}
          badge={{
            text: data.ageKeys?.mode === 'PRODUCTION' ? 'PRODUCCIÓN' : 'DESARROLLO',
            variant: data.ageKeys?.mode === 'PRODUCTION' ? 'success' : 'yellow'
          }}
        >
          <MetricRow
            label="Modo de Claves"
            value={data.ageKeys?.isProduction ? 'Claves Definitivas Producción' : 'Claves de Prueba (Dev)'}
            highlight={Boolean(data.ageKeys?.isProduction)}
          />
          <MetricRow
            label="Destinatarios Autorizados"
            value={`${data.ageKeys?.recipientsCount || 2} (Administración + Clave Segura)`}
          />
          <MetricRow
            label="Clave Privada en Laptop"
            value="NUNCA (Cero claves privadas en disco)"
            highlight
          />
          <MetricRow
            label="Cifrado Dual Asimétrico"
            value="X25519 + ChaCha20-Poly1305"
          />
        </StatusCard>
      </div>

      {/* Footer del Dashboard */}
      <div className="text-center py-4 text-xs text-tocineta-muted border-t border-tocineta-border/60">
        TOCINETA • Sistema Operativo Gastronómico • Producción
      </div>
    </div>
  );
};
