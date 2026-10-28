# REGISTRO DE DISCREPANCIAS Y REPARTO DE HALLAZGOS — NOCHE-02

## 1. Archivo de Instrucciones de Sesión
- **Discrepancia:** La instrucción inicial citaba la ruta `docs/r2/NOCHE-02.md`, pero el archivo fue depositado como `docs/NOCHE-02.md`.
- **Resolución:** Se movió el archivo a `docs/r2/NOCHE-02.md` y se preservó el commit inicial `chore(r2): estado previo a noche-02`.

## 2. Auditoría de Solo Lectura de Migración 0029
- **Discrepancia:** El resumen de la sesión NOCHE-01 indicaba textualmente que la migración `0029_r2_sedes_y_jornada_global.sql` reasignaba `sede_alta_vista` y *"sedes no oficiales"* a `loc_alta_vista`.
- **Hallazgo Real en Código:** La migración 0029 únicamente reasigna registros donde `location_id = 'sede_alta_vista'`. No contiene comodines ni cláusulas que capturen sedes ajenas. No existe riesgo de haber mezclado ventas o datos de terceras sedes en `loc_alta_vista`.

## 3. Reparto de Hallazgos de `guard:visual` (Fase 0 vs Fases Posteriores)
- **Atendidos y resueltos en Fase 0 (P1-B):**
  - `#staff`: Desborde horizontal (scrollWidth 427px > innerWidth 360px) resuelto al dotar la barra de pestañas de desplazamiento horizontal seguro (`overflow-x-auto max-w-full pb-1`).
  - `#staff`: Violación de contraste en pestaña activa resuelta (`text-ink` con borde `border-primary`).
  - `#menu-admin`: 173 violaciones de contraste resueltas aplicando tokens semánticos oficiales WCAG AA, reemplazando clases oscuras y fondos amarillos con texto claro por `bg-primary text-primary-ink`, y actualizando `--color-success` a `#166534`.
  - Global `InfoCallout`: Icono en variante info ajustado a `bg-primary text-primary-ink` eliminando amarillo sobre gris claro.
- **Hallazgos restantes asignados a fases posteriores (no tocados en Fase 0):**
  - `#pos`: 4 violaciones de contraste y 8 errores de consola -> Asignados a **Fase P3** (Comandero táctil).
  - `#kds`: 8 violaciones de contraste -> Asignados a **Fase P3** (KDS Cocina).
  - `#profitability`: 4 desbordes horizontales -> Asignados a **Fase P4** (Inventario y recetas).
  - `#cashier`: 4 violaciones de contraste -> Asignados a **P2-C / auditoría final**.
  - `#finances`: 8 violaciones de contraste y 8 errores de consola -> Asignados a **Fase P6-B**.
  - `#owner`: 8 violaciones de contraste -> Asignados a **Fase P6-B**.
  - `#quotes`: 8 errores de consola -> Asignados a **Fase P4-C**.
  - Errores de consola (HTTP 403 Forbidden) en roles `cajera`, `mesero` y `plancha` al visitar `#menu-admin` y `#staff`: Comportamiento de seguridad esperado del backend Fastify al bloquear rutas administrativas para roles no autorizados.
