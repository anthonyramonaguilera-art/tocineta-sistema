# REVISIÓN DE COMMITS — RONDA 1

**Sistema:** TOCINETA
**Rama:** `feat/apk-terminal`
**HEAD revisado:** `0a6118e` (`docs(go-live): plan para partir MenuAdminView`)
**Ventana revisada:** `2ddf1c8` (extra) y `2bf1120..573a64f` (ronda 1)
**Tipo:** revisión de solo lectura. No se modificó `apps/`, `packages/` ni `android-terminal/`.
**Fecha:** 2026-11-16

---

## 0. Aclaraciones de método

1. **No existe en el repositorio un catálogo de los prompts A1–F1.** La asignación de los commits que el encargo no enumera se reconstruyó por contenido, orden cronológico y archivos tocados; se marca como **inferida**. Los 13 commits indicados en el encargo se marcan como **confirmados**.
2. La revisión se hace sobre el estado actual de `HEAD`, no sobre el árbol de cada commit. Por eso, cuando un defecto de un commit ya fue corregido por otro posterior, se indica expresamente.
3. No se ejecutaron suites de prueba. La evidencia es lectura de código, `git show` y una consulta de solo lectura a `apps/server/data/tocineta.db` (snapshot de la base de trabajo).
4. El árbol ya tenía tres archivos no rastreados antes de esta tarea: `baseline-clean.txt`, `docs/AUDITORIA_Y_SOLUCIONES_CAJA_Y_CIERRES.md` y `tocineta-1.0.1.sig`. No se tocaron (ver §7).

---

## 1. Mapa commits → prompts

| Commit | Fecha | Asunto | Prompt | Confianza |
|---|---|---|---|---|
| `2ddf1c8` | 2026-11-13 | fix(apk): listar todos los bondedDevices sin filtro de clase y solicitar permiso Bluetooth en Ajustes | Extra | Confirmado por el encargo |
| `2bf1120` | 2026-11-14 | fix(go-live): baja de empleados oculta REJECTED y libera username | A1 | Inferido |
| `804446a` | 2026-11-14 | fix(go-live): normalizar locationId ALL en finanzas | A2 | Confirmado |
| `75630a3` | 2026-11-14 | fix(go-live): compras a crédito generan deuda y contado entra al flujo | A3 | Confirmado |
| `c2a3be5` | 2026-11-14 | fix(go-live): cortar bucle de refresco en dispositivos conectados | B1 | Confirmado |
| `7d01184` | 2026-11-14 | fix(go-live): scroll móvil en POS y wizard | B2 | Confirmado |
| `9886ce5` | 2026-11-14 | feat(go-live): descarga y apertura de archivos en la APK | B3 (`saveAndOpenFile`) | Inferido |
| `9d9c64a` | 2026-11-14 | feat(go-live): selector de archivos en la APK | B3 (segundo commit) o B4 | Inferido |
| `ac3f787` | 2026-11-14 | fix(go-live): nota de entrega usa eslogan y marca configurados | C1 | Inferido |
| `3e7f176` | 2026-11-14 | feat(go-live): cargador de logo y título correcto en identidad de marca | C2a | Confirmado |
| `8ead00a` | 2026-11-14 | feat(go-live): generador del logo térmico | C2b | Confirmado |
| `4bee825` | 2026-11-15 | feat(go-live): total por estación, bebidas y despacho solo-bebida en comandas | C3 | Inferido |
| `74447b7` | 2026-11-15 | fix(go-live): botón Personalizar sólido y táctil | D1 | Confirmado |
| `f92ada7` | 2026-11-15 | fix(go-live): DIOS en mayúscula en textos y datos | D2 | Confirmado |
| `96e230f` | 2026-11-15 | feat(go-live): controles fijos en móvil en catálogo y finanzas | D3 | Confirmado |
| `86a29bd` | 2026-11-15 | fix(go-live): descuento de inventario exacto por modificadores y recetas | E1 | Inferido |
| `6084354` | 2026-11-15 | feat(go-live): merma de plato descuenta ingredientes de su receta | E2 | Confirmado |
| `5ba9b09` | 2026-11-15 | feat(go-live): sincronizar costo estimado del plato con su receta | E3 | Confirmado |
| `31e386a` | 2026-11-15 | feat(go-live): crear producto de venta con receta en una acción | E4 | Inferido |
| `e44c246` | 2026-11-15 | feat(go-live): P&L con costo de ventas, mermas y compras separadas | E5 | Inferido |
| `73c9495` | 2026-11-15 | test(go-live): ciclo gastronómico completo y alerta de recetas incompletas | E6 | Confirmado |
| `573a64f` | 2026-11-15 | docs(go-live): auditoría de módulos pendientes | F1 (auditoría de cierre, sin código) | Inferido |

