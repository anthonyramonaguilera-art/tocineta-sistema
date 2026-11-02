# ACTUALIZADOR AUTOMATICO VIA GITHUB RELEASES (R3) — SISTEMA TOCINETA

Este documento describe la arquitectura operativa, la configuración y el procedimiento paso a paso para publicar y desplegar actualizaciones del **Sistema Operativo Gastronómico TOCINETA** mediante GitHub Releases con verificación criptográfica y rollback automático.

---

## 1. Arquitectura y Ciclo de Vida de Actualización (R3)

El actualizador automático (`scripts/actualizar.ps1`) está diseñado para operar de forma desatendida y segura a las **05:00 AM** todos los días, garantizando cero impacto operativo durante el horario comercial del restaurante:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FLUJO DE ACTUALIZACIÓN R3                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
       1. Consulta GitHub API (/repos/{owner}/{repo}/releases/latest)
                                    │
                                    ▼
       2. Comparación de Versión: ¿Existe versión superior a la local?
             ├─ NO ──► Fin silencioso sin alterar el sistema (Código 0)
             └─ SÍ ──► Continúa
                                    │
                                    ▼
       3. Descarga de Asset .zip y Verificación de Hash SHA-256
             ├─ Hash Mismatch ──► ABORTAR INMEDIATAMENTE por seguridad
             └─ Hash OK / Ausente ──► Continúa
                                    │
                                    ▼
       4. Detención Segura del Servicio de Windows (Stop-Service)
                                    │
                                    ▼
       5. Respaldo Preventivo en Caliente (SQLite tocineta.db + Snapshot App)
                                    │
                                    ▼
       6. Extracción Atómica del ZIP (Protege data/, .env, logs/, .git/)
                                    │
                                    ▼
       7. Ejecución de Migraciones SQLite (pnpm run db:migrate)
             ├─ Fallo en db:migrate ──► ROLLBACK AUTOMÁTICO
             └─ Éxito ──► Continúa
                                    │
                                    ▼
       8. Arranque del Servicio de Windows (Start-Service)
             ├─ Timeout al arrancar ──► ROLLBACK AUTOMÁTICO
             └─ Running ──► Continúa
                                    │
                                    ▼
       9. Verificación de Salud del Sistema (GET /api/health)
             ├─ Respuesta 'ok' ──► Actualización Exitosa Confirmada
             └─ Fallo / Timeout ──► ROLLBACK AUTOMÁTICO INMEDIATO
```

---

## 2. Variables de Configuración (`.env`)

Para habilitar la sincronización con el repositorio privado de GitHub, verifique o defina las siguientes variables en el archivo `.env` en la raíz de la instalación de TOCINETA:

```ini
# ------------------------------------------------------------------------------
# 6. ACTUALIZADOR AUTOMATICO VIA GITHUB RELEASES (R3)
# ------------------------------------------------------------------------------
# Token de acceso personal de GitHub (PAT) con alcance 'contents:read' (o 'repo' para repos privados)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Repositorio oficial en GitHub (formato: organizacion/repositorio)
GITHUB_REPO=organizacion/tocineta-sistema

# Nombre del servicio de Windows a gestionar (por defecto TocinetaServer o autodetectado)
SERVICE_NAME=TocinetaServer

# Puerto local del servidor (por defecto 3000)
PORT=3000
```

> **Nota de Autodetección:** Si `GITHUB_REPO` no está configurado en `.env`, el script detecta automáticamente el repositorio a partir de la URL configurada en `git remote origin`.

---

## 3. Guía Paso a Paso: Cómo Generar y Publicar un Release en GitHub

Para que el actualizador de producción detecte, valide y aplique una nueva versión del sistema, siga rigurosamente este protocolo:

### Paso 1: Incrementar la Versión Semántica
Actualice el número de versión en `package.json` de la raíz del proyecto. Por ejemplo, pasando de `0.1.0` a `0.2.0`:
```json
{
  "name": "tocineta-os",
  "version": "0.2.0",
  "private": true
}
```

Realice el commit correspondiente:
```bash
git add package.json
git commit -m "chore(release): bump version to 0.2.0"
```

### Paso 2: Generar el Paquete ZIP Oficial
Cree un archivo comprimido limpio que contenga el código y estructura del sistema, **excluyendo** bases de datos, variables privadas (`.env`), registros de log y dependencias (`node_modules`):

Puede utilizar el script de empaquetado incluido:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\empaquetar.ps1
```

