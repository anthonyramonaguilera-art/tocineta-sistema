import React, { useState } from 'react';
import { Card, Button, EmptyState, Icon } from '../../ui/index.js';
import { formatCents } from '../../lib/format.js';
import { downloadWithAuth } from '../../lib/download-file.js';
import { useClosureHistory, type JornadaHistoryItem } from './useClosureHistory.js';
import { getPaymentMethodHumanLabel } from './payment-labels.js';

function formatClosureDate(ms: number): string {
  if (!ms) return '-';
  const d = new Date(ms);
  return d.toLocaleDateString('es-VE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatNativeCurrency(cents: number, currency: string, isDiff = false): string {
  const isUsd = (currency || '').toUpperCase() === 'USD';
  const absFormatted = formatCents(Math.abs(cents));
  const prefix = isUsd ? '$' : 'Bs. ';
  if (isDiff) {
    if (cents === 0) return `${prefix}${absFormatted}`;
    if (cents > 0) return `+${prefix}${absFormatted}`;
    return `-${prefix}${absFormatted}`;
  }
  return cents < 0 ? `-${prefix}${absFormatted}` : `${prefix}${absFormatted}`;
}

export const ClosureHistoryView: React.FC = () => {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage
  } = useClosureHistory(20);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const toggleExpand = (jornadaId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(jornadaId)) {
        next.delete(jornadaId);
      } else {
        next.add(jornadaId);
      }
      return next;
    });
  };

  const handleDownload = async (jornadaId: string, type: 'pdf' | 'excel') => {
    setDownloadError(null);
    const key = `${jornadaId}-${type}`;
    setDownloadingKey(key);
    const ext = type === 'pdf' ? 'pdf' : 'xlsx';
    const filename = `reporte_jornada_${jornadaId}.${ext}`;
    const path = `/api/reports/jornada/${jornadaId}/${type}`;

    try {
      await downloadWithAuth(path, filename);
    } catch (err: any) {
      setDownloadError(err?.message || `Error al descargar ${type === 'pdf' ? 'PDF' : 'Excel'}`);
    } finally {
      setDownloadingKey(null);
    }
  };

  const jornadas: JornadaHistoryItem[] = data?.pages.flatMap(p => p.items) ?? [];

  if (isLoading) {
    return (
      <div className="p-8 text-center text-ink-muted flex flex-col items-center justify-center gap-3">
        <Icon name="RefreshCw" size={24} className="animate-spin text-ink-muted" />
        <span className="text-sm font-bold">Cargando historial de cierres...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 bg-surface rounded-xl border border-border text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-danger/10 text-danger flex items-center justify-center mx-auto">
          <Icon name="AlertCircle" size={24} />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-ink">Error al cargar historial</h3>
          <p className="text-sm text-ink-muted">
            {error instanceof Error ? error.message : 'No se pudo conectar con el servidor'}
          </p>
        </div>
        <Button
          variant="secondary"
          size="md"
          className="min-h-[48px]"
          iconStart="RefreshCw"
          onClick={() => refetch()}
        >
          Reintentar
        </Button>
      </div>
    );
  }

  if (jornadas.length === 0) {
    return (
      <EmptyState
        icon="History"
        title="Aún no hay cierres registrados"
        description="Los cierres de caja y jornadas finalizadas aparecerán aquí."
      />
    );
  }

  return (
    <div className="space-y-4">
      {downloadError && (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl flex items-center justify-between text-xs text-danger font-medium">
          <div className="flex items-center gap-2">
            <Icon name="AlertCircle" size={16} />
            <span>{downloadError}</span>
          </div>
          <button
            type="button"
            onClick={() => setDownloadError(null)}
            className="p-1 hover:opacity-80 rounded-lg text-danger"
            aria-label="Cerrar advertencia"
          >
            <Icon name="X" size={14} />
          </button>
        </div>
      )}

      <div className="space-y-3">
        {jornadas.map((jornada) => {
          const isExpanded = expandedIds.has(jornada.jornadaId);
          const hasDiff = jornada.sessions.some(s => s.hasDiff);
          const isDownloadingPdf = downloadingKey === `${jornada.jornadaId}-pdf`;
          const isDownloadingExcel = downloadingKey === `${jornada.jornadaId}-excel`;

          return (
            <Card key={jornada.jornadaId} variant="surface" className="p-4 space-y-3 border-border">
              {/* Encabezado de la tarjeta */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/40 pb-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-ink">
                      {formatClosureDate(jornada.closedAtMs)}
                    </span>
                    {hasDiff ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-warning/10 text-warning text-xs font-bold border border-warning/20">
                        <Icon name="AlertTriangle" size={16} className="text-warning" />
                        <span>Con diferencia</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-success/10 text-success text-xs font-bold border border-success/20">
                        <Icon name="Check" size={16} className="text-success" />
                        <span>Sin diferencia</span>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-muted">
                    Cerrada por: <span className="text-ink font-medium">{jornada.closedByName || 'Sin registrar'}</span>
                  </div>
                </div>

                {/* Métricas clave */}
                <div className="flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-ink-muted block text-[10px] uppercase font-bold tracking-wider">
                      Órdenes
                    </span>
                    <span className="font-bold text-ink">
                      {jornada.ordersCount}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-ink-muted block text-[10px] uppercase font-bold tracking-wider">
                      Ventas Netas
                    </span>
                    <span className="font-black text-ink text-sm">
                      ${formatCents(jornada.netSalesUsdCents)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Botones de acción */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="md"
                  className="min-h-[48px] text-xs font-bold"
                  iconEnd={isExpanded ? 'ChevronUp' : 'ChevronDown'}
                  onClick={() => toggleExpand(jornada.jornadaId)}
                >
                  {isExpanded ? 'Ocultar arqueo' : 'Ver detalle de arqueo'}
                </Button>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="md"
                    className="min-h-[48px] text-xs"
                    iconStart="FileDown"
                    isLoading={isDownloadingPdf}
                    disabled={Boolean(downloadingKey)}
                    onClick={() => handleDownload(jornada.jornadaId, 'pdf')}
                  >
                    Descargar PDF
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    className="min-h-[48px] text-xs"
                    iconStart="FileSpreadsheet"
                    isLoading={isDownloadingExcel}
                    disabled={Boolean(downloadingKey)}
                    onClick={() => handleDownload(jornada.jornadaId, 'excel')}
                  >
                    Exportar Excel
                  </Button>
                </div>
              </div>

              {/* Detalle expandible con tabla por sesión y método */}
              {isExpanded && (
                <div className="pt-3 border-t border-border/40 space-y-4">
                  {jornada.sessions.length === 0 ? (
                    <p className="text-xs text-ink-muted italic py-2">
                      No hay sesiones de caja registradas para esta jornada.
                    </p>
                  ) : (
                    jornada.sessions.map((session) => (
                      <div key={session.sessionId} className="p-3 bg-surface-alt rounded-xl border border-border space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs">
                            {session.hasDiff ? (
                              <Icon name="AlertTriangle" size={16} className="text-warning" />
                            ) : (
                              <Icon name="Check" size={16} className="text-success" />
                            )}
                            <span className="font-bold text-ink">Cajera: {session.userName}</span>
                          </div>
                          <span className="text-[10px] text-ink-muted uppercase font-bold tracking-wider">
                            Arqueo de sesión
                          </span>
                        </div>

                        {session.methods.length === 0 ? (
                          <p className="text-xs text-ink-muted italic">
                            Sin conteo detallado de métodos registrado.
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left">
                              <thead>
                                <tr className="border-b border-border/60 text-[10px] uppercase font-bold tracking-wider text-ink-muted">
                                  <th className="py-1.5 pr-2">Método</th>
                                  <th className="py-1.5 px-2 text-right">Esperado</th>
                                  <th className="py-1.5 px-2 text-right">Contado</th>
                                  <th className="py-1.5 pl-2 text-right">Diferencia</th>
                                </tr>
                              </thead>
                              <tbody>
                                {session.methods.map((methodItem, idx) => {
                                  const isExact = methodItem.diffCents === 0;
                                  const isSurplus = methodItem.diffCents > 0;
                                  const diffColor = isExact
                                    ? 'text-ink-muted'
                                    : isSurplus
                                      ? 'text-success font-bold'
                                      : 'text-danger font-bold';

                                  return (
                                    <tr key={idx} className="border-b border-border/20 last:border-0">
                                      <td className="py-1.5 pr-2 font-medium text-ink">
                                        {getPaymentMethodHumanLabel(methodItem.method)}
                                      </td>
                                      <td className="py-1.5 px-2 text-right font-mono text-ink">
                                        {formatNativeCurrency(methodItem.expectedCents, methodItem.currency)}
                                      </td>
                                      <td className="py-1.5 px-2 text-right font-mono text-ink">
                                        {formatNativeCurrency(methodItem.countedCents, methodItem.currency)}
                                      </td>
                                      <td className={`py-1.5 pl-2 text-right font-mono ${diffColor}`}>
                                        {formatNativeCurrency(methodItem.diffCents, methodItem.currency, true)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button
            variant="secondary"
            size="md"
            className="min-h-[48px] w-full sm:w-auto"
            iconStart="ArrowDown"
            isLoading={isFetchingNextPage}
            disabled={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            Cargar más
          </Button>
        </div>
      )}
    </div>
  );
};

export default ClosureHistoryView;
