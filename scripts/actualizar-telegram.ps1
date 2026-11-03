<#
.SYNOPSIS
    Script desatendido de ejecucion periodica del receptor de actualizaciones por Telegram (TOCINETA).
.DESCRIPTION
    Ejecuta scripts/update-receiver.ts cada 15 minutos (a traves del Programador de Tareas) para:
      1. Sondear actualizaciones y comandos remotos en Telegram Bot API (getUpdates).
      2. Validar remitentes autorizados mediante TELEGRAM_ADMIN_IDS.
      3. Atender comandos de consulta segura (/estado y /diag).
      4. Validar integridad criptografica Ed25519 y SHA-256 de paquetes tocineta-X.Y.Z.zip + tocineta-X.Y.Z.sig.
      5. Respetar la ventana operativa evaluando jornadas abiertas en /api/jornadas/current.
      6. Ejecutar scripts/actualizar.ps1 -LocalZip <zip> -Source Telegram cuando no haya jornada abierta.
.PARAMETER EnvFile
    Ruta al archivo .env (por defecto: .env en la raiz).
.PARAMETER DryRun
    Ejecuta en modo simulacion sin invocar actualizar.ps1 ni modificar offset remoto.
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$EnvFile = ".env",

    [Parameter(Mandatory = $false)]
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

function Log-TelegramRunner {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )
    try {
        $logsDir = Join-Path $repoRoot "logs"
        if (-not (Test-Path $logsDir)) {
            New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
        }
        $logFile = Join-Path $logsDir "actualizaciones.log"
        $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        $entry = "[$ts] [$Level] [TELEGRAM-RUNNER] $Message"
        Add-Content -Path $logFile -Value $entry -Encoding utf8
    } catch {}
}

$receiverScript = Join-Path $repoRoot "scripts\update-receiver.ts"
if (-not (Test-Path $receiverScript)) {
    Log-TelegramRunner -Message "Script receptor no encontrado: $receiverScript" -Level "ERROR"
    Write-Host "[ERROR] No se encuentra $receiverScript" -ForegroundColor Red
    exit 1
}

$resolvedEnv = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
    $EnvFile
} else {
    Join-Path $repoRoot $EnvFile
}

$env:ENV_FILE = $resolvedEnv

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Log-TelegramRunner -Message "Node.js no se encuentra en el PATH del sistema." -Level "ERROR"
    Write-Host "[ERROR] Node.js no disponible en PATH." -ForegroundColor Red
    exit 1
}

$receiverArgs = @($receiverScript)
if ($DryRun) {
    $receiverArgs += "--dry-run"
}

try {
    Write-Host "Ejecutando receptor de actualizaciones por Telegram..." -ForegroundColor Cyan
    $output = & npx tsx @receiverArgs 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        $errSummary = ($output | Out-String).Trim()
        Log-TelegramRunner -Message "Receptor finalizo con codigo de error $exitCode: $errSummary" -Level "WARN"
        Write-Host "[AVISO] update-receiver finalizo con codigo $exitCode" -ForegroundColor Yellow
        exit $exitCode
    }

    Write-Host "[OK] Receptor ejecutado exitosamente." -ForegroundColor Green
    exit 0
} catch {
    $msg = $_.Exception.Message
    Log-TelegramRunner -Message "Excepcion al ejecutar update-receiver: $msg" -Level "ERROR"
    Write-Host "[ERROR] Excepcion inesperada: $msg" -ForegroundColor Red
    exit 1
}
