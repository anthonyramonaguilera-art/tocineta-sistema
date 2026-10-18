# MANUAL OPERATIVO DEL ROL: MESONERO Y COCINA
## Tocineta Sonríe Food Truck — Alta Vista, Puerto Ordaz
**Versión del Sistema:** POS 1.0 (Releases 1, 2 y 3)  
**Preparado por:** Anthony Aguilera — Dirección de Estrategia, Varons Media  
**Aprobado por:** Sra. Olinelcys España (Propietaria / Administradora)  
**Fecha de Publicación:** Octubre 2026  
**Formato:** Manual de Operaciones Listo para Imprimir  

---

## PARTE I: GUÍA DEL MESONERO (ATENCIÓN EN MESAS Y POS MÓVIL)

---

### 1. CONEXIÓN WI-FI SIN INTERNET EN DISPOSITIVOS ANDROID

El sistema del Food Truck opera de forma **100% autónoma en red local (LAN)**. No requiere señal telefónica ni conexión a internet exterior.

```
       [ ROUTER LOCAL DEL FOOD TRUCK ]  ─── (Red Wi-Fi Local Privada)
                     │
       ┌─────────────┴─────────────┐
       ▼                           ▼
[ SERVIDOR CENTRAL ]      [ CELULARES ANDROID ]
 (Mini PC en Caja)         (Mesoneros en Mesas)
```

#### Paso a Paso para Conectar el Teléfono Android:
1. **Activar Wi-Fi:** Vaya a los Ajustes de su teléfono Android y active el Wi-Fi.
2. **Seleccionar la Red:** Conéctese a la red del negocio: `TocinetaSonrie_POS` (o el nombre asignado al router del food truck).
3. **Ingresar la Clave Wi-Fi:** Introduzca la contraseña de la red local suministrada por la Administradora.
4. **IMPORTANTE — Alerta de "Sin Conexión a Internet":**
   - A los pocos segundos, Android mostrará una notificación:  
     *“Esta red Wi-Fi no tiene acceso a internet. ¿Desea mantener la conexión?”*
   - **DEBE MARCAR:** **"Mantener siempre conectado"** (o *"No volver a preguntar"* y pulsar **"Sí"**).
5. **Recomendación Operativa:** Apague los Datos Móviles (4G/LTE) mientras esté de turno para evitar que el teléfono intente buscar páginas web fuera de la red local del food truck.
6. **Abrir el Sistema:**
   - Abra el navegador **Google Chrome**.
   - En la barra de direcciones escriba la IP local del servidor (ejemplo: `http://192.168.1.100:3000` o la guardada en sus marcadores).
   - Pulse en el menú de 3 puntos de Chrome y seleccione **"Añadir a la pantalla de inicio"**. De esta forma tendrá un icono directo con el logo de Tocineta Sonríe como una aplicación nativa.

---

### 2. TOMA DE PEDIDOS EN 1 TOQUE (FLUJO RÁPIDO)

La interfaz del mesonero está diseñada para registrar comandas con una sola mano en menos de 30 segundos.

```
  ┌────────────────────────────────────────────────────────┐
  │ 🍔 TOCINETA SONRÍE POS      [ Mesa: M-04 ] [ Carlos ]  │
  ├────────────────────────────────────────────────────────┤
  │ [ HAMBURGUESAS ]  [ PERROS CALIENTES ]  [ BEBIDAS ]    │
  ├────────────────────────────────────────────────────────┤
  │ ┌────────────────┐ ┌────────────────┐ ┌──────────────┐ │
  │ │ TEXAS MEX      │ │ AMERICANA      │ │ STREET DOG   │ │
  │ │ $6.90          │ │ $11.90         │ │ $2.50        │ │
  │ └────────────────┘ └────────────────┘ └──────────────┘ │
  │ 🛒 1x Texas Mex ($6.90)  ───> [ PERSONALIZAR / ENVIAR ]│
  └────────────────────────────────────────────────────────┘
```

