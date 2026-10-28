import React, { useState, useEffect } from 'react';
import type { KdsOrder, KdsLineItem } from './KdsView.js';
import { Card, Button, Badge, Icon } from '../../ui/index.js';
import { formatTableLabel } from '../../lib/format.js';

interface KdsCardProps {
  order: KdsOrder;
  isNew?: boolean;
  onAcknowledge?: () => void;
  onUpdateLineStatus: (lineId: string, status: 'pendiente' | 'preparando' | 'listo') => void;
  onDeliverOrder: (orderId: string) => void;
  onStartPreparation?: (order: KdsOrder) => void;
  onMarkAllReady?: (order: KdsOrder) => void;
  onForceComplete?: (orderId: string) => void;
  isSupervisor?: boolean;
}

export const KdsCard: React.FC<KdsCardProps> = ({
  order,
  isNew = false,
  onAcknowledge,
  onUpdateLineStatus,
  onDeliverOrder,
  onStartPreparation,
  onMarkAllReady,
  onForceComplete,
  isSupervisor
}) => {
  // Cronómetro en vivo
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const safePassed = (!order.kitchenPassedAtMs || order.kitchenPassedAtMs <= 0) ? now : order.kitchenPassedAtMs;
  const elapsedMs = Math.max(0, now - safePassed);
  const minutes = Math.floor(elapsedMs / 60000);
  const seconds = Math.floor((elapsedMs % 60000) / 1000);
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const timeSeverity: 'green' | 'yellow' | 'red' = minutes >= 12 ? 'red' : minutes >= 8 ? 'yellow' : 'green';

  const isAllReady = order.allStationsReady || (order.lines.length > 0 && order.lines.every(l => l.status === 'listo'));
  const isAllPending = order.lines.length > 0 && order.lines.every(l => l.status === 'pendiente');

  const handleCardClick = () => {
    if (isNew && onAcknowledge) {
      onAcknowledge();
    }
  };

  return (
    <Card
      variant="surface"
      onClick={handleCardClick}
      className={`p-4 space-y-3.5 border transition-all ${
        isNew
          ? 'kds-card-flash ring-2 ring-primary border-primary'
          : order.isRefire
          ? 'border-danger bg-danger/5 ring-2 ring-danger/30'
          : isAllReady
          ? 'border-success bg-success/5'
          : 'border-border'
      }`}
    >
      {/* Cabecera de la comanda */}
      <div className="flex items-start justify-between gap-2 border-b border-border/60 pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-black text-ink">#{order.orderNumber}</span>
            <Badge variant="primary">{order.tableNumber ? formatTableLabel(order.tableNumber) : order.fulfillmentType}</Badge>
            {isNew && (
              <Badge variant="warning" className="font-black">NUEVO</Badge>
            )}
            {order.isRefire && (
              <Badge variant="danger">REPOSICIÓN URGENTE</Badge>
            )}
          </div>
          {/* Nombre del cliente */}
          <h3 className="text-lg font-black text-ink tracking-tight mt-1">
            {order.customerName || 'Cliente de Mostrador'}
          </h3>
        </div>

        {/* Semáforo de tiempo táctil */}
        <div
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-xs font-bold border ${
            timeSeverity === 'red'
              ? 'bg-danger-subtle border-danger/40 text-danger font-black'
              : timeSeverity === 'yellow'
              ? 'bg-warning-subtle border-warning/40 text-warning'
              : 'bg-success-subtle border-success/40 text-success'
          }`}
        >
          <Icon name="Clock" className="w-4 h-4" />
          <span>{formattedTime}</span>
        </div>
      </div>

      {order.notes && (
        <div className="p-2 bg-surface-alt border border-border/80 rounded-xl text-xs font-medium text-ink">
          <span className="font-bold text-ink-muted">Nota de comanda:</span> {order.notes}
        </div>
      )}

      {/* Renglones / Platos individuales de la comanda con tipografía >= 18px */}
      <div className="space-y-2">
        {order.lines.map((line: KdsLineItem) => {
          const isLineReady = line.status === 'listo';
          const isLineCooking = line.status === 'preparando';

          return (
            <div
              key={line.lineId}
              className={`p-3 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 transition ${
                isLineReady
                  ? 'border-success/40 bg-success/10'
                  : isLineCooking
                  ? 'border-primary/40 bg-primary/10'
                  : 'border-border bg-surface-alt/60'
              }`}
            >
              <div className="space-y-0.5 flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[18px] font-black text-ink leading-snug break-words">
                    {line.quantity}x {line.productName}
                  </span>
                  <Badge variant={isLineReady ? 'success' : isLineCooking ? 'primary' : 'neutral'}>
                    {line.status.toUpperCase()}
                  </Badge>
                </div>

                {/* Exclusiones / Modificadores */}
                {line.ingredientExclusions && line.ingredientExclusions.length > 0 && (
                  <p className="text-xs font-bold text-danger">
                    SIN: {line.ingredientExclusions.join(', ')}
                  </p>
                )}
                {line.ingredientExtras && line.ingredientExtras.length > 0 && (
                  <p className="text-xs font-bold text-primary">
                    + EXTRA: {line.ingredientExtras.join(', ')}
                  </p>
                )}
                {line.customInstructions && (
                  <p className="text-xs text-ink-muted italic">
                    Instrucción: {line.customInstructions}
                  </p>
                )}
              </div>

              {/* Acción de 1 toque por plato */}
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
                {isLineReady ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onUpdateLineStatus(line.lineId, 'preparando')}
                    leftIcon="RotateCcw"
                    className="min-h-[48px]"
                  >
                    Deshacer
                  </Button>
                ) : isLineCooking ? (
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => onUpdateLineStatus(line.lineId, 'listo')}
                    leftIcon="Check"
                    className="min-h-[48px] flex-1 sm:flex-initial font-bold"
                  >
                    Listo
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => onUpdateLineStatus(line.lineId, 'preparando')}
                    leftIcon="Flame"
                    className="min-h-[48px] flex-1 sm:flex-initial font-bold"
                  >
                    Preparar
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pie de comanda con botón de 1 toque */}
      <div className="pt-2 border-t border-border flex flex-col sm:flex-row gap-2 justify-between items-center">
        <span className="text-xs text-ink-muted font-bold">
          {isAllReady ? 'Todos los platos listos' : isAllPending ? 'Comanda por iniciar' : 'En preparación'}
        </span>

        <div className="flex flex-wrap gap-2 w-full sm:w-auto justify-end">
          {/* Botón Empezar (pasa toda la orden a preparación) */}
          {isAllPending && onStartPreparation && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => onStartPreparation(order)}
              leftIcon="Flame"
              className="min-h-[48px] flex-1 sm:flex-initial font-bold"
            >
              Empezar
            </Button>
          )}

          {/* Botón Despachar Orden si está lista */}
          {isAllReady ? (
            <Button
              data-testid="kds-one-touch-ready"
              variant="primary"
              size="md"
              onClick={() => onDeliverOrder(order.orderId)}
              leftIcon="CheckCircle"
              className="min-h-[48px] w-full sm:w-auto font-black shadow-sm"
            >
              Despachar orden
            </Button>
          ) : (
            /* Botón Marcar Todo Listo si está en preparación */
            onMarkAllReady && (
              <Button
                data-testid="kds-one-touch-ready"
                variant="primary"
                size="md"
                onClick={() => onMarkAllReady(order)}
                leftIcon="CheckCheck"
                className="min-h-[48px] w-full sm:w-auto font-black"
              >
                Marcar Todo Listo
              </Button>
            )
          )}

          {/* Despacho Forzado para supervisores si se traba */}
          {isSupervisor && !isAllReady && onForceComplete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onForceComplete(order.orderId)}
              leftIcon="Zap"
              className="min-h-[48px]"
            >
              Forzar Despacho
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};
