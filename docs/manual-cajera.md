# MANUAL OPERATIVO DEL ROL: CAJERA
## Tocineta Sonríe Food Truck — Alta Vista, Puerto Ordaz
**Versión del Sistema:** POS 1.0 (Releases 1, 2 y 3)  
**Preparado por:** Anthony Aguilera — Dirección de Estrategia, Varons Media  
**Aprobado por:** Sra. Olinelcys España (Propietaria / Administradora)  
**Fecha de Publicación:** Octubre 2026  
**Formato:** Manual de Mostrador Listo para Imprimir  

---

## 1. APERTURA DE JORNADA Y SESIÓN DE CAJA

### 1.1. Inicio de Sesión
1. Diríjase a la pantalla principal del POS en el terminal de caja.
2. Seleccione su usuario (`Cajera Principal` u operador asignado).
3. Ingrese su **PIN confidencial de 4 dígitos** (por defecto `4321` o el asignado personalmente).
4. El sistema verificará su sesión de forma local sin requerir conexión a internet.

> **Regla de Seguridad:** Jamás comparta su PIN. Si sospecha que alguien conoce su código, solicite de inmediato el cambio a la Administradora (Sra. Olinelcys).

### 1.2. Verificación de Tasa Oficial BCV
- En la barra superior derecha verá la **Tasa Oficial BCV** activa para el turno (ej. `40.00 Bs/$`).
- Si la tasa en pantalla difiere de la publicada en la apertura por la Administradora, notifíquelo antes de facturar la primera orden.
- Todos los cálculos en Bolívares (Pago Móvil, Punto Ubii y vueltos) se sincronizan matemáticamente con esta tasa.

### 1.3. Conteo de Fondo Inicial de Caja
Al abrir su sesión de caja, el sistema le solicitará el conteo físico del fondo inicial (efectivo para dar cambio):
- Ingrese los **Dólares en Efectivo ($)** recibidos en el sobre de apertura.
- Ingrese los **Bolívares en Efectivo (Bs)** recibidos para cambio menudo.
- Presione **"Abrir Sesión de Caja"**. A partir de este momento la caja queda habilitada para emitir tickets y cobrar.

---

## 2. COBRO MULTIMÉTODO Y CALCULADORA DINÁMICA

El sistema de Tocineta Sonríe permite fraccionar el pago de una misma cuenta utilizando hasta 3 métodos combinados en segundos.

```
       ┌────────────────────────────────────────────────────────┐
       │             CALCULADORA MULTIMÉTODO                   │
       │  Total de la Orden: $15.00  /  Bs 600.00 (Tasa 40.00)  │
       ├────────────────────────────────────────────────────────┤
       │ [1] Efectivo USD ($)      ───> Ingrese: $ 5.00         │
       │ [2] Pago Móvil (Bs)       ───> Ingrese: Bs 240.00 ($6) │
       │ [3] Punto Ubii Débito (Bs)───> Ingrese: Bs 160.00 ($4) │
       ├────────────────────────────────────────────────────────┤
       │ RESTANTE POR COBRAR: $0.00 / Bs 0.00  ───> [ COBRAR ]  │
       └────────────────────────────────────────────────────────┘
```

### 2.1. Métodos de Pago Disponibles
1. **Efectivo en Dólares (`CASH_USD`):** Billetes de denominación $1, $5, $10, $20, $50, $100. (Revisar autenticidad de billetes de $50 y $100 con detector).
2. **Pago Móvil (`PAGO_MOVIL`):** En Bolívares a la cuenta oficial de Tocineta Sonríe. Es **obligatorio** tipear los últimos 4 a 6 dígitos de la referencia bancaria.
3. **Punto de Venta Ubii (`UBII`):** Tarjetas de débito nacional en Bolívares. Ingrese el número de recibo o lote emitido por el datáfono.

### 2.2. Validación Automática
- El botón **"Procesar Pago"** permanece bloqueado hasta que la sumatoria exacta de los montos ingresados cubra el 100% del total de la orden.
- Si el cliente paga de más en efectivo, la calculadora abrirá automáticamente la sección de **Vuelto**.

---

## 3. VUELTO MIXTO (USD / BOLÍVARES)

Debido a la escasez de billetes fraccionarios de $1.00 en Venezuela, el POS calcula de forma inteligente el vuelto en divisas y bolívares.

### Ejemplo Operativo Oficial:
- **Total de la Cuenta:** `$13.90` (ej. Combo Para Ti).
- **El cliente entrega:** Un billete de `$20.00 USD`.
- **Vuelto Total a Entregar:** `$6.10`.
- **Desglose Recomendado por el Sistema:**
  - **$6.00 USD** en billetes físicos (ej. 1 billete de $5 y 1 billete de $1).
  - **10¢ de Dólar** entregados en Bolívares a la tasa BCV:  
    `0.10 × 40.00 Bs/$ = 4.00 Bs en efectivo` (o mediante Pago Móvil vuelto si aplica).

