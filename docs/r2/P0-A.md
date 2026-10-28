# P0-A — Red de seguridad: respaldo, BD de pruebas aislada y manejo global de errores

**Chat nuevo.** Lee primero `docs/r2/01-REGLAS-DEL-AGENTE.md` y `docs/r2/00-PLAN-MAESTRO.md` (§2 causa 7 y §4).
**Alcance:** solo servidor y herramientas. No toques pantallas. Tamaño esperado: pequeño.

## Objetivo
Dejar el proyecto en un punto de retorno seguro, impedir que pruebas ensucien la base real y hacer que cualquier error del servidor llegue como JSON claro y quede registrado.

## Hechos verificados (confírmalos con `grep` antes de editar)
- No existe `setErrorHandler` en `apps/server/src` (solo `setNotFoundHandler` en `plugins/static.ts`). Todo `throw new Error` sale como "Internal Server Error".
- `apps/server/src/db/connection.ts` fija la ruta de la BD y los PRAGMAs sagrados.
- Ya existe la migración `0022_client_errors_and_blind_closure.sql` con tabla `client_errors`. Hay 28 archivos en `apps/server/src/db/migrations/`; el último que vi es `0027_fase7_quotes_partners_settings.sql`. Revisa el nombre real del último archivo antes de numerar el nuevo.
- Las pruebas están en `apps/server/test/*.test.ts`. Existe `apps/server/test/db-pragmas.test.ts`.
- `.gitignore` debe excluir `data/*.db*`, `data/backups`, `data/snapshots` y `.env`. Verifícalo.

## Tareas
1. **Punto de retorno.**
   - `git status` limpio (si no, commit o stash de lo pendiente y repórtalo).
   - Copia consistente de la BD con la API `.backup()` de better-sqlite3 (no con `cp`, hay WAL) hacia `data/backups-r2/pre-r2-<fecha>/tocineta.db`. Verifica con `PRAGMA integrity_check`.
   - `git tag pre-r2`.
2. **BD de pruebas aislada.**
   - `connection.ts` puede leer `process.env.TOCINETA_DB_PATH` para la **ruta** de la BD. No se modifica ningún PRAGMA ni la lógica de apertura. `db-pragmas.test.ts` debe seguir verde sin cambios.
   - Añade una guarda en el arranque de pruebas (setup de Vitest): si `NODE_ENV==='test'` y la ruta resuelve a `data/tocineta.db`, abortar con mensaje claro. Todas las pruebas existentes deben usar BD temporal; si alguna usa la real, corrígela.
3. **Manejador global de errores** (`setErrorHandler`):
   - Clase `AppError(code, httpStatus, message, field?)` en `apps/server/src/lib/app-error.ts`.
   - Respuesta: `{ success:false, error:<mensaje humano>, code, message, field?, requestId }`. Mantén `error` como string para no romper pantallas que ya lo leen.
   - Mapeo de errores de SQLite: `FOREIGN KEY constraint failed` → 409 `REFERENCE_MISSING`; `UNIQUE constraint failed` → 409 `DUPLICATE`; `CHECK constraint failed` → 422 `INVALID_VALUE`; `NOT NULL constraint failed: tabla.columna` → 422 `FIELD_REQUIRED` con `field` = columna. Errores de validación Fastify → 400 `VALIDATION_ERROR`. Lo demás → 500 `INTERNAL` con mensaje genérico y `requestId`.
   - Nunca enviar stack ni SQL al cliente.
4. **Tabla `server_errors`** (nueva migración numerada a continuación de la última): `id, request_id, method, url, status, code, message, stack, body_json, user_id, created_at_ms`. Guardar el cuerpo con campos `pin`, `password`, `token` redactados. Conservar solo los últimos 500 registros.
5. **Consulta para soporte:** `GET /api/support/server-errors?limit=50` solo rol admin (revisa qué existe ya en el módulo `support` y reutilízalo). Debe devolver mensaje y stack para que P0-B pueda capturar los 500 reales.
6. **Pruebas nuevas** (`apps/server/test/r2-error-handler.test.ts`): una por cada mapeo (FK, UNIQUE, CHECK, NOT NULL, validación, interno), y que el stack no aparezca en la respuesta.

## Prohibido
- Tocar PRAGMAs, `money.ts`, impresión, cierre Z, outbox.
- Cambiar el código HTTP de rutas que hoy responden bien (200/201/400 explícitos). El handler solo atrapa lo que hoy llega como 500.
- Correr nada contra `data/tocineta.db`.

## Criterios de aceptación
- `pnpm test`: 238 pruebas previas + las nuevas, todas verdes.
- Una petición que provoca un `throw` devuelve JSON con `code` y `requestId`, y existe una fila en `server_errors`.
- Prueba que demuestra que arrancar pruebas apuntando a la BD real **falla** de forma explícita.
- Tag `pre-r2` existe y la copia de seguridad pasó `integrity_check`.

## Entrega
Según §6 de las reglas. Incluye en el informe la ruta exacta del respaldo y la salida de `PRAGMA integrity_check`.
