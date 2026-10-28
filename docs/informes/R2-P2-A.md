# INFORME DE FASE R2-P2-A — Datos: Dos Sedes Oficiales y Jornada Global Única

- **Fase:** P2-A
- **Defectos resueltos:** B13 (Tercera sede '(Alias)'), B28 (Turno por sede en vez de jornada global)
- **Estado de defectos:** Ambos en 🟢 GREEN en `docs/r2/defects.json` (5 verdes en total, 0 regresiones)
- **Rama:** `r2/noche-01`
- **Tag:** `r2-p2-a`

---

## 1. Hecho
1. **Quitar alias del código:**
   - En `apps/server/src/modules/profitability/locations-service.ts`, `OFFICIAL_LOCATIONS` se redujo a exactamente las dos sedes oficiales: `loc_los_olivos` ("Sede A: Los Olivos") y `loc_alta_vista` ("Sede B: Alta Vista").
   - `ensureOfficialLocations` asegura únicamente estas dos sedes.
   - Actualizado comentario en `apps/server/src/index.ts`.
2. **Migración `0029_r2_sedes_y_jornada_global.sql`:**
   - Reasignación de `sede_alta_vista` -> `loc_alta_vista` en orden de jerarquía de Foreign Keys (hijos primero, padre al final):
     - `location_inventory` (combinación de cantidades si colisionan con insumo existente en `loc_alta_vista`, actualización del resto).
     - `monthly_closures` (deduplicación previa si colisiona `year-month`, actualización del resto).
     - `orders`, `jornadas`, `cash_sessions`, `deliveries`, `stock_counts`, `delivery_drivers`, `delivery_driver_settlements`, `purchases`, `inventory_movements`, `waste_logs`, `inter_location_transfers`, `transfer_batches`, `production_logs`, `operating_expenses`, `receivable_accounts`, `receivable_payments`, `payable_payments`, `tip_pools`.
     - `users.default_location_id` y `users.allowed_locations_json` (reemplazo en JSON string).
     - `DELETE FROM locations WHERE id = 'sede_alta_vista'`.
   - Idempotente.
   - En BD de prueba con datos sembrados: `PRAGMA foreign_key_check` arrojó exactamente 0 errores (`[]`).
3. **Eliminar los 4 fallbacks silenciosos:**
   - Creado `resolveLocationId(rawDb, candidate?, userId?)` en `locations-service.ts`:
     - Valida candidato si viene (debe existir y `is_active = 1`).
     - Si falta candidato, busca sede por defecto asignada al usuario (`users.default_location_id`).
     - Si ninguno es válido/activo, lanza `AppError('LOCATION_REQUIRED', 400, 'Se requiere una sede válida y activa', 'locationId')`. Nunca devuelve un literal.
   - Sustituidos los 4 fallbacks literales:
     - `apps/server/src/modules/cashier/cashier-service.ts:769` (en anulación de orden).
     - `apps/server/src/modules/incidents/incidents-service.ts:300` (en reembolsos).
     - `apps/server/src/modules/staff/tips-routes.ts:136` (en listar pools de propinas).
     - `apps/server/src/modules/profitability/recipes-service.ts:524` (en reversión de inventario por anulación).
4. **Jornada global única (D1):**
   - Migración 0029: Cierra automáticamente jornadas abiertas inactivas (0 órdenes y 0 pagos) conservando la más reciente, con nota `cerrada por migración R2`.
   - Si otra jornada abierta tiene actividad previa, aborta de forma segura identificando el ID de la jornada en conflicto.
   - Creación del índice único parcial: `CREATE UNIQUE INDEX ux_jornada_abierta ON jornadas(status) WHERE status = 'abierta'`.
   - `getCurrentJornada` actualizado con `ORDER BY opened_at_ms DESC LIMIT 1`.
   - `openJornada` es estrictamente idempotente: devuelve la jornada abierta existente con tasa actual sin duplicar ni arrojar error.
   - `openCashSession` asigna `cash_sessions.jornada_id` a la jornada global abierta.
   - Documentada regla D1 y columna heredada `jornadas.location_id` en `docs/r2/LIBRO-DE-REGLAS.md`.
