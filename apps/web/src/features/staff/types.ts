export interface StaffUser {
  id: string;
  name: string;
  username?: string | null;
  role: 'admin' | 'supervisor' | 'cajera' | 'mesonero' | 'cocinero' | 'despachador';
  cedula?: string | null;
  phone?: string | null;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  permissions: string[];
  isActive?: boolean;
  mustChangePin?: boolean;
  payrollProfile?: {
    frequency: 'DIARIO' | 'SEMANAL' | 'QUINCENAL';
    baseSalaryUsdCents: number;
    notes?: string | null;
  } | null;
}

export interface PayrollSettings {
  payrollEnabled: boolean;
  fixedDinnerEnabled: boolean;
  fixedDinnerCostUsdCents: number;
}

export interface PayrollAdjustment {
  id: string;
  userId: string;
  type: 'BONO' | 'ADELANTO';
  amountUsdCents: number;
  amountBsCents?: number;
  concept: string;
  createdAtMs: number;
}

export interface StaffConsumption {
  id: string;
  userId: string;
  orderId?: string | null;
  concept: string;
  amountUsdCents: number;
  isFixedDinner: number | boolean;
  status: 'PENDIENTE' | 'COBRADO' | 'PERDONADO';
  createdAtMs: number;
}

export interface TipDistribution {
  id: string;
  tipPoolId: string;
  userId: string;
  userName: string;
  hoursWorked: number;
  sharePercentage: number;
  amountUsdCents: number;
  amountBsCents: number;
  status: 'PENDIENTE' | 'PAGADO';
}

export interface TipPool {
  id: string;
  locationId: string;
  jornadaId: string;
  splitMode: 'EQUAL' | 'HOURS';
  totalCollectedUsdCents: number;
  totalCollectedBsCents: number;
  status: 'OPEN' | 'CLOSED';
  closedAtMs?: number | null;
}
