# GATE G0: HOJA DE RUTA Y PROTOCOLO DE VALIDACIÓN FÍSICA EN FOOD TRUCK
**Proyecto:** Sistema Operativo Local Tocineta Sonríe  
**Cliente:** Tocineta Sonríe  
**Desarrollado por:** Varons Media  
**Fecha de Ejecución:** _____________________  
**Responsable Técnico:** _____________________  
**Ubicación:** Food Truck Tocineta Sonríe  

---

## 1. OBJETIVO DEL GATE G0
Validar empíricamente en el Food Truck la viabilidad física y de red de los componentes críticos antes de iniciar la construcción del software definitivo:
1. **Comunicación con Impresoras Térmicas de 58mm:** Impresora 1 (**DP58U-03**) e Impresora 2 (**MP583**).
2. **Canales de Comunicación:** Spooler RAW de Windows (USB) sin diálogo y TCP 9100 directo (LAN).
3. **Geometría de Impresión:** Ancho útil real (32 columnas estándar en Fuente A vs 42 columnas en Fuente B / 384 dots).
4. **Página de Códigos Ganadora:** Determinación del juego de caracteres exacto para español (`ñ`, `Ñ`, `á`, `é`, `í`, `Í`, `ó`, `ú`, `¡`, `¿`).
5. **Operatividad Wi-Fi sin Internet en Android:** Conexión estable de celulares de los mesoneros al servidor local sin desconexión automática por falta de salida WAN.

---

## 2. PREPARACIÓN PREVIA AL VIAJE (MALETÍN TÉCNICO)

| Ítem | Descripción | Verificado |
|---|---|:---:|
| 💻 **Laptop Servidor** | Windows 10/11 con Node.js 24 LTS, `pnpm`, repositorio clonado y herramientas probadas. | [ ] |
| 🔌 **Cargador Laptop** | Cable y fuente de poder de la laptop de desarrollo. | [ ] |
| 🖧 **Router Wi-Fi LAN** | Router 2.4 GHz / 5 GHz con DHCP configurado en rango `192.168.31.0/24`. | [ ] |
| 🔌 **Cables de Red** | 3 cables de red Ethernet RJ45 Cat 5e/6 (mínimo 2 metros cada uno). | [ ] |
| 🔌 **Cables USB** | 2 cables USB Tipo A a Tipo B (macho-macho) + adaptadores USB Mini/C si aplican. | [ ] |
| 📜 **Rollos Térmicos 58mm** | Mínimo 4 rollos de papel térmico de 58mm de ancho (diámetro 40-50mm). | [ ] |
| 📱 **Celulares Android** | 2 dispositivos Android representativos de los mesoneros con navegador Chrome instalado. | [ ] |
| ⚡ **Regleta / Multímetro** | Regleta eléctrica con supresor de picos y multímetro digital. | [ ] |

---

## 3. IDENTIFICACIÓN Y DIAGNÓSTICO FÍSICO DE HARDWARE

### 3.1. Impresora 1: DP58U-03 (Comanda / Cocina o Caja)
* **Número de Serie (S/N):** _______________________________________
* **Ubicación Física:** [ ] Cocina / Comanda  &nbsp;&nbsp;&nbsp; [ ] Barra / Caja
* **Interfaces Físicas Presentes:**
  - [ ] USB Tipo B
  - [ ] Ethernet RJ-45 (LAN)
  - [ ] Puerto RJ-11 (Apertura de cajón monedero, 12V/24V)
  - [ ] Wi-Fi Integrado
  - [ ] Bluetooth
* **Fuente de Poder:**
  - Voltaje nominal: ________ V DC (Común: 8.5V o 12V)
  - Amperaje: ________ A (Común: 2.0A a 3.0A)
  - Polaridad: [ ] Centro Positivo `(+)` &nbsp;&nbsp;&nbsp; [ ] Centro Negativo `(-)`
* **Mecanismo de Corte:**
  - [ ] Dientes manuales de sierra (Tear bar - requiere alimentación de avance)
  - [ ] Guillotina automática motorizada (Auto-cutter parcial o total)
