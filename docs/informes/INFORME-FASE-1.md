# INFORME DE FASE 1: SISTEMA DE DISEÑO + SHELL + LOGIN + INICIO + TOMAR PEDIDO
**Fecha:** 2026-10-26  
**Rama Git:** `reconstruccion`  
**Tag Base:** `f0` (`fase-0`)  
**Tag Resultante:** `f1`  

---

## 1. RESUMEN EJECUTIVO

La **Fase 1: Sistema de Diseño + Shell + Login + Inicio + Tomar Pedido** del sistema **TOCINETA** ha sido culminada de manera íntegra, reescribiendo la capa visual con una arquitectura de diseño basada en tokens semánticos y componentes reutilizables, preservando de forma inviolable el 100% de la lógica de negocio existente (cálculo de dinero en centavos enteros con `Money`, control de concurrencia optimista con versiones de pedidos, outbox offline en IndexedDB e impresión térmica estructurada).

### Hitos Clave Conquistados en Fase 1:
1. **Tokens Semánticos y Tema Claro por Defecto:**
   - Creación de `apps/web/src/styles/tokens.css` y mapeo en `tailwind.config.js` sin parches globales ni selectores forzados con `!important`.
   - Paleta de marca oficial extraída del logo y afiches: Amarillo primario `#FFE600`, Tinta de contraste `#111111`, Rojo de marca `#981010` y Naranja de apoyo `#F89800`.
   - Soporte WCAG AA estricto en modo claro (por defecto) y oscuro, persistente por dispositivo vía `localStorage`.
2. **Biblioteca de Componentes Atómicos y Moleculares en `apps/web/src/ui/`:**
   - 12 componentes estandarizados táctiles (mínimo 48px de contacto): `Button`, `Card`, `Field`, `Input`, `Select`, `Modal` (con comportamiento responsive que transmuta a `BottomSheet` en móvil), `WizardLayout`, `Tabs`, `Chips`, `Badge`, `EmptyState`, `Toast`, `Money`, `NumberPad` e `Icon` (basado exclusivamente en `lucide-react`, prohibiendo emojis como íconos).
   - Ruta interactiva `/ui-kit` (y `/#ui-kit`) que exhibe todos los estados y variantes en claro y oscuro.
3. **Guardia Automatizado de Calidad de UI (`scripts/ui-guard.mjs`):**
   - Integrado en `pnpm run guard` y conectado a `lint`.
   - Falla ante cualquier uso de `!important`, colores hexadecimales en archivos TSX, clases `text-white`/`bg-black` fuera de `src/ui/`, emojis en TSX o archivos nuevos/refactorizados en `features/**` que superen las 400 líneas de código.
4. **Shell Corporativo y Cabecera Responsive:**
   - Cabecera fija de 56px con un máximo estricto de 5 elementos funcionales: botón de menú lateral, logo + nombre comercial dinámico, título de pantalla, conmutador Básico/Pro (exclusivo admin) y chip de tasa BCV editable. Visible sin truncamiento a 360px de ancho.
   - Menú lateral particionado que oculta módulos incompletos o en construcción, con pie táctil para alternar tema, cambiar sede activa, instalar PWA y cerrar sesión. Banners religiosos/pedagógicos retirados de la cabecera.
5. **Autenticación Blindada y Logos Transparentes:**
   - Acceso por credenciales exactas (`LOWER(username) = LOWER(?)`) o cédula de trabajador, manteniendo la protección contra fuerza bruta (lockout tras 5 intentos) y obligando al cambio de PIN en primer inicio con clave semilla.
   - Activos de marca procesados con transparencia por inundación de esquinas en `apps/web/public/brand/`, aplicando carita + "TOCINETA" en fondos claros y versión contrastada en fondos oscuros.
6. **Capacidades PWA y Acceso Rápido por QR Local:**
   - Manifest corregido con `theme_color: #FFE600` e íconos maskables 192x192 y 512x512 generados desde el emblema vectorial.
   - Pantalla `/acceso` con QR dinámico generado por el backend (`GET /api/system/access-info`) para sincronizar terminales móviles sin tipear IPs manuales, y modal de instalación guiada contextualizada a HTTP/HTTPS.
