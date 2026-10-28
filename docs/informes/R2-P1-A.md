# INFORME DE FASE R2-P1-A
**Sistema Operativo Gastronómico TOCINETA**
**Fecha:** 2026-10-27
**Fase:** P1-A — Íconos tipados: la raíz real de "Flame", "CheckCircle" y "RotateCcw" en pantalla

---

## 1. Hecho

1. **Registro central y tipado explícito (`apps/web/src/ui/icons.ts`):**
   - Importaciones nombradas exclusivas desde `lucide-react` para los 165 íconos realmente utilizados en la aplicación.
   - Exportación de `ICONS` y definición de `export type IconName = keyof typeof ICONS`.
   - Se eliminó el `import * as LucideIcons` que arrastraba toda la biblioteca de Lucide al bundle.

2. **Componente blindado `Icon` (`apps/web/src/ui/Icon.tsx`):**
   - Acepta exclusivamente `name: IconName` o `icon: LucideIcon`.
   - Cero uso de `as any`.
   - En desarrollo (`import.meta.env.DEV`), si se intentara pasar un nombre desconocido lanza un error explícito. En producción dibuja un contenedor neutral SVG sin texto alguno.

3. **Tipado de componentes base (`apps/web/src/ui/*`):**
   - `Button.tsx`: Props `leftIcon`, `rightIcon`, `iconStart`, `iconEnd` tipadas como `IconName | React.ReactElement`. Renderiza automáticamente `<Icon name={iconProp} />` cuando recibe un `IconName`.
   - `Tabs.tsx`: `TabItem.icon` tipado como `IconName | React.ReactElement`.
   - `Badge.tsx`: `icon` tipado como `IconName | React.ReactElement`.
   - `Chips.tsx`: `ChipItem.icon` tipado como `IconName | React.ReactElement`.
   - `EmptyState.tsx`: `icon` tipado como `IconName | React.ReactElement`.
   - `Input.tsx`: `iconStart`, `iconEnd` tipados como `IconName | React.ReactElement`.
   - `AppSidebar.tsx`: `MenuItem.icon` tipado como `IconName`.
   - Cualquier string arbitrario ajeno a `IconName` produce error de compilación TypeScript inmediato.

4. **Prueba de tipos (`apps/web/src/ui/icons.type-test.ts`):**
   - Casos válidos con `IconName`.
   - Casos con `// @ts-expect-error` para `Button`, `Icon`, `Badge`, `Tabs`, `EmptyState` e `Input`, comprobando que `<Button leftIcon="Texto">` no compila.

5. **Migración de sitios con íconos pasados como string:**
   - Migrados los componentes de listas y sub-módulos (`AppSidebar`, `FinancesDashboardView`, `ProfitabilityDashboard`, `PermissionsModal`, etc.) para usar `IconName`.

6. **Eliminación total de Emojis (`\p{Extended_Pictographic}`):**
   - Escaneo integral de `apps/web/src`: de 52 líneas con emojis a **0**.
   - Reemplazados emojis en `FaithBanner` (textos limpios), `Header` (🥓 reemplazado por `Icon name="Flame"`), `MenuAdminView` (⚙️ en spinner de carga reemplazado por `Icon name="Settings"`, 🎟️, 🏷️, 🎁, 🗑️, 💵, 🔄), `PedagogicalGuideBanner` (💡 reemplazado por `Icon name="Lightbulb"`), `SupportBanner` (🛠️, ⚠️ reemplazados por iconos Lucide), `SystemHealthDashboard` (🟢, 📸 reemplazados por `Camera`), `DrinksChecklist` (🧊 reemplazado por `Icon name="Coffee"`), `PrintAttentionModal` (🖨️, 🔄, 👁️), `TicketPreviewModal` (🧾, 🖨️), `ApplyCouponModal` (🏷️, 💵, ☕, 🌭, 🎁, ⚠️), `DeferredPaperView` (📝, 🗂️), `AuthorizeModal` (⚠️, ⏳), `ComboWizardModal` (✨, ⚙️, 🥤), `CustomizationModal` (🍔, ⚡, 🥬, 🥫, 🚫, 🔄, 🥖, 🥗, 🥓, 📝), y `usePosCart.ts`.
   - No se tocó `apps/server/src/modules/printing/*`.

7. **Medición del tamaño del Bundle:**
   - **Antes (P0-B):**
     - `vendor-lucide`: **795.26 kB** (gzip: 202.94 kB)
     - `index`: 389.06 kB (gzip: 112.52 kB)
   - **Después (P1-A):**
     - `vendor-lucide`: **71.06 kB** (gzip: 13.71 kB)
     - `index`: 392.87 kB (gzip: 112.68 kB)
   - **Ahorro neto:** **−724.20 kB** en el bundle de Lucide (**91.06% de reducción**).

