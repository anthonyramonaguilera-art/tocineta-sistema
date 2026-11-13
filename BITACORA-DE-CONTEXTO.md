# BITÁCORA TÉCNICA Y DE CONTEXTO — TOCINETA
Última actualización: 2026-11-13 · Rama: feat/apk-terminal · Última migración: 0043_printers_client_bt.sql · Tests: 671 aprobados en suites de servidor (93 suites)

---

## 1. RESUMEN EJECUTIVO Y ESTADO ACTUAL

- **Oleada / Fase actual:**
  - **Fase de Impresión Móvil Bluetooth (MP583 58mm) y Ruteo Dinámico de Comandas 100% COMPLETADA y verificada** [VERIFICADO: commits `de355d1` a `63456cc`].
  - **Arquitectura de Impresión Híbrida Operativa:**
    - Laptop fija USB en cocina como comandera fija (`print_caja_usb` para tickets de hot dogs y hamburguesas).
    - Terminales móviles Android concurrentes cobrando con su propia impresora Bluetooth portátil MP583 de 58mm para notas de entrega inmediatas.
    - Selectores configurables en Ajustes del Sistema para dirigir nota de entrega y comandas a dispositivo cobrador (`payer_device`) o impresora fija (`fixed_printer`).
  - **Migraciones de Base de Datos aplicadas y blindadas:**
    - `0042_client_print_routing.sql`: añade `target` ('server' | 'client') y `target_terminal_id` a `print_jobs`, más configuraciones de ruteo en `business_settings`.
    - `0043_printers_client_bt.sql`: soporte para conexión `CLIENT_BT` en impresoras térmicas manteniendo integridad referencial.
  - **Auditoría Forense de Caja, Ventas y Cierres:**
    - Documento maestro de remediación estructurado en `docs/AUDITORIA_Y_SOLUCIONES_CAJA_Y_CIERRES.md` cubriendo las soluciones de arquitectura para los 5 hallazgos de campo (BUG-01 Sesión de caja Admin vs Cajera, BUG-02 Acumulación de ventas y Cierre Z de Jornada, BUG-03 Detalle digital de comanda, BUG-04 Reimpresión selectiva comandas/nota, BUG-05 Descuento de gastos en caja chica).
  - **Calidad y Validación Técnica:**
    - Suite de servidor con **671 pruebas unitarias y E2E aprobadas** (93 suites, 100% en verde, incluyendo suite E2E `r2-print-e2e-routing.test.ts` con 7 escenarios de concurrencia y aislamiento 403).
    - Gobernanza UI (`pnpm run guard`) en **0 infracciones**.
    - Sistema de tipos TypeScript (`pnpm -r run lint`) en **0 errores**.
    - Compilación de producción (`pnpm -r run build`) **100% exitosa** en todos los paquetes.

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
| **D10** | **Arquitectura Híbrida de Impresión (Laptop USB + Teléfonos Bluetooth MP583)** | Laptop cerca de cocina opera con impresora fija USB (`print_caja_usb`) como comandera para hot dogs y hamburguesas. Teléfonos móviles (2 cajeras concurrentes) operan con su propia impresora Bluetooth MP583 de 58mm para notas de entrega. | Intentar que la laptop controle todas las impresoras Bluetooth chinas sin puertos COM configurados, o forzar a la cocina a usar Bluetooth. | Fallos de driver en Windows con impresoras chinas, monopolio de conexión Bluetooth de un solo dispositivo. | [RESUELTO POR EL DUEÑO 2026-11-12; Auditoría en vivo] |
| **D11** | **Transporte Bluetooth Clásico (RFCOMM/SPP) con Chunking para 58mm** | Las impresoras térmicas chinas genéricas (MP583) usan SPP clásico (no BLE) y tienen búferes RAM pequeños (2–4 KB). Se requiere APK nativa (Capacitor) con chunking (256–512 bytes, pausa 15–20 ms). | Web Bluetooth (exige HTTPS y es BLE-only, incompatible con D3 y MP583). Envío masivo de bytes de golpe. | Bloqueo o descarte por parte de Chrome, caracteres basura y corte prematuro del papel. | [DECLARADO; Auditoría 2026-11-12] |
| **D12** | **Blindaje de Red Wi-Fi sin Internet (`bindProcessToNetwork`)** | En routers locales de food truck/restaurante sin salida a internet (WAN), Android salta automáticamente a datos móviles (4G), perdiendo la conexión local con la laptop (`192.168.x.x`). La APK terminal fija el proceso al Wi-Fi. | Permitir que el sistema operativo gestione la red automáticamente o depender de que los meseros apaguen datos móviles manualmente. | Desconexión inmediata de los comanderos y terminales de cobro con error "No se puede acceder a este sitio". | [DECLARADO; docs/android-setup.md; Auditoría 2026-11-12] |
| **D13** | **Auto-descubrimiento en Capas del Servidor (mDNS + Barrido /24)** | Si el router reinicia y cambia la IP de la laptop por DHCP, la APK busca mDNS (`_tocineta._tcp`) o barre la subred `/24` contra `/api/health` validando el `serverId`. | Fijar una IP manual en duro en los teléfonos. | Caída del sistema si cambia la IP de la laptop hasta que un técnico reconfigure los teléfonos. | [DECLARADO; Auditoría 2026-11-12] |
| **D14** | **Identificación de Terminal en Cobro (`target_terminal_id`) sin Tabla `devices` Paralela** | Cada terminal móvil se identifica con un `terminal_id` enviado en el cobro y aprovecha las sesiones existentes (`auth-guard`, `session.ts`, `localStorage`). | Crear una tabla `devices` redundante con hashes y tokens paralelos a la seguridad de la Oleada 1. | Sobre-ingeniería innecesaria, complejidad en auditoría y duplicación de autenticación. | [DECLARADO; Auditoría 2026-11-12] |
| **D15** | **Migraciones 0042 y 0043 como Migraciones Forward-Only** | Las migraciones `0042_client_print_routing.sql` (agrega `target` y `target_terminal_id` a `print_jobs` y llaves de ruteo) y `0043_printers_client_bt.sql` (`CLIENT_BT` en printers) fueron aplicadas sin alterar esquemas previos ni perder datos existentes. | Crear migraciones con numeración duplicada o alterar tablas previas destructivamente. | Violación de D5 y fallos en migrador. | [VERIFICADO: commits `de355d1` y `6ec9fcc`] |
| **D16** | **Registro de Terminales en Memoria con Latido (`POST /api/terminals/heartbeat`)** | Las terminales móviles registran su presencia y estado mediante latidos periódicos en memoria con expiración automática (TTL de 90000 ms / 90 s en `apps/server/src/modules/printing/terminal-registry.ts`). Evita sobrecargar SQLite con escrituras continuas de terminales efímeras o de prueba. | Persistir cada latido o ping en disco mediante transacciones SQLite. | Degradación del rendimiento de base de datos por contención de I/O en la laptop de caja. | [VERIFICADO: commits `ce38f52`, `b42f65e` y `terminal-registry.ts`] |
| **D17** | **Reclamo Atómico de Trabajos de Impresión (`claim`) con Expiración (60 s)** | Cuando una terminal móvil consulta sus trabajos (`GET /api/terminals/me/print-jobs`), reclama de forma atómica cada trabajo. Si la terminal se desconecta durante la impresión, el reclamo expira a los 60 segundos (`60000` ms en `apps/server/src/modules/printing/worker.ts`) y queda disponible para reintento. | Entregar el trabajo sin reclamo o mantenerlo bloqueado indefinidamente. | Duplicación de impresión de notas de entrega o bloqueo permanente de la cola ante caída de red. | [VERIFICADO: commits `61fc8aa`, `63456cc` y `worker.ts`] |
| **D18** | **Preservación de Metadatos de Impresión en Reimpresiones y Reposiciones** | Al reimprimir una nota de entrega o reponer una comanda desde caja o cocina, el trabajo nuevo preserva el `target` ('client' o 'server') y el `target_terminal_id` original o los asigna según la terminal que ejecuta la reimpresión. | Descartar el destino original y enviar todas las reimpresiones a la impresora fija del servidor. | Pérdida de la capacidad de reimprimir desde el móvil o envío indeseado de notas de entrega a la cocina. | [VERIFICADO: commit `ff04d83`] |
| **D19** | **Arquitectura APK Terminal Android Nativa en Kotlin (Decisiones D-A a D-F)** | Implementación de terminal móvil nativo en `android-terminal/` fuera de `pnpm-workspace.yaml`: **D-A:** proyecto Kotlin compilado con Gradle (`gradlew.bat testDebugUnitTest assembleDebug`); **D-B:** WebView acelerado por hardware con puente `@JavascriptInterface` (`TocinetaNative`) para comunicación web-hardware sin dependencias externas pesadas; **D-C:** descubrimiento en 3 capas del servidor (memoria, barrido `/24` en puerto 3000 validando `serverId` UUID v4 persistido en `/api/health`, y manual); **D-D:** identidad persistente en `SharedPreferences` (`terminal_id`), inyectada vía cabecera `X-Terminal-Id` y puente nativo para enlazar impresoras Bluetooth sin sobrecargar autenticación; **D-E:** transporte Bluetooth SPP clásico (RFCOMM) directo con conexión socket persistente, troceado en chunks (256-512 bytes, pausa 15-20 ms), servicio en primer plano (`ForegroundService`) y exención de optimización de batería (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`); **D-F:** distribución y publicación automatizada del APK compilado y firmado release (`keystore.properties` + `scripts/publicar-apk.ps1`) servido directamente desde la laptop vía Fastify en `/apk/tocineta-terminal.apk`, `/apk/version.txt` y `/apk-instalar.html` con aislamiento 404 estricto frente al fallback SPA. | Usar Capacitor dentro del monorepo, descubrimiento con IPs fijas en código, o distribución manual por pendrive. | Rotura del monorepo Node/pnpm, corte o corrupción de tickets en impresoras chinas 58mm, y pérdida de conexión al reiniciar router. | [VERIFICADO: commits `1fb04b1` a `50ca566`, `android-terminal/`, `docs/android-terminal.md`] |
| **D20** | **Reserva Estática de Dirección IP por DHCP en el Router Local para la Laptop Servidora** | Garantizar la invariabilidad de la IP local de la laptop (`192.168.x.x`). El almacenamiento local de Android (`IndexedDB` del Outbox offline y `localStorage` de sesiones/tokens) está regido por la *Same-Origin Policy* (`http://<IP>:<PORT>`). Si el DHCP asigna una IP diferente tras un reinicio, las órdenes retenidas en el Outbox quedan inaccesibles hasta recuperar la IP original y las sesiones de los operadores se invalidan, forzando re-login en pleno servicio. Además, permite conexión instantánea en milisegundos (Capa A) sin ejecutar barrido `/24`. | Depender exclusivamente del descubrimiento por barrido `/24` tras cada reinicio del router o reconfigurar manualmente las IPs en cada teléfono. | Comandas huérfanas retenidas en IndexedDB tras cambios de IP, demoras operativas y cierres de sesión intempestivos del personal de salón y cocina. | [DECLARADO y VERIFICADO en `docs/android-setup.md`, `docs/android-terminal.md`] |

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
| **P5-A** | Arquitecto (Flash 3.8) | Paridad Z vs verdad financiera (0 centavos de diferencia) | `apps/server/test/r2-z-vs-truth-parity.test.ts` | `da8c0e6` | Commiteado | [VERIFICADO: commit `da8c0e6`] |
| **M-01** | Arquitecto (Flash 3.8) | Migración 0042: enrutamiento de impresión cliente y configuración de destinos | `0042_client_print_routing.sql`, `business-settings.ts`, `settings-routes.ts`, tests | `de355d1` | Commiteado | [VERIFICADO: commit `de355d1`] |
| **M-02** | Arquitecto (Flash 3.8) | Migración 0043: permitir connection_type CLIENT_BT en printers sin pérdida de datos | `0043_printers_client_bt.sql`, `migrate.ts`, `schema.ts`, tests | `6ec9fcc` | Commiteado | [VERIFICADO: commit `6ec9fcc`] |
| **M-03** | Arquitecto (Flash 3.8) | Registro en memoria de terminales móviles y rutas de heartbeat y listado | `modules/printing/routes.ts`, `apps/server/src/modules/printing/terminal-registry.ts`, tests | `ce38f52` | Commiteado | [VERIFICADO: commit `ce38f52`] |
| **M-04** | Arquitecto (Flash 3.8) | Enrutar nota y comandas según selectores de ajustes y terminales móviles | `modules/cashier/cashier-service.ts`, `modules/printing/worker.ts`, tests | `f8ff2fa` | Commiteado | [VERIFICADO: commit `f8ff2fa`] |
| **M-05** | Arquitecto (Flash 3.8) | Preservar destino y terminal en reimpresiones, reposiciones y resolución de atención | `modules/cashier/routes.ts`, `modules/kds/routes.ts`, `modules/printing/worker.ts` | `ff04d83` | Commiteado | [VERIFICADO: commit `ff04d83`] |
| **M-06** | Arquitecto (Flash 3.8) | Rutas de dispositivo para impresión móvil y vencimiento de reclamos | `modules/printing/routes.ts`, `apps/server/test/r2-print-device-routes.test.ts` | `61fc8aa` | Commiteado | [VERIFICADO: commit `61fc8aa`] |
| **M-07** | Arquitecto / UI (Flash 3.8) | Interfaz de ajustes de impresión con destinos y sincronización de modo | `PrintFlowSettings.tsx`, `ConnectedTerminalsCard.tsx`, `PrintersPanel.tsx` | `9e03461` | Commiteado | [VERIFICADO: commit `9e03461`] |
| **M-08** | Arquitecto (Flash 3.8) | Identidad de terminal, puente de impresión nativa y latido en layout | `terminal-identity.ts`, `mobile-print-bridge.ts`, `AppLayout.tsx` | `b42f65e` | Commiteado | [VERIFICADO: commit `b42f65e`] |
| **M-09** | Arquitecto (Flash 3.8) | Impresión en dispositivo, panel post-pago, auto-impresión y terminales | `PostPaymentPrintPanel.tsx`, `usePayerDevicePrint.ts`, `AutoPrintErrorBanner.tsx` | `1a23fe8` | Commiteado | [VERIFICADO: commit `1a23fe8`] |
| **M-10** | Arquitecto (Flash 3.8) | Escenarios E2E de enrutamiento de impresión móvil y fija (7 pruebas) | `apps/server/test/r2-print-e2e-routing.test.ts` | `63456cc` | Commiteado | [VERIFICADO: commit `63456cc`] |

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

0. **[RESUELTO POR EL DUEÑO 2026-11-12] Operativa de Impresoras en Sala y Cocina:**
   En la laptop fija queda conectada una impresora térmica USB (cerca de cocina, comandera para hot dogs y hamburguesas). Los teléfonos móviles que cobran tienen su propia impresora portátil Bluetooth MP583 de 58mm (2 terminales concurrentes previstas). Todo el flujo y asignación de roles será configurable desde los Ajustes del sistema.
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

- **2026-11-12 (5ta edición):** Auditoría exhaustiva en vivo y definición técnica de la Arquitectura de Impresión Móvil Bluetooth (MP583 58mm) y APK Terminal Android. Verificación de 587/587 tests unitarios en verde (83 suites) en `@tocineta/server` y 0 errores en TypeScript y UI-Guard. Incorporación de Decisiones D10 a D15: impresión híbrida (laptop USB comandera + teléfonos Bluetooth MP583), transporte nativo RFCOMM/SPP con chunking de 256 bytes, blindaje `bindProcessToNetwork` para Wi-Fi sin internet, auto-descubrimiento por mDNS/barrido /24 y migración 0042 forward-only.
- **2026-11-13 (6ta edición):** Consolidación de la fase de Impresión Móvil Bluetooth (MP583 58mm) y Ruteo Dinámico de Comandas (`feat/impresion-movil`). Registro de 10 commits clave (`de355d1` a `63456cc`) cubriendo migraciones 0042 y 0043, soporte `CLIENT_BT`, registro de terminales en memoria (`POST /api/terminals/heartbeat`), reclamo atómico y endpoints de dispositivo, interfaz de ajustes de ruteo, puente de impresión móvil nativo, panel táctil post-pago y suite E2E de concurrencia y aislamiento (`r2-print-e2e-routing.test.ts`). Incorporación de Decisiones D16 a D18. Documentación forense de la auditoría de Caja, Ventas y Cierres (`docs/AUDITORIA_Y_SOLUCIONES_CAJA_Y_CIERRES.md`). Verificación completa de UI-Guard, `tsc` en monorepo y `pnpm -r run build` en verde.
- **2026-11-13 (7ma edición):** Consolidación de la APK Terminal Android Nativa en Kotlin (`android-terminal/`) y distribución desde la laptop servidora en `feat/apk-terminal`. Registro de los 10 commits del historial reciente (`50ca566`, `1fc3bbf`, `4fb7ab8`, `dd6a9b1`, `061d8e2`, `0b759ae`, `c3b618e`, `1fb04b1`, `32b2057`, `21d3d9d`): `50ca566` (APK firmada release, distribución `/apk/` y documentación), `1fc3bbf` (ForegroundService y exención de batería), `4fb7ab8` (identidad nativa y selector de impresora web), `dd6a9b1` (Bluetooth SPP persistente y chunking), `061d8e2` (puente JS TocinetaNative e ID de terminal), `0b759ae` (descubrimiento /24 y enlace Wi-Fi `bindProcessToNetwork`), `c3b618e` (esqueleto APK con WebView), `1fb04b1` (serverId UUID v4 en `/api/health`), `32b2057` (AGENTS.md v4.0), `21d3d9d` (bitácora impresión móvil). Corrección en D16 (`POST /api/terminals/heartbeat` y TTL de 90000 ms / 90 s en `terminal-registry.ts`), D17 (`GET /api/terminals/me/print-jobs` y expiración de reclamo de 60000 ms / 60 s en `worker.ts`) y trazabilidad M-03 (`apps/server/src/modules/printing/terminal-registry.ts`). Incorporación de Decisiones D19 (Decisiones D-A a D-F de la APK Terminal) y D20 (importancia de reservar IP por DHCP en el router). Suite completa de servidor `@tocineta/server` ejecutada con **671 tests en verde (93/93 suites aprobadas)**, TypeScript en 0 errores y UI-Guard en 0 infracciones.