* **Procedimiento Self-Test (Prueba Autónoma de Fábrica):**
  1. Apagar la impresora con el interruptor frontal/posterior.
  2. Mantener presionado el botón **FEED**.
  3. Encender la impresora sin soltar **FEED**.
  4. Esperar 2 segundos (o al escuchar el primer pitido) y soltar **FEED**.
  5. *Anotar datos del ticket impreso:*
     - Versión Firmware: _______________________________________
     - IP de fábrica: ___________________________________________
     - Baudrate / Emulación: ____________________________________
     - Tablas de caracteres disponibles: _________________________

---

### 3.2. Impresora 2: MP583 (Facturación o Comanda)
* **Número de Serie (S/N):** _______________________________________
* **Ubicación Física:** [ ] Cocina / Comanda  &nbsp;&nbsp;&nbsp; [ ] Barra / Caja
* **Interfaces Físicas Presentes:**
  - [ ] USB Tipo B / Mini USB
  - [ ] Ethernet RJ-45 (LAN)
  - [ ] Puerto RJ-11 cajón monedero
  - [ ] Wi-Fi Integrado
  - [ ] Bluetooth
* **Fuente de Poder:**
  - Voltaje nominal: ________ V DC &nbsp;&nbsp;|&nbsp;&nbsp; Amperaje: ________ A
* **Mecanismo de Corte:**
  - [ ] Dientes manuales de corte &nbsp;&nbsp;&nbsp; [ ] Guillotina automática
* **Self-Test de Fábrica:**
  - IP detectada: ___________________________________________
  - Firmware / Emulación: ____________________________________

---

## 4. TOPOLOGÍA DE RED LAN EN EL FOOD TRUCK (100% OFFLINE)

```
                     +---------------------------------------+
                     |         ROUTER WI-FI LOCAL            |
                     |         IP: 192.168.31.1              |
                     |         SSID: Tocineta_LAN            |
                     +---+-------------------+---------------+
                         |                   |
            +------------+                   +------------+
            | (Ethernet / Wi-Fi)                          | (Wi-Fi 2.4/5 GHz)
            v                                             v
+--------------------------+                 +--------------------------+
|     LAPTOP SERVIDOR      |                 |    CELULARES ANDROID     |
|   IP: 192.168.31.50      |                 |  (DHCP: 192.168.31.10X)  |
|   Port 3000 (HTTP)       |                 |  Navegador Web: Chrome   |
+--------------------------+                 +--------------------------+
            | (USB / LAN 9100)
            +---------------------------+
            |                           |
            v                           v
+-----------------------+   +-----------------------+
|  IMPRESORA 1 (DP58U)  |   |  IMPRESORA 2 (MP583)  |
|  USB / 192.168.31.200 |   |  USB / 192.168.31.201 |
+-----------------------+   +-----------------------+
```

### Plan de Asignación de Direcciones IP:
| Dispositivo | Interfaz | Dirección IP | Puerto | Rol |
|---|---|---|:---:|---|
| **Router LAN** | Gateway | `192.168.31.1` | - | Enrutador local, DHCP server |
| **Laptop Servidor** | Ethernet / Wi-Fi | `192.168.31.50` | `3000` | Servidor Node.js 24 + CLI |
| **Impresora DP58U-03** | Ethernet / USB | `192.168.31.200` | `9100` | Comanda / Cocina |
| **Impresora MP583** | Ethernet / USB | `192.168.31.201` | `9100` | Barra / Despacho |
| **Celulares Mesoneros** | Wi-Fi | `192.168.31.100 - 150` | - | Clientes web Android |

---

## 5. CONFIGURACIÓN CRÍTICA EN CELULARES ANDROID (SIN INTERNET)

> [!CAUTION]
> **Comportamiento por defecto de Android:** Cuando un celular Android se conecta a un router que no tiene acceso a internet (WAN desconectada), el sistema operativo intenta reconectarse a datos móviles (4G/5G) o desconectar la red Wi-Fi automáticamente, bloqueando el acceso a `http://192.168.31.50:3000`.

