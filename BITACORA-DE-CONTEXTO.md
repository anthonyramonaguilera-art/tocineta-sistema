# BITÁCORA TÉCNICA Y DE CONTEXTO — TOCINETA
Última actualización: 2026-11-01 · Rama: r2/go-live · Último commit: da8c0e6 test(P5-A): paridad Z vs financial truth (0 centavos diferencia)

---

## 1. RESUMEN EJECUTIVO Y ESTADO ACTUAL

- **Oleada / Fase actual:**
  - **Fase de Blindaje Backend y Frontend (Oleadas 1, 2 y 3) 100% COMPLETADA y sellada en git** [VERIFICADO: git log `da8c0e6`].
  - **Parche de Consolidación QA / Go-Live (Olas A, B y C) en preparación:** Planificación y especificación técnica exhaustiva para subsanar los hallazgos de campo de dinero, cierre Z, catálogo y UX móvil.
  - La suite de pruebas de servidor cuenta con **410 pruebas unitarias aprobadas de 414** (52 archivos verdes, 4 fallos documentados por desalineación de tests antiguos con blindajes nuevos) [VERIFICADO: ejecución Vitest 2026-11-01].
  - Gobernanza de diseño UI (`pnpm run guard`) y compilación TypeScript (`tsc --noEmit` en web y server) se encuentran en **0 errores** [VERIFICADO: ejecución en consola].

- **Completado (con evidencia en repo):**
  - **Oleada 1 — Seguridad Backend (Tag oficial `r2-ola-1` en commit `b3eab54`):**
    - P1-A: Guard global `registerAuthGuard` y sanitización de URLs en `error-handler.ts` [VERIFICADO: commit `b3eab54`].
    - P1-D: Blindaje de `init-prod`, `seed-demo`, resguardo de credenciales admin y cierre Z de jornada [VERIFICADO: commit `ea1130e`].
    - P1-B: Extirpación sistemática de suplantación de identidad `x-user-id` y consumo exclusivo de `request.user` [VERIFICADO: commit `4dbe96c`].
    - P1-C: Unificación canónica de sesiones con `getSessionUserByToken` [VERIFICADO: commit `b3eab54`].
  - **Oleada 2 — Cliente Seguro y Frontend (Commit consolidado `da48375`):**
    - P2-A: Cliente centralizado `apiFetch` y `apiJson` con inyección automática de Bearer token [VERIFICADO: `apps/web/src/api/client.ts`].
    - Lotes L-1 a L-10: Migración exhaustiva de `fetch` crudo a `apiFetch` en los 10 lotes de componentes y vistas [VERIFICADO: commits `23fc2d7`, `66b1ac8`, `d5123a8`, `ea8e394`, `69b6e6e`, `387b30a`, `aecab15`, `da48375`].
    - P2-B: Modal no descartable de cambio obligatorio de PIN (`ChangePinModal.tsx`) con bloqueo de interacción en `AppLayout.tsx` ante `must_change_pin = 1` [VERIFICADO: commit `da48375`].
    - P2-D: Polling adaptativo en `PrintAttentionModal.tsx` (3s alerta / 30s reposo / pausa en `document.hidden`) [VERIFICADO: commit `da48375`].
  - **Oleada 3 — Resiliencia Operativa, Outbox y KDS (Commit consolidado `8d290c4`):**
    - P3-A: Blindaje de Outbox offline en IndexedDB con clasificación de errores de red (retiene en 401/403/408/429/5xx, no pierde comandas) [VERIFICADO: commit `0b11687`].
    - P3-B: Inmutabilidad de órdenes en cocina y guardia de estado 409 Conflict en despacho [VERIFICADO: commit `b302c1c`].
    - P3-C / SEV-203: Limitador de fuerza bruta de PINs autorizadores (`authorizer-guard.ts`) con bloqueo temporal (423) y registro inmutable en auditoría [VERIFICADO: commit `8d290c4`].
  - **Paridad Z vs Verdad Financiera (SEV-201):**
    - P5-A: Suite de prueba `r2-z-vs-truth-parity.test.ts` con paridad exacta de 0 centavos de discrepancia entre Cierre Z, resumen y libro contable [VERIFICADO: commit `da8c0e6`].

- **En progreso:**
  - Despliegue de la **Ola A (Dinero P0)** y **Ola B (Cierre y Operación P1)** para corregir los hallazgos críticos detectados en pruebas con usuarios reales (BUG-01 a BUG-05, N-01 a N-05).