### Registro en el Sistema:
1. En la casilla **Vuelto USD ($)** confirme: `6.00`.
2. En la casilla **Vuelto Bs** confirme: `4.00`.
3. Presione **"Entregar Vuelto y Finalizar"**.
4. Se abrirá la gaveta de dinero y se imprimirá el recibo para el cliente con el desglose exacto de lo entregado.

---

## 4. PROTOCOLO ANTIFRAUDE EN PAGO MÓVIL

Para proteger al Food Truck contra capturas bancarias duplicadas o editadas, el sistema cuenta con dos niveles automáticos de alerta:

| Nivel de Alerta | Condición Detectada | Acción del Sistema | Protocolo de la Cajera |
|---|---|---|---|
| **Nivel 1 (Bloqueo Total)** | Misma referencia bancaria **Y** mismo monto ya cobrado hoy | **BLOQUEO INMEDIATO (400)**. El sistema no permite cerrar la venta. | 1. Solicite el teléfono al cliente para ver el movimiento en la app bancaria en vivo.<br>2. Llame a la Supervisora o Administradora.<br>3. Solo la Supervisora puede autorizar el cobro ingresando su **PIN de 6 dígitos**. |
| **Nivel 2 (Advertencia Amarilla)** | Misma referencia bancaria pero con **distinto monto** | **ADVERTENCIA EN PANTALLA**. Requiere tilde de confirmación manual. | 1. Valide los últimos 4 dígitos contra el estado de cuenta oficial del negocio.<br>2. Marque la casilla *"He verificado el comprobante físico/bancario"*.<br>3. Proceda con el cobro. |

---

## 5. APLICACIÓN DE CUPONES ("CUPONES PARA TI")

El food truck cuenta con un motor de promociones y fidelización activable directamente en la comanda:

```
        ┌─────────────────────────────────────────────────────┐
        │  [🎟️ INGRESAR CÓDIGO DE CUPÓN]                     │
        │  Código: [ BIENVENIDA1 ]  ──> [ APLICAR ]           │
        ├─────────────────────────────────────────────────────┤
        │  ✓ Cupón Aplicado: -$1.00 USD Descuento             │
        │  Total Original: $6.90  ──> Total Final: $5.90      │
        └─────────────────────────────────────────────────────┘
```

### 5.1. Tipos de Cupones
1. **Cupón de Descuento en Dinero (`DISCOUNT`):**
   - **Monto Fijo:** Ejemplo `BIENVENIDA1` descuenta `$1.00` del total.
   - **Porcentaje:** Ejemplo `PARATI10` descuenta el `10%` sobre el subtotal de comida.
2. **Cupón de Producto de Cortesía (`COURTESY_ITEM`):**
   - Ejemplo `CAFEGRATIS`: Añade un café o bebida de obsequio.
   - Para el cliente, el cobro es de **+$0.00**.
   - En cocina, el ticket se imprime con el distintivo: `[OBSEQUIO CUPÓN - $0.00]`.
   - El sistema registra internamente el costo de $0.35 en la cuenta contable de Marketing sin afectar la ganancia de comida.

### 5.2. Reglas Estrictas de Cupones:
- **Un solo cupón por pedido:** El sistema rechazará con error si intenta ingresar un segundo código en la misma orden.
- **Cupones vencidos o agotados:** El sistema emite una alerta roja y no permite su aplicación.
- Para eliminar un cupón por error del cliente, presione el botón rojo **"Quitar Cupón"**.

---

## 6. MÓDULO DE DELIVERY Y LIQUIDACIÓN NOCTURNA DE MOTORIZADOS

Cuando un cliente solicita despacho a domicilio, la cajera gestiona el flujo de caja del repartidor.

### 6.1. Creación de Pedido con Despacho
1. En tipo de entrega seleccione **"Delivery"**.
2. Seleccione el motorizado de la lista desplegable (ej. *Carlos Mora*, *Jesús Salazar*).
3. Seleccione la tarifa plana según la zona:
   - **Zona 1 (Cercana):** `$2.00`
   - **Zona 2 (Media / Alta Vista extendida):** `$3.00`
   - **Zona 3 (Unare / Chilemex):** `$4.00`
   - **Zona 4 (San Félix / Periférico):** `$5.00`
4. **Cobro del Repartidor:**
   - Si el cliente pagó por Pago Móvil por adelantado, desmarque *"Efectivo en mano del motorizado"*.
   - Si el cliente pagará en efectivo al recibir el pedido, marque **"Efectivo recaudado por motorizado"**. El sistema llevará el saldo deudor del repartidor en tiempo real.