**Notas del mapa**

- `9d9c64a` (selector de archivos para subir) es un cambio distinto de `saveAndOpenFile` (descarga y apertura). Si B3 era solo `saveAndOpenFile`, ese commit pertenece a un B4 no listado.
- No hay un commit de código identificable para F1. El único candidato es `573a64f`, que solo agrega `docs/AUDITORIA-MODULOS-14NOV.md`. Si F1 era otra tarea, quedó sin commit en esta rama.
- Los commits posteriores a `573a64f` (`4200306` a `0a6118e`) ya pertenecen a la siguiente tanda de trabajo (remediación de la auditoría) y **no** se revisan aquí. Los 17 commits locales sin publicar empiezan en `342f85d`.

---

## 2. Hallazgos

### 2.a E3 (`5ba9b09`): el `COALESCE`/`NULLIF` del costo no estaba pedido

**Qué cambió**

El commit agrega `NULLIF` a la lectura del costo del insumo en tres lugares:

| Archivo:línea | Consulta | Uso |
|---|---|---|
| `apps/server/src/modules/profitability/recipes-service.ts:77` | `COALESCE(NULLIF(s.weighted_avg_cost_usd_cents, 0), s.cost_per_unit_usd_cents, 0)` | `getSubRecipes()` — costo unitario de cada insumo de una sub-receta |
| `apps/server/src/modules/profitability/recipes-service.ts:180` | `SELECT COALESCE(NULLIF(weighted_avg_cost_usd_cents, 0), cost_per_unit_usd_cents, 0)` | `saveSubRecipe()` — cálculo del costo de la sub-receta al guardarla |
| `apps/server/src/modules/profitability/recipes-service.ts:232` | `COALESCE(NULLIF(s.weighted_avg_cost_usd_cents, 0), s.cost_per_unit_usd_cents, 0) as supply_unit_cost` | `getProductRecipe()` — costo unitario con el que se calcula el costo del plato |

**¿Cambia los costos de recetas con WAC 0? Sí, y de forma deliberada**

- `weighted_avg_cost_usd_cents` es `NOT NULL DEFAULT 0` (`apps/server/src/db/migrations/0023_locations_and_fase3_inventory.sql:63`), no `NULL`. Por eso el `COALESCE` anterior nunca caía en `cost_per_unit_usd_cents`: devolvía `0`.
- El seed de insumos (`apps/server/src/modules/profitability/inventory.ts:54-82`) inserta `cost_per_unit_usd_cents` pero **no** fija `weighted_avg_cost_usd_cents`; queda en `0` hasta la primera compra. Con el SQL anterior, todo insumo nunca comprado costaba `0` en las recetas.
- Con `NULLIF`, un WAC `0` se trata como “sin WAC” y se usa `cost_per_unit_usd_cents`. Esto es coherente con los otros módulos, que ya usaban el fallback a nivel JS: `purchases-service.ts:148`, `waste-service.ts:123`, `transfers-service.ts:135`, `recipes-service.ts:286`.
- Impacto medido en `apps/server/data/tocineta.db`: 22 insumos, de los cuales **10 tienen WAC 0 y costo unitario > 0**. En recetas directas, solo **1 ítem** se ve afectado hoy (`Americana Deluxe` con `Salchicha Polaca Ahumada`, +60 centavos). En sub-recetas, 0 ítems. En una base recién sembrada el impacto sería mucho mayor: todos los insumos del seed tienen WAC 0, así que todas las recetas sembradas pasarían de costo 0 a costo real.

**¿Hay test que lo cubra? No**