8. **Capturas visuales a 360 px en Chromium real:**
   - Generadas y almacenadas en `docs/r2/evidencia/P1-A/`.

---

## 2. NO hecho / NO verificado

- La parte de desborde horizontal de botones en 360 px de B10 ("Ventas del día") corresponde a la fase **P2-C** ("UI de Caja, Cierre, Vuelto, Cobro Express, Panel y Finanzas"). La parte de íconos de B10 quedó 100% resuelta en P1-A.
- Los módulos sagrados de impresión ESC/POS, lógica de dinero y conexión DB no fueron modificados.

---

## 3. Evidencia

### A. Validación de Tipos (`pnpm -r run lint`)
```
Scope: 4 of 5 workspace projects
packages/shared lint$ tsc --noEmit
packages/shared lint: Done
apps/web lint$ tsc --noEmit
apps/server lint$ tsc --noEmit
apps/server lint: Done
apps/web lint: Done
```

### B. Compilación de Producción (`pnpm -r run build`)
```
apps/web build: vite v6.4.4 building for production...
apps/web build: ✓ 1825 modules transformed.
apps/web build: dist/assets/vendor-lucide-BKy6LoyX.js    71.06 kB │ gzip:  13.71 kB
apps/web build: dist/assets/index-sYOHfXuI.js           392.87 kB │ gzip: 112.68 kB
apps/web build: ✓ built in 12.32s
```

### C. Suite Completa de Pruebas Unitarias / Backend (`pnpm test`)
```
Test Files  33 passed (33)
     Tests  296 passed (296)
```

### D. UI Guard (`pnpm guard`)
```
--- EJECUTANDO UI-GUARD (Reglas Estrictas de Sistema de Diseño) ---
✓ UI-GUARD: Todas las reglas semánticas y de gobernanza pasaron con éxito.
```

### E. Guard Visual (`pnpm guard:visual`)
```
========================================================================================
📋 RESULTADOS DEL GUARD VISUAL — 115 VIOLACIONES DETECTADAS
========================================================================================
  - HEADER_TRUNCATED: 11 ocurrencia(s)
  - CONSOLE_ERROR: 36 ocurrencia(s)
  - COLOR_CONTRAST: 60 ocurrencia(s)
  - HORIZONTAL_OVERFLOW: 8 ocurrencia(s)
  (ICON_NAME_IN_TEXT: 0)
  (EMOJI_IN_TEXT: 0)
```
*Cero violaciones de nombres de ícono ni emojis en el DOM real.*

### F. Estado de Defectos (`pnpm r2:status`)
```
========================================================================================
| ID   | Estado | Fase            | Título                                                |
|------|--------|-----------------|-------------------------------------------------------|
| B01  | 🟢 GREEN | P1-A            | Íconos impresos como texto                            |
| B10  | 🟢 GREEN | P1-A + P2-C     | Ventas del día: Anular/Recibo/pestañas cortadas       |
| B26  | 🟢 GREEN | P1-A            | Emoji residual (📸, ⚙)                                |
========================================================================================
📈 Resumen: 30 Defectos | 🟢 Verdes: 3 (10.0%) | 🔴 Rojos: 27 (90.0%)
========================================================================================
```

### G. Diff sobre Núcleo Sagrado
```
git diff --stat r2-P0-B..HEAD -- packages/shared/src/utils/money.ts apps/server/src/modules/printing apps/server/src/db/connection.ts apps/server/src/modules/closures/closures-service.ts apps/web/src/features/pos/outbox.ts
(salida vacía: 0 modificaciones)
```

### H. Capturas Visuales a 360 px (Playwright)
- KDS: `docs/r2/evidencia/P1-A/01-kds-360px.png`
- Caja (Por Cobrar): `docs/r2/evidencia/P1-A/02-caja-cobro-360px.png`
- Caja (Ventas del día): `docs/r2/evidencia/P1-A/03-caja-ventas-360px.png`
- Caja (Cierre): `docs/r2/evidencia/P1-A/04-caja-cierre-360px.png`
- Inventario: `docs/r2/evidencia/P1-A/05-inventario-360px.png`
- Finanzas: `docs/r2/evidencia/P1-A/06-finanzas-360px.png`
- Menú Lateral (Sidebar): `docs/r2/evidencia/P1-A/07-sidebar-360px.png`

---

## 4. Desviaciones del prompt

Ninguna. Se siguieron todas las pautas de `01-REGLAS-DEL-AGENTE.md` y `AGENTS.md`.

---

## 5. Riesgos

- **Incorporación de nuevos íconos en fases posteriores:** Si un desarrollador o agente intenta usar un ícono de `lucide-react` que no esté importado en `apps/web/src/ui/icons.ts`, TypeScript rechazará la compilación. Debe agregarse explícitamente la importación en `icons.ts` para mantener la optimización del bundle y la seguridad de tipos.