### Procedimiento Obligatorio en Celulares:
1. **Desactivar conmutación automática de red:**
   - Ir a: **Ajustes** -> **Wi-Fi** -> **Ajustes avanzados** (o icono de 3 puntos).
   - Desactivar: *"Cambio a datos móviles inteligente"*, *"Asistente Wi-Fi"*, o *"Smart Network Switch"*.
2. **Asociación y confirmación de red aislada:**
   - Conectarse al SSID del Food Truck (ej. `Tocineta_LAN`).
   - Introducir la contraseña del router.
   - En unos segundos aparecerá una notificación del sistema:
     > *"Esta red Wi-Fi no tiene acceso a internet. ¿Deseas mantener la conexión?"*
   - **ACCIÓN CRÍTICA:** Pulsar **"SÍ"** o **"Mantener conexión Wi-Fi"**.
   - Marcar la casilla: **"No volver a preguntar para esta red"**.
3. **Comprobación de conectividad pura:**
   - Desactivar temporalmente los "Datos Móviles" del teléfono durante la prueba para aislar fallos.
   - Abrir Google Chrome en el celular y navegar a:
     ```
     http://192.168.31.50:3000/health
     ```
   - Validar que cargue el dashboard oscuro de **"Tocineta Sonríe | Gate G0 Probe"**.

---

## 6. PROTOCOLO DE EJECUCIÓN DE PRUEBAS FÍSICAS

### PASO 1: Listado de impresoras en Windows
Ejecutar en la terminal de la Laptop:
```powershell
pnpm tsx tools/g0-probe/probe.ts --list
```
* **Resultado observado:**
  - Impresora detectada 1: __________________________ Puerto: ___________ Driver: __________________________
  - Impresora detectada 2: __________________________ Puerto: ___________ Driver: __________________________
* **Criterio de éxito:** Las impresoras conectadas por USB figuran con sus nombres de dispositivo exactos.  
  *Estado: [ ] APROBADO &nbsp;&nbsp;&nbsp; [ ] FALLIDO*

---

### PASO 2: Impresión de Ticket Completo por USB Spooler RAW
Ejecutar para cada impresora:
```powershell
pnpm tsx tools/g0-probe/probe.ts --usb "NombreExactoImpresora"
```
* **Observaciones:**
  - ¿Se abrió alguna ventana emergente de Windows? [ ] Sí (Error) &nbsp;&nbsp; [ ] No (Correcto: RAW transparente)
  - ¿Imprimió el logotipo superior raster monocromo de 384 dots? [ ] Sí &nbsp;&nbsp; [ ] No
  - ¿Se produjo el pitido al final del ticket? [ ] Sí &nbsp;&nbsp; [ ] No
  *Estado: [ ] APROBADO &nbsp;&nbsp;&nbsp; [ ] FALLIDO*

---

### PASO 3: Impresión de Ticket Completo por TCP 9100 (LAN)
Ejecutar para la impresora conectada por cable de red o Wi-Fi:
```powershell
pnpm tsx tools/g0-probe/probe.ts --tcp "192.168.31.200:9100"
```
* **Resultados de red:**
  - Latencia medida reportada por la herramienta: ________ ms (Meta: < 300 ms).
  - Bytes transmitidos: ________ bytes.
  - ¿Imprimió con fluidez sin pausas intermedias? [ ] Sí &nbsp;&nbsp; [ ] No
  *Estado: [ ] APROBADO &nbsp;&nbsp;&nbsp; [ ] FALLIDO*

---

### PASO 4: Medición de Columnas Reales (Ancho Útil 58mm)
Examinar la regla graduada impresa en el ticket:
```
123456789012345678901234567890123456789012
|---10---|---20---|---30--|2|---40---|
```
* **Mediciones:**
  | Prueba | Valor Esperado | Medición DP58U-03 | Medición MP583 |
  |---|:---:|:---:|:---:|
  | **Fuente A (Estándar 12x24)** | 32 columnas | ________ columnas | ________ columnas |
  | **Fuente B (Comprimida 9x17)** | 42 columnas | ________ columnas | ________ columnas |
  | **Ancho físico del cabezal térmico** | 384 dots (48 mm) | ________ mm útiles | ________ mm útiles |
  | **Recorte lateral del Logo 384 dots** | Sin recorte en bordes `\|` | [ ] Íntegro &nbsp; [ ] Cortado | [ ] Íntegro &nbsp; [ ] Cortado |