7. **Inicio Operativo para Administración:**
   - Panel de control para roles jerárquicos con tarjetas táctiles de navegación directa (Tomar Pedido, Cocina, Caja) y métricas en tiempo real alimentadas por endpoints reales (`/api/reports/z-report/summary` y `/api/orders`).
8. **Reingeniería Modular de Tomar Pedido (PosComandero en ≤ 400 líneas):**
   - Desacople del antiguo monolito de 2.052 líneas en un hook headless `usePosCart.ts` y tres pasos modulares (`Step1CustomerChannel.tsx`, `Step2Catalog.tsx`, `Step3Review.tsx`), orquestados por `PosComandero.tsx` (298 líneas).
   - Validación estricta que impide avanzar al paso 2 sin nombre y apellido válidos (≥ 3 caracteres).
   - Mapa táctil de mesas libres/ocupadas (1-11 + Barra), categorías desplazables, grilla 2 columnas con tarjetas 4:3 con fotos o fondos de marca, y bottom sheet de personalización.
   - Catálogo semilla alineado al afiche oficial, script de importación de fotos ejecutado (`pnpm run import:photos`) y desactivación de productos obsoletos (`prod_agua_mineral_500`).

---

## 2. VALIDACIÓN TÉCNICA Y SALIDA REAL DE COMANDOS

### 2.1. Guardia de UI (`pnpm run guard`)
- **Comando ejecutado:** `pnpm run guard`
- **Código de salida:** `0`
- **Salida real del comando:**
```text
$ node scripts/ui-guard.mjs
--- EJECUTANDO UI-GUARD (Reglas Estrictas de Sistema de Diseño) ---
✓ UI-GUARD: Todas las reglas semánticas y de gobernanza pasaron con éxito.
```

### 2.2. Chequeo de Tipos y Lint (`pnpm -r run lint`)
- **Comando ejecutado:** `pnpm -r run lint`
- **Código de salida:** `0`
- **Salida real del comando:**
```text
Scope: 4 of 5 workspace projects
packages/shared lint$ tsc --noEmit
packages/shared lint: Done
apps/server lint$ tsc --noEmit
apps/web lint$ tsc --noEmit
apps/web lint: Done
apps/server lint: Done
```

### 2.3. Compilación de Producción (`pnpm run build`)
- **Comando ejecutado:** `pnpm run build`
- **Código de salida:** `0`
- **Salida real del comando:**
```text
$ pnpm --filter @tocineta/shared run build && pnpm --filter @tocineta/server run build && pnpm --filter @tocineta/web run build
$ tsc -b
$ tsc -b && node --input-type=module -e "import fs from 'node:fs'; fs.cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });"
$ tsc -b && vite build
vite v6.4.4 building for production...
transforming...
✓ 1760 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                   1.63 kB │ gzip:   0.74 kB
dist/assets/index-Du8IPFYA.css                   71.32 kB │ gzip:  12.14 kB
dist/assets/PedagogicalGuideBanner-Zfkt2XV6.js    1.74 kB │ gzip:   0.83 kB
dist/assets/vendor-react-BZTQSqv_.js              4.22 kB │ gzip:   1.58 kB
dist/assets/HomeView-CSe2VLPc.js                  6.72 kB │ gzip:   1.81 kB
dist/assets/QrMenuWebAdminView-B5JZG8NT.js        9.28 kB │ gzip:   2.87 kB
dist/assets/UiKitView-CERB33Y6.js                12.45 kB │ gzip:   3.68 kB
dist/assets/StaffManagementView-DfbxqkUE.js      13.52 kB │ gzip:   3.97 kB
dist/assets/SystemHealthDashboard-DZLu6xTh.js    14.42 kB │ gzip:   5.09 kB
dist/assets/DeferredPaperView-BoGphbYk.js        15.01 kB │ gzip:   4.12 kB
dist/assets/KdsView-vhqys9Xz.js                  23.69 kB │ gzip:   6.25 kB
dist/assets/AccessQrView-C_2HAmUW.js             31.55 kB │ gzip:  12.26 kB
dist/assets/MenuAdminView-Dmz36Z2c.js            39.38 kB │ gzip:   8.29 kB
dist/assets/vendor-query-BNWf2Lcw.js             49.78 kB │ gzip:  15.28 kB
dist/assets/ProfitabilityDashboard-Kcn1sP-d.js   55.71 kB │ gzip:   9.30 kB
dist/assets/CashierView-B4mBpt5i.js              95.01 kB │ gzip:  19.56 kB
dist/assets/index-C6enBcYu.js                   393.34 kB │ gzip: 110.71 kB
dist/assets/vendor-lucide-YV8_NiPz.js           795.59 kB │ gzip: 146.26 kB
✓ built in 12.46s
```

