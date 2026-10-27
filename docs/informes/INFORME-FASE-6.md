# INFORME DE FASE 6: PERSONAL, PERMISOS, NÓMINA Y PROPINAS
**Sistema Operativo Gastronómico TOCINETA (v3.0)**  
**Fecha:** 2026-10-27  
**Rama Git:** `reconstruccion`  
**Tag Base:** `f5` (o `fase-5`)  
**Tag Resultante:** `fase-6` (y `f6`)  

---

## 1. RESUMEN EJECUTIVO

La **Fase 6: Personal, Permisos y Nómina** ha sido implementada y validada en su totalidad con los más altos estándares de ingeniería y diseño blindado (`AGENTS.md`). El módulo dota a la dueña de control absoluto sobre la estructura de su equipo, eliminando la dependencia de perfiles genéricos, blindando la trazabilidad de cada acción operativa y financiera, y automatizando tanto las liquidaciones salariales como el reparto justo del pool de propinas del turno.

### Módulos Entregados:

1. **A) Usuarios Individuales y Permisos Granulares**:
   - **Cuentas Individuales con Nombre Real:** Creación y gestión de trabajadores con nombre real, usuario individual único (ej. `@lmendez`), PIN privado (4 o 6 dígitos), rol oficial y esquema salarial.
   - **Deprecación de Perfiles Genéricos:** Las cuentas semilla de instalación (`admin`, `cajera`, `mesero`, `plancha`, `despacho`) tienen activación obligatoria de cambio de clave (`must_change_pin = 1`), forzando a la administración a definir credenciales seguras.
   - **Permisos Granulares por Rol y Persona:**
     - `CASHIER_OPERATE` (`Cobrar en Caja`): Registrar cobros, vueltos y cuadres.
     - `VOID_ORDER` / `VOID_OR_REFUND` (`Anular Órdenes / Reembolsos`): Anular pedidos abiertos o procesar reembolsos autorizados.
     - `MENU_EDIT` (`Editar Carta y Precios`): Modificar disponibilidad, ingredientes o precios de venta.
     - `VIEW_COSTS` (`Ver Costos de Insumos`): Acceso a costos unitarios y desglose de recetas.
     - `PROFITABILITY_VIEW` (`Ver Ganancias y Utilidad`): Acceso al estado de resultados, márgenes y métricas de finanzas.
     - `POS_ACCESS` / `TAKE_ORDERS` (`Tomar Pedidos en Salón / Delivery`).
   - **Blindaje de Visibilidad:** Costos y utilidades permanecen ocultos en la UI y bloqueados en el servidor para cualquier usuario que no cuente con los permisos explícitos.

2. **B) Trazabilidad Integral de Operaciones**:
   - Cada entidad registra el autor responsable de la acción:
     - **Pedidos:** `created_by_user_id` en `orders`.
     - **Cobros:** `recorded_by_user_id` en `payments`.
     - **Anulaciones y Devoluciones:** `cancelled_by_user_id` en `orders` y `authorizer_user_id` en `incidents`.
     - **Descuentos Comerciales:** `discount_by_user_id` y `discount_reason` en `orders`.
     - **Mermas y Pérdidas:** `registered_by` en `waste_logs` y `authorized_by_user_id` en `operating_expenses`.

