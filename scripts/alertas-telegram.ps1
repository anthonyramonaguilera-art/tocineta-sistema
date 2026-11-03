<#
.SYNOPSIS
    Script automatizado de monitoreo de salud y alertas remotas por Telegram para TOCINETA.
.DESCRIPTION
    Realiza una verificacion de salud hacia http://localhost:$PORT/api/health y consulta la base de datos local.
    - Modo daily: Ejecuta scripts/health-report.ts y consulta /api/health. Si todo responde, envia
      "TOCINETA activo. Versión X. Jornadas cerradas: N. Último respaldo: fecha y estado. Errores 24 h: N. Disco libre: X GB".
      Si no responde, envia "TOCINETA NO RESPONDE" con el estado de TocinetaSonrieServer y logsRecientes.
    - Modo check: Envia reporte o alerta inmediata si hay errores criticos.
    - Valida que TELEGRAM_CHAT_ID no coincida con el botId (getMe) ni este vacio.
.PARAMETER BotToken
    Token del bot de Telegram emitido por @BotFather (por defecto lee TELEGRAM_BOT_TOKEN de .env).
.PARAMETER ChatId
    Chat ID o ID de canal/grupo para recibir notificaciones (por defecto lee TELEGRAM_CHAT_ID de .env).
.PARAMETER HealthUrl
    URL del endpoint de healthcheck (por defecto: http://localhost:$PORT/api/health).
.PARAMETER EnvFile
    Ruta al archivo .env.
.PARAMETER DryRun
    Si se especifica, genera y muestra el mensaje en consola sin enviarlo por la red a Telegram.
.PARAMETER Mode
    Modo de ejecucion: check (predeterminado) o daily.
.PARAMETER Daily
    Switch abreviado para activar el modo daily.
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$BotToken,

    [Parameter(Mandatory = $false)]
    [string]$ChatId,

    [Parameter(Mandatory = $false)]
    [string]$HealthUrl,

    [Parameter(Mandatory = $false)]
    [string]$EnvFile = ".env",

    [Parameter(Mandatory = $false)]
    [switch]$DryRun,

    [Parameter(Mandatory = $false)]
    [ValidateSet("check", "daily", "alert")]
    [string]$Mode = "check",

    [Parameter(Mandatory = $false)]
    [switch]$Daily
)

$ErrorActionPreference = "Stop"

if ($Daily) {
    $Mode = "daily"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$resolvedEnv = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
    $EnvFile
} else {
    Join-Path $repoRoot $EnvFile
}

function Log-Aviso {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )
    try {
        $logsDir = Join-Path $repoRoot "logs"
        if (-not (Test-Path $logsDir)) {
            New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
        }
        $avisosLog = Join-Path $logsDir "avisos.log"
        $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        $entry = "$ts [$Level] $Message"
        Add-Content -Path $avisosLog -Value $entry -Encoding utf8
    } catch {
        # Continuar si no se pudo escribir
    }
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

$port = if ($envMap.ContainsKey("PORT") -and $envMap["PORT"]) {
    $envMap["PORT"].Trim()
} elseif ($env:PORT) {
    $env:PORT.Trim()
} else {
    "3000"
}

if (-not $HealthUrl -or $HealthUrl.Trim() -eq "") {
    $HealthUrl = "http://localhost:$port/api/health"
}

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
Write-Host "Ejecutando verificacion a las: $currentDate (Modo: $Mode)" -ForegroundColor Gray