- `apps/server/test/product-cost-sync.test.ts` (170 líneas) prueba la sincronización de `estimated_cost_usd_cents` y que `price_usd_cents` no cambia, pero **nunca** fija `weighted_avg_cost_usd_cents = 0` ni verifica la rama `NULLIF`. La primera aserción de costo (`L56-60`) solo compara contra el costo calculado, sea 0 o no.
- No hay ninguna coincidencia de `NULLIF` en `apps/server/test/`.

**¿Es el comportamiento correcto?** La dirección es correcta y probablemente era necesaria para que E3 no escribiera costos 0 en todos los platos sembrados. El riesgo residual es bajo: un insumo con costo real 0 (donación) y `cost_per_unit_usd_cents > 0` usaría el costo de lista; en la práctica `registerPurchase()` sobrescribe ambos campos con el costo de la compra (`purchases-service.ts:159-177`), así que el caso es raro.

**Inconsistencia menor detectada:** `apps/server/src/modules/profitability/fase3-routes.ts:113` sigue usando `COALESCE(s.weighted_avg_cost_usd_cents, s.cost_per_unit_usd_cents, 0)` sin `NULLIF`. El campo `effective_cost_cents` de `GET /api/fase3/supplies` devuelve 0 para esos 10 insumos. La web se salva porque además lee `weightedAvgCostUsdCents`, que sí trae el fallback (`fase3-routes.ts:142`), pero el contrato de la API queda engañoso.

**Severidad:** media (cambio de dinero no solicitado y sin test; la dirección es correcta).
**Acción sugerida:** mantener el cambio, agregar un test que fije WAC 0 con costo > 0 y verifique el costo del plato; documentarlo en la bitácora; evaluar `NULLIF` en `fase3-routes.ts:113` para que el contrato sea consistente.

---

### 2.b E1 (`86a29bd`): alcance del diff y migración 0045

**¿Se tocó algo fuera de `deductInventoryForOrder` / `revertInventoryForOrder`?**

No. El diff de `recipes-service.ts` tiene solo cuatro hunks:

- `@@ -3,6 +3,7 @@` — agrega `import { appendAuditEvent }` (`recipes-service.ts:6`).
- `@@ -387,58 +388,53 @@ export function deductInventoryForOrder` — reindentación y nuevo `try/catch`.
- `@@ -446,111 +442,203 @@ export function deductInventoryForOrder` — lógica de modificadores, GAP y stock negativo.
- `@@ -577,7 +665,16 @@ export function revertInventoryForOrder` — idempotencia de la reversión.

Las 351 líneas que reporta `git show --stat` se explican casi todas por la reindentación de los dos bloques completos dentro del `try`; no hay cambios en `getProductRecipe`, `saveProductRecipe`, `getSubRecipes` ni en ningún otro export. El único cambio funcional fuera de las dos funciones es el import de auditoría.

**¿La migración 0045 sembró los 7 enlaces con IDs reales?**

- La migración `apps/server/src/db/migrations/0045_ingredient_supply_map.sql:6-31` inserta 7 pares con `INSERT OR IGNORE ... SELECT ... WHERE EXISTS (SELECT 1 FROM supply_items WHERE id = 'sup_...')`.
- Los 7 IDs de ingrediente existen en el seed: `ing_base_pan_perro`, `ing_base_pan_brioche`, `ing_base_carne_smash`, `ing_base_tocineta`, `ing_base_salchicha_pollo`, `ing_base_salchicha_polaca`, `ing_base_pechuga_crispy` (`apps/server/src/db/seed-catalog.ts:64-79`). Los 7 IDs de insumo existen en `apps/server/src/modules/profitability/inventory.ts:16-23`.
- En la base de trabajo `apps/server/data/tocineta.db` la tabla tiene exactamente esos 7 pares. En `tocineta.test.db` hay 7 + 6 filas personalizadas de tests. **En una base ya poblada, sí sembró los 7 enlaces correctos.**

**Pero en una base nueva no siembra ninguno.** El orden de arranque es:

