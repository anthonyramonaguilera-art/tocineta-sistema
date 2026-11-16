# AUDITORÍA DE MÓDULOS PENDIENTES — 14 NOV

**Sistema:** TOCINETA
**Rama auditada:** `feat/apk-terminal`
**Tipo:** Auditoría de solo lectura (sin cambios en `apps/`, `packages/` ni `android-terminal/`).
**Alcance:** Facturación Libre, Panel Dueña, Carta y Precios, Envíos entre Sedes.
**Método:** lectura de código y tests existentes; toda afirmación se ancla a `archivo:línea`.

---

## Resumen ejecutivo

| Módulo | Estado | Duda principal | Evidencia ancla |
|---|---|---|---|
| Facturación Libre | **OK con deuda** | P&L agrupa por `product_id`; no descuenta inventario; bloqueo a mesonero es intencional y está testeado | `0041_free_item.sql:21-55`, `order-service.ts:266-306`, `profit-service.ts:166-172` |
| Panel Dueña | **OK con deuda** | Respeta `ALL` pero por comparación `!== 'ALL'` (sensible a mayúsculas), no por `normalizeLocationFilter`; el detalle de transferencias trae JSON completo de más | `financial-truth-service.ts:64`, `owner-dashboard-service.ts:68-181` |
| Carta y Precios | **OK con deuda** | `MenuAdminView.tsx` tiene 1678 líneas (límite 400 no aplicado por el guard); 36 `alert/confirm`; cambio de precio no escribe `price_history`; QR estático requiere re-export | `components/MenuAdminView.tsx:102-114,375,1286`, `menu-service.ts:590-640`, `qr-menu/routes.ts:76-104` |
| Envíos entre Sedes | **OK con deuda (duda abierta)** | Transacción atómica y NDP correctos; la venta en Sede B descuenta de `location_inventory` de B **por código**, pero **no hay test que lo fije**; además está condicionado a `inventory_operation_mode='tracked'` | `transfers-service.ts:250-416`, `cashier-service.ts:828-830`, `recipes-service.ts:694-703` |

Ningún módulo está **Roto**. Las tres primeras tienen deuda acotada y verificable; el cuarto tiene una duda de negocio que requiere test.

---

## 1. Facturación Libre (ítem libre de mostrador)

### 1.1 Migración 0041 (prod_libre)

`apps/server/src/db/migrations/0041_free_item.sql`:
- Crea `cat_libre` (categoría interna, `is_internal=1`, estación `caja_bebidas`) — L3-19.
- Crea `prod_libre` (categoría `cat_libre`, precio `0`, costo `0`, estación `caja_bebidas`, `recipe_mode='UNITS'`, `target_margin_bps=6500`) — L21-55.
- Agrega la columna `custom_name TEXT` a `order_lines` — L57.

Conclusión: el ítem libre es un producto *placeholder* sin receta y con precio fijo 0; el precio real y el nombre llegan por línea (`custom_name`, `customPriceUsdCents`).

### 1.2 Validación y autorización (por qué se bloquea a mesonero)

`apps/server/src/modules/orders/order-service.ts`:
- `assertProductsSellable` excluye `prod_libre` de la validación de disponibilidad — L153-154.
- Campos exclusivos de `prod_libre`: `customName`, `customPriceUsdCents` y `station` solo se admiten cuando `productId === 'prod_libre'`; si llegan en otro producto → `FREE_ITEM_FIELDS_NOT_ALLOWED` (400) — L177-190 y L258-265.
- **Autorización (núcleo del bloqueo):** L266-306.
  - `admin` → autorizado — L270.
  - Si `permissions_json` es objeto/arreglo con `canAddFreeItem === true` → autorizado — L282-289.
  - Si `canAddFreeItem === false` → denegado — L290-292.
  - Si no hay `canAddFreeItem` explícito: `supervisor` o `cajera` → autorizado — L293-294; **cualquier otro rol (mesonero, cocinero, despachador) → denegado** — L295-298.
  - Denegado → `FREE_ITEM_FORBIDDEN` (403) — L301-306.
- Validaciones de la línea libre: nombre 1–60 caracteres (L308-313), precio entero 1–50000 centavos (L315-320), cantidad 1–99 (L322-327), sin `comboChildren` (L329-334), estación en `hot_dogs|hamburguesas|caja_bebidas` (L336-341).
- La línea se materializa con precio/nombre/estación efectivos y se guarda `custom_name` — L448-478; se registra auditoría `FREE_ITEM_ADDED` — L480-495.