* **Conclusión de diseño:** El ancho de plantilla para comandas y facturas debe fijarse a: **[ ] 32 columnas** &nbsp;&nbsp; **[ ] Otra:** ______ columnas.

---

### PASO 5: Determinación del Codepage Ganador (Español)
Examinar minuciosamente la sección `[2] MATRIZ CODEPAGES (ESP)` en el ticket impreso para la frase:
`"TOCINETA SONRÍE - JALAPEÑOS - MAÍZ - ñ Ñ á é í ó ú ¡ ¿ $ Bs"`

Marcar la calidad de impresión de cada combinación:
| Comando ESC/POS | Nombre de Tabla | Resultado DP58U-03 | Resultado MP583 |
|---|---|:---:|:---:|
| `ESC t 0` | PC437 (Standard Europe) | [ ] Perfecto &nbsp; [ ] Glitch | [ ] Perfecto &nbsp; [ ] Glitch |
| `ESC t 2` | PC850 (Multilingual Latin I) | [ ] Perfecto &nbsp; [ ] Glitch | [ ] Perfecto &nbsp; [ ] Glitch |
| `ESC t 16` | WPC1252 (Windows Latin 1) | [ ] Perfecto &nbsp; [ ] Glitch | [ ] Perfecto &nbsp; [ ] Glitch |
| `ESC t 19` | PC858 (Euro / Latin I) | [ ] Perfecto &nbsp; [ ] Glitch | [ ] Perfecto &nbsp; [ ] Glitch |
| `ESC t 850` | CP850 Direct (0x52) | [ ] Perfecto &nbsp; [ ] Glitch | [ ] Perfecto &nbsp; [ ] Glitch |
| `ESC t 1252` | CP1252 Direct (0xE4) | [ ] Perfecto &nbsp; [ ] Glitch | [ ] Perfecto &nbsp; [ ] Glitch |
| `[UTF-8 raw]` | UTF-8 sin cambio de tabla | [ ] Perfecto &nbsp; [ ] Roto (`Ã±`) | [ ] Perfecto &nbsp; [ ] Roto (`Ã±`) |

> 🏆 **DECISIÓN ARQUITECTÓNICA - CODEPAGE GANADOR:**
> - Para **DP58U-03**: Comando: `ESC t ______` &nbsp;&nbsp;|&nbsp;&nbsp; Codificación: `[ ] CP850 &nbsp; [ ] CP1252 &nbsp; [ ] CP437 &nbsp; [ ] UTF-8`
> - Para **MP583**: Comando: `ESC t ______` &nbsp;&nbsp;|&nbsp;&nbsp; Codificación: `[ ] CP850 &nbsp; [ ] CP1252 &nbsp; [ ] CP437 &nbsp; [ ] UTF-8`

---

### PASO 6: Validación de Beeper y Corte
* **Buzzer / Zumbador:**
  - ¿El beeper suena con volumen suficiente sobre el ruido de la cocina? [ ] Sí &nbsp;&nbsp; [ ] No
  - Si es bajo o inaudible, ¿se requiere conectar zumbador externo por RJ-11? [ ] Sí &nbsp;&nbsp; [ ] No
* **Corte / Avance:**
  - Si tiene guillotina: ¿El comando `GS V 66 0` realiza corte limpio sin atascar el papel? [ ] Sí &nbsp;&nbsp; [ ] No
  - Si tiene barra manual: ¿El avance de 4 líneas deja el texto completamente fuera de la boca de salida para rasgarlo con la mano sin romper el texto? [ ] Sí &nbsp;&nbsp; [ ] No

---

