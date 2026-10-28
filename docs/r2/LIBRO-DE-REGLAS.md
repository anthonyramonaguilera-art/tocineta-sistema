# LIBRO DE REGLAS — SISTEMA TOCINETA (Ronda 2)

Ruta en el repo: `docs/r2/LIBRO-DE-REGLAS.md`.
Fuente de verdad de las reglas numéricas y de negocio de TOCINETA.

---

## 1. REGLA D1 — Jornada Global Única y Sedes Oficiales
- **Fórmula / Invariante:** Existe como máximo UNA sola jornada en estado `abierta` en todo el sistema (`ux_jornada_abierta ON jornadas(status) WHERE status='abierta'`).
- **Sedes oficiales:** Exactamente 2 sedes activas: `loc_los_olivos` ("Sede A: Los Olivos") y `loc_alta_vista` ("Sede B: Alta Vista").
- **Columna heredada `jornadas.location_id`:**
  - En versiones anteriores a R2, las jornadas se abrían por sede (`jornadas.location_id`).
  - Bajo la regla D1 (jornada global única para todo el negocio), la columna `jornadas.location_id` queda formalmente como **columna heredada sin uso** (deprecated/unused legacy column).
  - No se elimina físicamente de la base de datos para preservar la compatibilidad binaria de SQLite y migraciones previas.
  - El selector de sede de la aplicación es exclusivamente un filtro analítico y de reportes.
  - Caja y Cierre ignoran el selector de sede y consolidan la jornada completa de la empresa.
- **Implementación:**
  - Base de datos: migración `0029_r2_sedes_y_jornada_global.sql`.
  - Backend: `apps/server/src/modules/cashier/cashier-service.ts` (`getCurrentJornada`, `openJornada`, `openCashSession`).
  - Catálogo de sedes: `apps/server/src/modules/profitability/locations-service.ts` (`OFFICIAL_LOCATIONS`, `resolveLocationId`).
