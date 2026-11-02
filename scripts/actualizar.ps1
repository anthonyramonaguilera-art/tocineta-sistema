<#
.SYNOPSIS
    Script oficial de actualizacion automatica via GitHub Releases para el Sistema TOCINETA.
.DESCRIPTION
    Realiza la actualizacion desatendida del sistema operativo local:
      1. Consulta la API de GitHub Releases para el repositorio configurado.
      2. Descarga el paquete .zip de la ultima version y valida su hash SHA-256 si esta provisto.
      3. Detiene de forma segura el servicio de Windows (Stop-Service).
      4. Ejecuta un respaldo preventivo de la base de datos SQLite y del codigo previo.
      5. Extrae el nuevo contenido preservando datos locales (data/), variables (.env) y logs.
      6. Ejecuta las migraciones de base de datos necesarias (pnpm run db:migrate).
      7. Reinicia el servicio de Windows (Start-Service).
      8. Verifica la disponibilidad del sistema realizando un GET a /api/health.
      9. Si el health-check o las migraciones fallan, revierte automaticamente al respaldo previo (Rollback).
.PARAMETER Action
    Accion a ejecutar: Run (predeterminada), InstallTask, UninstallTask, StatusTask.
.PARAMETER Repository
    Repositorio en GitHub en formato 'propietario/repositorio'.
.PARAMETER Token
    Personal Access Token (PAT) de GitHub con permiso 'contents:read'.
.PARAMETER TaskTime
    Hora programada para la tarea diaria en Windows (por defecto "05:00").
.PARAMETER ServiceName
    Nombre del servicio de Windows a gestionar.
.PARAMETER ApiUrl
    URL de verificacion de salud (por defecto http://localhost:PORT/api/health).
.PARAMETER LocalZip
    Ruta a un archivo .zip local para actualizacion o pruebas locales.
.PARAMETER ExpectedHash
    Hash SHA-256 esperado (opcional para sobrescribir o validar manualmente).
.PARAMETER Force
    Fuerza la reinstalacion aunque la version instalada sea la misma que la del release.
.PARAMETER DryRun
    Ejecuta en modo simulacion sin alterar servicios ni archivos del sistema.
.PARAMETER SimulateRollback
    Simula un fallo en /api/health para verificar la capacidad de rollback automatico.
#>

[CmdletBinding()]
param (
    [ValidateSet("Run", "InstallTask", "UninstallTask", "StatusTask")]
    [string]$Action = "Run",

    [Parameter(Mandatory = $false)]
    [string]$Repository,

    [Parameter(Mandatory = $false)]
    [string]$Token,

    [Parameter(Mandatory = $false)]
    [string]$TaskTime = "05:00",

    [Parameter(Mandatory = $false)]
    [string]$ServiceName,

    [Parameter(Mandatory = $false)]
    [string]$ApiUrl,

    [Parameter(Mandatory = $false)]
    [string]$LocalZip,

    [Parameter(Mandatory = $false)]
    [string]$ExpectedHash,

    [Parameter(Mandatory = $false)]
    [switch]$Force,

    [Parameter(Mandatory = $false)]
    [switch]$DryRun,

    [Parameter(Mandatory = $false)]
    [switch]$SimulateRollback
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$taskName = "Tocineta-Actualizador-Automatico"
$powershellExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
if (-not $powershellExe) { $powershellExe = "powershell.exe" }

# ==============================================================================
# GESTION DE TAREA PROGRAMADA EN WINDOWS (Task Scheduler)
# ==============================================================================
function Get-TaskStatus {
    param([string]$Name)
    try {
        return Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    } catch {
        return $null
    }
}

if ($Action -eq "StatusTask") {
    Write-Host ""
    Write-Host "Consultando estado de la tarea programada '$taskName':" -ForegroundColor Cyan
    $t = Get-TaskStatus -Name $taskName
    if ($t) {
        Write-Host "  -> $taskName : [REGISTRADA] Estado: $($t.State)" -ForegroundColor Green
    } else {
        Write-Host "  -> $taskName : [NO ENCONTRADA]" -ForegroundColor DarkGray
    }
    Write-Host ""
    exit 0
}

if ($Action -eq "UninstallTask") {
    Write-Host ""
    Write-Host "Desinstalando tarea programada '$taskName'..." -ForegroundColor Yellow
    if (Get-TaskStatus -Name $taskName) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "[OK] Tarea '$taskName' eliminada exitosamente." -ForegroundColor Green
    } else {
        Write-Host "  Tarea '$taskName' no estaba registrada." -ForegroundColor Gray
    }
    Write-Host ""
    exit 0
}

if ($Action -eq "InstallTask") {
    Write-Host ""
    Write-Host "Configurando tarea programada '$taskName' ($TaskTime diario)..." -ForegroundColor Cyan
    $scriptPath = $MyInvocation.MyCommand.Path
    $actionParam = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
    $taskAction = New-ScheduledTaskAction -Execute $powershellExe -Argument $actionParam -WorkingDirectory $repoRoot
    $taskTrigger = New-ScheduledTaskTrigger -Daily -At $TaskTime
    $taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

    try {
        Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Principal $principal -Description "Actualizador automatico diario de TOCINETA via GitHub Releases a las 05:00 AM." -Force | Out-Null
        Write-Host "[OK] '$taskName' registrada exitosamente para ejecutarse a las $TaskTime." -ForegroundColor Green
    } catch {
        Write-Host "[AVISO] Registro con Register-ScheduledTask requirio alternativa schtasks: $($_.Exception.Message)" -ForegroundColor Yellow
        $schCmd = "schtasks.exe /create /tn `"$taskName`" /tr `"$powershellExe $actionParam`" /sc daily /st $TaskTime /f"
        Invoke-Expression $schCmd
    }
    Write-Host ""
    exit 0
}

# ==============================================================================
# CARGA DE VARIABLES Y CONFIGURACION LOCAL (.env)
# ==============================================================================
$envMap = @{}
$envPath = Join-Path $repoRoot ".env"
if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $envMap[$parts[0].Trim()] = $parts[1].Trim()
        }
    }
}

