# ACTA OFICIAL DE ENTREGA, CERTIFICACIÓN Y ACEPTACIÓN FINAL
## SISTEMA DE PUNTO DE VENTA Y GESTIÓN GASTRONÓMICA: TOCINETA SONRÍE POS
**Lugar:** Alta Vista, detrás de Torre Movistar, Puerto Ordaz, Estado Bolívar, Venezuela  
**Fecha:** 18 de Octubre de 2026  
**Hora:** 17:00 VET  

---

### COMPARECIENTES

De una parte:
**SRA. OLINELCYS ESPAÑA**, de nacionalidad venezolana, mayor de edad, titular de la Cédula de Identidad N.º **V-17.040.918**, actuando en su carácter de Propietaria, Directora General y Administradora de la firma comercial gastronómica **TOCINETA SONRÍE FOOD TRUCK**, en lo sucesivo denominada **"EL CLIENTE"**.

Y de la otra parte:
**ANTHONY AGUILERA**, de nacionalidad venezolana, mayor de edad, en su condición de Director de Estrategia y Consultor Tecnológico Principal de **VARONS MEDIA**, en lo sucesivo denominado **"EL PROVEEDOR"**.

Ambas partes, en el pleno ejercicio de sus facultades, convienen en suscribir la presente **ACTA OFICIAL DE ENTREGA, CERTIFICACIÓN Y ACEPTACIÓN DEFINITIVA**, bajo las siguientes cláusulas y especificaciones:

---

### CLÁUSULA PRIMERA: OBJETO DEL ACTA

Mediante el presente documento, **EL PROVEEDOR** hace entrega formal, definitiva e instalada en hardware productivo del sistema integral de software denominado **TOCINETA SONRÍE POS (Versión 1.0 — Releases 1, 2 y 3)**, diseñado y construido a la medida para las operaciones de mostrador, mesas, despacho y cocina del food truck ubicado en Alta Vista, Puerto Ordaz.

Asimismo, **EL CLIENTE** certifica haber presenciado y validado satisfactoriamente la ejecución automatizada e interactiva de las **veintiséis (26) pruebas de aceptación oficiales** contenidas en el Informe Definitivo de Consultoría Estratégica.

---

### CLÁUSULA SEGUNDA: HARDWARE Y EQUIPAMIENTO ENTREGADO E INSTALADO

Se certifica la correcta instalación, configuración de controladores, calibración de corte térmico y puesta en marcha del siguiente parque de hardware en el tráiler gastronómico:

1. **Servidor Central de Operaciones (Mini PC de Mostrador):**
   - Sistema Operativo: Windows 11 Pro Optimizado para Kiosco/POS.
   - Motor de Base de Datos: SQLite 3 en modo Write-Ahead Logging (`WAL`), `synchronous = FULL` y claves foráneas activas, garantizando inmunidad ante apagones súbitos.
   - Runtime de Servicios: Servidor monolítico Fastify / Node.js compilado localmente sin dependencias de internet.
2. **Impresora Térmica de Caja / Mostrador (DP58U-03):**
   - Ancho: 58 mm estándar, conexión directa USB con cola de impresión no bloqueante.
   - Función: Emisión de recibos de cliente, tickets Z de auditoría, comprobantes de vuelto y finiquitos de motorizados.
3. **Impresora Térmica de Cocina (MP583):**
   - Ancho: 58 mm, enrutamiento por comandos ESC/POS puros.
   - Función: Emisión automática y silenciosa de comandas para las estaciones de **HAMBURGUESAS** y **HOT DOGS**.
4. **Terminal Táctil KDS de Cocina (Kitchen Display System):**
   - Pantalla interactiva con semáforo de tiempos (Verde < 5m, Amarillo 5-10m, Rojo > 10m).
5. **Red Inalámbrica Local (Router LAN Autónomo):**
   - Red Wi-Fi privada del negocio sin salida obligatoria a WAN, permitiendo la conexión fluida de los smartphones Android del personal de mesoneros.
6. **Bóveda USB de Respaldo Físico:**
   - Dispositivo extraíble de alta durabilidad identificado con la marca de sistema `.tocineta-usb-vault`.

---

### CLÁUSULA TERCERA: MATRIZ DE CERTIFICACIÓN DE LAS 26 PRUEBAS DE ACEPTACIÓN

Las partes dejan constancia de que la suite maestra de certificación (`acceptance-full-26.test.ts`) ha sido ejecutada en su totalidad con **resultado 100% SATISFACTORIO (26/26 APROBADAS)**:

| # | Escenario de Prueba Oficial | Componente Validado | Resultado |
|---|---|---|:---:|
| **01** | Operación 100% Offline | LAN y Loopback locales sin dependencias de internet WAN | **APROBADO (PASS)** |
| **02** | Cola de Impresión Resiliente | Caída o desconexión de impresora no bloquea el POS | **APROBADO (PASS)** |
| **03** | Resistencia a Falla Eléctrica | `synchronous = FULL` y `journal_mode = WAL` en SQLite | **APROBADO (PASS)** |
| **04** | Deduplicación por Idempotencia | Cabecera `Idempotency-Key` ante reconexiones Wi-Fi | **APROBADO (PASS)** |
| **05** | Vuelto Mixto Inteligente | Pago de $13.90 con $20.00 -> $6.00 USD + centavos en Bs | **APROBADO (PASS)** |
| **06** | Cobro Multimétodo Triple | Fraccionamiento en 1 venta: Efectivo USD + Pago Móvil + Ubii | **APROBADO (PASS)** |
| **07** | Alerta Antifraude Pago Móvil | Bloqueo Nivel 1 (mismo monto y ref) y Advertencia Nivel 2 | **APROBADO (PASS)** |
| **08** | Autorización Sin Pago con PIN | Estado `autorizado_sin_pago` con deuda abierta para clientes VIP | **APROBADO (PASS)** |
| **09** | Reposición Urgente (*Refire*) | Ticket prioritario en cocina y merma registrada sin tocar caja | **APROBADO (PASS)** |
| **10** | Reembolso con Tope de $20 | Supervisores limitados a $20; mayores montos exigen Admin | **APROBADO (PASS)** |
| **11** | Prorrateo Exacto Hamilton | Desglose combo (325+325+140) y comanda sin palabra "COMBO" | **APROBADO (PASS)** |
| **12** | Barra Libre $0.00 al Público | 6 aderezos gratis al cliente con costo interno de 15¢ | **APROBADO (PASS)** |
| **13** | Arqueo Ciego con Regla Anti-Tanteo | 1 solo reconteo ciego sin revelar montos ni dirección de falta | **APROBADO (PASS)** |
| **14** | Cierre Z con Retención Ubii | Descuento automático de 0.75% de comisión y Hash SHA-256 | **APROBADO (PASS)** |
| **15** | Inmutabilidad de Tasa BCV | Cambio de tasa a mitad de turno no altera pagos previos | **APROBADO (PASS)** |
| **16** | Restauración Criptográfica Verificada | Respaldo y restauración `.db.age` con integridad probada | **APROBADO (PASS)** |
| **17** | Guardia Temporal contra Desajustes | Rechazo automático de retrocesos en el reloj del sistema | **APROBADO (PASS)** |
| **18** | Transcripción de Comandas de Papel | Transcripción de talonarios (#EMG-001) previene duplicados | **APROBADO (PASS)** |
| **19** | Revocación Instantánea de Sesión | Desactivación de empleado invalida tokens inmediatamente | **APROBADO (PASS)** |
| **20** | Optimización Móvil Android | Code-splitting y bundles ultralivianos para smartphones | **APROBADO (PASS)** |
| **21** | Autodetección de Bóveda USB | Reconocimiento de `.tocineta-usb-vault` y verificación de disco | **APROBADO (PASS)** |
| **22** | Simulacro Dry-Run de Migraciones | Verificación de migraciones en memoria sin alterar producción | **APROBADO (PASS)** |
| **23** | Delivery, Flota y Cupones Duales | Fletes ($2-$5), liquidación nocturna y cupones Descuento/Obsequio | **APROBADO (PASS)** |
| **24** | Modo Soporte Auditado y Ed25519 | Quick Assist Win11 (2h max, PIN 6d) y Rollback de paquetes | **APROBADO (PASS)** |
| **25** | Menú Digital QR y Cero-Fugas Cloud | WhatsApp `0412-1928527` y auditoría de privacidad estricta | **APROBADO (PASS)** |
| **26** | Rentabilidad Profesional y Fiscal | Niveles 1-4 (Costos, Inventario Sin Pan, Net Profit, Matriz) | **APROBADO (PASS)** |

---

### CLÁUSULA CUARTA: DOCUMENTACIÓN OPERATIVA ENTREGADA

**EL CLIENTE** recibe en este acto cuatro (4) manuales operativos en formato físico y digital, redactados con lenguaje directo para el mostrador:
1. **Manual de la Cajera (`/docs/manual-cajera.md`):** Apertura, calculadora multimétodo, vueltos mixtos, alertas de Pago Móvil, cupones, liquidación de repartidores, arqueo ciego y cambio de rollo de 58 mm.
2. **Manual de Mesonero y Cocina (`/docs/manual-mesonero-cocina.md`):** Conexión Wi-Fi Android sin internet, pedidos en 1 toque, modificadores `Sin Pan / Envuelta en Lechuga`, tickets por estación y uso del KDS.
3. **Manual de la Administradora (`/docs/manual-administradora.md`):** Control con PIN de 6 dígitos, cambio de tasa BCV, activación de Malteadas (Feature Flag), Rentabilidad Pro, Cierre Z y Bóveda USB.
4. **La presente Acta Oficial (`/docs/acta-aceptacion-final.md`).**

---

### CLÁUSULA QUINTA: CUSTODIA DEL SOBRE LACRADO Y SEGURIDAD CRIPTOGRÁFICA

1. **EL PROVEEDOR** hace entrega material a la **SRA. OLINELCYS ESPAÑA** de un **Sobre de Manilla Lacrado y Sellado**, contentivo en su interior de la **Clave Privada Maestra `age` (`AGE-SECRET-KEY-1...`)**, la cual constituye la única llave matemática capaz de desencriptar las bases de datos de respaldo histórico en caso de sustitución física del computador.
2. **EL CLIENTE** asume la custodia exclusiva de dicho sobre bajo llave, comprometiéndose a no abrirlo excepto ante eventos de contingencia mayor con asistencia técnica autorizada.
3. **EL PROVEEDOR** declara formalmente que el sistema **no posee puertas traseras, accesos remotos desatendidos ni cuentas maestras ocultas**, requiriéndose siempre el consentimiento activo de la Administradora para cualquier sesión de mantenimiento mediante el Modo Soporte de Windows 11.

---

### CLÁUSULA SEXTA: ALCANCE EXCLUIDO Y MÓDULOS EN STANDBY (FUERA DE ALCANCE V1.0)

A fin de preservar la máxima estabilidad del Food Truck y evitar complejidades fiscales o de inventario prematuras, las partes acuerdan expresamente los siguientes módulos excluidos o en estado de reserva técnica (*standby*):
1. **Malteadas y Helados:** Categoría y recetas sembradas con `is_active = 0` en base de datos. Permanecen inactivas y ocultas en el POS y Menú Digital QR hasta la finalización de pruebas de campo y autorización de la Propietaria.
2. **Módulo Fiscal e IGTF en Standby:** Configurados apagados por defecto (`fiscal_module_enabled = 0`, `igtf_enabled = 0`). No alteran recibos ni reportes Z hasta la validación y confirmación formal con el contador del negocio.
3. **Exclusión de Máquinas Fiscales SENIAT:** Se deja constancia de que la versión 1.0 emite Notas de Entrega y Comprobantes Internos de Venta en formato térmico estándar de 58 mm. No incluye ni contempla integración directa con impresoras fiscales seriales/fiscalizadas SENIAT en este hito.

---

### CLÁUSULA SÉPTIMA: ACUERDO DE NIVEL DE SERVICIO (SLA) Y GARANTÍA POST-INSTALACIÓN

**EL PROVEEDOR** otorga un período formal de garantía y acompañamiento técnico bajo las siguientes condiciones:
1. **Período de Acompañamiento:** Treinta (30) días calendario de acompañamiento prioritario continuo a partir de la firma de la presente acta.
2. **Garantía de Software:** Sesenta (60) días continuos para corrección de incidencias o bugs de software atribuibles al sistema sin costo adicional para **EL CLIENTE**.
3. **Tiempos de Respuesta por Severidad:**
   Diferenciando el **Horario Operativo del Turno (Martes a Domingo de 6:00 p. m. a 12:00 a. m.)** vs. **Horas Hábiles Administrativas**:
   - **Severidad 1 (Crítica — Caja o Impresión detenida durante el turno activo 6:00 p. m. – 12:00 a. m.):**  
     Respuesta remota / telefónica en **< 30 minutos** y asistencia presencial en sitio en **< 2 horas**.
   - **Severidad 2 (Alta — Falla parcial con workaround operativo disponible):**  
     Respuesta y diagnóstico en **< 12 horas hábiles**.
   - **Severidad 3 (Media/Baja — Consultas operativas o ajustes visuales menores):**  
     Respuesta y atención en **< 48 horas hábiles**.

---

### CLÁUSULA OCTAVA: CONFORMIDAD Y CIERRE TÉCNICO

Leída la presente acta por ambas partes y encontrándose conformes con todos sus términos, alcances técnicos y resultados de certificación, la firman y rubrican en dos (2) ejemplares de un mismo tenor y a un solo efecto, en la ciudad de Puerto Ordaz, a los 18 días del mes de Octubre del año 2026.

---

```
POR EL CLIENTE:                               POR EL PROVEEDOR:
TOCINETA SONRÍE FOOD TRUCK                    VARONS MEDIA



_______________________________________       _______________________________________
SRA. OLINELCYS ESPAÑA                         ANTHONY AGUILERA
Propietaria y Administradora General          Director de Estrategia Tecnológica
C.I. V-17.040.918                             Varons Media Gastronomic Solutions
Telf: 0424-9728209                            Puerto Ordaz, Venezuela
```