# Validar destino con getMe
function Test-TelegramTarget {
    param(
        [string]$TargetToken,
        [string]$TargetChatId
    )

    $trimmedChat = if ($TargetChatId) { $TargetChatId.Trim() } else { "" }
    if ($trimmedChat -eq "") {
        $warn = "El destino de avisos apunta a un bot; use su ID personal"
        Write-Host "[ALERTA] $warn" -ForegroundColor Red
        Log-Aviso -Message $warn -Level "ERROR"
        return $false
    }

    try {
        $getMeUri = "https://api.telegram.org/bot$TargetToken/getMe"
        $getMeRes = Invoke-RestMethod -Uri $getMeUri -Method Get -TimeoutSec 10 -ErrorAction Stop
        if ($getMeRes -and $getMeRes.ok -and $getMeRes.result) {
            $botId = [string]$getMeRes.result.id
            if ($trimmedChat -eq $botId.Trim()) {
                $warn = "El destino de avisos apunta a un bot; use su ID personal"
                Write-Host "[ALERTA] $warn" -ForegroundColor Red
                Log-Aviso -Message $warn -Level "ERROR"
                return $false
            }
        }
    } catch {
        Write-Host "[AVISO] No se pudo verificar getMe de Telegram: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    return $true
}

$messageText = ""
$isCritical = $false

if ($Mode -eq "daily") {
    # MODO DAILY: health-report.ts + /api/health
    $healthReportScript = Join-Path $repoRoot "scripts\health-report.ts"
    $report = $null
    $reportOk = $false

    Write-Host "Ejecutando diagnostico local con scripts/health-report.ts..." -ForegroundColor DarkGray
    try {
        $rawOutput = & npx tsx $healthReportScript
        $report = $rawOutput | ConvertFrom-Json
        if ($LASTEXITCODE -eq 0 -and $report -and -not $report.error) {
            $reportOk = $true
        }
    } catch {
        Write-Host "[AVISO] Fallo al ejecutar scripts/health-report.ts: $($_.Exception.Message)" -ForegroundColor Yellow
        $reportOk = $false
    }

    Write-Host "Consultando estado de salud en $HealthUrl..." -ForegroundColor DarkGray
    $isApiHealthOk = $false
    try {
        $healthRes = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 8 -ErrorAction Stop
        if ($healthRes -and $healthRes.status -eq "ok") {
            $isApiHealthOk = $true
            Write-Host "[OK] Endpoint /api/health respondio correctamente." -ForegroundColor Green
        }
    } catch {
        Write-Host "[ALERTA] Endpoint /api/health no respondio: $($_.Exception.Message)" -ForegroundColor Red
        $isApiHealthOk = $false
    }

    if ($reportOk -and $isApiHealthOk) {
        if ($report -and $report.dailyMessage) {
            $messageText = $report.dailyMessage
        } else {
            $v = if ($report.version) { $report.version } else { "1.0.0" }
            $jc = if ($report.closedJornadasCount) { $report.closedJornadasCount } else { 0 }
            $errs = if ($report.serverErrors24h) { $report.serverErrors24h } else { 0 }
            $df = if ($report.diskFreeGb) { $report.diskFreeGb } else { 0 }
            $messageText = "TOCINETA activo. Versión $v. Jornadas cerradas: $jc. Último respaldo: sin respaldo previo. Errores 24 h: $errs. Disco libre: $df GB"
        }
    } else {
        $isCritical = $true
        $svc = Get-Service -Name "TocinetaSonrieServer" -ErrorAction SilentlyContinue
        $svcStatus = if ($svc) { $svc.Status } else { "No encontrado" }
        $logsRecientesVal = if ($report -and $null -ne $report.logsRecientes) { $report.logsRecientes } else { "false" }

        $messageText = "TOCINETA NO RESPONDE`nEstado del servicio (TocinetaSonrieServer): $svcStatus`nLogs recientes: $logsRecientesVal"
    }

} else {
    # MODO CHECK / ALERTA TRADICIONAL
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

    $isCritical = (-not $isHealthOk) -or ($criticalCount -gt 0)

    if ($isCritical) {
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
        $messageText = "TOCINETA Sano: $currentDate. Último respaldo: $latestBackup. Errores en 24h: $errors24h"
    }
}

Write-Host ""
Write-Host "--- MENSAJE PREPARADO ---" -ForegroundColor Cyan
if ($isCritical) {
    Write-Host $messageText -ForegroundColor Red
} else {
    Write-Host $messageText -ForegroundColor Green
}
Write-Host "-------------------------" -ForegroundColor Cyan

# Validar destino con getMe y enviar
if ($token -and $chat) {
    $isValidTarget = Test-TelegramTarget -TargetToken $token -TargetChatId $chat
    if (-not $isValidTarget) {
        exit 1
    }
} elseif (-not $DryRun) {
    if (-not $chat -or $chat.Trim() -eq "") {
        $warn = "El destino de avisos apunta a un bot; use su ID personal"
        Write-Host "[ALERTA] $warn" -ForegroundColor Red
        Log-Aviso -Message $warn -Level "ERROR"
        exit 1
    }
}

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
        Log-Aviso -Message "Mensaje entregado exitosamente a Telegram (Chat ID: $chat)" -Level "INFO"
        exit 0
    } else {
        Write-Host "[ERROR] Telegram respondio con fallo: $($sendRes | ConvertTo-Json -Compress)" -ForegroundColor Red
        Log-Aviso -Message "Fallo al enviar a Telegram: $($sendRes | ConvertTo-Json -Compress)" -Level "ERROR"
        exit 1
    }
} catch {
    $apiErr = $_.Exception.Message
    Write-Host "[ERROR] Excepcion al conectar con API de Telegram: $apiErr" -ForegroundColor Red
    Log-Aviso -Message "Excepcion al conectar con API de Telegram: $apiErr" -Level "ERROR"
    exit 1
}
