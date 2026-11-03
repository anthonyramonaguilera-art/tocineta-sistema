import { fmtUsd, fmtBs, fmtBsFromUsd, fmtUsdFromBs } from './money-format.js';

export interface PaymentSectionData {
  rateMicroBs: number;
  cashUsdCents?: number;
  cashBsCents?: number;
  pagoMovilBsCents?: number;
  puntoDeVentaBsCents?: number;
  ubiiGrossBsCents?: number;
  ubiiFeeBsCents?: number;
  ubiiNetBsCents?: number;
  transferenciaBsCents?: number;
  binanceUsdCents?: number;
  zelleUsdCents?: number;
  otrosUsdCents?: number;
  changeUsdCents?: number;
  changeBsCashCents?: number;
  changeBsBankCents?: number;
  ledgerSurplusUsdCents?: number;
  methodsNetUsdEquivCents?: number;
  totalCollectedUsdCents?: number;
  driverDirectDeliveryUsdCents?: number;
  reconciliationDiffUsdCents?: number;
}

export interface PaymentSectionRow {
  label: string;
  usd: string;
  bs: string;
}

/**
 * Construye en orden las filas de la sección 2 del reporte de Jornada (Medios de pago y conciliación).
 * Garantiza que cada uno de los 9 métodos tenga siempre llenos 'usd' y 'bs'.
 */
export function buildPaymentSectionRows(data: PaymentSectionData): PaymentSectionRow[] {
  const rate = data.rateMicroBs || 40_000_000;
  const rows: PaymentSectionRow[] = [];

  // 1. Efectivo Dólares (USD)
  const cashUsd = data.cashUsdCents || 0;
  rows.push({
    label: 'Efectivo Dólares (USD)',
    usd: fmtUsd(cashUsd),
    bs: fmtBsFromUsd(cashUsd, rate)
  });

  // 2. Efectivo Bolívares (Bs)
  const cashBs = data.cashBsCents || 0;
  rows.push({
    label: 'Efectivo Bolívares (Bs)',
    usd: fmtUsdFromBs(cashBs, rate),
    bs: fmtBs(cashBs)
  });

  // 3. Pago Móvil (Banesco)
  const pagoMovil = data.pagoMovilBsCents || 0;
  rows.push({
    label: 'Pago Móvil (Banesco)',
    usd: fmtUsdFromBs(pagoMovil, rate),
    bs: fmtBs(pagoMovil)
  });

  // 4. Punto de Venta (Bs)
  const puntoVenta = data.puntoDeVentaBsCents || 0;
  rows.push({
    label: 'Punto de Venta (Bs)',
    usd: fmtUsdFromBs(puntoVenta, rate),
    bs: fmtBs(puntoVenta)
  });

  // 5. Punto de Venta Ubii (Bruto) + Sub-filas
  const ubiiGross = data.ubiiGrossBsCents || 0;
  const ubiiFee = data.ubiiFeeBsCents || 0;
  const ubiiNet = data.ubiiNetBsCents || 0;
  rows.push({
    label: 'Punto de Venta Ubii (Bruto)',
    usd: fmtUsdFromBs(ubiiGross, rate),
    bs: fmtBs(ubiiGross)
  });
  rows.push({
    label: ' - Comisión Punto Ubii (0.75%)',
    usd: fmtUsdFromBs(ubiiFee, rate),
    bs: fmtBs(ubiiFee)
  });
  rows.push({
    label: ' - Neto Bancario Ubii Esperado',
    usd: fmtUsdFromBs(ubiiNet, rate),
    bs: fmtBs(ubiiNet)
  });

  // 6. Transferencia Bancaria (Bs)
  const trans = data.transferenciaBsCents || 0;
  rows.push({
    label: 'Transferencia Bancaria (Bs)',
    usd: fmtUsdFromBs(trans, rate),
    bs: fmtBs(trans)
  });

  // 7. Binance Pay (USDT)
  const binance = data.binanceUsdCents || 0;
  rows.push({
    label: 'Binance Pay (USDT)',
    usd: fmtUsd(binance),
    bs: fmtBsFromUsd(binance, rate)
  });

  // 8. Zelle (USD)
  const zelle = data.zelleUsdCents || 0;
  rows.push({
    label: 'Zelle (USD)',
    usd: fmtUsd(zelle),
    bs: fmtBsFromUsd(zelle, rate)
  });

  // 9. Otros Métodos (USD)
  const otros = data.otrosUsdCents || 0;
  rows.push({
    label: 'Otros Métodos (USD)',
    usd: fmtUsd(otros),
    bs: fmtBsFromUsd(otros, rate)
  });

  // Vueltos entregados
  const chgUsd = data.changeUsdCents || 0;
  rows.push({
    label: '(-) Vuelto efectivo USD',
    usd: fmtUsd(chgUsd),
    bs: fmtBsFromUsd(chgUsd, rate)
  });

  const chgBsCash = data.changeBsCashCents || 0;
  rows.push({
    label: '(-) Vuelto efectivo Bs',
    usd: fmtUsdFromBs(chgBsCash, rate),
    bs: fmtBs(chgBsCash)
  });

  const chgBsBank = data.changeBsBankCents || 0;
  rows.push({
    label: '(-) Vuelto por Pago Movil',
    usd: fmtUsdFromBs(chgBsBank, rate),
    bs: fmtBs(chgBsBank)
  });

  // Excedente aceptado (propina / ajuste)
  const surplus = data.ledgerSurplusUsdCents || 0;
  rows.push({
    label: '(+) Excedente aceptado (propina/ajuste)',
    usd: fmtUsd(surplus),
    bs: fmtBsFromUsd(surplus, rate)
  });

  // Total neto cobrado por métodos
  const netMethods = data.methodsNetUsdEquivCents || 0;
  rows.push({
    label: '= Total neto cobrado por metodos',
    usd: fmtUsd(netMethods),
    bs: fmtBsFromUsd(netMethods, rate)
  });

  // Ventas cobradas en caja
  const driverDelivery = data.driverDirectDeliveryUsdCents || 0;
  const totalCollected = data.totalCollectedUsdCents || 0;
  const expectedInBox = totalCollected - driverDelivery;
  rows.push({
    label: 'Ventas cobradas en caja (incl. delivery cobrado en caja)',
    usd: fmtUsd(expectedInBox),
    bs: fmtBsFromUsd(expectedInBox, rate)
  });

  // Delivery cobrado directo por motorizados (si aplica)
  if (driverDelivery > 0) {
    rows.push({
      label: 'Delivery cobrado directo por motorizados',
      usd: fmtUsd(driverDelivery),
      bs: fmtBsFromUsd(driverDelivery, rate)
    });
  }

  // Diferencia de conciliación
  const diff = data.reconciliationDiffUsdCents || 0;
  rows.push({
    label: 'Diferencia de conciliacion',
    usd: fmtUsd(diff),
    bs: fmtBsFromUsd(diff, rate)
  });

  return rows;
}
