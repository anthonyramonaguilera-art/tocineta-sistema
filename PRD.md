# DOCUMENTO MAESTRO DE PRODUCTO Y REGLAS ESTRICTAS DE INGENIERÍA (PRD v2.0)
## Sistema Operativo Gastronómico Multi-Sede "TOCINETA"

### 1. REGLAS INQUEBRANTABLES DE GOBERNANZA (PROHIBICIONES ABSOLUTAS)
1. **CERO REFERENCIAS EXTERNAS O NOMBRES PERSONALES:** Queda terminantemente PROHIBIDO incluir en la interfaz, base de datos, migraciones, comentarios o código fuente las palabras: `"Olinelcys"`, `"Anthony"`, `"Carlos"`, `"Andrea"`, `"Valery"`, `"Treinta"`, `"Sonríe"`, `"Modo Dios"`, `"God Mode"` o `"Varons"`.
   - Marca única oficial en pantalla: **"TOCINETA"** acompañada de su logo oficial.
   - Perfiles operativos oficiales por defecto: **`ADMIN`**, **`CAJERA`**, **`MESERO`**, **`PLANCHA`**, **`DESPACHO`**.
2. **CERO MÓDULOS FALSOS O PLACEHOLDERS:** Queda PROHIBIDO mostrar pantallas con textos como *"Módulo temporalmente no disponible"*, botones que no ejecutan ninguna acción real en SQLite, o formularios estáticos de adorno. Todo botón visible DEBE tener persistencia real en base de datos, validación y retroalimentación visual.
3. **DISEÑO 100% TOUCH / MOBILE-FIRST Y FLUJO "SIGUIENTE ➔ SIGUIENTE":**
   - Aunque el sistema opere en una laptop táctil o PC, toda la interfaz debe lucir y comportarse como una **Aplicación Nativa Móvil / Tablet**.
   - Se priorizan los asistentes guiados paso a paso (**"Siguiente ➔ Siguiente"**) con botones táctiles grandes (`min-h-[52px]`) por encima de pantallas saturadas de formularios y scroll interminable.
4. **MODO CLARO POR DEFECTO Y CONTRASTE SEMÁNTICO PERFECTO:**
   - El sistema inicia por defecto en **MODO CLARO (`light`)**.
   - Queda PROHIBIDO usar clases estáticas `text-white` o `bg-black` sin su par semántico de tema. En Modo Claro: fondo principal `#F8FAFC`, tarjetas `#FFFFFF` con borde `#E2E8F0`, texto primario `#0F172A` (negro pizarra de máximo contraste), texto secundario `#475569`, y acentos de marca (`#F59E0B` / `#EA580C`).

### 2. ARQUITECTURA DE NAVEGACIÓN Y CABECERA LIMPIA
1. **Pantalla de Inicio de Sesión:** Login profesional con **Usuario y Contraseña en texto** (más selector rápido táctil de perfiles genéricos `ADMIN`, `CAJERA`, `MESERO`, `PLANCHA`, `DESPACHO`), 100% adaptado a Modo Claro y Modo Oscuro.
2. **Aterrizaje Directo:** Al iniciar sesión, el usuario aterriza directamente en la vista operativa de **Tomar Pedido** (o **Plancha** si su rol es exclusivamente cocina), sin barras llenas de botones.
3. **Barra Superior Única (5 Elementos Máximo):**
   - Izquierda: `[☰ Menú]` (abre el Drawer lateral) + `Logo TOCINETA` + `[Título de la Pantalla Actual]`.
   - Derecha: Conmutador `[Modo Básico / Modo Pro]` (exclusivo para `ADMIN`) + Badge interactivo `[Tasa BCV: Bs. XX,XX]` (editable en 1 clic por `ADMIN`).
   - **Eliminados de la barra superior:** Botón *"En Línea"*, botón *"Pantalla Completa"* y botón *"Instalar App"*.
4. **Menú Lateral Desplegable (Drawer Unificado sin Duplicados):**
   - **En 🟢 Modo Básico (Operativo y Guiado):**
     1. `🍔 Tomar Pedido` (Mostrador, Mesas y Delivery unificados paso a paso)
     2. `🍳 Plancha y Cocina (KDS)` (Comandas en tiempo real)
     3. `💵 Caja, Cobros y Cierre del Día` (Cobros combinados y reporte Z)
     4. `📦 Inventario Rápido y Envíos entre Sedes` (Stock y traslados)
   - **En 🟣 Modo Pro (Herramientas Gerenciales):**
     5. `📋 Carta, Recetas y Precios` (Margen y costos de insumos)
     6. `📊 Centro Financiero, Compras y Mermas` (Utilidad real y balances)
     7. `🤝 Clientes por Cobrar, Proveedores y Socios` (Cuentas corrientes)
     8. `👥 Personal, Permisos y Nómina` (Aprobación de personal y sueldos)
     9. `🎉 Cotizador de Eventos y Empresas` (Presupuestos corporativos y WhatsApp)
     10. `🖨️ Impresoras, Respaldos y Talonario` (Térmicas, diagnósticos y copias de seguridad)
   - **Pie del Menú Lateral (Drawer Footer):**
     - Interruptor de Tema: `[☀️ Modo Claro / 🌙 Modo Oscuro]`
     - Botón `[📲 Instalar Aplicación en este Dispositivo]` (PWA con guía paso a paso)
     - Botón `[🚪 Cerrar Sesión]`

### 3. ARQUITECTURA MULTI-SEDE HÍBRIDA (SEDE A: LOS OLIVOS ⇄ SEDE B: ALTA VISTA)
1. **Sede A (`sede_los_olivos`):** Centro de producción, almacén principal, despacho de deliverys y facturación online/local.
2. **Sede B (`sede_alta_vista`):** Tráiler / Food Truck en Alta Vista (detrás de Torre Movistar) con venta directa, cocina en vivo y facturación.
3. **Operación Híbrida Local-First + Sincronización Online:** Cada sede opera a máxima velocidad contra su base de datos local SQLite sin depender de internet; cuando hay conexión disponible (fibra o Starlink), sincroniza automáticamente ventas, stock, transferencias y cierres entre ambas sedes.