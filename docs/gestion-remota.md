# GESTION REMOTA, RESPALDOS POR TELEGRAM, ALERTAS Y DIAGNOSTICO FORENSE — SISTEMA TOCINETA

Este documento detalla la arquitectura operativa para el monitoreo remoto, los respaldos cifrados con Age enviados directamente vía Telegram, la generación de paquetes de diagnóstico forense y el canal de alertas automáticas para el Sistema Operativo Gastronómico TOCINETA.

---

## 1. Arquitectura de Respaldo Cifrado Exclusivo por Telegram (R4)

El proceso de respaldo de TOCINETA está diseñado para ser seguro, tolerante a fallos y sin interrupciones operativas:

1. **Snapshot en Caliente (SQLite Online Backup API):**  
   Se utiliza la API nativa de respaldo de SQLite a través de `better-sqlite3`. Esto permite capturar el estado íntegro de la base de datos sin detener el servidor ni bloquear las transacciones activas en modo WAL.
2. **Incrustación de Manifiesto Oficial:**  
   Se inyecta una tabla temporal `_backup_manifest` con la versión del sistema, fecha de creación, ID de jornada y hash de cabeza de la cadena inmutable de auditoría (`audit_events`).
3. **Cifrado Criptográfico con Age:**  
   El snapshot se cifra empleando el estándar Age (X25519 + ChaCha20-Poly1305). Únicamente las claves públicas autorizadas de la Administración y el Custodio Técnico Seguro pueden descifrar el contenido. La computadora local jamás almacena claves privadas.
4. **Almacenamiento USB Opcional:**  
   La variable `USB_BACKUP_PATH` es completamente opcional. Si la unidad o ruta USB configurada existe en el equipo, se guarda una copia del archivo cifrado `.db.age`. Si la ruta no existe o el dispositivo externo está desconectado, el sistema registra un aviso informativo y continúa sin interrupciones hacia el envío por Telegram.
5. **Envío Directo a Telegram vía `sendDocument`:**  
   El archivo cifrado `.db.age` se envía directamente como documento al chat de Telegram del administrador mediante la API oficial de bots (`https://api.telegram.org/bot<TOKEN>/sendDocument`), garantizando que la administración reciba el respaldo cifrado en su teléfono o dispositivo seguro.
6. **Auditoría y Registro de Fallas:**  
   Todo respaldo exitoso se asienta en `backups_log` y `audit_events`. Si ocurre cualquier anomalía, el evento se documenta de inmediato en la tabla `server_errors`.

---

## 2. Configuración del Bot de Telegram (R2 y R4)

El bot de Telegram cumple una función dual en TOCINETA:
- **Recepción de Respaldos Cifrados (.db.age):** Entrega diaria del snapshot cifrado con Age en el chat privado del administrador.
- **Reporte Diario de Salud:** Resumen de operatividad matutino.
- **Alerta Inmediata:** Notificación urgente cuando el servidor no responde o cuando se registran fallas críticas en la base de datos (`server_errors`).

### 2.1. Crear el Bot en @BotFather

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

### 2.2. Obtener el Chat ID

El mensaje y los respaldos pueden enviarse al chat individual del administrador o a un grupo/canal donde esté el equipo directivo.

#### Opción A: Chat Directo Individual (Recomendado para Administrador)
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

## 3. Configuración en el Archivo `.env`

Configurar las siguientes variables en el archivo `.env` en la raíz del proyecto:

```ini
# ------------------------------------------------------------------------------
# 4. RESPALDOS EN DISPOSITIVOS EXTERNOS (USB) Y TELEGRAM
# ------------------------------------------------------------------------------
# Ruta de respaldo en unidad USB (opcional: si no existe, solo se envía a Telegram)
USB_BACKUP_PATH=./data/backups/usb

# ------------------------------------------------------------------------------
# 5. MONITOREO, ALERTAS Y RESPALDOS POR TELEGRAM
# ------------------------------------------------------------------------------
# Token del bot de Telegram emitido por @BotFather (requerido para alertas y respaldos)
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ123456789

# Chat ID o identificador del administrador/canal para recibir alertas y archivos .db.age
TELEGRAM_CHAT_ID=987654321
```

> **Nota sobre Google Drive:** El sistema ya no requiere la aplicación de Google Drive ni la variable `DRIVE_SYNC_PATH`. El canal de entrega en la nube es 100% exclusivo y directo vía Telegram.

---

## 4. Automatización en el Programador de Tareas de Windows (Task Scheduler)

Para garantizar la ejecución desatendida y continua en producción, se programan tres tareas automáticas:

| Tarea | Script | Horario Sugerido | Descripción |
| :--- | :--- | :--- | :--- |
| **`Tocineta-Actualizador-Automatico`** | `scripts/actualizar.ps1` | **05:00 AM** (Diario) | Búsqueda de releases en GitHub, verificación SHA-256, migración y rollback automático (R3). |
| **`Tocineta-Respaldo-Drive`** | `scripts/respaldo-drive.ps1` | **05:30 AM** (Diario) | Generación de snapshot en caliente, cifrado Age y envío directo a Telegram vía sendDocument (R4). |
| **`Tocineta-Alertas-Telegram`** | `scripts/alertas-telegram.ps1` | **08:00 AM** (Diario) | Chequeo de salud del servidor y base de datos, reporte diario a Telegram (R2). |

---

