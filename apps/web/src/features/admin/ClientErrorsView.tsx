import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Button, Badge, EmptyState, Icon } from '../../ui/index.js';

interface ClientErrorRecord {
  id: string;
  view_name: string;
  error_message: string;
  error_stack?: string | null;
  user_id?: string | null;
  user_role?: string | null;
  created_at_ms: number;
}

export const ClientErrorsView: React.FC = () => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<{ success: boolean; errors: ClientErrorRecord[] }>({
    queryKey: ['client-errors'],
    queryFn: async () => {
      const res = await fetch('/api/client-errors');
      if (!res.ok) throw new Error('Error al consultar registro de incidentes');
      return res.json();
    }
  });

  const errors = data?.errors || [];

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-black text-ink uppercase tracking-tight flex items-center gap-2">
            <Icon name="AlertTriangle" className="w-6 h-6 text-danger" />
            Registro de Errores en Clientes
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Incidentes no controlados capturados por el ErrorBoundary en terminales de meseros, caja y cocina.
          </p>
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={() => refetch()}
          leftIcon="RotateCw"
          loading={isLoading}
        >
          Actualizar
        </Button>
      </div>

      {isLoading ? (
        <Card variant="surface" className="p-12 text-center">
          <p className="text-sm text-ink-muted">Cargando incidentes registrados...</p>
        </Card>
      ) : errors.length === 0 ? (
        <EmptyState
          title="Sin errores registrados"
          description="Excelente: no se han reportado excepciones no controladas en las terminales cliente."
          icon="CheckCircle"
        />
      ) : (
        <div className="space-y-4">
          {errors.map(err => {
            const isExpanded = expandedId === err.id;
            const dateStr = new Date(err.created_at_ms).toLocaleString('es-VE');

            return (
              <Card key={err.id} variant="surface" className="p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="danger">
                      {err.view_name}
                    </Badge>
                    {err.user_role && (
                      <Badge variant="neutral">
                        {err.user_role}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-ink-muted font-mono">{dateStr}</span>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-ink break-words">
                    {err.error_message}
                  </h4>
                  {err.user_id && (
                    <p className="text-xs text-ink-muted mt-0.5">
                      Usuario: <span className="font-mono">{err.user_id}</span>
                    </p>
                  )}
                </div>

                {err.error_stack && (
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedId(isExpanded ? null : err.id)}
                      leftIcon={isExpanded ? 'ChevronUp' : 'ChevronDown'}
                    >
                      {isExpanded ? 'Ocultar Stack' : 'Ver Detalle Técnico (Stack Trace)'}
                    </Button>
                    {isExpanded && (
                      <pre className="mt-2 p-3 bg-surface-alt border border-border rounded-xl text-xs font-mono text-ink-muted overflow-x-auto whitespace-pre-wrap max-h-60">
                        {err.error_stack}
                      </pre>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