# 1. Repositorio de GitHub
if (-not $Repository -or $Repository.Trim() -eq "") {
    if ($envMap.ContainsKey("GITHUB_REPO") -and $envMap["GITHUB_REPO"]) {
        $Repository = $envMap["GITHUB_REPO"]
    } elseif ($env:GITHUB_REPO) {
        $Repository = $env:GITHUB_REPO
    } elseif ($env:GITHUB_REPOSITORY) {
        $Repository = $env:GITHUB_REPOSITORY
    } else {
        # Autodeteccion a partir de git remote origin
        $originUrl = (git config --get remote.origin.url 2>$null)
        if ($originUrl -match 'github\.com[:/](?<repo>[^/]+/[^/.]+?)(?:\.git)?$') {
            $Repository = $Matches['repo']
        }
    }
}

# 2. Token de GitHub
if (-not $Token -or $Token.Trim() -eq "") {
    if ($envMap.ContainsKey("GITHUB_TOKEN") -and $envMap["GITHUB_TOKEN"]) {
        $Token = $envMap["GITHUB_TOKEN"]
    } elseif ($env:GITHUB_TOKEN) {
        $Token = $env:GITHUB_TOKEN
    } elseif ($env:GH_TOKEN) {
        $Token = $env:GH_TOKEN
    }
}

# 3. Nombre del Servicio de Windows
if (-not $ServiceName -or $ServiceName.Trim() -eq "") {
    if ($envMap.ContainsKey("SERVICE_NAME") -and $envMap["SERVICE_NAME"]) {
        $ServiceName = $envMap["SERVICE_NAME"]
    } elseif ($env:SERVICE_NAME) {
        $ServiceName = $env:SERVICE_NAME
    } else {
        # Autodeteccion: buscar servicio registrado que empiece por Tocineta
        $detectedService = Get-Service | Where-Object { $_.Name -like "Tocineta*" } | Select-Object -First 1
        if ($detectedService) {
            $ServiceName = $detectedService.Name
        } else {
            $ServiceName = "TocinetaServer"
        }
    }
}

