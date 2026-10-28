# TOCINETA — Plan Maestro Ronda 2 (Dirección General, versión verificada)

Ruta en el repo: `docs/r2/00-PLAN-MAESTRO.md`.

## 1. Qué se revisó y con qué alcance
- **Código real del .rar** (extraído sin tocar `.env`, respaldos ni `.git`), las **40 fotos** del teléfono, los dos planes, los informes y los mensajes de Anthony.
- **No pude ejecutar la app** (sin entorno pnpm/Chromium). Lo verificado es: lectura del código, reproducción de sentencias SQL sobre el esquema real migrado, y comparación de lo que el servidor devuelve contra lo que la pantalla lee.
- **La base `data/tocineta.db` del .rar no es la del teléfono** (tiene 10 órdenes, 1 pagada, 0 gastos; el teléfono mostraba 6 cobradas y $460 de gastos). Por eso **no usé cifras de esa BD como evidencia**. Una afirmación anterior de "6 jornadas abiertas" **no se pudo reproducir** en esa copia (solo hay 1); igual se blinda (P2-A).
- Etiquetas: **[VERIFICADO]** = visto en código y/o foto. **[HIPÓTESIS]** = probable, la fase P0-B lo confirma capturando request/response real.

## 2. Causas raíz reales (corrigen y completan lo anterior)

| # | Síntoma | Causa raíz | Estado |
|---|---|---|---|
| 1 | Íconos escritos como palabras ("Flame", "CheckCircle", "RotateCcw", "Receipt", "Lock", "Banknote") | `Icon.tsx` está bien (si no halla el ícono dibuja un `HelpCircle`, nunca texto). El fallo está en `ui/Button.tsx` (`leftIcon/rightIcon/iconStart/iconEnd`) y `ui/Tabs.tsx` (`icon`), tipados como `React.ReactNode`: aceptan un string y lo imprimen. Hay ~66 sitios que pasan texto. **Reescribir `Icon.tsx` no arregla nada.** | [VERIFICADO] |
| 2 | Caja: lista de ventas con "#", "Cliente: Mostrador", $0.00 (foto) | `GET /api/cash-sessions/current/sales` devuelve `orderNumber, customerName, totalCents` (camelCase) y `CashierView.tsx` lee `order_number, customer_name, total_usd_cents` (snake_case) → todo `undefined`/0. Además el endpoint trae las últimas 50 órdenes pagadas de *toda* la BD y fija `paymentMethod:'cash_usd'`. | [VERIFICADO] |
| 3 | Cierre: "Efectivo USD esperado $0.00", "No hay transacciones" | `GET /api/reports/z-report/summary` devuelve `cashUsdCents, cashBsCents, ordersCount, netFoodSalesUsdCents…`; `CashierClosureWizard.tsx` lee `expectedCashUsdCents, expectedCashBsCents, totalOrders, byMethod` (no existen) y, si falla, cae en silencio a ceros. Además "esperado" solo suma pagos brutos: no resta vueltos ni gastos en efectivo ni suma la apertura. | [VERIFICADO] |
| 4 | Panel $71.90 vs Finanzas $25.81; utilidad $2.50 vs −$402.50 | Existen ≥6 calculadoras independientes del dinero (`reports-service`, `closures-service`, dos paneles de la dueña, `cashflow-service`, `profit-service`), cada una con sus reglas. | [VERIFICADO en código; cifras por fotos] |
| 5 | 3.ª sede "Sede B: Alta Vista (Alias)" | No la crea la migración 0023: sale de `OFFICIAL_LOCATIONS` en `locations-service.ts` y `ensureOfficialLocations()` la **recrea en cada arranque** (`index.ts:38`, también en wizard). Borrarla con migración se deshace al reiniciar. Origen: 4 fallbacks `|| 'sede_alta_vista'` (`cashier-service.ts:769`, `incidents-service.ts:300`, `tips-routes.ts:136`, `recipes-service.ts:523`). | [VERIFICADO] |
| 6 | Panel: "Sede B: Turno Abierto / Sede A: Sin Turno" | El modelo actual es turno por sede; el negocio decidió **jornada global** (D1). `jornadas` no tiene índice único de "abierta" y `getCurrentJornada` no ordena. | [VERIFICADO] |
| 7 | "Internal Server Error" en sub-receta, merma por insumo, insumo rápido | **No existe `setErrorHandler`** en el servidor: todo `throw` sale como 500 crudo. La causa puntual de cada 500 no se pudo reproducir en SQL (los inserts de merma funcionan en el esquema real), así que **P0-B captura el mensaje real**. | Handler: [VERIFICADO]. Causas: [HIPÓTESIS] |
| 8 | Merma por plato: "($NaN)" | Un campo de precio/costo llega `undefined` al modal (`WasteRegisterModal.tsx`, etiqueta usa `p.priceUsdCents`; el modal envía `unitCostUsdCents` y el servicio lee `costUsdCents`). | [HIPÓTESIS fuerte] |
| 9 | Merma se descuenta dos veces | `waste-service.ts` guarda en `waste_logs` **y** crea un gasto en `operating_expenses` (`MERMAS_DESPERDICIOS`); el P&L suma ambos. | [VERIFICADO] |
| 10 | Anular orden #1 puede tocar #10/#11 | `recipes-service.ts:529` busca movimientos con `reference_doc LIKE ? OR notes LIKE ?`. | [VERIFICADO] |
| 11 | Carta "Cargando…" infinito | `components/MenuAdminView.tsx` (1.496 líneas, fuera de la regla de 400) espera `isLoading \|\| !adminMenu`: si la consulta falla, el spinner no termina. | [VERIFICADO]. Personal: [HIPÓTESIS] |
| 12 | Sin alerta/vibración en cocina | `kds/sound-effects.ts` **ya existe** (sintetizador, silencio, alerta de pedido nuevo). No hay `navigator.vibrate` en todo `apps/web/src`. Lo probable es que el audio quede bloqueado por la política de autoplay del móvil. | Vibración: [VERIFICADO]. Audio bloqueado: [HIPÓTESIS] |
| 13 | "Treinta" visible | `AppSidebar`, `AppLayout`, `HomeView` y 6 archivos de `features/finances/*`; el plan v3 anterior lo pidió literalmente. | [VERIFICADO] |
| 14 | Por qué los tests daban verde | `scripts/ui-guard.mjs` es análisis de texto del código: no ve el DOM. Los 238 tests prueban servicios, no pantallas. Nada comparaba lo que el servidor manda con lo que la pantalla lee. | [VERIFICADO] |

