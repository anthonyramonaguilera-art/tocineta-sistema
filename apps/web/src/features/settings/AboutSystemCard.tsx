import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Badge, Icon } from '../../ui/index.js';
import { apiJson } from '../../api/client.js';

interface UpdaterVersionResponse {
  success?: boolean;
  version?: string;
  isSalesHours?: boolean;
  maintenanceWindowActive?: boolean;
  message?: string;
  updatedAt?: string | number;
  lastUpdated?: string | number;
}

interface UpdaterStatusResponse {
  success?: boolean;
  hasPendingUpdate?: boolean;
  status?: string;
  pendingVersion?: string;
  lastChecked?: string | number;
}

export const AboutSystemCard: React.FC = () => {
  const { data } = useQuery({
    queryKey: ['system-updater-info'],
    queryFn: async () => {
      const versionRes = await apiJson<UpdaterVersionResponse>('/api/updater/version').catch(() => null);
      const statusRes = await apiJson<UpdaterStatusResponse>('/api/updater/status').catch(() => null);

      return {
        version: versionRes?.version || '1.0.0',
        lastUpdated: versionRes?.updatedAt || versionRes?.lastUpdated || null,
        hasPendingUpdate: Boolean(statusRes?.hasPendingUpdate || statusRes?.status === 'pending')
      };
    },
    staleTime: 60000
  });

  const version = data?.version || '1.0.0';
  const hasPendingUpdate = Boolean(data?.hasPendingUpdate);
  const statusLabel = hasPendingUpdate ? 'Actualización pendiente' : 'Al día';
  const formattedDate = data?.lastUpdated
    ? new Date(data.lastUpdated).toLocaleDateString('es-VE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    : new Date().toLocaleDateString('es-VE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });

  return (
    <Card variant="surface" className="p-5 border border-border space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Icon name="Info" size={20} className="text-primary" />
          <h3 className="font-extrabold text-sm text-ink uppercase tracking-wide">
            Acerca del sistema
          </h3>
        </div>
        <Badge variant={hasPendingUpdate ? 'warning' : 'success'}>
          {statusLabel}
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div className="p-3 bg-surface-alt rounded-xl border border-border space-y-1">
          <span className="text-[11px] font-bold text-ink-muted uppercase block">
            Versión instalada
          </span>
          <span className="text-base font-black font-mono text-ink">
            v{version}
          </span>
        </div>

        <div className="p-3 bg-surface-alt rounded-xl border border-border space-y-1">
          <span className="text-[11px] font-bold text-ink-muted uppercase block">
            Última actualización
          </span>
          <span className="text-sm font-bold text-ink">
            {formattedDate}
          </span>
        </div>

        <div className="p-3 bg-surface-alt rounded-xl border border-border space-y-1">
          <span className="text-[11px] font-bold text-ink-muted uppercase block">
            Estado
          </span>
          <div className="flex items-center gap-1.5 pt-0.5">
            <Icon
              name={hasPendingUpdate ? 'Clock' : 'CheckCircle2'}
              size={16}
              className={hasPendingUpdate ? 'text-warning' : 'text-success'}
            />
            <span className="text-xs font-bold text-ink">
              {statusLabel}
            </span>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-ink-muted">
        El sistema de actualización y respaldo resguarda la integridad de las bases de datos y la continuidad operativa.
      </p>
    </Card>
  );
};
