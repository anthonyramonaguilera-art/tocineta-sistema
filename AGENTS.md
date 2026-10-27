# REGLAS ESTRICTAS DE INGENIERÍA Y GOBERNANZA — SISTEMA "TOCINETA" (v3.0)

## 1. CERO REFERENCIAS A MARCAS O NOMBRES PROPIOS
- Prohibido en código, DB, migraciones o UI: `Olinelcys`, `Anthony`, `Carlos`, `Andrea`, `Miguel`, `José`, `Valery`, `Treinta`, `Sonríe`, `God Mode`, `Modo Dios`, `Varons`.
- Marca oficial única: **"TOCINETA"**.
- Perfiles por defecto: **`ADMIN`**, **`CAJERA`**, **`MESERO`**, **`PLANCHA`**, **`DESPACHO`**.

## 2. DISEÑO UI/UX BLINDADO (MODO CLARO Y TOUCH-FIRST)
- **Modo Claro por defecto** (`light`). Todo debe tener contraste WCAG AA.
- **Cero Emojis:** Prohibido usar emojis (🍔, 👑, 💵) en botones o títulos. Usa exclusivamente `lucide-react` (a través del componente `Icon` en `src/ui/`).
- **Cero Colores Fijos:** Prohibido `!important`, colores hex (`#FFFFFF`) en archivos `.tsx` y clases `text-white`/`bg-black` fuera de `src/ui/`. Usa los tokens semánticos (`bg-surface`, `text-ink`).
- **Límite de Archivos:** Ningún archivo de pantalla o componente debe superar las **400 líneas**. Si es más grande, divídelo en subcomponentes o hooks.
- **Flujo Táctil:** Botones con `min-h-[48px]` a `54px`. Los flujos deben ser guiados ("Siguiente ➔ Siguiente").

## 3. INTOCABLE: LÓGICA DE NEGOCIO Y CORE
- **PROHIBIDO** modificar la lógica de dinero en enteros (centavos y micro-Bs), el motor de impresión ESC/POS, el outbox offline (IndexedDB) y la concurrencia de pedidos, a menos que la fase lo pida explícitamente.
- **PROHIBIDO** dejar módulos "placeholder" (botones que no hacen nada o pantallas que dicen "Temporalmente no disponible"). Si algo no está implementado, no se muestra en el menú.

## 4. TESTING Y VALIDACIÓN (CERO TRAMPAS)
- **PROHIBIDO** borrar tests, usar `test.skip` o debilitar aserciones para forzar un "PASÓ". Si un test falla, se corrige el código fuente o se actualiza la prueba con justificación técnica.
- **Validación Obligatoria:** Antes de declarar una fase terminada, debes ejecutar y mostrar la salida de:
  1. `pnpm run guard` (Validador de UI).
  2. `pnpm -r run lint` (TypeScript).
  3. `pnpm -r run build` (Compilación de producción).
  *(Nota: No ejecutes `pnpm test` en fases visuales para ahorrar tiempo, a menos que la instrucción lo exija).*

## 5. CONTROL DE VERSIONES Y GIT
- Al finalizar una fase con el `build` en verde, realiza un commit atómico con el mensaje `feat/fix(fase-X): [descripción]` y crea un tag `fase-X`.
- **PROHIBIDO** hacer `git push --force` o hacer reset destructivo sin autorización explícita.