5. **Pruebas de la fase (`apps/server/test/r2-sedes-jornada.test.ts`):**
   - 5 pruebas específicas cubriendo:
     - Arrancar dos veces -> count = 2 sedes.
     - Dos aperturas seguidas -> 1 jornada abierta e inserción directa duplicada rechazada por índice único.
     - Migración con datos en `sede_alta_vista` -> reasignados a `loc_alta_vista`, `PRAGMA foreign_key_check` vacío.
     - Aborto seguro de migración ante jornadas abiertas con actividad previa.
     - `resolveLocationId` con y sin candidato / usuario.

---

## 2. NO hecho / NO verificado
- Nada de la fase P2-A quedó pendiente.
- UI de selector de sedes y pantallas de Caja / Cierre corresponden a P2-C.
- P2-B y posteriores no se iniciaron en esta fase.

---

## 3. Evidencia (Salidas y Puertas de Calidad)
- **Puerta 1 (UI-GUARD):**
  - Comando: `pnpm guard`
  - Archivo de evidencia: [`docs/r2/evidencia/P2-A/gate-1-guard.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-A/gate-1-guard.txt)
  - Salida: `✓ UI-GUARD: Todas las reglas semánticas y de gobernanza pasaron con éxito.`
- **Puerta 2 (TypeScript / Lint):**
  - Comando: `pnpm -r run lint`
  - Archivo de evidencia: [`docs/r2/evidencia/P2-A/gate-2-lint.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-A/gate-2-lint.txt)
  - Salida: `packages/shared: Done`, `apps/server: Done`, `apps/web: Done`.
- **Puerta 3 (Compilación Producción):**
  - Comando: `pnpm -r run build`
  - Archivo de evidencia: [`docs/r2/evidencia/P2-A/gate-3-build.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-A/gate-3-build.txt)
  - Salida: `apps/web: ✓ built in 15.24s`, compilación limpia en todos los workspaces.
- **Puerta 4 (Suite de Pruebas Unitarias):**
  - Comando: `pnpm test`
  - Archivo de evidencia: [`docs/r2/evidencia/P2-A/gate-4-test.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-A/gate-4-test.txt)
  - Salida: `Test Files: 34 passed (34)`, `Tests: 301 passed (301)`.
  - Supera el piso de pruebas (piso baseline: 296 pruebas; ahora 301 pruebas). Cero tests omitidos o saltados.
- **Puerta 5 (Harness Playwright R2):**
  - Comando: `pnpm r2:e2e`
  - Archivo de evidencia: [`docs/r2/evidencia/P2-A/gate-5-r2-e2e.txt`](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/evidencia/P2-A/gate-5-r2-e2e.txt)
  - Salida: 34 passed (30 baseline + 4 por B13 y B28 en móvil y escritorio).
  - B13: Selector de sedes lista exactamente 2 sedes oficiales -> `ok`.
  - B28: Base de datos y servidor imponen exactamente 1 jornada diaria abierta global -> `ok`.
- **Núcleo Sagrado intacto:**
  - `git diff --stat r2-p1-b..HEAD -- packages/shared/src/utils/money.ts apps/server/src/modules/printing/ apps/server/src/db/connection.ts apps/server/src/modules/closures/ apps/server/src/modules/backups/ apps/web/src/features/pos/outbox.ts`: VACÍO (0 líneas modificadas).

---

## 4. Desviaciones del prompt
- Ninguna. Se ejecutaron todas las directivas de P2-A estrictamente según lo acordado.

---

## 5. Riesgos
- Al arrancar el servidor en producción con la base real `data/tocineta.db`, si existieran dos jornadas abiertas con órdenes o cobros reales simultáneos, la migración abortará inmediatamente sin modificar los datos, protegiendo la base de corrupción. Anthony deberá inspeccionar manualmente las jornadas con actividad antes de continuar.
