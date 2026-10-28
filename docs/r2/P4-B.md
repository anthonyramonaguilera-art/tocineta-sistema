# P4-B — Modales de inventario: insumo rápido, sub-receta, recetas, compras y mermas

**Chat nuevo.** Lee `docs/r2/01-REGLAS-DEL-AGENTE.md` y `docs/r2/00-PLAN-MAESTRO.md`. Requiere P4-A (endpoints y contratos) y P1-B.
**Defectos (UI):** B14, B15, B16, B17, B18. **Alcance:** `apps/web/src/features/profitability/**`.

## Objetivo
Que cada modal funcione, se explique solo y muestre los errores del servidor junto al campo que falló. Sin "Internal Server Error", sin "$NaN", sin casillas misteriosas.

## Hechos verificados (confirma con grep)
- Componentes en `features/profitability/`: `InventoryView.tsx`, `PurchasesView.tsx`, `RecipesView.tsx`, `WasteView.tsx`; en `components/`: `NewSupplyModal.tsx`, `SubRecipeEditorModal.tsx`, `RecipeEditorModal.tsx`, `NewPurchaseModal.tsx`, `WasteRegisterModal.tsx`, `StockCountModal.tsx`, `TransferModal.tsx`, `PriceHistoryModal.tsx`. Confirma con grep cuál abre **"Inventario Rápido"** del menú y cuál "agregar insumo".
- `WasteRegisterModal.tsx`: la etiqueta de plato usa `p.priceUsdCents / 100` (`~línea 173`) y el costo por defecto de plato es `priceUsdCents * 0.4` o 150 fijo (`~línea 30`); el cuerpo manda `unitCostUsdCents` (`~línea 61`). La etiqueta "($NaN)" aparece cuando `priceUsdCents` llega `undefined`.
- Compras (`NewPurchaseModal.tsx`): cada ítem tiene **dos casillas numéricas** sin explicar qué dato pide cada una (feedback de Anthony).
- Sub-receta: el campo **"Rendimiento del batch"** no se explica.
- En Recetas solo se pueden **modificar** recetas existentes y sub-recetas; no hay "Nueva receta".

## Tareas
1. **Cliente de API común** `features/profitability/api.ts`: `postJson()` que lanza `ApiError {code, message, field}` leyendo el JSON de error de P0-A; nunca muestra "Internal Server Error". Cada modal muestra el error **bajo el campo** indicado por `field` y un resumen arriba si no hay campo. Botón de envío con estado "Guardando…" y protección contra doble clic (usa `clientRequestId`).
2. **Insumo rápido / Nuevo insumo:** campos nombre, categoría, **unidad de compra**, **unidad de uso**, **cantidad de unidades de uso por unidad de compra** (el "factor de conversión", con ese nombre claro), costo por unidad de compra y stock mínimo. Vista previa viva: "1 caja = 12 unidades · cada unidad cuesta $0.45". Al guardar, cierra, avisa y refresca la lista (invalida las claves de inventario).
3. **Sub-receta:** el campo se llama **"¿Cuántas porciones/unidades salen de este lote?"** con ayuda "¿Qué es?" y ejemplo numérico ("Con 2 kg de carne y 200 g de especias preparas 40 porciones de salsa → escribe 40 y elige 'porciones'"). Vista previa del **costo del lote** y del **costo por porción** en vivo. Errores por campo.
4. **Recetas desde cero:** botón **"Nueva receta"** en `RecipesView`; selector de plato de la carta (los que muestran "Sin receta" van primero), ingredientes (insumos y sub-recetas) con cantidad y unidad de uso, **costo total, costo por plato y margen en vivo** contra el precio de venta. Editar y crear usan el mismo `RecipeEditorModal` (≤400 líneas; divide en subcomponentes si hace falta).
5. **Compras:** reemplaza las dos casillas por dos campos con etiqueta explícita: **"Cantidad comprada (en unidad de compra)"** y **"Precio pagado por cada unidad de compra"**, con línea viva: "3 cajas × 12 unidades = 36 unidades · $0.45 por unidad". Muestra el cambio del costo promedio ("antes $0.42 → después $0.44").
6. **Foto de factura:** botón "Adjuntar foto de factura" (`<input type="file" accept="image/*" capture="environment">`), vista previa, subida con `POST /api/fase3/purchases/:id/invoice` y visor en el detalle de la compra (modal con zoom) junto a los datos digitales de la factura. Si la subida falla, la compra **ya guardada** se conserva y se ofrece "Reintentar subida".
7. **Mermas:** selector de plato sin `NaN`: muestra "(sin receta)" cuando `hasRecipe` es falso y entonces el **costo manual es obligatorio** (campo marcado). Total en vivo con `Number(x || 0)`. Merma por insumo usa el costo ponderado de la sede elegida. Todos los errores del servidor se muestran por campo.
8. **Pruebas Playwright** para: agregar insumo (aparece en la lista), guardar sub-receta, crear receta nueva y verla con margen, compra con foto y visor, merma de insumo y de plato sin receta. Cada una verifica que **no** aparece "NaN" ni "Internal Server Error".

## Prohibido
- Calcular costos acumulados en el cliente como fuente de verdad (la vista previa es solo ayuda; el servidor manda).
- Tocar impresión, dinero base, outbox.
- Dejar un campo técnico sin etiqueta clara.

## Criterios de aceptación (Playwright 360×800 y 1280×800)
- B14, B15, B16, B17, B18 (UI) en verde; `guard:visual` verde.
- Cada modal: flujo feliz, error de validación por campo y error de servidor con mensaje legible (capturas).
- 238+ pruebas verdes; lint y build verdes; ningún archivo nuevo o tocado supera 400 líneas.

## Entrega
Según §6. Adjunta capturas a 360 px de cada modal con su ayuda/vista previa y el visor de factura.
