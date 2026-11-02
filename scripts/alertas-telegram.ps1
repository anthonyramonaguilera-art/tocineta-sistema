<#
.SYNOPSIS
    Script automatizado de monitoreo de salud y alertas remotas por Telegram para TOCINETA.
.DESCRIPTION
    Realiza una verificacion de salud hacia http://localhost:3000/api/health y consulta la base de datos local.
    - Si el sistema esta OK (servidor activo y sin errores graves), envia el reporte diario de salud:
      "TOCINETA Sano: [Fecha]. Ultimo respaldo: [Fecha]. Errores en 24h: [Cantidad]"
    - Si el estado es CRITICO (servidor caido o errores graves en server_errors), envia una ALERTA INMEDIATA.
.PARAMETER BotToken
    Token del bot de Telegram emitido por @BotFather (por defecto lee TELEGRAM_BOT_TOKEN de .env).
.PARAMETER ChatId
    Chat ID o ID de canal/grupo para recibir notificaciones (por defecto lee TELEGRAM_CHAT_ID de .env).
.PARAMETER HealthUrl
    URL del endpoint de healthcheck (por defecto: http://localhost:3000/api/health).
.PARAMETER EnvFile
    Ruta al archivo .env.
.PARAMETER DryRun
    Si se especifica, genera y muestra el mensaje en consola sin enviarlo por la red a Telegram.
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$BotToken,

    [Parameter(Mandatory = $false)]
    [string]$ChatId,

    [Parameter(Mandatory = $false)]
    [string]$HealthUrl = "http://localhost:3000/api/health",

    [Parameter(Mandatory = $false)]
    [string]$EnvFile = ".env",

    [Parameter(Mandatory = $false)]
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$resolvedEnv = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
    $EnvFile
} else {
    Join-Path $repoRoot $EnvFile
}

# 1. Leer variables desde .env si no fueron proporcionadas por linea de comando
function Get-EnvMap {
    param([string]$FilePath)
    $map = @{}
    if (Test-Path $FilePath) {
        Get-Content $FilePath | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith("#")) {
                $idx = $line.IndexOf("=")
                if ($idx -gt 0) {
                    $key = $line.Substring(0, $idx).Trim()
                    $val = $line.Substring($idx + 1).Trim().Trim('"').Trim("'")
                    $map[$key] = $val
                }
            }
        }
    }
    return $map
}

$envMap = Get-EnvMap -FilePath $resolvedEnv

$token = if ($BotToken -and $BotToken.Trim() -ne "") {
    $BotToken.Trim()
} elseif ($env:TELEGRAM_BOT_TOKEN) {
    $env:TELEGRAM_BOT_TOKEN.Trim()
} elseif ($envMap.ContainsKey("TELEGRAM_BOT_TOKEN")) {
    $envMap["TELEGRAM_BOT_TOKEN"].Trim()
} else {
    ""
}

$chat = if ($ChatId -and $ChatId.Trim() -ne "") {
    $ChatId.Trim()
} elseif ($env:TELEGRAM_CHAT_ID) {
    $env:TELEGRAM_CHAT_ID.Trim()
} elseif ($envMap.ContainsKey("TELEGRAM_CHAT_ID")) {
    $envMap["TELEGRAM_CHAT_ID"].Trim()
} else {
    ""
}

$currentDate = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "     SISTEMA TOCINETA - MONITOREO Y ALERTAS TELEGRAM            " -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Ejecutando verificacion a las: $currentDate" -ForegroundColor Gray

# 2. Consultar endpoint HTTP /api/health
$isHealthOk = $false
$healthDetail = ""

Write-Host "Consultando estado de salud en $HealthUrl..." -ForegroundColor DarkGray
try {
    $healthRes = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 8 -ErrorAction Stop
    if ($healthRes -and $healthRes.status -eq "ok") {
        $isHealthOk = $true
        $healthDetail = "OK (Version: $($healthRes.version), DB: $($healthRes.journalMode))"
        Write-Host "[OK] Endpoint /api/health: $healthDetail" -ForegroundColor Green
    } else {
        $isHealthOk = $false
        $healthDetail = "Respuesta no conforme"
        Write-Host "[AVISO] Endpoint /api/health reporto estado no conforme." -ForegroundColor Yellow
    }
} catch {
    $isHealthOk = $false
    $errMsg = $_.Exception.Message
    $healthDetail = "Servidor no responde o caido ($errMsg)"
    Write-Host "[ALERTA] Fallo al conectar con el servidor: $healthDetail" -ForegroundColor Red
}

