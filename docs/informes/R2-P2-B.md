# INFORME DE FASE R2-P2-B — Una Sola Verdad del Dinero (Servicio, Contratos y Gastos)

- **Fase:** P2-B
- **Defectos resueltos:** B09 (servidor), B12 (servidor), B22 (anti-duplicado de gastos y trazabilidad)
- **Estado de defectos:** Preparado para validación E2E en UI con P2-C.
- **Rama:** `r2/noche-01`
- **Tag:** `r2-p2-b`

---

## 1. Hecho

1. **Servicio Centralizado de Verdad Financiera (`apps/server/src/modules/finances/financial-truth-service.ts`):**
   - Implementado `getFinancialTruth(rawDb, { jornadaId?, from?, to?, locationId:'ALL'|id })` como la **única fuente de verdad** del dinero en el backend.
   - Cumple con límite estricto de menos de 400 líneas al extraer tipos a `financial-truth-types.ts` y helpers a `financial-truth-helpers.ts`.
   - Calcula:
     - `orders`: órdenes cobradas (`pagado`), órdenes pendientes por cobrar, ventas brutas de comida, descuentos, ventas netas de comida y tarifas de delivery. **Solo las órdenes cobradas suman en ventas**.
     - `collectedByMethod[]`: bruto recaudado, vueltos entregados y neto recaudado tanto en USD centavos como en Bs centavos para cada método (`EFECTIVO_USD`, `EFECTIVO_BS`, `PAGO_MOVIL`, `UBII`, `BINANCE`, etc.).
     - `expectedCash`: `apertura + cobros en efectivo − vueltos entregados en efectivo − gastos pagados en efectivo` (USD y Bs por separado). Si `jornadaId` no se pasa, resuelve automáticamente la jornada global abierta.
     - `cogsTheoretical`: suma de movimientos de inventario tipo `VENTA_RECETA` vinculados a órdenes de la jornada.
     - `waste`: cálculo deduplicado de mermas entre `waste_logs` y `worker_incidents`.
     - `operatingExpenses`: suma de gastos operativos excluyendo mermas (`MERMAS_DESPERDICIOS`), con discriminación de método de pago.
     - `netProfit`: `netSales − cogsTheoretical − waste − operatingExpenses`.
     - `bySede[]`: desglose exacto por sede oficial (`loc_los_olivos`, `loc_alta_vista`). Se cumple estrictamente que `sum(bySede) === total`.

2. **Delegación de las 6 Calculadoras Independientes:**
   - `reports/reports-service.ts` (`getJornadaReportData`): delega todas las cifras a `getFinancialTruth` e incluye las claves requeridas por el frontend (`expectedCashUsdCents`, `expectedCashBsCents`, `totalOrders`, `byMethod`, `bySede`).
   - `closures/closures-service.ts`: `performBlindCount` y `performJornadaZClosure` delegan ventas, recaudaciones, gastos y mermas a `getFinancialTruth`. Se mantuvieron **100% intactos** el encadenamiento SHA-256 de cierres Z y la retención Ubii del 0.75%.
   - `finances/owner-dashboard-service.ts` (`getOwnerDashboardNumbers`): delega ventas, cobros, margen y métricas a `getFinancialTruth`.
   - `transfers/owner-dashboard-service.ts` (`getOwnerDashboardData`): delega ventas y recaudaciones por sede a `getFinancialTruth`.
   - `finances/cashflow-service.ts` (`calculateCashFlow`): delega ingresos y egresos a `getFinancialTruth`.
   - `finances/profit-service.ts` (`calculateProfitAndLoss`): delega ventas netas, costo de ventas teórico, mermas y gastos a `getFinancialTruth`.

3. **Esquemas Compartidos Zod (`packages/shared/src/contracts/financial-contracts.ts`):**
   - Definidos y exportados: `ZSummaryResponseSchema`, `CashSalesResponseSchema`, `OwnerNumbersResponseSchema`, `ExpenseCreateRequestSchema`, `ExpenseCreateResponseSchema`.
   - Exportados a nivel de paquete en `packages/shared/src/index.ts`.
   - Los tests validan que las respuestas de las rutas cumplan estrictamente los contratos compartidos.

