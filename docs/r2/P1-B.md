# P1-B — Cabecera, contraste, carga con tiempo máximo y textos

**Chat nuevo.** Lee `docs/r2/01-REGLAS-DEL-AGENTE.md` y `docs/r2/00-PLAN-MAESTRO.md`. Requiere P1-A.
**Defectos:** B02, B03, B04, B06, B21, B25.

## Objetivo
Una interfaz legible a 360 px: título completo, texto con contraste real, ninguna pantalla colgada y cero referencias a software externo.

## Hechos verificados
- Fotos: la cabecera muestra ☰, logo, título, interruptor "Modo Básico/Pro" y "BCV 887,302"; el título queda en "Salu…", "Pers…", "Cart…", "Inve…". Componente: `components/AppHeader.tsx`.
- Salud del Sistema: valores casi invisibles (texto claro sobre fondo claro) y guía amarilla sobre marrón ilegible. Carta y precios con colores que no dejan leer.
- Personal: "Cargando personal…" con contador 0. Carta: "Cargando Gestor de Menú y Catálogo Admin…". `components/MenuAdminView.tsx` (1.496 líneas) hace `if (isLoading || !adminMenu)` → si la consulta falla, el spinner no termina. `features/staff/StaffManagementView.tsx`: causa **por confirmar** (captura request/response).
- La etiqueta "Mesa Mesa 1" sale en KDS, Cobro Express y Revisión (prefijo "Mesa" + valor que ya dice "Mesa 1").
- "Treinta" aparece en `components/AppSidebar.tsx`, `AppLayout.tsx`, `features/home/HomeView.tsx` y 6 archivos de `features/finances/` (badge "ESTILO TREINTA", menú "Finanzas (Treinta)").
- `ui/WizardLayout.tsx`: el pie tapa contenido; "Siguiente" deshabilitado sin explicación (foto "Revisar Pedido" apagado).
- `ui/Toast.tsx` se superpone con la cabecera (foto "Orden #6 cobrada con éxito").

## Tareas
1. **Cabecera de 56 px con 4 elementos:** menú, título de la vista, tasa BCV compacta, indicador de conexión/cola offline. El logo y los selectores **Básico/Pro** y **Sede** pasan al menú lateral. Mapa `VIEW_TITLES` con títulos cortos (≤18 caracteres: "Inicio", "Tomar pedido", "Cocina", "Caja", "Inventario", "Finanzas", "Panel dueña", "Carta", "Personal"). El título **nunca** se trunca a 360 px (prueba: `scrollWidth <= clientWidth` en cada vista).
2. **Tokens de color** (una sola fuente en la configuración de Tailwind/CSS variables): `--accent: #FFE600` solo como **fondo**, siempre con texto oscuro (`text-ink-on-accent`); prohibido texto amarillo sobre blanco, gris claro o degradados. Revisa Salud del Sistema, Carta y precios, Inicio y todas las guías. Modo claro y oscuro, WCAG AA (4.5:1).
3. **`InfoCallout` unificado** en `ui/` (variantes info/éxito/advertencia/peligro, ícono tipado, botón "Entendido, ocultar guía" accesible) y sustitución de todas las guías ad hoc.
4. **Toast** por debajo de la cabecera (`top = 56px + safe-area`) y sin tapar el menú.
5. **Carga con tiempo máximo.** Hook `useLoadState`/componente `LoadBoundary`: spinner máximo 8 s → estado de error con mensaje y **"Reintentar"**; estado vacío distinto del de carga. Aplícalo a Personal, Carta y al `Suspense` general de `React.lazy` en `App.tsx`. **Encuentra la causa real** de cada cuelgue (qué request falla y por qué) y corrígela; el timeout no sustituye la causa.
6. **`WizardLayout`:** padding inferior = alto del pie + safe-area (nada queda tapado); cuando "Siguiente"/"Revisar Pedido" está deshabilitado, un texto visible arriba del botón dice **qué falta** ("Falta: nombre del cliente, mínimo 3 letras").
7. **`formatTableLabel(value)`** único (en `lib/format`): normaliza a "Mesa 1" y nunca duplica el prefijo; úsalo en KDS, Cobro Express, Revisión y Caja. (No toques plantillas de impresión.)
8. **Marca:** elimina "Treinta" de la interfaz, comentarios y textos de `apps/web/src` y `apps/server/src` (menú pasa a "Finanzas"; badge eliminado). Amplía `scripts/ui-guard.mjs` para fallar con las palabras prohibidas de `AGENTS.md` en esas carpetas (excluye los **nombres** de archivos de migración ya aplicados, p. ej. `0020_valery_treinta_full_erp.sql`).
9. En `MenuAdminView.tsx` **solo** se corrigen colores y estado de carga; la partición del archivo va en P7.

## Prohibido
- Cambiar lógica de negocio, rutas del servidor o dinero.
- Ocultar un cuelgue con un timeout sin diagnosticar su causa.
- Renombrar migraciones ya aplicadas.

## Criterios de aceptación
- B02, B03, B04, B06, B21, B25 en verde; `guard:visual` sin fallos de contraste, truncado ni "Cargando" en todas las rutas y roles.
- Capturas a 360 px: cabecera de cada vista, Salud del Sistema, Carta, Personal.
- Lint, build y 238+ pruebas verdes.

## Entrega
Según §6. Incluye la causa real encontrada para el cuelgue de Personal y el de Carta.
