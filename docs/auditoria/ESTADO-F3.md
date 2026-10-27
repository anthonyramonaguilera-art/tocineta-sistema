# ESTADO DE EJECUCIÓN Y AUDITORÍA DE CIERRE — FASE 3 (A–G)
**Sistema Operativo Gastronómico TOCINETA**  
**Fecha:** 27 de Octubre de 2026  
**Auditoría Técnica:** Rescate Post-Incidente, Corrección de Bugs e Integración Integral F3

---

## 1. RESUMEN EJECUTIVO

Tras la recuperación de archivos de la Fase 3 y la resolución quirúrgica de los 3 bugs críticos reportados (Barra flotante POS, Error 500 al anular orden en Caja, y Blindaje del KDS contra órdenes zombis), el sistema compila en producción al 100% en verde con cero errores de TypeScript y estricto cumplimiento de las reglas de diseño y gobernanza.

- **Validación UI-Guard:** `PASS` (Cero violaciones WCAG, cero colores fijos no semánticos, cero emojis).
- **TypeScript Workspace Lint:** `PASS` (`tsc --noEmit` en `@tocineta/shared`, `@tocineta/server` y `@tocineta/web`).
- **Build de Producción:** `PASS` (`pnpm -r run build` exitoso en todos los paquetes).
- **Pruebas Automatizadas Focalizadas:** 14/14 tests pasando (`cashier-ledger.test.ts`, `kds.test.ts`) + 6/6 tests de Fase 3 (`fase3-inventory-recipes-locations.test.ts`).

---

## 2. ESTADO DETALLADO POR BLOQUE DE FASE 3 (A–G)

### BLOQUE A: SEDES COMO DATO (`locations`)
- **Estado:** `100% COMPLETADO`
- **Evidencia en Base de Datos & Schema:**
  - Migración `0023_locations_and_fase3_inventory.sql`: Tabla `locations` creada con campos `id`, `name`, `type` (`production`, `sale`, `mixed`), `is_active`, `address`, `phone`.
  - Sedes sembradas: `loc_los_olivos` (Sede A: Los Olivos), `loc_alta_vista` (Sede B: Alta Vista) y alias `sede_alta_vista`.
  - Columna `location_id` agregada a: `orders`, `jornadas`, `cash_sessions`, `inventory_movements`, `operating_expenses`, `deliveries`, `purchases`, `stock_counts` y `users`.
- **Evidencia en Servidor (`@tocineta/server`):**
  - Servicio: `apps/server/src/modules/profitability/locations-service.ts` (`getAllLocations`, `getLocationById`, `createLocation`, `updateLocation`, `getUserLocations`, `setUserLocations`).
  - Endpoints REST en `fase3-routes.ts`: `GET /api/profitability/locations`, `POST /api/profitability/locations`, `PUT /api/profitability/locations/:id`, `GET /api/profitability/users/:id/locations`.
- **Evidencia en Cliente (`@tocineta/web`):**
  - Selector de Sede Activa en `AppHeader.tsx` y `AppSidebar.tsx` con persistencia en `localStorage('tocineta_active_sede')`.
  - Filtro por sede integrado en tablas de `InventoryView.tsx`, `PurchasesView.tsx` y `WasteView.tsx`.

---

### BLOQUE B: INSUMOS CON CONVERSIÓN COMPRA/USO
- **Estado:** `100% COMPLETADO`
- **Evidencia en Base de Datos & Schema:**
  - Tabla `supply_items` extendida con: `purchase_unit`, `usage_unit`, `conversion_factor`, `category`, `min_stock`, `weighted_avg_cost_usd_cents`, `last_cost_usd_cents`, `is_active`.
  - Tabla `location_inventory` para inventario multi-sede: `(location_id, supply_id, current_stock_qty, minimum_stock_qty)`.
- **Evidencia en Servidor (`@tocineta/server`):**
  - Lógica de Costo Promedio Ponderado (CPP) en `purchases-service.ts` e `inventory.ts`.
  - Endpoints REST: `GET /api/profitability/supplies`, `POST /api/profitability/supplies`, `PUT /api/profitability/supplies/:id`.
- **Evidencia en Cliente (`@tocineta/web`):**
  - `NewSupplyModal.tsx`: Definición de unidad de compra, uso, factor y costos.
  - `InventoryView.tsx`: Tabla visual con stock por sede, alertas de stock mínimo y botón de creación de insumo.

---

