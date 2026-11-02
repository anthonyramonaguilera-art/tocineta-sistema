# GESTION REMOTA, RESPALDOS EN LA NUBE Y ALERTAS POR TELEGRAM — SISTEMA TOCINETA

Este documento detalla la arquitectura operativa para el monitoreo remoto, los respaldos cifrados hacia la nube (Google Drive) y el canal de alertas automáticas vía Telegram para el Sistema Operativo Gastronómico TOCINETA.

---

## 1. Arquitectura de Respaldo Cifrado (R4)

El proceso de respaldo de TOCINETA está diseñado para ser seguro, tolerante a fallos y sin interrupciones operativas:

1. **Snapshot en Caliente (SQLite Online Backup API):**  
   Se utiliza la API nativa de respaldo de SQLite a través de `better-sqlite3`. Esto permite capturar el estado íntegro de la base de datos sin detener el servidor ni bloquear las transacciones activas en modo WAL.
2. **Incrustación de Manifiesto Oficial:**  
   Se inyecta una tabla temporal `_backup_manifest` con la versión del sistema, fecha de creación, ID de jornada y hash de cabeza de la cadena inmutable de auditoría (`audit_events`).
3. **Cifrado Criptográfico con Age:**  
   El snapshot se cifra empleando el estándar Age (X25519 + ChaCha20-Poly1305). Únicamente las claves públicas autorizadas de la Administración y el Custodio Técnico Seguro pueden descifrar el contenido. La computadora local jamás almacena claves privadas.
4. **Almacenamiento Local y Réplica en Nube:**  
   El archivo cifrado final (`.db.age`) se guarda en la unidad o carpeta local (`USB_BACKUP_PATH`) y se copia de forma sincronizada al directorio local de Google Drive (`DRIVE_SYNC_PATH`).
5. **Auditoría y Registro de Fallas:**  
   Todo respaldo exitoso se asienta en `backups_log` y `audit_events`. Si ocurre cualquier anomalía, el evento se documenta de inmediato en la tabla `server_errors`.

---

## 2. Configuración de Google Drive (Google Drive para Escritorio)

Para que los respaldos se sincronicen automáticamente con la nube:

1. Instalar la aplicación oficial **Google Drive para escritorio** (Google Drive for Desktop) en la computadora local de producción.
2. Iniciar sesión con la cuenta de Google institucional designada.
3. Crear o seleccionar una carpeta en la unidad virtual de Google Drive, por ejemplo:
   - `G:\Mi unidad\Respaldos-Tocineta` (si se usa asignación de letra de unidad), o
   - `C:\Users\<Usuario>\Google Drive\Respaldos-Tocineta` (si se usa duplicación en disco).
4. Configurar la ruta en el archivo `.env`:
   ```ini
   DRIVE_SYNC_PATH=C:\Users\Administrador\Google Drive\Respaldos-Tocineta
   ```

---

## 3. Configuración del Bot de Telegram (R2)

El sistema de alertas de TOCINETA utiliza la API oficial de bots de Telegram para enviar dos tipos de notificaciones:
- **Reporte Diario de Salud:** Resumen de operatividad matutino diario.
- **Alerta Inmediata:** Notificación urgente cuando el servidor no responde o cuando se registran fallas críticas en la base de datos (`server_errors`).

### 3.1. Crear el Bot en @BotFather

1. Abrir la aplicación de Telegram en teléfono o computadora.
2. En el buscador de Telegram, escribir `@BotFather` (verificar la marca azul de verificación oficial).
3. Iniciar el chat con el comando `/start`.
4. Enviar el comando `/newbot`.
5. BotFather solicitará dos datos:
   - **Nombre público del bot:** por ejemplo, `TOCINETA Monitor Bot`.
   - **Nombre de usuario (username):** debe terminar obligatoriamente en `bot` (por ejemplo, `tocineta_alerts_bot` o `tocineta_sistema_bot`).
6. BotFather confirmará la creación y entregará un token HTTP API con el siguiente formato:
   ```
   1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ123456789
   ```
7. Guardar este token de forma segura.

### 3.2. Obtener el Chat ID

El mensaje puede enviarse a un chat individual o a un grupo/canal donde esté el equipo directivo.

#### Opción A: Chat Directo Individual
1. En Telegram, buscar el bot por su username recién creado (ej. `@tocineta_alerts_bot`) y pulsar **Iniciar** o enviar el comando `/start`.
2. Enviar cualquier mensaje de prueba en el chat (por ejemplo: `hola`).
3. Abrir el navegador web o ejecutar en consola la siguiente petición (reemplazando con el token real):
   ```
   https://api.telegram.org/bot<TU_TELEGRAM_BOT_TOKEN>/getUpdates
   ```
4. En la respuesta JSON, buscar el bloque `"chat"`:
   ```json
   {
     "message": {
       "chat": {
         "id": 987654321,
         "first_name": "Administrador",
         "type": "private"
       }
     }
   }
   ```
5. El valor numérico de `"id"` (ejemplo: `987654321`) corresponde al `TELEGRAM_CHAT_ID`.

#### Opción B: Grupo o Canal de Supervisión
1. Crear un grupo privado en Telegram (ej. `Supervisión TOCINETA`).
2. Añadir el bot al grupo como miembro o administrador.
3. Enviar un mensaje de prueba al grupo (ej. `registro sistema`).
4. Consultar en el navegador:
   ```
   https://api.telegram.org/bot<TU_TELEGRAM_BOT_TOKEN>/getUpdates
   ```
