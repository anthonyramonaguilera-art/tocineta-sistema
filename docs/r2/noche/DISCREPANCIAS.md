# DISCREPANCIAS — Sesión NOCHE-01

Registro de hechos verificados que no coinciden con el código o cambios imprevistos en contratos y esquemas.

---

### Discrepancia 1: Esquema de `waste_logs` sin columna `jornada_id`
- **Componente:** `apps/server/src/modules/finances/financial-truth-helpers.ts` (`calculateDeduplicatedWaste`)
- **Observación:** La tabla `waste_logs` en SQLite (definida en migración 23) no tiene columna `jornada_id` (a diferencia de `worker_incidents` que sí la tiene). Filtrar por `WHERE jornada_id = ?` arrojaba `SqliteError: no such column: jornada_id`.
- **Ajuste Técnico:** `calculateDeduplicatedWaste` filtra `waste_logs` por el rango temporal de la jornada (`created_at_ms >= fromMs AND created_at_ms <= toMs`), lo cual respeta la semántica temporal exacta de la jornada y preserva la integridad de la base de datos sin requerir migraciones estructurales no planificadas.