# 4. Puerto y URL de Health-Check
$port = 3000
if ($envMap.ContainsKey("PORT") -and $envMap["PORT"]) {
    $port = [int]$envMap["PORT"]
} elseif ($env:PORT) {
    $port = [int]$env:PORT
}

if (-not $ApiUrl -or $ApiUrl.Trim() -eq "") {
    $ApiUrl = "http://localhost:$port/api/health"
}

# 5. Version local actual desde package.json
$pkgJsonPath = Join-Path $repoRoot "package.json"
$currentVersion = "0.0.0"
if (Test-Path $pkgJsonPath) {
    try {
        $pkgObj = Get-Content $pkgJsonPath -Raw | ConvertFrom-Json
        if ($pkgObj.version) {
            $currentVersion = $pkgObj.version.Trim()
        }
    } catch {}
}

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "     SISTEMA TOCINETA - ACTUALIZADOR AUTOMATICO (R3)            " -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Fecha y Hora:       $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host "Repositorio:        $(if ($Repository) { $Repository } else { '[NO DETECTADO]' })" -ForegroundColor Gray
Write-Host "Version Actual:     $currentVersion" -ForegroundColor Gray
Write-Host "Servicio Windows:   $ServiceName" -ForegroundColor Gray
Write-Host "URL Health-Check:   $ApiUrl" -ForegroundColor Gray
if ($DryRun) {
    Write-Host "MODO SIMULACION:    Activado (-DryRun). No se aplicaran cambios reales." -ForegroundColor Magenta
}
Write-Host ""

# ==============================================================================
# FUNCIONES AUXILIARES
# ==============================================================================

