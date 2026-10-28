# NOCHE-02 — P3 y P4-A (y P4-B solo si todo está en verde)

Ruta en el repo: `docs/r2/NOCHE-02.md`. Nadie va a responderte durante varias horas: no hay a quién preguntar. Tu trabajo es avanzar lo máximo posible **sin inventar, sin saltarte verificaciones y parando a tiempo**. Parar bien vale más que terminar mal. Si este prompt y el repo discrepan en un hecho (nombre de archivo, ruta, contrato), **gana el repo**: anótalo en `DISCREPANCIAS.md`.

## 0. Ya decidido (no se discute)
- **D1** confirmado: jornada global única; una caja por cajera dentro de ella; el selector de sede solo filtra reportes.
- **D2** confirmado: el inventario se descuenta **una sola vez por orden**, al primero que ocurra entre "entra a cocina" o "se cobra". **Se implementa esta noche en P4-A.**
- D3–D8 de `docs/r2/00-PLAN-MAESTRO.md` §4 siguen vigentes.
- Alcance, en este orden: **Fase 0** (reconciliar P1-B, §7) → **P3** (`docs/r2/P3.md`, solo si la Fase 0 cerró) → **P4-A** (`docs/r2/P4-A.md`) → **P4-B** (`docs/r2/P4-B.md`) solo si se cumple la regla de §7. **No empieces P4-C ni nada posterior.**

## 1. Preparación y verificación de la noche anterior (si algo falla, DETENTE y escribe el motivo)
1. Lee completos, en este orden: `docs/r2/01-REGLAS-DEL-AGENTE.md`, `docs/r2/00-PLAN-MAESTRO.md`, `docs/r2/noche/RESUMEN-MANANA.md` y `docs/r2/noche/ESTADO.md` (de NOCHE-01), y `docs/r2/P3.md`.
2. **No confíes en el resumen: compruébalo en el repo.** `git status` limpio (si no, commit `chore(r2): estado previo a noche-02` y repórtalo). `git tag` debe mostrar `pre-r2`, `r2-p0-a`, `r2-p0-b`, `r2-p1-a`, `r2-p1-b` y los de P2 que el resumen declare completos (`r2-p2-a`, `r2-p2-b`, `r2-p2-c`). Para cada tag de P2, confirma que es ancestro de `HEAD` (`git merge-base --is-ancestor <tag> HEAD`).
3. **Árbol de decisión (las dependencias mandan; ver tabla de fases del plan §6):**
   - P2-A, P2-B y P2-C con tag → alcance normal: P3 → P4-A → (P4-B condicional).
   - P2-C **sin** tag pero P2-A y P2-B con tag → primero **termina P2-C** siguiendo `docs/r2/P2-C.md` y `ESTADO.md`; después P4-A (depende de P2-B); P3 solo si P2-C quedó con tag.
   - P2-B **sin** tag → termina P2-B (y luego P2-C) **antes** de cualquier otra cosa; **no hagas P4-A**.
   - P2-A **sin** tag → termina P2-A y sigue en ese orden.
   - Si el resumen dice COMPLETA pero falta el tag o una puerta no se reproduce, **trátala como incompleta**.
   - **Estado declarado por NOCHE-01 (verifícalo, no lo asumas):** P2-A, P2-B y P2-C con tag; 9 defectos en verde (B01, B07, B08, B09, B10, B12, B13, B26, B28); pruebas del último cierre: 337. **Irregularidad a resolver:** P1-B tiene tag `r2-p1-b`, pero B02, B03, B04, B06, B21 y B25 **no** están en verde, y el resumen no declara el resultado de `guard:visual` en P2-C. Trata P1-B como **PARCIAL** hasta demostrar lo contrario (Fase 0, §7). El texto de arranque que sugiere el resumen anterior ("continuamos con P3") **queda anulado por este documento**.
