# P2-B — Una sola verdad del dinero (servicio, contratos y gastos)

**Chat nuevo.** Lee `docs/r2/01-REGLAS-DEL-AGENTE.md` y `docs/r2/00-PLAN-MAESTRO.md` (§2 causas 2, 3, 4; §4 D1, D3, D4). Requiere P2-A.
**Defectos (parte servidor):** B09, B12, B22 (gastos duplicados). **Alcance:** servidor + `packages/shared`. Las pantallas van en P2-C.

## Objetivo
Que toda cifra de dinero salga de **un solo servicio**, que cada respuesta tenga un esquema compartido que el frontend no pueda malinterpretar, y que no existan cobros huérfanos ni gastos duplicados.

## Hechos verificados (confirma con grep)
- Calculadoras independientes del dinero hoy: `reports/reports-service.ts` (`getJornadaReportData`), `closures/closures-service.ts`, `finances/owner-dashboard-service.ts`, `transfers/owner-dashboard-service.ts`, `finances/cashflow-service.ts`, `finances/profit-service.ts`.
- `GET /api/reports/z-report/summary` (`reports/routes.ts:~115`) devuelve `{success, summary:{ jornada, rateMicroBs, netFoodSalesUsdCents, discountUsdCents, deliveryFeesUsdCents, totalCollectedUsdCents, cashUsdCents, cashBsCents, pagoMovilBsCents, ubiiGrossBsCents, …, expensesUsdCents, mermasUsdCents, ordersCount, … }}`. `CashierClosureWizard.tsx:~40-52` lee `expectedCashUsdCents, expectedCashBsCents, totalOrders, byMethod` → **no existen** y cae a ceros.
- "Esperado" hoy = suma bruta de pagos en efectivo: **no** suma la apertura, **no** resta vueltos (`change_deliveries`) ni gastos en efectivo.
- `GET /api/cash-sessions/current/sales` (`cashier/routes.ts:~189`) devuelve `{id, orderNumber, customerName, totalCents, paidAtMs, paymentMethod:'cash_usd', status}` de las últimas 50 pagadas de **toda** la BD (sin filtrar jornada). `CashierView.tsx:~60-70` lee otras claves.
- `waste-service.ts:~169` inserta un gasto `MERMAS_DESPERDICIOS` por cada merma (doble conteo). Las mermas de `worker_incidents.estimated_loss_usd_cents` también se suman en el reporte Z.
- `operating_expenses` ya tiene `payment_method` (default `EFECTIVO_USD`), `location_id`, `jornada_id`. Existen métodos de cobro: efectivo USD/Bs, pago móvil, punto de venta, Binance, crédito.

## Tareas
1. **`apps/server/src/modules/finances/financial-truth-service.ts`**: `getFinancialTruth(rawDb, { jornadaId?, from?, to?, locationId:'ALL'|id })` devuelve un objeto tipado con (todo en enteros):
   - `orders` (cobradas, por cobrar), `grossSales`, `discounts`, `netSales`, `deliveryFees`;
   - `collectedByMethod[]` (bruto, **vueltos entregados**, neto) en USD y Bs;
   - `expectedCash`: `apertura + cobros en efectivo − vueltos entregados en efectivo − gastos pagados en efectivo` (USD y Bs por separado);
   - `cogsTheoretical` (movimientos `VENTA_RECETA` de esas órdenes), `waste` (`waste_logs` + `worker_incidents` **sin duplicar** una pérdida que ya esté en `waste_logs`; documenta la regla), `operatingExpenses` (excluyendo mermas), `netProfit = netSales − cogs − waste − operatingExpenses`;
   - `receivables`, `payables`;
   - `bySede[]` con el mismo desglose; la suma de las sedes **debe** igualar el total.
   Usa funciones de `money.ts` solo en lectura. Si necesitas un helper nuevo, va en un archivo nuevo.
2. **Delegar las seis calculadoras** al servicio: `getJornadaReportData`, las cifras de `closures-service.ts`, los dos `owner-dashboard-service.ts`, `cashflow-service.ts` y `profit-service.ts` pasan a ser adaptadores delgados que **conservan la forma de su respuesta actual** (para no romper pruebas ni pantallas) y obtienen los números de `getFinancialTruth`. **No cambies** el encadenamiento SHA-256, la retención Ubii ni el cálculo de hashes del cierre: solo de dónde salen las cifras. Cualquier diferencia numérica con las pruebas existentes se justifica en el informe (no se "ajustan" aserciones).
3. **Esquemas compartidos** en `packages/shared/src/contracts/` (Zod + tipos exportados): `ZSummaryResponse`, `CashSalesResponse`, `OwnerNumbersResponse`, `ExpenseCreateRequest/Response`. El servidor valida su salida contra estos esquemas en pruebas; el frontend los importa (P2-C). Añade a `ZSummaryResponse` las claves que la pantalla necesita: `expectedCashUsdCents`, `expectedCashBsCents`, `totalOrders`, `byMethod[]`, `bySede[]`.
4. **Ventas de la jornada:** `GET /api/cash-sessions/current/sales` → solo la jornada global abierta; por cada pago incluye `orderId, orderNumber, customerName, tableLabel, totalUsdCents, totalBsCents, primaryMethod` (real), `paidAtMs`, `locationId`. Sin límite silencioso de 50 (paginar con `limit/cursor`).
5. **Sin cobros huérfanos:** `POST /api/orders/:id/pay` y el Cobro Express exigen jornada global abierta (`JORNADA_CLOSED`) y sesión de caja abierta del usuario que cobra (`CASH_SESSION_REQUIRED`, con mensaje que explique qué hacer). Orden pagada ⇒ `jornada_id` y `cash_session_id` siempre no nulos. Prueba de que no se puede crear una orden pagada sin ambos.
6. **Gastos (D4):** `POST` de gastos (módulo `finances/expenses-service.ts`) requiere `paymentMethod` (enum: `EFECTIVO_USD, EFECTIVO_BS, PAGO_MOVIL, PUNTO_DE_VENTA, TARJETA, BINANCE, OTRO`) y `clientRequestId`. Anti-duplicado: mismo monto + categoría + descripción + usuario en 120 s → 409 `POSSIBLE_DUPLICATE` salvo `confirmDuplicate:true`. Los gastos en efectivo reducen `expectedCash`; los demás reducen el flujo de caja bancario, no la gaveta.
7. **Pruebas** `apps/server/test/r2-money-truth.test.ts` con el escenario determinista: tras cobrar $11.90 en efectivo USD, **las seis rutas** (Caja, Cierre, Inicio, Panel ×2, Finanzas) devuelven el mismo total de ventas y el mismo efectivo esperado; suma por sede = total; gasto duplicado rechazado; gasto por pago móvil no cambia el efectivo esperado; cobro sin sesión rechazado.

## Prohibido
- Cambiar `money.ts`, impresión, cadena de hashes, outbox.
- Mantener un cálculo propio en cualquier adaptador "porque es más rápido".
- Aflojar tolerancias o aserciones para que cuadren números.

## Criterios de aceptación
- B09 (servidor), B12 (servidor) y el anti-duplicado de B22 en verde.
- Los esquemas Zod validan todas las respuestas en pruebas; una clave distinta rompe la prueba.
- 238+ pruebas verdes (las que cambien de valor se documentan con justificación).

## Entrega
Según §6. Incluye una tabla "antes/después" de qué calculadora devolvía qué cifra para el escenario y la regla exacta elegida para no duplicar pérdidas.
