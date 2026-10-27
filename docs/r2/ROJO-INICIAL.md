# Reporte Oficial: Rojo Inicial de Ronda 2 (P0-B)

**Fecha:** 27 de octubre de 2026  
**Rama:** `reconstruccion`  
**Base de datos de prueba:** `data/tocineta.r2-harness.db` (Aislada vía `TOCINETA_DB_PATH`)  
**Suite E2E:** `pnpm r2:e2e` (`playwright.r2.config.ts`)  
**Guard Visual:** `pnpm guard:visual` (`scripts/guard-visual.mjs`)  
**Estado del ratchet:** `pnpm r2:status`  

---

## 1. Resumen Ejecutivo de Ejecución

| Métrica | Valor |
|---|---|
| **Defectos Evaluados** | 30 defectos (B01 a B30 de `00-PLAN-MAESTRO.md` §5) |
| **Pruebas en ROJO (Fallidas por aserción)** | **30 / 30 (100%)** |
| **Pruebas en VERDE** | **0 / 30 (0%)** |
| **Defectos No Reproducibles** | **0** (todos los defectos fueron reproducidos con éxito) |
| **Ejecuciones Totales** | 60 (30 en móvil 360×800 touch + 30 en escritorio 1280×800) |
| **Tiempo de Ejecución E2E** | **159.29 segundos** (~2 min 39 seg) |
| **Pruebas Unitarias/Integración Servidor** | **296 / 296 pasando (100% verde)** |
| **Violaciones Detectadas por Guard Visual** | **127 violaciones** (contraste WCAG, emojis, desbordes, etc.) |

> [!IMPORTANT]
> **Cero correcciones en P0-B:** Ningún defecto fue corregido en esta fase. Todos los fallos corresponden estrictamente a aserciones sobre el comportamiento correcto esperado frente a la aplicación real.

---

## 2. Matriz de Estado Inicial (30 Defectos en ROJO)

