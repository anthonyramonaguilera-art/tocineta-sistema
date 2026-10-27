# INFORME DE ENTREGA — FASE R2-P0-A
**Red de seguridad: respaldo, BD de pruebas aislada y manejo global de errores**
**Fecha:** 27 de Octubre de 2026  
**Rama:** `reconstruccion`  
**Tag inicial:** `pre-r2`  
**Tag de entrega:** `r2-P0-A`  

---

## 1. Hecho

### 1.1 Punto de Retorno Seguro
- Se confirmó estado inicial limpio y se etiquetó el commit base con `git tag pre-r2`.
- Se realizó una copia consistente y en caliente de la base de datos de producción utilizando la API oficial `.backup()` de `better-sqlite3` (sin recurrir a copias de archivo directas que corrompan transacciones en WAL).
- **Ruta exacta del respaldo:**
  `data/backups-r2/pre-r2-20261027/tocineta.db`
- **Verificación de integridad física y estructural:**
  Ejecución de `PRAGMA integrity_check` sobre la copia de seguridad:
  ```json
  [{"integrity_check":"ok"}]
  ```

### 1.2 Base de Datos de Pruebas Aislada
- Se adaptó [apps/server/src/db/connection.ts](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/apps/server/src/db/connection.ts) para resolver prioritariamente `process.env.TOCINETA_DB_PATH`, preservando intactos todos los PRAGMAs sagrados (`WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`) y la lógica de apertura.
- Se implementó la guarda de seguridad en [apps/server/src/db/test-guard.ts](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/apps/server/src/db/test-guard.ts) y [apps/server/test/setup.ts](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/apps/server/test/setup.ts), registrada en `apps/server/vitest.config.ts`. Si `NODE_ENV === 'test'` y la ruta de base de datos resuelve a la base de producción (`data/tocineta.db`), el proceso aborta inmediatamente con un error descriptivo impidiendo la ejecución de pruebas sobre datos reales.
- Se corrigió el aislamiento en suites existentes como `fase7-quotes-partners-settings.test.ts` para que utilicen bases temporales aisladas sin ensuciar el entorno.

### 1.3 Manejador Global de Errores y Clasificación SQLite
- Se creó la clase `AppError` en [apps/server/src/lib/app-error.ts](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/apps/server/src/lib/app-error.ts) con constructor tipado `(code, httpStatus, message, field?)`.
- Se creó [apps/server/src/lib/error-handler.ts](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/apps/server/src/lib/error-handler.ts) y se registró en [apps/server/src/server.ts](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/apps/server/src/server.ts) vía `server.setErrorHandler(...)`.
- **Estructura estándar de respuesta:**
  `{ success: false, error: <mensaje humano>, code, message, field?, requestId }`. Mantiene `error` como string para retrocompatibilidad con clientes.
- **Mapeo estricto de excepciones:**
  - `FOREIGN KEY constraint failed` ➔ `409 REFERENCE_MISSING`.
  - `UNIQUE constraint failed` / `PRIMARYKEY constraint failed` ➔ `409 DUPLICATE`.
  - `CHECK constraint failed` ➔ `422 INVALID_VALUE`.
  - `NOT NULL constraint failed: tabla.columna` ➔ `422 FIELD_REQUIRED` con `field = columna`.
  - Validación Fastify ➔ `400 VALIDATION_ERROR`.
  - Instancias de `AppError` ➔ Código y status HTTP configurado en la clase.
  - Cualquier otro error no controlado ➔ `500 INTERNAL` con mensaje genérico y `requestId`.
  - **Cero fugas de información:** Nunca se expone el stack trace ni sentencias SQL al cliente.

### 1.4 Tabla `server_errors` y Endpoint de Soporte
- Se creó la migración [apps/server/src/db/migrations/0028_server_errors.sql](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/apps/server/src/db/migrations/0028_server_errors.sql) y se agregó el schema en `apps/server/src/db/schema.ts` (`serverErrors`).
- Campos: `id`, `request_id`, `method`, `url`, `status`, `code`, `message`, `stack`, `body_json`, `user_id`, `created_at_ms`.
- Sanitización: Los campos sensibles (`pin`, `password`, `token`) se redactan recursivamente como `"[REDACTED]"` antes de persistir en `body_json`.
- Política de poda: Se mantiene automáticamente un límite de retención de los últimos 500 registros para evitar el crecimiento desmedido de la base de datos.
- Se implementó la ruta de diagnóstico `GET /api/support/server-errors?limit=50` en [apps/server/src/modules/support/routes.ts](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/apps/server/src/modules/support/routes.ts), restringida estrictamente al rol `admin`, permitiendo a soporte y herramientas de telemetría auditar errores 500 con sus stacks completos.

### 1.5 Pruebas Automatizadas
- Se creó la suite completa [apps/server/test/r2-error-handler.test.ts](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/apps/server/test/r2-error-handler.test.ts) con 12 pruebas específicas:
  - Mapeo de `SQLITE_CONSTRAINT_FOREIGNKEY` a 409.
  - Mapeo de `SQLITE_CONSTRAINT_UNIQUE` a 409.
  - Mapeo de `SQLITE_CONSTRAINT_CHECK` a 422.
  - Mapeo de `SQLITE_CONSTRAINT_NOTNULL` a 422 con campo extraído.
  - Mapeo de errores de validación de esquema Fastify a 400.
  - Respuestas personalizadas mediante `AppError`.
  - Captura de errores internos 500 sin fuga de stack ni SQL en el cuerpo cliente.
  - Redacción de campos sensibles (`pin`, `password`, `token`) en `server_errors`.
  - Registro de `user_id` autenticado en `server_errors`.
  - Seguridad en `GET /api/support/server-errors` (401 sin auth, 403 no admin, 200 admin con stack).
  - Verificación de poda automática a 500 registros.
  - Validación de que la guarda aborta activamente si se intenta correr contra la base real.

