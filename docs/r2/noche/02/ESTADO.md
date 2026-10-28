# ESTADO DE EJECUCIÓN — NOCHE-02 (TOCINETA R2)
**Última actualización:** 2026-10-28 12:43

---

## 1. FASE ACTUAL: P3 COMPLETADA -> INICIANDO P4-A
- **Fase 0 (Reconciliar P1-B):** COMPLETADA (Tag: `r2-p1-b-cierre`). 6 defectos en verde (B02, B03, B04, B06, B21, B25).
- **Fase P3 (POS + KDS de un toque con alertas):** COMPLETADA (Tag: `r2-p3`). 3 defectos en verde (B05, B11, B23). Total defectos en verde: 18/30 (60.0%).
- **Fase P4-A (Inventario D2, Recetas, Mermas y Errores 500):** EN INICIO.

---

## 2. TAREAS HECHAS EN P3
1. **Migración 0030 (`0030_r2_ask_table_on_order.sql`):** Añadido `ask_table_on_order` a `business_settings` (default 0).
2. **Backend Settings (`settings-routes.ts`, `business-settings.ts`):** Exposición de `ask_table_on_order` en API.
3. **Frontend Settings (`BusinessSettingsView.tsx`):** Switch "Solicitar mesa al tomar pedido" (≤ 400 líneas).
4. **Hook KDS Alertas (`useKdsAlerts.ts`):** Audio Web Audio API + vibración háptica 200/100/200 + destello perimetral, silenciando ráfagas iniciales y ofreciendo desbloqueo de AudioContext.
5. **Hook KDS Acciones (`useKdsActions.ts`):** Despacho y actualización táctil en 1 toque.
6. **KDS Cards y View (`KdsCard.tsx`, `KdsView.tsx`):** Tipografía ≥ 18px bold, eliminación de opacidades reducidas que degradaban el contraste, botón prominente `data-testid="kds-one-touch-ready"`, soporte móvil vs desktop.
7. **POS Flujo y Cobro Arriba (`Step1CustomerChannel.tsx`, `Step3Review.tsx`, `PosComandero.tsx`, `WizardLayout.tsx`):** Canal en 1 fila de 3 chips, mesa opcional por defecto, botón de cobro accesible arriba del pliegue (y < 200px), barra sticky de totales en paso 3.
8. **Tokens y Contraste WCAG AA:** Corrección de `--color-warning` a `#92400E` (5.9:1 contraste), eliminación de `animate-pulse` que afectaba la luminancia en auditorías de Axe, erradicación de 404s en consola de `#pos`.
9. **Puertas de Calidad:**
   - `pnpm guard` -> PASS
   - `pnpm -r run lint` -> PASS
   - `pnpm -r run build` -> PASS
   - `pnpm test` -> PASS (308 tests server)
   - `pnpm r2:e2e` (B05, B11, B23) -> PASS (6/6)
   - `pnpm guard:visual` -> CERO violaciones en `#pos` y `#kds`.
10. **Capturas de Evidencia:** `01-pos-step1-360px.png`, `02-pos-step3-360px.png`, `03-kds-360px.png` guardadas en `docs/r2/evidencia/P3/`.

---

## 3. DECISIONES Y DISCREPANCIAS
- **D1 y D2:** Confirmados por el dueño y reflejados en `00-PLAN-MAESTRO.md`.
- **404s en POS:** Se eliminaron llamadas no respaldadas por backend en el cliente para `/api/profitability/customers` y `/api/staff`, dejando handlers locales limpios.
- **Guard Visual 52 violaciones residuales:** Pertenecen estrictamente a `#cashier`, `#profitability`, `#finances`, `#owner`, `#quotes`, `#menu-admin`, `#staff` (fases P4 y P6).

---

## 4. BLOQUEOS
- Ninguno en P3.

---

## 5. SIGUIENTE PASO EXACTO
- Ejecutar commit atómico de P3 y crear tag `r2-p3`.
- Comenzar Fase P4-A según `docs/r2/P4-A.md`.