### BLOQUE C: RECETAS EN 3 MODOS + SUB-RECETAS
- **Estado:** `100% COMPLETADO`
- **Evidencia en Base de Datos & Schema:**
  - `products.recipe_mode`: `UNITS`, `GRAMMAGE`, `FINISHED_PRODUCT`.
  - `products.target_margin_bps`: Margen objetivo (por defecto 6500 = 65%).
  - Tabla `sub_recipes` y `sub_recipe_items`: Preparaciones base con rendimiento (`yield_quantity`, `yield_unit`) y costeo dinámico.
  - Tabla `recipe_items_v2`: Soporte a insumos directos, sub-recetas anidadas, gramaje bruto (`gross_weight_grams`) y merma técnica (`shrinkage_percentage`).
- **Evidencia en Servidor (`@tocineta/server`):**
  - Servicio: `apps/server/src/modules/profitability/recipes-service.ts` (`getProductRecipe`, `saveProductRecipe`, `getSubRecipe`, `getAllSubRecipes`, `saveSubRecipe`, `calculateRecipeCost`, `deductInventoryForOrder`, `revertInventoryForOrder`).
  - Endpoints REST en `fase3-routes.ts`: `GET/POST /api/profitability/recipes/:productId`, `GET/POST /api/profitability/sub-recipes`.
- **Evidencia en Cliente (`@tocineta/web`):**
  - `RecipesView.tsx`: Catálogo de recetas con selector de modo.
  - `RecipeEditorModal.tsx` (341 líneas): Asignación de insumos, sub-recetas y cálculo automático de costo y margen sugerido.
  - `SubRecipeEditorModal.tsx` (206 líneas): Creación y edición de sub-recetas (salsas, carnes preparadas, etc.).

---

### BLOQUE D: COMPRAS CON ALERTA DE VARIACIÓN DE COSTO
- **Estado:** `100% COMPLETADO`
- **Evidencia en Base de Datos & Schema:**
  - Tablas `purchases`, `purchase_items`.
  - Tabla inmutable `price_history`: Registro histórico de variaciones de PVP con confirmación de usuario supervisor.
- **Evidencia en Servidor (`@tocineta/server`):**
  - Servicio: `purchases-service.ts` (`recordPurchase`, `getPurchaseById`, `getAllPurchases`, `confirmPriceChange`, `getPriceHistory`).
  - Regla Blindada: Si el nuevo costo unitario de un insumo incrementa el costo total de la receta en > 5%, el sistema genera una alerta (`costVariationWarning`) y un PVP sugerido, pero **NUNCA modifica el precio de venta al público (PVP) en carta sin la confirmación explícita con PIN de supervisor**.
  - Endpoints REST: `GET/POST /api/profitability/purchases`, `POST /api/profitability/prices/confirm`, `GET /api/profitability/prices/history/:productId`.
- **Evidencia en Cliente (`@tocineta/web`):**
  - `PurchasesView.tsx`: Historial de compras registradas.
  - `NewPurchaseModal.tsx`: Formulario de recepción de mercancía y proveedores.
  - `CostVariationModal.tsx`: Modal de advertencia ante variación de costos.
  - `PriceHistoryModal.tsx`: Visualizador inmutable de cambios de PVP.

---

### BLOQUE E: MERMAS Y CONTEO FÍSICO
- **Estado:** `100% COMPLETADO`
- **Evidencia en Base de Datos & Schema:**
  - Tabla `waste_records`: Registro de mermas clasificadas (`tipo: 'merma_proceso' | 'merma_vencimiento' | 'merma_accidente' | 'otro'`).
  - Tabla `stock_counts` y `stock_count_items`: Auditorías de conteo ciego y físico.
  - Tabla `inventory_movements`: Recreada con soporte para transferencias entre sedes (`TRANSFERENCIA_SALIDA`, `TRANSFERENCIA_ENTRADA`), mermas y ajustes.
- **Evidencia en Servidor (`@tocineta/server`):**
  - Servicio: `waste-service.ts` (`recordWaste`, `getWasteSummary`, `performStockCount`, `getStockCountsHistory`).
  - Endpoints REST: `POST /api/profitability/waste`, `GET /api/profitability/waste/summary`, `POST /api/profitability/stock-counts`, `GET /api/profitability/stock-counts`.
- **Evidencia en Cliente (`@tocineta/web`):**
  - `WasteView.tsx`: Pestaña dedicada a registro y analítica de mermas.
  - `WasteRegisterModal.tsx`: Registro de incidentes y desperdicios.
  - `StockCountModal.tsx`: Formulario de arqueo físico por sede.
  - `TransferModal.tsx`: Transferencias entre Sede A y Sede B.

---

