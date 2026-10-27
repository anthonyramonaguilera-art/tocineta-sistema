# INFORME DE FASE 4: ENVÍOS ENTRE SEDES + DELIVERY POR SEDE + PANEL DE LA DUEÑA + ACCESO REMOTO
**Sistema Operativo Gastronómico TOCINETA (v3.0)**  
**Fecha:** 2026-10-27  
**Rama Git:** `reconstruccion`  
**Tag Base:** `f3`  
**Tag Resultante:** `f4` (o `fase-4`)  

---

## 1. RESUMEN EJECUTIVO

La **Fase 4: Envíos entre Sedes + Delivery por Sede + Panel de la Dueña + Acceso Remoto** ha sido completada en su totalidad con éxito absoluto, cumpliendo el 100% de los criterios del Definition of Done (DoD) y las directrices de ingeniería y gobernanza estricta (`AGENTS.md`).

### Aspectos Clave de la Entrega:
1. **Arquitectura Centralizada (Single Hub con `location_id`)**:  
   Se respeta rigurosamente la decisión arquitectónica acordada: un solo servidor central (Hub) que administra ambas sedes (`loc_los_olivos` para Sede A y `loc_alta_vista` para Sede B), eliminando la complejidad de sincronización multimaestro entre servidores SQLite y garantizando consistencia ACID inmediata.
2. **Asistente de Envíos entre Sedes con 3 Modos**:  
   - Modo 1: Insumos Sueltos.
   - Modo 2: Por Equivalente de Platos terminados (ej. 30 hamburguesas + 50 perros calientes) calculando automáticamente los requerimientos exactos de materias primas a partir de las fichas técnicas, permitiendo edición de cantidades antes de despachar.
   - Modo 3: Lotes Preconfigurados con nombre (crear, editar, listar, usar en 1 toque y borrar).
   - Generación de Notas de Despacho consecutivas (`NDP-XXXX`), vista previa térmica en Ticket IR (58 mm / 32 columnas), generación de documento PDF oficial descargable y formato optimizado para compartir por WhatsApp.
   - Modo configurable "En Tránsito" con confirmación de recepción en destino y mecanismo de forzado ante stock insuficiente condicionado a motivo justificado y PIN de supervisor.
3. **Delivery y Liquidación por Sede Real**:  
   Se desacopló definitivamente el texto plano de notas anteriores: ahora los repartidores, despachos y liquidaciones (`delivery_driver_settlements`) portan `location_id` real, preservando de forma intacta la contabilidad de la venta de comida frente al cobro del servicio de flete.
4. **Registro de Producción en Sede A**:  
   Módulo para asentar lotes de sub-recetas (salsas, carnes preparadas, etc.) o platos pre-cocidos, descontando atómicamente los insumos crudos y acreditando la existencia del producto elaborado en el inventario local.
5. **Panel Móvil de la Dueña (Supervisión Ejecutiva)**:  
   Interfaz mobile-first (`#owner`) optimizada para teléfonos celulares, con actualización reactiva en vivo vía canal WebSocket, visualización de ventas de hoy desglosadas por sede y canal, saldos en caja (USD y Bs), alertas de reposición de stock, últimos traslados e indicador de salud de dispositivos (En línea / Sin conexión con conteo de outbox).
6. **Acceso Remoto Blindado y Cero Contratación No Autorizada**:  
   - Siguiendo la regla de gobernanza, **no se contrató ni instaló ningún servicio de terceros** sin confirmación previa del usuario.
   - Se redactó el runbook integral `docs/runbooks/ACCESO-REMOTO-TUNEL.md` con la comparativa detallada de costos y limitaciones vigentes hoy (Cloudflare Tunnel, Tailscale y Ngrok).
   - Se crearon los lanzadores por lotes `scripts/remote-tunnel-cloudflare.bat` y `scripts/remote-tunnel-tailscale.bat`.
   - Se blindó el servidor Hub: exigencia estricta de HTTPS para conexiones remotas, expiración reducida de sesión a 2 horas, rate-limit con lockout y auditoría criptográfica con eventos `REMOTE_LOGIN_SUCCESS` y `REMOTE_ACCESS_BLOCKED`.

---

## 2. VALIDACIÓN TÉCNICA OBLIGATORIA (SALIDA REAL DE COMANDOS)

Conforme a la Regla 4 de `AGENTS.md`, la fase no se declara terminada sin antes verificar los quality gates de validación estricta:

### 2.1. Guardia de UI (`pnpm run guard`)
- **Comando:** `pnpm run guard`
- **Resultado:** Exitoso (Exit Code 0).
- **Salida:**
```text
$ node scripts/ui-guard.mjs
--- EJECUTANDO UI-GUARD (Reglas Estrictas de Sistema de Diseño) ---
✓ UI-GUARD: Todas las reglas semánticas y de gobernanza pasaron con éxito.
```

