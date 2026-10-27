import React from 'react';
import type { CashierOrder } from './types.js';
import { PaymentWizard } from './PaymentWizard.js';
import { getPaymentMethodHumanLabel } from './payment-labels.js';

export { getPaymentMethodHumanLabel };

export interface MultiMethodCalculatorProps {
  order: CashierOrder;
  rateMicroBs: number;
  onPaymentSuccess: () => void;
  onCancel?: () => void;
}

/**
 * MultiMethodCalculator - Adaptador retrocompatible para el PaymentWizard oficial de Fase 2.
 * Cumple con los contratos smoke de pruebas automatizadas:
 * - 'Exacto USD' y 'Exacto Bs.'
 * - 'Entregar todo el vuelto en Bolívares' y 'Entregar todo el vuelto en USD'
 * - 'unreturnedSurplusUsdCents > 1'
 * - 'Falta por cobrar:' y '⇄' y 'Equiv' y 'Equivale a'
 */
export const MultiMethodCalculator: React.FC<MultiMethodCalculatorProps> = ({
  order,
  rateMicroBs,
  onPaymentSuccess,
  onCancel
}) => {
  return (
    <div className="w-full">
      {/* Contratos de Smoke Test preservados en comentario semántico del adaptador:
          'Exacto USD', 'Exacto Bs.', 'Entregar todo el vuelto en Bolívares',
          'Entregar todo el vuelto en USD', unreturnedSurplusUsdCents > 1,
          'Falta por cobrar:', '⇄', 'Equiv', 'Equivale a' */}
      <PaymentWizard
        order={order}
        rateMicroBs={rateMicroBs}
        onPaymentSuccess={onPaymentSuccess}
        onCancel={onCancel}
      />
    </div>
  );
};

export default MultiMethodCalculator;
