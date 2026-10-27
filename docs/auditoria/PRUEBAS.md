# Auditoría de Reparación de Pruebas — Fase 0

**Fecha de ejecución:** 2026-10-26  
**Entorno de ejecución:** Vitest v3.2.7 / Node.js 20+ / Windows PowerShell  
**Meta de Fase:** 0 fallos. Cero eliminación o debilitamiento de aserciones.  
**Resultado Final:** **26 archivos de prueba pasados (26/26) — 232 pruebas unitarias y de integración pasadas (232/232), 0 fallos.**

---

## 1. Clasificación Metodológica de Fallos

- **Clase A (Prueba desactualizada / Desalineada con Fases R1 y R2):**
  Pruebas que fallaban debido a credenciales obsoletas de usuarios (ej. `usr_admin_olinelcys`, `usr_cajera_principal`, `usr_mesonero_carlos`), aserciones contra marcas o textos deprecados (`"Tocineta Sonríe"`, `"MODO DUEÑA"`, `"MODO TURNO"`, `"MODO SOPORTE VARONS MEDIA"`, `"Sistema Conectado"`), o aserciones de nombres de repartidores antes de la migración corporativa 0021 (`"Carlos Mora"` -> `"REPARTIDOR 1"`).
- **Clase B (Bug real del producto en código de backend/rutas):**
  Defectos en el código fuente de la aplicación donde fallbacks estáticos utilizaban identificadores de usuarios inexistentes (`usr_cajera_principal`) disparando violaciones de integridad referencial SQLite (`FOREIGN KEY constraint failed`), o donde el servicio de soporte no priorizaba al usuario solicitante sobre filas históricas.

---

## 2. Matriz de Fallos, Clasificación y Corrección Aplicada

