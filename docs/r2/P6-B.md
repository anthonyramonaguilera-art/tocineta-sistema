# P6-B — Finanzas explicada, gastos con método de pago, Socios/Nómina y alertas de stock

**Chat nuevo.** Lee `docs/r2/01-REGLAS-DEL-AGENTE.md`, `docs/r2/00-PLAN-MAESTRO.md` (§4 D3, D4) y `docs/r2/LIBRO-DE-REGLAS.md`. Requiere P2-C, P5-B y P4-B.
**Defectos:** B22 (color del P&L y claridad), B27. **Alcance:** `apps/web`.

## Objetivo
Que la dueña entienda **de dónde sale cada número** de Finanzas, registre gastos con su método de pago sin duplicarlos, vea Socios y Nómina limpios cuando no hay datos, y no pase por alto un stock negativo.

## Hechos verificados (confirma con grep)
- `features/finances/`: `FinancesDashboardView.tsx`, `ProfitAndLossTab.tsx`, `CashFlowTab.tsx`, `ExpensesTab.tsx`, `ExpenseModal.tsx`, `MonthlyClosureTab.tsx`, `PayablesTab.tsx`, `ReceivablesTab.tsx`, `OwnerNumbersConfigModal.tsx`, `useFinancesQueries.ts`.
- Foto del P&L: "Estado de resultados −$402.50, Margen neto −538.82% (en verde)", con tarjetas "1. Ventas netas $74.70 · 2. Costo de ventas −$17.20 (23.03%) · 3. Mermas −$0.00 · 4. Gastos de caja −$460.00" y una nota sobre "doble conteo". Mientras tanto "Utilidad estimada hoy $2.50" (otra cifra) en Inicio.
- Fórmula acordada (D3): `Utilidad = Ventas netas − Costo de recetas − Mermas − Gastos operativos`.
- `features/partners/PartnersManagementView.tsx` y `features/staff/PayrollSection.tsx`: se mostraban datos de prueba ("Socio Director"); no hay estado vacío propio. `ui/EmptyState.tsx` existe.
- Panel: "Alertas de stock bajo crítico (12)" muestra "Salchicha Especial de Pollo −4 und" como un número rojo más (stock **negativo**), sin explicación. "Gas Operativo Bombona 43kg 1 und" aparece como insumo.
- `ExpenseModal.tsx`: tras P2-B el servidor exige `paymentMethod` y `clientRequestId` y responde `POSSIBLE_DUPLICATE`.

## Tareas
1. **Utilidad explicada:** en `ProfitAndLossTab` una tarjeta **"¿De dónde sale tu utilidad?"** con la cuenta vertical (`+ Ventas netas`, `− Costo de recetas`, `− Mermas`, `− Gastos operativos`, `= Utilidad`), cada línea tocable con `HelpHint` (de P4-C) y su monto en USD (y Bs a la tasa del día). Los montos vienen de `getFinancialTruth` (nunca recalculados en el cliente). Periodo y sede visibles; selector con "Todas las sedes" por defecto. **Margen negativo en color de peligro**, positivo en éxito.
2. **Una sola utilidad:** Inicio, Panel y Finanzas muestran **la misma** cifra para el mismo periodo y sede; si se muestra "hoy" frente a "30 días", la etiqueta lo dice con claridad. Prueba E2E que compare las tres.
3. **Registrar gasto:** `ExpenseModal` con **método de pago** (efectivo USD, efectivo Bs, pago móvil, punto de venta, tarjeta, otro), categoría, monto, nota y foto opcional del recibo. Texto de ayuda según método: "Sale de la gaveta" / "Sale de tu cuenta, no afecta la gaveta". Al recibir `POSSIBLE_DUPLICATE` muestra "Ya registraste un gasto igual hace 2 min. ¿Es otro gasto distinto?" con **Sí, registrar** / **Cancelar**. Doble clic protegido (`clientRequestId`). Tras guardar se invalidan las consultas de dinero (`invalidateMoney`).
4. **Flujo de caja:** `CashFlowTab` separa visualmente **Efectivo en gaveta (USD y Bs)** de **Dinero en cuentas** (pago móvil, punto de venta, tarjeta), con la fórmula del efectivo esperado visible.
5. **Socios y Nómina:** estados vacíos con `EmptyState` (ícono tipado, explicación, botón "Agregar socio" / "Agregar empleado"). Sin datos de ejemplo en ningún caso. Nómina vacía no muestra cifras en cero como si fueran reales.
6. **Stock negativo (B27):** en Panel, Inventario y Salud de números, un stock < 0 se muestra como **"Stock negativo: se vendió o gastó más de lo registrado"** con badge de advertencia, sede, insumo y acción sugerida ("Registra la compra o ajusta con un conteo"). El mínimo bajo y el negativo son dos alertas distintas. Los insumos operativos (gas, hielo) se identifican con su categoría.
7. **Exportaciones Excel/PDF** de Finanzas: confirmar que usan los mismos números que la pantalla (prueba que compare totales). Corrige cualquier discrepancia en el adaptador, no en la pantalla.
8. **Cierres mensuales:** `MonthlyClosureTab` explica qué congela el cierre ("ventas, costos, mermas y gastos del mes quedan guardados y ya no cambian") y muestra qué incluye antes de confirmar.

## Prohibido
- Recalcular utilidad/ventas en el cliente. Texto sin explicación en campos de dinero nuevos.
- Datos de ejemplo en Socios/Nómina. Tocar `money.ts`, impresión, cierre Z, outbox.

## Criterios de aceptación (Playwright 360×800 y 1280×800)
- Utilidad idéntica en Inicio, Panel y Finanzas para el escenario; la cuenta vertical suma exactamente.
- Gasto en efectivo baja el efectivo en gaveta; el de pago móvil no; el duplicado pide confirmación.
- Socios y Nómina vacíos muestran su `EmptyState`; stock negativo muestra su alerta con capturas.
- B22 (color/claridad) y B27 en verde; `guard:visual` verde; 238+ pruebas verdes; lint y build verdes.

## Entrega
Según §6. Adjunta capturas a 360 px de la tarjeta "¿De dónde sale tu utilidad?", el modal de gasto (incluida la advertencia de duplicado), Socios/Nómina vacíos y la alerta de stock negativo.
