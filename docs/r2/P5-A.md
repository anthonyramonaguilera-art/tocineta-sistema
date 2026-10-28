# P5-A — Libro de Reglas y Tribunal de Números

**Chat nuevo.** Lee `docs/r2/01-REGLAS-DEL-AGENTE.md` y `docs/r2/00-PLAN-MAESTRO.md` (§4 completo). Requiere P4-A (y con él P2-A/P2-B).
**Alcance:** documentación y pruebas de servidor. **No corrijas código de producción aquí**: si el tribunal encuentra un error, repórtalo con su escenario y se corrige en la fase correspondiente (o en una fase de arreglo dedicada).

## Objetivo
Responder con evidencia la pregunta de Anthony: *¿descuenta el inventario?, ¿la ganancia es la real?, ¿el total vendido es correcto?, ¿el envío de un lote de Los Olivos a Alta Vista descuenta bien?, ¿las facturas cambian el costo de los platos?* Cada respuesta, impresa como **Esperado vs Obtenido**.

## Hechos verificados
- Existen `apps/server/test/*.test.ts` (238 pruebas) que prueban servicios; ninguna compara **todas** las pantallas ni el flujo multi-sede de punta a punta.
- Núcleo de dinero: `packages/shared/src/utils/money.ts` (enteros; prorrateo Hamilton: Combo Street 550¢ → [212, 211, 127]; Combo Clásico 790¢ → [325, 325, 140]; Combo Para Ti 1390¢ → [615, 615, 160]).
- Retención Ubii 0.75% (`reports-service.ts`: `fee = bruto × 75 / 10000`), tasa inmutable por venta, cierre Z con cadena SHA-256.
- Servicio único de dinero (`financial-truth-service.ts`, P2-B), consumo idempotente y reversa por `order_id` (P4-A).

## Tareas
1. **`docs/r2/LIBRO-DE-REGLAS.md`**: una regla por número del negocio, en lenguaje claro, con **fórmula, fuente de datos y ejemplo numérico**. Mínimo: ventas netas, descuentos, vuelto (USD/Bs/mixto), efectivo esperado en gaveta, retención del punto de venta, tasa inmutable, costo de receta, costo promedio ponderado, consumo de inventario (D2), transferencia entre sedes (D6), merma (D3), gasto por método de pago (D4), utilidad neta, jornada global (D1), stock negativo, redondeo. Cada regla indica el archivo que la implementa.
2. **`apps/server/test/r2-tribunal-numeros.test.ts`** (BD temporal con el escenario de P0-B: 2 sedes, tasa **500 Bs/USD**, apertura **$100 + Bs 10.000**). Cada escenario imprime una tabla `Concepto | Esperado | Obtenido | OK`. **El "Esperado" se calcula en el propio test con aritmética entera independiente**, nunca llamando a la función que se prueba.
   - **E1** Venta de $11.90 en efectivo USD exacto: ventas netas 1190¢; Bs equivalente 5.950,00; efectivo esperado USD = 100,00 + 11,90.
   - **E2** Pago de $20 en USD para $11.90 con **vuelto mixto** ($5,00 USD + el resto en Bs a 500): efectivo esperado USD = 100 + 20 − 5 = 115,00; Bs = 10.000 − 1.550,00 = 8.450,00.
   - **E3** Combos: el prorrateo Hamilton de los tres combos coincide con los valores sagrados (solo lectura).
   - **E4** Descuento/cupón con el cupón del escenario: neto y descuento correctos, redondeo a centavo.
   - **E5** Anulación de una orden pagada: contra-asiento, efectivo esperado vuelve, inventario revertido **por `order_id`** con las órdenes #1, #10 y #11 (regresión del `LIKE`); anulación antes y después de "En preparación" según D2.
   - **E6 (obligatorio)** Flujo multi-sede: **compra en Los Olivos → envío de 30 hamburguesas y 50 perros a Alta Vista → venta en Alta Vista → cuadre exacto**. Verifica insumo por insumo: stock Los Olivos = compra − envío; stock Alta Vista = envío − consumo por ventas; costo de lo enviado = costo promedio del origen; el consumo de las ventas sale de la sede de la orden (no "del lote"); suma de ambas sedes + consumido + mermado = comprado.
   - **E7** Compra con cambio de costo: 20 u a $0,40 + compra de 30 u a $0,50 → costo promedio 46¢; el costo de la receta que usa 1 u cambia a 46¢.
   - **E8** Merma de insumo: baja el stock de **esa sede** en la cantidad exacta y la utilidad baja **una sola vez**; no existe gasto espejo.
   - **E9** Merma de plato sin receta: sin costo → error `COST_REQUIRED`; con costo manual → registra, sin `NaN`.
   - **E10** Gasto de $5 en efectivo USD baja el esperado de gaveta; gasto de $5 por pago móvil **no**, pero sí baja la utilidad.
   - **E11** Gasto duplicado en 120 s → `POSSIBLE_DUPLICATE`; con `confirmDuplicate` pasa.
   - **E12** Cierre Z: esperado vs contado con diferencia, la cadena SHA-256 se verifica y coincide con la prueba existente de cierre.
   - **E13** Jornada global: ventas en ambas sedes; suma por sede = total; hay una sola jornada abierta; cobro sin sesión de caja rechazado.
   - **E14** Tasa inmutable: venta a 500; se cambia la tasa a 520; la venta anterior conserva Bs a 500 y la nueva usa 520.
   - **E15** Punto de venta: bruto Bs 10.000,00 → retención Bs 75,00 → neto Bs 9.925,00.
   - **E16** Idempotencia: la misma orden enviada dos veces con el mismo `clientRequestId` crea 1 orden y **1** descuento de inventario.
   - **E17** Stock negativo: vender sin stock se permite, queda marcado como advertencia (insumo y sede) y aparece en los datos que usará "Salud de Números".
3. **Consistencia entre pantallas:** tras E1 y E2, el test llama a las rutas de Caja, Cierre, Inicio, Panel (×2) y Finanzas y exige **la misma cifra de ventas y de efectivo esperado**.
4. Cada fallo del tribunal se registra en `docs/r2/HALLAZGOS-TRIBUNAL.md` con: escenario, esperado, obtenido, archivo probable y propuesta. **No cambies el "Esperado" para que pase.**

## Prohibido
- Calcular el "Esperado" con el código bajo prueba.
- `test.skip`, tolerancias mayores a $0.01, o aserciones débiles.
- Modificar código de producción en esta fase.

## Criterios de aceptación
- 17 escenarios implementados; cada uno imprime su tabla Esperado vs Obtenido.
- Los que fallen están documentados en `HALLAZGOS-TRIBUNAL.md` con evidencia; ninguno oculto.
- `LIBRO-DE-REGLAS.md` cubre todas las reglas listadas y cada una apunta a su implementación.
- 238+ pruebas previas verdes (las nuevas pueden quedar rojas **solo** si revelan un error real documentado).

## Si el tribunal encuentra errores reales
Se abre una fase **P5-FIX** (chat nuevo por grupo de hallazgos, redactada por el Director a partir de `HALLAZGOS-TRIBUNAL.md`). P5-B no empieza hasta que los hallazgos de severidad alta estén corregidos y el tribunal esté en verde sin tocar los "Esperado".

## Entrega
Según §6. Incluye la salida completa del tribunal y la lista priorizada de hallazgos.