#### Pasos para Crear una Comanda:
1. **Identificación:** Ingrese su PIN personal de 4 dígitos (ej. Carlos `2222`, Andrea `3333`).
2. **Ubicación:** Seleccione el número de mesa (ej. `Mesa 1`, `Mesa 2`, `Barra`) o elija `Para Llevar`.
3. **Nombre del Cliente:** Ingrese el nombre de la persona para llamarlo cuando la orden esté lista.
4. **Selección de Productos:** Toque una vez sobre el plato solicitado por el cliente. Si desea más de una unidad, vuelva a tocarlo o use los botones `+` y `-`.
5. **Revisión y Envío:** Verifique el resumen de la orden y presione el botón verde grande: **"ENVIAR A COCINA"**.
   - Al pulsar el botón, la orden se guarda en la base de datos central, viaja al KDS y las impresoras de tickets en cocina imprimen la comanda automáticamente.

---

### 3. PERSONALIZACIÓN DE INGREDIENTES Y MODIFICADORES

En Tocineta Sonríe el cliente puede personalizar su comida al detalle. El sistema dispone de selectores táctiles para que ningún detalle se le pase al cocinero.

#### 3.1. Modificador Especial: "Sin Pan / Envuelta en Lechuga"
- Diseñado para clientes que cuidan su dieta, no consumen carbohidratos o tienen intolerancia al gluten.
- Al activarse en la comanda:
  - En la pantalla de cocina y en el ticket impreso se destaca en texto resaltado:  
    `*** MODIFICADOR: SIN PAN / ENVUELTA EN LECHUGA ***`.
  - El cocinero sabe que no debe tostar pan brioche; en su lugar, envuelve los medallones de carne prime con queso fundido y vegetales en hojas de lechuga fresca crujiente.
  - El sistema registra automáticamente el ahorro del pan en el inventario técnico de insumos.

#### 3.2. Selección de "Barra Libre" ($0.00 para el cliente)
Todos los clientes de hamburguesas y perros tienen derecho a añadir los aderezos y complementos que deseen de la barra sin costo adicional:
- Salsa de Ajo Casera
- Maíz Dulce
- Papas Ralladas Tocineta
- Tocineta Crispy en Trozos
- Pepinillos Agridulces
- Cebolla Crispy

> **Operación:** En el modal de personalización, marque las casillas que el cliente desee. Al cliente se le facturan `$0.00` adicionales, garantizando la promesa de satisfacción de Tocineta Sonríe.

#### 3.3. Exclusiones ("Sin Cebolla", "Sin Salsas", etc.)
- Si el cliente no desea algún ingrediente base, selecciónelo en la lista de exclusiones. En la comanda aparecerá en negrita: `SIN CEBOLLA`, `SIN TÁRTARA`, `SIN MOSTAZA`.

---

## PARTE II: GUÍA DE COCINA Y KDS (PANTALLA DE DESPACHO)

---

### 4. LECTURA DE TICKETS POR ESTACIÓN DE TRABAJO

Para mantener la cocina ordenada y sin cuellos de botella en horas pico (8:00 p. m. a 10:30 p. m.), el sistema enruta los pedidos a dos impresoras térmicas independientes:

```
                      [ PEDIDO ENTRANTE ]
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
     ESTACIÓN HAMBURGUESAS            ESTACIÓN HOT DOGS
      (Plancha Principal)           (Baño de María / Perros)
     - Texas Mex                     - Street Dog
     - Doble Miami                   - Tocineta Dog Parmesano
     - Americana (4 Carnes)          - Doritos Dog Snacks
     - Smash Clásica                 - Salchicha Polaca
```

#### Reglas de los Tickets de Cocina:
1. **Sin la palabra "COMBO":**  
   Si el cliente pide un "Combo Clásico" o "Combo Para Ti", la impresora **NO imprime la palabra COMBO**. Cada plato y perro sale desglosado como una línea individual con sus propios modificadores. Así el cocinero solo ve lo que tiene que preparar físicamente sin hacer cálculos mentales.
2. **Productos de Cortesía:**  
   Si el cliente canjeó un cupón de cortesía, el ticket imprimirá:  
   `[OBSEQUIO CUPÓN - $0.00] NOMBRE DEL ÍTEM`.  
   Esto certifica que la cocina debe despacharlo con la misma calidad de siempre.