O empaquetar manualmente mediante PowerShell:
```powershell
$version = "0.2.0"
$stage = Join-Path $env:TEMP "tocineta-stage-$version"
$zip = "tocineta-v$version.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

robocopy . $stage /E /NFL /NDL /NJH /NJS `
  /XD node_modules .git data logs playwright-report test-results `
  /XF *.db *.db-wal *.db-shm *.db-journal *.age *.log .env *.zip | Out-Null

Compress-Archive -Path "$stage\*" -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force
Write-Host "Paquete generado exitosamente: $zip" -ForegroundColor Green
```

### Paso 3: Calcular el Hash Criptográfico SHA-256
Obtenga el hash del archivo ZIP generado y guarde la firma en un archivo complementario `.sha256`:
```powershell
$hash = (Get-FileHash -Path "tocineta-v0.2.0.zip" -Algorithm SHA256).Hash.ToLower()
Write-Host "Hash SHA-256: $hash" -ForegroundColor Cyan

# Crear archivo de suma de verificación
Set-Content -Path "tocineta-v0.2.0.zip.sha256" -Value "$hash  tocineta-v0.2.0.zip"
```

### Paso 4: Crear y Publicar el Release en GitHub

#### Método A: Mediante la Interfaz Web de GitHub
1. Ingrese al repositorio en GitHub (`https://github.com/organizacion/tocineta-sistema`).
2. En la barra lateral derecha, haga clic en **Releases** y luego en el botón **Draft a new release**.
3. Complete los campos requeridos:
   - **Choose a tag:** Escriba `v0.2.0` y seleccione **Create new tag: v0.2.0 on target branch** (ej. `r2/go-live` o `main`).
   - **Release title:** `Release v0.2.0` (o título descriptivo de la versión).
   - **Describe this release:** Escriba las notas de la versión e incluya obligatoriamente una línea con el hash SHA-256:
     ```markdown
     ## Registro de Cambios
     - Optimización de flujo de pedidos.
     - Actualización de esquema de datos.

     ## Integridad
     SHA256: <hash_de_64_caracteres_obtenido_en_el_paso_3>
     ```
   - **Attach binaries:** Arrastre y suba los dos archivos generados:
     1. `tocineta-v0.2.0.zip` (paquete principal de la aplicación).
     2. `tocineta-v0.2.0.zip.sha256` (archivo de verificación de hash).
   - Asegúrese de marcar la casilla **Set as the latest release**.
4. Haga clic en el botón verde **Publish release**.

#### Método B: Mediante GitHub REST API (Despliegue Continuo)
Para automatizar la creación del release desde pipelines o terminal con token:
```powershell
$token = $env:GITHUB_TOKEN
$repo = "organizacion/tocineta-sistema"
$tag = "v0.2.0"
$zipPath = "tocineta-v0.2.0.zip"
$shaPath = "tocineta-v0.2.0.zip.sha256"
$shaValue = (Get-Content $shaPath).Split(" ")[0]

# 1. Crear el Release
$bodyJson = @{
    tag_name = $tag
    name = "Release $tag"
    body = "Release de producción TOCINETA`n`nSHA256: $shaValue"
    draft = $false
    prerelease = $false
} | ConvertTo-Json

$headers = @{
    "Authorization" = "Bearer $token"
    "Accept" = "application/vnd.github+json"
}

$rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases" -Method Post -Body $bodyJson -Headers $headers

# 2. Subir Assets
$uploadUrl = $rel.upload_url.Replace("{?name,label}", "?name=tocineta-$tag.zip")
Invoke-RestMethod -Uri $uploadUrl -Method Post -InFile $zipPath -ContentType "application/zip" -Headers $headers

$uploadShaUrl = $rel.upload_url.Replace("{?name,label}", "?name=tocineta-$tag.zip.sha256")
Invoke-RestMethod -Uri $uploadShaUrl -Method Post -InFile $shaPath -ContentType "text/plain" -Headers $headers
```