| ID | Título | Fase | Estado | Razón Exacta de la Falla (Aserción Real) | Evidencia (Captura / Video / Traza) |
|---|---|---|---|---|---|
| **B01** | Íconos impresos como texto | P1-A | 🔴 ROJO | `RotateCw en "RotateCw"` y `Flame en "Flame"` impresos como texto crudo en botones de KDS | `docs/r2/evidencia/artifacts/r2-defects-*-B01-*/` |
| **B02** | Cabecera: título truncado | P1-B | 🔴 ROJO | En 360px `scrollWidth > clientWidth` o texto truncado con puntos suspensivos ("Cart…", "Salu…") | `docs/r2/evidencia/artifacts/r2-defects-*-B02-*/` |
| **B03** | Contraste ilegible | P1-B | 🔴 ROJO | 60 violaciones de contraste WCAG AA detectadas por Axe-Core en modo claro y oscuro | `docs/r2/evidencia/artifacts/r2-defects-*-B03-*/` |
| **B04** | Personal y Carta con "Cargando…" infinito | P1-B | 🔴 ROJO | Vista queda atrapada mostrando "Cargando…" pasados 8 segundos sin reintento ni error | `docs/r2/evidencia/artifacts/r2-defects-*-B04-*/` |
| **B05** | Tomar pedido: textos, scroll, mesa opcional | P3 | 🔴 ROJO | Falta acceso directo de cobro sin scroll forzado y mesa obligatoria en flujo rápido | `docs/r2/evidencia/artifacts/r2-defects-*-B05-*/` |
| **B06** | "Mesa Mesa 1" | P1-B | 🔴 ROJO | KDS renderiza `<Badge>Mesa Mesa 1</Badge>` por doble prefijo redundante (`Mesa ${tableNumber}`) | `docs/r2/evidencia/artifacts/r2-defects-*-B06-*/` |
| **B07** | Vuelto: $0.00, sin vuelto mixto | P2-C | 🔴 ROJO | Interfaz de pago carece de desglose de vuelto real a entregar tras pago mayor al total | `docs/r2/evidencia/artifacts/r2-defects-*-B07-*/` |
| **B08** | Cobro Express: modal desborda / mueve fondo | P2-C | 🔴 ROJO | Modal no bloquea scroll del fondo del body en móvil (`overflow: hidden` ausente) | `docs/r2/evidencia/artifacts/r2-defects-*-B08-*/` |
| **B09** | Caja y Cierre en $0.00 (contratos rotos) | P2-B + P2-C | 🔴 ROJO | Lista de ventas muestra $0.00 en vez de $11.90 cobrados por discrepancia camelCase / snake_case | `docs/r2/evidencia/artifacts/r2-defects-*-B09-*/` |
| **B10** | Ventas del día: botones y pestañas cortadas | P1-A + P2-C | 🔴 ROJO | Renglón de ventas en 360px no renderiza botones de acción accesibles debido a desbordes | `docs/r2/evidencia/artifacts/r2-defects-*-B10-*/` |
| **B11** | KDS: ilegible y demasiados toques | P3 | 🔴 ROJO | KDS exige toques individuales por cada línea sin ofrecer botón de avance de comanda en 1 solo toque | `docs/r2/evidencia/artifacts/r2-defects-*-B11-*/` |
| **B12** | Cifras distintas entre Caja / Panel / Finanzas | P2-B + P2-C | 🔴 ROJO | Ventas netas en Cierre Z ($0.00) no coinciden con cobros reales registrados ($11.90) | `docs/r2/evidencia/artifacts/r2-defects-*-B12-*/` |
| **B13** | Selector lista 3 sedes en vez de 2 | P2-A | 🔴 ROJO | Endpoint `/api/locations` devuelve 3 sedes (`loc_los_olivos`, `loc_alta_vista`, `sede_alta_vista`) | `docs/r2/evidencia/artifacts/r2-defects-*-B13-*/` |
| **B14** | Inventario rápido no deja agregar insumos | P4-A + P4-B | 🔴 ROJO | Asistente de insumo rápido no incluye botón interactivo para agregar o persistir insumos | `docs/r2/evidencia/artifacts/r2-defects-*-B14-*/` |
| **B15** | Sub-receta: 500 y falta explicar batch | P4-A + P4-B | 🔴 ROJO | `POST /api/fase3/sub-recipes` lanza 500 (`SqliteError: NOT NULL constraint failed: sub_recipe_items.supply_id`) | `docs/r2/evidencia/artifacts/r2-defects-*-B15-*/` |
| **B16** | No se pueden crear recetas desde cero | P4-A + P4-B | 🔴 ROJO | Interfaz de Carta/Rentabilidad no cuenta con botón para crear receta nueva desde cero | `docs/r2/evidencia/artifacts/r2-defects-*-B16-*/` |
| **B17** | Merma: "($NaN)" y 500 por insumo | P4-A + P4-B | 🔴 ROJO | `POST /api/fase3/waste` lanza 500 (`Error: Producto 'null' no encontrado`) y UI muestra "($NaN)" | `docs/r2/evidencia/artifacts/r2-defects-*-B17-*/` |
| **B18** | Compras: casillas sin pedagogía ni foto | P4-A + P4-B | 🔴 ROJO | Modal de registro de compras carece de banners pedagógicos y campo de foto de factura | `docs/r2/evidencia/artifacts/r2-defects-*-B18-*/` |
| **B19** | Asistente: 1 solo insumo, recetas inoperantes | P4-A + P4-C | 🔴 ROJO | Asistente "Configura tu negocio" solo admite 1 insumo y lanza 500 (`TypeError: input.supplies is not iterable`) | `docs/r2/evidencia/artifacts/r2-defects-*-B19-*/` |
| **B20** | Cotizador de eventos sin platos | P4-C | 🔴 ROJO | Selector de platos del cotizador de eventos aparece vacío al no consultar el catálogo real | `docs/r2/evidencia/artifacts/r2-defects-*-B20-*/` |
| **B21** | "Treinta" en la interfaz | P1-B | 🔴 ROJO | Palabra "Treinta" encontrada 2 veces en el DOM visible (P&L / Comparativas heredadas) | `docs/r2/evidencia/artifacts/r2-defects-*-B21-*/` |
| **B22** | P&L: margen negativo en verde con datos basura | P2-B + P6-A | 🔴 ROJO | Margen neto negativo se estiliza con clase verde `text-success` en vez de alerta | `docs/r2/evidencia/artifacts/r2-defects-*-B22-*/` |
| **B23** | KDS: sin alerta de sonido / vibración / destello | P3 | 🔴 ROJO | Al llegar orden no se invoca `navigator.vibrate`, Web Audio API ni clase CSS de destello | `docs/r2/evidencia/artifacts/r2-defects-*-B23-*/` |
| **B24** | Anulación de orden por LIKE | P4-A | 🔴 ROJO | Búsqueda por LIKE `ORD_1` anula indebidamente `ORD_10` y `ORD_11` por falta de igualdad estricta | `docs/r2/evidencia/artifacts/r2-defects-*-B24-*/` |
| **B25** | Botón "Siguiente" deshabilitado sin motivo | P1-B | 🔴 ROJO | Botón "Siguiente" bloqueado sin retroalimentación visual accesible ni validación visible | `docs/r2/evidencia/artifacts/r2-defects-*-B25-*/` |
| **B26** | Emojis residuales en UI | P1-A | 🔴 ROJO | Se detectaron emojis crudos en el DOM (ej. `💡` en PedagogicalGuideBanner, `📸`, `⚙`) | `docs/r2/evidencia/artifacts/r2-defects-*-B26-*/` |
| **B27** | Stock negativo sin alerta clara | P6-B | 🔴 ROJO | Insumo con stock −4 no muestra badge de peligro destacado (`badge-danger`) | `docs/r2/evidencia/artifacts/r2-defects-*-B27-*/` |
| **B28** | Turno por sede en vez de jornada global | P2-A | 🔴 ROJO | La base de datos y endpoints permiten múltiples jornadas con estado `abierta` simultáneamente | `docs/r2/evidencia/artifacts/r2-defects-*-B28-*/` |
| **B29** | Merma duplicada como gasto | P4-A | 🔴 ROJO | El registro de merma genera fila duplicada e indebida en la tabla `operating_expenses` | `docs/r2/evidencia/artifacts/r2-defects-*-B29-*/` |
| **B30** | MenuAdminView.tsx supera 400 líneas | P7 | 🔴 ROJO | `MenuAdminView.tsx` contiene 1.497 líneas (límite estricto de gobernanza: 400 líneas) | `apps/web/src/components/MenuAdminView.tsx` |