- **Bloqueado o pendiente:**
  - Autorización explícita del dueño para actualizar `config/route-policy.ts` (propuesta D9) permitiendo descargas de PDF/Excel a la cajera (`CASHIER_PLUS`).
  - Definición del alcance para Ítem Libre en POS (N-11) y campos de Ficha Técnica (N-10).

---

## 2. SETUP DEL ENTORNO Y HERRAMIENTAS

### MCP de SQLite
- **Ubicación obligatoria:** Debe apuntar estrictamente a `apps/server/data/tocineta-dev.db` [VERIFICADO: `.gemini/mcp.json#L9`].
- **Prohibición absoluta:** NUNCA debe apuntar a la base de datos de producción (`tocineta.db` o equivalentes en despliegue) [DECLARADO].
- **Verificación:** Inspeccionar `.gemini/mcp.json`, verificando que el parámetro `--db-path` contenga la ruta terminada en `apps/server/data/tocineta-dev.db`.
- **Uso seguro:** Inspección de esquemas y diagnóstico de consultas en desarrollo. Cualquier modificación estructural se debe realizar exclusivamente mediante archivos `.sql` numerados en `apps/server/src/db/migrations/`.

### Flujo y Especialización de Agentes
- **Guías Oficiales:**
  - `guias/PROMPTS-GEMINI-3.8-FLASH.md`: Prompts para el Arquitecto (lógica, dinero, seguridad, DB, arquitectura) [DECLARADO].
  - `guias/PROMPTS-GEMINI-3.5-FLASH-LITE.md`: Prompts para el Mecánico (tareas visuales mecánicas de UI, estilos, etiquetas) [DECLARADO].
- **Arquitecto (Gemini 3.8 Flash):** Lógica central de caja, cálculo de divisas, libro contable, guard global, cierres Z, KDS y migraciones. No se le pide refactorización masiva de estilos de UI.
- **Mecánico (Gemini 3.5 Flash-Lite):** Tareas cosméticas y componentes visuales de UI (modales, buscadores, chips, scroll). NUNCA se le entrega lógica de dinero, sesión, KDS, impresión ni outbox [DECLARADO].
- **Orquestador humano:** Asigna prompts, revisa diffs, corre validaciones (`guard`, `lint`, `test`) y realiza los commits atómicos.

### Comandos Vitales del Repositorio
- **Tests del Servidor:**
  - `pnpm --filter @tocineta/server exec vitest run` (suite completa) [VERIFICADO: `package.json#L9`].
- **Verificación de Tipos TypeScript:**
  - `pnpm --filter @tocineta/server run lint` (valida server: `tsc --noEmit`) [VERIFICADO: `apps/server/package.json#L11`].
  - `pnpm --filter @tocineta/web exec tsc --noEmit` (valida web) [VERIFICADO].
- **Validador de Gobernanza UI:**
  - `pnpm run guard` (ejecuta `node scripts/ui-guard.mjs`, reglas WCAG, tokens semánticos y cero emojis) [VERIFICADO: `package.json#L10`].

---

## 3. DECISIONES DE NEGOCIO Y ARQUITECTURA (NO MODIFICAR A CIEGAS)

