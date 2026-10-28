# P0-B — Harness en navegador real, 30 defectos en ROJO y guard visual

**Chat nuevo.** Lee `docs/r2/01-REGLAS-DEL-AGENTE.md` y `docs/r2/00-PLAN-MAESTRO.md` (§2, §5, §6). Requiere P0-A terminado (`TOCINETA_DB_PATH`, `server_errors`).
**Alcance:** herramientas de prueba. **No corrijas ningún defecto en esta fase.** Si algo "se arregla solo", repórtalo.

## Objetivo
Construir el instrumento que faltó en F0–F7: pruebas en Chromium real sobre un escenario conocido, que demuestren en ROJO cada defecto y que luego sirvan de red de seguridad para el resto de la ronda.

## Hechos verificados
- `playwright ^1.64.1` ya está en el `package.json` raíz. `scripts/ui-guard.mjs` solo analiza texto del código (no ve el DOM).
- `package.json` raíz tiene `guard`, `lint`, `test`, `db:init-prod`, `db:seed-demo`. No existen `guard:visual`, `r2:e2e`, `r2:status`.
- Rutas reales del módulo de rentabilidad: `/api/fase3/*` y `/api/locations`, no `/api/profitability/*`.
- Las pantallas se navegan por hash (`/#po…`) y el menú está en `components/AppSidebar.tsx`.
- Métodos de cobro actuales: Efectivo dólares, Efectivo bolívares, Pago móvil, Punto de venta, Binance Pay, Crédito.

## Tareas
1. **Escenario determinista** `tools/r2-harness/seed-r2-scenario.ts` (BD temporal vía `TOCINETA_DB_PATH`, rechaza correr si la ruta es la real):
   - Exactamente **2 sedes** (`loc_los_olivos`, `loc_alta_vista`). *(Hoy aparece una tercera: esa aserción empieza en rojo; no la ocultes.)*
   - Tasa fija **500 Bs/USD** (`rate_micro_bs = 500000000`).
   - **10 insumos** con costo y unidad de compra/uso, **3 recetas** reales de la carta (p. ej. Brazil Dog, Chicago Dog y una hamburguesa) y stock inicial por sede.
   - **Una jornada abierta** con fondo **$100 + Bs 10.000** y una sesión de caja de la cajera.
   - Un usuario por rol con PIN de prueba definido solo en el harness (no reutilices PINs reales).
2. **Playwright** (`playwright.r2.config.ts`): proyectos `movil-360x800` (touch) y `escritorio-1280x800`; levanta servidor + web con BD temporal en puerto libre; traza, video y capturas en `docs/r2/evidencia/`. Comando `pnpm r2:e2e`. Instala solo Chromium (`pnpm exec playwright install chromium`).
3. **`docs/r2/defects.json`** con los 30 IDs de `00-PLAN-MAESTRO.md` §5: `{id, titulo, fase, estado:"red"|"green"}`.
4. **Una prueba por ID** en `tools/r2-harness/specs/r2-defects.spec.ts`. Cada una afirma el **comportamiento correcto** sobre el DOM real y hoy debe fallar **por la razón correcta** (la aserción), no por un error del harness. Ejemplos de aserciones:
   - B01/B26: ningún texto visible coincide con un nombre de ícono de lucide ni con emoji (`\p{Extended_Pictographic}`).
   - B02: para cada vista, `scrollWidth <= clientWidth` del título de cabecera a 360 px.
   - B04: ninguna vista muestra "Cargando" pasados 8 s.
   - B06: no existe el texto "Mesa Mesa".
   - B07/B09/B12: tras cobrar una orden de $11.90, Caja, Cierre, Panel y Finanzas muestran la misma cifra de ventas, y el paso de vuelto muestra el monto a entregar.
   - B13: el selector de sede lista exactamente 2.
   - B14–B20: guardar insumo rápido, sub-receta, merma por insumo, merma de plato, compra y receta nueva responde 2xx y la UI no muestra "$NaN" ni "Internal Server Error".
   - B21: no aparece "Treinta" en ninguna vista.
   - B23: llega un pedido nuevo al KDS → se invoca el audio, `navigator.vibrate` y la tarjeta recibe la clase de destello (espías con `addInitScript`).
   - B24: anular la orden #1 no modifica movimientos de las órdenes #10 y #11.
   - B28/B29: hay una sola jornada abierta; una merma no crea fila en gastos.
5. **Capturar los 500 reales.** Los tests de B14, B15, B17 y B19 guardan request y response, y consultan `server_errors`. Escribe `docs/r2/ERRORES-500-REALES.md` con el **mensaje exacto, archivo y línea** de cada uno. Esto reemplaza pedirle al usuario que copie el texto del error.
6. **`pnpm guard:visual`** (`scripts/guard-visual.mjs`): recorre **todas las rutas del menú, con cada rol, en ambos viewports**, y falla si encuentra:
   - texto que coincida con un nombre de ícono de lucide dentro de un botón, pestaña o chip;
   - emoji en el DOM;
   - contraste insuficiente (`@axe-core/playwright`, solo regla `color-contrast`, modo claro y oscuro);
   - "Cargando" después de 8 s;
   - desborde horizontal de página (`document.scrollWidth > innerWidth`);
   - título de cabecera truncado;
   - errores de consola, `pageerror` o respuestas 4xx/5xx no esperadas.
   Mantén `pnpm guard` (estático) como está: ahora es complementario, **no** criterio de cierre.
7. **`pnpm r2:status`**: imprime la tabla de `defects.json` con conteo `green/red` y falla si un ID previamente verde está en rojo (mecanismo "ratchet").
8. **`docs/r2/ROJO-INICIAL.md`**: salida real del primer run, con captura por defecto. Marca cualquier defecto que **no** se pudo reproducir y por qué.

## Prohibido
- Corregir defectos, ocultarlos con `test.fail()`/`skip`, o hacer que una prueba pase "por construcción".
- Usar `data/tocineta.db`. Usar PINs o claves reales.

## Criterios de aceptación
- `pnpm r2:e2e` corre de punta a punta y reporta los 30 IDs; el rojo es por aserción.
- `docs/r2/ERRORES-500-REALES.md` existe con mensajes reales (o la razón por la que un 500 no se reprodujo).
- `pnpm guard:visual` falla hoy y el informe lista qué vistas/elementos.
- Las 238 + nuevas pruebas de servidor siguen verdes.

## Entrega
Según §6 de las reglas. En el informe incluye: tabla ID → rojo/verde, tiempo de ejecución del E2E y cualquier defecto no reproducible.