4. Verifica `pnpm r2:e2e`, `pnpm guard:visual`, `pnpm r2:status` y que `docs/r2/defects.json` tiene los 30 IDs. Corre una vez la línea base completa (guard, lint, build, test, r2:e2e, guard:visual) y guarda las salidas. **El piso de pruebas es el número de pruebas que pasan hoy**; nunca puede bajar. Anótalo.
5. Crea la rama desde la que contenga el último tag de P2 completo: `git switch -c r2/noche-02`. Todo el trabajo va ahí. No toques la rama principal ni la `r2/noche-01`.
6. Crea `docs/r2/noche/02/` con `ESTADO.md`, `BLOQUEOS.md`, `DISCREPANCIAS.md`, `DECISIONES-NOCHE.md`. No sobrescribas nada de la noche 1. Anota en `docs/r2/00-PLAN-MAESTRO.md` §8 que D1 y D2 fueron confirmados por el dueño (si no lo hizo ya NOCHE-01).
7. Si P4-A lo exige: confirma que `docs/r2/ERRORES-500-REALES.md` existe. Si falta o está incompleto, anótalo y **no inventes causas** (ver §6).

## 2. Memoria externa y re-anclaje (anti-alucinación)
- `docs/r2/noche/02/ESTADO.md` es tu memoria. Formato fijo, actualizado **después de cada tarea**: fase actual · tarea actual · tareas hechas (con hash de commit) · decisiones · bloqueos · siguiente paso exacto.
- Si no recuerdas con certeza un archivo, ruta, columna, contrato o decisión: **no lo reconstruyas**; relee `ESTADO.md` y el archivo de la fase.
- **Re-anclaje obligatorio** al empezar cada fase, cada 5 commits y cada vez que sospeches que el contexto se recortó: relee `01-REGLAS-DEL-AGENTE.md`, el archivo de la fase y `ESTADO.md`.
- Prohibido usar un archivo, función, endpoint, tabla, columna o dependencia que no hayas visto **en esta sesión** (`grep`, `view`, `PRAGMA table_info`, `sqlite_master`) o creado tú. Los "Hechos verificados" de cada fase se confirman con `grep` antes de editar: los números de línea y nombres pueden haber cambiado tras P1/P2. Si no coinciden, no adaptes por tu cuenta: `DISCREPANCIAS.md`, haz lo que no dependa de eso y, si cambia el diseño, detén la fase.
- No instales dependencias nuevas.

## 3. Ritmo
Tarea → prueba de esa tarea → `pnpm -r run lint` → commit atómico `feat|fix(r2-<fase>): …` → actualizar `ESTADO.md`. Salidas largas a archivos (`docs/r2/evidencia/<fase>/gate-<n>.txt`); muestra solo las últimas 30 líneas y las de FAIL/error. Comandos sin watch ni interactivos (`CI=1`, `vitest run`); si uno pasa de 10 minutos, termínalo y regístralo como bloqueo. Windows/PowerShell: nada de bash puro ni rutas con `/` fijas en scripts nuevos.

## 4. Puertas
- **Tarea:** su prueba específica en verde + tipos en verde.
- **Fase** (todas, en este orden, salida cruda guardada en `docs/r2/evidencia/<fase>/`): `pnpm guard` · `pnpm -r run lint` · `pnpm -r run build` · `pnpm test` (sin bajar del piso) · `pnpm r2:e2e` · `pnpm guard:visual` (en P3, P4-B y toda fase con pantallas).
- Una fase no se da por cerrada sin sus puertas, su informe `docs/informes/R2-<fase>.md` y su tag `r2-<fase>`. Prohibido escribir "PASS/OK/verde" sin la ruta del archivo de evidencia; lo no comprobado es **NO VERIFICADO**.
- `docs/r2/defects.json` **no se edita a mano**: el estado sale de `pnpm r2:status` / el reporte de Playwright, y ese reporte va en el commit. Ningún ID verde vuelve a rojo.
- Siguen prohibidos: borrar/debilitar pruebas, `test.skip/.only`, `@ts-ignore`, `any` para esquivar un tipo, `--no-verify`, subir tolerancias, tocar el núcleo sagrado fuera de lo autorizado.