| ID | Decisión | Motivo | Alternativa descartada | Riesgo si se cambia | Evidencia |
|:---|:---|:---|:---|:---|:---|
| **D1** | **Bloqueo por inactividad desactivado en terminales operativas** | Cero fricción operativa durante horas pico de servicio en caja, KDS y comanderos. | Bloqueo por temporizador tras X minutos de inactividad. | Bloqueo accidental en pleno cobro o despacho, retrasos graves en atención al cliente. | [DECLARADO; VERIFICADO en `AuthContext.tsx#L63-65`] |
| **D2** | **Roles válidos canónicos en Base de Datos** | La base de datos y los checks de seguridad admiten únicamente 6 roles en minúsculas: `admin`, `supervisor`, `cajera`, `mesonero`, `cocinero`, `despachador`. | Uso de roles cosméticos o en mayúsculas como `PLANCHA`, `MESERO`, `DESPACHO`, `CAJERA`. | Fallos de integridad en base de datos, bloqueo por denegación en `ROLES_BY_LEVEL`. | [VERIFICADO: `schema.ts#L29`, `route-policy.ts#L4-6`] |
| **D3** | **WebSocket y Eventos con token por URL** | `EventSource` (SSE) y el constructor `WebSocket` del navegador no admiten cabeceras HTTP `Authorization` personalizadas en LAN sin HTTPS. | Autenticación exclusivamente por cabeceras `Authorization: Bearer`. | Imposibilidad de conectar KDS y comanderos en red local sin conexión a Internet o certificados SSL. | [DECLARADO; VERIFICADO en `auth-guard.ts#L42-49`] |
| **D4** | **Usuarios operativos nacen con PIN conocido y must_change_pin = 0** | Permitir arranque inmediato de personal de cocina y piso sin forzar pantallas de cambio de credenciales en primera apertura. Solo `admin` requiere cambio. | Forzar `must_change_pin = 1` para todos los usuarios nuevos. | Detención del flujo de caja y despacho en despliegues frescos si el personal no tiene acceso administrativo. | [DECLARADO; VERIFICADO en `schema.ts#L40`, `seed-users.ts`] |
| **D5** | **Migración 0038 como última migración e intocabilidad de previas** | La migración `0038_r2_perf_indexes.sql` añade índices de rendimiento. Las migraciones 0001 a 0038 son inmutables (nota: la 0033 no existe por salto numérico histórico, no debe crearse retrospectivamente). | Modificar migraciones antiguas o aplicar scripts destructivos de alteración. | Corrupción irrecuperable de bases de datos existentes en sedes operativas y fallos en checksums. | [VERIFICADO: `0038_r2_perf_indexes.sql`, `migrate.ts`] |
| **D6** | **Cajera autorizada para cerrar su propio turno (`CASHIER_PLUS`)** | Agilidad operativa al finalizar el turno de caja sin requerir presencia física obligatoria del supervisor para el arqueo. | Exigir `ADMIN_SUPERVISOR` para todo cierre de sesión/jornada. | Bloqueo del personal de caja al culminar turno si el supervisor o admin no están en la estación. Requiere actualizar `closeJornadaZ` en `closures-service.ts`. | [DECLARADO el 2026-11-01; VERIFICADO en `route-policy.ts:90`] |
| **D7** | **Lockout de PINs (M12 / SEV-203) desbloqueable por `admin` y `supervisor`** | Protección contra ataques de fuerza bruta en terminales físicas, manteniendo el control de desbloqueo en los rangos de supervisión. | Desbloqueo exclusivo por `admin` o desactivación total del lockout. | Bloqueo permanente de cajeras/mesoneros en caso de fallos de PIN sin presencia del dueño/admin. | [DECLARADO; VERIFICADO en `authorizer-guard.ts`] |
| **D8** | **Estrategia de Rama Única (`r2/go-live`) por Máxima Eficiencia** | Evitar sobrecarga y fricción de cambio de ramas o sincronización de múltiples worktrees en el monorepo local. Commits atómicos directos sobre `r2/go-live`. | Múltiples worktrees (`r2/ola-1`, `r2/ola-2`, `r2/lite-*`). | Conflictos de fusión complejos y pérdida de visibilidad del estado global del sistema. | [DECLARADO; VERIFICADO en git branch actual `r2/go-live`] |
| **D9** | **Propuesta: Descargas de Reporte de Jornada para Cajera (`CASHIER_PLUS`)** | Permitir que la cajera descargue su propio comprobante PDF/Excel al cerrar turno sin recibir error 403 por el comodín `/api/reports/*`. | Mantener `/api/reports/*` exclusivo para administradores y supervisores. | Error 403 cuando la cajera intente descargar el soporte físico de su arqueo de turno con `ENFORCE_AUTH=true`. | [PROPUESTA TÉCNICA; VERIFICADO en `route-policy.ts:115`] |

---

## 4. HISTORIAL DE INCIDENTES Y SOLUCIONES

### INC-01: Extracción manual de suministros del auditor
- **Síntoma:** Los 5 archivos base de seguridad R2 no se integraron mediante ramas directas de git.
- **Causa raíz:** Artefactos entregados dentro de un archivo comprimido externo (`tocineta-contexto-20261101-0215.zip`).
- **Solución:** Extracción y colocación manual de los 5 archivos en sus rutas canónicas (`route-policy.ts`, `session.ts`, `auth-guard.ts`, `0038_r2_perf_indexes.sql`, `r2-route-policy.test.ts`), consolidándolos en el commit base de auditoría.
- **Evidencia:** Commit `d2269d4` ("chore(r2-pre0): archivos base de auditoria...") [VERIFICADO: git show --stat d2269d4].
- **Cómo evitarlo:** Suministrar siempre cambios mediante ramas o parches git (`git format-patch`) en lugar de archivos comprimidos sueltos.