---

## 3. Resumen de la Auditoría del Guard Visual (`pnpm guard:visual`)

El script `scripts/guard-visual.mjs` levantó Chromium real con un servidor de pruebas aislado en el puerto 3100 e inspeccionó todas las rutas del menú para cada uno de los roles (`admin`, `cajera`, `mesero`, `plancha`, `despacho`, `supervisor`) en ambos viewports (`movil-360x800` y `escritorio-1280x800`), evaluando tanto modo claro como modo oscuro.

- **Total de violaciones detectadas:** **127**
  - **`COLOR_CONTRAST`:** 48 ocurrencias (violaciones a la regla `color-contrast` de WCAG AA).
  - **`CONSOLE_ERROR`:** 36 ocurrencias (errores JavaScript no controlados en tiempo de render).
  - **`EMOJI_DETECTED`:** 24 ocurrencias (emojis unicode crudos renderizados en botones, banners o cabeceras).
  - **`HEADER_TRUNCATED`:** 11 ocurrencias (títulos de cabecera que desbordan su contenedor o quedan cortados con `…`).
  - **`HORIZONTAL_OVERFLOW`:** 8 ocurrencias (`document.scrollWidth > window.innerWidth` generando scroll horizontal indeseado).

El reporte JSON estructurado completo se encuentra guardado en:
`docs/r2/evidencia/guard-visual-report.json`.

---

## 4. Errores 500 Reales Capturados

Los errores 500 reales que ocurrían en servidor han sido aislados, interceptados y documentados con su mensaje exacto, archivo y número de línea en:
👉 [docs/r2/ERRORES-500-REALES.md](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/r2/ERRORES-500-REALES.md).

---

## 5. Conclusión de la Fase P0-B

El arnés de pruebas automatizadas sobre Chromium real ha quedado plenamente operativo y validado.
- El comando `pnpm r2:status` muestra los 30 defectos en **🔴 RED**.
- El arnés actúa como red de seguridad inquebrantable: en las fases siguientes (P1 a P7), cada fase cambiará sus respectivos defectos de rojo a verde sin romper ninguna prueba previa (ratchet).
- La base de datos de producción `data/tocineta.db` quedó 100% protegida e intacta.