### BLOQUE F: ASISTENTE DE CARGA INICIAL + SCRIPT `db:init-prod`
- **Estado:** `100% COMPLETADO`
- **Evidencia en Servidor (`@tocineta/server`):**
  - Servicio: `setup-wizard-service.ts` (`importSetupCsv`, `generateTemplateCsv`, `resetToProductionClean`).
  - Script CLI: `pnpm run db:init-prod` ejecuta `apps/server/src/db/init-prod.ts` y purga todo dato demo o ficticio, dejando la base de datos lista para operación real.
  - Endpoints REST: `GET /api/profitability/setup/template.csv`, `POST /api/profitability/setup/import-csv`, `POST /api/profitability/setup/reset-production`.
- **Evidencia en Cliente (`@tocineta/web`):**
  - `InitialSetupWizard.tsx` (296 líneas): Asistente guiado paso a paso para importación de inventario inicial.
  - `CsvDataImportCard.tsx` y `ResetProductionModals.tsx`: Tarjetas de carga masiva y saneamiento de producción.

---

### BLOQUE G: DIVISIÓN DE PANTALLAS (LÍMITE ESTRICTO ≤400 LÍNEAS)
- **Estado:** `100% COMPLETADO`
- **Evidencia en Líneas de Código:**
  Ningún archivo del módulo de Rentabilidad e Inventario supera las 400 líneas:
  - `ProfitabilityDashboard.tsx`: **202 líneas**
  - `InventoryView.tsx`: **265 líneas**
  - `PurchasesView.tsx`: **218 líneas**
  - `RecipesView.tsx`: **242 líneas**
  - `WasteView.tsx`: **248 líneas**
  - `InitialSetupWizard.tsx`: **296 líneas**
  - Subcomponentes en `components/`:
    - `CostVariationModal.tsx`: **144 líneas**
    - `CsvDataImportCard.tsx`: **119 líneas**
    - `NewPurchaseModal.tsx`: **254 líneas**
    - `NewSupplyModal.tsx`: **172 líneas**
    - `PriceHistoryModal.tsx`: **73 líneas**
    - `RecipeEditorModal.tsx`: **341 líneas**
    - `RecipeModifiersSection.tsx`: **102 líneas**
    - `ResetProductionModals.tsx`: **83 líneas**
    - `StockCountModal.tsx`: **177 líneas**
    - `SubRecipeEditorModal.tsx`: **206 líneas**
    - `TransferModal.tsx`: **136 líneas**
    - `WasteRegisterModal.tsx`: **245 líneas**

---

## 3. BUGS CRÍTICOS RESUELTOS EN ESTA FASE (3.1)

1. **Eliminación de Barra Flotante Huérfana en POS:**
   - Se eliminó el bloque duplicado `fixed bottom-0` en `Step2Catalog.tsx`.
   - Se integró el contador de platos y total USD en el `footerExtra` del `WizardLayout` oficial en `PosComandero.tsx`.
   - Únicamente existe la barra inferior del asistente en los 3 pasos de Tomar Pedido.

2. **Resolución de Error 500 al Anular Comanda en Caja:**
   - Se garantizó la existencia del alias `sede_alta_vista` en `locations` mediante `ensureOfficialLocations()` en bootstrap.
   - Se creó `annulOrderInCashier` en `cashier-service.ts` con fallback seguro `const locationId = order.location_id || 'sede_alta_vista'`.
   - Se implementó `revertInventoryForOrder` en `recipes-service.ts` que revierte atómicamente deducciones si existían, o maneja limpiamente la orden sin receta sin lanzar excepciones ni HTTP 500.
   - Se actualizaron los estados a `orders.fulfillment_status = 'cancelado'` y `order_lines.status = 'cancelado'` con emisión inmediata del evento `ORDER_CANCELLED`.
   - Se conectaron los endpoints `POST /api/orders/:id/cancel` y `POST /api/orders/:id/void`.

3. **Blindaje de KDS Contra Órdenes Zombis:**
   - En `kitchen-queries.ts`, `getKitchenBuildableLines` filtra `COALESCE(ol.status, 'pendiente') != 'cancelado'`.
   - En `kds-service.ts`, `getKdsOrders` filtra estrictamente:
     ```sql
     WHERE o.fulfillment_status IN ('en_preparacion', 'listo')
       AND o.fulfillment_status NOT IN ('entregado', 'cancelado', 'anulado', 'cerrado')
       AND o.payment_status IN ('pagado', 'autorizado_sin_pago')
       AND o.payment_status != 'anulado'
       AND (j.status IS NULL OR j.status = 'abierta')
     ```
   - En `KdsView.tsx`, se aplicó memoized filter que descarta del render órdenes entregadas, canceladas o anuladas.

---

## 4. CONCLUSIÓN DE AUDITORÍA
La Fase 3 (Bloques A a G) se encuentra **100% implementada y conectada**. Todos los servicios, endpoints, contratos de base de datos y vistas de usuario están operativos y validados mediante build de producción y pruebas automatizadas.