1. `runMigrations()` — `apps/server/src/index.ts:112` (y `apps/server/src/db/fresh-prod.ts:73`).
2. `seedCatalog()` — `apps/server/src/index.ts:146` (y `fresh-prod.ts:82`).
3. `seedCriticalSuppliesAndRecipes()` **no se llama al arrancar**: se invoca de forma perezosa desde las rutas de rentabilidad (`apps/server/src/modules/profitability/routes.ts:128,139,171,328`).

Cuando la migración 0045 se ejecuta en una base nueva, `supply_items` está vacía; los 7 `WHERE EXISTS` son falsos y la tabla queda con 0 filas. Después se siembran los insumos, pero la migración ya pasó y no se vuelve a ejecutar. El test de E1 repite ese orden (`apps/server/test/inventory-deduction-modifiers.test.ts:24-28`) y no verifica que la migración haya dejado los 7 enlaces; el test k inserta su propia fila a mano (`L464-474`). La heurística de respaldo de `recipes-service.ts:626-641` cubre los 7 IDs conocidos, así que el descuento por modificador sigue funcionando en el caso base, pero el mapa queda vacío y cualquier ingrediente nuevo o personalizado no se mapea.

**Hallazgo adicional (silenciamiento de errores):** el nuevo `try/catch` de `deductInventoryForOrder` termina en `apps/server/src/modules/profitability/recipes-service.ts:739-741` con un `console.warn`. Si la deducción falla (por ejemplo, un error de BD), la venta continúa sin descontar inventario y sin un evento de auditoría de fallo; solo queda un mensaje de consola. El `revertInventoryForOrder` tiene el mismo patrón en `L837`.

**Severidad:** media.
**Acción sugerida:** sembrar el mapa de forma idempotente después de `seedCriticalSuppliesAndRecipes()` (o en un bootstrap posterior al seed), agregar un test que migre una base vacía, siembre y exija 7 filas; registrar el fallo de deducción en auditoría/`server_errors` en lugar de solo `console.warn`.

---

### 2.c `2ddf1c8`: commit extra, bucle de refresco y flujo Bluetooth

**Naturaleza del commit**

No estaba pedido y toca 7 archivos: `MainActivity.kt`, `NativeBridge.kt`, `PermissionHelper.kt`, `PrinterSession.kt`, `ConnectedTerminalsCard.tsx`, `DevicePrinterCard.tsx` y `mobile-print-bridge.ts` (132 inserciones, 30 borrados).

**¿Reintrodujo el bucle de refresco de B1?**

Cronológicamente, no: `2ddf1c8` es del 13 de noviembre y B1 (`c2a3be5`) del 14. Lo que hizo `2ddf1c8` fue **introducir** el mecanismo del bucle que B1 vino a cortar:

- `2ddf1c8` agregó `refreshState` con dependencias `[onPrinterConfigured, queryClient]`, un `useEffect` que depende de `refreshState` y una llamada a `onPrinterConfigured?.()` dentro de `refreshState` tras invalidar `['terminalsList']`.
- El padre le pasaba `onPrinterConfigured={() => void refetch()}` (función nueva en cada render). Secuencia: refreshState → invalidate + refetch del padre → re-render → nueva función → nuevo refreshState → effect → refreshState… bucle.
- B1 eliminó la llamada a `onPrinterConfigured?.()` de `refreshState` y memoizó el callback en el padre con `useCallback`.

En **HEAD actual no hay bucle**: `DevicePrinterCard.tsx:37-58` define `refreshState` con dependencia solo de `queryClient`; `L60-64` lo ejecuta al montar y cuando cambia `refreshTrigger`; el padre usa `handlePrinterConfigured` memoizado (`ConnectedTerminalsCard.tsx:59-61`) y solo incrementa `refreshTrigger` en el botón manual (`L54-57`). Queda una ineficiencia menor: al seleccionar impresora, `handleSelect` (`DevicePrinterCard.tsx:73-75`) llama a `refreshState()`, invalida `['terminalsList']` y además invoca `onPrinterConfigured?.()`, lo que produce hasta tres refetch de la misma lista. No es un bucle, pero es trabajo redundante.

**Qué cambia en el flujo Bluetooth**

