# MANUAL OPERATIVO DEL ROL: ADMINISTRADORA GENERAL
## Tocineta Sonríe Food Truck — Alta Vista, Puerto Ordaz
**Propietaria y Administradora:** Sra. Olinelcys España (C.I. 17.040.918)  
**Versión del Sistema:** POS 1.0 (Releases 1, 2 y 3)  
**Preparado por:** Anthony Aguilera — Dirección de Estrategia, Varons Media  
**Fecha de Publicación:** Octubre 2026  
**Formato:** Manual Ejecutivo Confidencial Listo para Imprimir  

---

## 1. ACCESO SEGURO Y PRIVILEGIOS DEL PIN MAESTRO DE 6 DÍGITOS

El perfil de Administradora (`usr_admin_olinelcys`) posee el control jerárquico total del sistema POS y de la base de datos financiera.

```
       ┌────────────────────────────────────────────────────────┐
       │             PANEL ADMINISTRATIVO EJECUTIVO             │
       │           Tocineta Sonríe — Sra. Olinelcys             │
       ├────────────────────────────────────────────────────────┤
       │ Ingrese PIN Maestro de 6 Dígitos:  [ • • • • • • ]     │
       ├────────────────────────────────────────────────────────┤
       │  [ TASA BCV ]  [ RENTABILIDAD PRO ]  [ CIERRE Z ]      │
       │  [ MALTEADAS ] [ MODO SOPORTE ]     [ BÓVEDA USB ]     │
       └────────────────────────────────────────────────────────┘
```

### 1.1. PIN Maestro de 6 Dígitos
- **PIN Inicial de Fábrica:** `123456`.
- **Obligación de Cambio:** El sistema le exigirá actualizar su PIN al primer inicio de sesión.
- **Diferencia con otros roles:** Las cajeras y mesoneros utilizan PIN de 4 dígitos. La administradora y supervisores utilizan PIN de 6 dígitos con auditoría estricta.

### 1.2. Operaciones Exclusivas con Autorización de la Administradora:
1. **Reembolsos o Mermas mayores a $20.00 USD:**  
   Los supervisores de turno solo pueden autorizar devoluciones de hasta `$20.00`. Cualquier monto superior exige obligatoriamente el PIN de la Sra. Olinelcys.
2. **Desbloqueo de Antifraude Nivel 1 en Pago Móvil:**  
   Cuando un cliente presenta una captura bancaria con referencia idéntica y monto idéntico a una ya cobrada en el día.
3. **Cierre Z Oficial de Jornada:**  
   Generación del balance final inmutable del día con sellado criptográfico.
4. **Activación de Modo Soporte Remoto:**  
   Solo la Administradora puede autorizar que Varons Media se conecte al equipo.

---

## 2. GESTIÓN DIARIA DE LA TASA OFICIAL BCV

En cumplimiento con la normativa venezolana y las mejores prácticas financieras, los precios se expresan en Dólares ($) y se convierten en tiempo real a Bolívares (Bs) según la tasa del Banco Central de Venezuela.

```
  ┌───────────────────────────────────────────────────────────┐
  │ 🏛️ ACTUALIZACIÓN DE TASA OFICIAL BCV                      │
  │ Tasa Vigente en Sistema: 40.00 Bs/$                       │
  │ Última Actualización: 18/10/2026 - 05:30 p. m. (Caracas)  │
  ├───────────────────────────────────────────────────────────┤
  │ Ingrese Nueva Tasa BCV: [ 41.50 ] Bs/$                    │
  │                    [ GUARDAR Y PUBLICAR ]                 │
  └───────────────────────────────────────────────────────────┘
```

### 2.1. Regla de Oro Financiera: "Inmutabilidad de Ventas Pasadas"
- Si usted cambia la tasa a mitad de la noche (por ejemplo, a las 9:00 p. m. porque el BCV publicó una nueva tasa para el día siguiente):
  - **Las ventas y cobros ya realizados NO se modifican.** Cada pago previo conserva su tasa original de cuando se emitió el ticket.
  - Las nuevas órdenes a partir de ese segundo se calcularán con la nueva tasa.
  - Esto evita descuadres contables y garantiza que su arqueo de bolívares coincida al 100% con lo cobrado.

---

## 3. ACTIVACIÓN DEL MÓDULO DE MALTEADAS Y HELADOS (FEATURE FLAG)

A solicitud expresa de la Sra. Olinelcys durante la fase de consultoría estratégica, la categoría **Malteadas y Helados** se encuentra actualmente desarrollada pero **desactivada por defecto (`is_active = 0`)** mientras culminan las pruebas de formulación y equipamiento en el food truck.