---

## 4. Programación Automática a las 05:00 AM

El actualizador debe ejecutarse automáticamente todos los días a las **05:00 AM** para que el restaurante reciba las mejoras antes de iniciar la jornada matutina.

### 4.1. Instalación de la Tarea Programada de Windows

Para registrar la tarea en el Programador de Tareas de Windows (Task Scheduler) ejecute PowerShell con permisos de Administrador:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\actualizar.ps1 -Action InstallTask
```

O si prefiere configurar todas las tareas del sistema (Actualizador, Respaldo Cifrado a Drive y Alertas Telegram) en un solo comando:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\configurar-tareas-programadas.ps1 -Action Install
```

### 4.2. Verificación del Estado de la Tarea
```powershell
powershell -ExecutionPolicy Bypass -File scripts\actualizar.ps1 -Action StatusTask
```
Salida esperada:
```text
Consultando estado de la tarea programada 'Tocineta-Actualizador-Automatico':
  -> Tocineta-Actualizador-Automatico : [REGISTRADA] Estado: Ready
```

---

## 5. Ejecución Manual y Parámetros del Actualizador

El script `scripts/actualizar.ps1` puede ejecutarse manualmente en cualquier momento con las siguientes modalidades:

| Comando | Propósito |
| :--- | :--- |
| `.\scripts\actualizar.ps1` | Ejecución estándar. Si la versión es igual, no realiza cambios. |
| `.\scripts\actualizar.ps1 -Force` | Fuerza la reinstalación del release actual aunque la versión coincida. |
| `.\scripts\actualizar.ps1 -DryRun` | Modo simulación: consulta GitHub API, descarga y valida hash sin alterar el servicio ni los archivos. |
| `.\scripts\actualizar.ps1 -LocalZip "C:\ruta\release.zip"` | Despliega una actualización desde un archivo ZIP local sin consultar GitHub. |
| `.\scripts\actualizar.ps1 -SimulateRollback` | Modo auditoría: fuerza un error de health-check para verificar que el rollback automático funciona. |

---

## 6. Mecanismo de Rollback Automático ante Fallas

La resiliencia operativa es un pilar estricto de TOCINETA. El proceso de actualización incluye salvaguardas que disparan un rollback instantáneo si se presenta cualquiera de las siguientes fallas:

1. **Hash SHA-256 no coincide:** La actualización se cancela inmediatamente antes de detener el servicio o modificar un solo archivo.
2. **Error en Migraciones (`pnpm run db:migrate`):** Si una migración de base de datos falla (código de salida diferente de 0), se activa el rollback.
3. **Falla al Iniciar el Servicio (`Start-Service`):** Si el servicio de Windows no alcanza el estado `Running` en 30 segundos, se activa el rollback.
4. **Falla en el Health-Check (`GET /api/health`):** Si tras iniciar el servicio el endpoint `/api/health` no responde HTTP 200 con `{ status: "ok" }` dentro de los reintentos estipulados, se activa el rollback.

### Acciones del Rollback Automático:
1. Detiene cualquier proceso o servicio residual del servidor.
2. Restaura la base de datos `tocineta.db` (y sus archivos `-wal` y `-shm`) al estado exacto previo a la actualización desde `data/backups/pre-update/<timestamp>/`.
3. Restaura los archivos de código fuente a la versión previa.
4. Reinicia el servicio de Windows.
5. Valida nuevamente la disponibilidad de `/api/health` sobre la versión restablecida.
6. Asienta el evento detallado con causa y marca de tiempo en `logs/rollback.log`.
