# TOCINETA R2 — Reglas del agente (se leen al inicio de CADA fase)

Ruta en el repo: `docs/r2/01-REGLAS-DEL-AGENTE.md`. Estas reglas se suman a `AGENTS.md`; si chocan, manda la más estricta.

## 1. Cómo trabajar
1. **Una fase por chat.** Si sientes que el contexto se llena, **detente**, haz commit de lo verde y reporta qué falta. No improvises ni comprimas el trabajo para "llegar".
2. **Confirma antes de editar.** Cada prompt trae "Hechos verificados" con archivo y línea aproximada. Haz un `grep` que los confirme. Si un hecho no coincide con el código, **para y repórtalo**; no lo adaptes por tu cuenta.
3. **Una decisión de negocio que no esté en el prompt ni en `00-PLAN-MAESTRO.md` §4 no la inventes.** Pregunta.
4. Trabaja en tareas pequeñas: tarea → prueba → commit. No acumules 6 cambios sin correr nada.
5. Windows es el entorno real del usuario: scripts nuevos en Node/TypeScript (`tsx`), nada de bash puro ni rutas con `/` fijas.

## 2. Núcleo sagrado (solo lectura salvo que el prompt diga lo contrario)
- `packages/shared/src/utils/money.ts` (enteros, tolerancia $0.01, prorrateo Hamilton de combos).
- Impresión: `ticket-ir.ts`, `printing/worker.ts`, `printing/templates.ts`.
- `apps/server/src/db/connection.ts`: PRAGMAs `WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`. (P0-A solo puede añadir lectura de la ruta de la BD por variable de entorno.)
- Cierre Z criptográfico y respaldos: `closures-service.ts` (cadena SHA-256, retención Ubii 0.75%), `backups/`.
- Cola offline: `apps/web/src/features/pos/outbox.ts`.
Antes de cerrar la fase ejecuta `git diff --stat <tag-anterior>..HEAD -- <archivos sagrados>` y pega el resultado en el informe. Si algo sagrado cambió sin permiso del prompt, revierte.

## 3. Cero trampas
- Prohibido borrar tests, `test.skip`, `.only`, debilitar aserciones o subir tolerancias para forzar verde.
- **"PASS" en consola no es evidencia de UI.** Toda fase con pantalla se valida con Playwright en Chromium real (viewport móvil 360×800 y escritorio 1280×800) y se adjuntan capturas en `docs/r2/evidencia/<fase>/`.
- Si un criterio no se puede verificar, se escribe en el informe como **NO VERIFICADO**. Nunca como pasado.

## 4. Errores y datos
- Errores de API: `{ success:false, error:<mensaje humano>, code, message, field?, requestId }`. Nunca un stack ni "Internal Server Error" crudo al usuario.
- Dinero siempre en enteros (centavos USD, micro-Bs). Nada de `parseFloat` sobre montos acumulados.
- Contratos frontend↔backend: tipos/Zod compartidos en `packages/shared`. Prohibido "adivinar" claves (`s.total || s.total_usd_cents || 0`).
- La BD de pruebas es siempre una copia temporal (`TOCINETA_DB_PATH`). **Jamás** pruebas contra `data/tocineta.db`.
- No leer, imprimir ni commitear `.env`, bases `.db`, respaldos `.age` ni claves.

## 5. UI
- Español, sin emojis, sin marcas ni software externo (`Treinta`, etc.), sin nombres propios (lista en `AGENTS.md`).
- Íconos solo por `ui/Icon` con `IconName` tipado. Colores solo por tokens. Botones táctiles ≥48 px. Archivos ≤400 líneas.
- Todo estado de carga tiene **tiempo máximo (8 s)**, estado de error con "Reintentar" y estado vacío propio.

## 6. Entrega obligatoria de cada fase
1. `pnpm guard` + `pnpm -r run lint` + `pnpm -r run build` + `pnpm test` (las 238 pruebas siguen verdes) — pega la salida real.
2. En fases con UI: `pnpm guard:visual` y `pnpm r2:e2e` (existen desde P0-B) — pega la salida real.
3. Actualiza `docs/r2/defects.json` (los IDs de la fase pasan a `green`; ninguno previamente verde puede volver a rojo).
4. Informe `docs/informes/R2-<fase>.md` con estas secciones fijas: **Hecho**, **NO hecho / NO verificado**, **Evidencia** (salidas y capturas), **Desviaciones del prompt**, **Riesgos**.
5. Commit atómico `feat|fix(r2-<fase>): …` y tag `r2-<fase>`. Nada de `push --force` ni resets destructivos.
