# REGISTRO DE DECISIONES DE DISEÑO Y NEGOCIO — NOCHE-02

## 1. Confirmaciones Fundamentales
- **D1 (Confirmado por el dueño):** Jornada global única. Una caja por cajera dentro de ella; el selector de sede solo filtra reportes.
- **D2 (Confirmado por el dueño):** Inventario descontado una sola vez por orden al momento en que entra a cocina o se cobra (lo que ocurra primero).

## 2. Decisiones Técnicas Tomadas en Fase 0
- **Auditoría de Migración 0029:** Se ratifica sin alteraciones. Solo mapea `sede_alta_vista` a `loc_alta_vista`. Sin impacto en sedes no documentadas.
- **Tokens Semánticos de Color:**
  - `--color-success`: Actualizado a `#166534` (verde 800) en modo claro para garantizar ratio >= 4.5:1 (alcanza 5.9:1 a 7.1:1) sobre superficies claras y sub-fondos tenues.
  - `--color-danger`: Actualizado a `#B91C1C` en modo claro (5.3:1) y `#F87171` en modo oscuro (5.8:1).
- **Consistencia Visual en Pestañas:** Prohibido el uso de `text-primary` sobre fondos claros. Las pestañas activas utilizan `border-primary text-ink font-bold` para cumplir WCAG AA.