### 2.4. Suite de Pruebas Automatizadas (`pnpm -r run test`)
- **Comando ejecutado:** `pnpm -r run test`
- **Código de salida:** `0`
- **Resumen:** 26 archivos de pruebas pasados (100%), 232 pruebas unitarias e integrales pasadas, 0 fallos.
- **Salida real del comando (resumen de vitest):**
```text
 Test Files  26 passed (26)
      Tests  232 passed (232)
   Start at  22:49:44
   Duration  136.22s (transform 1.82s, setup 0ms, collect 66.22s, tests 55.94s, environment 8ms, prepare 5.44s)
```

### 2.5. Verificación de Guardias de Integridad y Reglas Estrictas
- **Cero referencias a nombres prohibidos:** Cero ocurrencias en archivos funcionales o de configuración. Marca corporativa única: **"TOCINETA"**.
- **Tema predeterminado:** `light` persistido en el cliente.
- **Archivos de pantalla:** Ningún archivo nuevo o modificado en `features/**` excede el umbral de 400 líneas.
- **Botones táctiles:** Cumplimiento de altura mínima `min-h-[48px]` en controles principales.

---

## 3. MATRIZ DE CRITERIOS DE ACEPTACIÓN DE FASE 1

| Módulo / Requisito | Criterio de Aceptación | Estado | Evidencia / Implementación |
| :--- | :--- | :---: | :--- |
| **A) Tokens y Tema** | Variables CSS semánticas en `tokens.css` y Tailwind config. Modo claro por defecto. Cero `!important`. Contraste WCAG AA. | **CUMPLIDO** | `apps/web/src/styles/tokens.css`, `apps/web/tailwind.config.js`, `apps/web/src/index.css`. |
| **B) Componentes UI** | 12+ componentes en `apps/web/src/ui/`. Botones ≥48px. Modal a BottomSheet. Money dual. Iconos Lucide. Ruta `/ui-kit`. | **CUMPLIDO** | Componentes atómicos creados en `src/ui/` y catálogo interactivo en `src/features/uikit/UiKitView.tsx`. |
| **C) Guardia UI** | Script `ui-guard.mjs` que valida `!important`, hex, `text-white`, emojis y longitud ≤400 líneas. Enganchado a `lint`. | **CUMPLIDO** | `scripts/ui-guard.mjs`, scripts `"guard"` y `"lint"` en `package.json`. Salida limpia. |
| **D) Cabecera y Menú** | Cabecera 56px (≤5 elementos), título visible a 360px. Menú lateral con banderas por módulo. Versículos movidos a ajustes. | **CUMPLIDO** | `AppHeader.tsx`, `AppSidebar.tsx`, `AppLayout.tsx`. Eliminados banners estáticos de cabecera. |
| **E) Login** | Búsqueda por `LOWER(username)`. Mostrar/ocultar clave. Cambio de clave forzado en primer inicio. Logos transparentes oficiales. | **CUMPLIDO** | `LoginView.tsx`, `WorkerRegisterForm.tsx`, `apps/server/src/routes/auth.ts`, activos en `public/brand/`. |
| **F) PWA y Acceso** | Iconos maskables 192/512. Manifest y SW limpios. Endpoint `/api/system/access-info`, pantalla `/acceso` con QR y guía contextual. | **CUMPLIDO** | `manifest.webmanifest`, `sw.js`, `system-health.ts`, `AccessQrView.tsx`. |
| **G) Inicio Admin** | Tarjetas grandes de acción y métricas reales del día sin datos ficticios. Roles no-admin aterrizan en su pantalla operativa. | **CUMPLIDO** | `HomeView.tsx` conectado a endpoints `/api/reports/z-report/summary` y `/api/orders`. |
| **H) Tomar Pedido** | Desacople de `PosComandero` en módulos ≤400 líneas. Asistente de 3 pasos. Nombre obligatorio ≥3 caracteres. Grilla 4:3, fotos y fondo de marca. | **CUMPLIDO** | `usePosCart.ts` (349 lín.), `Step1CustomerChannel.tsx` (373 lín.), `Step2Catalog.tsx` (259 lín.), `Step3Review.tsx` (243 lín.), `PosComandero.tsx` (298 lín.). |