## 5. Presupuesto de intentos y cuándo parar
- Máximo **3 intentos** contra el mismo error. Al tercero: revierte lo de esa tarea (`git stash`), anota en `BLOQUEOS.md` (comando, error exacto, qué probaste, hipótesis) y pasa a la siguiente tarea **independiente**. Si la bloqueada es prerrequisito, detén la fase y con ella la noche.
- Detén todo si: una migración aborta o toca datos que no puedes reproducir en BD temporal; las pruebas bajan del piso y no las recuperas en 3 intentos; cambiaste el núcleo sagrado sin querer y no puedes revertirlo limpio; o notas que olvidas cosas básicas del proyecto (contexto degradado).
- Dudas de negocio que no estén en el plan: **no preguntes**. Toma la opción más conservadora y reversible y regístrala en `DECISIONES-NOCHE.md` como **PENDIENTE DE CONFIRMAR**.

## 6. Datos y seguridad
Jamás abras, leas ni modifiques `data/tocineta.db`, `.env`, respaldos `.age` ni claves. Todo con BD temporal (`TOCINETA_DB_PATH`). Las migraciones nuevas se prueban **solo** en BD temporal; se aplicarán sobre la base real cuando el dueño arranque el servidor. Nada de `git push`, `--force`, `reset --hard` ni `git clean`.

## 7. Qué hacer en cada fase (el detalle manda en su archivo)
**Orden:** Fase 0 → P3 (solo si la Fase 0 cerró) → P4-A → P4-B (condicional). Si la Fase 0 queda PARCIAL: **salta P3** (su puerta `guard:visual` no puede pasar) y sigue con P4-A, que no depende de las pantallas.

**Fase 0 — Reconciliar P1-B (antes que cualquier otra cosa).** Spec: `docs/r2/P1-B.md`.
- Guarda en `docs/r2/evidencia/F0/` la salida de `pnpm r2:status` y de `pnpm guard:visual`. Lee el final de `docs/r2/evidencia/P2-C/gate-6-guard-visual.txt` y anota si terminó en verde o en rojo.
- Para cada ID de P1-B en rojo (B02, B03, B04, B06, B21, B25), ejecuta su prueba sola y clasifica: **(a)** el defecto sigue presente → corrígelo según la tarea correspondiente de `P1-B.md`; **(b)** la prueba falla por el harness y no por su aserción → arregla el harness **sin debilitar la aserción**; **(c)** ya está bien y solo faltaba el reporte → que lo actualice la corrida.
- Los hallazgos de `guard:visual` se reparten: los de P1-B (contraste, título truncado, "Cargando" tras 8 s, nombres de ícono, desborde horizontal, emoji) se corrigen aquí; los que pertenecen a otra fase (pedido/cocina → P3; inventario → P4) se anotan en `DISCREPANCIAS.md` como "pertenece a <fase>" y **no se tocan**.
- Cierre: commit `fix(r2-p1-b): …`, informe `docs/informes/R2-P1-B-cierre.md` y tag **`r2-p1-b-cierre`** (no muevas ni borres `r2-p1-b`). Cerrada = B02, B03, B04, B06, B21 y B25 en verde, ningún ID verde en rojo y `guard:visual` sin hallazgos de P1-B. Máximo 3 intentos por ID; si uno no cede: `BLOQUEOS.md` y Fase 0 = PARCIAL.
- **Revisión de solo lectura de la migración `0029`:** el resumen de NOCHE-01 dice que reasigna `sede_alta_vista` **y "sedes no oficiales"** a `loc_alta_vista`. Lista exactamente qué `location_id` reasigna y en qué tablas. Si reasigna algo distinto de `sede_alta_vista`, regístralo en `DISCREPANCIAS.md` y en `DECISIONES-NOCHE.md` como **PENDIENTE DE CONFIRMAR**, con el riesgo concreto (mezclar ventas de otra sede dentro de Alta Vista). **No modifiques `0029` esta noche.**

