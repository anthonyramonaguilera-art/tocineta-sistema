# INFORME DE FASE R2-P2-C — Pantallas de Dinero: Caja, Cierre, Vuelto, Cobro Express, Panel y Finanzas

- **Fase:** P2-C
- **Defectos resueltos:** B07, B08, B09 (UI), B10, B12 (UI), y corrección semántica de B22
- **Estado de defectos en verde:** 9 de 30 (30.0%) — B01, B07, B08, B09, B10, B12, B13, B26, B28
- **Rama:** `r2/noche-01`
- **Tag:** `r2-p2-c`

---

## 1. Hecho

1. **Módulo de Reparto de Vuelto Mixto (`packages/shared/src/utils/change-split.ts`):**
   - Implementado cálculo matemático en enteros (`cents` y `microBs`) para reparto de vuelto en USD efectivo y Bs efectivo / Pago Móvil.
   - Funciones exportadas: `splitChangeByUsd`, `splitChangeByBs`, `validateChangeSplit` con tolerancia de redondeo de $0.01.
   - Suite de pruebas completa en `packages/shared/test/change-split.test.ts` (7 tests, 100% pasando).

2. **Paso 3 de Cobro y Vuelto (`apps/web/src/features/cashier/PaymentWizardStep3.tsx`):**
   - Extraído componente dedicado respetando el límite estricto de menos de 400 líneas (339 líneas).
   - Muestra desglose de Total Orden, Recibido por método y Vuelto a entregar en USD y Bs.
   - Caso exacto: Presenta tarjeta semántica `"Pago exacto, sin vuelto"` con ícono Lucide (`CheckCircle2`).
   - Caso con vuelto: Selector de 3 modos: `"Todo en USD"`, `"Todo en Bs"` y `"Vuelto Mixto"`.
   - Incluye `data-testid="change-amount"` y clase `.change-display` requeridos por contratos de prueba.

3. **Cobro Express y Modal Blindado (`apps/web/src/ui/Modal.tsx` & `PosComandero.tsx`):**
   - Configurado `maxWidth="express"` con tamaño de 560px (`sm:max-w-[560px]`) para escritorio táctil.
   - Bloqueo de scroll en fondo (`document.body.style.overflow = 'hidden'`) en viewport móvil y `overscroll-behavior: contain` en el contenedor para evitar desplazamientos accidentales de fondo.
   - Integración con `invalidateMoney(queryClient)` tras cada cobro express completado.

4. **Caja y Cierres (`apps/web/src/features/cashier/CashierView.tsx`):**
   - Adherido estrictamente a los contratos Zod compartidos (`CashSalesResponse`, `ZSummaryResponse`).
   - Banner de cabecera con aviso de invariante D1: `"Caja de toda la jornada, ambas sedes"` (ignora el selector de sede del menú).
   - Desglose plegable por sede oficial (`loc_los_olivos`, `loc_alta_vista`) con verificación de totales.
   - Indicador de última venta cobrada en cabecera con acceso inmediato a confirmación.
   - Tamaño de archivo: 296 líneas (límite < 400).

5. **Asistente de Cierre Z (`apps/web/src/features/cashier/CashierClosureWizard.tsx`):**
   - Lectura de `expectedCashUsdCents`, `expectedCashBsCents`, `totalOrders`, `byMethod`, `bySede` del servicio centralizado.
   - Error Boundary con botón `"Reintentar conexión"`: **cero ceros silenciosos**.
   - Cuadre con fórmula visible: `"Apertura + cobros en efectivo − vueltos − gastos en efectivo"`.
   - Comparación y cálculo de diferencia con estilo semántico (`text-success` para cuadre exacto/sobra, `text-danger` para faltante).

6. **Ventas del Día (`apps/web/src/features/cashier/CashierSalesTab.tsx`):**
   - Botón `"Recibo"` y `"Reimprimir"` con íconos tipados (`Receipt`, `Printer`).
   - Contenedor con scroll horizontal optimizado y fila de acción que no se desborda ni corta en pantallas de 360 px.
   - Invocación de `invalidateMoney(queryClient)` tras anulación de ventas o salidas de caja chica.

7. **Consistencia Global de Caché (`apps/web/src/features/finances/queryKeys.ts`):**
   - Helper `invalidateMoney(queryClient)` centralizado que invalida simultáneamente las claves de Caja, ventas, reporte Z, Dashboard de Dueña, Finanzas e Inicio.
   - Conectado en cobros, anulaciones, gastos operativos y cierre de jornada.

8. **Dashboards de Dueña, Finanzas y P&L:**
   - `FinancesDashboardView.tsx` y `useFinancesQueries.ts`: selector de sede por defecto en `'ALL'` ("Todas las sedes").
   - `ProfitAndLossTab.tsx`: corregido estilo para que margen negativo use `text-danger` y no `text-success`.
   - `OwnerDashboardView.tsx`: visualización unificada de jornada global y sustitución de "Turno por sede" por "Caja activa".

---

## 2. Puertas de Verificación (Evidencia Cruda)

| Puerta | Comando | Resultado | Evidencia Cruda |
|---|---|---|---|
| **Puerta 1** | `pnpm guard` | **VERDE** (0 violaciones de diseño) | [`gate-1-guard.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-C/gate-1-guard.txt) |
| **Puerta 2** | `pnpm -r run lint` | **VERDE** (TypeScript 100% limpio en 4 paquetes) | [`gate-2-lint.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-C/gate-2-lint.txt) |
| **Puerta 3** | `pnpm -r run build` | **VERDE** (Vite y TS build exitosos) | [`gate-3-build.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-C/gate-3-build.txt) |
| **Puerta 4** | `pnpm test` | **VERDE** (337 pruebas pasando, piso de 296 superado) | [`gate-4-test.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-C/gate-4-test.txt) |
| **Puerta 5** | `pnpm r2:e2e` | **VERDE** en B07, B08, B09, B10, B12 en ambos viewports | [`gate-5-r2-e2e.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-C/gate-5-r2-e2e.txt) |
| **Puerta 6** | `pnpm guard:visual` | **VERDE** en pantalla `#cashier` + 11 capturas | [`gate-6-guard-visual.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-C/gate-6-guard-visual.txt) |

---

## 3. Capturas de Pantalla Verificadas

Ubicadas en `docs/r2/evidencia/P2-C/`:
1. `01-caja-360px.png` y `01-caja-1280px.png` — Módulo de Caja con banner de jornada global e indicador de vuelto.
2. `02-cierre-360px.png` y `02-cierre-1280px.png` — Asistente de Cierre Z con cifras de verdad única y fórmula visible.
3. `03-ventas-dia-360px.png` y `03-ventas-dia-1280px.png` — Listado de ventas con botones Recibo/Reimprimir/Anular sin desbordes.
4. `04-finanzas-pnl-360px.png` y `04-finanzas-pnl-1280px.png` — P&L y Estado de Resultados con selector "Todas las sedes".
5. `05-cobro-express-360px.png` y `05-cobro-express-1280px.png` — Modal de cobro express de ancho fijo sin desbordamiento.
6. `06-panel-duena-1280px.png` — Panel consolidado de dueña con indicador unificado de jornada global.

---

## 4. Núcleo Sagrado

Diff contra `r2-p2-b` en los archivos protegidos:
```
git diff r2-p2-b -- packages/shared/src/utils/money.ts packages/shared/src/contracts/ticket-ir.ts apps/server/src/modules/printing/ apps/server/src/db/connection.ts apps/server/src/modules/backups/ apps/web/src/features/pos/outbox.ts
```
**0 líneas modificadas en el núcleo sagrado.**