## 5. Procedimiento de Verificación y Pruebas de Respaldo

### 5.1. Probar el Respaldo Cifrado a Telegram
Ejecutar en PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\respaldo-drive.ps1
```
Verificar que:
- Si existe `USB_BACKUP_PATH`, se cree el archivo `.db.age` en la carpeta local.
- Si no existe `USB_BACKUP_PATH`, se muestre el aviso `[AVISO] La ruta USB_BACKUP_PATH no existe...` y continúe.
- Se envíe el archivo `.db.age` al chat de Telegram con la confirmación:
  `[OK] Proceso de respaldo completado y entregado a Telegram en X.X s.`
- El administrador reciba el archivo `.db.age` con su checksum SHA-256 y tamaño en Telegram.

### 5.2. Probar las Alertas de Telegram (Simulación)
Ejecutar en PowerShell con la bandera `-DryRun`:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\alertas-telegram.ps1 -DryRun
```
Verificar que el mensaje generado cumpla el formato oficial:
- En estado normal: `"TOCINETA Sano: [Fecha]. Último respaldo: [Fecha]. Errores en 24h: [Cantidad]"`
- En estado crítico: `"ALERTA INMEDIATA - TOCINETA CRITICO ..."`

---

## 6. Script y Ruta de Diagnóstico Forense (R1)

El sistema incluye una herramienta integral de diagnóstico forense para resolución de incidencias y soporte técnico.

### 6.1. Contenido del Paquete de Diagnóstico (.zip)

El archivo `.zip` generado contiene tres artefactos fundamentales:

1. **`server-errors.json`:**  
   Los últimos 50 registros de fallas de la tabla `server_errors` de SQLite, procesados por un filtro de sanitización estricto:
   - Se redactan todos los PINs (`pin`, `adminPin`, `oldPin`, `newPin`, `pin_hash`, `pin_salt`).
   - Se redactan contraseñas, secretos, tokens Bearer y encabezados de autorización.
   - Se redactan datos personales (teléfonos, cédulas, números de tarjeta).
2. **`logs/`:**  
   Copia de todos los archivos de registro generados o modificados en las últimas 24 horas dentro de `apps/server/logs`. Si no existen logs en dicho período, se genera un archivo informativo `sin-logs-recientes.txt`.
3. **`sistema-info.json`:**  
   Metadatos del sistema leídos directamente de `package.json` y del entorno operativo (versión actual, plataforma, arquitectura, versión de Node.js, uso de memoria y fecha exacta de captura).

### 6.2. Uso por Consola (PowerShell)

Para generar el diagnóstico manualmente desde una terminal en el equipo:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\diagnostico.ps1
```

Opciones disponibles:
- **Destino personalizado:**  
  `powershell -ExecutionPolicy Bypass -File scripts\diagnostico.ps1 -OutputPath "C:\Ruta\diagnostico-personalizado.zip"`
- **Base de datos alternativa:**  
  `powershell -ExecutionPolicy Bypass -File scripts\diagnostico.ps1 -DbPath "data\tocineta.db"`
- **Directorio de logs alternativo:**  
  `powershell -ExecutionPolicy Bypass -File scripts\diagnostico.ps1 -LogsDir "apps\server\logs"`

El script compilará los artefactos, los comprimirá con `Compress-Archive` en `./data/diagnostico/diagnostico-tocineta-<timestamp>.zip` y limpiará cualquier archivo temporal.

### 6.3. Descarga Web desde el Backend (Solo Rol Administrador)

TOCINETA expone un endpoint seguro y exclusivo para administradores autenticados que permite descargar el paquete `.zip` directamente desde el navegador web o la interfaz administrativa:

- **Ruta principal:** `GET /api/support/diagnostico`
- **Ruta alias:** `GET /api/admin/diagnostico`
- **Control de acceso:** Exige sesión activa y rol `'admin'`. Cualquier intento con otros roles (`cajera`, `mesonero`, etc.) o sin sesión es rechazado de inmediato con `401 Unauthorized` o `403 Forbidden`.
- **Encabezados de respuesta:**
  - `Content-Type: application/zip`
  - `Content-Disposition: attachment; filename="diagnostico-tocineta-<timestamp>.zip"`

#### Ejemplo de Descarga vía Navegador Web / Frontend:
El administrador, con su sesión activa en TOCINETA, puede iniciar la descarga usando el cliente autenticado:
```typescript
import { downloadWithAuth } from './lib/download-file.js';

await downloadWithAuth('/api/support/diagnostico', 'diagnostico-tocineta.zip');
```

#### Ejemplo de Descarga vía Consola con curl:
```bash
curl -H "Authorization: Bearer <TOKEN_ADMIN>" \
     -o diagnostico-tocineta.zip \
     http://localhost:3000/api/support/diagnostico
```

---

## 7. Protocolo de Recuperación ante Desastres

Para restaurar cualquier respaldo `.db.age` recibido por Telegram o recuperado de una unidad USB:
1. Descargar el archivo `.db.age` desde el chat de Telegram o conectarlo desde la unidad USB.
2. Ejecutar el script interactivo de restauración verificado:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\restore-backup.ps1 -BackupPath "C:\ruta\al\tocineta-backup.db.age"
   ```
3. El script solicitará la clave privada de recuperación de la Administración, validará la integridad de SQLite y comprobará la cadena inmutable de auditoría antes de restablecer los datos de producción.