- `listPairedPrinters` ahora **lista todos los dispositivos vinculados**, sin filtro de clase (`PrinterSession.kt:160-179`): filtra MAC vacía, captura `SecurityException` al leer el nombre, usa `"Dispositivo (MAC)"` como respaldo y ordena por nombre.
- `getCapabilities().bluetoothSpp` ya no es siempre `true`: depende de que exista adaptador (`PrinterSession.kt:264` con `hasAdapter()`).
- `listPairedPrinters` y `getBluetoothStatus` solicitan el permiso de Bluetooth desde el hilo principal (`NativeBridge.kt:143-144`, `170-171`, `189-198`). En HEAD hay un guardia de un solo disparo (`permissionPromptShown`, `L50` y `L192-195`), agregado en la tanda siguiente (`4200306`, fuera de la ronda 1).
- El estado nativo devuelve `permission` además de `enabled`/`connected` (`NativeBridge.kt:173`); el puente web lo normaliza a `hasPermission` + `permission` (`apps/web/src/lib/mobile-print-bridge.ts:107-118`) y la tarjeta exige ambos (`DevicePrinterCard.tsx:92`).
- La UI agrega los avisos de “Sin permiso” y “Bluetooth apagado”, el botón “Actualizar lista Bluetooth”, el latido al seleccionar y la invalidación de `['terminalsList']`.

**Riesgos**

- Al listar todos los dispositivos vinculados, el usuario puede seleccionar audífonos, un teclado o un manos libres como “impresora”. La selección se acepta y el fallo aparece recién al imprimir. No hay validación de que el dispositivo sea SPP ni una prueba de impresión obligatoria antes de guardar.
- El permiso se pide al abrir la tarjeta (por `getBluetoothStatus`), no solo al elegir impresora; el guardia evita repeticiones, pero si el usuario deniega una vez no se le vuelve a preguntar hasta reiniciar la app.
- `hasNativePrinting()` cambió de `Boolean(window.TocinetaNative)` a `typeof window.TocinetaNative !== 'undefined'` (`mobile-print-bridge.ts:182`). Si alguna página define `TocinetaNative = null`, ahora se considera nativo y se intentan llamar métodos ausentes. Caso poco probable, pero es un cambio de contrato no documentado.

**Severidad:** baja (el bucle ya está corregido en HEAD) / media por el riesgo de seleccionar un dispositivo no imprimible.
**Acción sugerida:** no tocar el código por este informe; documentar que B1 es la corrección del bucle y evitar callbacks inline en `DevicePrinterCard`; si se quiere endurecer, filtrar por clase de dispositivo o exigir “Imprimir prueba” correcta antes de guardar la selección; agregar un test de la lista con dispositivos no imprimibles.

---

### 2.d A3 (`75630a3`): la ruta legada responde 410

**Evidencia**

- `apps/server/src/modules/profitability/routes.ts:582-584`:
  `fastify.post('/api/profitability/purchases', ... reply.status(410).send({ error: 'Ruta obsoleta: use /api/fase3/purchases' }))`.
- La ruta nueva es `POST /api/fase3/purchases` (`apps/server/src/modules/profitability/fase3-routes.ts:393`), que usa `registerPurchase()`.

**¿Algún test o pantalla la usa todavía?**

- No hay ninguna pantalla que la use. La web llama exclusivamente a la ruta nueva:
  - `apps/web/src/features/profitability/PurchasesView.tsx:39` (`GET /api/fase3/purchases`).
  - `apps/web/src/features/profitability/components/NewPurchaseModal.tsx:77` (`POST /api/fase3/purchases`).
- El único test que menciona la ruta vieja es el que exige el 410: `apps/server/test/purchases-credit-cash.test.ts:233-248`.
- `docs/auditoria/ESTADO-F3.md:75` todavía documenta `POST /api/profitability/purchases` como endpoint vigente; es documentación obsoleta, no un consumidor.

**Observaciones**

- El `GET /api/profitability/purchases` legado sigue vivo (`routes.ts:547-580`) y no tiene consumidores conocidos; es código muerto o una segunda fuente de verdad del listado. No es un bug, pero conviene decidir si se elimina o se marca obsoleto.
- Un cliente viejo (PWA cacheada o APK con bundle antiguo) que haga `POST` a la ruta legada recibirá 410 sin fallback. Es el comportamiento buscado, pero implica que la actualización del cliente es obligatoria.