4. **Ventas de la Jornada Global (`GET /api/cash-sessions/current/sales`):**
   - Modificado en `apps/server/src/modules/cashier/routes.ts` para filtrar estrictamente por la jornada global abierta actual.
   - Devuelve `orderId, orderNumber, customerName, tableLabel, totalUsdCents, totalBsCents, primaryMethod, paidAtMs, locationId`.
   - Soporta paginación con `limit` y `offset`.

5. **Eliminación de Cobros Huérfanos:**
   - `openJornada` abre automáticamente la sesión de caja inicial para el usuario con el fondo de apertura (`initial_cash_usd_cents`).
   - `processOrderPayment` (`apps/server/src/modules/cashier/cashier-service.ts`) exige jornada global abierta (`JORNADA_CLOSED`) y sesión de caja activa del usuario que cobra (`CASH_SESSION_REQUIRED`).
   - Permite a mesoneros con permiso dinámico `CASHIER_PAY` registrar cobros en la caja activa.
   - Toda orden pagada recibe forzosamente `jornada_id` y `cash_session_id` no nulos.

6. **Gastos Operativos (B22, D4):**
   - En `apps/server/src/modules/finances/expenses-service.ts`:
     - Valida `paymentMethod` según enum estricto (`EFECTIVO_USD`, `EFECTIVO_BS`, `PAGO_MOVIL`, `UBII`, `PUNTO_DE_VENTA`, `TARJETA`, `BINANCE`, `OTRO`).
     - Rechaza duplicados en 120 segundos (mismo monto, categoría, descripción y usuario) con código HTTP 409 `POSSIBLE_DUPLICATE` a menos que se envíe `confirmDuplicate: true`.
     - Solo los gastos en efectivo (`EFECTIVO_USD`, `EFECTIVO_BS`) restan del efectivo esperado en gaveta; los no-efectivo no afectan el cuadre de caja.

7. **Suite de Pruebas Deterministas (`apps/server/test/r2-money-truth.test.ts`):**
   - 7 pruebas exhaustivas verificando:
     - Ventas y efectivo idénticos en las 6 rutas tras cobrar $11.90.
     - Suma de sedes igual al total exacto.
     - Anti-duplicado de gastos operativos (409 y bypass con `confirmDuplicate`).
     - Gasto en Pago Móvil no altera el efectivo esperado en gaveta.
     - Cobro sin sesión de caja rechaza con `CASH_SESSION_REQUIRED`.
     - Órdenes no pagadas no inflan ventas brutas ni netas.
     - Todos los esquemas Zod validan con éxito las respuestas.

---

## 2. Tabla Comparativa: Antes vs Después de las 6 Calculadoras

| Calculadora / Endpoint | Antes (Inconsistente) | Después (Verdad Financiera Única) |
|---|---|---|
| **1. Reportes (`getJornadaReportData`)** | Sumaba pagos brutos en efectivo sin restar vueltos ni gastos en gaveta. Faltaban `expectedCashUsdCents`, `bySede`, `totalOrders`. | Delega en `getFinancialTruth`. Entrega `expectedCashUsdCents`, `expectedCashBsCents`, `totalOrders`, `byMethod`, `bySede`. Coincide 100% con Cierre y Dashboards. |
| **2. Cierres (`closures-service.ts`)** | `performBlindCount` calculaba esperado sin considerar gastos en efectivo. Cierre Z hacía queries ad-hoc a `orders`. | Delega en `getFinancialTruth`. El arqueo ciego resta gastos en efectivo y vueltos. Cierre Z mantiene intacto hash SHA-256 y retención Ubii 0.75%. |
| **3. Owner Dashboard (`owner-dashboard-service.ts`)** | Agrupaba por timestamps y sumaba ventas brutas incluyendo órdenes no pagadas. | Delega en `getFinancialTruth`. Cifras de ventas, cobros y márgenes alineadas al centavo. |
| **4. Transfers Dashboard (`owner-dashboard-service.ts`)** | Consultaba tablas con nombres de sede legacy (`sede_alta_vista`) y filtros dispares. | Delega en `getFinancialTruth`. Ventas y efectivo por sede cuadran exactamente con el total. |
| **5. Flujo de Caja (`cashflow-service.ts`)** | Calculaba ingresos sumando cobros de órdenes sin distinguir vueltos entregados. | Delega en `getFinancialTruth`. Ingresos netos reflejan el dinero real cobrado. |
| **6. P&L / Pérdidas y Ganancias (`profit-service.ts`)** | Sumaba gastos operativos y mermas dos veces si se registraban en `waste_logs` y `operating_expenses`. | Delega en `getFinancialTruth`. Mermas deduplicadas y excluidas de gastos operativos. |

