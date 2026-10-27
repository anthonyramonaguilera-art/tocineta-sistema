import React, { useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Card } from '../../ui/Card.js';
import { Badge } from '../../ui/Badge.js';
import { Icon } from '../../ui/Icon.js';
import { PayrollAdjustmentModal } from './PayrollAdjustmentModal.js';
import { StaffConsumptionModal } from './StaffConsumptionModal.js';
import { SettlementModal } from './SettlementModal.js';
import type { StaffUser, PayrollSettings } from './types.js';

interface PayrollSectionProps {
  payrollSettings?: PayrollSettings;
  staffList: StaffUser[];
  token: string | null;
  onUpdateSettings: (settings: Partial<PayrollSettings>) => Promise<any>;
  onAddAdjustment: (data: any) => Promise<any>;
  onAddConsumption: (data: any) => Promise<any>;
  onRefresh: () => void;
}

export const PayrollSection: React.FC<PayrollSectionProps> = ({
  payrollSettings,
  staffList,
  token,
  onUpdateSettings,
  onAddAdjustment,
  onAddConsumption,
  onRefresh
}) => {
  const [isAdjModalOpen, setIsAdjModalOpen] = useState(false);
  const [isConsModalOpen, setIsConsModalOpen] = useState(false);
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);

  const activeEmployees = staffList.filter((s) => s.isActive !== false);

  const isPayrollActive = payrollSettings?.payrollEnabled ?? true;
  const isDinnerActive = payrollSettings?.fixedDinnerEnabled ?? true;

  return (
    <div className="space-y-6">
      {/* Panel de Ajustes y Banderas */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-border">
          <div>
            <h3 className="font-black text-base text-ink">Módulo de Nómina y Personal</h3>
            <p className="text-xs text-ink-muted">Control de salarios, bonos, consumos y cenas asumidas por el local</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-ink">Módulo Activo:</span>
              <button
                type="button"
                onClick={() => onUpdateSettings({ payrollEnabled: !isPayrollActive })}
                className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                  isPayrollActive ? 'bg-primary' : 'bg-surface-alt border border-border'
                }`}
              >
                <div
                  className={`bg-surface w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    isPayrollActive ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Bandera Cena Fija */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-3 bg-surface-alt rounded-xl border border-border">
          <div>
            <p className="font-bold text-sm text-ink">Cena Fija del Personal Asumida por TOCINETA</p>
            <p className="text-xs text-ink-muted">
              Si está activa, el costo de la comida del turno es gasto del local y no se descuenta al trabajador
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-primary">$2.50 USD / cena</span>
            <button
              type="button"
              onClick={() => onUpdateSettings({ fixedDinnerEnabled: !isDinnerActive })}
              className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                isDinnerActive ? 'bg-primary' : 'bg-border'
              }`}
            >
              <div
                className={`bg-surface w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  isDinnerActive ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Botonera de Acciones de Nómina */}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            variant="secondary"
            onClick={() => setIsAdjModalOpen(true)}
            leftIcon={<Icon name="DollarSign" size={16} />}
          >
            Registrar Bono / Adelanto
          </Button>

          <Button
            variant="secondary"
            onClick={() => setIsConsModalOpen(true)}
            leftIcon={<Icon name="Utensils" size={16} />}
          >
            Registrar Consumo / Cena
          </Button>

          <Button
            variant="primary"
            onClick={() => setIsSettleModalOpen(true)}
            leftIcon={<Icon name="Receipt" size={16} />}
          >
            Liquidar Período y Emitir Recibo
          </Button>
        </div>
      </Card>

      {/* Lista de Empleados con sus Esquemas */}
      <Card className="p-5 space-y-4">
        <h4 className="font-black text-sm text-ink uppercase tracking-wider">Esquemas Salariales por Empleado</h4>

        <div className="space-y-3">
          {activeEmployees.map((emp) => {
            const profile = emp.payrollProfile;
            const baseUsd = ((profile?.baseSalaryUsdCents || 0) / 100).toFixed(2);
            return (
              <div
                key={emp.id}
                className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 rounded-xl border border-border bg-surface hover:bg-surface-alt transition-colors gap-2"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-ink">{emp.name}</span>
                    <Badge variant="neutral" className="text-[10px] uppercase">
                      {emp.role}
                    </Badge>
                  </div>
                  <p className="text-xs text-ink-muted">@{emp.username || 'usuario'}</p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs font-bold text-ink">${baseUsd} USD</p>
                    <p className="text-[10px] text-ink-muted uppercase">{profile?.frequency || 'SEMANAL'}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Modales */}
      <PayrollAdjustmentModal
        isOpen={isAdjModalOpen}
        onClose={() => setIsAdjModalOpen(false)}
        staffList={staffList}
        onSubmit={async (data) => {
          await onAddAdjustment(data);
          onRefresh();
        }}
      />

      <StaffConsumptionModal
        isOpen={isConsModalOpen}
        onClose={() => setIsConsModalOpen(false)}
        staffList={staffList}
        fixedDinnerCostUsdCents={payrollSettings?.fixedDinnerCostUsdCents}
        onSubmit={async (data) => {
          await onAddConsumption(data);
          onRefresh();
        }}
      />

      <SettlementModal
        isOpen={isSettleModalOpen}
        onClose={() => setIsSettleModalOpen(false)}
        staffList={staffList}
        token={token}
        onSuccess={onRefresh}
      />
    </div>
  );
};
