# NOCHE-01 — Ejecución autónoma por puertas: P2-A → P2-B → P2-C

Ruta en el repo: `docs/r2/NOCHE-01.md`. Nadie va a responderte durante varias horas: **no hay a quién preguntar**. Tu trabajo es avanzar lo máximo posible **sin inventar, sin saltarte verificaciones y parando a tiempo**. Parar bien vale más que terminar mal.

## 0. Lo que ya está decidido (no lo discutas)
- **D1 confirmado:** jornada global única; **una caja por cajera dentro de esa jornada**; el selector de sede solo filtra reportes.
- **D2 confirmado:** el inventario se descuenta una sola vez por orden, al primero que ocurra entre "entra a cocina" o "se cobra". *(No se implementa esta noche: es de P4-A.)*
- D3–D8 de `docs/r2/00-PLAN-MAESTRO.md` §4 siguen vigentes.
- Alcance de esta noche: **solo P2-A, P2-B y P2-C** (archivos `docs/r2/P2-A.md`, `P2-B.md`, `P2-C.md`). **No empieces P3 ni nada posterior, aunque te sobre tiempo.**

## 1. Preparación (si algo falla aquí, DETENTE y escribe el motivo)
1. Lee completos, en este orden: `docs/r2/01-REGLAS-DEL-AGENTE.md`, `docs/r2/00-PLAN-MAESTRO.md`, `docs/r2/P2-A.md`.
2. `git status` debe estar limpio. Si no, haz commit de lo pendiente con mensaje `chore(r2): estado previo a noche-01` y repórtalo.
3. Verifica que existen los tags `pre-r2`, `r2-p0-a`, `r2-p0-b`, `r2-p1-a`, `r2-p1-b` (`git tag`). Si falta alguno, **detente**.
4. Verifica que existen y funcionan `pnpm r2:e2e`, `pnpm guard:visual`, `pnpm r2:status` y que `docs/r2/defects.json` tiene los 30 IDs. Anota en `ESTADO.md` los **nombres reales** de los comandos que dejó P0-B si difieren.
5. Corre una vez la línea base completa (guard, lint, build, test, `r2:e2e`) y guarda las salidas. Anota cuántas pruebas pasan **hoy**. Esa cifra es el piso: nunca puede bajar.
6. Crea una rama de seguridad: `git switch -c r2/noche-01`. **Todo el trabajo va en esa rama**; la rama principal no se toca.
7. Crea `docs/r2/noche/` con: `ESTADO.md`, `BLOQUEOS.md`, `DISCREPANCIAS.md`, `DECISIONES-NOCHE.md`, y registra en `docs/r2/00-PLAN-MAESTRO.md` §8 que **D1 y D2 fueron confirmados por el dueño**.

## 2. Memoria externa y re-anclaje (anti-alucinación)
- `docs/r2/noche/ESTADO.md` es tu memoria. Formato fijo, se actualiza **después de cada tarea** (no al final): `fase actual · tarea actual · tareas hechas (con hash de commit) · decisiones · bloqueos · siguiente paso exacto`.
- **Si no recuerdas con certeza** un nombre de archivo, ruta, columna, contrato o decisión: no lo reconstruyas de memoria. Releer `ESTADO.md` y el archivo de la fase.
- **Re-anclaje obligatorio** al empezar cada fase, cada 5 commits y siempre que notes que el contexto pudo recortarse: releer `01-REGLAS-DEL-AGENTE.md`, el archivo de la fase en curso y `ESTADO.md`.
- **Prohibido usar** un archivo, función, endpoint, tabla, columna o dependencia que no hayas visto en el repo **en esta sesión** (con `grep`, `view` o `PRAGMA table_info` / `sqlite_master`) o que no hayas creado tú. Los "Hechos verificados" de cada fase se confirman con `grep` **antes** de editar. Si no coinciden: no adaptes por tu cuenta; anótalo en `DISCREPANCIAS.md`, haz lo que no dependa de eso y, si cambia el diseño, **detén la fase**.
- No instales dependencias nuevas salvo las que el prompt de fase nombre (por ejemplo `zod` en `packages/shared` si no está ya).

## 3. Ritmo de trabajo
- Tarea → prueba de esa tarea → `pnpm -r run lint` (tipos) → commit atómico `feat|fix(r2-p2-x): …` → actualizar `ESTADO.md`. Nada de acumular varios cambios sin correr nada.
- **Cuida tu contexto:** redirige las salidas largas a archivos (`... *> docs/r2/evidencia/<fase>/gate-<n>.txt`) y muestra solo las últimas 30 líneas y las líneas con `FAIL`/`error`. Nunca pegues logs enteros en la conversación. Comandos sin modo interactivo ni `watch` (`CI=1`, `vitest run`); si un comando pasa de 10 minutos, termínalo y regístralo como bloqueo.
- Windows/PowerShell: sin comandos bash puros ni rutas con `/` fijas en scripts nuevos.

