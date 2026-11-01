# BITÁCORA TÉCNICA Y DE CONTEXTO — TOCINETA
Última actualización: 2026-11-01 · Rama: r2/go-live · Último commit: d2269d4 chore(r2-pre0): archivos base de auditoria (route-policy, session, auth-guard, migracion 0038)

---

## 1. RESUMEN EJECUTIVO Y ESTADO ACTUAL

- **Oleada / Fase actual:**
  - En `PLAN-DE-EJECUCION.md` se declara "Oleada 2 (Cliente Seguro)" [DECLARADO: PLAN-DE-EJECUCION.md#L4].
  - El estado real del repositorio se encuentra en **transición activa de Oleada 1 (P1-A en server) y avance del primer lote de Oleada 2 (L-1 en web)** [INFERIDO: modificaciones concurrentes en git status].
  - El último commit consolidado es `d2269d4` ("chore(r2-pre0): archivos base de auditoria...") [VERIFICADO: git log].

- **Completado (con evidencia en repo):**
  - Incorporación de los 5 archivos base de auditoría extraídos del paquete del auditor: `route-policy.ts`, `session.ts`, `auth-guard.ts`, migración de índices `0038_r2_perf_indexes.sql` y suite de pruebas `r2-route-policy.test.ts` [VERIFICADO: commit d2269d4].
  - Corrección de carga de Cierre Z y desglose por método de pago en Bolívares (Bs) [VERIFICADO: commit a7f3f12].
  - Protección de cola de impresión ante congelamientos con `spooler-guard.ts` y scripts de servicio de spooler [VERIFICADO: commit b694fd4].
  - Endurecimiento de inventario y roles de impresión [VERIFICADO: commits 3515a2f y 6c38dc5].
  - Configuración del MCP de SQLite apuntando al archivo de base de datos de desarrollo [VERIFICADO: .gemini/mcp.json#L9].
  - Localización formal de las guías de prompts en la carpeta `guias/` en la raíz del proyecto (`guias/PROMPTS-GEMINI-3.8-FLASH.md` y `guias/PROMPTS-GEMINI-3.5-FLASH-LITE.md`) [VERIFICADO: guias/].
  - Ejecución técnica del Lote 1 de migración a `apiFetch` (L-1) [DECLARADO por el dueño; VERIFICADO en modificaciones de apps/web/src/].

- **En progreso:**
  - **Prompt P1-A (Arquitecto / Flash 3.8):** Cablear `registerAuthGuard` en `apps/server/src/server.ts`, sanitización en `apps/server/src/lib/error-handler.ts` en modo WARN y test de validación `apps/server/test/r2-auth-guard.test.ts` [DECLARADO por el dueño; VERIFICADO en git status --short / git diff --stat; pendiente de commit por el dueño].
  - **Prompt L-1 (Mecánico / Flash-Lite 3.5):** Sustitución de llamadas `fetch('/api/...')` por `apiFetch` en `App.tsx`, `AppLayout.tsx`, `MenuAdminView.tsx` y `QrMenuWebAdminView.tsx` [DECLARADO por el dueño; VERIFICADO en git status --short; Hecho sin commit, pendiente de commit por el dueño].

- **Bloqueado o pendiente:**
  - **Prompts P1-B, P1-C, P1-D, P2-A, P2-B:** Marcados ficticiamente en `PLAN-DE-EJECUCION.md` con hashes de ejemplo (`a1b2c3d`, `e4f5g6h`, etc.); formalmente pendientes de ejecución real [VERIFICADO: no existen en git log].
  - **Lotes L-2 a L-10 de Lite 3.5:** En cola de ejecución tras commitear L-1 [DECLARADO: guias/PROMPTS-GEMINI-3.5-FLASH-LITE.md].

---

## 2. SETUP DEL ENTORNO Y HERRAMIENTAS

### MCP de SQLite
- **Ubicación obligatoria:** Debe apuntar estrictamente a `apps/server/data/tocineta-dev.db` [DECLARADO por el dueño; VERIFICADO en .gemini/mcp.json#L9].
- **Prohibición absoluta:** NUNCA debe apuntar a la base de datos de producción (`tocineta.db` o equivalentes en despliegue) [DECLARADO].
- **Verificación:** Revisar `.gemini/mcp.json`, verificando que el parámetro `--db-path` contenga la ruta terminada en `apps/server/data/tocineta-dev.db`.
- **Uso seguro:** Inspección de esquemas y diagnóstico de consultas en desarrollo. Cualquier modificación estructural se debe realizar exclusivamente mediante archivos `.sql` numerados en `apps/server/src/db/migrations/`.

### Flujo y Especialización de Agentes
- **Guías Oficiales:**
  - `guias/PROMPTS-GEMINI-3.8-FLASH.md`: Prompts para el Arquitecto (lógica, seguridad, dinero) [VERIFICADO: guias/PROMPTS-GEMINI-3.8-FLASH.md].
  - `guias/PROMPTS-GEMINI-3.5-FLASH-LITE.md`: Prompts para el Mecánico (migraciones mecánicas `fetch` a `apiFetch`, 10 lotes L-1 a L-10) [VERIFICADO: guias/PROMPTS-GEMINI-3.5-FLASH-LITE.md].
- **Arquitecto (Gemini 3.8 Flash):** Lógica central, seguridad, validación de sesiones, políticas de enrutamiento y guard global. No se le pide refactorización masiva de UI.
- **Mecánico (Gemini 3.5 Flash-Lite):** Tareas textuales repetitivas de bajo riesgo (ej. L-1 a L-10). Nunca se le entrega sesión, dinero, outbox, KDS, lockout ni impresión [VERIFICADO: guias/PROMPTS-GEMINI-3.5-FLASH-LITE.md#L3].
- **Orquestador humano:** Asigna prompts, revisa diffs, corre verificaciones (`lint`, `guard`, `test`) y realiza los commits atómicos.

### Comandos Vitales del Repositorio
- **Ejecución de Tests del Servidor:**
  - `pnpm --filter @tocineta/server exec vitest run` (o script `pnpm --filter @tocineta/server run test`) [VERIFICADO: apps/server/package.json#L12].
  - Suite completa: `pnpm test` [VERIFICADO: package.json#L9].
- **Verificación Estática de Tipos:**
  - `pnpm -r exec tsc --noEmit` [VERIFICADO: devDependencies en package.json#L38].
  - Servidor: `pnpm --filter @tocineta/server run lint` (`tsc --noEmit`) [VERIFICADO: apps/server/package.json#L11].
  - Web: `pnpm --filter @tocineta/web exec tsc --noEmit` [VERIFICADO: guias/PROMPTS-GEMINI-3.5-FLASH-LITE.md#L38].
- **Validador de Gobernanza de UI (Guard UI):**
  - `pnpm run guard` (ejecuta `node scripts/ui-guard.mjs`) [VERIFICADO: package.json#L10].

---

## 3. DECISIONES DE NEGOCIO Y ARQUITECTURA (NO MODIFICAR A CIEGAS)

| ID | Decisión | Motivo | Alternativa descartada | Riesgo si se cambia | Evidencia |
|:---|:---|:---|:---|:---|:---|
| **D1** | **Bloqueo por inactividad desactivado en terminales operativas** | Cero fricción operativa durante horas pico de servicio en caja, KDS y comanderos. | Bloqueo por temporizador tras X minutos de inactividad. | Bloqueo accidental en pleno cobro o despacho, retrasos graves en atención. | [DECLARADO por el dueño; VERIFICADO en PLAN-DE-EJECUCION.md#L28] |
| **D2** | **Roles válidos canónicos en Base de Datos** | La base de datos y los checks de seguridad admiten únicamente 6 roles en minúsculas: `admin`, `supervisor`, `cajera`, `mesonero`, `cocinero`, `despachador`. | Uso de roles cosméticos o en mayúsculas como `PLANCHA`, `MESERO`, `DESPACHO`, `CAJERA`. | Fallos de integridad en base de datos, bloqueo por denegación en `ROLES_BY_LEVEL`. | [VERIFICADO: apps/server/src/db/schema.ts#L29, apps/server/src/config/route-policy.ts#L4-6] |
| **D3** | **WebSocket y Eventos con token por URL** | `EventSource` (SSE) y el constructor `WebSocket` del navegador no admiten cabeceras HTTP `Authorization` personalizadas en LAN sin HTTPS. | Autenticación exclusivamente por cabeceras `Authorization: Bearer`. | Imposibilidad de conectar KDS y comanderos en red local sin conexión a Internet o certificados SSL. | [DECLARADO por el dueño; VERIFICADO en apps/server/src/plugins/auth-guard.ts#L42-49] |
| **D4** | **Usuarios operativos nacen con PIN conocido y must_change_pin = 0** | Permitir arranque inmediato de personal de cocina y piso sin forzar pantallas de cambio de credenciales en primera apertura. Solo `admin` requiere cambio. | Forzar `must_change_pin = 1` para todos los usuarios nuevos. | Detención del flujo de caja y despacho en despliegues frescos si el personal no tiene acceso administrativo. | [DECLARADO por el dueño; VERIFICADO en apps/server/src/db/schema.ts#L40 y apps/server/src/modules/auth/seed-users.ts] |
| **D5** | **Migración 0038 como última migración e intocabilidad de previas** | La migración `0038_r2_perf_indexes.sql` añade índices de rendimiento (`idx_orders_created_at_ms`, `idx_orders_cash_session_id`, `idx_orders_location_id`). Las migraciones 0001 a 0037 son inmutables. | Modificar migraciones antiguas o aplicar scripts destructivos de alteración. | Corrupción irrecuperable de bases de datos existentes en sedes operativas y fallos en checksums de migración. | [VERIFICADO: apps/server/src/db/migrations/0038_r2_perf_indexes.sql, apps/server/src/db/migrate.ts] |
| **D6** | **Cajera autorizada para cerrar su propio turno (`CASHIER_PLUS`)** | Agilidad operativa al finalizar el turno de caja sin requerir presencia física obligatoria del supervisor para el arqueo. | Exigir `ADMIN_SUPERVISOR` para todo cierre de sesión/jornada. | Bloqueo del personal de caja al culminar turno si el supervisor o admin no están en la estación. | [DECLARADO por el dueño el 2026-11-01; confirma ajuste en route-policy.ts] |
| **D7** | **Lockout de PINs (M12) desbloqueable por `admin` y `supervisor`** | Protección contra ataques de fuerza bruta en terminales físicas, manteniendo el control de desbloqueo en los rangos de supervisión. | Desbloqueo exclusivo por `admin` o desactivación total del lockout. | Bloqueo permanente de cajeras/mesoneros en caso de fallos de PIN sin presencia del dueño/admin. | [DECLARADO por el dueño el 2026-11-01; VERIFICADO en route-policy.ts#L39-40] |
| **D8** | **Estrategia de Rama Única (`r2/go-live`) por Máxima Eficiencia** | Evitar sobrecarga y fricción de cambio de ramas o sincronización de múltiples worktrees en el monorepo local. Commits atómicos directos sobre `r2/go-live`. | Múltiples worktrees (`r2/ola-1`, `r2/ola-2`, `r2/lite-*`). | Conflictos de fusión complejos y pérdida de visibilidad del estado global del sistema. | [DECLARADO por el dueño el 2026-11-01; VERIFICADO en git branch actual] |

---

## 4. HISTORIAL DE INCIDENTES Y SOLUCIONES

### INC-01: Extracción manual de suministros del auditor
- **Síntoma:** Los 5 archivos base de la auditoría de seguridad R2 no se integraron mediante ramas directas de git.
- **Causa raíz:** Los artefactos fueron entregados dentro de un archivo comprimido externo (`tocineta-contexto-20261101-0215.zip`).
- **Solución:** Extracción y colocación manual de los 5 archivos en sus rutas canónicas (`route-policy.ts`, `session.ts`, `auth-guard.ts`, `0038_r2_perf_indexes.sql`, `r2-route-policy.test.ts`), consolidándolos en el commit base de auditoría.
- **Evidencia:** Commit `d2269d4` ("chore(r2-pre0): archivos base de auditoria...") [VERIFICADO: git show --stat d2269d4].
- **Cómo evitarlo:** Suministrar siempre cambios mediante ramas o parches git (`git format-patch`) en lugar de archivos comprimidos sueltos.

### INC-02: Suplantación de identidad por cabecera `x-user-id` (BUG-02)
- **Síntoma:** Peticiones HTTP a endpoints sensibles podían ejecutar operaciones en nombre de cualquier usuario enviando la cabecera `x-user-id` sin token de sesión válido.
- **Causa raíz:** Múltiples controladores del backend extraían el identificador de usuario directamente de `req.headers['x-user-id']` sin autenticar la sesión contra SQLite.
- **Solución:** Implementación de `getSessionUserByToken` en `apps/server/src/modules/auth/session.ts` y cableado del plugin `auth-guard.ts` que inyecta `request.user` autenticado; descarte formal del uso de `x-user-id`.
- **Evidencia:** `apps/server/src/modules/auth/session.ts#L44-82` [VERIFICADO], `apps/server/src/plugins/auth-guard.ts` [VERIFICADO].
- **Cómo evitarlo:** Nunca leer la identidad del usuario desde cabeceras no verificadas; consumir exclusivamente la propiedad `request.user` provista por el middleware central de autenticación.

### INC-03: Pérdida de ventas en el `outbox` offline (BUG-06)
- **Síntoma:** En situaciones de red inestable o fallos de autenticación (errores HTTP 401, 403 o 500), el outbox offline descartaba pedidos pendientes de sincronización de IndexedDB, perdiendo la venta registrada.
- **Causa raíz:** Lógica de manejo de errores en el cliente web que interpretaba cualquier respuesta de error como transacción completada o descartable.
- **Solución:** Clasificación de respuestas de red para que el outbox retenga pedidos localmente con reintento seguro y alerta visible al cajero (programado formalmente para Oleada 3 en P3-A).
- **Evidencia:** Registro en `PLAN-DE-EJECUCION.md#L24` [VERIFICADO] y Contexto del Dueño [DECLARADO].
- **Cómo evitarlo:** Aplicar política de "nunca perder una comanda" en almacenamiento local persistente; solo eliminar registros del outbox ante confirmación 2xx explícita del servidor.

### INC-04: Falla de carga y desalineación de moneda en Cierre Z
- **Síntoma:** El wizard de Cierre Z de caja fallaba al cargar o presentaba totales distorsionados en USD al agrupar pagos mixtos.
- **Causa raíz:** Falta de un endpoint dedicado para resumen Z que desglosara formalmente los montos en micro-Bs y Bolívares por método de pago.
- **Solución:** Creación del endpoint `/api/closures/z-summary`, inclusión de utilidades de conversión en `@tocineta/shared` (`payment-method-currency.ts`) y ajuste en los componentes visuales de cierre de caja.
- **Evidencia:** Commit `a7f3f12` ("fix(go-live): cierre Z carga y desglose en Bs") [VERIFICADO: git show --stat a7f3f12].
- **Cómo evitarlo:** Mantener los cálculos y agrupaciones de monedas en paquetes compartidos testeados unitariamente (`packages/shared/test/payment-method-currency.test.ts`).

### INC-05: Mezcla de archivos en commits "awa" / "awita2" y asunciones en tests de impresión
- **Síntoma:** Commits con mensajes informales ("awa", "awita2") incorporaron simultáneamente cambios en inventario, spooler de impresión y scripts de Windows; tests de flujo de impresión fallaron al asumir configuración `print_mode = 'two'`.
- **Causa raíz:** Falta de atomicidad en los commits de desarrollo rápido y ausencia de aislamiento en tests que dependían de `business_settings`, cuyo valor por defecto en base de datos es `'one'`.
- **Solución:** Ajuste en `apps/server/test/r2-print-release-auth.test.ts` para forzar la configuración de prueba y restaurarla en el bloque `afterAll`; creación de `spooler-guard.ts` para mitigar bloqueos de USB en Windows.
- **Evidencia:** Commits `3515a2f`, `b694fd4`, `042f890` [VERIFICADO].
- **Cómo evitarlo:** Respetar la nomenclatura estándar de commits de gobernanza (`feat(...)`, `fix(...)`), evitar commits masivos mixtos, y asegurar que cada test restaure el estado global de la base de datos de pruebas.

---

## 5. MAPA DE PROMPTS Y COMMITS (TRAZABILIDAD)

| Prompt | Agente / Modelo | Objetivo | Archivos afectados | Commit | Estado | Evidencia |
|:---|:---|:---|:---|:---|:---|:---|
| **Pre-0** | Auditor / Humano | Integrar los 5 archivos base de seguridad extraídos del ZIP | `route-policy.ts`, `session.ts`, `auth-guard.ts`, `0038_r2_perf_indexes.sql`, `r2-route-policy.test.ts` | `d2269d4` | Commiteado | [VERIFICADO: git show --stat d2269d4] |
| **P1-A** | Arquitecto (Flash 3.8) | Registrar auth-guard en server.ts y sanitizar URLs en error-handler.ts en MODO WARN | `apps/server/src/server.ts`, `apps/server/src/lib/error-handler.ts`, `apps/server/test/r2-auth-guard.test.ts`, `apps/server/test/test-helpers.ts` | `(sin commit)` | En progreso | [VERIFICADO: git status --short / git diff --stat] |
| **P1-D** | Arquitecto (Flash 3.8) | Proteger `init-prod` y endpoints destructivos de base de datos | `apps/server/src/db/init-prod.ts`, `apps/server/src/routes/` | `(sin commit)` | Pendiente | [DECLARADO en PLAN-DE-EJECUCION.md; no existe commit e4f5g6h en git log] |
| **P1-B** | Arquitecto (Flash 3.8) | Eliminar uso de cabecera `x-user-id` y consumir `request.user` | Controladores en `apps/server/src/modules/` | `(sin commit)` | Pendiente | [DECLARADO en PLAN-DE-EJECUCION.md; no existe commit i7j8k9l en git log] |
| **P1-C** | Arquitecto (Flash 3.8) | Unificar validación de sesión con `getSessionUserByToken` | Handlers de auth, caja y reportes | `(sin commit)` | Pendiente | [DECLARADO en PLAN-DE-EJECUCION.md; no existe commit m0n1o2p en git log] |
| **P2-A** | Arquitecto (Flash 3.8) | Crear `apiFetch` centralizado con manejo de sesión y auth en WebSocket | `apps/web/src/lib/api-fetch.ts`, `apps/web/src/lib/websocket.ts` | `(sin commit)` | Pendiente | [DECLARADO en PLAN-DE-EJECUCION.md; no existe commit q3r4s5t en git log] |
| **P2-B** | Arquitecto (Flash 3.8) | Modal de cambio de PIN no descartable ante `must_change_pin = 1` | Componentes de autenticación en `apps/web/` | `(sin commit)` | Pendiente | [DECLARADO en PLAN-DE-EJECUCION.md; no existe commit u6v7w8x en git log] |
| **L-1** | Mecánico (Flash-Lite 3.5) | Migración a `apiFetch` en frontend Lote 1 (4 archivos / 20 llamadas) | `apps/web/src/App.tsx`, `components/AppLayout.tsx`, `components/MenuAdminView.tsx`, `components/QrMenuWebAdminView.tsx` | `(sin commit)` | Hecho sin commit | [DECLARADO por el dueño; VERIFICADO en guias/PROMPTS-GEMINI-3.5-FLASH-LITE.md#L48 y git status --short] |
| **L-2 a L-10** | Mecánico (Flash-Lite 3.5) | Migración a `apiFetch` en frontend Lotes 2 al 10 | Componentes en `apps/web/src/features/` | `(sin commit)` | Pendiente | [DECLARADO en guias/PROMPTS-GEMINI-3.5-FLASH-LITE.md#L49-130] |
| **P2-D** | Arquitecto (Flash 3.8) | Polling y visualización de cola de impresión | Módulos de impresión en servidor y web | `(sin commit)` | Pendiente | [DECLARADO en PLAN-DE-EJECUCION.md] |
| **P3-A** | Arquitecto (Flash 3.8) | Blindaje de Outbox offline (retención ante 4xx/5xx) | Pipeline de sincronización en `apps/web/` | `(sin commit)` | Pendiente | [DECLARADO en PLAN-DE-EJECUCION.md] |

---

## 6. DEUDA TÉCNICA Y FASE C

### Ejes no auditados de la Fase C
1. **Reembolsos y Devoluciones:** Ausencia de flujo formal de contra-asiento contable en caja; se requiere registrar la devolución sin borrar transacciones históricas ni desbalancear el arqueo [DECLARADO por el dueño].
2. **Impresión ESC/POS en hardware físico:** El sistema ha sido probado en modo de simulación (`PRINTER_DEV_SIMULATION`); falta verificar secuencias de bytes reales, cortes parciales de papel y manejo de cajón de dinero en impresoras térmicas físicas de 58mm y 80mm [DECLARADO por el dueño].
3. **Multi-sede e inventario controlado:** Mecanismos de transferencia y control de stock entre sedes Alta Vista y Los Olivos; falta auditar la consistencia de inventario centralizado frente a desconexiones de red local [DECLARADO por el dueño].
4. **Nómina, socios y cupones:** Auditoría pendiente de los módulos de reparto de propinas, liquidaciones a repartidores y validación de doble aplicación de cupones [DECLARADO por el dueño; verificado parcialmente en migraciones históricas 0012 a 0015].

### Marcadores de Tareas Pendientes en Código (`TODO`)
- Ejecución de comando de verificación: `git grep -n "TODO("` arrojó **0 coincidencias** en el repositorio [VERIFICADO: git grep -n "TODO(" retorno vacío / exit code 1].
- Tareas pendientes identificadas en comentarios estructurados del código:
  - `apps/server/src/config/route-policy.ts:39`: Referencia a `M12: lockout` (desbloqueo desde la pantalla de login mediante PIN de supervisor o admin — resuelto por decisión D7) [VERIFICADO].
  - `apps/server/src/config/route-policy.ts:83`: Marcador `DECISION_NEGOCIO` en `/api/jornadas/close` (resuelto por decisión D6: cajera autorizada) [VERIFICADO].
  - `apps/server/src/config/route-policy.ts:93`: Marcador `DECISION_NEGOCIO` en reportes de corte parcial X (`/api/cash-sessions/:id/report`) [VERIFICADO].
  - `apps/server/src/config/route-policy.ts:124`: Marcador `DECISION_NEGOCIO` en consulta de órdenes pagadas (`/api/orders/paid`) [VERIFICADO].

### Riesgos y Observaciones Detectadas
1. **ADVERTENCIA CRÍTICA — MCP SQLite:** El MCP configurado en `.gemini/mcp.json` apunta a la base de datos local `tocineta-dev.db`. Está estrictamente prohibido redirigir este servidor hacia bases de datos de producción para evitar bloqueos por cerrojo de archivo (`database is locked`) o escrituras accidentales [VERIFICADO: .gemini/mcp.json; DECLARADO].
2. **Árbol de Trabajo Mezclado:** Se observan archivos modificados sin commitear simultáneamente en `apps/server` (P1-A) y `apps/web` (L-1). Se recomienda al dueño realizar commits atómicos separados: primero `feat(r2-p1-a): guard global en modo warn...` y luego `feat(r2-l1): migracion apiFetch lote 1 en web...` [INFERIDO para preservar trazabilidad limpia].
3. **Contraseñas / PINs por defecto en semillas:** El archivo `apps/server/src/modules/auth/seed-users.ts` contiene credenciales predeterminadas sembradas si la tabla `users` está vacía. En entornos de producción debe forzarse el cambio de clave del usuario administrador inmediatamente tras la inicialización [VERIFICADO: apps/server/src/modules/auth/seed-users.ts#L16-21].

---

## 7. INSTRUCCIONES PARA EL YO DEL FUTURO (O UN NUEVO DEV)

### Checklist Numerado de Retoma
1. **Lectura obligatoria:** Leer esta bitácora (`BITACORA-DE-CONTEXTO.md`) para entender el estado de avance real, decisiones consolidadas y los incidentes previos.
2. **Lectura de guías y plan:**
   - Leer `PLAN-DE-EJECUCION.md` para entender la secuencia general.
   - Leer `guias/PROMPTS-GEMINI-3.8-FLASH.md` antes de asignar cualquier tarea de servidor, lógica o seguridad.
   - Leer `guias/PROMPTS-GEMINI-3.5-FLASH-LITE.md` antes de asignar tareas de lote mecánico en frontend.
3. **Verificación de base de datos:** Comprobar que `.gemini/mcp.json` apunte únicamente a `apps/server/data/tocineta-dev.db`.
4. **Verificación de salud del proyecto (sin tocar código):**
   - Ejecutar suite de pruebas: `pnpm --filter @tocineta/server exec vitest run`
   - Validar sistema de tipos: `pnpm -r exec tsc --noEmit`
   - Validar gobernanza visual de interfaz: `pnpm run guard`
5. **Revisar dudas abiertas:** Consultar la Sección 8 de este documento antes de realizar cambios.

### Lo que NO debes hacer
- **NO reescribir ni renombrar los 5 archivos base de seguridad:** `route-policy.ts`, `session.ts`, `auth-guard.ts`, `0038_r2_perf_indexes.sql` y `r2-route-policy.test.ts` ya están verificados y congelados.
- **NO alterar las decisiones de la Sección 3:** No reactivar bloqueo por inactividad (D1), no inventar roles fuera de los 6 canónicos (D2), no quitar el token de la URL en WebSocket (D3), ni forzar cambio de PIN a roles operativos (D4).
- **NO modificar migraciones anteriores a la 0038:** Toda alteración de base de datos debe ser en una migración nueva forward-only (ej. `0039_...sql`).
- **NO hacer commits con nombres informales ni destructivos:** Prohibido `git push --force`, `git reset --hard` o nombres como "awa". Usar siempre la convención `feat(...)` o `fix(...)`.

---

## 8. PREGUNTAS ABIERTAS PARA EL DUEÑO

*Historial de consultas resueltas por el dueño el 2026-11-01:*

1. **[RESUELTO] Ubicación de hojas de prompts:**  
   - *Respuesta del dueño:* Están ubicadas en `guias/` en la raíz del proyecto (`guias/PROMPTS-GEMINI-3.8-FLASH.md` y `guias/PROMPTS-GEMINI-3.5-FLASH-LITE.md`) [VERIFICADO en disco].
2. **[RESUELTO] Permisos en Cierre de Jornada (`POST /api/jornadas/close`):**  
   - *Respuesta del dueño:* La cajera SÍ puede cerrar su turno/jornada. Pasa a formar parte de `CASHIER_PLUS` (Decisión D6) [DECLARADO por el dueño].
3. **[RESUELTO] Estrategia de ramas git:**  
   - *Respuesta del dueño:* Por defecto la decisión más eficiente: trabajar directamente sobre la rama única `r2/go-live` con commits atómicos ordenados, descartando la complejidad de múltiples ramas/worktrees (Decisión D8) [DECLARADO por el dueño].
4. **[RESUELTO] Lockout de PINs (M12):**  
   - *Respuesta del dueño:* El desbloqueo de usuarios bloqueados por intentos fallidos de PIN queda restringido a `admin` y `supervisor` mediante `/api/auth/unlock-user` (Decisión D7) [DECLARADO por el dueño].
5. **[RESUELTO] Confirmación de cambios pendientes en frontend (`apps/web`):**  
   - *Respuesta del dueño:* Las modificaciones en `App.tsx`, `AppLayout.tsx`, `MenuAdminView.tsx` y `QrMenuWebAdminView.tsx` corresponden efectivamente al Lote 1 (L-1) de Flash-Lite 3.5. Estado: Hecho sin commit, listo para ser commiteado [DECLARADO por el dueño; VERIFICADO en guias/PROMPTS-GEMINI-3.5-FLASH-LITE.md#L48].

*Nuevas preguntas abiertas: Ninguna en este ciclo.*

---

## 9. DISCREPANCIAS DETECTADAS

| Qué se declaró | Qué muestra el repo | Dónde | Acción sugerida |
|:---|:---|:---|:---|
| `PLAN-DE-EJECUCION.md` declara Oleada 1 completada con commits `a1b2c3d`, `e4f5g6h`, `i7j8k9l`, `m0n1o2p`. | Esos commits son ficticios; en `git log` el último commit es `d2269d4`. Los cambios de P1-A están modificados sin commit en el árbol de trabajo. | `PLAN-DE-EJECUCION.md#L13-16` vs `git log --oneline` | Actualizar `PLAN-DE-EJECUCION.md` para reflejar el estado real: P1-A en curso `(sin commit)` y P1-B a P1-D pendientes. |
| La instrucción inicial indicaba prompts en la raíz (`PROMPTS-GEMINI-3.8-FLASH.md`). | Los archivos existen y residen dentro de la carpeta `guias/` (`guias/PROMPTS-GEMINI-3.8-FLASH.md` y `guias/PROMPTS-GEMINI-3.5-FLASH-LITE.md`). | Raíz del proyecto vs carpeta `guias/` | [RESUELTO] Documentada la ruta oficial en `guias/`. |
| `PLAN-DE-EJECUCION.md` declara ramas y worktrees específicos (`r2/ola-1`, `r2/ola-2`, `r2/lite-*`). | `git branch --show-current` reporta `r2/go-live`; el dueño instruyó usar la estrategia más eficiente (rama única). | `git branch --show-current` vs `PLAN-DE-EJECUCION.md#L11-25` | [RESUELTO] Se adopta formalmente `r2/go-live` como rama troncal única con commits atómicos (Decisión D8). |
| Planes previos y nombres comunes emplean roles `PLANCHA`, `MESERO`, `DESPACHO`. | El esquema de base de datos define estrictamente: `admin`, `supervisor`, `cajera`, `mesonero`, `cocinero`, `despachador`. | `apps/server/src/db/schema.ts#L29` y `apps/server/src/modules/auth/seed-users.ts` | Mantener los roles técnicos en minúsculas en DB y controladores; restringir nombres en mayúsculas a etiquetas visuales de UI. |
| Comandos de verificación citados en instrucciones vs scripts de `package.json`. | El comando `pnpm --filter @tocineta/server exec vitest run` funciona, pero el script directo registrado es `pnpm --filter @tocineta/server run test`. | `apps/server/package.json#L12` y `package.json#L9` | Ambos comandos son válidos; se documentan ambas alternativas para conveniencia del equipo. |

---

## 10. REGISTRO DE CAMBIOS DE ESTA BITÁCORA

- **2026-11-01 (1ra edición):** Creación inicial de `BITACORA-DE-CONTEXTO.md` como fuente única de verdad. Documentación de auditoría R2, sincronización de discrepancias de plan vs git, verificación de archivos base de seguridad y definición del checklist de retoma. Referencia de commit: `d2269d4`.
- **2026-11-01 (2da edición):** Incorporación de resoluciones del dueño para las 5 preguntas abiertas: verificación de rutas en `guias/`, aprobación de cierre de turno por cajera (D6), confirmación de desbloqueo de PIN por admin y supervisor (D7), adopción de rama única `r2/go-live` (D8), y consolidación del estado de L-1 como Hecho sin commit.