### PASO 7: Prueba en Vivo con Celulares Android (GET /health)
1. En la laptop, iniciar el servidor:
   ```powershell
   pnpm tsx tools/g0-probe/probe.ts --port 3000
   ```
2. Desde el celular Android 1 (Mesonero 1):
   - Conectado a Wi-Fi `Tocineta_LAN` (sin internet).
   - Navegar a `http://192.168.31.50:3000/health`.
   - Pulsar el botón grande rojo: **"🔔 PROBAR PITIDO Y CORTE"**.
   - Tiempo de respuesta en la pantalla del celular: ________ ms.
   - ¿La impresora pitó y alimentó/cortó inmediatamente? [ ] Sí &nbsp;&nbsp; [ ] No
3. Desde el celular Android 2 (Mesonero 2):
   - Navegar a `http://192.168.31.50:3000/health`.
   - Seleccionar destino TCP (`192.168.31.200:9100`) y pulsar **"📄 IMPRIMIR TICKET COMPLETO G0"**.
   - ¿Imprimió en tiempo real? [ ] Sí &nbsp;&nbsp; [ ] No
  *Estado: [ ] APROBADO &nbsp;&nbsp;&nbsp; [ ] FALLIDO*

---

## 7. RESOLUCIÓN DE PROBLEMAS EN SITIO (TROUBLESHOOTING)

### Caso A: El celular Android dice "No se puede acceder a este sitio web"
1. Verificar que la laptop y el celular tengan IPs en la misma subred (`192.168.31.x`).
2. En la laptop, verificar el Firewall de Windows:
   ```powershell
   netsh advfirewall firewall add rule name="Node Gate G0" dir=in action=allow protocol=TCP localport=3000
   ```
3. Verificar que los datos móviles del celular estén desactivados durante la prueba inicial.

### Caso B: La impresora USB no responde al script
1. Ejecutar `pnpm tsx tools/g0-probe/probe.ts --list` y cotejar el nombre exacto de la impresora. Si tiene comillas o espacios, encerrar en comillas dobles: `--usb "POS-58"`.
2. Verificar que no haya trabajos atascados en la cola de impresión de Windows (`services.msc` -> Reiniciar "Cola de impresión" / "Print Spooler").

### Caso C: La impresora TCP 9100 no conecta (Timeout 3000ms)
1. Enviar ping a la impresora desde PowerShell: `Test-NetConnection -ComputerName 192.168.31.200 -Port 9100`.
2. Si falla, apagar la impresora, mantener presionado FEED y encenderla para verificar si la IP real cambió por DHCP.
3. Si la IP de fábrica está en otro rango (ej: `192.168.123.100`), configurar temporalmente la tarjeta de red de la laptop en `192.168.123.50` para ingresar a la interfaz web de la impresora o usar la utilidad del fabricante para reasignar a `192.168.31.200`.

---

## 8. ACTA DE CIERRE DEL GATE G0

### Resumen de Parámetros Ganadores para la Construcción del Sistema:
* **Canal Producción Comanda (Cocina):** [ ] USB RAW Spooler &nbsp;&nbsp; [ ] TCP 9100 LAN
* **Canal Producción Facturación (Caja):** [ ] USB RAW Spooler &nbsp;&nbsp; [ ] TCP 9100 LAN
* **Ancho de Columnas Definitivo:** ______ columnas útiles.
* **Codepage Definitivo Comanda:** `ESC t ______` (Tabla: ______________).
* **Codepage Definitivo Factura:** `ESC t ______` (Tabla: ______________).
* **Auto-cutter Habilitado:** [ ] Sí &nbsp;&nbsp; [ ] No (Usar avance manual de 4 saltos de línea).

### Veredicto del Gate G0:
[ ] **APROBADO (GO):** La arquitectura física, red y drivers son 100% compatibles. Se autoriza el inicio del desarrollo del Sistema Operativo Local Tocineta Sonríe.  
[ ] **NO APROBADO (NO-GO):** Se requieren ajustes de hardware o cambio de impresoras antes de proceder.

**Firma Responsable Varons Media:** ___________________________  
**Firma Responsable Food Truck:** ___________________________  