**Respuesta al "por qué":** mesonero está bloqueado *por defecto* porque el fallback L295-298 solo autoriza `supervisor` y `cajera`. Para habilitarlo hay que asignarle `{"canAddFreeItem": true}` en `permissions_json`. Está cubierto por test: `apps/server/test/r2-free-item.test.ts` — mesonero 403 (L135-156), admin otorga permiso y luego 201 (L158-171), cajera con `canAddFreeItem:false` → 403 (L181-199).

### 1.3 ¿Descuenta inventario?

No, por dos motivos independientes:
1. `prod_libre` tiene `recipe_mode='UNITS'` y **no tiene `recipe_items`** (`0041_free_item.sql:21-55`). En `deductInventoryForOrder` (`apps/server/src/modules/profitability/recipes-service.ts:479-499`) el modo por defecto es `'free'` (corto-circuito L488); aun en `'tracked'`, `applyRecipeItems` devuelve `false` y se registra `INVENTORY_DEDUCTION_GAP` sin descontar — L586-598.
2. `inventory_operation_mode` por defecto es `'free'` (`apps/server/src/db/business-settings.ts:78`; `fresh-prod.ts:89,225`), y `deductInventoryForOrder` retorna sin hacer nada en ese modo — `recipes-service.ts:488-490`.

Por diseño: el ítem libre es de mostrador y no tiene receta; no hay insumo que descontar.

### 1.4 Cómo se agrupa en el P&L

`apps/server/src/modules/finances/profit-service.ts`:
- El ranking de productos agrupa por `line.product_id` (L166-172, L196-202) y usa `COALESCE(p.name, 'PRODUCTO')` (L167). Para `prod_libre`, `p.name` es `'Item libre'`, **no** `custom_name`.
- Consecuencia: todos los ítems libres de la jornada colapsan en una sola fila `"Item libre"` en `topProducts` y en `"Item Libre"` en `byCategory` (L221-234, categoría `cat_libre`). Se pierde el desglose por nombre personalizado.
- El desglose por categoría sí los incluye como categoría `"Item Libre"` (L221-227, sin filtro `is_internal`).

### 1.5 Estado y riesgo

**ESTADO: OK con deuda.**
- **Riesgo (bajo, contable/operativo):** el P&L no discrimina los ítems libres por nombre; para la dueña todos son "Item libre". No afecta montos (los centavos sí se suman por línea) pero impide saber *qué* se vendió fuera de carta desde el P&L.
- **Riesgo (nulo funcional):** el bloqueo a mesonero es correcto y probado; requiere decisión de negocio si se quiere habilitar por defecto.

---

## 2. Panel Dueña

### 2.1 Dos servicios distintos

1. **Panel de 5 números (finanzas):** `apps/server/src/modules/finances/owner-dashboard-service.ts` → `getOwnerDashboardNumbers` (L48-116). Expuesto en `GET /api/finances/owner-numbers` (`finances/routes.ts:41-45`). Recibe `locationId?` y delega en `getFinancialTruth` con `locationId || 'ALL'` — L69-73.
2. **Panel Fase 4 agregado (transferencias/stock/caja):** `apps/server/src/modules/transfers/owner-dashboard-service.ts` → `getOwnerDashboardData` (L58-227). Expuesto en `GET /api/fase4/owner-dashboard` (`transfers/routes.ts:256-261`). **No recibe filtro de sede**: agrega todas las sedes activas (L66) y llama `getFinancialTruth` sin `locationId` (L68).

### 2.2 ¿Respeta 'ALL'? (verificación de la premisa A2)

- `getFinancialTruth` maneja `ALL` con una comparación **sensible a mayúsculas**: `const filterLoc = params.locationId && params.locationId !== 'ALL' ? params.locationId : null;` — `apps/server/src/modules/finances/financial-truth-service.ts:64`.
- `normalizeLocationFilter` (`apps/server/src/modules/finances/financial-truth-helpers.ts:96-99`) normaliza `''`, `'all'`, `' All '` → `null`. Tras A2 se usa en `profit-service.ts:93`, `cashflow-service.ts:66`, `expenses-service.ts:214` y `export-service.ts:154`.
- **Hallazgo:** la ruta del Panel Dueña **no aplica** `normalizeLocationFilter`; depende del `!== 'ALL'` exacto. Si un cliente envía `locationId=all` o `' all '`, `getOwnerDashboardNumbers` lo pasa como literal y `getFinancialTruth` filtra por una sede inexistente → resultados en cero. Con `'ALL'` mayúscula o sin parámetro funciona bien.
- Estado: **respeta 'ALL' en el caso normal (mayúscula o ausente), pero no está normalizado** como en los demás servicios financieros.