3. **C) Nómina Integral y Liquidaciones con Cenas Asumidas**:
   - **Bandera en Ajustes:** Interruptor maestro para activar/desactivar el módulo de nómina según conveniencia del negocio (`payroll_enabled`).
   - **Esquema Salarial Flexible:** Configuración individual por trabajador con frecuencia (`DIARIO`, `SEMANAL`, `QUINCENAL`) y salario base acordado en USD (`base_salary_usd_cents`).
   - **Ajustes:** Registro auditado de bonificaciones (incentivos, puntualidad) y adelantos de sueldo entregados a cuenta.
   - **Cuenta de Consumos del Empleado:** Registro de pedidos o alimentos consumidos por el trabajador durante sus jornadas.
   - **Cena Fija del Personal Configurable:** Interruptor `fixed_dinner_enabled` con costo unitario configurable (por defecto `$2.50 USD`). Si está activo, el costo de la cena del turno es registrado como gasto operativo de personal (`ALIMENTACION_PERSONAL` en `operating_expenses`) y **NO** se descuenta del sueldo del trabajador.
   - **Liquidación Selectiva (Cobrar o Perdonar):** La dueña dispone de una interfaz interactiva donde revisa el desglose y selecciona con checkboxes individuales qué consumos cobrar y cuáles perdonar (cortesía de la empresa).
   - **Fórmula Canónica de Liquidación:**
     $$\text{Neto a Pagar} = \text{Salario Base} + \text{Bonos} - \text{Adelantos} - \text{Consumos Adicionales Cobrados}$$
   - **Recibo de Pago Oficial en PDF:** Generación instantánea de recibo formal en formato PDF (vía PDFKit), con desglose de haberes, deducciones, consumos cobrados/perdonados, tasa BCV del día, fecha y firmas de conformidad.

4. **D) Pool de Propinas del Turno**:
   - Registro de propinas acumuladas en USD y Bolívares durante la jornada (`tip_pools`).
   - Selección dinámica de los meseros presentes en el turno.
   - Dos modalidades canónicas de reparto:
     - **Reparto Igual (`EQUAL`):** División en partes equitativas entre todos los meseros activos.
     - **Ponderado por Horas (`HOURS`):** Distribución proporcional a las horas efectivas trabajadas en el turno por cada mesero.
   - Cierre formal del pool con bloqueo de modificaciones y generación de registros individuales de distribución (`tip_pool_distributions`) con trazabilidad de pago (`PENDIENTE` / `PAGADO`).

---

## 2. VALIDACIÓN TÉCNICA OBLIGATORIA (QUALITY GATES)

En estricto cumplimiento de la Regla 4 de `AGENTS.md`, se ejecutaron y aprobaron todos los validadores de calidad:

### 2.1. Guardia de UI (`pnpm run guard`)
```text
$ node scripts/ui-guard.mjs
--- EJECUTANDO UI-GUARD (Reglas Estrictas de Sistema de Diseño) ---
✓ UI-GUARD: Todas las reglas semánticas y de gobernanza pasaron con éxito.
```

### 2.2. Validación Estática de Tipos TypeScript (`pnpm -r run lint`)
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
```text
Scope: 4 of 5 workspace projects
packages/shared build$ tsc -b
packages/shared build: Done
apps/web build$ tsc -b && vite build
apps/server build$ tsc -b && node --input-type=module -e "import fs from 'node:fs'; fs.cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });"
apps/server build: Done
apps/web build: vite v6.4.4 building for production...
apps/web build: transforming...
apps/web build: ✓ 1811 modules transformed.
apps/web build: rendering chunks...
apps/web build: computing gzip size...
apps/web build: dist/index.html                                     1.63 kB │ gzip:   0.74 kB
apps/web build: dist/assets/index-CKrLz1TL.css                     54.21 kB │ gzip:   9.84 kB
apps/web build: dist/assets/StaffManagementView-4P_zBirW.js        37.44 kB │ gzip:   9.72 kB
apps/web build: dist/assets/index-DZEVXWQb.js                     387.99 kB │ gzip: 110.48 kB
apps/web build: ✓ built in 12.05s
apps/web build: Done
```

### 2.4. Suite de Pruebas Automatizadas de Fase 6 (`vitest`)
- **Archivo:** `test/fase6-staff-payroll-tips.test.ts`
- **Resultado:** 5 de 5 suites aprobadas (100% green, Exit Code 0).
```text
 RUN  v3.2.7 C:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/apps/server

 ✓ test/fase6-staff-payroll-tips.test.ts (5 tests) 2610ms
   ✓ 1. Usuarios: creación de empleados individuales, unicidad y cambio obligatorio de PIN en semillas
   ✓ 2. Permisos granulares: verificación estricta de autorización en cobro, anulación, costos y utilidades
   ✓ 3. Trazabilidad integral: autor en órdenes, cobros, anulaciones, descuentos y mermas
   ✓ 4. Nómina: liquidación exacta, consumos cobrados vs perdonados y cena fija como gasto del local
   ✓ 5. Propinas: pool acumulado, reparto equitativo y por horas entre meseros

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  8.29s
```

