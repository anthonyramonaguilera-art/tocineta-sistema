# REGLAS ESTRICTAS DE INGENIERÍA Y GOBERNANZA — SISTEMA "TOCINETA" (v4.0)

Este documento es la ley operativa para cualquier agente de IA (Arquitecto o Mecánico) que intervenga el repositorio.

## 1. IDENTIDAD, MARCA Y CERO NOMBRES EXTERNOS
- **Marca oficial única:** `"TOCINETA"`.
- **Prohibido en código, DB, migraciones, comentarios o textos de UI:**
  - Nombres propios o alias antiguos: `Olinelcys`, `Anthony`, `Carlos`, `Andrea`, `Miguel`, `José`, `Valery`, `Sonríe`, `God Mode`, `Modo Dios`, `Varons`.
  - Nombres de software, herramientas o librerías externas en textos visibles al usuario (ej. `Treinta`, `RawBT`, `Capacitor`, `Fastify`, `SQLite`, `Tailwind`).
- **Roles canónicos únicos en Base de Datos y RBAC (Decisión D2):**
  - Únicamente existen 6 roles en minúsculas: `admin`, `supervisor`, `cajera`, `mesonero`, `cocinero`, `despachador`.
  - **PROHIBIDO** usar roles antiguos o en mayúsculas (`ADMIN`, `CAJERA`, `MESERO`, `PLANCHA`, `DESPACHO`).

## 2. DISCIPLINA DE EDICIÓN DE ARCHIVOS Y CONTROL DE CONTEXTO
- **Alcance estricto:** Edita **ÚNICAMENTE** los archivos listados explícitamente en el prompt de la tarea.
- **Preservación de saltos de línea (CRLF / LF):** Antes de editar cualquier archivo, respeta sus saltos de línea originales (`\r\n` o `\n`). Edita solo los bloques indicados; nunca reescribas ni reformatees el archivo completo. Tras editar, `git diff --stat` debe reflejar únicamente las líneas modificadas.
- **Verificación de anclas (Cero adivinanzas):** Si una función, línea o texto ancla indicado en el prompt no existe tal cual en el archivo, **DETENTE INMEDIATAMENTE** y reporta lo que encontraste. Prohibido improvisar o adivinar contratos.
- **Prohibido:** Instalar dependencias nuevas sin orden explícita, renombrar endpoints existentes o dejar botones/pantallas "placeholder" sin funcionalidad real.

## 3. SISTEMA DE DISEÑO UI/UX BLINDADO (`pnpm run guard`)
- **Modo Claro obligatorio (`light`):** Contraste mínimo WCAG AA en toda la interfaz.
- **Cero Emojis:** Prohibido usar emojis en archivos `.tsx` o `.ts` de interfaz. Usa exclusivamente el componente `<Icon name="..." />` de `src/ui/`.
- **Cero Colores Fijos:** Prohibido `!important`, códigos hexadecimales (`#FFFFFF`), `rgb(...)` y clases fijas como `text-white`, `bg-black`, `bg-red-500`, etc., fuera de `src/ui/`.
- **Tokens semánticos únicos permitidos:** `bg-surface`, `text-ink`, `text-ink-muted`, `border-border`, `text-danger`, `text-warning`, `text-success`, `bg-primary`.
- **Uso del UI Kit (`apps/web/src/ui/`):**
  - Importa componentes **únicamente** desde `'../../ui/index.js'` (o la ruta relativa hacia `src/ui/index.js`).
  - `Select` e `Input` **NO** tienen prop `label`: siempre deben envolverse en `<Field label="..." required>` cuando lleven etiqueta.
  - Todo botón o control interactivo táctil debe tener al menos `min-h-[48px]`.
- **Límite duro de tamaño:** Ningún archivo `.tsx` puede superar las **400 líneas** (validado por `scripts/ui-guard.mjs`). Si un componente se acerca a 380 líneas, extrae subcomponentes o hooks.

