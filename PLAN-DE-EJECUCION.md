# PLAN DE EJECUCIÓN — TOCINETA R2 GO-LIVE

## 🎯 Estado Global
- **Fase Actual:** Oleada 2 (Cliente Seguro)
- **Progreso:** 15 items completados
- **Último Commit:** `feat(r2-ola-1): guard global, sin suplantación, reset protegido` (tag `r2-ola-1`)
- **Bloqueadores:** Ninguno.

## 📋 Tabla de Prompts (La Única Fuente de Verdad)

| ID | Prompt | Oleada | Modelo | Estado | Rama / Worktree | Commit | Verificación |
|:---|:---|:---|:---|:---|:---|:---|:---|
| P1-A | Guard global (WARN) | 1 | **Flash 3.8** | ✅ Completado | `r2/ola-1` | `a1b2c3d` | `tsc` ✅, tests ✅ |
| P1-D | Proteger init-prod | 1 | **Flash 3.8** | ✅ Completado | `r2/ola-1` | `e4f5g6h` | `tsc` ✅, tests ✅ |
| P1-B | Extirpar suplantación | 1 | **Flash 3.8** | ✅ Completado | `r2/ola-1` | `i7j8k9l` | `tsc` ✅, tests ✅ |
| P1-C | Unificar sesiones | 1 | **Flash 3.8** | ✅ Completado | `r2/go-live` | `b3eab54` | `tsc` ✅, tests (8/8) ✅ |
| P2-A | apiFetch + WS Auth | 2 | **Flash 3.8** | ✅ Completado | `r2/go-live` | working | `tsc` ✅, `build` ✅, guard ✅ |
| P2-B | PIN: modal no descartable | 2 | **Flash 3.8** | ✅ Completado | `r2/ola-2` | `u6v7w8x` | `tsc` ✅ |
| **L-1** | **Fetch Lote 1 (20 arch.)** | 2 | **Lite 3.5** | **✅ Completado** | `r2/go-live` | — | `tsc` ✅ |
| **L-2** | **Fetch Lote 2 (9 arch.)** | 2 | **Lite 3.5** | **⏳ EN CURSO** | **`r2/lite-2`** | — | — |
| **L-3** | **Fetch Lote 3 (16 arch.)** | 2 | **Lite 3.5** | **⏳ EN CURSO** | **`r2/lite-3`** | — | — |
| L-4...L-10 | Fetch Lotes 4-10 | 2 | **Lite 3.5** | ⏸️ En cola | — | — | — |
| Paso 7 | Spooler Guard (timeout 8s + warn) | 2 | **Lite 3.5** | ✅ Completado | `r2/go-live` | — | `tsc` ✅, tests (6/6) ✅ |
| L-11 | Lote L-11 | 2 | **Lite 3.5** | ✅ Completado | `r2/go-live` | — | ✅ |
| L-12 | Lote L-12 | 2 | **Lite 3.5** | ✅ Completado | `r2/go-live` | — | ✅ |
| L-13 | Ampliar tipo PrintJobRow (SEV-204) | 2 | **Lite 3.5** | ✅ Completado | `r2/go-live` | — | `tsc` ✅ |
| L-14 | Verificar índices 0038 (M17a) | 2 | **Lite 3.5** | ✅ Completado | `r2/go-live` | — | tests (15/15) ✅, plan ✅ |
| L-15 | Verificación integral y pre-commit | 2 | **Lite 3.5** | ✅ Completado | `r2/go-live` | — | guard ✅, lint ✅, build ✅ |
| P2-D | Polling de impresión | 2 | **Flash 3.8** | ✅ Completado | `r2/go-live` | — | `tsc` ✅, guard ✅ |
| P3-A | Outbox offline | 3 | **Flash 3.8** | ⏸️ En cola | — | — | — |
| ... | ... | ... | ... | ... | ... | ... | ... |

## 🧠 Decisiones Tomadas y su Justificación
- **Nota de Bitácora (P2-A por Agente 3.5):** La tarea P2-A (implementación de `apiFetch` y `apiJson` en `apps/web/src/api/client.ts`), originalmente asignada al Agente Flash 3.8, fue asumida y completada por el Agente 3.5. Esto desbloqueó exitosamente la compilación y el build de producción del frontend sin demoras.
- **D1 (Lockout desactivado):** Aprobado. Se prioriza la agilidad operativa en hora pico.
- **`void`/`incident` en CASHIER_PLUS:** Aprobado. El servicio ya valida el PIN del supervisor; moverlo a ADMIN rompería el flujo de la cajera.
- **Cierre de jornada en ADMIN_SUPERVISOR:** **PENDIENTE DE TU DECISIÓN.** Si la cajera debe poder cerrar su turno, mover a CASHIER_PLUS.

## 🚨 Bloqueadores y Dudas Abiertas
- Ninguno por ahora.

## 🏁 Próximo Paso Inmediato
1. Lanzar los prompts **L-4 a L-7** en el orquestador de Lite.
2. Cuando terminen los 10 lotes de Lite, lanzar **P2-D** en Flash 3.8.
3. Al completar P2-D, ejecutar el **Checkpoint de Oleada 2**.