# Descarga de assets de GitHub compatible con repositorios privados y redireccion 302 S3
function Download-GitHubAsset {
    param (
        [Parameter(Mandatory = $true)]
        [string]$AssetUrl,
        [Parameter(Mandatory = $false)]
        [string]$AuthToken,
        [Parameter(Mandatory = $true)]
        [string]$OutputFile
    )

    $parentDir = Split-Path -Parent $OutputFile
    if ($parentDir -and -not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $req = [System.Net.HttpWebRequest]::Create($AssetUrl)
    $req.AllowAutoRedirect = $false
    $req.UserAgent = "TOCINETA-Actualizador/1.0"
    $req.Headers.Add("Accept", "application/octet-stream")
    if ($AuthToken) {
        $req.Headers.Add("Authorization", "Bearer $AuthToken")
    }

    try {
        $resp = $req.GetResponse()
        $stream = $resp.GetResponseStream()
        $fs = [System.IO.File]::Create($OutputFile)
        $stream.CopyTo($fs)
        $fs.Close()
        $stream.Close()
        $resp.Close()
    } catch [System.Net.WebException] {
        $webEx = $_.Exception
        if ($webEx.Response -and [int]$webEx.Response.StatusCode -ge 300 -and [int]$webEx.Response.StatusCode -lt 400) {
            $location = $webEx.Response.Headers["Location"]
            $webEx.Response.Close()
            if (-not $location) {
                throw "Redireccion recibida sin encabezado 'Location' al consultar asset de GitHub."
            }
            Invoke-WebRequest -Uri $location -OutFile $OutputFile -UseBasicParsing -UserAgent "TOCINETA-Actualizador/1.0"
        } else {
            throw
        }
    }
}

# Extractor de Hash SHA-256 de 64 caracteres
function Extract-Sha256Hash {
    param(
        [string]$Content,
        [string]$FileName
    )
    if (-not $Content) { return $null }

    if ($FileName) {
        $escaped = [regex]::Escape($FileName)
        if ($Content -match "([a-fA-F0-9]{64})\s+[*]?$escaped") {
            return $Matches[1].ToLower()
        }
    }

    if ($Content -match "(?i)sha256[:\s=]+([a-fA-F0-9]{64})") {
        return $Matches[1].ToLower()
    }

    if ($Content -match "\b([a-fA-F0-9]{64})\b") {
        return $Matches[1].ToLower()
    }

    return $null
}

# Mecanismo de reversion automatica (Rollback)
function Invoke-Rollback {
    param (
        [string]$Reason,
        [string]$BackupDir,
        [string]$TargetService,
        [string]$HealthUrl,
        [string]$RootPath
    )
    Write-Host ""
    Write-Host "=================================================================" -ForegroundColor Red
    Write-Host "    FALLO EN ACTUALIZACION: EJECUTANDO ROLLBACK AUTOMATICO       " -ForegroundColor Red
    Write-Host "=================================================================" -ForegroundColor Red
    Write-Host "Motivo del rollback: $Reason" -ForegroundColor Yellow

    # 1. Detener servicio si se encuentra en ejecucion
    try {
        $svc = Get-Service -Name $TargetService -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -ne "Stopped") {
            Write-Host "Deteniendo servicio '$TargetService' para proceder con la restauracion..." -ForegroundColor Gray
            Stop-Service -Name $TargetService -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }
    } catch {}

    # 2. Restaurar archivos de codigo previos si se preservaron
    $appPrevDir = Join-Path $BackupDir "app_prev"
    if (Test-Path $appPrevDir) {
        Write-Host "Restaurando archivos de codigo a la version previa..." -ForegroundColor Yellow
        robocopy $appPrevDir $RootPath /E /NFL /NDL /NJH /NJS /XD data logs .git node_modules /XF *.db *.log .env | Out-Null
        Write-Host "[OK] Archivos de la aplicacion restaurados al estado anterior." -ForegroundColor Green
    }

    # 3. Restaurar base de datos SQLite del respaldo preventivo
    $backupDb = Join-Path $BackupDir "tocineta.db"
    $activeDb = Join-Path $RootPath "data\tocineta.db"
    if (Test-Path $backupDb) {
        Write-Host "Restaurando base de datos SQLite desde: $backupDb..." -ForegroundColor Yellow
        Remove-Item "$activeDb-wal" -Force -ErrorAction SilentlyContinue
        Remove-Item "$activeDb-shm" -Force -ErrorAction SilentlyContinue
        Copy-Item $backupDb -Destination $activeDb -Force
        
        $backupWal = Join-Path $BackupDir "tocineta.db-wal"
        if (Test-Path $backupWal) { Copy-Item $backupWal -Destination "$activeDb-wal" -Force }
        $backupShm = Join-Path $BackupDir "tocineta.db-shm"
        if (Test-Path $backupShm) { Copy-Item $backupShm -Destination "$activeDb-shm" -Force }
        Write-Host "[OK] Base de datos SQLite restaurada con exito." -ForegroundColor Green
    }

    # 4. Iniciar servicio de Windows
    try {
        $svc = Get-Service -Name $TargetService -ErrorAction SilentlyContinue
        if ($svc) {
            Write-Host "Reiniciando servicio '$TargetService'..." -ForegroundColor Cyan
            Start-Service -Name $TargetService -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 3
        }
    } catch {}

    # 5. Comprobar salud post-rollback
    Write-Host "Verificando salud del sistema restaurado..." -ForegroundColor Cyan
    try {
        $rbCheck = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 10 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($rbCheck.status -eq "ok") {
            Write-Host "[OK] Sistema operativo restaurado y saludable (version: $($rbCheck.version))." -ForegroundColor Green
        } else {
            Write-Host "[AVISO] El sistema respondio tras el rollback pero requiere supervision." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[AVISO] No se pudo conectar a $HealthUrl tras el rollback. Revise logs del servidor." -ForegroundColor Yellow
    }

    # 6. Registrar en bitacora de rollback
    $logsFolder = Join-Path $RootPath "logs"
    if (-not (Test-Path $logsFolder)) { New-Item -ItemType Directory -Path $logsFolder -Force | Out-Null }
    $rbLog = Join-Path $logsFolder "rollback.log"
    $entry = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ROLLBACK EJECUTADO. Motivo: $Reason. Respaldo: $BackupDir"
    Add-Content -Path $rbLog -Value $entry -ErrorAction SilentlyContinue

    Write-Host ""
    Write-Host "Rollback completado satisfactoriamente. La version fallida fue descartada." -ForegroundColor Yellow
    Write-Host "=================================================================" -ForegroundColor Red
    Write-Host ""
}

# ==============================================================================
# FASE 1: OBTENCION Y VERIFICACION DEL RELEASE
# ==============================================================================
$tempDir = Join-Path $env:TEMP "tocineta_actualizador_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

$downloadedZip = $null
$expectedHashValue = $ExpectedHash
$targetVersion = $null
$backupDir = $null

try {
    if ($LocalZip) {
        Write-Host "Utilizando archivo de release local: $LocalZip" -ForegroundColor Cyan
        if (-not (Test-Path $LocalZip)) {
            throw "El archivo ZIP local especificado no existe: $LocalZip"
        }
        $downloadedZip = (Resolve-Path $LocalZip).Path
        $targetVersion = "local-release"
    } else {
        if (-not $Repository) {
            throw "No se definio el repositorio de GitHub (GITHUB_REPO) ni se pudo inferir del control de versiones."
        }

        Write-Host "Consultando API de GitHub Releases para '$Repository'..." -ForegroundColor Cyan
        $releasesApiUrl = "https://api.github.com/repos/$Repository/releases/latest"
        $ghHeaders = @{
            "Accept" = "application/vnd.github+json"
            "X-GitHub-Api-Version" = "2022-11-28"
            "User-Agent" = "TOCINETA-Actualizador/1.0"
        }
        if ($Token) {
            $ghHeaders["Authorization"] = "Bearer $Token"
        }

        $latestRelease = $null
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $latestRelease = Invoke-RestMethod -Uri $releasesApiUrl -Headers $ghHeaders -Method Get -UseBasicParsing
        } catch {
            $statusErr = $_.Exception.Message
            if (-not $Token) {
                Write-Host "[AVISO] La consulta a la API de GitHub fallo y no se proporciono un GITHUB_TOKEN." -ForegroundColor Yellow
                Write-Host "Si el repositorio es privado, configure GITHUB_TOKEN en el archivo .env." -ForegroundColor Yellow
            }
            throw "No se pudo obtener el ultimo release de GitHub: $statusErr"
        }

        $targetVersion = $latestRelease.tag_name
        $cleanTarget = $targetVersion.TrimStart('v').TrimStart('V')
        $cleanCurrent = $currentVersion.TrimStart('v').TrimStart('V')

        Write-Host "Ultima version disponible en GitHub: $targetVersion (Publicado: $($latestRelease.published_at))" -ForegroundColor DarkCyan

        # Comparar versiones
        if ($cleanTarget -eq $cleanCurrent -and -not $Force) {
            Write-Host ""
            Write-Host "[OK] El sistema ya se encuentra en la version mas reciente ($currentVersion)." -ForegroundColor Green
            Write-Host "No se requieren actualizaciones. Operacion finalizada sin alteraciones." -ForegroundColor Gray
            Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
            exit 0
        }

        Write-Host ""
        Write-Host "Nueva version detectada: $cleanCurrent -> $cleanTarget. Procediendo a descargar..." -ForegroundColor Yellow

        # Localizar asset ZIP
        $zipAsset = $latestRelease.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
        if (-not $zipAsset) {
            throw "El Release '$targetVersion' no incluye ningun archivo .zip en sus assets."
        }

        $targetZipName = $zipAsset.name
        $downloadedZip = Join-Path $tempDir $targetZipName

        Write-Host "Descargando paquete de actualizacion ($targetZipName)..." -ForegroundColor Cyan
        Download-GitHubAsset -AssetUrl $zipAsset.url -AuthToken $Token -OutputFile $downloadedZip
        $zipSizeMb = [math]::Round(((Get-Item $downloadedZip).Length / 1MB), 2)
        Write-Host "[OK] Paquete descargado: $downloadedZip ($zipSizeMb MB)" -ForegroundColor Green

        # Buscar hash SHA-256 en assets si no fue provisto manualmente
        if (-not $expectedHashValue) {
            $hashAsset = $latestRelease.assets | Where-Object {
                $_.name -like "*.sha256" -or $_.name -like "*.sha256sum" -or $_.name -like "*checksum*" -or $_.name -like "*SHA256SUMS*"
            } | Select-Object -First 1

            if ($hashAsset) {
                Write-Host "Descargando archivo de verificacion ($($hashAsset.name))..." -ForegroundColor DarkCyan
                $hashFilePath = Join-Path $tempDir $hashAsset.name
                Download-GitHubAsset -AssetUrl $hashAsset.url -AuthToken $Token -OutputFile $hashFilePath
                $hashContent = Get-Content $hashFilePath -Raw
                $expectedHashValue = Extract-Sha256Hash -Content $hashContent -FileName $targetZipName
            }
        }

        # Si aun no se encuentra, buscar en las notas del release (body)
        if (-not $expectedHashValue -and $latestRelease.body) {
            $expectedHashValue = Extract-Sha256Hash -Content $latestRelease.body -FileName $targetZipName
        }
    }

    # ==============================================================================
    # FASE 2: VERIFICACION DEL HASH SHA-256
    # ==============================================================================
    Write-Host ""
    Write-Host "Verificando integridad del archivo descargado..." -ForegroundColor Cyan
    $actualHash = (Get-FileHash -Path $downloadedZip -Algorithm SHA256).Hash.ToLower()
    Write-Host "  -> SHA-256 Calculado: $actualHash" -ForegroundColor DarkGray

    if ($expectedHashValue) {
        $expectedNorm = $expectedHashValue.Trim().ToLower()
        Write-Host "  -> SHA-256 Esperado:   $expectedNorm" -ForegroundColor DarkGray
        if ($actualHash -ne $expectedNorm) {
            throw "ERROR DE FIRMA/HASH: La firma SHA-256 calculada ($actualHash) no coincide con la esperada ($expectedNorm). Actualizacion abortada por seguridad."
        }
        Write-Host "[OK] Hash SHA-256 verificado exitosamente." -ForegroundColor Green
    } else {
        Write-Host "[AVISO] El release no incluyo archivo de firma o hash SHA-256. Continuando con la actualizacion..." -ForegroundColor Yellow
    }

    if ($DryRun) {
        Write-Host ""
        Write-Host "[SIMULACION COMPLETADA] Validacion de descarga y verificacion de hash concluidas con exito." -ForegroundColor Magenta
        Write-Host "En ejecucion real, a continuacion se detendria el servicio, respaldaria la DB y aplicaria el ZIP." -ForegroundColor Magenta
        Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        exit 0
    }

    # ==============================================================================
    # FASE 3: DETENER EL SERVICIO DE WINDOWS (Stop-Service)
    # ==============================================================================
    $serviceObj = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($serviceObj) {
        if ($serviceObj.Status -ne "Stopped") {
            Write-Host ""
            Write-Host "Deteniendo servicio de Windows '$ServiceName' (Stop-Service)..." -ForegroundColor Cyan
            Stop-Service -Name $ServiceName -Force
            $stopTimeout = 30
            $waited = 0
            while ((Get-Service -Name $ServiceName).Status -ne "Stopped" -and $waited -lt $stopTimeout) {
                Start-Sleep -Seconds 1
                $waited++
            }
            if ((Get-Service -Name $ServiceName).Status -ne "Stopped") {
                throw "No se pudo detener el servicio '$ServiceName' dentro del tiempo limite de $stopTimeout s."
            }
            Write-Host "[OK] Servicio '$ServiceName' detenido exitosamente." -ForegroundColor Green
        } else {
            Write-Host "Servicio '$ServiceName' ya se encontraba detenido." -ForegroundColor Gray
        }
    } else {
        Write-Host "[INFO] Servicio de Windows '$ServiceName' no registrado. Continuando sin Stop-Service." -ForegroundColor Yellow
    }

    # ==============================================================================
    # FASE 4: RESPALDO PREVENTIVO DE SQLITE Y ARCHIVOS PREVIOS
    # ==============================================================================
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupDir = Join-Path $repoRoot "data\backups\pre-update\$timestamp"
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

    Write-Host ""
    Write-Host "Creando respaldo preventivo de seguridad..." -ForegroundColor Cyan

    # Respaldo SQLite
    $dbFile = Join-Path $repoRoot "data\tocineta.db"
    if (Test-Path $dbFile) {
        Copy-Item $dbFile -Destination (Join-Path $backupDir "tocineta.db") -Force
        if (Test-Path "$dbFile-wal") { Copy-Item "$dbFile-wal" -Destination (Join-Path $backupDir "tocineta.db-wal") -Force }
        if (Test-Path "$dbFile-shm") { Copy-Item "$dbFile-shm" -Destination (Join-Path $backupDir "tocineta.db-shm") -Force }
        Write-Host "[OK] Base de datos SQLite respaldada en: $backupDir" -ForegroundColor Green
    }

    # Respaldo de archivos para rollback
    $appPrevDir = Join-Path $backupDir "app_prev"
    New-Item -ItemType Directory -Path $appPrevDir -Force | Out-Null
    Write-Host "Respaldando estructura previa de la aplicacion para permitir rollback..." -ForegroundColor DarkCyan
    robocopy $repoRoot $appPrevDir /E /NFL /NDL /NJH /NJS /XD data logs .git node_modules dist test-results playwright-report /XF *.db *.log .env *.zip | Out-Null
    Write-Host "[OK] Snapshot de la aplicacion asegurado." -ForegroundColor Green

    # ==============================================================================
    # FASE 5: EXTRACCION DEL NUEVO ZIP SOBRE LA APLICACION
    # ==============================================================================
    Write-Host ""
    Write-Host "Extrayendo nueva version sobre el sistema..." -ForegroundColor Cyan
    $stagingDir = Join-Path $tempDir "staging"
    New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
    Expand-Archive -Path $downloadedZip -DestinationPath $stagingDir -Force

    $subItems = Get-ChildItem -Path $stagingDir
    if ($subItems.Count -eq 1 -and $subItems[0].PSIsContainer -and -not (Test-Path (Join-Path $stagingDir "package.json"))) {
        $sourceDir = $subItems[0].FullName
    } else {
        $sourceDir = $stagingDir
    }

    # Copiar asegurando NO sobreescribir data/, .env, logs/, .git/
    robocopy $sourceDir $repoRoot /E /NFL /NDL /NJH /NJS /XD data logs .git node_modules /XF *.db *.log .env | Out-Null
    $rcCode = $LASTEXITCODE
    if ($rcCode -ge 8) {
        throw "Robocopy reporto error al desplegar los archivos del release (codigo de salida $rcCode)."
    }
    Write-Host "[OK] Archivos del release desplegados correctamente." -ForegroundColor Green

    # ==============================================================================
    # FASE 6: MIGRACIONES DE LA BASE DE DATOS (pnpm run db:migrate)
    # ==============================================================================
    Write-Host ""
    Write-Host "Ejecutando migraciones de base de datos si es necesario (pnpm run db:migrate)..." -ForegroundColor Cyan
    $migrateResult = & pnpm run db:migrate 2>&1
    $migrateCode = $LASTEXITCODE
    if ($migrateCode -ne 0) {
        Write-Host ($migrateResult | Out-String)
        throw "La ejecucion de pnpm run db:migrate fallo con codigo $migrateCode."
    }
    Write-Host "[OK] Migraciones ejecutadas exitosamente." -ForegroundColor Green

    # ==============================================================================
    # FASE 7: INICIAR EL SERVICIO DE WINDOWS (Start-Service)
    # ==============================================================================
    if ($serviceObj) {
        Write-Host ""
        Write-Host "Iniciando servicio de Windows '$ServiceName' (Start-Service)..." -ForegroundColor Cyan
        Start-Service -Name $ServiceName
        $startTimeout = 30
        $waited = 0
        while ((Get-Service -Name $ServiceName).Status -ne "Running" -and $waited -lt $startTimeout) {
            Start-Sleep -Seconds 1
            $waited++
        }
        if ((Get-Service -Name $ServiceName).Status -ne "Running") {
            throw "El servicio '$ServiceName' no alcanzo el estado 'Running' dentro del tiempo limite de $startTimeout s."
        }
        Write-Host "[OK] Servicio '$ServiceName' iniciado exitosamente." -ForegroundColor Green
    } else {
        Write-Host "[INFO] Servicio de Windows '$ServiceName' no registrado. Omitiendo Start-Service." -ForegroundColor Yellow
    }

    # ==============================================================================
    # FASE 8: VERIFICACION DE SALUD (GET /api/health)
    # ==============================================================================
    Write-Host ""
    Write-Host "Verificando salud del sistema en $ApiUrl..." -ForegroundColor Cyan

    if ($SimulateRollback) {
        throw "Simulacion de fallo en health-check activada manualmente (-SimulateRollback)."
    }

    $healthOk = $false
    $lastHealthError = $null
    $maxAttempts = 15
    $pollInterval = 2

    for ($i = 1; $i -le $maxAttempts; $i++) {
        try {
            $hRes = Invoke-RestMethod -Uri $ApiUrl -Method Get -TimeoutSec 5 -UseBasicParsing
            if ($hRes.status -eq "ok") {
                $healthOk = $true
                Write-Host "[OK] Health-check exitoso en intento $i (status='$($hRes.status)', version='$($hRes.version)')." -ForegroundColor Green
                break
            } else {
                $lastHealthError = "Respuesta no es ok: $($hRes | ConvertTo-Json -Compress)"
            }
        } catch {
            $lastHealthError = $_.Exception.Message
        }
        Start-Sleep -Seconds $pollInterval
    }

    if (-not $healthOk) {
        throw "El health-check en $ApiUrl fallo tras $maxAttempts intentos. Causa: $lastHealthError"
    }

    # Guardar metadatos de actualizacion exitosa
    $updateMeta = @{
        updatedAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        previousVersion = $currentVersion
        newVersion = $targetVersion
        sha256 = $actualHash
        backupPath = $backupDir
    } | ConvertTo-Json -Depth 3

    Set-Content -Path (Join-Path $backupDir "update-meta.json") -Value $updateMeta -Force

    # Limpieza de temporales
    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host ""
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "    ACTUALIZACION COMPLETADA EXITOSAMENTE                        " -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "Nueva Version: $targetVersion" -ForegroundColor Gray
    Write-Host "Respaldo:      $backupDir" -ForegroundColor Gray
    Write-Host ""
    exit 0

} catch {
    $failureReason = $_.Exception.Message
    Write-Host ""
    Write-Host "[ERROR DETECTADO] $failureReason" -ForegroundColor Red

    # Si se creo un respaldo preventivo y no estamos en modo DryRun, ejecutar Rollback
    if ($backupDir -and (Test-Path $backupDir) -and -not $DryRun) {
        Invoke-Rollback -Reason $failureReason -BackupDir $backupDir -TargetService $ServiceName -HealthUrl $ApiUrl -RootPath $repoRoot
    }

    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}