### 6.2. Liquidación Nocturna del Motorizado
Al finalizar la jornada o el turno del repartidor:
1. Diríjase a la pestaña **"Delivery y Motorizados"**.
2. Seleccione el nombre del motorizado y presione **"Ver Liquidación"**.
3. La pantalla le mostrará:
   - Cantidad de viajes realizados en la noche.
   - Total de tarifas ganadas por el motorizado (que le pertenecen a él).
   - Total de efectivo cobrado de las comidas que debe entregar a la caja.
   - **Monto Neto a Entregar en Caja ($ y Bs)**.
4. Reciba el dinero físico del motorizado, cuéntelo y presione **"Liquidar y Cerrar Repartidor"**.
5. Se imprimirá un ticket de liquidación con copia para el motorizado y copia para la caja.

---

## 7. ARQUEO CIEGO AL FINALIZAR EL TURNO

El sistema de Tocineta Sonríe utiliza un **Arqueo Ciego con Regla Anti-Tanteo** para garantizar la máxima transparencia en el cuadre de caja:

```
        ┌─────────────────────────────────────────────────────┐
        │                 ARQUEO CIEGO DE CAJA                │
        │          (No se muestran los saldos esperados)      │
        ├─────────────────────────────────────────────────────┤
        │  1. Efectivo Físico en Dólares ($): [ $ ______ ]    │
        │  2. Efectivo Físico en Bolívares:   [ Bs _____ ]    │
        │  3. Vouchers de Ubii en Punto:      [ Bs _____ ]    │
        ├─────────────────────────────────────────────────────┤
        │         [ ENVIAR CONTEO DE CIERRE DE TURNO ]        │
        └─────────────────────────────────────────────────────┘
```

### 7.1. Pasos para el Arqueo:
1. Guarde y asegure el área de caja al terminar el servicio.
2. Cuente todos los billetes de Dólares ($) que tiene en la gaveta.
3. Cuente todos los billetes de Bolívares (Bs) que tiene en la gaveta.
4. Sume los recibos/vouchers de tarjetas emitidos por el punto Ubii.
5. Ingrese los números en pantalla y presione **"Enviar Conteo"**.

### 7.2. ¿Qué ocurre si hay diferencia? (Regla Anti-Tanteo)
- El sistema **NUNCA** le dirá si sobra o falta dinero, ni por cuánto monto.
- Si los números coinciden exactamente con las ventas, la sesión se cerrará de inmediato con estado **OK**.
- Si existe alguna discrepancia, el sistema le indicará: **"SE REQUIERE RECONTEO CIEGO — Vuelva a contar su efectivo cuidadosamente"**.
- Se le permite **un único segundo conteo**. Al enviar el segundo conteo, la sesión se cerrará definitivamente y las diferencias quedarán asentadas en el reporte confidencial de la Administradora para su posterior revisión.

---

## 8. CAMBIO DE ROLLO TÉRMICO DE 58mm (IMPRESORA POS)

La impresora de tickets de caja utiliza rollos térmicos estándar de **58 milímetros** (sin tinta).

```
         CUBIERTA ABIERTA               ORIENTACIÓN DEL PAPEL
             \________                            __
              |      /                           /  \ 
              |  O  |                           | () |─── Salida del papel
              |_____|                            \__/     (Hacia el frente)
             [ PALANCA ]                     (Cara sensible arriba)
```

### Procedimiento de Cambio en 6 Pasos:
1. **Abrir la Cubierta:** Presione hacia abajo la palanca o botón lateral ubicado a la derecha de la impresora térmica. La tapa superior se destrabará y subirá.
2. **Retirar el Tubo Vacío:** Extraiga el cono o canuto de plástico residual del rollo anterior y deséchelo.
3. **Orientar el Nuevo Rollo:** Tome un rollo nuevo de 58mm. Asegúrese de que el papel se desenrolle **desde la parte inferior hacia el frente**, con la cara sensible y brillante mirando hacia el cabezal de impresión.
4. **Tirar del Extremo:** Desenrolle unos 3 a 5 centímetros de papel térmico de modo que sobresalga por fuera de la ranura de corte.
5. **Cerrar la Tapa:** Presione la tapa firmemente hacia abajo por el centro hasta escuchar un chasquido metálico (**"CLIC"**). No la deje a medio cerrar o la impresora marcará error de tapa abierta.
6. **Prueba de Avance (Feed):** Presione el botón **FEED** una sola vez. La impresora debe expulsar un par de centímetros de papel de forma suave y sin atascos.

> **¡Atención!** Nunca toque el cabezal térmico con los dedos inmediatamente después de una jornada intensa de trabajo; puede estar a alta temperatura.

---

### Registro de Firmas de Conocimiento del Personal de Caja:

| Nombre del Operador / Cajera | Cédula de Identidad | Firma | Fecha |
|---|---|---|---|
| __________________________ | _________________ | _________________ | ____/____/2026 |
| __________________________ | _________________ | _________________ | ____/____/2026 |