### 2.5. Auditoría de Límites de Archivo (Regla 2: Máximo 400 líneas)
Todos los archivos creados y refactorizados cumplen estrictamente con el límite establecido:
| Archivo | Líneas | Estado |
| :--- | :---: | :---: |
| `packages/shared/src/utils/rbac.ts` | 172 | ✅ Conforme |
| `apps/server/src/routes/auth.ts` | 372 | ✅ Conforme |
| `apps/server/src/routes/auth-actions.ts` | 304 | ✅ Conforme |
| `apps/server/src/modules/incidents/incidents-service.ts` | 394 | ✅ Conforme |
| `apps/server/src/modules/staff/users-service.ts` | 397 | ✅ Conforme |
| `apps/server/src/modules/staff/payroll-service.ts` | 280 | ✅ Conforme |
| `apps/server/src/modules/staff/settlement-service.ts` | 184 | ✅ Conforme |
| `apps/server/src/modules/staff/tips-service.ts` | 265 | ✅ Conforme |
| `apps/server/src/modules/staff/payroll-pdf.ts` | 123 | ✅ Conforme |
| `apps/server/src/modules/staff/admin-routes.ts` | 189 | ✅ Conforme |
| `apps/server/src/modules/staff/payroll-routes.ts` | 208 | ✅ Conforme |
| `apps/server/src/modules/staff/tips-routes.ts` | 163 | ✅ Conforme |
| `apps/web/src/features/staff/StaffManagementView.tsx` | 297 | ✅ Conforme |
| `apps/web/src/features/staff/PayrollSection.tsx` | 190 | ✅ Conforme |
| `apps/web/src/features/staff/TipPoolSection.tsx` | 259 | ✅ Conforme |
| `apps/web/src/features/staff/EmployeeModal.tsx` | 174 | ✅ Conforme |
| `apps/web/src/features/staff/PermissionsModal.tsx` | 144 | ✅ Conforme |
| `apps/web/src/features/staff/PayrollAdjustmentModal.tsx` | 144 | ✅ Conforme |
| `apps/web/src/features/staff/StaffConsumptionModal.tsx` | 164 | ✅ Conforme |
| `apps/web/src/features/staff/SettlementModal.tsx` | 320 | ✅ Conforme |
| `apps/web/src/features/staff/useStaffData.ts` | 207 | ✅ Conforme |
| `apps/web/src/features/staff/types.ts` | 68 | ✅ Conforme |

---

## 3. LIQUIDACIÓN DE EJEMPLO REVISADA A MANO

Conforme a las instrucciones de Fase 6, se ejecutó una liquidación de prueba hand-checked con datos reales:

### Caso de Auditoría:
- **Trabajadora:** Lucía Méndez
- **Cargo:** Mesero (`mesonero`)
- **Usuario:** `@lmendez`
- **Esquema:** Semanal
- **Tasa Oficial del Día:** 40.00 Bs/USD

### Desglose Financiero:
1. **Haberes:**
   - **Salario Base Acordado:** `$50.00 USD` (5.000 centavos)
   - **Bonificaciones Acumuladas:** `+$15.00 USD` (1.500 centavos por bono de puntualidad y servicio)
   - **Subtotal Haberes:** `$65.00 USD`