3. **Indicador de Estación:**  
   En la cabecera del ticket se indica claramente: `[ESTACIÓN: HAMBURGUESAS]` o `[ESTACIÓN: HOT DOGS]`, junto con el número de orden y la hora exacta de emisión.

---

### 5. USO DE LA PANTALLA TÁCTIL KDS (KITCHEN DISPLAY SYSTEM)

En la zona de despacho de cocina se encuentra la pantalla táctil KDS que muestra en tiempo real todas las comandas activas.

```
┌────────────────────────────────────────────────────────────────────────┐
│  KDS — PANTALLA DE COCINA                   Filtro: [ TODAS ] [ HAMB ] │
├────────────────────────┬───────────────────────┬───────────────────────┤
│ Orden #014  (Hace 2m)  │ Orden #015  (Hace 7m) │ Orden #016  (Hace 12m)│
│ Mesa: M-02  [SALÓN]    │ Para Llevar           │ Mesa: M-05  [SALÓN]   │
│ ────────────────────── │ ───────────────────── │ ───────────────────── │
│ 2x Texas Mex           │ 1x Americana          │ 3x Street Dog         │
│  - Sin Cebolla         │  - Sin Pan / Lechuga  │ 1x Doble Miami        │
│  - Barra Libre (Ajo)   │  - Barra Libre (Papas)│                       │
│                        │                       │                       │
│ [🟢 EN PREPARACIÓN]    │ [🟡 EN PREPARACIÓN]   │ [🔴 DEMORADA >10m]    │
│  Toque para avanzar     │  Toque para avanzar   │  ¡PRIORIDAD MÁXIMA!   │
└────────────────────────┴───────────────────────┴───────────────────────┘
```

#### 5.1. Código de Semáforo por Tiempo:
- 🟢 **Verde (< 5 minutos):** Orden recién llegada a cocina. Tiempo óptimo.
- 🟡 **Amarillo (5 a 10 minutos):** Orden en tiempo estándar de plancha. Mantener ritmo.
- 🔴 **Rojo (> 10 minutos):** Orden con retraso. **¡Prioridad máxima de ensamblaje y entrega!**

#### 5.2. Acciones Táctiles en Pantalla:
1. **Primer Toque:** Cambia la orden a estado **"En Preparación"** (avisa a los mesoneros que el plato ya está en plancha).
2. **Segundo Toque:** Cambia la orden a **"Listo para Despacho"** (emite un sonido y se envía a la mesa de pase para ser llevada al cliente).
3. **Filtro de Pantalla:** En la esquina superior puede filtrar para ver solo `Hamburguesas` o solo `Hot Dogs` según el puesto del cocinero.

---

### 6. GESTIÓN DE INCIDENTES EN COCINA (REPOSICIÓN "REFIRE")

Si durante el servicio ocurre un accidente (por ejemplo, una hamburguesa se cae al piso, se sobrecocina o el mesonero tropieza con la bandeja):

1. **NO oculte el incidente:** El sistema tiene un botón de **"Reposición Urgente (Refire)"**.
2. **Procedimiento:**
   - Llame de inmediato a la Supervisora de Turno.
   - La Supervisora ingresa su PIN de 6 dígitos en la pantalla y selecciona la razón: `PRODUCT_DROPPED` (Producto caído) o `KITCHEN_MISTAKE` (Error de cocción).
   - El sistema imprime de inmediato un **ticket prioritario de reposición** en la estación correspondiente con la marca:  
     `*** REPOSICIÓN URGENTE / RE-FIRE ***`.
   - La cocina prepara el plato nuevo de inmediato sin cobrarle nada adicional al cliente.
   - El sistema registra la pérdida como merma operativa de insumos, manteniendo las cuentas de caja y los inventarios 100% cuadrados.

---

### Registro de Firmas de Conocimiento del Personal de Cocina y Servicio:

| Nombre del Colaborador | Cargo / Estación | Cédula de Identidad | Firma |
|---|---|---|---|
| Carlos Mora | Mesonero | _________________ | _________________ |
| Andrea Pérez | Mesonero | _________________ | _________________ |
| Cocinero de Plancha | Plancha Hamburguesas | _________________ | _________________ |
| Cocinero de Perros | Estación Hot Dogs | _________________ | _________________ |