# 3. Consultar metricas de base de datos con el helper
$helperPath = Join-Path $PSScriptRoot "alertas-helper.ts"
$dbMetrics = $null

if (Test-Path $helperPath) {
    try {
        $helperJson = & npx tsx $helperPath --env $resolvedEnv
        $dbMetrics = $helperJson | ConvertFrom-Json
    } catch {
        $helperErr = $_.Exception.Message
        Write-Host "[ADVERTENCIA] No se pudieron obtener metricas directas de SQLite: $helperErr" -ForegroundColor Yellow
    }
}

$latestBackup = if ($dbMetrics -and $dbMetrics.latestBackupDate) { $dbMetrics.latestBackupDate } else { "No disponible" }
$errors24h = if ($dbMetrics -and $null -ne $dbMetrics.errorsLast24h) { [int]$dbMetrics.errorsLast24h } else { 0 }
$criticalCount = if ($dbMetrics -and $null -ne $dbMetrics.criticalErrorsCount) { [int]$dbMetrics.criticalErrorsCount } else { 0 }

# 4. Determinar tipo de mensaje (SANO vs CRITICO / ALERTA INMEDIATA)
$isCritical = (-not $isHealthOk) -or ($criticalCount -gt 0)
$messageText = ""

if ($isCritical) {
    # Alerta Inmediata ante fallo critico o errores graves
    $lines = @(
        "ALERTA INMEDIATA - TOCINETA CRITICO",
        "Fecha: $currentDate",
        "Servidor: $healthDetail",
        "Errores graves detectados (24h): $criticalCount",
        "Total errores registrados (24h): $errors24h",
        "Ultimo respaldo registrado: $latestBackup"
    )

    if ($dbMetrics -and $dbMetrics.criticalErrors -and $dbMetrics.criticalErrors.Count -gt 0) {
        $lines += ""
        $lines += "Detalles de fallas recientes:"
        foreach ($err in ($dbMetrics.criticalErrors | Select-Object -First 3)) {
            $msgSnippet = if ($err.message.Length -gt 120) { $err.message.Substring(0, 117) + "..." } else { $err.message }
            $lines += "- [$($err.code)] $msgSnippet ($($err.createdAt))"
        }
    }

    $lines += ""
    $lines += "Accion requerida: Verificar de inmediato el servicio local y los registros en ./logs."
    $messageText = $lines -join "`n"
} else {
    # Reporte Diario de Salud del Sistema (Exactamente segun requerimiento R2)
    $messageText = "TOCINETA Sano: $currentDate. Último respaldo: $latestBackup. Errores en 24h: $errors24h"
}

Write-Host ""
Write-Host "--- MENSAJE PREPARADO ---" -ForegroundColor Cyan
if ($isCritical) {
    Write-Host $messageText -ForegroundColor Red
} else {
    Write-Host $messageText -ForegroundColor Green
}
Write-Host "-------------------------" -ForegroundColor Cyan

# 5. Enviar a Telegram
if ($DryRun) {
    Write-Host "[DRY-RUN] Modo simulacion activado. El mensaje no fue enviado a la API de Telegram." -ForegroundColor Yellow
    exit 0
}

if (-not $token -or -not $chat) {
    Write-Host ""
    Write-Host "[AVISO] TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no estan configurados en .env ni como parametros." -ForegroundColor Yellow
    Write-Host "Para activar el envio automatico, configure las variables en .env segun docs/gestion-remota.md" -ForegroundColor DarkGray
    exit 0
}

Write-Host ""
Write-Host "Enviando notificacion a Telegram (Chat ID: $chat)..." -ForegroundColor DarkCyan

$telegramUri = "https://api.telegram.org/bot$token/sendMessage"
$telegramBody = @{
    chat_id = $chat
    text = $messageText
} | ConvertTo-Json -Compress

try {
    $sendRes = Invoke-RestMethod -Uri $telegramUri -Method Post -Body $telegramBody -ContentType "application/json; charset=utf-8" -TimeoutSec 15
    if ($sendRes.ok) {
        Write-Host "[OK] Mensaje entregado exitosamente a Telegram." -ForegroundColor Green
        exit 0
    } else {
        Write-Host "[ERROR] Telegram respondio con fallo: $($sendRes | ConvertTo-Json -Compress)" -ForegroundColor Red
        exit 1
    }
} catch {
    $apiErr = $_.Exception.Message
    Write-Host "[ERROR] Excepcion al conectar con API de Telegram: $apiErr" -ForegroundColor Red
    exit 1
}