**Severidad:** baja.
**Acción sugerida:** ninguna corrección urgente; actualizar `docs/auditoria/ESTADO-F3.md` y decidir el destino del `GET` legado.

---

### 2.e B3 (`9886ce5`): `saveAndOpenFile` — tamaño, sanitización y timeout

**Timeout de 60 s: sí, solo para ese método**

- `android-terminal/app/src/main/java/com/tocineta/terminal/bridge/BridgeScript.kt:63-64`: `invoke()` usa 15 000 ms por defecto.
- `BridgeScript.kt:123-125`: `saveAndOpenFile` llama a `invoke('saveAndOpenFile', args || {}, 60000)`.
- Los demás métodos (`getCapabilities`, `printEscPos`, `listPairedPrinters`, etc.) no pasan timeout y quedan en 15 s.
- El test lo fija: `android-terminal/app/src/test/java/com/tocineta/terminal/bridge/BridgeScriptTest.kt:117-122` exige `saveAndOpenFile` y `60000` en el script.

**Límite de tamaño**

- `NativeBridge.kt:34`: `MAX_BASE64_LENGTH = 35 * 1024 * 1024` caracteres (≈26,2 MB binarios).
- `NativeBridge.kt:215-218`: rechaza el base64 que supere ese largo.
- `NativeBridge.kt:232-235`: tras decodificar, rechaza si `bytes.size > 25 * 1024 * 1024`.
- **No hay validación en el cliente antes de convertir a base64.** `apps/web/src/lib/download-file.ts:52-58` convierte el `Blob` completo con `FileReader.readAsDataURL` y recién después el nativo rechaza. Un archivo de 30 MB se carga entero en memoria (blob + string base64 de ~40 MB) y el usuario ve el error después de la transferencia. En un teléfono de gama baja esto puede congelar el WebView o agotar memoria antes del límite nativo.

**Sanitización del nombre**

`NativeBridge.kt:36-43`:

- Reemplaza `\` por `/`, toma el basename con `substringAfterLast('/')`.
- Elimina todas las apariciones de `..` en un bucle.
- Quita `/` y `\`, recorta espacios.
- Si queda vacío o `.`, usa `archivo_descargado`.

Lo que **no** hace: quitar caracteres reservados o de control (`:*?"<>|`, `\u0000`), limitar el largo, evitar nombres que empiecen por punto, ni garantizar una extensión coherente con el MIME. En Android `MediaStore.Downloads.DISPLAY_NAME` suele tolerar la mayoría, pero un nombre con caracteres raros puede hacer fallar el `insert` o quedar oculto. Tampoco se valida que `fileName` no sea una ruta absoluta (el basename ya la neutraliza).

**Otros detalles**

- En Android 8/9 (`minSdk = 26`, `android-terminal/app/build.gradle.kts:24`) el archivo se escribe en el directorio externo privado de la app (`NativeBridge.kt:270-283`), no en Descargas públicas. Se abre vía `FileProvider`, pero el usuario no lo encuentra en el explorador de archivos; el mensaje de la UI no aclara esa diferencia.
- `openFileUri()` devuelve `false` si no hay app para el MIME (`NativeBridge.kt:290-303`), pero el resultado sigue siendo `{"ok":true,"opened":false}` y `download-file.ts:54` ignora `opened`: el usuario no recibe aviso de que el archivo no se abrió.
- En Android < Q, `targetFile.writeBytes(bytes)` sobrescribe si el nombre coincide; en Q+ `MediaStore` puede renombrar automáticamente. Comportamiento inconsistente entre versiones.

**Severidad:** media por la falta de límite en cliente y la sanitización incompleta; baja por el timeout (está bien acotado) y por el detalle de `opened`.
**Acción sugerida:** en `downloadWithAuth()`, comprobar `blob.size` contra 25 MB antes de `blobToBase64()` y devolver un error claro; endurecer `sanitizeFileName` con una lista blanca de caracteres y límite de longitud; usar `opened` para avisar; agregar tests unitarios de sanitización y de tamaño (hoy solo se prueba el timeout del script).

---

### 2.f C3 (`4bee825`): la estación del ticket ya no se deduce por `productName`

**Respuesta: sí, ya no se deduce por `productName` en `worker.ts`.**