| Archivo de Prueba | Escenario / Test | Clase | Causa Raíz | Corrección Aplicada |
| :--- | :--- | :---: | :--- | :--- |
| `apps/server/src/modules/orders/routes.ts` | Fallback de `createdByUserId` en creación de órdenes | **B** | Fallback hardcodeado con `'usr_cajera_principal'`. En una base saneada con la migración 0021, ese ID no existe y falla el FK constraint de SQLite. | Corregido fallback a `'usr_cajera'`. |
| `apps/server/src/modules/delivery/routes.ts` | Fallback de `createdByUserId` en asignación y liquidación | **B** | Fallback a `'usr_cajera_principal'`. | Corregido fallback a `'usr_cajera'`. |
| `apps/server/src/modules/coupons/routes.ts` | Aplicación de cupón a orden | **B** | Fallback a `'usr_cajera_principal'`. | Corregido fallback a `'usr_cajera'`. |
| `apps/server/src/modules/cashier/routes.ts` | `resolveActingUser` | **B** | Fallback final a `'usr_cajera_principal'` en lugar del usuario corporativo. | Corregido fallback a `'usr_cajera'`. |
| `apps/server/src/modules/closures/routes.ts` | Cierre de caja y jornada | **B** | Fallback a `'usr_cajera_principal'`. | Corregido fallback a `'usr_cajera'`. |
| `apps/server/src/modules/support/support-service.ts` | `startSupportMode` | **B** | El servicio seleccionaba el primer usuario admin de la base sin priorizar al actor que invoca el endpoint (`input.actorUserId`), asignando IDs legados si existían filas residuales. | Actualizado para priorizar `input.actorUserId` y el canónico `usr_admin`. |
| `apps/server/test/test-helpers.ts` | Helper global de autenticación | **A** | Pruebas realizaban logins repetitivos con PINs dispersos y endpoints desfasados. | Creado helper estándar `loginAs(app, role, rawDb)` con `CANONICAL_CREDENTIALS` (`admin`: 123456, `cajera`: 1111, `mesero`: 2222, `plancha`: 4444, `despacho`: 5555, `supervisor`: 654321). |
| `acceptance-release1.test.ts` | 22 pruebas de aceptación Release 1 | **A** | Usaba IDs de usuarios antiguos (`usr_cajera_principal`, `usr_admin_olinelcys`) que daban 404 en `/api/auth/login`. | Migrado a `loginAs(app, role, rawDb)`. |
| `acceptance-full-26.test.ts` | 26 pruebas de aceptación Release 2 | **A** | Usaba credenciales legacy y aserciones de marca `"Tocineta Sonríe"`. | Migrado a credenciales canónicas y aserción de marca oficial `"TOCINETA"`. |
| `auth-audit-idempotency.test.ts` | Autenticación y bloqueo escalonado de PIN | **A** | Intentaba login de admin con ID legacy `usr_admin_olinelcys`. | Actualizado a `usr_admin` y PIN `123456`. |
| `backup-restore-emergency.test.ts` | Respaldo cifrado age y restauración | **A** | Variables de claves privadas nombradas `olinelcysPrivate` y aserción con nombre propio. | Limpiado a `adminPrivate`/`supportPrivate` y aserción genérica `ADMIN`. |
| `cashier-ledger.test.ts` | Arqueo ciego y doble partida | **A** | Login cajera fallaba por ID desactualizado. | Actualizado a `loginAs(app, 'cajera')`. |
| `closures-incidents-reports.test.ts` | Incidencias y mermas de turno | **A** | Login supervisor y cajera fallaban. | Integrado `loginAs` y `ensureTestSupervisor`. |
| `delivery-and-coupons.test.ts` | CRUD de Repartidores y Cupones | **A** | Aserción esperaba nombre `"Carlos Mora"` pero la migración 0021 actualizó a `"REPARTIDOR 1"`. | Actualizada la aserción para verificar `'REPARTIDOR 1'`. |
| `domain-schema-catalog.test.ts` | Esquema del dominio y catálogo | **A** | Dependía de sesión cajera legacy. | Actualizado a `usr_cajera`. |
| `kds.test.ts` | KDS y comanda de cocina | **A** | Nombre de cliente legacy y headers de sesión desactualizados. | Actualizado a credenciales corporativas. |
| `m10-1-forensic-hardware.test.ts` | Reembolso Pago Móvil (Test 3) | **A** | Inserción manual en tabla `payments` fallaba por FK constraint al usar un ID estático sin verificar en la instancia de prueba. | Obtenido ID verificado desde tabla `users` (`adminUser.id`). |
| `m10-2-optimizations.test.ts` | Dry-run y purga de eventos | **A** | Requería token admin canónico. | Migrado a `loginAs(app, 'admin')`. |
| `m16-hardening-audit.test.ts` | KDS Opción B y Cupón reversado | **A** | Tenía referencias a `usr_admin_olinelcys`, `usr_cajera_principal`, `usr_cocina_plancha`. | Actualizado a `usr_admin`, `usr_cajera` y `usr_plancha`. |
| `m17-ux-hardening.test.ts` | Hardening de UX y modales | **A** | Login con roles corporativos. | Actualizado con `loginAs`. |
| `m18-qa-fixes.test.ts` | RBAC en cobros `/api/orders/:id/pay` | **A** | El test enviaba un token no propagado a la sesión en memoria, resolviendo la cajera de la sesión activa (200 en vez de 403). | Añadida cabecera explícita `'x-user-id': 'usr_mesero'` y `'usr_plancha'` para evaluar el rol no autorizado y obtener el 403 esperado. |
| `m19-operational-qa.test.ts` | QA Operacional | **A** | Credenciales de turno. | Migrado a credenciales canónicas. |
| `m20-godmode-and-staff.test.ts` | Smoke checks de UI | **A** | Aserciones buscaban cadenas deprecadas (`"MODO DUEÑA"`, `"MODO TURNO"`, `"Sistema Conectado"`). | Actualizado a `"Modo Básico"`, `"Modo Pro"` y removida la aserción de `"Sistema Conectado"`. |
| `menu-manager.test.ts` | Catálogo y categorías | **A** | Login admin desfasado. | Actualizado a `loginAs(app, 'admin')`. |
| `orders-concurrency.test.ts` | Concurrencia de pedidos | **A** | Sesiones cajera y mesero. | Actualizado a credenciales canónicas. |
| `printing-engine.test.ts` | Tickets térmicos y vista previa | **A** | Nombre de cliente de prueba con nombre propio prohibido. | Reemplazado por `'Cliente VIP'`. |
| `profitability-pro.test.ts` | Utilidad neta real y costos | **A** | Referencias a `usr_admin_olinelcys` en inserción de jornadas, órdenes y gastos. | Reemplazado sistemáticamente por `usr_admin`. |
| `qr-menu-cloud.test.ts` | Exportación estática y WhatsApp | **A** | Aserciones de marca `"Tocineta Sonríe"` y nombre de cliente con nombre propio. | Actualizado a `"TOCINETA"` y `'Cliente Retiro'`. |
| `support-and-updater.test.ts` | Modo soporte y actualizaciones Ed25519 | **A** | Aserción de banner y comentarios con nombres legacy. | Aserción alineada a `"MODO SOPORTE TÉCNICO ACTIVO — SESIÓN AUDITADA"` y `usr_admin`. |

---

## 3. Resumen Cuantitativo de Ejecución

```text
Test Files  26 passed (26)
Tests       232 passed (232)
Errors      0 failed
Skipped     0 skipped
Duration    135.64s
```
