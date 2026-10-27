import React, { useState } from 'react';
import { Card, Button, Badge, Money, Icon } from '../../ui/index.js';
import { usePartnersList, usePartnerDetail, useTogglePartnersModule } from './usePartnersData.js';
import { PartnerModal } from './PartnerModal.js';
import { PartnerTransactionModal } from './PartnerTransactionModal.js';
import { ProfitDistributionModal } from './ProfitDistributionModal.js';
import type { BusinessPartner } from './types.js';

export const PartnersManagementView: React.FC = () => {
  const { data, isLoading, refetch } = usePartnersList();
  const toggleMutation = useTogglePartnersModule();

  const isEnabled = data?.enabled ?? false;
  const partners = data?.partners ?? [];
  const summary = data?.summary;

  const [isPartnerModalOpen, setIsPartnerModalOpen] = useState(false);
  const [selectedPartnerForTx, setSelectedPartnerForTx] = useState<BusinessPartner | null>(null);
  const [isDistributeOpen, setIsDistributeOpen] = useState(false);
  const [viewHistoryPartnerId, setViewHistoryPartnerId] = useState<string | null>(null);

  const { data: detailData } = usePartnerDetail(viewHistoryPartnerId);
  const detailedPartner = detailData?.partner;

  const handleToggleModule = async () => {
    try {
      await toggleMutation.mutateAsync(!isEnabled);
    } catch {
      alert('Error al cambiar el estado del módulo de socios');
    }
  };

  return (
    <div className="space-y-5 max-w-6xl mx-auto select-none pb-10">
      {/* Encabezado y Switch de Activación de Módulo */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface p-5 rounded-2xl border border-border shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-ink tracking-tight">
              Gestión de Socios y Capital
            </h1>
            <Badge variant={isEnabled ? 'success' : 'neutral'}>
              {isEnabled ? 'MÓDULO ACTIVO' : 'MÓDULO DESACTIVADO'}
            </Badge>
          </div>
          <p className="text-xs text-ink-muted mt-1">
            Registro de aportes de capital, retiros a cuenta de utilidades y reparto por porcentaje oficial.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={isEnabled ? 'secondary' : 'primary'}
            size="md"
            onClick={handleToggleModule}
            disabled={toggleMutation.isPending}
            className="min-h-[48px] px-4 font-bold"
            leftIcon={<Icon name={isEnabled ? 'PowerOff' : 'Power'} size={18} />}
          >
            {isEnabled ? 'Desactivar Módulo' : 'Activar Módulo de Socios'}
          </Button>

          {isEnabled && (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => setIsPartnerModalOpen(true)}
              className="min-h-[48px] px-4 font-black shadow-md"
              leftIcon={<Icon name="UserPlus" size={18} />}
            >
              Nuevo Socio
            </Button>
          )}
        </div>
      </div>

      {!isEnabled ? (
        <Card variant="surface" className="p-8 text-center border-2 border-dashed border-border rounded-3xl space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-surface-alt flex items-center justify-center mx-auto text-ink-muted">
            <Icon name="Users" size={28} />
          </div>
          <h3 className="text-base font-black text-ink">Módulo de Socios Inactivo</h3>
          <p className="text-xs text-ink-muted max-w-md mx-auto leading-relaxed">
            Este módulo es opcional para la dueña del negocio. Al activarlo, podrás gestionar las cuentas individuales de aportes, retiros y reparto automático de dividendos según el porcentaje acordado.
          </p>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleToggleModule}
            className="min-h-[48px] px-6 font-black mx-auto mt-2"
            leftIcon={<Icon name="Check" size={18} />}
          >
            Activar Módulo Ahora
          </Button>
        </Card>
      ) : (
        <>
          {/* Métricas Globales de Socios */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Card variant="surface" className="p-4 border border-border flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">Socios Activos</span>
                <span className="text-2xl font-black text-ink">{summary?.totalPartners ?? 0}</span>
                <span className="text-[10px] text-ink-muted block mt-0.5">{summary?.totalShares ?? 0}% asignado</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <Icon name="Users" size={20} />
              </div>
            </Card>

            <Card variant="surface" className="p-4 border border-border flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">Capital Aportado</span>
                <span className="text-2xl font-black text-success">
                  <Money cents={summary?.totalCapitalUsdCents ?? 0} />
                </span>
                <span className="text-[10px] text-ink-muted block mt-0.5">Histórico acumulado</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center text-success">
                <Icon name="ArrowDownLeft" size={20} />
              </div>
            </Card>

            <Card variant="surface" className="p-4 border border-border flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">Total Retirado</span>
                <span className="text-2xl font-black text-ink">
                  <Money cents={summary?.totalWithdrawnUsdCents ?? 0} />
                </span>
                <span className="text-[10px] text-ink-muted block mt-0.5">A cuenta de utilidades</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <Icon name="ArrowUpRight" size={20} />
              </div>
            </Card>

            <Card variant="surface" className="p-4 border border-border flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">Saldo en Cuenta</span>
                <span className="text-2xl font-black text-primary">
                  <Money cents={summary?.totalBalanceUsdCents ?? 0} />
                </span>
                <span className="text-[10px] text-ink-muted block mt-0.5">Excedente acumulado</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <Icon name="Wallet" size={20} />
              </div>
            </Card>
          </div>

          {/* Barra de Acciones Globales */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-surface p-4 rounded-2xl border border-border shadow-xs">
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <Icon name="Info" size={16} className="text-primary" />
              <span>El porcentaje total debe sumar exactamente 100% para un reparto equitativo.</span>
            </div>

            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setIsDistributeOpen(true)}
              disabled={partners.length === 0}
              className="min-h-[48px] px-4 text-xs font-black text-success hover:bg-success/10 border-success/40"
              leftIcon={<Icon name="PieChart" size={18} />}
            >
              Repartir Utilidades del Mes
            </Button>
          </div>

          {/* Lista de Socios */}
          <div className="space-y-3">
            {isLoading ? (
              <div className="text-center py-12 text-xs text-ink-muted">Cargando socios...</div>
            ) : partners.length === 0 ? (
              <div className="text-center py-12 bg-surface rounded-2xl border border-dashed border-border p-6 space-y-2">
                <Icon name="UserCheck" size={36} className="mx-auto text-ink-muted opacity-50" />
                <h3 className="text-sm font-bold text-ink">No hay socios registrados</h3>
                <p className="text-xs text-ink-muted">Registra a los socios capitalistas con su cuota de participación.</p>
                <Button type="button" variant="primary" size="sm" onClick={() => setIsPartnerModalOpen(true)} className="min-h-[44px] mt-2">
                  Registrar Primer Socio
                </Button>
              </div>
            ) : (
              partners.map((p) => (
                <Card key={p.id} variant="surface" className="p-4 sm:p-5 border border-border space-y-4 hover:border-primary/50 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-extrabold text-base text-ink">{p.name}</h3>
                        <Badge variant="primary">{p.share_percentage}%</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                        {p.doc_id && <span>Cédula: <strong>{p.doc_id}</strong></span>}
                        {p.phone && <span>Tel: <strong>{p.phone}</strong></span>}
                        {p.email && <span>{p.email}</span>}
                      </div>
                    </div>

                    {/* Balances */}
                    <div className="grid grid-cols-3 gap-3 text-right bg-surface-alt/40 p-2.5 rounded-xl border border-border">
                      <div>
                        <span className="text-[10px] text-ink-muted block uppercase font-bold">Aportes</span>
                        <span className="text-xs font-black text-ink"><Money cents={p.total_capital_contributed_usd_cents} /></span>
                      </div>
                      <div>
                        <span className="text-[10px] text-ink-muted block uppercase font-bold">Retiros</span>
                        <span className="text-xs font-black text-danger"><Money cents={p.total_withdrawn_usd_cents} /></span>
                      </div>
                      <div>
                        <span className="text-[10px] text-ink-muted block uppercase font-bold">Saldo</span>
                        <span className="text-xs font-black text-success"><Money cents={p.current_balance_usd_cents} /></span>
                      </div>
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="pt-3 border-t border-border flex items-center justify-between">
                    <span className="text-xs text-ink-muted">
                      {p.notes || 'Participación activa'}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setViewHistoryPartnerId(p.id)}
                        className="min-h-[44px] text-xs font-bold"
                        leftIcon={<Icon name="History" size={15} />}
                      >
                        Historial
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => setSelectedPartnerForTx(p)}
                        className="min-h-[44px] text-xs font-black shadow-xs"
                        leftIcon={<Icon name="ArrowLeftRight" size={15} />}
                      >
                        Aporte / Retiro
                      </Button>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        </>
      )}

      {/* Modal Crear Socio */}
      <PartnerModal
        isOpen={isPartnerModalOpen}
        onClose={() => setIsPartnerModalOpen(false)}
        onSuccess={() => refetch()}
      />

      {/* Modal Aporte / Retiro */}
      <PartnerTransactionModal
        partner={selectedPartnerForTx}
        onClose={() => setSelectedPartnerForTx(null)}
        onSuccess={() => refetch()}
      />

      {/* Modal Reparto de Dividendos */}
      <ProfitDistributionModal
        isOpen={isDistributeOpen}
        partners={partners}
        onClose={() => setIsDistributeOpen(false)}
        onSuccess={() => refetch()}
      />

      {/* Drawer Historial de Movimientos */}
      {viewHistoryPartnerId && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-ink/40 backdrop-blur-xs select-none">
          <div className="w-full max-w-lg bg-surface h-full shadow-2xl border-l border-border flex flex-col animate-in slide-in-from-right duration-200">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-ink">{detailedPartner?.name}</h3>
                <span className="text-xs text-ink-muted">Historial de aportes, retiros y dividendos</span>
              </div>
              <button
                type="button"
                onClick={() => setViewHistoryPartnerId(null)}
                className="w-8 h-8 rounded-lg bg-surface-alt flex items-center justify-center text-ink-muted hover:text-ink"
              >
                <Icon name="X" size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {!detailedPartner?.transactions || detailedPartner.transactions.length === 0 ? (
                <div className="text-center py-12 text-xs text-ink-muted">No hay movimientos registrados para este socio.</div>
              ) : (
                detailedPartner.transactions.map((tx) => (
                  <div key={tx.id} className="p-3 rounded-xl bg-surface-alt/50 border border-border flex items-center justify-between text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant={tx.type === 'APORTE' ? 'success' : tx.type === 'RETIRO_UTILIDADES' ? 'danger' : 'primary'}>
                          {tx.type}
                        </Badge>
                        <span className="font-extrabold text-ink"><Money cents={tx.amount_usd_cents} /></span>
                      </div>
                      <span className="text-[11px] text-ink-muted block mt-1">
                        {tx.notes || tx.payment_method} · {new Date(tx.created_at_ms).toLocaleDateString('es-VE')}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
