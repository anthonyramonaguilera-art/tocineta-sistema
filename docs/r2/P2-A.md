# P2-A — Datos: dos sedes oficiales y jornada global única

**Chat nuevo.** Lee `docs/r2/01-REGLAS-DEL-AGENTE.md` y `docs/r2/00-PLAN-MAESTRO.md` (§2 causas 5 y 6, §4 D1 y D7). Requiere P0-B.
**Defectos:** B13, B28. **Alcance:** solo servidor y migración. Sin pantallas.

## Objetivo
Que existan exactamente dos sedes y exactamente una jornada abierta en todo el negocio, de forma que ningún arranque ni código pueda deshacerlo.

## Hechos verificados (confirma con grep)
- `apps/server/src/modules/profitability/locations-service.ts` (líneas ~15-40): `OFFICIAL_LOCATIONS` incluye una tercera fila `sede_alta_vista` ("Sede B: Alta Vista (Alias)") y `ensureOfficialLocations()` hace `INSERT OR IGNORE` de las tres. Se invoca en `src/index.ts:38`, en `getAllLocations` y en `setup-wizard-service.ts:325`. **Por eso una migración que la borre se deshace al reiniciar.**
- Fallbacks que la mantienen viva: `cashier-service.ts:769` (`order.location_id || 'sede_alta_vista'`), `incidents-service.ts:300`, `staff/tips-routes.ts:136`, `profitability/recipes-service.ts:523`.
- `jornadas` (migración `0002`) solo tiene `idx_jornadas_status` (no único). `getCurrentJornada` (`cashier-service.ts:~202`) hace `SELECT * FROM jornadas WHERE status='abierta'` **sin ORDER BY**. La columna `jornadas.location_id` existe.
- `cash_sessions` es por usuario y tiene `location_id`; `getCurrentCashSession(rawDb, userId)` filtra por usuario.
- El Panel de la Dueña muestra "Turno Abierto" por sede (foto): modelo antiguo de turno por sede.
- No asumas el contenido de la BD real: la copia de desarrollo difiere de la del teléfono.

## Tareas
1. **Quitar el alias del código.** `OFFICIAL_LOCATIONS` = solo `loc_los_olivos` y `loc_alta_vista`. `ensureOfficialLocations` solo asegura esas dos y no revive nada.
2. **Migración nueva** (numérala tras la última existente):
   - Descubre con `sqlite_master`/`PRAGMA table_info` **todas** las tablas con columna `location_id` (y cualquier columna que referencie `locations`) y reasigna `'sede_alta_vista'` → `'loc_alta_vista'` en cada una. Luego `DELETE FROM locations WHERE id='sede_alta_vista'`. Todo en una transacción con `foreign_keys=ON` (hijos primero, padre al final). Idempotente.
   - Antes de aplicar, la migración usa el mecanismo de snapshot automático que ya existe.
3. **Eliminar los 4 fallbacks silenciosos.** Crea `resolveLocationId(rawDb, candidate?)` (en `profitability/locations-service.ts`): el candidato debe existir y estar activo; si falta → `AppError('LOCATION_REQUIRED', 400, …, 'locationId')`. Orden de resolución para órdenes POS: `location_id` enviado por el cliente → sede asignada al usuario (`user_locations`) → error claro. Nunca un literal.
4. **Jornada global única (D1).**
   - Migración: si hay más de una jornada `abierta`, **conserva la más reciente** y cierra automáticamente solo las que tengan 0 órdenes y 0 pagos (nota `cerrada por migración R2`). Si alguna otra tiene actividad, **aborta con un mensaje que la identifique** y no la toques (decide el usuario).
   - Después: `CREATE UNIQUE INDEX ux_jornada_abierta ON jornadas(status) WHERE status='abierta'`.
   - `getCurrentJornada`: `ORDER BY opened_at_ms DESC LIMIT 1`.
   - Abrir jornada es **idempotente**: si ya hay una abierta, devuelve esa (no error, no duplica).
   - `jornadas.location_id` queda como columna heredada sin uso (no se elimina; documenta en `LIBRO-DE-REGLAS.md`).
5. **Sesiones de caja dentro de la jornada global:** `cash_sessions.jornada_id` siempre es la jornada global abierta. Una caja por cajera; no se crean sesiones sin jornada abierta.
6. **Pruebas** (`apps/server/test/r2-sedes-jornada.test.ts`, BD temporal):
   - Arrancar el servidor dos veces → `SELECT count(*) FROM locations` = 2.
   - Dos aperturas seguidas → 1 jornada abierta; el índice único rechaza una inserción directa.
   - Migración con datos sembrados en `sede_alta_vista` → quedan en `loc_alta_vista`, sin filas huérfanas (`PRAGMA foreign_key_check` vacío).
   - `resolveLocationId` sin candidato ni sede de usuario → error `LOCATION_REQUIRED`.

## Prohibido
- Tocar `closures-service.ts` (cadena SHA-256), `money.ts`, impresión, outbox.
- Borrar datos de ventas. La limpieza de datos de prueba es P6-A.
- Volver a introducir un literal `'sede_alta_vista'` o `'loc_alta_vista'` como valor por defecto en servicios.

## Criterios de aceptación
- `grep -rn "sede_alta_vista" apps packages` solo encuentra la migración de reasignación y sus pruebas.
- B13 y B28 en verde en `defects.json` (el selector de sede lista 2; hay 1 jornada).
- `PRAGMA foreign_key_check` vacío sobre la BD de prueba migrada.
- 238+ pruebas verdes; lint y build verdes.

## Entrega
Según §6. En el informe: nombre de la migración, qué tablas reasignó y cuántas filas por tabla en la BD de prueba.