### 2.2. Chequeo de Tipos y TypeScript (`pnpm -r run lint`)
- **Comando:** `pnpm -r run lint`
- **Resultado:** Exitoso en los 4 workspaces (Exit Code 0).
- **Salida:**
```text
Scope: 4 of 5 workspace projects
packages/shared lint$ tsc --noEmit
packages/shared lint: Done
apps/web lint$ tsc --noEmit
apps/server lint$ tsc --noEmit
apps/server lint: Done
apps/web lint: Done
```

### 2.3. Compilación de Producción (`pnpm -r run build`)
- **Comando:** `pnpm -r run build`
- **Resultado:** Exitoso en todos los paquetes (Exit Code 0).
- **Salida:**
```text
Scope: 4 of 5 workspace projects
packages/shared build$ tsc -b
packages/shared build: Done
apps/server build$ tsc -b && node --input-type=module -e "import fs from 'node:fs'; fs.cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });"
apps/web build$ tsc -b && vite build
apps/server build: Done
apps/web build: vite v6.4.4 building for production...
apps/web build: transforming...
apps/web build: ✓ 1789 modules transformed.
apps/web build: rendering chunks...
apps/web build: computing gzip size...
apps/web build: dist/index.html                                     1.63 kB │ gzip:   0.74 kB
apps/web build: dist/assets/index-BERK2NOY.css                     54.10 kB │ gzip:   9.88 kB
apps/web build: dist/assets/OwnerDashboardView-CaWOCUvS.js         10.54 kB │ gzip:   2.91 kB
apps/web build: dist/assets/DispatchNoteSuccessModal-g05pcX81.js    2.76 kB │ gzip:   1.23 kB
apps/web build: dist/assets/ProfitabilityDashboard-BNTSYmWL.js     99.20 kB │ gzip:  21.10 kB
apps/web build: ✓ built in 11.82s
apps/web build: Done
```

### 2.4. Suite de Pruebas Automatizadas de Fase 4 (`vitest`)
- **Comando:** `pnpm --filter @tocineta/server test test/fase4-transfers-delivery-remote.test.ts`
- **Resultado:** 11 de 11 pruebas aprobadas (100% green, Exit Code 0).
- **Salida:**
```text
 RUN  v3.2.7 C:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/apps/server

 ✓ test/fase4-transfers-delivery-remote.test.ts (11 tests) 2462ms
   ✓ 1. Asistente de envíos: debe calcular los insumos equivalentes para 30 hamburguesas y 50 perros
   ✓ 2. Transferencia atómica: si ocurre un fallo simulado a la mitad, no altera stocks (Rollback ACID)
   ✓ 3. Validación de stock insuficiente: rechaza sin PIN y autoriza con PIN de supervisor
   ✓ 4. Estado en tránsito: resta en origen y solo suma en destino tras confirmación explícita
   ✓ 5. Envío real "30 hamburguesas y 50 perros" con movimiento exacto y consecutivos
   ✓ 6. Lotes preconfigurados: crear, listar, usar y borrar en 1 toque
   ✓ 7. Registro de producción: descuenta insumos crudos y suma stock del producto/preparación
   ✓ 8. Delivery por sede: repartidores y liquidación asignados a location_id real
   ✓ 9. Panel de la dueña: consolida ventas por sede, caja, alertas de stock y envíos recientes
   ✓ 10. Acceso remoto: rechaza HTTP si requiere HTTPS, limita sesión a 2h y registra auditoría
   ✓ 11. Idempotencia y concurrencia: dos envíos concurrentes no corrompen saldo de stock

 Test Files  1 passed (1)
      Tests  11 passed (11)
```

---

## 3. COMPROBACIÓN DEL ENVÍO REAL DE PRUEBA: "30 HAMBURGUESAS + 50 PERROS"

En estricto cumplimiento de los Criterios de Cierre exigidos por el usuario, se ejecutó y validó el caso de prueba integral de traslado entre sedes:

- **Origen:** Sede A: Los Olivos (`loc_los_olivos`)
- **Destino:** Sede B: Alta Vista (`loc_alta_vista`)
- **Platos Seleccionados:**
  - 30 Hamburguesas Clásicas (`prod_americana_deluxe`)
  - 50 Perros Calientes (`prod_street_dog`)
- **Expansión Matemática de Insumos Calculada por Receta:**
  - 30 und — Pan Brioche Artesanal (`sup_pan_brioche`)
  - 30 und — Carne Prime Smash 150g (`sup_carne_smash_150g`)
  - 60 rebanadas — Queso Cheddar Fundido (`sup_queso_cheddar`)
  - 93.75 tiras — Tocineta Ahumada Crujiente (`sup_tocineta_ahumada`)
  - 1.5 porciones — Cebolla Morada Fresca (`sup_cebolla_morada`)
  - 50 und — Pan de Perro Caliente (`sup_pan_perro_art`)
  - 50 und — Salchicha Especial de Pollo (`sup_salchicha_pol`)
- **Resultado del Movimiento en Base de Datos:**
  - Código consecutivo asignado: `NDP-0001`
  - Origen (`loc_los_olivos`): Stock reducido exactamente según la lista.
  - Destino (`loc_alta_vista`): Stock incrementado exactamente según la lista en la misma transacción atómica SQLite.
  - Registro de auditoría emitido: `TRANSFER_CREATED` con hash criptográfico en la cadena inmutable.