## 4. ARQUITECTURA BACKEND, SEGURIDAD Y BASE DE DATOS
- **Dinero en enteros:** Todos los montos en USD van en centavos enteros (`_usd_cents`) y las tasas en micro-Bolívares enteros (`rate_micro_bs`). Prohibido usar decimales flotantes para contabilidad.
- **Intocables salvo instrucción explícita:** Lógica de sesión de caja por estación (`getStationCashSession`), verdad financiera (`financial-truth-service.ts`), Cierre Z (`closures-service.ts`), KDS (`kds-service.ts`) y outbox offline (`outbox.ts`).
- **Política de Rutas (`route-policy.ts`):**
  - Toda ruta nueva en Fastify bajo `/api/*`, `/ws` o `/qr/*` **DEBE** registrarse en `apps/server/src/config/route-policy.ts` (el test `r2-route-policy.test.ts` falla si falta).
  - Las rutas estáticas públicas (como `/uploads/*` y `/apk/*`) se sirven vía `@fastify/static` y deben excluirse del fallback SPA (`index.html`) en `apps/server/src/plugins/static.ts` para devolver `404` real cuando un archivo no exista.
- **Autenticación y Cliente Web:**
  - En backend, prohibido leer `x-user-id` para identificar al usuario; usa exclusivamente `request.user` / `resolveActingUser(request)`.
  - En frontend (`apps/web`), prohibido usar `fetch` nativo; usa siempre `apiFetch` de `apps/web/src/api/client.ts` (inyecta automáticamente el `Bearer` token y la cabecera `X-Terminal-Id`).
- **Migraciones SQLite (`apps/server/src/db/migrations/`):**
  - Estrictamente *forward-only*. **PROHIBIDO** editar migraciones ya creadas (`0000` a `0043`; nota: la `0033` no existe por salto histórico y jamás debe crearse).
  - Si una migración nueva requiere reconstruir una tabla referenciada por claves foráneas, debe incluir `-- tocineta:fk-off` en la primera línea.
  - El MCP de SQLite solo puede apuntar a `apps/server/data/tocineta-dev.db`, jamás a bases de producción.
- **Aislamiento del Workspace (`pnpm-workspace.yaml`):**
  - El workspace de `pnpm` solo abarca `apps/*`, `packages/*` y `tools/*`.
  - El proyecto nativo Android (`android-terminal/`) vive en la raíz del repositorio, fuera del workspace de `pnpm`.

## 5. TESTING, VALIDACIÓN Y REPORTE
- **Cero trampas en tests:** Prohibido borrar tests, usar `test.skip` o debilitar aserciones para forzar que pasen.
- **Comandos de verificación antes de cada commit:**
  1. `pnpm run guard` (Gobernanza UI: 0 errores).
  2. `pnpm -r run lint` (TypeScript en shared, server y web: 0 errores).
  3. En tareas de servidor: `pnpm --filter @tocineta/server exec vitest run <archivo-de-test-del-prompt>` para validación rápida durante desarrollo, y la suite completa al cierre de cada etapa.
  4. En tareas de Android (`android-terminal/`): `cd android-terminal && .\gradlew.bat testDebugUnitTest assembleDebug`.

## 6. HIGIENE DE GIT Y COMMITS ATÓMICOS
- **Un commit por prompt** usando siempre **rutas explícitas**:
  - `git add <archivo1> <archivo2>`
  - `git commit -m "feat|fix|test|docs(alcance): resumen" -- <archivo1> <archivo2>`
- **Terminantemente prohibido:** `git add -A`, `git add .`, `git commit -a`, `git stash`, `git reset --hard`, `git push --force`.
- **Formato de respuesta al finalizar cada prompt:** Responde únicamente con:
  1. Archivos tocados.
  2. Tests agregados o ejecutados.
  3. Salida resumida de los comandos de verificación y de `git diff --stat`.
  4. Cualquier desviación o bloqueo detectado.