## 3. Auditoría de la propuesta del otro Director

**Aprobado:** un chat limpio por fase; partir fases en A/B (aquí algunas en A/B/C); `financial-truth-service` único; el Tribunal de Números con el escenario E6 multi-sede; `db:init-prod`; Acta de Liberación.

**Corregido o rechazado:**
1. **P1 "reescribir `Icon.tsx`"** → objetivo equivocado (causa #1). Se tipan las props.
2. **P2 "migración que borra la sede alias"** → se deshace al reiniciar (causa #5). Hay que quitarla de `OFFICIAL_LOCATIONS` y eliminar los 4 fallbacks.
3. **P2 "L1 = cobro huérfano sin sesión"** → la causa real son contratos rotos (causas #2 y #3). Aun así se prohíben los cobros huérfanos.
4. **P3 "crear `sound-effects.ts`"** → ya existe; se agrega desbloqueo de audio, vibración y borde destellante.
5. **P4 usa rutas `/api/profitability/*`** → las reales son `/api/fase3/*` (y `/api/locations`).
6. **`ESTADO-F3.md` afirma tablas `recipe_items_v2`, `waste_records`, `stock_count_items`** → el código usa `waste_logs`; cada fase confirma tablas reales con `sqlite_master` antes de escribir SQL.
7. **"$NaN por receta inexistente"** se trata como hipótesis hasta capturarlo (P0-B).

**Faltaba y se agrega:** índice único de jornada abierta; BD de pruebas aislada (`TOCINETA_DB_PATH`); manejador global de errores con `server_errors`; esquemas compartidos (Zod) para cada contrato de dinero; anti-duplicado de gastos; reversa por `order_id` (no `LIKE`); mermas una sola vez; partir `MenuAdminView.tsx`; mecanismo "ratchet" de defectos (`defects.json`).

## 4. Decisiones de negocio (D1–D8). Obligatorias para todas las fases

- **D1 — Jornada global única.** Una sola jornada abierta para todo el negocio (índice único parcial). Cada orden lleva su `location_id`. Una sede atiende al público; la otra es base de operaciones y de vez en cuando sale delivery. **El selector de sede es solo un filtro de reportes** (por defecto "Todas las sedes"). **Caja y Cierre ignoran el selector** y muestran la jornada completa con desglose por sede.
- **D2 — Descuento de inventario.** Consumo teórico por receta, **una sola vez por orden** (idempotente por `order_id`), en el primer momento que ocurra: la orden entra a cocina o se cobra. Anular antes de "En preparación" revierte; anular después **no** devuelve stock y registra una merma automática "Orden anulada en cocina". *(Supuesto del Director — confirmar, ver §8.)*
- **D3 — Mermas una sola vez.** Fuente única `waste_logs`. P&L: `Ventas − Costo de recetas − Mermas − Gastos operativos = Utilidad`. Las mermas no se registran también como gasto.
- **D4 — Gastos con método de pago.** Efectivo USD / Efectivo Bs salen de la gaveta (afectan el efectivo esperado). Pago móvil / punto de venta / tarjeta / otros salen de cuenta (afectan flujo de caja, no la gaveta). Todo gasto lleva método y clave anti-duplicado.
- **D5 — Rutas.** Canónicas: `/api/fase3/*` y `/api/locations`. Las antiguas solo se retiran si `grep` muestra cero llamadores y las pruebas siguen verdes; si no, quedan como lectura.
- **D6 — Stock por sede, costo promedio ponderado, sin lotes ni vencimientos** (opción A). La transferencia mueve cantidad al costo promedio del origen y recalcula el promedio del destino.
- **D7 — Dos sedes oficiales y nada más:** `loc_los_olivos` y `loc_alta_vista`.
- **D8 — Cero referencias a software externo en la interfaz.** (Excepción documentada: el nombre del archivo de migración `0020_valery_treinta_full_erp.sql` no se renombra porque ya está aplicado y se rompería el control de migraciones.)

## 5. Registro de defectos (`docs/r2/defects.json`)
P0-B crea una prueba Playwright en rojo por cada ID. Cada fase debe dejar en verde los suyos sin romper los anteriores.

| ID | Defecto | Fase |
|---|---|---|
| B01 | Íconos impresos como texto | P1-A |
| B02 | Cabecera: título truncado ("Pers…", "Cart…", "Salu…") | P1-B |
| B03 | Contraste ilegible (Salud del Sistema, guías, Carta y precios) | P1-B |
| B04 | Personal y Carta con "Cargando…" infinito | P1-B |
| B05 | Tomar pedido: textos, scroll, mesa opcional, cobro arriba | P3 |
| B06 | "Mesa Mesa 1" | P1-B |
| B07 | Vuelto: $0.00, sin vuelto mixto, sin monto a entregar | P2-C |
| B08 | Cobro Express: ventana pequeña en PC / fondo que se mueve en móvil | P2-C |
| B09 | Caja y Cierre en $0.00 (contratos rotos) | P2-B + P2-C |
| B10 | Ventas del día: Anular/Recibo/pestañas cortadas | P1-A + P2-C |
| B11 | KDS: ilegible y demasiados toques | P3 |
| B12 | Cifras distintas entre Caja/Panel/Finanzas/Inicio | P2-B + P2-C |
| B13 | Tercera sede "(Alias)" | P2-A |
| B14 | Inventario rápido no deja agregar insumos | P4-A + P4-B |
| B15 | Sub-receta: 500 y falta explicar "rendimiento del batch" | P4-A + P4-B |
| B16 | No se pueden crear recetas desde cero | P4-A + P4-B |
| B17 | Merma: "($NaN)" y 500 por insumo | P4-A + P4-B |
| B18 | Compras: casillas sin pedagogía y sin foto de factura | P4-A + P4-B |
| B19 | Asistente: 1 solo insumo/proveedor, recetas inoperantes, "Finalizar" sin efecto, sin tutorial | P4-A + P4-C |
| B20 | Cotizador de eventos sin platos | P4-C |
| B21 | "Treinta" en la interfaz | P1-B |
| B22 | P&L: margen negativo en verde; datos basura de pruebas | P2-B + P6-A + P6-B |
| B23 | Sin alerta de pedido nuevo (sonido/vibración/borde) | P3 |
| B24 | Anulación por `LIKE` | P4-A |
| B25 | "Siguiente" deshabilitado sin motivo; contenido tapado por el pie | P1-B |
| B26 | Emoji residual (📸, ⚙) | P1-A |
| B27 | Stock negativo sin alerta clara (Salchicha −4) | P6-B |
| B28 | Turno por sede en vez de jornada global | P2-A |
| B29 | Merma duplicada como gasto | P4-A |
| B30 | `MenuAdminView.tsx` de 1.496 líneas | P7 |

## 6. Mapa de fases (un chat limpio por archivo)

| Orden | Archivo | Qué entrega | Depende de |
|---|---|---|---|
| 1 | `P0-A` | Respaldo, tag `pre-r2`, BD de pruebas aislada, manejador de errores + `server_errors` | — |
| 2 | `P0-B` | Escenario determinista, Playwright, 30 defectos en rojo, `guard:visual`, errores 500 reales | P0-A |
| 3 | `P1-A` | Íconos tipados (raíz de B01/B26) | P0-B |
| 4 | `P1-B` | Cabecera, contraste, carga con tiempo máximo, "Mesa 1", sin "Treinta" | P1-A |
| 5 | `P2-A` | Sedes oficiales, jornada global única | P0-B |
| 6 | `P2-B` | `financial-truth-service`, contratos Zod, cobros sin huérfanos, gastos | P2-A |
| 7 | `P2-C` | UI de Caja, Cierre, Vuelto, Cobro Express, Panel y Finanzas | P2-B, P1-B |
| 8 | `P3` | Tomar pedido y Cocina con alertas | P2-C |
| 9 | `P4-A` | Backend de inventario, recetas, compras, mermas | P2-B |
| 10 | `P4-B` | Modales: insumo rápido, sub-receta, recetas, compras, mermas | P4-A, P1-B |
| 11 | `P4-C` | Asistente "Configura tu negocio", pedagogía, cotizador | P4-B |
| 12 | `P5-A` | Libro de Reglas + Tribunal de Números | P4-A |
| 12b | `P5-FIX` (solo si el tribunal halla errores) | Corregir hallazgos de `HALLAZGOS-TRIBUNAL.md`; lo redacta el Director tras P5-A | P5-A |
| 13 | `P5-B` | "Salud de Números" en vivo | P5-A (+ P5-FIX si aplica) |
| 14 | `P6-A` | `db:init-prod` auditado y limpieza sin re-siembra | P5-B |
| 15 | `P6-B` | Finanzas explicada, Socios/Nómina, gastos con método | P2-C, P5-B |
| 16 | `P7` | Partir Carta, manuales, simulacro de día completo, Acta | todas |

Las fases 3-4 (UI base) y 5-6 (datos) pueden ir en paralelo si se usan ramas separadas; con un solo agente, sigue el orden de la tabla.

## 7. Definición de terminado de la Ronda 2
1. Los 30 IDs de `defects.json` en `green`.
2. `pnpm guard:visual` en verde, 360×800 y 1280×800, todos los roles y todas las vistas del menú.
3. Tribunal de Números (≥14 escenarios) en verde, imprimiendo **Esperado vs Obtenido**. "Salud de Números" en verde.
4. Cobrar un pedido actualiza Caja, Cierre, Inicio, Panel y Finanzas con la **misma cifra** sin recargar.
5. Las 238 pruebas previas siguen verdes. `git diff pre-r2..HEAD` sobre el núcleo sagrado: vacío (salvo lo autorizado en P0-A).
6. Simulacro de jornada completa (P7) en verde y prueba humana de Anthony en teléfono (lista en P7).

## 8. Preguntas abiertas (solo las que bloquean decisiones)
1. **D2:** ¿Te sirve "el inventario se descuenta cuando la orden entra a cocina o se cobra, lo que ocurra primero"? Si prefieres "solo al cobrar" (como hoy), se cambia en P4-A.
2. **Gaveta física:** ¿Hay **una** gaveta de efectivo para todo el negocio o **una por sede**? Supuesto por defecto: una caja por cajera dentro de la jornada global; el Cierre suma todas y muestra el desglose por sede.
3. **Base real:** el .rar trae la BD de desarrollo. La limpieza de datos basura (P6-A) debe correrse sobre la BD del PC servidor; el agente prepara el comando y lo ejecutas tú.

## 9. Seguridad del paquete
El .rar incluye `apps/server/.env`, la base real, ~100 respaldos cifrados y el historial `.git`. Yo no abrí el `.env`. No vuelvas a compartir ese .rar completo; si el `.env` contiene claves, considera rotarlas. Para próximos chats basta un .zip de `apps/`, `packages/`, `docs/` y `scripts/`.
