# Protocolo Oficial de Recuperación ante Desastres y Restauración de Respaldos
## Tocineta Sonríe — Sistema Operativo Local (Varons Media)

Este documento detalla el Procedimiento Operativo Estándar (SOP) para blindar los datos comerciales y contables de **Tocineta Sonríe** contra fallas de disco, cortes eléctricos abruptos, corrupción de archivos o robo físico de la laptop del Food Truck.

---

### 1. Filosofía de Blindaje Criptográfico (`age`)

El sistema implementa una arquitectura de **Cifrado con Clave Pública Asimétrica (`age`)** con dos destinatarios autorizados independientes:

1. **Sra. Olinelcys (Dueña del Food Truck):**
   - Clave pública configurada en el servidor:
     `age1q5q9c7am7xx9e4flj0j8ugyfqejpyp5dc8qsvqpnv7uamg4wkcuqye3f0r`
   - Clave privada de custodia física:
     `AGE-SECRET-KEY-1EH6GADU6VQ0SRYGS30G56ZN8UUKTKYFWNY9DHGQAPUQJPJ9DES0SMKUFWL`
     *(Almacenada impresa en papel dentro de un sobre sellado e inviolable en la caja fuerte de su residencia).*

2. **Varons Media (Agencia Tecnológica y Soporte):**
   - Clave pública configurada en el servidor:
     `age15asuchr5fv6fvqhpxm7zedh0n54p7sukdzn5zjp4auqaju8h5cfslg5ne7`
   - Clave privada de custodia digital:
     `AGE-SECRET-KEY-12ALNYAPFWKAE854CVKJUHFRC0U5R7KT24DYL6UW6XSQR5VYNR2VQP4ULMA`
     *(Almacenada con cifrado de grado militar en el gestor de contraseñas de la agencia).*

> [!CAUTION]
> **REGLA CRÍTICA DE SEGURIDAD (ANTIRROBO):**
> La laptop operativa del Food Truck **ÚNICAMENTE** almacena las **claves públicas destinatarias** (`age1...`). **BAJO NINGUNA CIRCUNSTANCIA** se almacena ninguna de las dos claves privadas en el disco duro de la laptop ni en la memoria USB.
> Si un tercero sustrae la laptop junto con la memoria USB conectada, **le resultará matemáticamente imposible descifrar los respaldos**.

---

### 2. Mecanismos de Respaldo Automatizados

El sistema opera dos capas continuas de protección:

1. **Snapshots en Caliente (Hot Physical Snapshots):**
   - Ocurren automáticamente cada **5 minutos** mediante la API en segundo plano `.backup()` de SQLite hacia `./data/snapshots/`.
   - **No bloquean** la toma de pedidos de mesoneros ni la facturación en caja.
   - **Política de Retención Automática:**
     - Últimos 12 snapshots de 5 minutos (cubre la última hora de operación).
     - 1 snapshot por hora durante 24 horas (24 archivos horarios).
     - 1 snapshot por día durante 30 días (30 archivos diarios).
     - Poda y eliminación automática del resto de snapshots.

2. **Respaldo Cifrado Diario a Memoria USB (`age`):**
   - Se genera automáticamente al procesar el **Cierre Z** de la jornada o al presionar **"Respaldar Ahora"** desde el panel administrativo.
   - Crea un archivo con snapshot completo consolidado con la tabla `_backup_manifest` (incluyendo el resumen del Cierre Z y el hash SHA-256 de cabeza de auditoría).
   - El archivo se cifra con `age` hacia ambas claves públicas y se guarda como `tocineta-backup-<timestamp>.db.age` en la memoria USB conectada (ruta configurable o `./data/backups/usb/`).
   - Queda registrado con su hash SHA-256 en la tabla `backups_log` y en la cadena inmutable de `audit_events`.

---

### 3. Procedimiento de Restauración Paso a Paso (< 15 Minutos)

En caso de requerir restaurar el sistema por daño físico de la base de datos o sustitución de la laptop:

#### Paso 1: Localizar el Archivo de Respaldo
- Conectar la memoria USB que contiene los respaldos `.db.age`, o identificar el snapshot local más reciente en `./data/snapshots/`.

#### Paso 2: Ejecutar el Script de Restauración
Abrir PowerShell en la raíz del proyecto y ejecutar:

```powershell
.\scripts\restore-backup.ps1
```

O suministrar los parámetros directamente:

```powershell
.\scripts\restore-backup.ps1 -BackupPath "E:\tocineta-backup-1792271448000.db.age" -PrivateKey "AGE-SECRET-KEY-1..."
```

#### Paso 3: Proceso Automático de Verificación Criptográfica
El script ejecuta de manera transparente y en menos de 5 minutos:
1. **Descifrado seguro:** Utiliza la clave privada suministrada para descifrar en memoria/temporal.
2. **Chequeo de Integridad SQLite:** Ejecuta `PRAGMA integrity_check;`. Si el archivo tiene la más mínima corrupción física, aborta inmediatamente.
3. **Validación de Cadena SHA-256:** Recalcula matemáticamente todos los eslabones de la tabla `audit_events` desde el génesis hasta el último registro para garantizar que ningún dato fue alterado.
4. **Respaldo Preventivo:** Si existe una base de datos operativa previa en `./data/tocineta.db`, genera una copia de resguardo `tocineta-backup-pre-restore-<timestamp>.db`.
5. **Sustitución Atómica:** Copia la base de datos verificada a `./data/tocineta.db`.

#### Paso 4: Levantar y Verificar el Servidor
Iniciar el servidor:

```bash
pnpm --filter @tocineta/server start
```

Verificar en la interfaz web:
- Catálogo y disponibilidad de productos.
- Estado de la última jornada y sesiones de caja.
- Saldo y asientos del libro diario contable (`ledger_entries`).

---

### 4. Modo de Emergencia en Papel (Apagón / Fallo Total de Laptop)

Si ocurre un corte de luz imprevisto sin UPS o una falla de hardware durante el servicio activo:

1. **Talonario Físico Imprimible:**
   - Mantener siempre en el Food Truck el talonario impreso de **200 comandas numeradas (`#EMG-001` a `#EMG-200`)**.
   - Se puede reimprimir en cualquier momento desde el panel o descargando el PDF oficial:
     ```
     GET /api/emergency/slips-pdf
     ```
     o encolando en la impresora térmica de caja con:
     ```
     POST /api/emergency/print-slips
     ```

2. **Operación Durante el Apagón:**
   - Los mesoneros llenan a mano la comanda física indicando hora real, productos, barra libre y método de pago recibido.
   - Cocina despacha guiándose por la comanda física de emergencia.

3. **Carga Diferida al Restablecerse el Sistema:**
   - Una vez restablecida la energía, la Cajera o el Supervisor ingresa a la pantalla de **"Carga Diferida de Comandas de Papel"** (`POST /api/emergency/deferred-orders`).
   - Digita el número de comanda física (ej. `#EMG-015`), la **hora real en que ocurrió**, los productos y el cobro.
   - **Regla anti-duplicidad:** El sistema impide registrar dos veces el mismo número de comanda de papel mediante índice único de base de datos.
   - **Trazabilidad total:** El registro queda marcado en auditoría inmutable con la acción `deferred_paper_entry`.