---

## 4. ANÁLISIS DE ACCESO REMOTO Y POLÍTICA DE SERVICIOS EXTERNOS

| Proveedor / Solución | Costo Actual Verificado | Apertura de Puertos | Cifrado / Seguridad | Limitaciones Reales Detectadas | Estado de Instalación |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cloudflare Tunnel (`cloudflared`)** | **$0.00** (Gratis en Zero Trust) | Cero puertos requeridos | SSL gestionado automático + WAF Anti-DDoS | Requiere dominio gestionado en Cloudflare DNS | **NO instalado** (a la espera de confirmación) |
| **Tailscale (WireGuard Mesh)** | **$0.00** (Plan Personal gratis) | Cero puertos requeridos | Túnel privado WireGuard directo punto a punto | Requiere instalar cliente Tailscale en tablets y celular | **NO instalado** (a la espera de confirmación) |
| **Ngrok / Pinggy** | $8 – $20 / mes | Cero puertos requeridos | SSL en proxy del proveedor | URL dinámica en plan gratis, límites de concurrencia | **Descartado** por coste recurrente |

> [!NOTE]
> Siguiendo la política de gobernanza, los scripts `scripts/remote-tunnel-cloudflare.bat` y `scripts/remote-tunnel-tailscale.bat` han sido estructurados para requerir la confirmación interactiva y descarga explícita del usuario antes de cualquier ejecución en el sistema.

---

## 5. ÍNDICE DE CAPTURAS OFICIALES DE FASE 4

Las evidencias visuales generadas por Playwright se encuentran archivadas en `docs/auditoria/capturas/fase4/`:

1. `01-panel-duena-390x844.png`: Panel móvil de la dueña en resolución de celular (390x844), mostrando ventas consolidadas de hoy, desglose por sede, botón de refresco y estado de red ("En línea · 0 pedidos en cola").
2. `01-panel-duena-1024x768.png`: Panel de la dueña en vista panorámica de escritorio/tablet.
3. `02-asistente-envios-calculo-390x844.png`: Asistente de envíos entre sedes con el selector de Sede Origen, Sede Destino y los 3 modos operativos.
4. `02-asistente-platos-30burgers-50dogs.png`: Cálculo en vivo de materias primas para el envío real de 30 hamburguesas y 50 perros calientes con insumos editables.
5. `03-nota-despacho-ticket-ir-pdf.png`: Modal de éxito con consecutivo oficial `NDP-0001`, desglose de insumos, botón de impresión térmica 58mm, descarga de PDF y botón de WhatsApp.
6. `03-envios-en-transito-390x844.png`: Pestaña de control para despachos en tránsito con confirmación de recepción en destino.
7. `04-modal-produccion-taller.png`: Asistente de producción en Sede A para transformar insumos crudos en sub-recetas y preparaciones elaboradas.

---

## 6. DEFINITION OF DONE (DoD) Y CIERRE DE FASE

| Criterio DoD | Verificación | Estado |
| :--- | :--- | :--- |
| **Single Hub con `location_id`** | Drizzle ORM, migraciones SQLite y endpoints con `location_id` | **CUMPLIDO** |
| **Asistente de Envíos (3 Modos)** | Equivalente de platos, insumos sueltos y lotes de 1 toque | **CUMPLIDO** |
| **Nota de Despacho Consecutiva** | Código consecutivo `NDP-XXXX`, Ticket IR 58mm, PDFKit local y WhatsApp | **CUMPLIDO** |
| **Rollback Atómico en Fallos** | Transacción SQLite protegida contra cortes a la mitad (ACID) | **CUMPLIDO** |
| **Autorización con PIN/Motivo** | Validación estricta ante stock insuficiente, autorizable solo con PIN supervisor | **CUMPLIDO** |
| **Delivery con `location_id` Real** | Repartidores y liquidaciones con sede física asignada | **CUMPLIDO** |
| **Producción en Sede A** | Descuento de materias primas y aumento de producto elaborado con logs inmutables | **CUMPLIDO** |
| **Panel de la Dueña Móvil** | Supervisión en vivo de ventas, cajas, alertas de stock y outbox offline | **CUMPLIDO** |
| **Acceso Remoto Seguro** | HTTPS obligatorio, sesión corta de 2h, auditoría y comparativa de túneles | **CUMPLIDO** |
| **PWA Offline Sede A** | Outbox IndexedDB persistente con reintentos idempotentes | **CUMPLIDO** |
| **Límite ≤ 400 líneas / archivo** | Todos los archivos de componentes y vistas cumplen la cota | **CUMPLIDO** |
| **Gobernanza de Marca y UI** | Cero nombres propios prohibidos, cero emojis en botones/títulos, UI-Guard en verde | **CUMPLIDO** |
| **Quality Gates** | `pnpm run guard`, `pnpm -r run lint` y `pnpm -r run build` en verde | **CUMPLIDO** |

**Conclusión:** La Fase 4 se declara formalmente **CERRADA Y APROBADA** para control de versiones y etiquetado `fase-4`.
