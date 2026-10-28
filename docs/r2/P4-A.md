# P4-A — Backend de inventario, recetas, compras, mermas y asistente

**Chat nuevo.** Lee `docs/r2/01-REGLAS-DEL-AGENTE.md` y `docs/r2/00-PLAN-MAESTRO.md` (§2 causas 7-10; §4 D2, D3, D5, D6). Requiere P2-B y `docs/r2/ERRORES-500-REALES.md` (de P0-B).
**Defectos (servidor):** B14, B15, B16, B17, B18, B19, B24, B29. **Alcance:** `apps/server` + migraciones. La UI va en P4-B y P4-C.

## Objetivo
Que cada operación de inventario/receta/compra/merma funcione, valide con mensajes por campo, cuente los números una sola vez y deje el costo y el stock correctos por sede.

## Hechos verificados (confirma con grep; las rutas reales son `/api/fase3/*`)
- `profitability/fase3-routes.ts` (528 líneas): `GET/POST /api/fase3/supplies`, `/inventory/movements`, `/inventory/transfer`, `/sub-recipes`, `/recipes`, `/recipes/:productId`, `/purchases`, `/purchases/adjust-prices`, `/price-history`, `/waste`, `/stock-counts`, `/setup-wizard/{template,export,import,save,init-prod,seed-demo}`. Existen además rutas antiguas en `profitability/routes.ts` (901 líneas).
- `POST /api/fase3/supplies` (líneas ~153-196): el `id` se deriva del nombre (`sup_<nombre saneado, 30 car.>`) y usa `ON CONFLICT(id) DO UPDATE`: **dos nombres distintos pueden colisionar y el segundo sobrescribe al primero en silencio**; no crea filas en `location_inventory`; no valida unidad ni factor. Hipótesis para B14.
- `GET /api/fase3/supplies` (líneas ~105-150): `stockByLocation` tiene **`loc_alta_vista` y `loc_los_olivos` escritos a mano**, y el total "ALL" usa la columna heredada `supply_items.current_stock_qty` en vez de sumar `location_inventory`.
- `recipes-service.ts` (590 líneas): `saveSubRecipe` (~112) hace `input.name.trim()` e itera `input.items` sin validar; un cuerpo sin `items` o con otro nombre de clave da `TypeError` → 500; un `supplyId` inexistente rompe la FK dentro de la transacción → 500. Solo admite insumos (no sub-recetas anidadas). `saveProductRecipe` (~270), `deductInventoryForOrder` (~354), `revertInventoryForOrder` (~513).
- `recipes-service.ts:~529`: la reversa usa `WHERE (reference_doc LIKE ? OR notes LIKE ?)` con el número de orden → anular la #1 puede tocar #10, #11 o cualquier nota con ese dígito. Hoy `inventory_movements` no tiene `order_id`.
- `waste-service.ts` (379 líneas): inserta en `waste_logs` **y** en `operating_expenses` (`MERMAS_DESPERDICIOS`, ~línea 169). `waste_logs` (migración `0023`) es la única tabla de mermas real (no `waste_records`). El modal manda `unitCostUsdCents` y el servicio lee `costUsdCents` (total). Para platos usa `products.estimated_cost_usd_cents`; si es 0 el costo queda en 0.
- `deductInventoryForOrder` descuenta hoy solo al cobrar; no hay marca de "ya consumido".
- `profitability/setup-wizard-service.ts` (385 líneas) + `POST /setup-wizard/save`: confirma si guarda en una sola transacción y cuántos ítems acepta.
- En el esquema real migrado, los `INSERT` de merma (`inventory_movements` con `MERMA_DESECHO`, `operating_expenses` con `MERMAS_DESPERDICIOS`) **funcionan**: el 500 de merma por insumo no viene de un CHECK; mira `ERRORES-500-REALES.md`.