- El código anterior, eliminado en `4bee825`, recorría los bloques `line_item` del ticket y buscaba `kitchenLines.find(l => l.productName === block.name)` para decidir la estación. Ese bloque ya no existe en `apps/server/src/modules/printing/worker.ts`.
- Ahora `enqueueOrderPrintJobs()` obtiene las líneas de bebida (`worker.ts:705`), construye los trabajos con `buildKitchenTicketJobs()` (`worker.ts:706`) y usa la estación que devuelve cada trabajo (`worker.ts:710`, persistida en `worker.ts:725`).
- La estación se asigna explícitamente en `buildKitchenTicketJobs()` (`apps/server/src/modules/printing/templates.ts:631-666`): `hamburguesas`, `hot_dogs` o `caja_bebidas` según el caso, no según el nombre del producto. El origen de la estación es `ol.station` de la línea (`apps/server/src/modules/orders/kitchen-queries.ts:61`), que a su vez viene del producto al crear la orden.
- Queda un caso de respaldo (`templates.ts:654-659`) que usa `kitchenLines[0].station || 'hamburguesas'` para platos de cocina no clasificados; no usa el nombre.
- Cobertura: `apps/server/test/kitchen-ticket-totals.test.ts` verifica la estación en los jobs (`L81`, `L161`, `L222`, `L327-328`), en la base (`L467`, `L510-513`) y los totales por estación.

**Severidad:** ninguna (comportamiento correcto y cubierto).
**Acción sugerida:** ninguna.

---

## 3. Otros hallazgos menores

| Hallazgo | Evidencia | Severidad | Acción |
|---|---|---|---|
| El campo `effective_cost_cents` de `GET /api/fase3/supplies` no usa `NULLIF` y devuelve 0 para insumos con WAC 0 y costo > 0 | `apps/server/src/modules/profitability/fase3-routes.ts:113` | baja | Unificar con la semántica de E3 o documentar que es un campo legado |
| El `GET /api/profitability/purchases` legado sigue registrado sin consumidores conocidos | `apps/server/src/modules/profitability/routes.ts:547-580` | baja | Eliminar o marcar obsoleto en una tarea aparte |
| Documentación que aún describe el POST legado como vigente | `docs/auditoria/ESTADO-F3.md:75` | baja | Actualizar el documento |
| La deducción de inventario falla en silencio (solo `console.warn`) | `apps/server/src/modules/profitability/recipes-service.ts:739-741` y `L837` | media | Registrar el fallo en auditoría/`server_errors` y decidir si debe bloquear el cobro |
| `2ddf1c8` permite seleccionar cualquier dispositivo vinculado como impresora, sin validar SPP | `android-terminal/app/src/main/java/com/tocineta/terminal/bt/PrinterSession.kt:160-179`; `apps/web/src/features/settings/DevicePrinterCard.tsx:141-157` | media | Validar con “Imprimir prueba” o filtrar por clase antes de guardar |
| `download-file.ts` ignora el campo `opened` de la respuesta nativa | `apps/web/src/lib/download-file.ts:54` | baja | Avisar al usuario si `opened === false` |

---

## 4. Resumen de severidades

| ID | Hallazgo | Severidad | Acción sugerida |
|---|---|---|---|
| E3-1 | `NULLIF` no pedido, cambia costos con WAC 0, sin test | media | Mantener y cubrir con test; documentar |
| E1-1 | La migración 0045 no siembra los 7 enlaces en una base nueva | media | Sembrar el mapa tras el seed; test de base vacía |
| E1-2 | Errores de deducción silenciados | media | Auditoría/`server_errors`; decidir bloqueo |
| 2DDF-1 | `2ddf1c8` originó el bucle; B1 lo corrigió | baja | No reintroducir callbacks inline |
| 2DDF-2 | Lista todos los dispositivos vinculados sin validar SPP | media | Validar impresora o filtrar por clase |
| A3-1 | Ruta 410 sin consumidores; `GET` legado muerto | baja | Limpiar/documentar |
| B3-1 | Sin límite de tamaño en cliente antes de base64 | media | Validar `blob.size` antes de convertir |
| B3-2 | Sanitización de nombre incompleta | baja | Lista blanca y límite de largo |
| C3-1 | Estación por `ol.station`; sin deducción por nombre | ninguna | Ninguna |

