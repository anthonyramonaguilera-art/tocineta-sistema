# MANUAL OPERATIVO DE 1 PÁGINA — ROL: ADMINISTRADORA GENERAL (ADMIN)
## SISTEMA GASTRONÓMICO "TOCINETA" — VERSIÓN 3.0

---

### 1. ACCESO Y ROTACIÓN DE CLAVES SEMILLA
- **Credenciales Iniciales:** El sistema provee un usuario administrador semilla (`ADMIN`). Al primer inicio, el sistema exige obligatoriamente cambiar la contraseña y PIN maestro de 6 dígitos.
- **Rotación Periódica:** Acceda a **Personal y Permisos** para rotar periódicamente el PIN maestro y los accesos de supervisión. Jamás comparta el PIN maestro con personal operativo.
- **Permisos Granulares:** Como Administradora, usted define qué empleados pueden ver costos de recetas, editar la carta, anular pedidos o emitir devoluciones.

---

### 2. GESTIÓN DE TASA BCV Y CONFIGURACIÓN COMERCIAL
- **Tasa Oficial BCV:** Actualice la tasa de cambio en la barra superior o en **Configuración del Negocio**.
- **Inmutabilidad Contable:** Cambiar la tasa no altera cobros ni pedidos pasados; cada venta conserva la tasa con la que fue registrada.
- **Multi-Restaurante y Marca:** Configure el nombre del negocio, RIF, dirección física, eslogan, colores, recargos y sedes desde **Configuración**.

---

### 3. COTIZADOR DE EVENTOS Y CATERING
- **Creación de Cotización:** Seleccione platos de la carta activa, defina cantidades y aplique descuentos por volumen (% o precio especial).
- **Simulador Privado:** Evalúe el margen y utilidad proyectada comparando el precio de venta vs el costo real de ingredientes de las recetas.
- **Exportación:** Genere cotización limpia para el cliente en PDF o mensaje formateado para WhatsApp (sin exponer costos internos).
- **Conversión a Reserva:** Presione **"Convertir en reserva"** para registrar la fecha y obtener la **lista consolidada de compras de insumos** requerida para cocina.

---

### 4. MÓDULO DE SOCIOS Y UTILIDADES
- **Activación:** Solo la dueña activa este módulo desde el interruptor en **Socios**.
- **Registro de Capital y Retiros:** Registre aportes de capital (`APORTE`) o retiros a cuenta de utilidades (`RETIRO_UTILIDADES`).
- **Reparto de Dividendos:** Distribuya utilidades periódicas ingresando el monto global; el sistema calcula y liquida automáticamente la cuota según el porcentaje accionario de cada socio.

---

### 5. NÓMINA Y CUENTAS DE EMPLEADOS
- **Liquidación de Turno / Periodo:** Esquema diario, semanal o quincenal: `Neto = Base + Bonos - Adelantos - Consumos`.
- **Cena de Personal:** Si la cena fija está activa, su costo se imputa a gasto operativo y no se descuenta al trabajador.
- **Gestión de Consumos:** Antes de liquidar, decida cuáles consumos autorizados se descuentan y cuáles se perdonan.

---

### 6. CIERRE DE JORNADA Y RESPALDOS FÍSICOS
- **Cierre Z Oficial:** Al finalizar la jornada, emita el Cierre Z inmutable con sellado criptográfico.
- **Bóveda USB y Restauración:** Conecte el pendrive con la marca `.tocineta-usb-vault`. El sistema respaldará automáticamente la base de datos WAL.
- **Simulacro de Contingencia:** En caso de sustitución de equipo, ejecute el comando de restauración `pnpm restore-backup` para recuperar la integridad en menos de 60 segundos.