## Tareas
1. **Los tres 500 + merma de plato:** para cada caso de `ERRORES-500-REALES.md`, escribe primero la prueba que lo reproduce y luego corrige la **causa raíz**. Toda validación usa `AppError` con `field` (de P0-A). Si un 500 no se reprodujo en P0-B, repórtalo; no inventes la causa.
2. **Insumos (`/api/fase3/supplies`):** `id` generado con UUID (no derivado del nombre); crear con nombre duplicado (insensible a mayúsculas/acentos) → 409 `DUPLICATE` con `field:'name'`; validar `usageUnit`, `purchaseUnit`, `conversionFactor > 0`; al crear, sembrar `location_inventory` en 0 para cada sede activa; `stockByLocation` se construye desde `locations` activas (sin literales) y el total "ALL" es la **suma** de las sedes.
3. **Sub-recetas:** validar nombre, `yieldQuantity > 0`, `yieldUnit`, `items` no vacío, cada `supplyId` existente y cantidades > 0 (error por campo). Permitir **sub-receta dentro de sub-receta** solo si añades detección de ciclos con prueba; si no, déjalo fuera y repórtalo. Devolver costo por unidad de rendimiento (`costo total ÷ yieldQuantity`).
4. **Recetas desde cero (B16):** `POST /api/fase3/recipes` crea la receta de un producto de la carta que aún no la tiene (o la reemplaza), con ítems de insumo y/o sub-receta, cantidades > 0, sin ciclos. `GET /api/fase3/recipes` incluye `hasRecipe` y `unitCostUsdCents` por producto (nunca `undefined`).
5. **Mermas (D3):** una sola fuente, `waste_logs`. Dejar de insertar en `operating_expenses`. Migración de datos que elimine únicamente los gastos espejo (`category='MERMAS_DESPERDICIOS'` y descripción que empiece por `Merma:`), previa copia (usa el snapshot de migración). La API acepta `costUsdCents` (total) **o** `unitCostUsdCents`; total = unidad × cantidad redondeado. Plato **sin receta** → exige costo manual (`COST_REQUIRED`, `field:'costUsdCents'`); jamás `NaN`. Merma por insumo descuenta `location_inventory` de **esa sede** y registra el movimiento.
6. **Consumo por venta (D2) e idempotencia:** `deductInventoryForOrder` se ejecuta **una sola vez por orden**, la primera vez que la orden entra a cocina o se cobra. Marca con columna nueva (`orders.inventory_consumed_at_ms`) o restricción única `(order_id, supply_id, movement_type)`. Reintentos del outbox no duplican. Sede = `orders.location_id`.
7. **Anulación (B24):** migración que agrega `order_id` (nullable, indexada) a `inventory_movements` y la rellena **solo** donde el `reference_doc`/`notes` coincida con el formato exacto de la orden; los movimientos nuevos siempre la llevan. `revertInventoryForOrder` busca por `order_id`. Regla D2: antes de "En preparación" → reversa; después → no devuelve stock y crea una merma automática "Orden anulada en cocina". Prueba de regresión con órdenes #1, #10 y #11.
8. **Compras y costo (D6):** confirmar que `purchases-service.ts` recalcula el **costo promedio ponderado** y el costo de las recetas; transferencia entre sedes mueve al costo promedio del origen y recalcula el del destino. **Foto de factura:** columna `purchases.invoice_photo_path`; `POST /api/fase3/purchases/:id/invoice` (multipart; JPEG/PNG/WebP; ≤ 5 MB; valida el tipo por bytes iniciales, no por extensión) guarda en `data/uploads/invoices/<año>/<id>.<ext>`; `GET` autenticado para verla. Verifica que `data/uploads` está en `.gitignore`.
9. **Asistente transaccional (B19):** `POST /api/fase3/setup-wizard/save` recibe **N** insumos, **N** proveedores y **N** recetas, valida todo antes de escribir, guarda en **una** transacción (todo o nada), es idempotente con `clientRequestId` y devuelve conteos creados/omitidos y errores por fila (`rows[i].field`). El insumo rápido usa la misma validación.
10. **Rutas (D5):** lista los llamadores de cada ruta antigua de `routes.ts` con grep del frontend y pruebas; las que tienen cero llamadores se retiran, las demás quedan en lectura. No borres nada que una prueba use.
11. **Pruebas** `apps/server/test/r2-inventario.test.ts` (BD temporal): una por tarea 1-9, incluida la de colisión de nombres, merma sin duplicar gasto, consumo idempotente (2 llamadas = 1 descuento) y anulación por `order_id`.

## Prohibido
- Tocar `money.ts`, impresión, cadena de hashes del cierre, outbox.
- Dejar `NaN`, `undefined` o `null` en un contrato de costo.
- Cambiar `closures-service.ts` (la reversa/merma automática se registra por los servicios de inventario).
- Borrar movimientos o ventas existentes.

## Criterios de aceptación
- B14–B19 (servidor), B24 y B29 en verde; `PRAGMA foreign_key_check` vacío tras migrar la BD de prueba.
- Para el escenario: comprar 36 unidades a $0.45 cambia el costo ponderado y el costo de las recetas que lo usan; una merma de 2 unidades baja el stock de la sede y la utilidad **una sola vez**.
- 238+ pruebas verdes; lint y build verdes.

## Entrega
Según §6. Incluye: causa real de cada 500 (archivo y línea), migraciones creadas y filas afectadas, y la lista de rutas antiguas retiradas/mantenidas con su justificación.