### INC-02: Suplantación de identidad por cabecera `x-user-id` (BUG-02 / Gap 1)
- **Síntoma:** Peticiones HTTP a endpoints sensibles podían ejecutar operaciones en nombre de cualquier usuario enviando la cabecera `x-user-id` sin token de sesión válido.
- **Causa raíz:** Múltiples controladores del backend extraían el identificador de usuario directamente de `req.headers['x-user-id']` sin autenticar la sesión contra SQLite.
- **Solución:** Extirpación formal de la lectura de `x-user-id` en controladores de caja, cierres y reportes; implementación de `getSessionUserByToken` en `session.ts` y cableado del plugin `auth-guard.ts` que inyecta `request.user` autenticado. Suite de pruebas `r2-impersonation.test.ts` agregada (12/12 verdes).
- **Evidencia:** Commit `4dbe96c` y commit `b3eab54` [VERIFICADO: git show --stat 4dbe96c, b3eab54].
- **Cómo evitarlo:** Nunca leer la identidad del usuario desde cabeceras no verificadas; consumir exclusivamente la propiedad `request.user` provista por el middleware central de autenticación.

### INC-03: Pérdida de ventas en el `outbox` offline (BUG-06)
- **Síntoma:** En situaciones de red inestable o fallos de autenticación (errores HTTP 401, 403 o 500), el outbox offline descartaba pedidos pendientes de sincronización de IndexedDB, perdiendo la venta registrada.
- **Causa raíz:** Lógica de manejo de errores en el cliente web que interpretaba cualquier respuesta de error como transacción completada o descartable.
- **Solución:** Clasificación estricta de respuestas HTTP: se retiene en IndexedDB ante 401/403/408/429/5xx con marca `needsAttention = true` y alerta visible al cajero; solo se descarta ante errores de payload 400/404/422 con respaldo en log local.
- **Evidencia:** Commit `0b11687` ("feat(P3-A): blindar outbox offline") [VERIFICADO: git show --stat 0b11687].
- **Cómo evitarlo:** Aplicar política de "nunca perder una comanda" en almacenamiento local persistente; solo eliminar registros del outbox ante confirmación 2xx explícita del servidor.

### INC-04: Falla de carga y desalineación de moneda en Cierre Z
- **Síntoma:** El wizard de Cierre Z de caja fallaba al cargar o presentaba totales distorsionados en USD al agrupar pagos mixtos.
- **Causa raíz:** Falta de un endpoint dedicado para resumen Z que desglosara formalmente los montos en micro-Bs y Bolívares por método de pago.
- **Solución:** Creación del endpoint `/api/closures/z-summary`, inclusión de utilidades de conversión en `@tocineta/shared` (`payment-method-currency.ts`) y suite de paridad Z (`r2-z-vs-truth-parity.test.ts`) con 0 centavos de desfase.
- **Evidencia:** Commit `a7f3f12` y commit `da8c0e6` [VERIFICADO: git show --stat a7f3f12, da8c0e6].
- **Cómo evitarlo:** Mantener los cálculos y agrupaciones de monedas en paquetes compartidos testeados unitariamente (`payment-method-currency.test.ts`).

### INC-05: Mezcla de divisas en cobro rápido (BUG-01)
- **Síntoma:** Con "Pago móvil" (Bs) seleccionado, presionar "Exacto USD" o los billetes rápidos registraba un cobro en efectivo USD, descuadrando el arqueo de caja real.
- **Causa raíz:** En `PaymentWizard.tsx:261-263`, las funciones `onExactUsd`, `onExactBs` y `onQuickBill` tenían el método fijado en duro a `'cash_usd'` y `'cash_bs'`, ignorando la variable de estado `selectedMethod`.
- **Solución:** Reestructurar `PaymentWizardStep2` para ofrecer un único botón "Exacto" que consuma `selectedMethod` en su moneda nativa calculando el monto en Bs o USD según corresponda, y condicionar los billetes rápidos exclusivamente a métodos denominados en USD.
- **Evidencia:** Análisis de código fuente en `PaymentWizard.tsx:261-263` [VERIFICADO].
- **Cómo evitarlo:** El método de pago debe gobernar la moneda del cobro, nunca los botones de atajo.

