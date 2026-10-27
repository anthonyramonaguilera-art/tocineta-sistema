# Errores 500 Reales Capturados (Harness P0-B)

> Documento generado automáticamente a partir de las pruebas de navegador real Chromium en `tools/r2-harness/specs/r2-defects.spec.ts` y consultas a la tabla inmutable `server_errors` introducida en P0-A.

---

## 1. Defecto B15 — Sub-receta / Preparación Base

- **Endpoint:** `POST /api/fase3/sub-recipes`
- **Código HTTP:** `500` (o `422` con manejador de errores de P0-A)
- **Código interno:** `FIELD_REQUIRED` / `SQLITE_CONSTRAINT_NOTNULL`
- **Mensaje exacto:**
  ```text
  SqliteError: NOT NULL constraint failed: sub_recipe_items.supply_id
  ```
- **Archivo y Línea:**
  ```text
  apps/server/src/modules/profitability/recipes-service.ts:146:22
  ```
- **Trace del Servidor:**
  ```text
  SqliteError: NOT NULL constraint failed: sub_recipe_items.supply_id
      at <anonymous> (apps/server/src/modules/profitability/recipes-service.ts:146:22)
      at sqliteTransaction (node_modules/better-sqlite3/lib/methods/transaction.js:65:24)
      at saveSubRecipe (apps/server/src/modules/profitability/recipes-service.ts:150:3)
  ```
- **Causa Raíz Verificada:**
  Incompatibilidad de nombres en el contrato:
  - Frontend (`apps/web/src/features/profitability/components/SubRecipeEditorModal.tsx:34`): envía `items: [{ supplyItemId: "sup_...", quantity: 10 }]`.
  - Backend (`apps/server/src/modules/profitability/recipes-service.ts:145`): desestructura `it.supplyId` e `it.quantityRequired`.
  Al ser `it.supplyId` `undefined`, SQLite intenta insertar `NULL` en la columna `supply_id` que tiene restricción `NOT NULL` (y clave foránea hacia `supply_items`), provocando el fallo de base de datos no capturado.

---

## 2. Defecto B17 — Merma por Insumo y "($NaN)"

- **Endpoint:** `POST /api/fase3/waste`
- **Código HTTP:** `500`
- **Código interno:** `INTERNAL`
- **Mensaje exacto:**
  ```text
  Error: Producto 'null' no encontrado
  ```
- **Archivo y Línea:**
  ```text
  apps/server/src/modules/profitability/waste-service.ts:125:24
  ```
- **Trace del Servidor:**
  ```text
  Error: Producto 'null' no encontrado
      at <anonymous> (apps/server/src/modules/profitability/waste-service.ts:125:24)
      at sqliteTransaction (node_modules/better-sqlite3/lib/methods/transaction.js:65:24)
      at registerWasteLog (apps/server/src/modules/profitability/waste-service.ts:184:3)
  ```
- **Causa Raíz Verificada:**
  1. **Error 500:** El modal `WasteRegisterModal.tsx` envía el payload `{ locationId, supplyId: "sup_salchicha", productId: null, quantity: 2, unitCostUsdCents: 40, reason: "..." }`. No envía la propiedad `itemType`.
  2. En el backend (`waste-service.ts:69`), la condición evalúa `if (input.itemType === 'supply')`: al ser `itemType` `undefined`, se ejecuta la rama `else` (merma de plato terminado). Dicha rama toma `input.productId` (que viene en `null`) e intenta buscar `SELECT * FROM products WHERE id = null`. Al no hallar el registro, ejecuta `throw new Error("Producto 'null' no encontrado")`.
  3. **Visual "($NaN)":** En `WasteRegisterModal.tsx:40`, el modal lee `selectedProduct?.priceUsdCents`, pero en la base de datos y la API de productos la propiedad es `price_usd_cents` (o no está definida). La operación matemática `undefined * 0.4` produce `NaN`, desplegando `($NaN)` en la interfaz al usuario.

---

## 3. Defecto B19 — Asistente "Configura tu Negocio"

- **Endpoint:** `POST /api/fase3/setup-wizard/save`
- **Código HTTP:** `500`
- **Código interno:** `INTERNAL`
- **Mensaje exacto:**
  ```text
  TypeError: input.supplies is not iterable
  ```
- **Archivo y Línea:**
  ```text
  apps/server/src/modules/profitability/setup-wizard-service.ts:184:5
  ```
- **Trace del Servidor:**
  ```text
  TypeError: input.supplies is not iterable
      at <anonymous> (apps/server/src/modules/profitability/setup-wizard-service.ts:184:5)
      at sqliteTransaction (node_modules/better-sqlite3/lib/methods/transaction.js:65:24)
      at saveWizardData (apps/server/src/modules/profitability/setup-wizard-service.ts:298:5)
  ```
- **Causa Raíz Verificada:**
  1. Si se envía una petición parcial al asistente sin el arreglo `supplies`, la función `saveWizardData` itera directamente con `for (const sup of input.supplies)` sin validación defensiva `(input.supplies || [])`, arrojando una excepción fatal de JavaScript en el hilo de Fastify.
  2. En la UI (`apps/web/src/features/profitability/InitialSetupWizard.tsx:280`), el botón "Finalizar Asistente" ejecuta únicamente una prop `onFinish()` en memoria del frontend: nunca realiza la llamada `fetch('/api/fase3/setup-wizard/save')`. Toda la configuración cargada por el usuario en los 5 pasos se pierde al recargar.

---

## 4. Defecto B14 — Inventario Rápido no permite Agregar Insumos

- **Endpoint:** `/api/fase3/supplies`
- **Diagnóstico:**
  En `InitialSetupWizard.tsx` (Paso 1 "Catálogo de Insumos"), existen campos de texto para nombre, costo, unidad de compra, unidad de uso y factor de conversión (`quickSupplyName`, `quickCostUsd`, etc.). Sin embargo, la interfaz carece totalmente de un botón `<button>` o formulario `<form onSubmit>` para añadir el insumo a una lista o llamar a la API. Los valores quedan huérfanos en variables de estado de React (`useState`), imposibilitando que el usuario registre insumos desde el asistente.
  En `InventoryView.tsx`, cuando se crea un insumo desde el modal `NewSupplyModal.tsx`, no se asigna stock inicial en la sede activa en `location_inventory`, por lo que el insumo aparece con existencia 0 sin reflejarse en los conteos de la sede.

---

## Conclusión Técnica
Ninguno de estos fallos se debía a corrupción de base de datos ni a fallos del motor SQLite: eran **contratos rotos de nombres de campos** (`supplyItemId` vs `supplyId`, omisión de `itemType`) y **formularios incompletos en el frontend** que no realizaban llamadas a la API o no guardaban listas.
Con el manejador global de P0-A, cada una de estas fallas ahora queda registrada con su request_id, stack y parámetros en `server_errors`.
