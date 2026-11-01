# BITÁCORA TÉCNICA Y DE CONTEXTO — TOCINETA
Última actualización: 2026-11-01 · Rama: r2/go-live · Último commit: aecab15 refactor(L-9): migrar fetch a apiFetch en quotes, transfers y settings

---

## 1. RESUMEN EJECUTIVO Y ESTADO ACTUAL

- **Oleada / Fase actual:**
  - **Oleada 2 (Cliente Seguro / Endurecimiento Frontend) en fase final de culminación** [DECLARADO por el dueño; VERIFICADO en git log y git status].
  - **Hito histórico consolidado:** La **Oleada 1 (Seguridad Backend)** está 100% COMPLETADA y sellada en git con el tag oficial `r2-ola-1` en el commit `b3eab54` [DECLARADO por el dueño; VERIFICADO: git log / git tag].
  - La migración de `fetch` a `apiFetch` en frontend (Lotes L-1 al L-10) está terminada al 100% en código. Lotes L-1 a L-9 commiteados; Lote L-10 completado en árbol de trabajo listo para commit [VERIFICADO en git log y git status; DECLARADO].
  - Los ítems P2-B (Modal de PIN no descartable) y P2-D (Optimización de Polling de Impresión) del Arquitecto (Flash 3.8) se encuentran completamente implementados y preparados en el staging de git [VERIFICADO: git status / lectura de código].

- **Completado (con evidencia en repo):**
  - **Oleada 1 — Seguridad Backend (100% Commiteada):**
    - P1-A: Guard global `registerAuthGuard` y sanitización en `error-handler.ts` en MODO WARN [VERIFICADO: commit `b3eab54`].
    - P1-D: Blindaje de `init-prod`, `seed-demo`, resguardo de credenciales de admin y permiso de cierre de jornada para cajera [VERIFICADO: commit `ea1130e` con tag `fase-p1-d`].
    - P1-B: Extirpación sistemática de suplantación de identidad `x-user-id` y validación de `request.user` [VERIFICADO: commit `4dbe96c` con tag `fase-p1-b` en `ea8e394`].
    - P1-C: Unificación de sesiones con `getSessionUserByToken` y suite de tests `r2-session-validation.test.ts` (8/8 verdes) [VERIFICADO: commit `b3eab54`].
    - Tag oficial de hito: `r2-ola-1` [VERIFICADO: git show b3eab54].
  - **Oleada 2 — Cliente Seguro y Frontend:**
    - P2-A: Cliente HTTP centralizado `apiFetch` y `apiJson` en `apps/web/src/api/client.ts` con inyección de Bearer token y cabeceras anti-suplantación [VERIFICADO: repo base].
    - Lote L-1: Migración a `apiFetch` en `App.tsx`, `AppLayout.tsx`, `MenuAdminView.tsx`, `QrMenuWebAdminView.tsx` [VERIFICADO: commits base y `b3eab54`].
    - Lotes L-2 y L-4: Migración a `apiFetch` en componentes de soporte, salud, vistas de error, QR de acceso, registro de personal, modales de tickets y delivery [VERIFICADO: commit `23fc2d7`].
    - Lote L-3: Migración a `apiFetch` en módulo `cashier` [VERIFICADO: commit `66b1ac8`].
    - Lote L-5: Migración a `apiFetch` en finanzas, home y KDS [VERIFICADO: commit `d5123a8`].
    - Lote L-6: Migración a `apiFetch` en KDS actions, socios, panel de dueña, autorización POS, comandero e inventario [VERIFICADO: commit `ea8e394`].
    - Lote L-7: Migración a `apiFetch` en compras, recetas, mermas e importación CSV [VERIFICADO: commit `69b6e6e`].
    - Lote L-8: Migración a `apiFetch` en modales de producción, recetas, sub-recetas, conteo de stock, insumos y transferencias [VERIFICADO: commit `387b30a`].
    - Lote L-9: Migración a `apiFetch` en cotizaciones de eventos, ajustes del negocio y transferencias entre sedes [VERIFICADO: commit `aecab15`].
    - Lote L-10 (Mecánico / Lite 3.5): Migración completada en `PrintersPanel.tsx`, `SettlementModal.tsx`, `useStaffData.ts` y `BcvRateModal.tsx`. Se respetaron `window.open` y `refetchStaff` sin alterarlos erróneamente [DECLARADO por el dueño; VERIFICADO en archivos preparados en staging].
    - P2-B (Arquitecto / Flash 3.8): Modal no descartable de cambio de PIN (`ChangePinModal.tsx`), soporte en `Modal.tsx` (`closeOnEscape=false`, `closeOnBackdropClick=false`, `showCloseButton=false`), bloqueo de UI con desenfoque e inhabilitación de clics en `AppLayout.tsx` ante `must_change_pin = 1`, utilidades numéricas (`pin-utils.ts`), y persistencia en `AuthContext.tsx` y `routes/auth.ts` [VERIFICADO en código fuente y `git status`].
    - P2-D (Arquitecto / Flash 3.8): Optimización de polling en `PrintAttentionModal.tsx` (intervalo de 3 s ante trabajos con alerta o modal visible, 30 s en reposo, pausa ante `document.hidden` y `refetchIntervalInBackground: false`) [VERIFICADO en código fuente y `git status`].
    - Protección de cola de impresión con `spooler-guard.ts` (timeout 8 s + warn) [VERIFICADO: commit `b694fd4`].
    - Migración de índices de base de datos `0038_r2_perf_indexes.sql` y verificación de integridad [VERIFICADO: commit `d2269d4`].