5. En la respuesta, buscar el `"id"` del grupo (los IDs de grupos y canales comienzan con signo negativo `-` o `-100`, por ejemplo: `-1001987654321`).
6. Utilizar ese identificador completo (con el signo negativo) como `TELEGRAM_CHAT_ID`.

---

## 4. Configuración en el Archivo `.env`

Agregar o verificar las siguientes variables en el archivo `.env` en la raíz del proyecto:

```ini
# ------------------------------------------------------------------------------
# 4. RESPALDOS EN DISPOSITIVOS EXTERNOS (USB) Y LA NUBE (GOOGLE DRIVE)
# ------------------------------------------------------------------------------
USB_BACKUP_PATH=./data/backups/usb
DRIVE_SYNC_PATH=C:\Users\Administrador\Google Drive\Respaldos-Tocineta

# ------------------------------------------------------------------------------
# 5. MONITOREO Y ALERTAS REMOTAS (TELEGRAM)
# ------------------------------------------------------------------------------
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ123456789
TELEGRAM_CHAT_ID=987654321
```

---

## 5. Automatización en el Programador de Tareas de Windows (Task Scheduler)

Para garantizar la ejecución desatendida y continua en producción, se programan tres tareas automáticas:

| Tarea | Script | Horario Sugerido | Descripción |
| :--- | :--- | :--- | :--- |
| **`Tocineta-Actualizador-Automatico`** | `scripts/actualizar.ps1` | **05:00 AM** (Diario) | Búsqueda de releases en GitHub, verificación SHA-256, migración y rollback automático (R3). |
| **`Tocineta-Respaldo-Drive`** | `scripts/respaldo-drive.ps1` | **05:30 AM** (Diario) | Generación de snapshot en caliente, cifrado Age y réplica en USB y Google Drive (R4). |
| **`Tocineta-Alertas-Telegram`** | `scripts/alertas-telegram.ps1` | **08:00 AM** (Diario) | Chequeo de salud del servidor y base de datos, reporte diario a Telegram (R2). |

Para detalles exhaustivos del actualizador, consulte [docs/actualizador-automatico.md](actualizador-automatico.md).

### 5.1. Método Automatizado (Recomendado)

Ejecutar PowerShell como Administrador desde la raíz del sistema:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\configurar-tareas-programadas.ps1 -Action Install
```

Opciones disponibles del configurador:
- Consultar estado: `.\scripts\configurar-tareas-programadas.ps1 -Action Status`
- Desinstalar tareas: `.\scripts\configurar-tareas-programadas.ps1 -Action Uninstall`
- Cambiar horarios: `.\scripts\configurar-tareas-programadas.ps1 -BackupTime "04:30" -AlertTime "07:45"`

### 5.2. Método Manual mediante `schtasks.exe`

Si se requiere crear las tareas manualmente desde la consola de Windows (CMD o PowerShell con privilegios elevados):

1. **Tarea de Respaldo a Drive (05:00 AM):**
   ```cmd
   schtasks.exe /create /tn "Tocineta-Respaldo-Drive" /tr "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File \"C:\TOCINETA\scripts\respaldo-drive.ps1\"" /sc daily /st 05:00 /f
   ```

2. **Tarea de Alertas por Telegram (08:00 AM):**
   ```cmd
   schtasks.exe /create /tn "Tocineta-Alertas-Telegram" /tr "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File \"C:\TOCINETA\scripts\alertas-telegram.ps1\"" /sc daily /st 08:00 /f
   ```

### 5.3. Método Gráfico (`taskschd.msc`)

1. Presionar `Win + R`, escribir `taskschd.msc` y pulsar Enter.
2. En el panel lateral derecho, seleccionar **Crear tarea básica...**.
3. Nombre: `Tocineta-Respaldo-Drive`.
4. Desencadenador: **Diariamente** a las `05:00:00`.
5. Acción: **Iniciar un programa**.
   - Programa o script: `powershell.exe`
   - Agregar argumentos: `-ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\...\scripts\respaldo-drive.ps1"`
   - Iniciar en: Ruta raíz del proyecto.
6. Repetir el proceso para `Tocineta-Alertas-Telegram` a las `08:00:00` con `scripts\alertas-telegram.ps1`.

---

## 6. Procedimiento de Verificación y Pruebas

### 6.1. Probar el Respaldo Cifrado
Ejecutar en PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\respaldo-drive.ps1
```
Verificar que:
- Se cree el archivo `.db.age` en `./data/backups/usb/` y en `DRIVE_SYNC_PATH`.
- Se imprima el hash SHA-256 y la confirmación en verde.

### 6.2. Probar las Alertas de Telegram (Simulación)
Ejecutar en PowerShell con la bandera `-DryRun`:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\alertas-telegram.ps1 -DryRun
```
Verificar que el mensaje generado cumpla el formato oficial:
- En estado normal: `"TOCINETA Sano: [Fecha]. Último respaldo: [Fecha]. Errores en 24h: [Cantidad]"`
- En estado crítico: `"ALERTA INMEDIATA - TOCINETA CRITICO ..."`

---

## 7. Protocolo de Recuperación ante Desastres

Para restaurar cualquier respaldo `.db.age` generado en Google Drive o dispositivo USB:
1. Localizar el archivo `.db.age` correspondiente en Google Drive o USB.
2. Ejecutar el script interactivo de restauración verificado:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\restore-backup.ps1 -BackupPath "C:\ruta\al\tocineta-backup.db.age"
   ```
3. El script solicitará la clave privada de recuperación de la Administración, validará la integridad de SQLite y comprobará la cadena inmutable de auditoría antes de restablecer los datos de producción.
