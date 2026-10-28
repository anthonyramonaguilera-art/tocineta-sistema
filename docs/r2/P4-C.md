# P4-C — Asistente "Configura tu negocio", pedagogía y cotizador de eventos

**Chat nuevo.** Lee `docs/r2/01-REGLAS-DEL-AGENTE.md` y `docs/r2/00-PLAN-MAESTRO.md`. Requiere P4-A (endpoint `setup-wizard/save`) y P4-B (`api.ts`, modales).
**Defectos:** B19 (UI), B20. **Alcance:** `apps/web` (sin tocar servidor salvo un bug de contrato que reportes).

## Objetivo
Que la dueña pueda cargar su negocio completo (N insumos, N proveedores, N recetas) guiada por un tutorial que explique cada concepto con números reales, y que el cotizador de eventos muestre y use los platos de la carta.

## Hechos verificados (confirma con grep)
- `features/profitability/InitialSetupWizard.tsx` (298 líneas): maneja **un solo** insumo y **un solo** proveedor en su estado; el paso de recetas dice "3 modos activos… configura desde la pestaña Recetas o importa por Excel" y no permite hacer nada; **"Finalizar" no produce efecto visible** (Anthony). Existe `components/CsvDataImportCard.tsx` (importación Excel/CSV) y los endpoints `/api/fase3/setup-wizard/{template,export,import,save}`.
- Anthony no entiende **unidad de compra, unidad de uso y factor de conversión**; pidió un **tutorial interactivo**.
- Cotizador: `features/quotes/EventQuotesView.tsx`, `QuoteModal.tsx`, `useQuotesData.ts`, `types.ts`, `PrivateSimulatorWidget.tsx`. Al elegir "platos de la carta" la lista sale vacía. `EventQuotesView.tsx` solo hace `fetch` de `/api/quotes/:id/whatsapp`; el catálogo debe venir de `GET /api/menu/pos` (platos y combos, con `priceUsdCents`).
- No existe un componente de ayuda reutilizable ni de tutorial en `apps/web/src/ui/`.

## Tareas
1. **`ui/HelpHint.tsx`** ("¿Qué es?"): botón con ícono tipado que abre una hoja/popover accesible con definición corta y **ejemplo numérico**. Sin librerías externas, sin red. Úsalo en **cada** campo técnico: unidad de compra, unidad de uso, factor de conversión, costo promedio ponderado, rendimiento del lote, stock mínimo, merma, margen, jornada. Textos de ayuda centralizados en `features/help/helpTexts.ts` (un archivo, fácil de corregir).
2. **`ui/Coachmark.tsx` + tutorial interactivo** (offline, sin dependencias): recorre en vivo el concepto con el negocio ficticio "Paquete de pan": *compro 1 paquete de 12 panes a $5.40 → unidad de compra = paquete, unidad de uso = pan, factor = 12 → cada pan cuesta $0.45*. La persona edita los números y ve el resultado cambiar. Se puede saltar, repetir y se recuerda si ya lo completó (estado local; nunca bloquea el uso).
3. **Asistente en pasos con listas dinámicas:**
   - **Paso Insumos:** filas agregables/eliminables (nombre, categoría, unidad de compra, unidad de uso, factor, costo, mínimo) con validación por fila y atajo "Pegar desde Excel".
   - **Paso Proveedores:** filas agregables (nombre, teléfono, notas).
   - **Paso Recetas:** por cada plato de la carta, ingredientes tomados **de los insumos de este mismo asistente y de los ya existentes**, con cantidad y costo/margen en vivo. Se puede dejar "Sin receta por ahora" explícitamente.
   - **Paso Revisión:** resumen con conteos y avisos ("2 insumos sin costo"); botón **Finalizar** llama `POST /api/fase3/setup-wizard/save` **una sola vez** con todo, muestra "Creados: X insumos, Y proveedores, Z recetas" o el error por fila (resaltando la fila), y navega a Inventario. Si falla, **no se pierde nada de lo escrito**.
   - Borrador autoguardado localmente (IndexedDB/estado) para no perder el trabajo al cerrar.
4. Mantén cada archivo ≤400 líneas: `InitialSetupWizard.tsx` solo orquesta; cada paso en su archivo (`SetupStepSupplies.tsx`, `SetupStepSuppliers.tsx`, `SetupStepRecipes.tsx`, `SetupStepReview.tsx`) y estado en `useSetupDraft.ts`. Conserva la importación Excel/CSV existente.
5. **Cotizador (B20):** el selector de platos carga `GET /api/menu/pos` (platos y combos, con búsqueda y categoría), muestra precio y, si hay receta, costo y margen; permite cantidad por plato y calcula el total de la cotización con las funciones existentes del módulo. Estados de carga/error/vacío con "Reintentar". Si el catálogo está vacío, mensaje claro con enlace a Carta.
6. **Pruebas Playwright:** asistente con 3 insumos + 2 proveedores + 2 recetas → Finalizar → aparecen en Inventario y Recetas; error por fila (insumo sin nombre) no borra lo demás; tutorial completo y salto; cotizador lista los platos reales de la carta y calcula un total.

## Prohibido
- Dependencias externas de tutorial/ayuda o contenido cargado de internet.
- Dejar un paso con botón que no hace nada o texto "temporalmente no disponible".
- Reescribir el motor de importación Excel/CSV.

## Criterios de aceptación (Playwright 360×800 y 1280×800)
- B19 (UI) y B20 en verde; `guard:visual` verde.
- Cada campo técnico del asistente y de Compras tiene `HelpHint` con ejemplo numérico verificable por prueba.
- Finalizar crea todo en una operación y se ve el resultado; recargar la página tras Finalizar muestra los datos guardados.
- 238+ pruebas verdes; lint y build verdes.

## Entrega
Según §6. Adjunta capturas a 360 px de cada paso, del tutorial y del cotizador con platos. Lista **NO VERIFICADO** lo que dependa de datos reales de la dueña.