---

## 5. Respuestas directas al cuestionario

1. **E3 / WAC 0:** sí cambia los costos; un WAC 0 deja de costar 0 y pasa a usar `cost_per_unit_usd_cents`. No hay test. La dirección es correcta y coherente con el resto del backend, pero el cambio no estaba pedido y altera cifras de dinero sin cobertura.
2. **E1 / alcance:** el diff de 351 líneas solo toca `deductInventoryForOrder`, `revertInventoryForOrder` y el import de auditoría. La migración 0045 tiene los 7 enlaces con IDs reales y los sembró en la base ya poblada, pero **no** los siembra en una base nueva por el orden migraciones → seed.
3. **2ddf1c8 / bucle:** no lo reintrodujo después de B1; fue su origen y B1 lo corrigió. En HEAD no hay bucle. Sí cambia el flujo Bluetooth: lista todos los dispositivos vinculados, pide permiso al abrir la tarjeta y usa `hasAdapter()` para las capacidades.
4. **A3 / 410:** ningún test ni pantalla usa la ruta legada; solo el test que exige el 410. La web usa `/api/fase3/purchases`. Queda un `GET` legado sin consumidores.
5. **B3 / `saveAndOpenFile`:** el timeout de 60 s está aplicado solo a ese método (el resto usa 15 s). El límite nativo es 35 MB de base64 / 25 MB de binario, pero el cliente no valida antes de convertir. La sanitización neutraliza rutas y `..`, pero no caracteres reservados, largo ni extensión.
6. **C3 / estación:** sí, la estación del ticket ya no se deduce por `productName`; sale de `ol.station` y de `buildKitchenTicketJobs()`.

---

## 6. Recomendaciones priorizadas (sin ejecutar)

1. Agregar un test de costo de receta con `weighted_avg_cost_usd_cents = 0` y `cost_per_unit_usd_cents > 0`.
2. Corregir el sembrado de `ingredient_supply_map` en bases nuevas (idempotente, después del seed de insumos) y cubrirlo con un test de base vacía.
3. Validar el tamaño del archivo en `downloadWithAuth()` antes de `blobToBase64()` y endurecer `sanitizeFileName`.
4. Registrar en auditoría los fallos de deducción de inventario en lugar de solo `console.warn`.
5. Decidir el destino del `GET /api/profitability/purchases` legado y actualizar `docs/auditoria/ESTADO-F3.md`.
6. Evitar callbacks inline en `DevicePrinterCard` y considerar validar la impresora con una prueba real antes de guardarla.

---

## 7. Verificación de git

**Antes de crear este informe:**

```
$ git status --porcelain
?? baseline-clean.txt
?? docs/AUDITORIA_Y_SOLUCIONES_CAJA_Y_CIERRES.md
?? tocineta-1.0.1.sig
```

**Después de crear este informe:** se agrega `?? docs/REVISION-RONDA-1.md` a esa lista. No se modificó ningún archivo rastreado ni se tocaron los tres no rastreados preexistentes.

El commit de este informe se hizo con ruta explícita:

```
git commit -m "docs(go-live): revisión de commits de la ronda 1" -- docs/REVISION-RONDA-1.md
```

Nota: la instrucción “git status debe mostrar solo `docs/REVISION-RONDA-1.md`” no se puede cumplir literalmente sin borrar o mover los tres archivos no rastreados que ya existían antes de la tarea. Borrarlos queda fuera del alcance de esta revisión; se dejan intactos y se reportan aquí.

---

## 8. Límites de esta revisión

- No se ejecutaron suites de test ni el build de Android; no se validó el estado verde de la rama.
- La conclusión sobre la migración 0045 en base nueva es estática (orden de arranque + SQL); no se creó una base nueva para reproducirla.
- El impacto de E3 se midió sobre `apps/server/data/tocineta.db`, que es un snapshot de trabajo y puede no coincidir con producción.
- La asignación de prompts A1, B3/B4, C1, C3, E1, E4, E5 y F1 es inferida; el repositorio no contiene el texto de los prompts.
