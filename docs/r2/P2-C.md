# P2-C — Pantallas de dinero: Caja, Cierre, Vuelto, Cobro Express, Panel y Finanzas

**Chat nuevo.** Lee `docs/r2/01-REGLAS-DEL-AGENTE.md` y `docs/r2/00-PLAN-MAESTRO.md` (§2 causas 2-4; §4 D1, D4). Requiere P2-B (contratos Zod) y P1-B.
**Defectos:** B07, B08, B09 (UI), B10, B12 (UI). **Alcance:** solo `apps/web`.

## Objetivo
Que cobrar un pedido muestre **la misma cifra** en Caja, Cierre, Inicio, Panel y Finanzas sin recargar, y que el vuelto sea claro y soporte vuelto mixto.

## Hechos verificados (confirma con grep)
- `features/cashier/CashierView.tsx:~60-70` mapea `s.order_number`, `s.customer_name`, `s.total_usd_cents…` (claves inexistentes) → lista con "#", "Mostrador", $0.00 (fotos). Título de pestaña "Ventas del día (6)" sale de `sales.length`.
- `features/cashier/CashierClosureWizard.tsx:~36-62` lee `summary.expectedCashUsdCents/totalOrders/byMethod`; si el fetch falla devuelve `null` y usa ceros **sin avisar**.
- Paso 3 "Vuelto y Cierre" está en `features/cashier/PaymentWizard.tsx:~205` (362 líneas, cerca del límite). La pantalla muestra "$0.00 / 0.00 Bs" sin decir cuánto entregar; no hay vuelto mixto.
- "Cobro Express" vive en `features/pos/PosComandero.tsx`: en PC es una ventana pequeña distinta a las demás; en móvil, al hacer scroll hasta el fondo se mueve el contenido de atrás. Existe `ui/Modal.tsx`.
- `grep -rn "invalidateQueries" features/cashier features/pos` = **0**: tras cobrar no se invalida nada entre pantallas (por eso unas muestran el dato y otras no).
- Pantallas que consumen dinero: `features/home/HomeView.tsx`, `features/owner/OwnerDashboardView.tsx`, `features/finances/FinancesDashboardView.tsx` + `useFinancesQueries.ts`. En las fotos, el selector de sede del menú dice "Los Olivos" mientras Finanzas dice "Alta Vista", y Caja/P&L muestran $0.00 con "Los Olivos" activo.
- Margen neto negativo se pinta en verde ("-538.82%").

## Tareas
1. **Caja:** usa los tipos de `packages/shared/contracts` (sin adivinar claves). Cada fila: `#número`, cliente, mesa (`formatTableLabel`), método real, monto USD y Bs, hora. Encabezado "Cobrado en la jornada: $X · N órdenes" más totales por método. **Ignora el selector de sede** y lo dice en una línea ("Caja de toda la jornada, ambas sedes"); desglose por sede plegable.
2. **Cierre (asistente):** lee `expectedCash*`, `byMethod`, `bySede` del servicio único. Si la petición falla: pantalla de error con "Reintentar" — **nunca ceros silenciosos**. La diferencia (contado − esperado) con signo y color semántico (sobra/falta/cuadra). Muestra la fórmula: "Apertura + cobros en efectivo − vueltos − gastos en efectivo".
3. **Paso 3 de cobro (Vuelto):** *(si `PaymentWizard.tsx` pasaría de 400 líneas, extrae `PaymentWizardStep3.tsx`)*
   - Muestra **Total**, **Recibido** (por método) y **Vuelto a entregar** en USD y en Bs.
   - Si vuelto = 0: "Pago exacto, sin vuelto" con ícono `IconName` (no emoji).
   - Si vuelto > 0: control de **vuelto mixto**: el usuario reparte cuánto devuelve en USD y cuánto en Bs; el resto se recalcula; solo se puede continuar si la suma equivale al vuelto con tolerancia $0.01. Persiste en `change_deliveries` por el contrato existente.
   - La lógica de reparto vive en un archivo **nuevo** `packages/shared/src/utils/change-split.ts` con pruebas (enteros, micro-Bs). **No edites `money.ts`**.
4. **Cobro Express:** en escritorio, diálogo centrado de ancho fijo (~560 px) con el mismo estilo que los demás `Modal`; en móvil, hoja inferior con `overscroll-behavior: contain` y bloqueo del scroll del fondo mientras está abierta. Un solo componente para ambos.
5. **Ventas del día:** acciones Anular/Reimprimir/Recibo con íconos tipados, pestañas que no se cortan a 360 px (scroll horizontal con indicador o texto corto), y confirmación de anulación que muestre el monto real.
6. **Consistencia entre pantallas:** helper `invalidateMoney(queryClient)` que invalida (o `refetch`) las claves de Caja, ventas, resumen Z, Inicio, Panel y Finanzas; se llama tras cobrar, anular, gastar y cerrar. También `refetchOnWindowFocus`. Una sola fuente de claves de consulta en `features/finances/queryKeys.ts`.
7. **Panel de la Dueña / Finanzas / Inicio:** consumen el servicio único. Selector de sede con opción **"Todas las sedes"** (por defecto) además de cada sede; el mismo estado de sede en menú, Panel y Finanzas. Sin "Turno por sede": un único indicador "Jornada abierta desde HH:MM".
8. **P&L:** el margen negativo usa color de peligro, nunca verde. (La explicación detallada de la utilidad va en P6-B.)

## Prohibido
- Calcular totales en el frontend a partir de listas (se muestran los del servidor).
- Editar `money.ts`, impresión o el outbox. Dejar fallbacks a cero que oculten un error.

## Criterios de aceptación (Playwright, 360×800 y 1280×800)
- Escenario: cobrar una orden de $11.90 en efectivo con vuelto mixto ($0.50 en USD y el resto en Bs a tasa 500): Caja, Cierre, Inicio, Panel y Finanzas muestran **la misma venta y el mismo efectivo esperado** en menos de 2 s, sin recargar.
- Con "Los Olivos" seleccionado, Caja y Cierre siguen mostrando la jornada completa.
- Vuelto: caso exacto y caso mixto verificados con capturas; cobro con servidor caído muestra error, no ceros.
- B07, B08, B09, B10, B12 en verde; `guard:visual` verde. 238+ pruebas verdes; lint y build verdes.

## Entrega
Según §6. Adjunta capturas de Caja, Cierre, paso 3 (exacto y mixto), Cobro Express en ambos viewports y la comparación de cifras entre pantallas.