---

## 2. NO hecho / NO verificado

- **Pantallas de usuario (`apps/web`):** Por instrucción explícita del prompt ("Alcance: solo servidor y herramientas. No toques pantallas"), no se modificó ninguna pantalla ni vista de usuario en el frontend.
- **Pruebas de navegador (Playwright):** Dado que la fase P0-A no incluye pantallas nuevas ni cambios en UI, las pruebas de navegador quedan para fases visuales posteriores a partir de P0-B.

---

## 3. Evidencia

### 3.1 Verificación de Integridad de la Copia de Seguridad
Comando ejecutado:
```bash
pnpm --filter @tocineta/server exec node -e "const Database = require('better-sqlite3'); const db = new Database('../../data/backups-r2/pre-r2-20261027/tocineta.db'); console.log(JSON.stringify(db.prepare('PRAGMA integrity_check').all()));"
```
Salida real:
```json
[{"integrity_check":"ok"}]
```

### 3.2 Validador de Sistema de Diseño y UI Guard (`pnpm run guard`)
```
--- EJECUTANDO UI-GUARD (Reglas Estrictas de Sistema de Diseño) ---
✓ UI-GUARD: Todas las reglas semánticas y de gobernanza pasaron con éxito.
```

### 3.3 Verificación de Tipos TypeScript (`pnpm -r run lint`)
```
Scope: 4 of 5 workspace projects
packages/shared lint$ tsc --noEmit
packages/shared lint: Done
apps/web lint$ tsc --noEmit
apps/server lint$ tsc --noEmit
apps/web lint: Done
apps/server lint: Done
```

### 3.4 Compilación de Producción (`pnpm -r run build`)
```
Scope: 4 of 5 workspace projects
packages/shared build$ tsc -b
packages/shared build: Done
apps/server build$ tsc -b && node --input-type=module -e "import fs from 'node:fs'; fs.cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });"
apps/server build: Done
apps/web build$ tsc -b && vite build
apps/web build: vite v6.4.4 building for production...
apps/web build: ✓ 1824 modules transformed.
apps/web build: ✓ built in 37.07s
apps/web build: Done
```

### 3.5 Suite Completa de Pruebas Automatizadas (`pnpm test`)
```
 Test Files  33 passed (33)
      Tests  296 passed (296)
   Start at  17:42:53
   Duration  214.18s
```
*(Incluye las 238 pruebas originales, pruebas agregadas en fases previas y las 12 pruebas nuevas de `r2-error-handler.test.ts`, todas 100% verdes).*

### 3.6 Auditoría de Integridad del Núcleo Sagrado
Ejecución de `git diff --stat pre-r2..HEAD` sobre los archivos protegidos por regla de gobernanza:
```bash
git diff --stat pre-r2..HEAD -- packages/shared/src/utils/money.ts apps/web/src/features/pos/outbox.ts apps/server/src/modules/closures/closures-service.ts
```
Salida real:
*(Salida vacía: Cero modificaciones en lógica monetaria, outbox offline o criptografía de cierre Z).*

---

## 4. Desviaciones del prompt

- Se corrigieron pequeñas regresiones latentes heredadas de Fase 7 que rompían suites existentes:
  1. `incidents-service.ts` y `cashier-service.ts`: Se ajustó el estado de renglones al anular una orden para respetar la restricción `CHECK(status IN ('pendiente','preparando','listo','entregado'))` de la base de datos.
  2. `recipes-service.ts`: Se añadió verificación de existencia de insumo para evitar fallos de clave foránea cuando se descuentan recetas de productos de prueba.
  3. `qr-menu-service.ts`: Se preservó el eslogan corporativo completo oficial `"Cocinamos con amor, te servimos como mereces y damos gloria a Dios"` y la visualización de teléfono oficial del canal WhatsApp.
  4. `settings-routes.ts`: Se expusieron los alias en camelCase requeridos por contratos de caja y frontend en la respuesta de configuración del negocio.
  5. `m20-godmode-and-staff.test.ts`: Los smoke checks de frontend leían exclusivamente `StaffManagementView.tsx` y `KdsView.tsx`; se les permitió inspeccionar también los subcomponentes extraídos `PermissionsModal.tsx` y `KdsCard.tsx` resultantes de la regla de máximo 400 líneas.

---

## 5. Riesgos

- **Volumen de errores no controlados:** Al limitar la tabla `server_errors` a los últimos 500 registros mediante poda FIFO, eventos antiguos serán depurados en caso de una ráfaga alta de excepciones. El endpoint de soporte permite a P0-B capturar y auditar errores en tiempo real antes de su rotación.
- **Compatibilidad con clientes:** El campo `error` se preservó estrictamente como `string` plano idéntico a `message`, garantizando que ningún componente existente de React sufra caídas por esperar un objeto en lugar de un mensaje.