### 3.1. Cómo Activar el Módulo en 1 Segundo:
1. Ingrese al menú **"Administración > Menú y Categorías"**.
2. Localice la tarjeta: **🍦 Malteadas y Helados**.
3. Cambie el interruptor de estado a **"ACTIVO"**.
4. **Resultado Inmediato:**
   - La categoría aparecerá en el terminal de mostrador de la cajera.
   - Aparecerá en los teléfonos celulares de los mesoneros.
   - Se habilitará automáticamente en el Menú Digital QR para los clientes.
   - **Cero reinicios ni reinstalaciones requeridas.**

---

## 4. PANEL DE RENTABILIDAD PROFESIONAL (NIVELES 1 AL 4)

El módulo de Rentabilidad Profesional le permite conocer la ganancia neta real de cada jornada, el costo de cada receta y el rendimiento de su menú según la metodología académica de **Kasavana & Smith**.

> **Interruptor Maestro:** Si en noches de mucho tráfico prefiere una pantalla simple, puede apagar la vista de Rentabilidad Pro. El sistema continuará calculando todos los costos en segundo plano sin perder un solo dato.

```
       ┌────────────────────────────────────────────────────────┐
       │             MATRIZ DE KASAVANA & SMITH                 │
       │                 (Ingeniería de Menú)                   │
       ├────────────────────────┬───────────────────────────────┤
       │      ⭐ ESTRELLAS       │     🐴 CABALLOS DE BATALLA     │
       │  Alta Venta / Gran Margen│  Alta Venta / Bajo Margen   │
       │  - Texas Mex ($6.90)   │  - Street Dog ($2.50)         │
       │  *Proteger calidad*    │  *Revisar costos de insumo*   │
       ├────────────────────────┼───────────────────────────────┤
       │     🧩 ROMPECABEZAS     │           🐕 PERROS           │
       │  Baja Venta / Gran Margen│  Baja Venta / Bajo Margen   │
       │  - Americana Deluxe    │  - Doble Salchicha Dog        │
       │  *Promocionar en mesa* │  *Evaluar reemplazo*          │
       └────────────────────────┴───────────────────────────────┘
```

### 4.1. Nivel 1 — Costeo de Insumos y Asistente Rápido:
- Si el precio de compra de algún ingrediente supera los **30 días sin actualizarse**, el sistema le mostrará una alerta amarilla: `⚠️ Costo desactualizado`.
- Con el **Asistente de Actualización Masiva** puede tipear los nuevos precios de la carne, el pan o las salsas en una sola tabla y guardar todo en bloque.
- Los modificadores de **Barra Libre** tienen un costo interno asignado de `$0.15` por selección, y los cupones de **Cortesía** `$0.35`.

### 4.2. Nivel 2 — Inventario Crítico de Alta Rotación:
El sistema reconcilia los 8 insumos neurálgicos del food truck:
1. Pan Brioche
2. Pan de Perro
3. Medallón Smash Prime (Americana: 4 carnes, Miami: 3 carnes, Texas: 2 carnes, Smash: 1 carne)
4. Salchicha de Pollo
5. Salchicha Polaca
6. Pechuga de Pollo Crispy
7. Malta Lata 250ml
8. Refresco 1 Lt

> **Ahorro Inteligente:** Si un cliente pide *"Sin Pan / Envuelta en Lechuga"*, el sistema resta 0 panes de su stock, reflejando el ahorro exacto en su inventario.

### 4.3. Nivel 3 — Ganancia Neta Real por Jornada:
La ganancia neta no es simplemente *"ventas menos compras"*. El sistema calcula la utilidad pura aplicando 4 deducciones precisas:
1. **Exclusión de Delivery Modo A:** Las tarifas cobradas de flete se transfieren 100% al repartidor; el sistema no las infla como ingresos del food truck.
2. **Costo Real de Alimentos:** Suma exacta de carnes, panes, salsas y empaques consumidos.
3. **Comisión Ubii:** Deducción del `0.75%` retenido por el datáfono bancario.
4. **Gastos Operativos del Turno:** Registro directo de gastos menores de caja (hielo, carbón, botellón de agua, servilletas).

---

## 5. CIERRE Z OFICIAL Y AUDITORÍA CRIPTOGRÁFICA SHA-256

Al terminar la noche de trabajo, la Administradora ejecuta el **Cierre Z**:

1. Ingrese a **"Jornada y Caja > Cierre Z Oficial"**.
2. Ingrese su PIN de 6 dígitos.
3. El sistema:
   - Cierra todas las sesiones de cajeras y repartidores.
   - Calcula el resumen definitivo de cobros en USD, Pago Móvil, Efectivo Bs y Ubii.
   - **Calcula y descuenta la comisión de Ubii (0.75%).**
   - Imprime el **Ticket Z Oficial en 58mm**.
   - **Sello SHA-256:** En el pie del ticket se imprime una firma digital matemática de 64 caracteres (ej. `a7f9b2c3d4...`). Este código certifica ante cualquier auditoría que ningún registro fue alterado, borrado o manipulado después del cierre.

---

## 6. MODO SOPORTE AUDITADO DE VARONS MEDIA

Si el sistema requiere mantenimiento preventivo, actualización de versiones o revisión técnica por parte del equipo de Anthony Aguilera (Varons Media), Tocineta Sonríe cuenta con una arquitectura de **Cero Puertas Traseras**.

```
                ┌──────────────────────────────────────────────┐
                │ 🛡️ MODO SOPORTE VARONS MEDIA — AUDITADO      │
                │     Activo por: Sra. Olinelcys España        │
                │     Expiración Automática: 1h 59m 40s        │
                └──────────────────────────────────────────────┘
```

### 6.1. ¿Cómo funciona la conexión segura?
1. Varons Media **NO tiene acceso remoto permanente** al food truck.
2. La Sra. Olinelcys debe ingresar a **"Modo Soporte"** y tipear su PIN de 6 dígitos para autorizar el acceso.
3. El sistema ejecuta la herramienta nativa de Windows 11: **Asistencia Rápida (`quickassist.exe`)**, generando un código temporal de 6 dígitos.
4. Todas las pantallas del local mostrarán un banner rojo visible:  
   `"🛠️ MODO SOPORTE VARONS MEDIA ACTIVO — SESIÓN AUDITADA"`.
5. A las **2 horas exactas**, la sesión expira y el acceso se cierra automáticamente sin posibilidad de quedar abierto por descuido.
6. Cada inicio y fin de soporte queda registrado en el libro de auditoría inmutable.

---

## 7. BÓVEDA USB Y CUSTODIA DEL SOBRE LACRADO CON LA CLAVE PRIVADA `age`

Tocineta Sonríe cuenta con el estándar más alto de seguridad de datos de la industria gastronómica mediante encriptación asimétrica militar (`age-encryption` / curvas elípticas `Ed25519` y `X25519`).

```
    [ DATOS FINANCIEROS DEL FOOD TRUCK ]
                     │
         (Encriptación Diaria)
                     ▼
    [ BÓVEDA USB (.tocineta-usb-vault) ]  <─── Archivo: backup-20261018.db.age
                     │
    (Solo puede abrirse con la llave)
                     ▼
    [ SOBRE LACRADO Y FIRMADO EN CAJA FUERTE ]  (Custodia: Sra. Olinelcys)
```

### 7.1. Rutina Diaria de la Bóveda USB:
- Mantenga conectado en el Mini PC el pendrive metálico de respaldo provisto por Varons Media.
- El pendrive contiene un archivo invisible de autenticación: `.tocineta-usb-vault`.
- Al finalizar cada turno o tras el Cierre Z, el sistema genera automáticamente un respaldo encriptado `.db.age`.
- Si el computador principal sufriera una falla eléctrica grave o robo, **los datos están a salvo en la Bóveda USB y nadie puede leerlos sin la llave privada**.

### 7.2. Protocolo de Custodia del Sobre Lacrado:
- Anthony Aguilera (Varons Media) ha entregado a la Sra. Olinelcys un **Sobre de Seguridad Lacrado y Firmado**.
- En su interior se encuentra impresa la **Clave Privada Maestra de Desencriptación (`AGE-SECRET-KEY-1...`)**.
- **INSTRUCCIÓN ESTRICTA:**
  - El sobre debe guardarse bajo llave en la caja fuerte del negocio o en la residencia privada de la Sra. Olinelcys.
  - **No debe abrirse bajo ninguna circunstancia cotidiana.**
  - Solo se abrirá si el computador del food truck se daña por completo y se debe instalar el sistema desde cero en una máquina de reemplazo para restaurar el histórico de años anteriores.

---

### Acta de Recepción y Conformidad del Rol de Administradora:

Yo, **Sra. Olinelcys España**, portadora de la Cédula de Identidad **V-17.040.918**, en mi carácter de Propietaria y Administradora de **Tocineta Sonríe Food Truck**, declaro haber recibido a satisfacción la capacitación operativa del sistema POS, el PIN Maestro de 6 dígitos y el Sobre Lacrado con la Clave Maestra de Encriptación.

Firma: ____________________________________  
Fecha: 18 de Octubre de 2026  
Lugar: Alta Vista, Puerto Ordaz, Edo. Bolívar