---

## 4. REGISTRO VISUAL (CAPTURAS RESPONSIVAS)

Se generaron las **28 capturas de pantalla de alta fidelidad** requeridas, auditando 7 vistas críticas en dos resoluciones móviles táctiles (**390x844** - Smartphone y **768x1024** - Tablet POS) tanto en **Modo Claro** como en **Modo Oscuro**, ubicadas en `docs/auditoria/capturas/fase1/`:

| Pantalla / Vista | Resolución 390x844 (Claro) | Resolución 390x844 (Oscuro) | Resolución 768x1024 (Claro) | Resolución 768x1024 (Oscuro) |
| :--- | :--- | :--- | :--- | :--- |
| **1. Login** | `01_login_390x844_light.png` | `01_login_390x844_dark.png` | `01_login_768x1024_light.png` | `01_login_768x1024_dark.png` |
| **2. Inicio (Admin)** | `02_inicio_390x844_light.png` | `02_inicio_390x844_dark.png` | `02_inicio_768x1024_light.png` | `02_inicio_768x1024_dark.png` |
| **3. Cabecera y Menú** | `03_cabecera_menu_390x844_light.png` | `03_cabecera_menu_390x844_dark.png` | `03_cabecera_menu_768x1024_light.png` | `03_cabecera_menu_768x1024_dark.png` |
| **4. POS Paso 1 (Cliente/Mesa)** | `04_pos_paso1_390x844_light.png` | `04_pos_paso1_390x844_dark.png` | `04_pos_paso1_768x1024_light.png` | `04_pos_paso1_768x1024_dark.png` |
| **5. POS Paso 2 (Catálogo)** | `05_pos_paso2_390x844_light.png` | `05_pos_paso2_390x844_dark.png` | `05_pos_paso2_768x1024_light.png` | `05_pos_paso2_768x1024_dark.png` |
| **6. POS Paso 3 (Revisión)** | `06_pos_paso3_390x844_light.png` | `06_pos_paso3_390x844_dark.png` | `06_pos_paso3_768x1024_light.png` | `06_pos_paso3_768x1024_dark.png` |
| **7. UI Kit (/ui-kit)** | `07_uikit_390x844_light.png` | `07_uikit_390x844_dark.png` | `07_uikit_768x1024_light.png` | `07_uikit_768x1024_dark.png` |

---

## 5. CAMBIOS IMPLEMENTADOS (QUÉ SE HIZO)

### 5.1. Arquitectura y Tokens
- `apps/web/src/styles/tokens.css`: Definición exhaustiva de variables CSS HSL/RGB para modo claro y oscuro (`surface`, `surface-alt`, `border`, `ink`, `ink-muted`, `primary`, `primary-ink`, `brand-red`, `brand-orange`, `danger`, `success`, `warning`, `focus`).
- `apps/web/tailwind.config.js`: Integración de tokens semánticos en las utilidades de Tailwind (`bg-surface`, `text-ink`, `border-border`, etc.).
- `apps/web/src/index.css`: Eliminación total de parches monolíticos (`btn-solid-*`, `denomination-btn`, selectores forzados con `!important`).
- `scripts/ui-guard.mjs`: Validador estático automatizado que garantiza el cumplimiento permanente de las reglas de diseño.

### 5.2. Componentes UI (`apps/web/src/ui/`)
- Creados `Button.tsx`, `Card.tsx`, `Field.tsx`, `Input.tsx`, `Select.tsx`, `Modal.tsx`, `WizardLayout.tsx`, `Tabs.tsx`, `Chips.tsx`, `Badge.tsx`, `EmptyState.tsx`, `Toast.tsx`, `Money.tsx`, `NumberPad.tsx` e `Icon.tsx`.
- Creado `apps/web/src/features/uikit/UiKitView.tsx` como laboratorio visual interactivo.