## 4. Puertas (nada avanza sin evidencia)
**Puerta de tarea:** la prueba específica verde + tipos verdes.
**Puerta de fase** (todas, en este orden, con la salida cruda guardada en `docs/r2/evidencia/<fase>/`): `pnpm guard` · `pnpm -r run lint` · `pnpm -r run build` · `pnpm test` (sin bajar del piso de pruebas) · `pnpm r2:e2e` · `pnpm guard:visual` (en P2-C y en cualquier fase con pantallas).
- **No pasas a la fase siguiente** hasta que la anterior tenga **todas** las puertas verdes, informe `docs/informes/R2-<fase>.md` y tag `r2-<fase>`.
- Prohibido escribir "PASS", "OK" o "verde" en un informe sin la **ruta del archivo de evidencia** que lo demuestre. Lo no comprobado se escribe **NO VERIFICADO**.
- `docs/r2/defects.json` **no se edita a mano**: el estado `green` sale de la corrida (reporte JSON de Playwright / `pnpm r2:status`) y ese reporte va en el commit. Ningún ID verde puede volver a rojo.
- Sigue prohibido: borrar o debilitar pruebas, `test.skip`/`.only`, `@ts-ignore`, `any` para esquivar un tipo, `--no-verify`, subir tolerancias, tocar el núcleo sagrado fuera de lo que el prompt autoriza.

## 5. Presupuesto de intentos y cuándo parar
- Máximo **3 intentos** contra el mismo error. Si repites el mismo comando con el mismo fallo 3 veces: **para**, `git stash`/revierte lo de esa tarea, anota en `BLOQUEOS.md` (comando, error exacto, qué probaste, hipótesis) y pasa a la siguiente tarea **independiente**.
- Si la tarea bloqueada es prerrequisito de lo que sigue, **detén la fase** (y con ella la noche): no se avanza sobre una base rota.
- **Detén todo** si: una migración aborta por jornadas abiertas con actividad (P2-A; no la fuerces), las pruebas bajan del piso y no logras recuperarlas en 3 intentos, cambiaste algo del núcleo sagrado sin querer y no puedes revertirlo limpio, o notas que olvidas cosas básicas del proyecto (contexto degradado).
- **Dudas de negocio** que no estén en el plan: no preguntes. Toma la opción **más conservadora y reversible**, regístrala en `DECISIONES-NOCHE.md` como `PENDIENTE DE CONFIRMAR` y sigue.

## 6. Datos y seguridad
- **Jamás** abras, leas ni modifiques `data/tocineta.db`, `.env`, respaldos `.age` ni claves. Todo con BD temporal (`TOCINETA_DB_PATH`). Nada se ejecuta contra la base real: las migraciones nuevas se probarán en la BD temporal y se aplicarán cuando el dueño arranque el servidor.
- Nada de `git push`, `--force`, `reset --hard` ni `git clean`.

## 7. Qué hacer en cada fase (resumen; el detalle manda en su archivo)
1. **P2-A** (`P2-A.md`): quitar el alias de sede y los 4 fallbacks, migración de reasignación, índice único de jornada abierta, `getCurrentJornada` ordenado, apertura idempotente. Cierra con tag `r2-p2-a`.
2. **P2-B** (`P2-B.md`): `financial-truth-service`, adaptadores delgados, esquemas Zod compartidos, ventas de la jornada, cobros sin huérfanos, gastos con método de pago y anti-duplicado. **No toques** `money.ts`, la cadena de hashes del cierre, impresión ni outbox. Si una prueba existente cambia de valor, **no cambies su aserción**: documenta la diferencia con justificación en el informe y en `DISCREPANCIAS.md`. Cierra con tag `r2-p2-b`.
3. **P2-C** (`P2-C.md`): pantallas de Caja, Cierre, Vuelto (con vuelto mixto), Cobro Express, Panel/Finanzas/Inicio sobre la verdad única, `invalidateMoney`. Verifica **en Chromium** a 360×800 y 1280×800 con capturas. Cierra con tag `r2-p2-c`.

## 8. Cierre de la noche (obligatorio, aunque pares a la mitad)
1. **Auditoría final en terminal nueva:** repite las puertas completas desde cero y compara con las guardadas. Si difieren, repórtalo.
2. `git diff --stat pre-r2..HEAD` sobre el núcleo sagrado (lista en `01-REGLAS-DEL-AGENTE.md` §2) pegado en el informe.
3. Escribe `docs/r2/noche/RESUMEN-MANANA.md` **para una persona que acaba de despertar**, en este orden: (a) semáforo por fase: `COMPLETA / PARCIAL / NO INICIADA`; (b) qué quedó verde **con ruta de evidencia**; (c) qué NO se hizo / NO VERIFICADO; (d) bloqueos y discrepancias; (e) decisiones `PENDIENTE DE CONFIRMAR`; (f) **cómo continuar**: fase y tarea exactas y el texto para abrir el chat nuevo; (g) **verificación de 5 minutos** para el dueño (rama, `git log --oneline`, `pnpm r2:status`, carpeta de evidencia) y la advertencia de **copiar `data/tocineta.db` antes de arrancar el servidor con la base real**, porque las migraciones nuevas se aplicarán entonces.
4. Detente con una sola línea final: `NOCHE-01 TERMINADA: <fases completas> · SIGUIENTE: <fase/tarea> · BLOQUEOS: <n>`.
