import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { PedagogicalGuideBanner } from '../../components/PedagogicalGuideBanner.js';
import { Button } from '../../ui/Button.js';
import { Card } from '../../ui/Card.js';
import { Badge } from '../../ui/Badge.js';
import { Icon } from '../../ui/Icon.js';
import { LoadBoundary } from '../../ui/LoadBoundary.js';
import { useStaffData } from './useStaffData.js';
import { EmployeeModal } from './EmployeeModal.js';
import { PermissionsModal } from './PermissionsModal.js';
import { PayrollSection } from './PayrollSection.js';
import { TipPoolSection } from './TipPoolSection.js';
import type { StaffUser } from './types.js';

export const StaffManagementView: React.FC = () => {
  const { token, user: activeUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'staff' | 'payroll' | 'tips'>('staff');

  const {
    staffList,
    isLoadingStaff,
    isErrorStaff,
    errorStaff,
    refetchStaff,
    payrollSettings,
    tipPool,
    createEmployeeMutation,
    updatePermissionsMutation,
    deleteEmployeeMutation,
    updatePayrollSettingsMutation,
    addAdjustmentMutation,
    addConsumptionMutation,
    addTipMutation,
    closeTipPoolMutation
  } = useStaffData();

  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [editingPermissionsUser, setEditingPermissionsUser] = useState<StaffUser | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const handleDeleteStaff = async (user: StaffUser) => {
    if (user.role === 'admin') {
      alert('No se puede eliminar la cuenta del Administrador principal');
      return;
    }
    const confirmed = window.confirm(`¿Confirmas dar de baja a ${user.name}? Se revocarán sus sesiones activas.`);
    if (!confirmed) return;

    try {
      await deleteEmployeeMutation.mutateAsync(user.id);
      showNotification(`Usuario ${user.name} dado de baja exitosamente.`);
    } catch (err: any) {
      alert(err.message || 'Error al dar de baja');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Banner de Guía Pedagógica */}
      <PedagogicalGuideBanner
        storageKey="tocineta_guide_staff"
        title="Gestión de Personal, Permisos y Nómina"
        description="Administra los perfiles de tu equipo con nombres reales, permisos granulares por rol y persona, nómina configurable y el pool de propinas del turno."
      />

      {successMessage && (
        <div className="p-3 bg-success/10 border border-success/30 rounded-xl text-xs font-bold text-success flex items-center gap-2">
          <Icon name="CheckCircle2" size={16} />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Navegación por Pestañas */}
      <div className="flex border-b border-border gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('staff')}
          className={`flex items-center gap-2 px-4 py-3 font-bold text-sm border-b-2 transition-all cursor-pointer ${
            activeTab === 'staff'
              ? 'border-primary text-primary'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          <Icon name="Users" size={18} />
          <span>Personal y Permisos</span>
          <Badge variant="neutral" className="text-xs">
            {isLoadingStaff ? '...' : staffList.length}
          </Badge>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('payroll')}
          className={`flex items-center gap-2 px-4 py-3 font-bold text-sm border-b-2 transition-all cursor-pointer ${
            activeTab === 'payroll'
              ? 'border-primary text-primary'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          <Icon name="Receipt" size={18} />
          <span>Nómina y Liquidación</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('tips')}
          className={`flex items-center gap-2 px-4 py-3 font-bold text-sm border-b-2 transition-all cursor-pointer ${
            activeTab === 'tips'
              ? 'border-primary text-primary'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          <Icon name="Coins" size={18} />
          <span>Pool de Propinas</span>
        </button>
      </div>

      {/* PESTAÑA 1: PERSONAL Y PERMISOS */}
      {activeTab === 'staff' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="text-xl font-black text-ink">Personal del Equipo TOCINETA</h2>
              <p className="text-xs text-ink-muted">
                Cuentas individuales con usuario propio, PIN único y permisos a la medida
              </p>
            </div>

            <Button
              variant="primary"
              onClick={() => setIsEmployeeModalOpen(true)}
              leftIcon={<Icon name="UserPlus" size={18} />}
            >
              Nuevo Empleado
            </Button>
          </div>

          <LoadBoundary
            isLoading={isLoadingStaff}
            isError={isErrorStaff}
            error={errorStaff}
            isEmpty={staffList.length === 0}
            loadingMessage="Cargando personal..."
            emptyMessage="No hay empleados registrados"
            emptyDescription="Presiona 'Nuevo Empleado' para agregar miembros al equipo TOCINETA."
            emptyIcon="Users"
            onRetry={() => refetchStaff()}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {staffList.map((worker) => {
                const isOnlineSelf = activeUser?.id === worker.id;
                return (
                  <Card key={worker.id} className="p-4 flex flex-col justify-between space-y-3">
                    <div className="space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-base text-ink">{worker.name}</span>
                            {isOnlineSelf && (
                              <Badge variant="success" className="text-[10px]">
                                Tú
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-ink-muted">@{worker.username || 'usuario'}</p>
                        </div>
                        <Badge variant={worker.role === 'admin' ? 'primary' : 'neutral'} className="uppercase text-xs">
                          {worker.role}
                        </Badge>
                      </div>

                      {/* Permisos Granulares */}
                      <div className="space-y-1">
                        <p className="text-[11px] font-bold text-ink-muted uppercase">Permisos Asignados:</p>
                        <div className="flex flex-wrap gap-1">
                          {worker.permissions && worker.permissions.length > 0 ? (
                            worker.permissions.slice(0, 4).map((p) => (
                              <span
                                key={p}
                                className="px-2 py-0.5 bg-surface-alt border border-border text-[10px] font-bold rounded-md text-ink"
                              >
                                {p.replace('POS_', '').replace('CASHIER_', '')}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-ink-muted italic">Sin permisos adicionales</span>
                          )}
                          {worker.permissions && worker.permissions.length > 4 && (
                            <span className="px-1.5 py-0.5 bg-surface-alt border border-border text-[10px] font-bold rounded-md text-ink-muted">
                              +{worker.permissions.length - 4} más
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Esquema Salarial */}
                      {worker.payrollProfile && (
                        <div className="pt-1 text-xs text-ink-muted">
                          <span className="font-bold text-ink">
                            ${((worker.payrollProfile.baseSalaryUsdCents || 0) / 100).toFixed(2)} USD
                          </span>{' '}
                          / {worker.payrollProfile.frequency}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 pt-2 border-t border-border">
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        onClick={() => setEditingPermissionsUser(worker)}
                        leftIcon={<Icon name="ShieldCheck" size={14} />}
                      >
                        Permisos
                      </Button>

                      {worker.role !== 'admin' && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDeleteStaff(worker)}
                          aria-label="Dar de baja"
                        >
                          <Icon name="Trash2" size={14} />
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </LoadBoundary>
        </div>
      )}

      {/* PESTAÑA 2: NÓMINA Y LIQUIDACIÓN */}
      {activeTab === 'payroll' && (
        <PayrollSection
          payrollSettings={payrollSettings}
          staffList={staffList}
          token={token}
          onUpdateSettings={async (s) => {
            await updatePayrollSettingsMutation.mutateAsync(s);
            showNotification('Ajustes de nómina actualizados');
          }}
          onAddAdjustment={async (data) => {
            await addAdjustmentMutation.mutateAsync(data);
            showNotification('Ajuste registrado exitosamente');
          }}
          onAddConsumption={async (data) => {
            await addConsumptionMutation.mutateAsync(data);
            showNotification('Consumo registrado exitosamente');
          }}
          onRefresh={() => {}}
        />
      )}

      {/* PESTAÑA 3: POOL DE PROPINAS */}
      {activeTab === 'tips' && (
        <TipPoolSection
          tipPool={tipPool}
          staffList={staffList}
          onAddTip={async (usd, bs) => {
            await addTipMutation.mutateAsync({ amountUsdCents: usd, amountBsCents: bs });
            showNotification('Propina agregada al pool exitosamente');
          }}
          onClosePool={async (mode, participants) => {
            if (!tipPool) return;
            await closeTipPoolMutation.mutateAsync({
              tipPoolId: tipPool.id,
              splitMode: mode,
              participants
            });
            showNotification('Pool de propinas cerrado y distribuido');
          }}
          onRefresh={() => {}}
        />
      )}

      {/* Modales */}
      <EmployeeModal
        isOpen={isEmployeeModalOpen}
        onClose={() => setIsEmployeeModalOpen(false)}
        onSubmit={async (data) => {
          await createEmployeeMutation.mutateAsync(data);
          showNotification(`¡Empleado ${data.name} creado exitosamente!`);
        }}
      />

      <PermissionsModal
        isOpen={Boolean(editingPermissionsUser)}
        onClose={() => setEditingPermissionsUser(null)}
        staffUser={editingPermissionsUser}
        onSave={async (userId, perms) => {
          await updatePermissionsMutation.mutateAsync({ userId, permissions: perms });
          showNotification('Permisos actualizados correctamente');
        }}
      />
    </div>
  );
};