### 2.3 `/ws`

- `/ws` es una pasarela genérica de eventos: `apps/server/src/plugins/websocket.ts:13-49` (registra sockets, responde `PONG`, propaga por bus). Está declarada en `route-policy.ts:49` como `ANY_SESSION`.
- El widget del Panel **no se sirve por `/ws`**; el dashboard es REST (`/api/fase4/owner-dashboard`) y `/ws` solo empuja eventos de dominio (`ORDER_CREATED`, `TRANSFER_CREATED`, etc.) para refresco en vivo vía `event-bus`.
- Cualquier afirmación de que "el panel viaja por `/ws`" es imprecisa: viaja por REST + notificaciones por `/ws`.

### 2.4 Detalle de transferencias: ¿trae más de lo necesario?

- En `getOwnerDashboardData`, la consulta `recentTransfers` selecciona `t.items_json` (L170) y **solo usa su longitud** para contar ítems: `itemsCount = JSON.parse(r.items_json).length` (L178-182). Se trae el JSON completo (con `supplyName`, `unitCostUsdCents`, `totalCostUsdCents` por ítem) para calcular un entero.
- El listado `GET /api/fase4/transfers` (`transfers-service.ts:541-566`) hace `SELECT *` y parsea `items_json` completo para cada fila (L561-565). No hay endpoint de "detalle" separado que permita aligerar el listado.
- **Conclusión:** sí trae de más en el panel (JSON completo para un conteo) y en el listado (ítems completos en una vista de lista). Es deuda de rendimiento, no un bug funcional.

### 2.5 Estado y riesgo

**ESTADO: OK con deuda.**
- **Riesgo (bajo):** `ALL` no normalizado en el Panel Dueña; un valor en minúsculas/con espacios produce ceros silenciosos.
- **Riesgo (bajo/medio según volumen):** payload de transferencias sobredimensionado en dashboard y listado.

---

## 3. Carta y Precios

### 3.1 `window.alert()` / `confirm()` en `apps/web/src`

Búsqueda `rg -n "window.alert|alert\(|confirm\(" apps/web/src` → **36 coincidencias**. Las más relevantes:

- `apps/web/src/components/MenuAdminView.tsx`: `alert(...)` en L375 (crear categoría), L465 (asociar ingrediente), L482 (error de conexión), L517 (imagen > 2 MB); `window.confirm(...)` en L1286 (eliminar cupón).
- `apps/web/src/features/staff/StaffManagementView.tsx:57,60,67`; `features/staff/SettlementModal.tsx:159`.
- `features/settings/OnboardingWizardModal.tsx:61`.
- `features/quotes/QuoteModal.tsx:109,113,144`; `features/quotes/EventQuotesView.tsx:40,48,56,68,73,79`.
- `features/profitability/PurchasesView.tsx:82`.
- `features/finances/MonthlyClosureTab.tsx:52`; `features/finances/FinancesDashboardView.tsx:85`; `features/finances/ExpensesTab.tsx:162`.
- `features/profitability/components/DispatchNoteSuccessModal.tsx:40,59,62`.
- `features/partners/PartnersManagementView.tsx:29`; `PartnerModal.tsx:26,30,46`; `ProfitDistributionModal.tsx:30,34,46`; `PartnerTransactionModal.tsx:29,44`.
- `features/uikit/UiKitView.tsx:150` (ejemplo del propio kit).

Esto viola la intención de UI blindada (modales del UI Kit en vez de diálogos nativos), aunque no todos son "Carta y Precios"; el foco del módulo es `MenuAdminView.tsx` (5 usos).

### 3.2 Tamaño de `MenuAdminView.tsx`