---

## 3. Regla Exacta de Deduplicación de Mermas y Pérdidas

1. **Mermas registradas en `waste_logs`:** representan el valor económico del desperdicio de insumos o productos terminados.
2. **Pérdidas registradas en `worker_incidents` (tipo `MERMA_ALIMENTO`):**
   - Si un incidente tiene tipo `MERMA_ALIMENTO`, coincide en monto (`cost_usd_cents === estimated_loss_usd_cents`) y ocurrió dentro de una ventana de **60 segundos** (`|waste_logs.created_at_ms - worker_incidents.created_at_ms| <= 60000`), se considera el **mismo hecho económico** y se excluye de `workerIncidentsUsd`.
   - Incidentes de otro tipo (ej. rotura de vajilla, extravío) se suman como pérdida operativa adicional.
3. **Gastos operativos (`operating_expenses`):**
   - Los gastos con categoría `MERMAS_DESPERDICIOS` se excluyen de la suma de `operatingExpenses` para evitar que una merma contabilizada en inventario impacte doblemente en el P&L y en el cuadre de caja.

---

## 4. NO hecho / NO verificado

- La integración visual de estos nuevos contratos en los componentes de frontend (`CashierView.tsx`, `CashierClosureWizard.tsx`, `CashierChangeModal.tsx`, `FinancesDashboardView.tsx`) corresponde a la fase **P2-C**.

---

## 5. Evidencia (Salidas y Puertas de Calidad)

- **Puerta 1 (UI-GUARD):**
  - Comando: `pnpm guard`
  - Archivo de evidencia: [`docs/r2/evidencia/P2-B/gate-1-guard.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-B/gate-1-guard.txt)
  - Salida: `✓ UI-GUARD: Todas las reglas semánticas y de gobernanza pasaron con éxito.`
- **Puerta 2 (TypeScript / Lint):**
  - Comando: `pnpm -r run lint`
  - Archivo de evidencia: [`docs/r2/evidencia/P2-B/gate-2-lint.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-B/gate-2-lint.txt)
  - Salida: `packages/shared: Done`, `apps/server: Done`, `apps/web: Done`. Cero errores de tipos.
- **Puerta 3 (Compilación Producción):**
  - Comando: `pnpm -r run build`
  - Archivo de evidencia: [`docs/r2/evidencia/P2-B/gate-3-build.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-B/gate-3-build.txt)
  - Salida: `apps/web: ✓ built in 14.89s`, compilación limpia en todos los paquetes.
- **Puerta 4 (Suite de Pruebas Unitarias):**
  - Comando: `pnpm test`
  - Archivo de evidencia: [`docs/r2/evidencia/P2-B/gate-4-test.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-B/gate-4-test.txt)
  - Salida: `Test Files: 35 passed (35)`, `Tests: 308 passed (308)`.
  - Piso baseline: 296 pruebas; P2-A: 301 pruebas; P2-B: **308 pruebas**. Cero pruebas fallidas, cero pruebas omitidas.
- **Puerta 5 (Harness Playwright R2):**
  - Comando: `pnpm r2:e2e`
  - Archivo de evidencia: [`docs/r2/evidencia/P2-B/gate-5-r2-e2e.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-B/gate-5-r2-e2e.txt)
  - Salida: 34 specs pasadas.
- **Núcleo Sagrado intacto:**
  - `git diff --stat r2-p2-a..HEAD -- packages/shared/src/utils/money.ts apps/server/src/modules/printing/ apps/server/src/db/connection.ts apps/server/src/modules/closures/closure-chain.ts apps/server/src/modules/backups/ apps/web/src/features/pos/outbox.ts`: VACÍO (0 líneas modificadas en archivos sagrados).

---

## 6. Desviaciones del prompt

- Ninguna. Se ejecutó la fase P2-B estrictamente según `docs/r2/P2-B.md`.

---

## 7. Riesgos

- Ninguno identificado en backend. Los endpoints y adaptadores conservan compatibilidad regresiva completa con las llamadas existentes mientras proveen las nuevas claves estructuradas a P2-C.