### INC-06: Bucle fantasma y desaparición de pantalla de éxito en Cierre Z (BUG-03 / N-01)
- **Síntoma:** Al cerrar jornada, la pantalla de éxito desaparece instantáneamente mostrando "No hay jornada abierta", las descargas PDF/Excel fallan y al abrir otra jornada reaparece el paso 3 con datos del cierre anterior.
- **Causa raíz:** Tres defectos encadenados:
  1. `/api/reports/z-report/summary` responde 404 al cerrarse la jornada (`reports/routes.ts:113`).
  2. `CashierClosureWizard.tsx:75-85` atrapa el 404 con `isErrorSummary` y desmonta todo el asistente, destruyendo el paso 3.
  3. Las descargas dependen de `jornada?.id` (que es `null` tras cerrar).
  4. "Finalizar" solo ejecuta `setStep(1)` sin reiniciar los estados `countedCashUsd`, `closureResult`, etc.
- **Solución:** El backend debe responder 200 con `{ success: true, summary: null, jornada: null }` cuando no hay jornada activa; el asistente debe retener un snapshot de la jornada recién cerrada (`closedJornadaId`) para las descargas y reiniciar completamente su estado al pulsar "Finalizar", forzando remonte con clave `<CashierClosureWizard key={jornada?.id ?? 'none'} />`.
- **Evidencia:** Análisis estático de `CashierClosureWizard.tsx` y `reports/routes.ts` [VERIFICADO].
- **Cómo evitarlo:** La ausencia de jornada es un estado operativo normal, nunca debe tratarse como un error HTTP 404.

---

## 5. MAPA DE PROMPTS Y COMMITS (TRAZABILIDAD)

