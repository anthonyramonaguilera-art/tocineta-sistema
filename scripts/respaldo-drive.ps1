<#
.SYNOPSIS
    Script automatizado de respaldo cifrado con Age hacia almacenamiento USB y Google Drive para TOCINETA.
.DESCRIPTION
    Ejecuta un snapshot seguro en caliente de la base de datos SQLite (WAL-safe),
    cifra el archivo utilizando Age con las claves públicas autorizadas (AGE_RECIPIENT_ADMIN y AGE_RECIPIENT_SECURE),
    y copia el respaldo cifrado (.db.age) a la carpeta local configurable (USB_BACKUP_PATH) y a la carpeta
    sincronizada con Google Drive (DRIVE_SYNC_PATH).
    Si ocurre cualquier fallo durante el proceso, se registra automáticamente una entrada de error en la tabla server_errors.
.PARAMETER DbPath
    Ruta a la base de datos SQLite principal (por defecto lee DB_PATH de .env o ./data/tocineta.db).
.PARAMETER UsbBackupPath
    Ruta de destino local o USB (por defecto lee USB_BACKUP_PATH de .env o ./data/backups/usb).
.PARAMETER DriveSyncPath
    Ruta local sincronizada con Google Drive (por defecto lee DRIVE_SYNC_PATH de .env).
.PARAMETER EnvFile
    Ruta al archivo de variables de entorno (.env). Por defecto: .env en la raíz del proyecto.
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$DbPath,

    [Parameter(Mandatory = $false)]
    [string]$UsbBackupPath,

    [Parameter(Mandatory = $false)]
    [string]$DriveSyncPath,

    [Parameter(Mandatory = $false)]
    [string]$EnvFile = ".env"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "     SISTEMA TOCINETA - RESPALDO CIFRADO A GOOGLE DRIVE         " -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Iniciando proceso a las: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray

# 1. Comprobar disponibilidad de Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "[ERROR CRITICO] Node.js no esta disponible en el PATH del sistema." -ForegroundColor Red
    exit 1
}

# 2. Localizar archivo .env si no fue especificado como ruta absoluta
$resolvedEnv = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
    $EnvFile
} else {
    Join-Path $repoRoot $EnvFile
}

if (Test-Path $resolvedEnv) {
    Write-Host "Archivo de entorno detectado: $resolvedEnv" -ForegroundColor DarkGray
} else {
    Write-Host "[AVISO] No se encontro archivo de entorno en $resolvedEnv. Se emplearan valores predeterminados." -ForegroundColor Yellow
}

# 3. Preparar argumentos para el motor de respaldo
$runnerPath = Join-Path $PSScriptRoot "backup-drive-runner.ts"
if (-not (Test-Path $runnerPath)) {
    Write-Host "[ERROR CRITICO] No se encontro el script de ejecucion: $runnerPath" -ForegroundColor Red
    exit 1
}

$cliArgs = @($runnerPath)

if ($DbPath -and $DbPath.Trim() -ne "") {
    $cliArgs += @("--db", $DbPath)
}
if ($UsbBackupPath -and $UsbBackupPath.Trim() -ne "") {
    $cliArgs += @("--usb", $UsbBackupPath)
}
if ($DriveSyncPath -and $DriveSyncPath.Trim() -ne "") {
    $cliArgs += @("--drive", $DriveSyncPath)
}
if ($resolvedEnv -and (Test-Path $resolvedEnv)) {
    $cliArgs += @("--env", $resolvedEnv)
}

# 4. Ejecutar motor con npx tsx / pnpm exec tsx
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    & npx tsx @cliArgs
    $exitCode = $LASTEXITCODE

    $sw.Stop()
    $elapsed = [math]::Round($sw.Elapsed.TotalSeconds, 2)

    if ($exitCode -eq 0) {
        Write-Host ""
        Write-Host "[OK] Proceso de respaldo completado satisfactoriamente en $elapsed s." -ForegroundColor Green
        exit 0
    } else {
        Write-Host ""
        Write-Host "[FALLO] El motor de respaldo reporto error (Codigo de salida: $exitCode)." -ForegroundColor Red
        Write-Host "El error ha quedado documentado en la tabla server_errors de la base de datos." -ForegroundColor Yellow
        exit $exitCode
    }
} catch {
    $sw.Stop()
    Write-Host ""
    Write-Host "[ERROR DE EJECUCION] Excepcion inesperada al invocar motor de respaldo:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor DarkRed
    exit 1
}