- El archivo real es `apps/web/src/components/MenuAdminView.tsx` = **1678 líneas** (verificado por conteo de LF; el re-export `features/menu-admin/MenuAdminView.tsx` es un shim de 2 líneas).
- **Supera el límite duro de 400 líneas** de AGENTS.md §3.
- **No lo detecta el guard:** `scripts/ui-guard.mjs:49-111` aplica el límite 400 solo a la lista `PHASE1_AND_2_SCREENS` (L49-100), y `MenuAdminView.tsx` **no está** en esa lista. Por eso el guard pasa en verde con un archivo de 1678 líneas.

### 3.3 L104-L113 (manipulación de `body.overflow`)

`apps/web/src/components/MenuAdminView.tsx:102-114`:
- `useEffect` para `isCreatingProduct`: guarda `prev = document.body.style.overflow`, lo pone `'hidden'`, restaura `prev` en cleanup — L102-107.
- `useEffect` para `isCategoryModalOpen`: mismo patrón — L109-114.

Es manipulación directa del DOM, no del UI Kit. Funciona (restaura el valor previo), pero si ambos modales se abren a la vez, el orden de cleanup puede dejar `overflow` restaurado al valor equivocado. Riesgo bajo.

### 3.4 Efectos de cambiar precio en POS / QR / ticket

- **Actualización de precio:** `updateProduct` (`apps/server/src/modules/menu/menu-service.ts:592-640`) hace `UPDATE products SET price_usd_cents=...` (L618-623). El comentario L590 es explícito: *"REGLA DE INTEGRIDAD: No altera las líneas de órdenes pasadas (order_lines)"*. Registra auditoría `PRODUCT_UPDATED` (L625-631) y publica evento (L633-637). **No escribe `price_history`**: esa tabla solo la escribe `confirmPriceAdjustments` (`apps/server/src/modules/profitability/purchases-service.ts:326-336`).
- **POS:** lee precio vivo del menú operativo (`product.priceUsdCents`, `features/pos/Step2Catalog.tsx:299`); las órdenes nuevas toman el precio nuevo.
- **QR:** la API (`getPublicQrMenuData`) lee `p.price_usd_cents` vivo (`apps/server/src/modules/qr-menu/qr-menu-service.ts:218-223`). **Pero** `/qr` (`qr-menu/routes.ts:76-90`) y `/qr/menu-snapshot.json` (L92-104) sirven el paquete estático pregenerado si existe → un cambio de precio **no** se refleja en el QR estático hasta re-exportar (`POST /api/qr-menu/export-static`).
- **Ticket:** las líneas guardan `snapshot_json` con `basePrice` (L457-461) y subtotal calculado al crear la orden (L451); un cambio posterior de precio no altera tickets ya emitidos (coherente con L590).

### 3.5 Estado y riesgo

**ESTADO: OK con deuda.**
- **Riesgo (gobernanza UI):** `MenuAdminView.tsx` 1678 líneas viola el límite 400 y el guard no lo detecta (brecha de cobertura del guard).
- **Riesgo (auditoría de precios):** el cambio de precio desde Carta y Precios no queda en `price_history` (solo `PRODUCT_UPDATED` en auditoría), a diferencia del flujo de Compras/Rentabilidad.
- **Riesgo (canal QR):** si la carta pública se sirve estática, el precio nuevo exige re-export manual.
- **Riesgo (UX nativa):** 36 `alert/confirm` en el frontend, 5 en este módulo.

---

## 4. Envíos entre Sedes

### 4.1 Transacción atómica

`apps/server/src/modules/transfers/transfers-service.ts`:
- `createTransfer` valida sedes distintas (L182-186), ítems no vacíos (L188-192) y stock en origen (L198-213); el despacho forzado exige motivo + PIN de admin/supervisor (L216-245).
- Todo el efecto transaccional (descuento origen, alta destino si no hay tránsito, inserción de la nota, auditoría y evento) está dentro de `rawDb.transaction(() => { ... })()` — L250-416. Es atómico: o se aplican stock origen/destino + registro, o nada.
- `confirmTransferReception` (para envíos en tránsito) también abre transacción — L441-530.

### 4.2 Numeración NDP

- `transferNumber = MAX(transfer_number) + 1` — L251-252.
- `dispatchNoteCode = 'NDP-' + String(transferNumber).padStart(4, '0')` — L253 (ej. `NDP-0001`).
- Se calcula **dentro** de la transacción, por lo que no hay carrera entre el cálculo y la inserción en el modelo de escritor único de SQLite. No hay contador dedicado; la unicidad depende de que toda creación pase por aquí.

### 4.3 Duda abierta de negocio: venta en Sede B → `location_inventory` de B (no de un lote)

