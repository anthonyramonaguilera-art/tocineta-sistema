# TOCINETA — Plan de reconstrucción v3

Dirección General · 26/10/2026 · Fase actual: pre-F0

Este documento reemplaza los planes R1–R4. Está basado en lo que verifiqué en el código del .rar, en las 50 capturas de tu teléfono y en una corrida real de lint y pruebas. Lo que no pude verificar está marcado.

## 1. Estado real (verificado)

**Qué hice:** extraje las fuentes del .rar, instalé dependencias, corrí `tsc` y `vitest`, leí los archivos clave y vi las capturas. **Qué no hice:** no ejecuté la app ni abrí pantallas en un navegador; lo visual sale de tus capturas del 26/10 a las 18:59, anteriores a parte de R2.

| # | Hallazgo | Evidencia |
| --- | --- | --- |
| 1 | **Las pruebas ya no están en verde.** `tsc` pasa sin errores en los 4 paquetes. `shared`: 22/22. `server`: 46 fallan, 43 pasan, 143 omitidas (22 de 26 archivos con fallas). | Corrida propia en Linux. Una falla dice literalmente `expected 'ADMIN' to contain 'Olinelcys'`; hay 401/403 y `FOREIGN KEY` porque R1 cambió usuarios y auth y las pruebas esperan los viejos. Algunas fallas podrían ser por Linux vs Windows; no las separé. |
| 2 | **Las sedes no existen en los datos.** El selector Sede A/B es solo una bandera de interfaz. | `localStorage('tocineta_active_sede')`; la sede de un delivery se pega como texto en las notas del pedido. Ninguna tabla tiene `sede_id` ni hay almacenes. |
| 3 | **El ERP está a medias y concentrado.** Hay tablas y rutas de proveedores, clientes, compras, movimientos y nómina, pero todo vive en un dashboard de 1.560 líneas con 7 subpestañas, sin sede, sin sub-recetas y sin unidades de compra vs uso. | `ProfitabilityDashboard.tsx`, migración 0020, `/api/profitability/*`. |
| 4 | **Datos demo que parecen reales.** Proveedores inventados ("Frigorífico y Carnes San Félix", "Panificadora Industrial Guayana"…), "Socio Director", "Cliente Frecuente 1" y costos estimados inventados. | Seeds + capturas. Con la dueña mirando, esto es peor que una pantalla vacía. |
| 5 | **El catálogo tiene precios correctos pero descripciones inventadas.** Ejemplo: el afiche dice que la Miami lleva triple carne, cebolla smash, triple queso americano, pepinillos y smoked mayo; el sistema dice "Carne smash, queso cheddar, papitas al hilo, salsa de ajo". | `seed-catalog.ts` vs afiche. El sistema tiene Agua Mineral 500 ml, que no está en el afiche. |
| 6 | **El estilo es un parche sobre parche.** 13 `!important`, hex fijos repetidos (`bg-[#121620]` 31 veces), tres sistemas de color a la vez, y una paleta ámbar y azul que no es la de la marca. | `index.css` y grep. El manifest usa `theme_color #005A9C` (azul). La marca real es amarillo (#F8F800 en el logo), rojo oscuro (#981010) y negro; el afiche usa #F8E838, naranja #F89800 y rojo #E00808. |
| 7 | **Pantallas gigantes.** `CashierView` 2.179 líneas, `PosComandero` 2.018, `ProfitabilityDashboard` 1.560, `MenuAdminView` 1.496. | `wc -l`. No se pueden mantener ni probar. |
| 8 | **"Más imagen, menos letra" no se cumple.** En celular hay una tarjeta por fila, enorme, con un monograma gris "BD" en lugar de foto. | Capturas. |
| 9 | **Hay vistas que se caen** ("MÓDULO TEMPORALMENTE NO DISPONIBLE" en Personal y en Carta). | Capturas del 26/10 18:59; el código posterior puede haberlo cambiado. La F0 lo comprueba. |
| 10 | **Instalar la app no puede funcionar hoy.** El manifest apunta a `/icon-192.png` y `/icon-512.png`, que no existen en `public/`. Además la app se abre por `http://192.168.x.x`, y una PWA exige HTTPS. | `public/` solo tiene `manifest.webmanifest` y `sw.js`. Tu captura: "No se puede instalar esta app". |
| 11 | **El login está mejor de lo que supuse y peor de lo que debe.** Tiene bloqueo por intentos y cambio obligatorio de PIN. Pero busca por usuario, nombre **o rol** (ambiguo con dos meseros) y las claves iniciales son públicas. | `routes/auth.ts`, informe R1. |
| 12 | **Cosas que sí están bien y se conservan:** motor de dinero en enteros, concurrencia optimista, cola de impresión, cola offline de pedidos (`outbox.ts`), cierre Z encadenado, respaldos cifrados. | Código y pruebas de `shared`. |
| 13 | **Higiene del repo.** El .rar trae `.env`, respaldos `.db`/`.age` y decenas de cierres Z de prueba. | Listado del .rar. Revisa que no estén en GitHub. |

## 2. Decisiones de dirección

**D1 · Arquitectura de sedes: un solo servidor (hub) y la sede como dato.** Se descarta sincronizar dos servidores, porque es lo más caro y frágil. El servidor del tráiler es la única fuente de verdad. Todo registro lleva `sede_id`. La Sede A, que hoy no tiene computadora, trabaja desde celulares conectados al hub. La cola offline que ya existe guarda los pedidos si se cae la conexión.

- Costo: depende de cómo se exponga el hub (ver D2). Hoy no hay presupuesto para VPS y no hace falta.
- Riesgo real: si el PC del tráiler está apagado, Sede A y la vista remota no funcionan. Si cae el internet del tráiler, el tráiler sigue operando y A queda en cola. **Esto hay que validarlo con la dueña** (horario del PC, UPS).
- Puerta abierta: los IDs y `sede_id` se diseñan ahora para poder pasar a sincronización o nube cuando tengan Starlink y un PC en Sede A.

**D2 · Acceso remoto gratis y HTTPS.** Un túnel saliente al servidor del tráiler da vista remota para la dueña y HTTPS para instalar la app. Opciones a validar antes de comprometerse:

- Cloudflare Tunnel: gratis, pero un nombre estable requiere un dominio (del orden de US$10 al año; verifica el precio vigente).
- Tailscale: **no lo recomiendo sin revisar la licencia**: el plan gratuito Personal declara que no es para uso comercial, y las fuentes que encontré no coinciden sobre la disponibilidad de Funnel.
- Mientras no haya HTTPS: acceso por QR a la IP local y "Agregar a pantalla de inicio". Es un acceso directo, no una instalación completa.

**D3 · Diseño.** Mobile-first a 390 px, claro por defecto, colores de la marca, íconos Lucide (cero emojis), fotos en vez de texto, flujos "Siguiente". La pantalla de inicio de la dueña sigue la lógica de Treinta: 4 o 5 acciones grandes y los números del día.

**D4 · Usuarios.** Individuales y creados por la dueña. Los perfiles genéricos solo existen como semilla de instalación y se les obliga a cambiar la clave.

**D5 · Costos e inventario.** Descuento por receta por defecto (como prefiere la dueña), con plato terminado opcional. Costo promedio ponderado con último costo visible. Compra y consumo en unidades distintas con conversión. Sub-recetas para preparaciones (salsas, cebolla caramelizada). El precio de venta **solo cambia si la dueña lo confirma**, y entonces se propaga a carta, comandero y ticket.

**D6 · Datos.** Producción nace sin datos demo. Catálogo con las descripciones del afiche. Costos vacíos hasta que la dueña los cargue; un asistente de carga inicial (manual y por archivo) deja todo listo para cuando ella envíe la información.

**D7 · Reglas de negocio ya definidas.** Tasa BCV del día siguiente desde las 6 PM (hora configurable). Sin factura fiscal: nota de entrega, con IVA e IGTF apagados por defecto como ajustes. Propinas repartidas entre meseros. Nómina completa pero opcional.

**D8 · Un módulo que no funciona no se muestra.** Nada de "próximamente". Se oculta con bandera hasta que sea real.

## 3. Qué es realista para el 28/10

Hoy es 26. En dos días **no** se hace todo. Mi compromiso para el 28:

- F0: congelar, reparar pruebas y auditar (hoy).
- F1: sistema de diseño, login, cabecera, menú, Inicio y Tomar Pedido con fotos y pasos (27/10).
- F2: cobro en 3 pasos, caja, cierre y cocina con el nuevo estilo (28/10 mañana).

La dueña va a pedir contabilidad, inventario y costos: esos son F3 a F5. **Dile desde ya que el 28 es el núcleo operativo rehecho y que la parte financiera viene en las fases siguientes**, con fechas. Es mejor que descubrirlo en la demo.

## 4. Reglas de proceso (Definition of Done)

Una fase no se cierra si falla cualquiera de estas:

1. `pnpm -r run lint` y `pnpm -r run build` con 0 errores.
2. `pnpm -r run test` con 0 fallas. Una prueba omitida lleva comentario con el motivo. **No se borran pruebas para pasar.**
3. `pnpm run guard` en verde: falla si hay `!important`, colores hex en TSX, `text-white` fuera de `ui/`, emojis como íconos o pantallas nuevas de más de 400 líneas.
4. Capturas de cada pantalla tocada a 390×844 y 768×1024, en claro y en oscuro.
5. Matriz botón → endpoint → tabla actualizada (cada botón visible hace algo real o no se muestra).
6. **Informe de fase en formato fijo** (el agente no escribe prosa de victoria): comandos con su salida, archivos tocados, capturas, qué NO se hizo, riesgos.
7. Tu checklist probado en el celular. Sin tu visto bueno no se arranca la siguiente fase.
8. Un tag de git por fase para poder volver atrás.

## 5. Fases

| Fase | Contenido | Duración estimada del agente |
| --- | --- | --- |
| F0 | Congelar, higiene, reparar pruebas, auditoría con evidencia | 2–3 h |
| F1 | Tokens, componentes, guardia, cabecera/menú, login, PWA, Inicio, Tomar Pedido | 1 día |
| F2 | Cobro en 3 pasos, caja y cierre, cocina | 1 día |
| F3 | Sedes como dato, inventario, recetas, compras, costos, mermas, carga inicial | 2–3 días |
| F4 | Envíos entre sedes, lotes, delivery desde A o B, panel remoto de la dueña | 2–3 días |
| F5 | Finanzas estilo Treinta: gastos, por cobrar, por pagar, utilidad, reportes | 2 días |
| F6 | Personal, permisos, nómina, cena fija, propinas | 2 días |
| F7 | Cotizador, socios, menú QR, configuración del negocio, endurecimiento final | 2 días |

Las duraciones son estimaciones mías; el agente ya demostró que puede "terminar" rápido sin que funcione, así que el criterio es el Definition of Done, no el reloj.

---

# PROMPTS

Pégalos uno por uno, en orden. Cada uno termina con el informe de fase.

## Prompt F0 — Congelar, reparar y auditar

```text
FASE 0 — CONGELAR, REPARAR Y AUDITAR. NO SE AÑADE NINGUNA FUNCIÓN NUEVA.

Contexto: el sistema TOCINETA (monorepo pnpm: packages/shared, apps/server, apps/web) pasó por dos fases (R1, R2) que solo validaron con lint y build. Hoy las pruebas fallan (≈46 fallos, 143 omitidas en apps/server) y hay vistas que se caen. Antes de construir, hay que saber exactamente qué funciona.

1. CONGELAR
- Crea el tag git `pre-reconstruccion` en el commit actual y trabaja en la rama `reconstruccion`.
- Higiene: asegura que `.env`, `data/*.db`, `data/backups/`, `apps/server/data/**` y `logs/` estén en .gitignore y fuera del índice (`git rm --cached`, sin borrar archivos del disco). Reporta qué estaba versionado.

2. PROCESO
- Crea `docs/PROCESO.md` con el Definition of Done y el formato fijo de informe de fase (copiado de la sección "Reglas de proceso" del plan: lint, build, test, guard, capturas 390x844 y 768x1024 claro/oscuro, matriz, informe con comandos y salida, qué NO se hizo, riesgos, tag por fase).

3. REPARAR PRUEBAS (vitest SÍ se ejecuta en esta fase)
- Ejecuta `pnpm -r run test` y clasifica CADA fallo: A) prueba desactualizada por el cambio de usuarios/auth de R1; B) bug real del producto.
- Corrige las A actualizando las pruebas (crea un helper `loginAs(role)` común). Corrige las B en el código y documenta cada una.
- Meta: 0 fallos. Toda prueba omitida lleva un comentario con el motivo. PROHIBIDO borrar pruebas o debilitar aserciones para que pasen.
- Entrega `docs/auditoria/PRUEBAS.md` con la tabla fallo → clasificación → corrección.

4. AUDITORÍA PANTALLA POR PANTALLA
- Recorre todas las vistas montadas en App.tsx y todos los modales. Crea `docs/auditoria/MATRIZ.md` con columnas: Pantalla | Elemento (botón/campo) | Handler | Endpoint | Tabla.columna | Estado (OK / ROTO / ADORNO / DEMO) | Evidencia.
- Identifica exactamente qué vistas disparan el ErrorBoundary ("Módulo temporalmente no disponible"), con la causa y el stack.
- Instala Playwright y genera capturas de cada vista a 390x844 en modo claro y oscuro en `docs/auditoria/capturas/`. Si no se puede instalar Playwright, dilo y explica qué alternativa usaste.

5. DATOS DEMO Y DEUDA
- `docs/auditoria/DATOS-DEMO.md`: todo dato sembrado que parezca real (proveedores, clientes, empleados, repartidores, costos, descripciones de producto) y de qué seed viene.
- `docs/auditoria/DEUDA-UI.md`: conteo de `!important`, colores hex fijos, usos de text-white, emojis usados como íconos, archivos de más de 400 líneas.

REGLAS: no ejecutes nada destructivo sobre `data/tocineta.db` sin copia previa. No cambies diseño ni funciones. Entrega el INFORME DE FASE en el formato de docs/PROCESO.md, con la salida real de `pnpm -r run lint`, `pnpm -r run build` y `pnpm -r run test`.
```

**Tu checklist F0:** abre `MATRIZ.md` y confirma que no hay filas ROTO sin explicación; mira 5 capturas al azar; verifica que `pnpm -r run test` muestre 0 fallos.

## Prompt F1 — Sistema de diseño, cabecera, login, Inicio y Tomar Pedido

```text
FASE 1 — SISTEMA DE DISEÑO + SHELL + LOGIN + INICIO + TOMAR PEDIDO. Prerrequisito: F0 cerrada y tag `f0`.

PRINCIPIO: se reescribe la capa visual con componentes reutilizables. Se conserva toda la lógica de negocio existente (dinero en enteros, versión optimista de pedidos, outbox offline, impresión). PROHIBIDO usar `!important`, colores hex en TSX, `text-white`/`bg-black` fuera de `src/ui/`, emojis como íconos y archivos nuevos de pantalla de más de 400 líneas.

A) TOKENS Y TEMA
- `apps/web/src/styles/tokens.css`: variables CSS semánticas para claro (por defecto) y oscuro: surface, surface-alt, border, ink, ink-muted, primary, primary-ink, danger, success, warning, focus. Marca (derivada del logo y del afiche): amarillo #FFE600 (primario, texto encima #111111), rojo de marca #981010, naranja #F89800, tinta #111111. Mapea estos tokens en tailwind.config (bg-surface, text-ink, bg-primary…).
- Elimina TODAS las reglas de parche de index.css ("Blindaje…", denomination-btn, btn-solid-*, filtros globales) y migra los componentes a tokens. Cumple contraste WCAG AA (4.5:1 texto, 3:1 controles) en ambos temas.
- El tema se guarda por dispositivo; por defecto claro.

B) COMPONENTES en `apps/web/src/ui/`
Button (primary/secondary/danger/ghost, min-h 48px), Card, Field/Input/Select, Modal que en móvil es BottomSheet, WizardLayout (encabezado "Paso n de N", pie fijo con Atrás/Siguiente), Tabs/Chips desplazables, Badge, EmptyState, Toast, Money (USD grande, Bs pequeño), NumberPad táctil, Icon (solo lucide-react). Crea la ruta de desarrollo `/ui-kit` que muestra todos los componentes en claro y oscuro.

C) GUARDIA
`scripts/ui-guard.mjs` + `pnpm run guard`: falla ante `!important`, hex en TSX, `text-white` fuera de ui/, emojis en TSX, y archivos nuevos de features/** de más de 400 líneas. Engánchalo al script `lint`.

D) CABECERA Y MENÚ
- Cabecera de 56px con máximo 5 elementos: botón menú, logo + nombre del negocio (leído de business_settings), título de la pantalla, conmutador Básico/Pro (solo admin), chip de tasa BCV (editable por admin). Debe verse completa a 360px sin truncar el título.
- Menú lateral: módulos por modo (Básico: Tomar Pedido, Cocina, Caja y Cierre, Inventario rápido; Pro: el resto) SOLO si el módulo está realmente implementado (bandera por módulo; los incompletos no se muestran). Pie: tema claro/oscuro, sede activa, Instalar aplicación, Cerrar sesión.
- El banner de versículos sale de la parte superior: pasa a Ajustes > Mensaje del día (apagado por defecto).

E) LOGIN
- Usuario + contraseña en texto (botón mostrar/ocultar). Perfiles rápidos tocables SOLO si el dueño los activa en ajustes. La búsqueda es por `username` exacto (insensible a mayúsculas), nunca por nombre o rol. Mantén bloqueo por intentos. Primer inicio con clave semilla obliga a cambiarla. Quita las claves semilla de cualquier documento.
- Logo: usa los archivos de /apps/web/public/brand/ (te los pasa el usuario). Genera versiones con fondo transparente con relleno por inundación desde las esquinas (NO umbral global: perforaría ojos y boca de la carita). En superficies claras usa carita + "TOCINETA" rojo; la versión con "SONRÍE" blanco solo sobre fondo oscuro.

F) PWA
- Genera icon-192.png e icon-512.png (maskable) desde la carita, corrige el manifest (theme_color de marca) y el service worker de shell.
- Endpoint `/api/system/access-info` y pantalla `/acceso` con QR de la URL local para que los celulares entren sin escribir IP.
- Botón Instalar: usa `beforeinstallprompt` si existe; si no, muestra guía de 2 pasos. Si la página no es un contexto seguro (HTTP por IP), dilo claramente en la guía: "Instalación completa disponible cuando el sistema use HTTPS". No prometas lo que el navegador no permite.

G) INICIO (solo admin; los demás roles aterrizan en su pantalla)
Tarjetas grandes de acción (Tomar pedido, Cocina, Caja) y números del día (ventas de hoy, pedidos, efectivo esperado en caja) con los endpoints que ya existen. Sin datos inventados.

H) TOMAR PEDIDO — asistente de 3 pasos (reescribe PosComandero en módulos de ≤400 líneas: hook usePosCart + un componente por paso)
- Paso 1 Cliente y canal: "Nombre y apellido" obligatorio (≥3 caracteres, error claro en el campo), con autocompletado de clientes previos. Tres tarjetas grandes: Comer aquí (mapa táctil de mesas libres/ocupadas, configurable), Para llevar, Delivery (sede de salida, teléfono, dirección, zona, repartidor).
- Paso 2 Catálogo: pestañas de categoría desplazables, búsqueda, grilla de 2 columnas, tarjeta con foto 4:3, nombre, precio USD grande y Bs pequeño. Un toque agrega 1; en la tarjeta aparecen − y + cuando ya está en el pedido. Personalizar abre un BottomSheet con chips (Sin cebolla, Sin pan, Extra carne). Barra inferior fija: "N platos · $X · Siguiente".
- Paso 3 Revisión: lista editable, notas, cupón, y los botones Enviar a caja / Cobrar ahora (el cobro actual se mantiene hasta F2).
- Fotos: usa `products.image_url`. Si no hay foto, tarjeta con fondo de marca y nombre del plato en grande (nunca el cuadro gris con monograma). Agrega en la administración de la carta la carga de foto por producto, y un script `pnpm run import:photos` que asigne imágenes de `apps/web/public/menu/<slug>.jpg`.
- Corrige las descripciones del catálogo semilla para que coincidan con el afiche oficial (te lo pasa el usuario en docs/referencia/). Quita Agua Mineral y los demás productos que no estén en el afiche, o márcalos inactivos.

CRITERIOS DE CIERRE: lint, build, test y guard en verde; capturas 390x844 y 768x1024 de login, inicio, cabecera+menú, los 3 pasos de Tomar Pedido, /ui-kit (claro y oscuro); nadie puede avanzar sin nombre y apellido; ningún texto ilegible en claro u oscuro. Entrega el INFORME DE FASE en el formato de docs/PROCESO.md.
```

**Tu checklist F1 (en tu celular):** entra por el QR; el título de la cabecera se lee completo; el menú abre y cierra; no puedes avanzar sin nombre; ves 4 o más platos a la vez; las fotos o tarjetas de marca se ven bien; el modo oscuro también; ningún botón tiene letras invisibles.

## Prompt F2 — Cobro en 3 pasos, caja, cierre y cocina

```text
FASE 2 — COBRO EN 3 PASOS + CAJA + CIERRE + COCINA. Prerrequisito: F1 cerrada y tag `f1`. Aplican las mismas prohibiciones de F1 (sin !important, sin hex en TSX, sin emojis como íconos, pantallas ≤400 líneas) y se usan SOLO los componentes de src/ui/.

A) PaymentWizard (reemplaza MultiMethodCalculator.tsx; conserva las funciones de dinero de packages/shared, el vuelto mixto y las alertas antifraude de referencias)
- Paso 1 Resumen: platos, nombre del cliente, total en USD y Bs a la tasa vigente, cupón/descuento (si supera el límite configurable pide PIN de un autorizador).
- Paso 2 Método de pago: tarjetas grandes para Efectivo USD, Efectivo Bs, Pago móvil (referencia obligatoria), Punto Ubii, Binance y Crédito (por cobrar; exige cliente y permiso). Se pueden sumar varios pagos; siempre se muestra "Falta $X". NumberPad propio (no el teclado nativo), billetes rápidos $1/$5/$10/$20/$50/$100 como botones secundarios y botón "Exacto".
- Paso 3 Vuelto y cierre: vuelto en tamaño gigante (USD y Bs), botón "Finalizar e imprimir". Si está deshabilitado, muestra el motivo en texto visible.
- Un único mapa `paymentLabels` en español (Efectivo dólares, Efectivo bolívares, Pago móvil, Punto de venta, Binance Pay, Crédito). Prohibido mostrar códigos técnicos (CASH_USD, etc.).

B) CAJA (divide CashierView.tsx en módulos ≤400 líneas)
- Tres pestañas: Por cobrar / Ventas del día (reimprimir y anular con PIN y motivo) / Cierre. Gastos de caja chica con categoría.
- Apertura de turno con fondo inicial registrado.

C) CIERRE DE CAJA
- Asistente de 3 pasos: resumen del día por método, conteo físico (USD y Bs) con diferencia en vivo (exacto/sobrante/faltante) y observaciones, confirmación con Cierre Z impreso y exportación PDF y Excel.
- Ajuste de la dueña en business_settings: arqueo ciego activado/desactivado (por defecto guiado).
- Conserva la inmutabilidad y el encadenamiento SHA-256 del cierre.

D) COCINA (KDS)
- Rehacer visualmente con los componentes: tarjetas grandes, nombre del cliente destacado, semáforo de tiempos con tokens, filtro por estación, acciones de 1 toque.

E) ERRORES
- El ErrorBoundary deja de mostrar "Módulo temporalmente no disponible". Muestra un mensaje accionable (reintentar, volver) y registra el error en una tabla `client_errors` con vista y stack, visible para admin.

F) PRUEBAS
- Pruebas unitarias de la máquina de estados del wizard; prueba de integración de pago mixto con vuelto; flujo Playwright en 390x844: pedido → cobro mixto → cocina → cierre.

CRITERIOS DE CIERRE: Definition of Done completo y capturas de los 3 pasos del cobro, caja, cierre y cocina en claro y oscuro. Entrega el INFORME DE FASE en el formato de docs/PROCESO.md.
```

**Tu checklist F2 (en tu celular):** cobra un pedido mixto (efectivo USD + pago móvil) con vuelto; todos los botones se leen; no aparece ningún código técnico; haz un cierre completo y descarga el PDF; la cocina se entiende a un metro de distancia.

## Prompt F3 — Sedes como dato, inventario, recetas, compras, costos y mermas

```text
FASE 3 — SEDES COMO DATO + INVENTARIO + RECETAS + COMPRAS + COSTOS + MERMAS. Prerrequisito: F2 cerrada y tag `f2`. Mismas prohibiciones y Definition of Done. Todo dinero en enteros; todo cambio de stock es un movimiento inmutable dentro de una transacción.

A) SEDES
- Tabla `locations` (id, nombre editable, tipo producción/venta/mixta, activa), sembrada con "Sede A: Los Olivos" y "Sede B: Alta Vista". Agrega `location_id` a pedidos, turnos/jornadas, movimientos de stock, gastos, entregas y compras. Migración que asigna lo existente a Sede B. Cada usuario tiene sede por defecto y sedes permitidas.
- El selector de sede vive en el menú. Todo reporte filtra por sede o "todas".

B) INSUMOS
- Unidad de compra (paquete, caja, kg), unidad de uso (und, g, ml), factor de conversión, stock mínimo, categoría, costo promedio ponderado y último costo. Stock por (insumo, sede) derivado de movimientos: entrada, consumo por venta, merma, ajuste, transferencia.

C) RECETAS
- Tres modos por producto, elegibles por la dueña: por unidades, por gramaje con % de merma de cocción, y plato terminado (descuenta stock del producto).
- Sub-recetas (preparaciones con rendimiento, p. ej. una salsa que rinde 2 litros) y modificadores que suman o restan insumos (Sin pan, Extra carne, Sin cebolla).
- Al facturar se descuenta en la sede de la venta, en la misma transacción que cierra el pedido. Costo del plato en vivo, margen y precio sugerido según margen objetivo por categoría (editable).

D) COMPRAS (asistente)
- Proveedor, ítems en unidad de compra, costo, contado o crédito con vencimiento, sede destino.
- Alerta de variación de costo con el impacto en cada receta afectada. Dos botones: "Mantener precios de venta" y "Ajustar precios" (muestra precio actual → sugerido, editable por plato, con confirmación). El precio de venta NUNCA cambia sin confirmación; al confirmar se propaga a catálogo, comandero y tickets y queda en `price_history`.

E) MERMAS Y CONTEO
- Merma: qué (insumo o plato), cantidad, valor automático editable, motivo, sede. Descuenta stock y resta de la utilidad.
- Conteo físico por sede con diferencias y ajuste con motivo.

F) CARGA INICIAL Y DATOS LIMPIOS
- Asistente "Configura tu negocio": insumos → proveedores → recetas → costos → stock inicial, con carga manual y por Excel/CSV (plantilla descargable) y exportación. Todo editable después.
- La base de producción nace sin datos demo: elimina los seeds de proveedores, clientes, empleados y costos inventados. Comando `db:init-prod` para producción y `db:seed-demo` para demos, con todo marcado "DEMO" en pantalla.

G) REFACTOR
- Divide ProfitabilityDashboard.tsx en pantallas separadas (Inventario, Compras, Recetas, Mermas), cada una ≤400 líneas.

PRUEBAS: costo promedio ponderado, conversión de unidades, descuento por receta con modificadores y sub-recetas, stock por sede, precio solo cambia con confirmación, y que dos ventas simultáneas no dejen stock inconsistente.

CRITERIOS DE CIERRE: Definition of Done + capturas de cada pantalla + los datos reales de 3 recetas de prueba que dará el usuario cargados por el asistente. Entrega el INFORME DE FASE.
```

**Tu checklist F3:** carga 3 recetas reales con gramajes; registra una compra donde suba el costo de la carne y confirma que te muestra el impacto y NO cambia el precio de venta hasta que lo aceptas; registra una merma; haz un conteo físico y mira el ajuste.

## Prompt F4 — Envíos entre sedes, delivery, panel remoto

```text
FASE 4 — ENVÍOS ENTRE SEDES + DELIVERY POR SEDE + PANEL DE LA DUEÑA + ACCESO REMOTO. Prerrequisito: F3 cerrada y tag `f3`. Arquitectura decidida: un solo servidor (hub) con `location_id` en los datos; NO se implementa sincronización entre servidores.

A) ENVÍO ENTRE SEDES (asistente)
- Origen y destino. Tres modos: (1) por equivalente de platos (ej. 30 hamburguesas + 50 perros → el sistema calcula y muestra la lista de insumos desde las recetas, editable antes de confirmar); (2) por insumo suelto; (3) lotes preconfigurados con nombre (crear, editar, borrar, usar en 1 toque).
- Confirmar crea una nota de despacho con número consecutivo, imprimible y compartible por WhatsApp (PDF/imagen), resta en origen y suma en destino en una sola transacción. Opción configurable de estado "en tránsito" con recepción confirmada en destino. Si el origen no tiene stock suficiente avisa y permite forzar solo con motivo y PIN.

B) DELIVERY POR SEDE
- La sede de salida es un dato real y descuenta el stock de esa sede. Repartidores por sede, configurables. Conserva la liquidación existente.

C) PRODUCCIÓN EN SEDE A (opcional, con bandera)
- Registrar producción: N unidades de una sub-receta o plato terminado → descuenta insumos y suma stock del producto o preparación.

D) PANEL DE LA DUEÑA (celular)
- Vista rápida: ventas de hoy por sede, caja, stock bajo, envíos recientes, por cobrar. Se actualiza en vivo con el canal de eventos existente. Indicador por dispositivo: En línea / Sin conexión · N pedidos en cola.

E) ACCESO REMOTO
- Prepara scripts y un runbook para un túnel saliente hacia el hub. NO instales ni contrates servicios de terceros sin confirmación del usuario: primero lista las opciones con su costo y limitaciones verificadas hoy.
- En acceso remoto: solo HTTPS, límite de intentos, sesión corta, registro de auditoría de accesos remotos.
- La PWA usada en Sede A debe encolar pedidos sin conexión con reintentos idempotentes (reutiliza las llaves de idempotencia existentes).

PRUEBAS: transferencia atómica con corte simulado a la mitad, idempotencia de reintentos, cola offline y reconexión, concurrencia de dos dispositivos.

CRITERIOS DE CIERRE: Definition of Done + capturas + un envío real de prueba "30 hamburguesas y 50 perros" mostrando el movimiento en ambas sedes. Entrega el INFORME DE FASE.
```

**Antes de F4, con la dueña:** confirmar horario y UPS del PC del tráiler, y si acepta pagar un dominio (aprox. US$10/año) para el túnel. Sin eso, F4 se construye pero el acceso remoto no se activa.

## Prompt F5 — Finanzas estilo Treinta

```text
FASE 5 — FINANZAS (ventas, gastos, por cobrar, por pagar, utilidad, reportes). Prerrequisito: F4 cerrada y tag `f4`. Referencia de experiencia: la app Treinta — acciones grandes, pocas pantallas, números claros.

A) GASTOS: registro rápido (monto, categoría configurable, método, sede, foto de comprobante opcional, recurrente opcional).
B) POR COBRAR: clientes con crédito (fiado, socios, eventos): saldo, abonos parciales en USD o Bs, vencimiento, estado de cuenta y recordatorio por WhatsApp con mensaje prellenado.
C) POR PAGAR: facturas de compra a crédito con vencimiento, alerta a 2 días y vencidas, abonos, buscador y filtros (pendientes, por vencer, vencidas, pagadas).
D) UTILIDAD: estado de resultados simple por período y sede: ventas − costo de ventas (según recetas reales) − mermas − gastos = utilidad. Ventas por método, categoría, hora y sede; ticket promedio; ranking de productos y la matriz de popularidad/margen ya existente. Cada venta conserva la tasa de su día; el histórico NO se revalúa.
E) FLUJO DE CAJA por método (USD efectivo, Bs, pagos digitales) y por sede.
F) INICIO DE LA DUEÑA: 5 números configurables (por defecto: ventas de hoy, utilidad estimada de hoy, efectivo en caja, por cobrar, por pagar).
G) EXPORTAR a PDF y Excel; cierre mensual.

PRUEBAS: la suma de ventas coincide con la suma de pagos; utilidad = fórmula; sin doble conteo de mermas ni de compras; abonos parciales; vencimientos.

CRITERIOS DE CIERRE: Definition of Done + reporte de un día de datos de prueba cuadrado a mano contra la caja. Entrega el INFORME DE FASE.
```

**Antes de F5, con la dueña:** pídele que diga con sus palabras qué es "contabilidad" para ella (¿libro de ventas, ganancias, deudas, impuestos?) y cuáles son los 5 números que mira cada noche.

## Prompt F6 — Personal, permisos y nómina

```text
FASE 6 — PERSONAL, PERMISOS Y NÓMINA (módulo completo, activable por la dueña). Prerrequisito: F5 cerrada y tag `f5`.

A) USUARIOS: la dueña crea empleados con nombre real, usuario individual y rol; elimina la dependencia de perfiles genéricos (siguen existiendo solo como semilla de instalación con cambio obligatorio de clave). Permisos configurables por rol y por persona (cobrar, anular, editar carta, ver costos, ver ganancias). Costos y utilidades visibles solo para quien tenga el permiso.
B) TRAZABILIDAD: cada pedido, cobro, anulación, descuento y merma guarda quién lo hizo.
C) NÓMINA (bandera en Ajustes): esquema por persona (diario, semanal o quincenal) y monto base; bonos; adelantos; cuenta del empleado con consumos. Cena fija configurable por la dueña (si está activa, su costo es gasto de personal del local y no se descuenta). Liquidación: Neto = base + bonos − adelantos − consumos adicionales, donde la dueña elige cuáles consumos cobrar o perdonar antes de emitir. Recibo en PDF.
D) PROPINAS: pool configurable entre los meseros del turno (reparto igual o por horas), con registro y cierre.

PRUEBAS: cálculo de liquidación con adelantos y consumos, permisos denegados, trazabilidad, propinas.

CRITERIOS DE CIERRE: Definition of Done + capturas + una liquidación de ejemplo revisada a mano. Entrega el INFORME DE FASE.
```

## Prompt F7 — Cotizador, socios, menú QR, configuración y endurecimiento final

```text
FASE 7 — COTIZADOR + SOCIOS + MENÚ QR + CONFIGURACIÓN DEL NEGOCIO + ENDURECIMIENTO. Prerrequisito: F6 cerrada y tag `f6`.

A) COTIZADOR DE EVENTOS conectado a la carta real: cantidades por plato, descuento por volumen (% o precio especial), costos extras (traslado, personal, descartables), simulador PRIVADO de utilidad (precio cotizado vs costo real de insumos), PDF o WhatsApp para el cliente SIN costos internos, y botón "Convertir en reserva" que calcula la lista de compras necesaria.
B) SOCIOS: aportes, retiros a cuenta de utilidades y reparto por porcentaje; solo si la dueña activa el módulo.
C) MENÚ DIGITAL QR/WEB: revisar el módulo existente (qr-menu); debe leer la carta real, con fotos, y ocultar lo agotado.
D) CONFIGURACIÓN DEL NEGOCIO (producto reutilizable para otros restaurantes): nombre, logo, colores, RIF, dirección, eslogan, sedes, impuestos (IVA/IGTF apagados por defecto), hora de cambio de tasa, mensajes de ticket. Todo se lee de configuración; cero nombres de cliente en el código. Asistente de primera instalación.
E) ENDURECIMIENTO: simulacro de restauración de respaldo documentado, rotación de claves semilla, revisión de permisos, prueba de apagón (corte durante cobro e impresión), pruebas de carga con 5 dispositivos simultáneos, manuales de 1 página por rol dentro de la app, acta de aceptación.

CRITERIOS DE CIERRE: Definition of Done + el simulacro de restauración ejecutado con éxito y documentado. Entrega el INFORME DE FASE.
```

## Qué necesito de ti antes de cada fase

- **Antes de F1 (hoy):** logos con fondo transparente (SVG o PNG) en `apps/web/public/brand/`, el afiche oficial en `docs/referencia/`, y fotos individuales de los platos si las tienes; si no, las recortamos de los afiches como solución temporal.
- **Antes de F3:** 3 recetas reales con gramajes (Texas Mex, Miami, Street Dog), sus costos de compra y las unidades en que compra cada insumo.
- **Antes de F4:** respuestas de la dueña sobre PC del tráiler (horario, UPS) y dominio.
- **Antes de F5:** qué significa contabilidad para ella y sus 5 números nocturnos.
- **Antes de F6:** esquema real de pago y la regla de la cena.