| Prompt | Agente / Modelo | Objetivo | Archivos afectados | Commit | Estado | Evidencia |
|:---|:---|:---|:---|:---|:---|:---|
| **Pre-0** | Auditor / Humano | Integrar los 5 archivos base de seguridad extraídos del ZIP | `route-policy.ts`, `session.ts`, `auth-guard.ts`, `0038_r2_perf_indexes.sql`, `r2-route-policy.test.ts` | `d2269d4` | Commiteado | [VERIFICADO: git show --stat d2269d4] |
| **P1-A** | Arquitecto (Flash 3.8) | Registrar auth-guard en server.ts y sanitizar URLs en error-handler.ts en MODO WARN | `apps/server/src/server.ts`, `apps/server/src/lib/error-handler.ts`, `apps/server/test/r2-auth-guard.test.ts`, `apps/server/test/test-helpers.ts` | `b3eab54` | Commiteado | [VERIFICADO: git show --stat b3eab54] |
| **P1-D** | Arquitecto (Flash 3.8) | Proteger `init-prod`, credenciales seguras de admin y permiso de cierre de jornada | `apps/server/src/config/route-policy.ts`, `apps/server/src/db/fresh-prod.ts`, `apps/server/src/modules/auth/pin.ts`, `apps/server/src/modules/auth/seed-users.ts`, `apps/server/src/routes/auth-actions.ts` | `ea1130e` | Commiteado | [VERIFICADO: git log ea1130e (tag `fase-p1-d`)] |
| **P1-B** | Arquitecto (Flash 3.8) | Eliminar uso de cabecera `x-user-id` y consumir `request.user` autenticado | `apps/server/src/modules/cashier/routes.ts`, `apps/server/src/modules/closures/routes.ts`, `apps/server/src/modules/reports/routes.ts`, `apps/server/test/r2-impersonation.test.ts` | `4dbe96c` | Commiteado | [VERIFICADO: git log 4dbe96c (tag `fase-p1-b` en ea8e394)] |
| **P1-C** | Arquitecto (Flash 3.8) | Unificar validación de sesión con `getSessionUserByToken` y cerrar Oleada 1 | Rutas de backups, settings, cupones, delivery, emergency, kds, menu, orders, printing, staff, transfers, updater; `r2-session-validation.test.ts` | `b3eab54` | Commiteado | [VERIFICADO: git log b3eab54 (tag `r2-ola-1`)] |
| **P2-A** | Arquitecto / Lite 3.5 | Crear cliente centralizado `apiFetch` y autenticación en WebSocket | `apps/web/src/api/client.ts`, `apps/web/src/hooks/useEventStream.ts` | `387b30a` | Commiteado | [VERIFICADO: git log 387b30a y repo base] |
| **L-1 a L-9** | Mecánico (Flash-Lite 3.5) | Migración a `apiFetch` en frontend Lotes 1 al 9 | Componentes, comanderos, finanzas, rentabilidad, compras, KDS, cotizaciones, modales | `23fc2d7` a `aecab15` | Commiteado | [VERIFICADO: historial git de 7 commits] |
| **L-10** | Mecánico (Flash-Lite 3.5) | Migración a `apiFetch` en impresoras, personal y BCV | `PrintersPanel.tsx`, `SettlementModal.tsx`, `useStaffData.ts`, `BcvRateModal.tsx` | `da48375` | Commiteado | [VERIFICADO: commit `da48375`] |
| **P2-B** | Arquitecto (Flash 3.8) | Modal no descartable de cambio obligatorio de PIN ante `must_change_pin = 1` | `ChangePinModal.tsx`, `pin-utils.ts`, `Modal.tsx`, `AuthContext.tsx`, `LoginView.tsx`, `AppLayout.tsx`, `routes/auth.ts` | `da48375` | Commiteado | [VERIFICADO: commit `da48375`] |
| **P2-D** | Arquitecto (Flash 3.8) | Optimización de polling en `PrintAttentionModal.tsx` (3s alerta / 30s reposo / pausa en hidden) | `PrintAttentionModal.tsx`, `AppLayout.tsx` | `da48375` | Commiteado | [VERIFICADO: commit `da48375`] |
| **P3-A** | Arquitecto (Flash 3.8) | Blindaje de Outbox offline (retención en IndexedDB ante 4xx/5xx) | `apps/web/src/features/pos/outbox.ts`, `types.ts`, `usePosCart.ts` | `0b11687` | Commiteado | [VERIFICADO: commit `0b11687`] |
| **P3-B** | Arquitecto (Flash 3.8) | Inmutabilidad de órdenes en cocina y guardia 409 Conflict | `apps/server/src/modules/kds/kds-service.ts`, `routes.ts`, `r2-kds-immutability.test.ts` | `b302c1c` | Commiteado | [VERIFICADO: commit `b302c1c`] |
| **P3-C** | Arquitecto (Flash 3.8) | Lockout de autorizadores por PIN ante ataques de fuerza bruta | `apps/server/src/modules/auth/authorizer-guard.ts`, `cashier-service.ts`, `routes.ts`, `r2-authorizer-lockout.test.ts` | `8d290c4` | Commiteado | [VERIFICADO: commit `8d290c4`] |
| **P5-A** | Arquitecto (Flash 3.8) | Paridad Z vs verdad financiera (0 centavos de diferencia) | `apps/server/test/r2-z-vs-truth-parity.test.ts` | `da8c0e6` | Commiteado | [VERIFICADO: commit `da8c0e6` (HEAD)] |

---

## 6. DEUDA TÉCNICA Y FASE C

### Ejes no auditados de la Fase C
1. **Reembolsos y Devoluciones:** Ausencia de flujo formal de contra-asiento contable en caja; se requiere registrar la devolución sin borrar transacciones históricas ni desbalancear el arqueo [DECLARADO].
2. **Impresión ESC/POS en hardware físico:** El sistema ha sido probado en simulación (`PRINTER_DEV_SIMULATION`); falta verificar secuencias de bytes reales, cortes de papel y apertura de gaveta en impresoras térmicas físicas de 58mm y 80mm [DECLARADO].
3. **Multi-sede e inventario controlado:** Mecanismos de transferencia y control de stock entre sedes Alta Vista y Los Olivos; falta auditar la consistencia frente a desconexiones de red local [DECLARADO].
4. **Nómina, socios y cupones:** Auditoría pendiente de reparto de propinas, liquidaciones a repartidores y validación de doble aplicación de cupones [DECLARADO].