**Confirmación por código (sí descuenta de B):**
- Al cobrar: `const orderLocationId = order.location_id || 'loc_alta_vista'; deductInventoryForOrder(rawDb, orderId, orderLocationId, ...)` — `apps/server/src/modules/cashier/cashier-service.ts:828-830`.
- Al entrar a cocina: `deductInventoryForOrder(rawDb, line.order_id, order.location_id || 'loc_alta_vista', ...)` — `apps/server/src/modules/kds/kds-service.ts:359-362`.
- El descuento se aplica siempre a `location_inventory WHERE location_id = <order.location_id> AND supply_id = ?` — `recipes-service.ts:694-703`. **No interviene ningún "lote"/batch en la venta**; los batches (`transfer_batches`) son solo para despachos entre sedes.
- Idempotente por `orders.inventory_consumed_at_ms` — `recipes-service.ts:494-496`.

**Confirmación por test (NO existe):**
- Todas las llamadas a `deductInventoryForOrder` en tests usan `'loc_alta_vista'`: `test/fase3-inventory-recipes-locations.test.ts:265`, `test/inventory-deduction-modifiers.test.ts`, `test/r2-libre.test.ts`, `test/quick-create-product.test.ts:124`, etc.
- El e2e de venta usa jornada/sede `loc_alta_vista` — `test/gastro-cycle-e2e.test.ts:146,166`.
- No hay ninguna coincidencia de `deductInventoryForOrder(... 'loc_los_olivos' ...)` ni de venta cobrada en `loc_los_olivos`.

**Conclusión de la duda:** el comportamiento correcto (Sede B descuenta de `location_inventory` de B) está **garantizado por el código**, pero **no está fijado por test**. Queda como deuda: falta un test que cree/pague una orden con `location_id='loc_los_olivos'` y verifique el stock de `loc_los_olivos` (y que `loc_alta_vista` no cambia).

**Condición adicional:** todo lo anterior solo ocurre en `inventory_operation_mode='tracked'`; en `'free'` (default) `deductInventoryForOrder` retorna sin descontar (`recipes-service.ts:488-490`).

### 4.4 Estado y riesgo

**ESTADO: OK con deuda (duda abierta).**
- **Riesgo (medio, cobertura):** la regla "venta en Sede B afecta inventario de B, no un lote" depende de que todos los llamadores pasen `order.location_id`; hoy hay dos llamadores (caja y KDS) y ambos lo hacen, pero sin test de regresión para Sede B.
- **Riesgo (medio, operativo):** si el negocio opera en modo `'free'`, el inventario no se descuenta en absoluto; el test de Sede B debe ejecutarse en modo `'tracked'`.

---

## 5. Deuda y riesgos consolidados (para priorizar)

1. **Fijar con test la venta en Sede B** (Envíos entre Sedes / inventario): orden cobrada con `loc_los_olivos` → descuenta `loc_los_olivos`, no mueve `loc_alta_vista`, no toca lotes. *(Código correcto; sin test.)*
2. **Normalizar `ALL` en el Panel Dueña** o documentar que es sensible a mayúsculas. *(Bajo.)*
3. **Aligerar payload de transferencias** (dashboard y listado): contar sin traer `items_json` completo. *(Bajo/medio.)*
4. **Dividir `MenuAdminView.tsx`** (1678 líneas) y/o incluir archivos como este en el límite 400 del guard. *(Gobernanza UI.)*
5. **Registrar en `price_history`** los cambios de precio hechos desde Carta y Precios. *(Auditoría de precios.)*
6. **Documentar/reforzar la re-exportación del QR estático** tras cambiar precios. *(Operativo.)*
7. **Reemplazar `alert/confirm` nativos** por modales del UI Kit en los flujos de Carta y Precios. *(UX.)*

---

## 6. Nota de verificación

- Rama: `feat/apk-terminal`.
- Antes de esta auditoría el árbol ya tenía 3 archivos no rastreados ajenos al encargo: `baseline-clean.txt`, `docs/AUDITORIA_Y_SOLUCIONES_CAJA_Y_CIERRES.md` y `tocineta-1.0.1.sig`. **No se tocaron** (fuera de alcance; el commit de este prompt usa ruta explícita).
- Este informe es el único archivo creado por esta tarea. No se modificó ningún archivo de `apps/`, `packages/` ni `android-terminal/`.
