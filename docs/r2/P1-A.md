# P1-A — Íconos tipados: la raíz real de "Flame", "CheckCircle" y "RotateCcw" en pantalla

**Chat nuevo.** Lee `docs/r2/01-REGLAS-DEL-AGENTE.md` y `docs/r2/00-PLAN-MAESTRO.md` (§2 causa 1). Requiere P0-B (`pnpm r2:e2e`, `guard:visual`).
**Defectos:** B01, B10 (parte de íconos), B26.

## Objetivo
Que sea **imposible por tipos** imprimir el nombre de un ícono como texto, y eliminar los sitios actuales que lo hacen.

## Hechos verificados (confirma con grep)
- `apps/web/src/ui/Icon.tsx` ya funciona: si el nombre no existe dibuja `HelpCircle`. **No es la causa.** Hace `import * as LucideIcons` (arrastra todo lucide al bundle) y busca por nombre con `as any`.
- `ui/Button.tsx` declara `leftIcon, rightIcon, iconStart, iconEnd` como `React.ReactNode`; `ui/Tabs.tsx` declara `icon?: React.ReactNode` y hace `{item.icon}`. Un string pasa el compilador y se imprime como texto.
- Hay ~66 sitios con `leftIcon="X"`, `icon="X"` o `icon: 'X'` (sidebar, Finanzas, KDS, Rentabilidad, Caja). Fotos: "Flame En Plancha", "CheckCircle Listas", "RotateCcw Revertir", "Receipt Ventas del día", "Lock Fondo / Apertura", "Banknote Salida de Caja Chica".
- Emoji residual en una guía de Salud del Sistema (📸) y un glifo de engranaje en "Cargando Gestor de Menú…".

## Tareas
1. **Registro explícito** `apps/web/src/ui/icons.ts`: importaciones **nombradas** de `lucide-react` para cada ícono realmente usado (obtén la lista con grep de todos los `name=`/`icon`/`leftIcon`…), exportadas en `ICONS` y `export type IconName = keyof typeof ICONS`. Esto también reduce el bundle: mide tamaño antes/después y repórtalo.
2. **`Icon`**: `name: IconName` (obligatorio) o `icon: LucideIcon`; sin `as any`. Nombre desconocido: en desarrollo lanza error, en producción dibuja un cuadrado neutro **sin texto**.
3. **Tipar todas las props de ícono** en `ui/*` y `components/*` (Button, Tabs, Badge, Card, EmptyState, StatCard, Chip, ítems del sidebar, etc.): `IconName | React.ReactElement`. Dentro del componente, si llega un `IconName`, se renderiza `<Icon name=… />`. **Un string cualquiera debe dar error de compilación.**
4. **Migrar los ~66 sitios.** Los objetos de listas (`icon: 'Flame'`) pasan a tipo `{ icon: IconName }`.
5. **Prueba de tipos** `ui/icons.type-test.ts` con `// @ts-expect-error` que demuestre que `<Button leftIcon="Texto">` no compila.
6. **Emoji:** elimina todo carácter `\p{Extended_Pictographic}` de `apps/web/src` (incluye el 📸 y el engranaje del estado de carga; usa `Icon`). **No toques** `apps/server/src/modules/printing/*` (el motor de tickets es sagrado y puede usar glifos de impresora).
7. **Revisión visual real:** en Playwright a 360 px captura KDS, Caja (Cobro / Ventas del día / Cierre), Inventario, Finanzas y el menú lateral. Todo botón/pestaña con ícono debe mostrar un SVG y **ningún** texto con nombre de ícono.

## Prohibido
- Reescribir la lógica de los componentes más allá de las props de ícono.
- Dejar cualquier `as any` para esquivar el tipo.
- Tocar impresión, dinero, outbox.

## Criterios de aceptación
- `pnpm -r run lint` falla si alguien pasa un string no válido como ícono (demostrado con la prueba de tipos).
- B01, B10 (íconos) y B26 en verde en `defects.json`; `guard:visual` ya no reporta nombres de ícono ni emojis.
- Tamaño del bundle web igual o menor que antes (reporta ambas cifras).
- 238+ pruebas verdes; `pnpm build` verde.

## Entrega
Según §6. Adjunta las capturas a 360 px de las 5 vistas indicadas.
