# P6-A — `db:init-prod` auditado: limpieza de datos basura sin re-siembra

**Chat nuevo.** Lee `docs/r2/01-REGLAS-DEL-AGENTE.md` y `docs/r2/00-PLAN-MAESTRO.md` (§1, §8 punto 3). Requiere P5-B.
**Defectos:** B22 (datos basura). **Alcance:** servidor y scripts. **El agente NO ejecuta la limpieza contra la base real**: entrega el comando y el usuario lo corre en el PC servidor.

## Objetivo
Dejar la base de producción libre de datos de prueba ("Wjsn", "Jsjs", "fd", gastos de prueba como los $460, "Socio Director", proveedores ficticios) y **garantizar que nada de eso reaparezca al reiniciar**.

## Hechos verificados (confirma con grep)
- Ya existen `pnpm db:init-prod` (`apps/server/src/db/init-prod.ts`, 25 líneas), `db:reset-prod` (`reset-for-production.ts`, 161 líneas), `db:seed-demo` y la función `resetToProductionClean` en `profitability/setup-wizard-service.ts` (limpia proveedores `sup_demo_%`, `%San Félix%`, `%Ficticio%`). **No dupliques: audita y refuerza lo existente.**
- `init-prod.ts` toma la ruta de `process.env.DB_PATH || './data/tocineta.db'` y escribe directamente sobre la BD indicada, sin confirmación ni vista previa (`--dry-run`).
- **Siembras que corren en cada arranque** (`apps/server/src/index.ts`): `seedInitialUsers`, `syncAndSanitizeCorporateUsers` (`modules/auth/seed-users.ts`), `seedCatalog` (`db/seed-catalog.ts`, 460 líneas) y `ensureOfficialLocations`.
- `seed-users.ts:~142` y la migración `0021` renombran al cliente socio a **"Socio Director"** (`UPDATE customers SET name='Socio Director'…`): ese dato basura se **regenera** al arrancar.
- El .rar contiene una BD de desarrollo distinta de la del teléfono; no sirve para decidir qué borrar.

## Tareas
1. **Inventario de siembras:** lista (en el informe) todo lo que inserta datos al arrancar o migrar, y clasifícalo: **necesario** (usuarios por rol, sedes oficiales, catálogo/carta, métodos de pago, ajustes) o **demo/basura**. Elimina del arranque cualquier inserción/renombrado de datos demo (incluido "Socio Director"); el catálogo real y los usuarios por rol se conservan.
2. **Modo producción explícito:** `TOCINETA_MODE=prod|dev` (por defecto `prod`). En `prod` nunca corre `seed-demo` ni se crean clientes/proveedores/gastos de ejemplo; `db:seed-demo` exige `TOCINETA_MODE=dev` y aborta en `prod`.
3. **Refuerzo de `db:init-prod`:**
   - **`--dry-run` por defecto**: imprime cuántas filas de cada tabla se borrarían y una muestra de nombres; no modifica nada.
   - Para ejecutar de verdad: `--apply --confirm "BORRAR DATOS DE PRUEBA"` y **copia previa** consistente (API `.backup()`) en `data/backups-r2/` con `integrity_check`.
   - **Conserva:** usuarios por rol (y sus PIN/permisos), catálogo (productos, combos, modificadores, precios), tasa de cambio vigente, ajustes del negocio, las 2 sedes, configuración de impresoras, migraciones.
   - **Purga:** órdenes, pagos, asientos, jornadas, sesiones de caja, gastos, compras, mermas, movimientos, conteos, cotizaciones, clientes/proveedores/socios de prueba (por marca de origen demo y por la lista de nombres basura), `server_errors`, `client_errors`. Reinicia secuencias de numeración de órdenes.
   - Todo en una transacción; al final `PRAGMA foreign_key_check` vacío y `integrity_check` ok; reconstruye el stock inicial por sede en 0 (la dueña carga el suyo con el asistente).
4. **Detector de basura para la dueña:** `GET /api/system/test-data-report` (solo admin) lista, sin borrar, registros que parecen de prueba (nombres de 1-4 letras, "Jsjs/Wjsn/fd", gastos duplicados idénticos, clientes "Socio Director", proveedores con "Ficticio"/"demo"). Sirve para decidir en la BD real antes de aplicar.
5. **Prueba anti re-siembra** `apps/server/test/r2-init-prod.test.ts` (BD temporal): sembrar basura → `init-prod --apply` → arrancar el servidor **dos veces** → conteos de basura = 0, 2 sedes, usuarios por rol intactos, catálogo intacto. Otra prueba: `--dry-run` no cambia ni un byte de datos (compara hashes de tablas).
6. **Comando para el usuario:** escribe en el informe, para Windows (PowerShell), los pasos exactos sobre la BD del PC servidor: detener servidor → copia de seguridad manual → `pnpm db:init-prod` (dry-run) → revisar → `pnpm db:init-prod -- --apply --confirm "BORRAR DATOS DE PRUEBA"` → iniciar → abrir "Salud de números".

## Prohibido
- Ejecutar `--apply` contra `data/tocineta.db` real. Borrar usuarios por rol, catálogo, tasa o ajustes.
- Tocar PRAGMAs, cierre Z, impresión, outbox, `money.ts`.
- Dejar una siembra que renombre o recree datos demo al arrancar.

## Criterios de aceptación
- Pruebas `r2-init-prod` verdes (dry-run inocuo, apply limpio, doble arranque sin re-siembra, producción rechaza `seed-demo`).
- `grep` de los nombres basura conocidos no encuentra inserciones en código de arranque.
- 238+ pruebas verdes; lint y build verdes.

## Entrega
Según §6. Incluye el inventario de siembras con su clasificación y el comando final para el usuario, probado en BD temporal.
