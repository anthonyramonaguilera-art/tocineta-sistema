<#
.SYNOPSIS
    install-service.ps1 - Instalación de Tocineta Sonríe como Servicio de Windows mediante NSSM
.DESCRIPTION
    Instala, configura e inicia apps/server como un servicio nativo de Windows usando NSSM
    (Non-Sucking Service Manager). Configura inicio automático, retardo de reinicio ante fallos
    de 5 segundos y rotación automática de logs en ./logs.
.PARAMETER Action
    Acción a ejecutar: Install, Uninstall, Start, Stop, Status, Restart.
.PARAMETER ServiceName
    Nombre del servicio (por defecto: TocinetaSonrieServer).
#>

[CmdletBinding()]
param(
    [ValidateSet("Install", "Uninstall", "Start", "Stop", "Status", "Restart")]
    [string]$Action = "Install",

    [string]$ServiceName = "TocinetaSonrieServer"
)

# Requiere elevación de Administrador
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "⚠️ Este script requiere privilegios de Administrador para gestionar servicios de Windows."
    Write-Warning "Por favor, ejecute PowerShell como Administrador."
}

# Detección de Sistema Operativo (Compatibilidad Dual Windows 10 y Windows 11)
$osInfo = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
$osCaption = if ($osInfo) { $osInfo.Caption } else { [System.Environment]::OSVersion.VersionString }
$osBuild = if ($osInfo) { [int]$osInfo.BuildNumber } else { [System.Environment]::OSVersion.Version.Build }
$detectedEdition = if ($osBuild -ge 22000) { "Windows 11" } else { "Windows 10" }
Write-Host "🖥️ Sistema Operativo Detectado: $osCaption ($detectedEdition, Build $osBuild)" -ForegroundColor Cyan

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
    Write-Error "No se encontró 'node.exe' en el PATH del sistema."
    exit 1
}

$serverEntry = Join-Path $repoRoot "apps\server\dist\index.js"
$logsDir = Join-Path $repoRoot "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

$stdoutLog = Join-Path $logsDir "server-out.log"
$stderrLog = Join-Path $logsDir "server-err.log"

# Localizar o descargar NSSM
$nssmExe = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssmExe) {
    $localNssm = Join-Path $repoRoot "tools\nssm.exe"
    if (Test-Path $localNssm) {
        $nssmExe = $localNssm
    } else {
        Write-Host "🔍 NSSM no encontrado en PATH. Descargando binario portátil..." -ForegroundColor Yellow
        $zipUrl = "https://nssm.cc/release/nssm-2.24.zip"
        $tempZip = Join-Path $env:TEMP "nssm.zip"
        $tempExtract = Join-Path $env:TEMP "nssm_extracted"
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $zipUrl -OutFile $tempZip -UseBasicParsing
            Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force
            $archNssm = Join-Path $tempExtract "nssm-2.24\win64\nssm.exe"
            if (-not (Test-Path $archNssm)) {
                $archNssm = Join-Path $tempExtract "nssm-2.24\win32\nssm.exe"
            }
            $toolsDir = Join-Path $repoRoot "tools"
            if (-not (Test-Path $toolsDir)) { New-Item -ItemType Directory -Path $toolsDir | Out-Null }
            Copy-Item $archNssm -Destination $localNssm -Force
            $nssmExe = $localNssm
            Write-Host "✅ NSSM configurado localmente en: $localNssm" -ForegroundColor Green
        } catch {
            Write-Warning "No se pudo descargar automáticamente NSSM: $_"
            Write-Warning "Puede descargar nssm.exe manualmente y colocarlo en: $localNssm o en el PATH."
        }
    }
}

switch ($Action) {
    "Install" {
        Write-Host "`n📦 Instalando servicio de Windows '$ServiceName'..." -ForegroundColor Cyan
        
        # Verificar que el servidor esté compilado
        if (-not (Test-Path $serverEntry)) {
            Write-Host "🔨 Compilando servidor antes de instalar servicio..." -ForegroundColor Yellow
            Push-Location $repoRoot
            pnpm --filter @tocineta/shared build
            pnpm --filter @tocineta/server build
            pnpm --filter @tocineta/web build
            Pop-Location
        }

        if (-not $nssmExe) {
            Write-Error "No se puede continuar sin nssm.exe."
            exit 2
        }

        # Detener y remover servicio previo si existe
        & $nssmExe stop $ServiceName 2>$null
        & $nssmExe remove $ServiceName confirm 2>$null

        # 1. Instalar ejecutable y argumentos
        & $nssmExe install $ServiceName $nodeExe $serverEntry
        & $nssmExe set $ServiceName AppDirectory $repoRoot
        & $nssmExe set $ServiceName DisplayName "Tocineta Sonrie - Local OS Server"
        & $nssmExe set $ServiceName Description "Servidor central de Fastify, WebSockets y SQLite para Food Truck Tocineta Sonrie (Varons Media)."

        # 2. Configurar inicio automático
        & $nssmExe set $ServiceName Start SERVICE_AUTO_START

        # 3. Configurar reinicio ante fallos en 5000 ms (5 segundos)
        & $nssmExe set $ServiceName AppRestartDelay 5000
        & $nssmExe set $ServiceName AppThrottle 1500

        # 4. Configurar rotación de logs en ./logs
        & $nssmExe set $ServiceName AppStdout $stdoutLog
        & $nssmExe set $ServiceName AppStderr $stderrLog
        & $nssmExe set $ServiceName AppRotateFiles 1
        & $nssmExe set $ServiceName AppRotateOnline 1
        & $nssmExe set $ServiceName AppRotateBytes 10485760 # 10 MB

        # 5. Variables de entorno
        & $nssmExe set $ServiceName AppEnvironmentExtra "NODE_ENV=production`nPORT=3000`nHOST=0.0.0.0`nDB_PATH=./data/tocineta.db"

        # 6. Iniciar el servicio
        & $nssmExe start $ServiceName

        Write-Host "✅ Servicio '$ServiceName' instalado e iniciado exitosamente." -ForegroundColor Green
        Write-Host "   - Ejecutable: $nodeExe $serverEntry"
        Write-Host "   - Inicio: Automático (SERVICE_AUTO_START)"
        Write-Host "   - Reinicio ante fallos: 5000 ms"
        Write-Host "   - Logs: $logsDir`n"
    }

    "Uninstall" {
        Write-Host "`n🗑️ Desinstalando servicio '$ServiceName'..." -ForegroundColor Yellow
        if ($nssmExe) {
            & $nssmExe stop $ServiceName 2>$null
            & $nssmExe remove $ServiceName confirm
            Write-Host "✅ Servicio desinstalado." -ForegroundColor Green
        } else {
            sc.exe delete $ServiceName
        }
    }

    "Start" {
        if ($nssmExe) { & $nssmExe start $ServiceName } else { Start-Service -Name $ServiceName }
    }

    "Stop" {
        if ($nssmExe) { & $nssmExe stop $ServiceName } else { Stop-Service -Name $ServiceName }
    }

    "Restart" {
        if ($nssmExe) { & $nssmExe restart $ServiceName } else { Restart-Service -Name $ServiceName }
    }

    "Status" {
        if ($nssmExe) { & $nssmExe status $ServiceName } else { Get-Service -Name $ServiceName }
    }
}
