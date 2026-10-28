# P5-B — "Salud de Números": invariantes contables en vivo

**Chat nuevo.** Lee `docs/r2/01-REGLAS-DEL-AGENTE.md`, `docs/r2/00-PLAN-MAESTRO.md` y `docs/r2/LIBRO-DE-REGLAS.md`. Requiere P5-A y que `HALLAZGOS-TRIBUNAL.md` esté resuelto (sin hallazgos abiertos de severidad alta).
**Defectos:** ninguno nuevo; cierra la validación continua pedida por Anthony ("validar que todo lo numérico sea exacto, claro e intuitivo").

## Objetivo
Un tablero de semáforo que, en cualquier momento, compruebe por sí mismo que los números del negocio cuadran y explique en español claro qué hacer si algo no cuadra.

## Hechos verificados
- Ya existe una vista "Salud del Sistema" (técnica: SQLite, respaldos, USB, claves). Esta vista nueva es **de números**, distinta y pensada para la dueña.
- El servicio único `finances/financial-truth-service.ts` (P2-B) y las reglas de `LIBRO-DE-REGLAS.md` (P5-A) son la fuente de los cálculos.
- Cierre Z con cadena SHA-256 ya verificable (`closures-service.ts`, solo lectura).

## Tareas
1. **`apps/server/src/modules/system/numbers-health-service.ts`** con `checkNumbersHealth(rawDb)` que devuelve una lista de invariantes `{ id, titulo, estado:'ok'|'aviso'|'error', esperado, obtenido, detalle, queHacer }`:
   - **I1** Cada orden pagada tiene pagos ≥ su total (tolerancia $0.01) y `jornada_id` + `cash_session_id` no nulos.
   - **I2** Para cada sede e insumo, `location_inventory.current_stock_qty` = suma de sus `inventory_movements` (tolerancia 0,0001).
   - **I3** Ventas netas de Caja = Cierre = Inicio = Panel = Finanzas (se comparan las seis rutas contra `getFinancialTruth`).
   - **I4** Existe como máximo una jornada abierta.
   - **I5** Existen exactamente dos sedes activas y ninguna fila referencia una sede inexistente (`PRAGMA foreign_key_check`).
   - **I6** No hay mermas duplicadas como gasto (ninguna fila `MERMAS_DESPERDICIOS` con espejo en `waste_logs`).
   - **I7** Stock negativo por sede/insumo → `aviso` con la lista de insumos.
   - **I8** Suma de ventas por sede = total de la jornada.
   - **I9** La cadena de hashes de los cierres Z verifica (solo lectura).
   - **I10** Ninguna orden entregada sin consumo de inventario registrado (D2), ni con consumo doble.
   Cada invariante es una función pura y testeable; los mensajes `queHacer` son accionables ("Revisa el insumo X en Alta Vista: la merma de ayer no descontó stock").
2. **`GET /api/system/numbers-health`** (solo admin/dueña) con el resultado y la hora; manejo de errores con `AppError`. Cada chequeo aislado en `try/catch` (si uno falla, se reporta como `error` de ese chequeo, no tumba los demás).
3. **Vista "Salud de números"** (`apps/web/src/features/system/NumbersHealthView.tsx`, ≤400 líneas): tarjeta global de semáforo, lista de invariantes con ícono tipado, explicación corta, **Esperado vs Obtenido**, "Qué hacer", y botón "Verificar ahora". Estados de carga (máx. 8 s), error y vacío. Aparece en el menú solo para roles autorizados. Contraste AA a 360 px.
4. **Disparadores:** se ejecuta al abrir la vista, **después de cada Cierre Z** (resultado guardado junto al cierre, sin modificar los campos del hash) y desde el simulacro de P7. No se ejecuta en cada petición (costo).
5. **Pruebas** `apps/server/test/r2-numbers-health.test.ts`: escenario sano → todo `ok`; por cada invariante, un caso con datos **corrompidos a propósito** en BD temporal que lo hace fallar con el mensaje esperado. Más una prueba Playwright de la vista en ambos viewports.

## Prohibido
- Tocar `closures-service.ts`, `money.ts`, impresión, outbox. La vista **lee**, nunca corrige datos.
- Mensajes técnicos sin acción ("constraint failed"). Todo texto es para la dueña.
- Semáforo verde cuando un chequeo falló al ejecutarse.

## Criterios de aceptación
- Los 10 invariantes con prueba de caso sano y de caso corrompido.
- Vista en verde con el escenario sano y en rojo/ámbar con datos corruptos, con capturas.
- 238+ pruebas verdes; `guard:visual` verde; lint y build verdes.

## Entrega
Según §6. Adjunta capturas del semáforo sano y de un caso corrupto con su "Qué hacer".