### Marcadores de Tareas Pendientes en Código (`TODO`)
- Coincidencias activas verificadas en código fuente del servidor [VERIFICADO: `git grep -n "TODO("`]:
  1. `apps/server/src/modules/closures/routes.ts:13`: `// TODO(M12): Bloquear o endurecer autorización por PIN en P3-C` (abordado en commit `8d290c4`).
  2. `apps/server/src/modules/profitability/fase3-routes.ts:556`: `// TODO(M12): lockout check / increment failed attempts` (abordado en commit `8d290c4`).

### Riesgos y Observaciones Detectadas
1. **MCP SQLite en Entorno de Desarrollo:** El MCP configurado en `.gemini/mcp.json` apunta a la base de datos local `apps/server/data/tocineta-dev.db`. Está estrictamente prohibido redirigir este servidor hacia bases de datos de producción para evitar bloqueos por cerrojo de archivo (`database is locked`) [VERIFICADO: `.gemini/mcp.json`].
2. **Variable `ENFORCE_AUTH=true`:** Existe en `apps/server/.env` localmente [VERIFICADO]. Debe asegurarse su inclusión en los scripts de empaquetado o aprovisionamiento de producción (`instalar-cliente.ps1`) para que el guard de seguridad bloquee efectivamente en producción.
3. **Salto de numeración en migraciones:** La migración `0033` no existe (el migrador salta de 0032 a 0034). El migrador ordena alfabéticamente; está prohibido crear una migración "0033" tardía para evitar alterar el orden de aplicación [VERIFICADO en `apps/server/src/db/migrations/`].

---

## 7. INSTRUCCIONES PARA EL YO DEL FUTURO (O UN NUEVO DEV)

### Checklist Numerado de Retoma
1. **Lectura obligatoria:** Leer esta bitácora (`BITACORA-DE-CONTEXTO.md`) para entender el estado de avance real, decisiones consolidadas y los incidentes previos.
2. **Revisar estado de git:** Ejecutar `git status --short` y `git log --oneline -n 10` para verificar la rama actual (`r2/go-live`).
3. **Verificación de base de datos:** Comprobar que `.gemini/mcp.json` apunte únicamente a `apps/server/data/tocineta-dev.db`.
4. **Verificación de salud del proyecto (sin tocar código):**
   - Ejecutar suite de pruebas: `pnpm --filter @tocineta/server run test`
   - Validar sistema de tipos: `pnpm --filter @tocineta/server run lint` y `pnpm --filter @tocineta/web exec tsc --noEmit`
   - Validar gobernanza visual de interfaz: `pnpm run guard`
5. **Revisar dudas abiertas:** Consultar la Sección 8 de este documento antes de iniciar nuevas fases.

### Lo que NO debes hacer
- **NO modificar los archivos base de seguridad ya auditados y congelados:** `route-policy.ts`, `session.ts`, `auth-guard.ts`, `0038_r2_perf_indexes.sql` y `r2-route-policy.test.ts`.
- **NO alterar las decisiones de la Sección 3:** No reactivar bloqueo por inactividad (D1), no inventar roles fuera de los 6 canónicos (D2), no quitar el token de la URL en WebSocket (D3), ni forzar cambio de PIN a roles operativos (D4).
- **NO modificar migraciones anteriores a la 0038:** Toda alteración de base de datos debe ser en una migración nueva forward-only (ej. `0039_...sql`).
- **NO entregar lógica de dinero, KDS, sesión ni outbox al modelo Mecánico (3.5 Lite):** Esas áreas son propiedad exclusiva del Arquitecto (3.8).
- **NO hacer commits con nombres informales ni destructivos:** Prohibido `git push --force`, `git reset --hard` o nombres como "awa". Usar siempre la convención `feat(...)` o `fix(...)`.

---

## 8. PREGUNTAS ABIERTAS PARA EL DUEÑO

1. **[RESUELTO POR INSPECCIÓN] ¿Está `ENFORCE_AUTH=true` en el entorno real?**  
   Verificado: Sí, está presente en `apps/server/.env`. Los 403 observados en pruebas son bloqueos reales de autorización.
2. **[RESUELTO POR INSPECCIÓN] ¿Por qué falló el Cierre de Jornada con 403?**  
   Verificado: El campo PIN en `CashierClosureWizard.tsx` tenía un valor hardcodeado `'2026'` que no correspondía al supervisor, activando el limitador de fuerza bruta y recayendo en la cajera, la cual era rechazada por `closeJornadaZ` en `closures-service.ts:264`.