**P3 (`P3.md`)** — Tomar pedido sin scroll + KDS de un toque con alertas.
- Antes de editar confirma con `grep` que existen `formatTableLabel` (P1-B) y `invalidateMoney` (P2-C); si no, `DISCREPANCIAS.md`.
- El ajuste nuevo `ask_table_on_order` va con migración numerada tras la última existente, **desactivado por defecto**.
- No toques impresión, `station_status_*` ni el outbox. Mantén `KdsView.tsx` y `KdsCard.tsx` ≤400 líneas.
- El sonido y la vibración **solo se pueden comprobar de verdad en un teléfono**: en Playwright se verifican con espías; todo lo demás va como **NO VERIFICADO (requiere teléfono real)** en el informe y en el resumen.
- Cierra con tag `r2-p3`.

**P4-A (`P4-A.md`)** — Backend de inventario, recetas, compras, mermas y asistente.
- Empieza leyendo `ERRORES-500-REALES.md`. Para cada 500: **primero la prueba que lo reproduce, luego la causa raíz**. Si no se reprodujo en P0-B, repórtalo; no inventes la causa.
- Implementa **D2** (consumo único por orden, idempotente) y la reversa por `order_id` con la regla "antes de En preparación → reversa; después → merma automática".
- Las migraciones de datos (borrar gastos espejo de mermas, rellenar `order_id`) se prueban en BD temporal con copia previa y `PRAGMA foreign_key_check` vacío. Son reversibles solo por respaldo: **no las apliques a nada que no sea BD temporal**.
- **Rutas antiguas: esta noche no se retira ninguna.** Haz solo el inventario de llamadores (grep) y regístralo en `DECISIONES-NOCHE.md` como PENDIENTE DE CONFIRMAR.
- Si la detección de ciclos en sub-recetas no cabe con prueba, déjala fuera y repórtalo (el prompt lo permite).
- No toques `closures-service.ts`, `money.ts`, impresión ni outbox.
- Los IDs B14–B19 pueden seguir en rojo hasta P4-B (necesitan la pantalla): es esperado. Verifica que fallan **por la razón correcta** (ya no 500 ni `NaN` del servidor). Deben pasar a verde, si les corresponde: B24 y B29.
- Cierra con tag `r2-p4-a`.

**P4-B (`P4-B.md`) — CONDICIONAL.** Solo si P3 y P4-A cerraron con **todas** las puertas en verde y tag, el contexto está sano (re-anclaje sin sorpresas) y la suma de bloqueos abiertos es 0. Si no, **no empieces**: anótalo en el resumen. Si empiezas: un commit por modal, `api.ts` primero, ningún archivo >400 líneas, capturas a 360 px por modal. Si no la terminas, la fase queda **PARCIAL** (sin tag) con el siguiente paso exacto en `ESTADO.md`.

## 8. Cierre de la noche (obligatorio, aunque pares a la mitad)
1. Auditoría final en terminal nueva: repite las puertas completas desde cero y compáralas con las guardadas. Si difieren, repórtalo.
2. Pega `git diff --stat pre-r2..HEAD` sobre el núcleo sagrado (`01-REGLAS-DEL-AGENTE.md` §2) en el informe, con las excepciones ya autorizadas (lectura de `TOCINETA_DB_PATH`; origen de cifras en `closures-service.ts` sin tocar el hash).
3. Escribe `docs/r2/noche/02/RESUMEN-MANANA.md` para alguien que acaba de despertar, en este orden: (a) semáforo por fase (Fase 0, P3, P4-A, P4-B): COMPLETA / PARCIAL / NO INICIADA; (b) qué quedó verde con ruta de evidencia; (c) qué NO se hizo / NO VERIFICADO (incluye lo que exige teléfono real); (d) bloqueos y discrepancias; (e) decisiones PENDIENTE DE CONFIRMAR; (f) cómo continuar: fase y tarea exactas y el texto para abrir el chat nuevo; (g) verificación de 5 minutos para el dueño (rama, `git log --oneline`, `pnpm r2:status`, carpeta de evidencia) y la **advertencia de copiar `data/tocineta.db` antes de arrancar el servidor con la base real**, porque las migraciones nuevas se aplicarán entonces.
4. Detente con una sola línea final: `NOCHE-02 TERMINADA: <fases completas> · SIGUIENTE: <fase/tarea> · BLOQUEOS: <n>`.
