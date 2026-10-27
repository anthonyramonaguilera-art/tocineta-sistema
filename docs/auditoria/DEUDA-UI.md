# Auditoría de Deuda Técnica de UI — Sistema TOCINETA

**Fecha de auditoría:** 2026-10-26  
**Alcance:** Código fuente del frontend (`apps/web/src`)  
**Herramienta de escaneo:** Analizador estático de código Node.js / TypeScript AST

---

## 1. Resumen Cuantitativo de Deuda UI

| Métrica Auditada | Cantidad Detectada | Nivel de Riesgo | Impacto Operativo y Recomendación |
| :--- | :---: | :---: | :--- |
| **Declaraciones `!important`** | **13** | **Medio** | Presentes en hojas de estilos CSS (`index.css`), forzando overrides en clases utilitarias. Deben reemplazarse por especificidad limpia de CSS o variables de tema. |
| **Clases `text-white` rígidas** | **444** | **Crítico** | En **Modo Claro (`light`)**, el uso indiscriminado de `text-white` sobre fondos sin clase oscura (`bg-neutral-900`) genera texto invisible (blanco sobre blanco). Debe condicionarse semánticamente a `text-slate-900 dark:text-white`. |
| **Colores Hex fijos (`#HEX`)** | **112** | **Alto** | Valores como `#121620`, `#1A1F2B`, `#0d1117` incrustados en componentes TSX. Impiden una adaptación fluida del sistema de diseño. Deben migrarse a tokens semánticos en Tailwind y CSS variables. |
| **Líneas con Emojis como Íconos** | **322** | **Medio** | Uso de emojis de sistema (🍔, 🥤, 🟢, 🟣, 🇻🇪, 💵, 📦, 🕒, ✕) en botones y títulos. Se renderizan de forma inconsistente según la versión de Android/iOS/Windows. Deben migrarse a SVG vectoriales de `lucide-react`. |
| **Archivos con más de 400 líneas** | **13** | **Alto** | Monolitos de UI de alta complejidad que dificultan mantenimiento, testing unitario y refactorización. Requieren descomposición en subcomponentes atómicos. |

---

## 2. Archivos Críticos con Más de 400 Líneas

| Archivo | Conteo de Líneas | Módulos / Responsabilidades Mezcladas |
| :--- | :---: | :--- |
| `apps/web/src/features/cashier/CashierView.tsx` | **2.180** | Arqueo ciego, acordeón de órdenes, cobro rápido, modales de cierre, retiros y egresos en un solo archivo. |
| `apps/web/src/features/pos/PosComandero.tsx` | **2.019** | Catálogo táctil, carrito de compras, gestión de comensales, delivery, outbox offline y sincronización. |
| `apps/web/src/features/profitability/ProfitabilityDashboard.tsx` | **1.561** | Costeo de recetas, conciliación física de inventario, ingeniería de menú, nómina y compras a proveedores. |
| `apps/web/src/components/MenuAdminView.tsx` | **1.497** | Editor de productos, ingredientes, modificadores, raciones y configuración de impresoras en el mismo módulo. |
| `apps/web/src/components/AppLayout.tsx` | **1.077** | Barra superior, selector de sedes, drawer móvil, modal BCV, modal de instalación PWA y modal de PIN. |
| `apps/web/src/features/kds/KdsView.tsx` | **811** | Pantalla de cocina, estados de líneas, filtrado por estación (plancha/perros) y despacho de pedidos. |
| `apps/web/src/features/cashier/MultiMethodCalculator.tsx` | **785** | Modal flotante para cálculo de pagos mixtos (USD, Bs, Pago Móvil, Punto) y cálculo de vueltos. |
| `apps/web/src/features/pos/CustomizationModal.tsx` | **559** | Modal de personalización de ingredientes, barra libre y extras de cada plato. |
| `apps/web/src/features/emergency/DeferredPaperView.tsx` | **556** | Transcripción diferida de comandas de papel y validación de duplicidad de seriales de contingencia. |
| `apps/web/src/features/pos/ComboWizardModal.tsx` | **484** | Asistente de selección paso a paso para combos multi-ítem y bebidas. |
| `apps/web/src/components/SystemHealthDashboard.tsx` | **474** | Telemetría local, estado de cola de impresión, latencia SQLite y diagnóstico de red. |
| `apps/web/src/features/staff/StaffManagementView.tsx` | **446** | Matriz de permisos temporales por PIN y gestión de usuarios. |
| `apps/web/src/features/delivery/DriverSettlementModal.tsx` | **438** | Modal de liquidación nocturna de repartidores y retención de efectivo. |

---

## 3. Auditoría de Vistas Duplicadas y Redirecciones

Durante la inspección de la arquitectura de carpetas entre `src/components/` y `src/features/`, se identificó la existencia de wrappers y re-exportaciones duplicadas:

### 1. `MenuAdminView`
- **Ruta A:** `apps/web/src/components/MenuAdminView.tsx` (1.497 líneas) — **Implementación Activa Principal.** Contiene la lógica completa de administración del menú.
- **Ruta B:** `apps/web/src/features/menu-admin/MenuAdminView.tsx` (3 líneas) — **Proxy / Re-exportación:**
  ```tsx
  export * from '../../components/MenuAdminView.js';
  export { MenuAdminView as default } from '../../components/MenuAdminView.js';
  ```
- **Riesgo:** Confusión en la importación de módulos en nuevas rutas y falta de consistencia de arquitectura basada en features.
- **Acción requerida (Fase posterior):** Mover el código fuente de `components/MenuAdminView.tsx` a `features/menu-admin/MenuAdminView.tsx` y eliminar el wrapper legado en `components/`.

### 2. `PosView` vs `PosComandero`
- **Ruta A:** `apps/web/src/features/pos/PosComandero.tsx` (2.019 líneas) — **Implementación Activa Principal** del Comandero Táctil.
- **Ruta B:** `apps/web/src/components/PosView.tsx` (9 líneas) — **Wrapper superficial:**
  ```tsx
  import React from 'react';
  import { PosComandero } from '../features/pos/PosComandero.js';
  export const PosView: React.FC = () => <PosComandero />;
  export default PosView;
  ```
- **Riesgo:** Mantenimiento de capas intermedias innecesarias que aumentan el árbol de renderizado de React.
- **Acción requerida (Fase posterior):** Montar directamente `<PosComandero />` en `App.tsx` y retirar el componente puente `PosView.tsx`.