- **En progreso:**
  - Consolidación y commit en git de los ítems finalizados de la Oleada 2 actualmente en staging (`git status`): L-10, P2-B y P2-D [VERIFICADO: git status; pendiente de commit por el dueño].

- **Bloqueado o pendiente:**
  - **Oleada 3 (Resiliencia Operativa y Offline):**
    - Prompt P3-A: Blindaje de `outbox.ts` offline (retención segura ante códigos HTTP 4xx/5xx en IndexedDB y política de nunca perder pedidos) [DECLARADO por el dueño; VERIFICADO en PLAN-DE-EJECUCION.md].
    - Sincronización y revisión de llamadas `fetch` pendientes en `usePosCart.ts` y `outbox.ts` (excluidas a propósito de la Oleada 2 para ser abordadas de forma integral en la Oleada 3) [DECLARADO por el dueño; VERIFICADO en exclusiones de código].

---

## 2. SETUP DEL ENTORNO Y HERRAMIENTAS

### MCP de SQLite
- **Ubicación obligatoria:** Debe apuntar estrictamente a `apps/server/data/tocineta-dev.db` [DECLARADO por el dueño; VERIFICADO en .gemini/mcp.json#L9].
- **Prohibición absoluta:** NUNCA debe apuntar a la base de datos de producción (`tocineta.db` o equivalentes en despliegue) [DECLARADO].
- **Verificación:** Revisar `.gemini/mcp.json`, verificando que el parámetro `--db-path` contenga la ruta terminada en `apps/server/data/tocineta-dev.db`.
- **Uso seguro:** Inspección de esquemas y diagnóstico de consultas en desarrollo. Cualquier modificación estructural se debe realizar exclusivamente mediante archivos `.sql` numerados en `apps/server/src/db/migrations/`.

### Flujo y Especialización de Agentes
- **Guías Oficiales:**
  - `guias/PROMPTS-GEMINI-3.8-FLASH.md`: Prompts para el Arquitecto (lógica, seguridad, dinero, arquitectura) [DECLARADO; VERIFICADO en bitácora previa].
  - `guias/PROMPTS-GEMINI-3.5-FLASH-LITE.md`: Prompts para el Mecánico (migraciones mecánicas `fetch` a `apiFetch`, lotes L-1 a L-10) [DECLARADO; VERIFICADO en bitácora previa].
- **Arquitecto (Gemini 3.8 Flash):** Lógica central, seguridad, validación de sesiones, políticas de enrutamiento, guard global, modals no descartables (P2-B) y polling crítico (P2-D). No se le pide refactorización masiva de UI.
- **Mecánico (Gemini 3.5 Flash-Lite):** Tareas textuales repetitivas de bajo riesgo (ej. lotes L-1 a L-10). Nunca se le entrega sesión, dinero, outbox, KDS, lockout ni impresión [DECLARADO].
- **Orquestador humano:** Asigna prompts, revisa diffs, corre verificaciones (`lint`, `guard`, `test`) y realiza los commits atómicos.

### Comandos Vitales del Repositorio
- **Ejecución de Tests del Servidor:**
  - `pnpm --filter @tocineta/server exec vitest run` (o script `pnpm --filter @tocineta/server run test`) [VERIFICADO: apps/server/package.json#L12].
  - Suite completa: `pnpm test` [VERIFICADO: package.json#L9].
- **Verificación Estática de Tipos:**
  - `pnpm -r exec tsc --noEmit` [VERIFICADO: devDependencies en package.json#L38].
  - Servidor: `pnpm --filter @tocineta/server run lint` (`tsc --noEmit`) [VERIFICADO: apps/server/package.json#L11].
  - Web: `pnpm --filter @tocineta/web exec tsc --noEmit` [DECLARADO].
- **Validador de Gobernanza de UI (Guard UI):**
  - `pnpm run guard` (ejecuta `node scripts/ui-guard.mjs`) [VERIFICADO: package.json#L10].

---

## 3. DECISIONES DE NEGOCIO Y ARQUITECTURA (NO MODIFICAR A CIEGAS)

| ID | Decisión | Motivo | Alternativa descartada | Riesgo si se cambia | Evidencia |
|:---|:---|:---|:---|:---|:---|
| **D1** | **Bloqueo por inactividad desactivado en terminales operativas** | Cero fricción operativa durante horas pico de servicio en caja, KDS y comanderos. | Bloqueo por temporizador tras X minutos de inactividad. | Bloqueo accidental en pleno cobro o despacho, retrasos graves en atención al cliente. | [DECLARADO por el dueño; VERIFICADO en apps/web/src/context/AuthContext.tsx#L63-65] |
| **D2** | **Roles válidos canónicos en Base de Datos** | La base de datos y los checks de seguridad admiten únicamente 6 roles en minúsculas: `admin`, `supervisor`, `cajera`, `mesonero`, `cocinero`, `despachador`. | Uso de roles cosméticos o en mayúsculas como `PLANCHA`, `MESERO`, `DESPACHO`, `CAJERA`. | Fallos de integridad en base de datos, bloqueo por denegación en `ROLES_BY_LEVEL`. | [VERIFICADO: apps/server/src/db/schema.ts#L29, apps/server/src/config/route-policy.ts#L4-6] |
| **D3** | **WebSocket y Eventos con token por URL** | `EventSource` (SSE) y el constructor `WebSocket` del navegador no admiten cabeceras HTTP `Authorization` personalizadas en LAN sin HTTPS. | Autenticación exclusivamente por cabeceras `Authorization: Bearer`. | Imposibilidad de conectar KDS y comanderos en red local sin conexión a Internet o certificados SSL. | [DECLARADO por el dueño; VERIFICADO en apps/server/src/plugins/auth-guard.ts#L42-49] |
| **D4** | **Usuarios operativos nacen con PIN conocido y must_change_pin = 0** | Permitir arranque inmediato de personal de cocina y piso sin forzar pantallas de cambio de credenciales en primera apertura. Solo `admin` requiere cambio. | Forzar `must_change_pin = 1` para todos los usuarios nuevos. | Detención del flujo de caja y despacho en despliegues frescos si el personal no tiene acceso administrativo. | [DECLARADO por el dueño; VERIFICADO en apps/server/src/db/schema.ts#L40 y apps/server/src/modules/auth/seed-users.ts] |
| **D5** | **Migración 0038 como última migración e intocabilidad de previas** | La migración `0038_r2_perf_indexes.sql` añade índices de rendimiento (`idx_orders_created_at_ms`, `idx_orders_cash_session_id`, `idx_orders_location_id`). Las migraciones 0001 a 0037 son inmutables. | Modificar migraciones antiguas o aplicar scripts destructivos de alteración. | Corrupción irrecuperable de bases de datos existentes en sedes operativas y fallos en checksums de migración. | [VERIFICADO: apps/server/src/db/migrations/0038_r2_perf_indexes.sql, apps/server/src/db/migrate.ts] |
| **D6** | **Cajera autorizada para cerrar su propio turno (`CASHIER_PLUS`)** | Agilidad operativa al finalizar el turno de caja sin requerir presencia física obligatoria del supervisor para el arqueo. | Exigir `ADMIN_SUPERVISOR` para todo cierre de sesión/jornada. | Bloqueo del personal de caja al culminar turno si el supervisor o admin no están en la estación. | [DECLARADO por el dueño el 2026-11-01; VERIFICADO: commit `ea1130e` en apps/server/src/config/route-policy.ts] |
| **D7** | **Lockout de PINs (M12) desbloqueable por `admin` y `supervisor`** | Protección contra ataques de fuerza bruta en terminales físicas, manteniendo el control de desbloqueo en los rangos de supervisión. | Desbloqueo exclusivo por `admin` o desactivación total del lockout. | Bloqueo permanente de cajeras/mesoneros en caso de fallos de PIN sin presencia del dueño/admin. | [DECLARADO por el dueño el 2026-11-01; VERIFICADO en route-policy.ts#L39-40 y apps/server/src/routes/auth.ts] |
| **D8** | **Estrategia de Rama Única (`r2/go-live`) por Máxima Eficiencia** | Evitar sobrecarga y fricción de cambio de ramas o sincronización de múltiples worktrees en el monorepo local. Commits atómicos directos sobre `r2/go-live`. | Múltiples worktrees (`r2/ola-1`, `r2/ola-2`, `r2/lite-*`). | Conflictos de fusión complejos y pérdida de visibilidad del estado global del sistema. | [DECLARADO por el dueño el 2026-11-01; VERIFICADO en git branch actual `r2/go-live`] |

---

## 4. HISTORIAL DE INCIDENTES Y SOLUCIONES

### INC-01: Extracción manual de suministros del auditor
- **Síntoma:** Los 5 archivos base de la auditoría de seguridad R2 no se integraron mediante ramas directas de git.
- **Causa raíz:** Los artefactos fueron entregados dentro de un archivo comprimido externo (`tocineta-contexto-20261101-0215.zip`).
- **Solución:** Extracción y colocación manual de los 5 archivos en sus rutas canónicas (`route-policy.ts`, `session.ts`, `auth-guard.ts`, `0038_r2_perf_indexes.sql`, `r2-route-policy.test.ts`), consolidándolos en el commit base de auditoría.
- **Evidencia:** Commit `d2269d4` ("chore(r2-pre0): archivos base de auditoria...") [VERIFICADO: git show --stat d2269d4].
- **Cómo evitarlo:** Suministrar siempre cambios mediante ramas o parches git (`git format-patch`) en lugar de archivos comprimidos sueltos.

### INC-02: Suplantación de identidad por cabecera `x-user-id` (BUG-02 / Gap 1)
- **Síntoma:** Peticiones HTTP a endpoints sensibles podían ejecutar operaciones en nombre de cualquier usuario enviando la cabecera `x-user-id` sin token de sesión válido.
- **Causa raíz:** Múltiples controladores del backend extraían el identificador de usuario directamente de `req.headers['x-user-id']` sin autenticar la sesión contra SQLite.
- **Solución:** Extirpación formal de la lectura de `x-user-id` en controladores de caja, cierres y reportes; implementación de `getSessionUserByToken` en `apps/server/src/modules/auth/session.ts` y cableado del plugin `auth-guard.ts` que inyecta `request.user` autenticado. Suite de pruebas `r2-impersonation.test.ts` agregada.
- **Evidencia:** Commit `4dbe96c` ("feat/fix(p1-b): extirpar suplantacion de identidad (Gap 1)") y commit `b3eab54` [VERIFICADO: git show --stat 4dbe96c, b3eab54].
- **Cómo evitarlo:** Nunca leer la identidad del usuario desde cabeceras no verificadas; consumir exclusivamente la propiedad `request.user` provista por el middleware central de autenticación.

### INC-03: Pérdida de ventas en el `outbox` offline (BUG-06)
- **Síntoma:** En situaciones de red inestable o fallos de autenticación (errores HTTP 401, 403 o 500), el outbox offline descartaba pedidos pendientes de sincronización de IndexedDB, perdiendo la venta registrada.
- **Causa raíz:** Lógica de manejo de errores en el cliente web que interpretaba cualquier respuesta de error como transacción completada o descartable.
- **Solución:** Clasificación de respuestas de red para que el outbox retenga pedidos localmente con reintento seguro y alerta visible al cajero (programado formalmente para Oleada 3 en P3-A).
- **Evidencia:** Registro en `PLAN-DE-EJECUCION.md#L30` [VERIFICADO] y Contexto del Dueño [DECLARADO].
- **Cómo evitarlo:** Aplicar política de "nunca perder una comanda" en almacenamiento local persistente; solo eliminar registros del outbox ante confirmación 2xx explícita del servidor.

### INC-04: Falla de carga y desalineación de moneda en Cierre Z
- **Síntoma:** El wizard de Cierre Z de caja fallaba al cargar o presentaba totales distorsionados en USD al agrupar pagos mixtos.
- **Causa raíz:** Falta de un endpoint dedicado para resumen Z que desglosara formalmente los montos en micro-Bs y Bolívares por método de pago.
- **Solución:** Creación del endpoint `/api/closures/z-summary`, inclusión de utilidades de conversión en `@tocineta/shared` (`payment-method-currency.ts`) y ajuste en los componentes visuales de cierre de caja.
- **Evidencia:** Commit `a7f3f12` ("fix(go-live): cierre Z carga y desglose en Bs") [VERIFICADO: git show --stat a7f3f12].
- **Cómo evitarlo:** Mantener los cálculos y agrupaciones de monedas en paquetes compartidos testeados unitariamente (`packages/shared/test/payment-method-currency.test.ts`).

### INC-05: Mezcla de archivos en commits informales ("awa"/"awita2") y asunciones en tests de impresión
- **Síntoma:** Commits con mensajes informales ("awa", "awita2") incorporaron simultáneamente cambios en inventario, spooler de impresión y scripts de Windows; tests de flujo de impresión fallaron al asumir configuración `print_mode = 'two'`.
- **Causa raíz:** Falta de atomicidad en los commits de desarrollo rápido y ausencia de aislamiento en tests que dependían de `business_settings`, cuyo valor por defecto en base de datos es `'one'`.
- **Solución:** Ajuste en `apps/server/test/r2-print-release-auth.test.ts` para forzar la configuración de prueba y restaurarla en el bloque `afterAll`; creación de `spooler-guard.ts` para mitigar bloqueos de USB en Windows.
- **Evidencia:** Commits `3515a2f`, `b694fd4`, `042f890` [VERIFICADO].
- **Cómo evitarlo:** Respetar la nomenclatura estándar de commits de gobernanza (`feat(...)`, `fix(...)`), evitar commits masivos mixtos, y asegurar que cada test restaure el estado global de la base de datos de pruebas.

### INC-06: Discrepancia entre reportes verbales/planes y el historial real de git
- **Síntoma:** En documentos de planificación (`PLAN-DE-EJECUCION.md`) y reportes verbales se declaraba que los lotes L-2 a L-10 estaban "sin commit" y se usaban hashes ficticios (`a1b2c3d`), cuando en realidad git log contenía ya los commits reales de L-2 a L-9 (`23fc2d7`, `66b1ac8`, `d5123a8`, `ea8e394`, `69b6e6e`, `387b30a`, `aecab15`).
- **Causa raíz:** Avance asíncrono y veloz entre subagentes sin reconciliación estricta de `git log` antes de generar informes.
- **Solución:** Adopción obligatoria de inspección directa de `git log --oneline` y `git status` como única fuente de verdad técnica en esta bitácora.
- **Evidencia:** Registro de commits en git log frente a la tabla de `PLAN-DE-EJECUCION.md` [VERIFICADO].
- **Cómo evitarlo:** El documentalista técnico debe contrastar siempre cada declaración contra comandos de solo lectura de git antes de reportar estados.

---

## 5. MAPA DE PROMPTS Y COMMITS (TRAZABILIDAD)

| Prompt | Agente / Modelo | Objetivo | Archivos afectados | Commit | Estado | Evidencia |
|:---|:---|:---|:---|:---|:---|:---|
| **Pre-0** | Auditor / Humano | Integrar los 5 archivos base de seguridad extraídos del ZIP | `route-policy.ts`, `session.ts`, `auth-guard.ts`, `0038_r2_perf_indexes.sql`, `r2-route-policy.test.ts` | `d2269d4` | Commiteado | [VERIFICADO: git show --stat d2269d4] |
| **P1-A** | Arquitecto (Flash 3.8) | Registrar auth-guard en server.ts y sanitizar URLs en error-handler.ts en MODO WARN | `apps/server/src/server.ts`, `apps/server/src/lib/error-handler.ts`, `apps/server/test/r2-auth-guard.test.ts`, `apps/server/test/test-helpers.ts` | `b3eab54` | Commiteado | [VERIFICADO: git show --stat b3eab54] |
| **P1-D** | Arquitecto (Flash 3.8) | Proteger `init-prod`, credenciales seguras de admin y permiso de cierre de jornada | `apps/server/src/config/route-policy.ts`, `apps/server/src/db/fresh-prod.ts`, `apps/server/src/modules/auth/pin.ts`, `apps/server/src/modules/auth/seed-users.ts`, `apps/server/src/routes/auth-actions.ts` | `ea1130e` | Commiteado | [VERIFICADO: git log ea1130e (tag `fase-p1-d`)] |
| **P1-B** | Arquitecto (Flash 3.8) | Eliminar uso de cabecera `x-user-id` y consumir `request.user` autenticado | `apps/server/src/modules/cashier/routes.ts`, `apps/server/src/modules/closures/routes.ts`, `apps/server/src/modules/reports/routes.ts`, `apps/server/test/r2-impersonation.test.ts` | `4dbe96c` | Commiteado | [VERIFICADO: git log 4dbe96c (tag `fase-p1-b` en ea8e394)] |
| **P1-C** | Arquitecto (Flash 3.8) | Unificar validación de sesión con `getSessionUserByToken` y cerrar Oleada 1 | Rutas de backups, settings, cupones, delivery, emergency, kds, menu, orders, printing, staff, transfers, updater; `r2-session-validation.test.ts` | `b3eab54` | Commiteado | [VERIFICADO: git log b3eab54 (tag `r2-ola-1`)] |
| **P2-A** | Arquitecto (Flash 3.8) / Lite 3.5 | Crear cliente centralizado `apiFetch` y autenticación en WebSocket | `apps/web/src/api/client.ts`, `apps/web/src/hooks/useEventStream.ts` | `387b30a` | Commiteado | [VERIFICADO: git log 387b30a y repo base] |
| **L-1** | Mecánico (Flash-Lite 3.5) | Migración a `apiFetch` en frontend Lote 1 (4 archivos) | `apps/web/src/App.tsx`, `components/AppLayout.tsx`, `components/MenuAdminView.tsx`, `components/QrMenuWebAdminView.tsx` | Base / `b3eab54` | Commiteado | [VERIFICADO en historial git] |
| **L-2 & L-4** | Mecánico (Flash-Lite 3.5) | Migración a `apiFetch` en Lotes 2 y 4 (componentes, impresión, delivery) | `SupportBanner.tsx`, `SystemHealthDashboard.tsx`, `ViewErrorBoundary.tsx`, `AccessQrView.tsx`, `ClientErrorsView.tsx`, `WorkerRegisterForm.tsx`, `TicketPreviewModal.tsx`, `ApplyCouponModal.tsx`, `DriverManagementTab.tsx`, `DriverSettlementModal.tsx`, `DeferredPaperView.tsx` | `23fc2d7` | Commiteado | [VERIFICADO: git show --stat 23fc2d7] |
| **L-3** | Mecánico (Flash-Lite 3.5) | Migración a `apiFetch` en módulo `cashier` | Archivos de vista y utilidades en `apps/web/src/features/cashier/` | `66b1ac8` | Commiteado | [VERIFICADO: git show --stat 66b1ac8] |
| **L-5** | Mecánico (Flash-Lite 3.5) | Migración a `apiFetch` en finanzas, home y KDS | `FinancesDashboardView.tsx`, `useFinancesQueries.ts`, `HomeView.tsx`, `KdsView.tsx` | `d5123a8` | Commiteado | [VERIFICADO: git show --stat d5123a8] |
| **L-6** | Mecánico (Flash-Lite 3.5) | Migración a `apiFetch` en KDS actions, socios, panel de dueña, POS e inventario | `useKdsActions.ts`, `OwnerDashboardView.tsx`, `usePartnersData.ts`, `AuthorizeModal.tsx`, `PosComandero.tsx`, `Step1CustomerChannel.tsx`, `InventoryView.tsx` | `ea8e394` | Commiteado | [VERIFICADO: git show --stat ea8e394] |
| **L-7** | Mecánico (Flash-Lite 3.5) | Migración a `apiFetch` en rentabilidad y compras | `ProfitabilityDashboard.tsx`, `PurchasesView.tsx`, `RecipesView.tsx`, `WasteView.tsx`, `CsvDataImportCard.tsx`, `DispatchNoteSuccessModal.tsx`, `NewPurchaseModal.tsx` | `69b6e6e` | Commiteado | [VERIFICADO: git show --stat 69b6e6e] |
| **L-8** | Mecánico (Flash-Lite 3.5) | Migración a `apiFetch` en modales de rentabilidad | `NewSupplyModal.tsx`, `ProductionModal.tsx`, `RecipeEditorModal.tsx`, `StockCountModal.tsx`, `SubRecipeEditorModal.tsx`, `TransferBatchesModal.tsx` | `387b30a` | Commiteado | [VERIFICADO: git show --stat 387b30a] |
| **L-9** | Mecánico (Flash-Lite 3.5) | Migración a `apiFetch` en cotizaciones, transferencias y ajustes | `TransferDishEquivalentMode.tsx`, `TransferModal.tsx`, `WasteRegisterModal.tsx`, `EventQuotesView.tsx`, `useQuotesData.ts`, `BusinessSettingsView.tsx` | `aecab15` | Commiteado | [VERIFICADO: git show --stat aecab15 (HEAD)] |
| **L-10** | Mecánico (Flash-Lite 3.5) | Migración a `apiFetch` en impresoras, liquidación de personal y tasa BCV | `PrintersPanel.tsx`, `SettlementModal.tsx`, `useStaffData.ts`, `BcvRateModal.tsx` (respetando `window.open` y `refetchStaff`) | `(en staging)` | Hecho sin commit | [DECLARADO por el dueño; VERIFICADO en git status] |
| **P2-B** | Arquitecto (Flash 3.8) | Modal no descartable de cambio obligatorio de PIN ante `must_change_pin = 1` | `ChangePinModal.tsx`, `pin-utils.ts`, `Modal.tsx`, `AuthContext.tsx`, `LoginView.tsx`, `AppLayout.tsx`, `apps/server/src/routes/auth.ts` | `(en staging)` | Hecho sin commit | [VERIFICADO en git status y código fuente] |
| **P2-D** | Arquitecto (Flash 3.8) | Optimización de polling en `PrintAttentionModal.tsx` (3s alerta / 30s reposo / pausa en hidden) | `apps/web/src/features/cashier/PrintAttentionModal.tsx`, `apps/web/src/components/AppLayout.tsx` | `(en staging)` | Hecho sin commit | [VERIFICADO en git status y código fuente] |
| **P3-A** | Arquitecto (Flash 3.8) | Blindaje de Outbox offline (retención ante 4xx/5xx en IndexedDB) | `apps/web/src/features/pos/outbox.ts`, `apps/web/src/features/pos/usePosCart.ts` | `(sin iniciar)` | Pendiente | [DECLARADO por el dueño (Oleada 3)] |

---

## 6. DEUDA TÉCNICA Y FASE C

### Ejes no auditados de la Fase C
1. **Reembolsos y Devoluciones:** Ausencia de flujo formal de contra-asiento contable en caja; se requiere registrar la devolución sin borrar transacciones históricas ni desbalancear el arqueo [DECLARADO por el dueño].
2. **Impresión ESC/POS en hardware físico:** El sistema ha sido probado en modo de simulación (`PRINTER_DEV_SIMULATION`); falta verificar secuencias de bytes reales, cortes parciales de papel y manejo de cajón de dinero en impresoras térmicas físicas de 58mm y 80mm [DECLARADO por el dueño].
3. **Multi-sede e inventario controlado:** Mecanismos de transferencia y control de stock entre sedes Alta Vista y Los Olivos; falta auditar la consistencia de inventario centralizado frente a desconexiones de red local [DECLARADO por el dueño].
4. **Nómina, socios y cupones:** Auditoría pendiente de los módulos de reparto de propinas, liquidaciones a repartidores y validación de doble aplicación de cupones [DECLARADO por el dueño; verificado parcialmente en migraciones históricas 0012 a 0015].

### Marcadores de Tareas Pendientes en Código (`TODO`)
- Ejecución de comando de verificación `git grep -n "TODO("` arrojó **2 coincidencias activas en código fuente del backend** [VERIFICADO: git grep -n "TODO("]:
  1. `apps/server/src/modules/closures/routes.ts:13`: `// TODO(M12): Bloquear o endurecer autorización por PIN en P3-C` [VERIFICADO].
  2. `apps/server/src/modules/profitability/fase3-routes.ts:556`: `// TODO(M12): lockout check / increment failed attempts` [VERIFICADO].
- Comentarios de gobernanza resueltos en `route-policy.ts`:
  - `apps/server/src/config/route-policy.ts:39`: `M12: lockout` (resuelto por decisión D7: desbloqueo por `admin` y `supervisor`).
  - `apps/server/src/config/route-policy.ts:83`: `DECISION_NEGOCIO` en `/api/jornadas/close` (resuelto por decisión D6: cajera autorizada en `CASHIER_PLUS`).
  - `apps/server/src/config/route-policy.ts:93`: `DECISION_NEGOCIO` en reportes de corte parcial X (`/api/cash-sessions/:id/report`).
  - `apps/server/src/config/route-policy.ts:124`: `DECISION_NEGOCIO` en consulta de órdenes pagadas (`/api/orders/paid`).

### Riesgos y Observaciones Detectadas
1. **MCP SQLite en Entorno de Desarrollo:** El MCP configurado en `.gemini/mcp.json` apunta a la base de datos local `apps/server/data/tocineta-dev.db`. Está estrictamente prohibido redirigir este servidor hacia bases de datos de producción para evitar bloqueos por cerrojo de archivo (`database is locked`) o corrupciones [VERIFICADO: .gemini/mcp.json; DECLARADO].
2. **Archivos Listos en Staging Pendientes de Commit:** Hay 14 archivos modificados o agregados en el índice de git (`git status`) combinando L-10, P2-B y P2-D. Se recomienda al dueño realizar commits atómicos ordenados para preservar la trazabilidad limpia de la Oleada 2 antes de iniciar la Oleada 3 [INFERIDO].
3. **Llamadas `fetch` intencionalmente preservadas para Oleada 3:** En `apps/web/src/features/pos/outbox.ts` y `apps/web/src/features/pos/usePosCart.ts` existen llamadas `fetch` nativas que fueron excluidas a propósito del trabajo del Mecánico para no interferir con el rediseño integral de persistencia offline programado en P3-A [DECLARADO por el dueño; VERIFICADO en exclusiones de código].

---

## 7. INSTRUCCIONES PARA EL YO DEL FUTURO (O UN NUEVO DEV)

### Checklist Numerado de Retoma
1. **Lectura obligatoria:** Leer esta bitácora (`BITACORA-DE-CONTEXTO.md`) para entender el estado de avance real, decisiones consolidadas y los incidentes previos.
2. **Revisar estado de git:** Ejecutar `git status --short` y `git log --oneline -n 10` para verificar la rama actual (`r2/go-live`) y comprobar si los cambios preparados de Oleada 2 ya fueron commiteados por el dueño.
3. **Verificación de base de datos:** Comprobar que `.gemini/mcp.json` apunte únicamente a `apps/server/data/tocineta-dev.db`.
4. **Verificación de salud del proyecto (sin tocar código):**
   - Ejecutar suite de pruebas: `pnpm --filter @tocineta/server run test`
   - Validar sistema de tipos: `pnpm -r exec tsc --noEmit`
   - Validar gobernanza visual de interfaz: `pnpm run guard`
5. **Revisar dudas abiertas:** Consultar la Sección 8 de este documento antes de planificar la Oleada 3.

### Lo que NO debes hacer
- **NO modificar los archivos base de seguridad ya auditados y congelados:** `route-policy.ts`, `session.ts`, `auth-guard.ts`, `0038_r2_perf_indexes.sql` y `r2-route-policy.test.ts`.
- **NO alterar las decisiones de la Sección 3:** No reactivar bloqueo por inactividad (D1), no inventar roles fuera de los 6 canónicos (D2), no quitar el token de la URL en WebSocket (D3), ni forzar cambio de PIN a roles operativos (D4).
- **NO modificar migraciones anteriores a la 0038:** Toda alteración de base de datos debe ser en una migración nueva forward-only (ej. `0039_...sql`).
- **NO tocar `outbox.ts` ni `usePosCart.ts` con cambios mecánicos:** La lógica offline está reservada exclusivamente para el Arquitecto (3.8) en el prompt P3-A.
- **NO hacer commits con nombres informales ni destructivos:** Prohibido `git push --force`, `git reset --hard` o nombres como "awa". Usar siempre la convención `feat(...)` o `fix(...)`.

---

## 8. PREGUNTAS ABIERTAS PARA EL DUEÑO

*Historial de consultas resueltas previamente (2026-11-01):*
1. [RESUELTO] Ubicación de hojas de prompts: Carpeta `guias/` en la raíz.
2. [RESUELTO] Permisos en Cierre de Jornada: Cajera autorizada en `CASHIER_PLUS` (Decisión D6).
3. [RESUELTO] Estrategia de ramas git: Rama única `r2/go-live` con commits atómicos (Decisión D8).
4. [RESUELTO] Lockout de PINs (M12): Desbloqueo por `admin` y `supervisor` (Decisión D7).
5. [RESUELTO] Modificaciones de frontend L-1: Confirmadas como Lote 1 de Flash-Lite 3.5.

*Nuevas preguntas abiertas para el dueño:*
1. **[POR CONFIRMAR] Estrategia de commit para los archivos actualmente preparados en staging:**  
   En el índice de git (`git status`) se encuentran preparados 14 archivos que integran el trabajo de tres prompts completados: L-10 (`PrintersPanel.tsx`, `SettlementModal.tsx`, `useStaffData.ts`, `BcvRateModal.tsx`), P2-B (`ChangePinModal.tsx`, `pin-utils.ts`, `Modal.tsx`, `AuthContext.tsx`, `LoginView.tsx`, `auth.ts`) y P2-D (`PrintAttentionModal.tsx`, `AppLayout.tsx`).  
   ¿Desea el dueño consolidar estos cambios en un único commit atómico de cierre de Oleada 2 (ej. `feat(r2-ola-2): cierre oleada 2 (lote 10, pin no descartable y polling impresion)`), o prefiere que se dividan en commits independientes por prompt (`refactor(L-10)`, `feat(p2-b)`, `feat(p2-d)`)?
2. **[POR CONFIRMAR] Sincronización del archivo `PLAN-DE-EJECUCION.md`:**  
   El archivo `PLAN-DE-EJECUCION.md` se encuentra en staging pero contiene estados desactualizados (cita hashes de ejemplo `a1b2c3d`, marca L-2/L-3 en curso y L-4 a L-10 en cola). ¿Desea el dueño que actualicemos ese archivo en una tarea futura o se mantiene `BITACORA-DE-CONTEXTO.md` como la fuente de verdad técnica prevalente?
3. **[POR CONFIRMAR] Marcadores `TODO(M12)` detectados en el servidor:**  
   Se detectaron dos comentarios `TODO(M12)` activos en `apps/server/src/modules/closures/routes.ts:13` y `apps/server/src/modules/profitability/fase3-routes.ts:556`. ¿Se incluirá su resolución dentro de la Oleada 3 (ej. en P3-C para endurecimiento de autorizaciones) o quedan formalmente postergados para la Fase C de auditoría general?

---

## 9. DISCREPANCIAS DETECTADAS

| Qué se declaró | Qué muestra el repo | Dónde | Acción sugerida |
|:---|:---|:---|:---|
| Se declaró que los lotes L-2 a L-10 estaban todos "Hecho sin commit" en el árbol de trabajo actual. | En `git log` se verificó que los lotes L-2 a L-9 ya están debidamente commiteados en 7 commits (`23fc2d7`, `66b1ac8`, `d5123a8`, `ea8e394`, `69b6e6e`, `387b30a`, `aecab15`). Solo L-10 permanece sin commit en el árbol de trabajo. | `git log --oneline` vs bloque "Contexto del Dueño" | [RESUELTO EN BITÁCORA] Se clarifica que L-2 a L-9 están formalmente commiteados; solo L-10 aguarda commit junto a P2-B y P2-D. |
| Se declaró que el Arquitecto (3.8) está "terminando P2-B y P2-D". | Los componentes de P2-B (`ChangePinModal.tsx`, `pin-utils.ts`, no descartabilidad en `Modal.tsx`, persistencia en `AuthContext.tsx` y `routes/auth.ts`) y P2-D (`PrintAttentionModal.tsx` con polling 3s/30s y pausa en hidden) ya están completamente escritos, cableados en `AppLayout.tsx` y preparados en staging. | `git status --short` y lectura de código fuente | [RESUELTO EN BITÁCORA] Se eleva el estado de P2-B y P2-D a "Hecho sin commit" en lugar de "En progreso", listos para commit del dueño. |
| `PLAN-DE-EJECUCION.md` declara Oleada 1 con hashes ficticios (`a1b2c3d`, `e4f5g6h`, etc.) y L-2 a L-10 en curso/cola. | El repositorio contiene el commit consolidado `b3eab54` con tag oficial `r2-ola-1` que cierra Oleada 1, y los commits reales de L-2 a L-9. | `PLAN-DE-EJECUCION.md` vs `git log` y `git tag` | Tratar `BITACORA-DE-CONTEXTO.md` como la única fuente canónica de verdad y sincronizar `PLAN-DE-EJECUCION.md` cuando el dueño lo autorice. |
| En bitácora previa se reportaron 0 coincidencias de `TODO(`. | `git grep -n "TODO("` detecta 2 comentarios activos en `closures/routes.ts:13` y `profitability/fase3-routes.ts:556`. | Código fuente del servidor | [RESUELTO EN BITÁCORA] Documentadas ambas ocurrencias en la Sección 6 y remitidas a consulta en la Sección 8. |

---

## 10. REGISTRO DE CAMBIOS DE ESTA BITÁCORA

- **2026-11-01 (1ra edición):** Creación inicial de `BITACORA-DE-CONTEXTO.md` como fuente única de verdad. Documentación de auditoría R2, sincronización de discrepancias de plan vs git, verificación de archivos base de seguridad y definición del checklist de retoma. Referencia de commit: `d2269d4`.
- **2026-11-01 (2da edición):** Incorporación de resoluciones del dueño para las 5 preguntas abiertas: verificación de rutas en `guias/`, aprobación de cierre de turno por cajera (D6), confirmación de desbloqueo de PIN por admin y supervisor (D7), adopción de rama única `r2/go-live` (D8), y consolidación del estado de L-1 como Hecho sin commit.
- **2026-11-01 (3ra edición):** Cierre y consolidación de la Oleada 1 verificado con tag `r2-ola-1` en commit `b3eab54`. Verificación en historial git de commits L-2 a L-9 (`aecab15`). Registro de culminación técnica de L-10 (Mecánico), P2-B (Modal de PIN obligatorio no descartable) y P2-D (Optimización de polling de impresión) en estado "Hecho sin commit" en staging. Detección y documentación de 2 marcadores `TODO(M12)` en backend.
