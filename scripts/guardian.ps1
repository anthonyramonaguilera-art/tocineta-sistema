<#
.SYNOPSIS
    guardian.ps1 - Supervisor y relanzador de navegador en Modo Kiosco para Tocineta Sonríe
.DESCRIPTION
    Monitorea continuamente la ejecución de Google Chrome (o Edge) en modo kiosco apuntando a
    http://localhost:3000. Si el usuario cierra el navegador o si el proceso termina de forma inesperada,
    el guardián lo relanza automáticamente en menos de 5 segundos.
.PARAMETER TargetUrl
    URL local a supervisar (por defecto: http://localhost:3000).
.PARAMETER CheckIntervalSec
    Intervalo de verificación en segundos (por defecto: 2 segundos).
#>

[CmdletBinding()]
param(
    [string]$TargetUrl = "http://localhost:3000",
    [int]$CheckIntervalSec = 2
)

$candidatePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)

$browserExe = $null
foreach ($path in $candidatePaths) {
    if (Test-Path $path) {
        $browserExe = $path
        break
    }
}

if (-not $browserExe) {
    Write-Error "No se encontró Google Chrome ni Microsoft Edge en las rutas estándar del sistema."
    exit 1
}

$browserName = [System.IO.Path]::GetFileNameWithoutExtension($browserExe)

$kioskArgs = @(
    "--kiosk",
    $TargetUrl,
    "--disable-pinch",
    "--overscroll-history-navigation=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--disable-infobars",
    "--disable-features=Translate"
)

Write-Host "🛡️ Iniciando Guardián de Kiosco para Tocineta Sonríe" -ForegroundColor Cyan
Write-Host "   - Navegador: $browserExe"
Write-Host "   - URL Objetivo: $TargetUrl"
Write-Host "   - Intervalo de supervisión: $CheckIntervalSec segundos"
Write-Host "   - Presione Ctrl+C para detener la supervisión.`n"

# Verificación y reparación física de impresora térmica USB (M10.1)
$repairScript = Join-Path $PSScriptRoot "repair-printer-driver.ps1"
if (Test-Path $repairScript) {
    try {
        & $repairScript
    } catch {
        Write-Warning "No se pudo ejecutar repair-printer-driver.ps1: $($_.Exception.Message)"
    }
}

function Start-KioskProcess {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 🚀 Lanzando $browserName en modo kiosco..." -ForegroundColor Green
    $proc = Start-Process -FilePath $browserExe -ArgumentList $kioskArgs -PassThru
    return $proc
}

$proc = Start-KioskProcess

while ($true) {
    Start-Sleep -Seconds $CheckIntervalSec

    $isAlive = $false
    try {
        if ($proc -and -not $proc.HasExited) {
            $isAlive = $true
        }
    } catch {
        $isAlive = $false
    }

    if (-not $isAlive) {
        Write-Warning "[$(Get-Date -Format 'HH:mm:ss')] ⚠️ Proceso de kiosco cerrado o no detectado. Relanzando en < 5s..."
        $proc = Start-KioskProcess
    }
}