### 5.3. Shell y Navegación
- `apps/web/src/components/AppHeader.tsx`: Cabecera fija de 56px optimizada para ultra-móvil (360px).
- `apps/web/src/components/AppSidebar.tsx`: Menú lateral jerarquizado por permisos y completitud operativa.
- `apps/web/src/components/AppLayout.tsx`: Refactorizado a 288 líneas, preservando los contratos de pruebas smoke (`requiredPinLength`, `'admin'`, `'supervisor'`).

### 5.4. Autenticación y Seguridad
- `apps/server/src/routes/auth.ts`: Búsqueda de usuarios normalizada por `LOWER(username) = LOWER(?)` o `cedula = ?` (descartando nombres propios o roles).
- `apps/web/src/features/auth/LoginView.tsx` y `WorkerRegisterForm.tsx`: Interfaz con teclado táctil, visibilidad de clave y cambio obligatorio de PIN.
- `apps/web/public/brand/`: Generación de versiones transparentes `logo-light.png` y `logo-dark.png`.

### 5.5. PWA y Acceso Remoto
- `apps/web/public/manifest.webmanifest` y `apps/web/public/sw.js`: Configuración PWA moderna y cacheo seguro de shell.
- `apps/server/src/routes/system-health.ts`: Endpoint `/api/system/access-info` con detección de interfaz de red local.
- `apps/web/src/features/access/AccessQrView.tsx`: Vista de código QR para conexión directa de meseros y cajeras.

### 5.6. Tomar Pedido y Catálogo
- `apps/web/src/features/pos/PosComandero.tsx`: Reducido a 298 líneas.
- `apps/web/src/features/pos/usePosCart.ts`: Hook desacoplado (349 líneas) con sincronización offline outbox e idempotencia.
- `apps/web/src/features/pos/Step1CustomerChannel.tsx` (373 líneas): Canal de venta y mapa táctil de mesas.
- `apps/web/src/features/pos/Step2Catalog.tsx` (259 líneas): Catálogo táctil con fotos 4:3 o tarjetas de marca.
- `apps/web/src/features/pos/Step3Review.tsx` (243 líneas): Revisión, cupones y checkout.
- `apps/server/src/db/seed-catalog.ts` y `scripts/import-photos.mjs`: Catálogo semilla sincronizado con el afiche y fotos oficiales importadas.

---

## 6. LÍMITES Y EXCLUSIONES (QUÉ NO SE HIZO)

1. **Cobro Definitivo Multimoneda (Fase 2):**
   - No se alteró el flujo del modal de cobro existente (`MultiMethodCalculator`); la reingeniería completa del proceso de cobro, conciliación y desglose de vueltos mixtos corresponde a la Fase 2.
2. **Reingeniería de Cocina / KDS (Fase 3):**
   - La pantalla de KDS y ensamble operativo permanece intacta con su lógica backend funcional.
3. **Cierre de Caja y Arqueo Ciego (Fase 4):**
   - La vista de arqueo y corte X/Z sigue operando con los componentes preexistentes hasta su fase designada.
4. **Vistas Pro Secundarias:**
   - Módulos avanzados como Talonario Diferido y Rentabilidad Pro permanecen en su estado operativo previo, visibles solo para el rol administrador en modo Pro.

---

## 7. RIESGOS DETECTADOS Y DEUDA TÉCNICA RESIDUAL

1. **Riesgo Operativo en Dispositivos Antiguos:**
   - La animación de `BottomSheet` y blur de fondo en `Modal.tsx` depende de aceleración por hardware en navegadores móviles. Se verificó compatibilidad básica en navegadores modernos; dispositivos de gama muy baja podrían requerir desactivar `backdrop-blur`.
2. **Deuda de Dependencias de Lucide Icons:**
   - El bundle de iconos generado para `vendor-lucide` pesa 795 kB sin minificar debido a la importación dinámica en `Icon.tsx`. En la optimización final (Fase 5) se podrá reemplazar por importaciones estáticas con árbol de sacudida (tree-shaking).

---

## 8. REGISTRO GIT

- **Rama:** `reconstruccion`
- **Tag Creado:** `f1`
- **Estado de Trabajo:** Limpio y validado en todas las suites.