2. **Deducciones:**
   - **Adelanto de Quincena Entregado:** `-$10.00 USD` (1.000 centavos)
   - **Consumo 1 (Hamburguesa Doble Especial):** MARCADO `[Cobrar]` $\rightarrow$ `-$4.00 USD` (400 centavos)
   - **Consumo 2 (Refresco Familiar 1.5L):** DESMARCADO `[Perdonar / Cortesía Dueña]` $\rightarrow$ `$0.00 USD` descontado (300 centavos absorbidos por el local)
   - **Consumo 3 (Hamburguesa Doble Especial):** MARCADO `[Cobrar]` $\rightarrow$ `-$4.00 USD` (400 centavos)
   - **Subtotal Deducciones:** `-$18.00 USD`

3. **Cena Fija del Personal Asumida:**
   - **Cenas registradas:** 3 cenas de turno
   - **Costo unitario:** `$2.50 USD` (Total: `$7.50 USD`)
   - **Tratamiento:** Se asume al 100% como gasto operativo del local (`ALIMENTACION_PERSONAL` en `operating_expenses`). **Descuento en nómina: $0.00**.

4. **Cálculo Matemático Final:**
   $$\text{Neto USD} = \$50.00 + \$15.00 - \$10.00 - \$8.00 = \mathbf{\$47.00\text{ USD}}$$
   $$\text{Neto Bs} = \$47.00 \times 40.00 = \mathbf{Bs.\ 1.880,00}$$

5. **Efectos Contables y Auditoría:**
   - Se registró la liquidación con ID consecutivo en `staff_payroll_settlements`.
   - Se actualizaron los consumos cobrados a `status = 'COBRADO'` y el consumo perdonado a `status = 'PERDONADO'`.
   - Se generó el recibo en formato PDF oficial en disco: `data/receipts/recibo_nomina_usr_01a17ce3-7183-7dc6-b042-8cab963323df_*.pdf`.

---

## 4. REGISTRO FOTOGRÁFICO DE AUDITORÍA (SCREENSHOTS)

A continuación se presentan las capturas oficiales generadas mediante Playwright en entorno de producción simulado:

### 4.1. Semilla de Instalación con Cambio Obligatorio de Clave
Comprobación de que las cuentas genéricas iniciales fuerzan el cambio obligatorio de PIN antes de permitir operar:
![Semilla Cambio Obligatorio PIN](file:///C:/Users/Shell/.gemini/antigravity-ide/brain/a559eaf1-5d82-46f6-93c0-dbaba2438971/capturas_fase6/00_semilla_cambio_obligatorio_pin.png)

### 4.2. Vista Principal de Personal y Permisos (Desktop)
Muestra la lista de trabajadores con nombres reales, badges de roles, permisos asignados y salarios base:
![Personal y Permisos Desktop](file:///C:/Users/Shell/.gemini/antigravity-ide/brain/a559eaf1-5d82-46f6-93c0-dbaba2438971/capturas_fase6/01_personal_permisos_view.png)

### 4.3. Vista Principal en Dispositivo Móvil (390x844)
Comprobación de diseño touch-first adaptable sin overflow:
![Personal y Permisos Móvil](file:///C:/Users/Shell/.gemini/antigravity-ide/brain/a559eaf1-5d82-46f6-93c0-dbaba2438971/capturas_fase6/01_personal_permisos_view-mobile.png)

### 4.4. Modal de Creación de Nuevo Empleado Individual
Formulario guiado con nombre real, usuario único para login, PIN de acceso, rol y esquema salarial inicial:
![Modal Nuevo Empleado](file:///C:/Users/Shell/.gemini/antigravity-ide/brain/a559eaf1-5d82-46f6-93c0-dbaba2438971/capturas_fase6/02_nuevo_empleado_modal.png)

### 4.5. Modal de Permisos Granulares por Trabajador
Configuración individual de permisos críticos: Cobrar en Caja, Anular Órdenes, Editar Carta/Precios, Ver Costos de Insumos y Ver Ganancias/Utilidad:
![Modal Permisos Granulares](file:///C:/Users/Shell/.gemini/antigravity-ide/brain/a559eaf1-5d82-46f6-93c0-dbaba2438971/capturas_fase6/03_permisos_granulares_modal.png)

### 4.6. Módulo de Nómina y Banderas en Ajustes
Panel de nómina con flags de activación, cena fija del personal asumida por el local ($2.50 USD/cena), botonera de acciones y resumen de esquemas:
![Nómina y Ajustes](file:///C:/Users/Shell/.gemini/antigravity-ide/brain/a559eaf1-5d82-46f6-93c0-dbaba2438971/capturas_fase6/04_nomina_ajustes_view.png)

### 4.7. Modal de Liquidación Interactiva (Elección de Cobrar o Perdonar)
Demostración de la liquidación de Lucía Méndez con selección de consumos mediante checkboxes y cálculo reactivo en tiempo real:
![Liquidación Interactiva](file:///C:/Users/Shell/.gemini/antigravity-ide/brain/a559eaf1-5d82-46f6-93c0-dbaba2438971/capturas_fase6/05_liquidacion_modal_seleccion.png)

### 4.8. Módulo de Pool de Propinas del Turno
Panel de apertura, acumulación en USD/Bs, selector de modalidad (Igual vs Por Horas), selección de meseros y cálculo en vivo del reparto:
![Pool de Propinas](file:///C:/Users/Shell/.gemini/antigravity-ide/brain/a559eaf1-5d82-46f6-93c0-dbaba2438971/capturas_fase6/06_pool_propinas_view.png)

---

## 5. DEFINITION OF DONE (DOD) CHECKLIST

- [x] **A) Usuarios y Permisos:**
  - [x] Empleados creados con nombre real, usuario individual único y rol.
  - [x] Cuentas genéricas semilla con cambio obligatorio de PIN (`must_change_pin = 1`).
  - [x] Permisos configurables por rol y persona (`cobrar`, `anular`, `editar carta`, `ver costos`, `ver ganancias`).
  - [x] Costos y utilidades visibles únicamente para quienes poseen el permiso correspondiente.
- [x] **B) Trazabilidad Completa:**
  - [x] Autor registrado en cada orden (`created_by_user_id`).
  - [x] Autor registrado en cada cobro (`recorded_by_user_id`).
  - [x] Autor registrado en cada anulación/reembolso (`cancelled_by_user_id` / incidentes).
  - [x] Autor y motivo guardado en cada descuento (`discount_by_user_id`, `discount_reason`).
  - [x] Autor registrado en cada merma o pérdida de inventario.
- [x] **C) Nómina y Liquidaciones:**
  - [x] Bandera configurable en Ajustes (`payroll_enabled`).
  - [x] Esquema por persona (diario, semanal, quincenal) y monto base.
  - [x] Registro de bonos y adelantos.
  - [x] Cuenta del empleado con consumos.
  - [x] Cena fija del personal configurable (asumida como gasto de personal del local, sin descuento al trabajador).
  - [x] Liquidación con fórmula: `Neto = base + bonos − adelantos − consumos adicionales cobrados`.
  - [x] Selección interactiva previa de qué consumos cobrar o perdonar.
  - [x] Generación de recibo oficial en PDF.
- [x] **D) Propinas:**
  - [x] Pool de propinas configurable entre meseros del turno.
  - [x] Reparto igual (`EQUAL`) o por horas trabajadas (`HOURS`).
  - [x] Registro, cierre y distribución formal.
- [x] **Gobernanza y Reglas de Ingeniería:**
  - [x] Marca oficial única: **"TOCINETA"**; cero referencias o nombres prohibidos.
  - [x] Cero emojis en botones y títulos (`Icon` de `lucide-react`).
  - [x] Modo Claro por defecto (`WCAG AA`) con tokens semánticos de diseño.
  - [x] Límite estricto de archivos: **ningún archivo supera las 400 líneas**.
  - [x] Quality gates aprobados: `pnpm run guard`, `pnpm -r run lint` y `pnpm -r run build`.
  - [x] Pruebas automatizadas aprobadas (100% en Vitest).
  - [x] Registro fotográfico completo en `docs/auditoria/capturas/fase6/`.
  - [x] Liquidación revisada a mano documentada.