3. **[POR CONFIRMAR] Autorización de Decisión D9 para Descargas de Cierre:**  
   ¿Se autoriza modificar `config/route-policy.ts` para registrar `['GET', '/api/reports/jornada/*', 'CASHIER_PLUS']` antes del comodín `ADMIN_SUPERVISOR`, permitiendo a la cajera descargar el PDF/Excel de su turno con `ENFORCE_AUTH=true`?
4. **[POR CONFIRMAR] Alcance del "Ítem Libre" en el POS (N-11):**  
   ¿Se implementa en este parche o se pospone a la siguiente fase? (Propuesta: botón "+ Ítem Libre" en POS con precio y estación opcional, categoría interna `is_internal = 1`, marcado `product_kind = 'LIBRE'` y desglose separado en cierre Z).
5. **[POR CONFIRMAR] Campos exactos para la Ficha Técnica / Escandallo (N-10):**  
   ¿Qué datos adicionales debe solicitar la creación rápida de plato desde el escandallo (ej. rendimiento en raciones, porcentaje de merma estándar, unidad de medida)?

---

## 9. DISCREPANCIAS DETECTADAS

| Qué se declaró | Qué muestra el repo | Dónde | Acción sugerida |
|:---|:---|:---|:---|
| Se declaró que el guard no bloqueaba porque `ENFORCE_AUTH` no existía en el ZIP. | En el entorno real existe `apps/server/.env` con `ENFORCE_AUTH=true`. No estaba en el ZIP por estar en `.gitignore`. | `apps/server/.env` | [VERIFICADO] Documentar que en el entorno real de despliegue la seguridad sí está en modo estricto. |
| Se declaró que el problema del Cierre Z era limpiar `wizardData` (`setWizardData(null)`). | La variable `wizardData` no existe en el código. El estado real está compuesto por `step`, `closureResult`, `countedCashUsd`, etc. | `CashierClosureWizard.tsx` | [VERIFICADO] Aplicar la solución técnica real: no desmontar en 404, snapshot de jornada cerrada y reseteo total en "Finalizar". |
| Se declaró que la Malteada no aparecía por un problema de caché de React Query. | La categoría "Malteadas y Helados" (`cat_malteadas`) viene con `is_active: 0` de fábrica en `seed-catalog.ts:40`. El POS filtra categorías inactivas; la Carta administrativa no. | `seed-catalog.ts`, `menu-service.ts` | [VERIFICADO] Advertir categoría inactiva en el modal de producto y permitir activarla desde administración. |
| Se declaró que para BUG-01 había que bloquear el botón "Exacto USD" ante métodos en Bs. | Los botones de cobro ignoran por completo `selectedMethod` y tienen fijado en duro `cash_usd`/`cash_bs`. | `PaymentWizard.tsx:261-263` | [VERIFICADO] Crear un único botón "Exacto" que respete `selectedMethod` en su moneda nativa. |

---

## 10. REGISTRO DE CAMBIOS DE ESTA BITÁCORA

- **2026-11-01 (1ra edición):** Creación inicial de `BITACORA-DE-CONTEXTO.md` como fuente única de verdad. Documentación de auditoría R2, sincronización de discrepancias de plan vs git, verificación de archivos base de seguridad y definición del checklist de retoma. Referencia de commit: `d2269d4`.
- **2026-11-01 (2da edición):** Incorporación de resoluciones del dueño para las 5 preguntas abiertas: verificación de rutas en `guias/`, aprobación de cierre de turno por cajera (D6), confirmación de desbloqueo de PIN por admin y supervisor (D7), adopción de rama única `r2/go-live` (D8), y consolidación del estado de L-1 como Hecho sin commit.
- **2026-11-01 (3ra edición):** Cierre y consolidación de la Oleada 1 verificado con tag `r2-ola-1` en commit `b3eab54`. Verificación en historial git de commits L-2 a L-9 (`aecab15`). Registro de culminación técnica de L-10 (Mecánico), P2-B y P2-D.
- **2026-11-01 (4ta edición):** Consolidación total de Oleada 2 (`da48375`), Oleada 3 (`0b11687`, `b302c1c`, `8d290c4`) y Paridad Z (`da8c0e6`). Verificación contra código fuente de los hallazgos críticos de campo (BUG-01 a BUG-05, N-01 a N-05). Confirmación de presencia de `ENFORCE_AUTH=true` en `.env`. Formulación del plan de parche por Olas A y B.
