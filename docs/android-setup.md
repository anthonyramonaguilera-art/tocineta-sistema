# GUÍA DE CONFIGURACIÓN DE CELULARES ANDROID (RED WI-FI SIN INTERNET)
**Proyecto:** Sistema Operativo Local Tocineta Sonríe  
**Cliente:** Tocineta Sonríe  
**Destinatarios:** Mesoneros, Cajeros y Personal de Cocina  
**Entorno de Red:** Router LAN Local en Food Truck (100% Offline / Sin Conexión WAN)  

---

## 1. EL RETO TÉCNICO EN DISPOSITIVOS ANDROID

Los dispositivos móviles modernos con Android cuentan con sistemas de detección de conectividad a Internet (servicios de sondeo hacia servidores de Google como `clients3.google.com` o `connectivitycheck.gstatic.com`).

Cuando el celular se conecta a la red Wi-Fi del Food Truck (que no tiene internet satelital ni cable módem), Android detecta que no hay salida exterior y realiza una de dos acciones perjudiciales:
1. **Conmuta automáticamente a Datos Móviles (4G/LTE/5G)**, ignorando la red Wi-Fi. Al ocurrir esto, el celular intenta buscar la IP local (ej. `http://192.168.31.50:3000`) a través de la antena celular de su operadora móvil (Movistar/Digitel/Movilnet), arrojando el error: *"No se puede acceder a este sitio web"*.
2. **Se desconecta por completo del Wi-Fi**, cerrando la comanda en curso.

Para garantizar una operación 100% estable durante todo el turno de servicio, **cada celular debe configurarse siguiendo los 4 pasos a continuación**.

---

## 2. PASO 1: DESACTIVAR ASISTENTE WI-FI Y CAMBIO INTELIGENTE

Este ajuste evita que el sistema operativo abandone la red local cuando detecta que no hay internet.

1. Abrir **Ajustes** (o **Configuración**) en el teléfono Android.
2. Ingresar en **Wi-Fi** (o **Internet y redes** -> **Wi-Fi**).
3. Tocar el menú de opciones (icono de tres puntos verticales `⋮` o la opción **Ajustes avanzados** / **Más ajustes** en la parte inferior).
4. Localizar y **DESACTIVAR** las siguientes opciones (el nombre varía según la marca del teléfono):
   - **Samsung:** Entrar en *Intelligent Wi-Fi* -> Desactivar **"Cambiar a datos móviles"**.
   - **Xiaomi / Redmi / POCO:** Entrar en *Asistente Wi-Fi* -> Desactivar **"Seleccionar las mejores redes automáticamente"** y **"Usar datos móviles para aumentar velocidad"**.
   - **Motorola / Pixel / Android Puro:** Entrar en *Preferencias de red* -> Desactivar **"Conexión a datos móviles automática si la red Wi-Fi es de mala calidad"**.
   - **Huawei / Honor:** Entrar en *Wi-Fi+* -> **Desactivar Wi-Fi+**.

---

## 3. PASO 2: CONECTAR AL WI-FI Y CONFIRMAR "MANTENER CONEXIÓN"

1. Encender el Wi-Fi del teléfono y seleccionar la red del Food Truck:
   - **SSID:** `Tocineta_FoodTruck` (o la red acordada).
   - **Contraseña:** *(Ingresar clave WPA2 del router)*.
2. Esperar entre 5 y 10 segundos tras la conexión.
3. Aparecerá una notificación del sistema en la barra superior o un diálogo emergente con el siguiente mensaje:
   > ⚠️ *"Esta red Wi-Fi no tiene acceso a internet."*  
   > *¿Deseas mantener la conexión Wi-Fi?*
4. **ACCIÓN OBLIGATORIA:**
   - Seleccionar **"SÍ"** o **"Mantener conexión"**.
   - Marcar la casilla **"No volver a preguntar para esta red"**.

> [!IMPORTANT]
> Si el usuario selecciona accidentalmente "No" o descarta la notificación, Android desconectará el Wi-Fi. Si esto ocurre, debe olvidarse la red y volver a conectarse desde cero para que el aviso vuelva a aparecer.

---

## 4. PASO 3: APAGAR TEMPORALMENTE DATOS MÓVILES (OPCIONAL/RECOMENDADO)

Para el personal de servicio durante el turno de atención:
- Deslizar hacia abajo la barra de notificaciones y **apagar el botón de "Datos Móviles"**.
- Esto garantiza que el 100% de las peticiones de pedidos y visualización se enruten exclusivamente a través del router del Food Truck hacia la laptop HP.

---

## 5. PASO 4: CREAR ACCESO DIRECTO EN PANTALLA DE INICIO (MODO KIOSCO ANDROID)

Para que los mesoneros y cocineros accedan a la interfaz de comanda como si fuera una aplicación nativa instalada (sin barra de direcciones de navegación que distraiga):

1. Abrir **Google Chrome** en el celular.
2. En la barra de direcciones, escribir la IP local del servidor y puerto:
   ```text
   http://192.168.31.50:3000
   ```
   *(Sustituir `192.168.31.50` por la IP asignada a la laptop según el dashboard).*
3. Comprobar que cargue la interfaz oscura con la marca **TOCINETA SONRÍE**.
4. Tocar el menú de tres puntos de Chrome (`⋮`) en la esquina superior derecha.
5. Seleccionar la opción **"Agregar a la pantalla principal"** (o **"Instalar aplicación"**).
6. Asignar el nombre: `Tocineta POS` y pulsar **Agregar**.
7. En la pantalla principal del celular aparecerá el icono con el logo de la tocineta. Al tocarlo, se abrirá a pantalla completa sin elementos distractores.

---

## 6. PRUEBA DE FUEGO EN SITIO (CHECKLIST DE MESONERO)

Antes de iniciar el servicio de venta, cada mesonero debe validar su teléfono:

| # | Verificación | Estado |
|---|---|:---:|
| 1 | Conectado a la red Wi-Fi del Food Truck con señal fuerte. | [ ] |
| 2 | Notificación "Mantener conexión sin internet" aceptada permanentemente. | [ ] |
| 3 | Datos móviles apagados durante el turno de ventas. | [ ] |
| 4 | Acceso web `http://192.168.31.50:3000` abre en menos de 1 segundo. | [ ] |
| 5 | El botón "Probar Pitido" en `/health` hace sonar la impresora térmica de cocina. | [ ] |
| 6 | Acceso directo fijado en la pantalla de inicio del teléfono. | [ ] |
