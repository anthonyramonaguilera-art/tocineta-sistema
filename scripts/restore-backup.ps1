<#
.SYNOPSIS
    Script interactivo de recuperación ante desastres y restauración verificada para Tocineta Sonríe.
.DESCRIPTION
    Restaura una base de datos a partir de un respaldo cifrado con age (.db.age) o un snapshot local (.db).
    Verifica automáticamente:
      1. Descifrado criptográfico con clave privada age de la Sra. Olinelcys o Varons Media.
      2. PRAGMA integrity_check de SQLite.
      3. Verificación matemática completa de la cadena de auditoría SHA-256 (audit_events).
      4. Respaldo preventivo de la base de datos actual antes de sobrescribir.
.PARAMETER BackupPath
    Ruta al archivo .db.age o snapshot .db. Si no se especifica, se solicita interactivamente.
.PARAMETER PrivateKey
    Clave privada age. Si el archivo está cifrado y no se especifica, se solicita de forma segura.
.PARAMETER TargetDb
    Ruta destino para la base de datos activa. Por defecto: ./data/tocineta.db
.PARAMETER DryRun
    Si se especifica, verifica integridad y auditoría sin reemplazar la base de datos de producción.
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$BackupPath,

    [Parameter(Mandatory = $false)]
    [string]$PrivateKey,

    [Parameter(Mandatory = $false)]
    [string]$TargetDb = "./data/tocineta.db",

    [Parameter(Mandatory = $false)]
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  TOCINETA SONRIE - RECUPERACION ANTE DESASTRES Y RESTAURACION  " -ForegroundColor Yellow
Write-Host "  Modulo M9: Restauracion Criptografica Verificada              " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Solicitar ruta del archivo si no fue provista
if (-not $BackupPath -or $BackupPath.Trim() -eq "") {
    Write-Host "Archivos de respaldo detectados en ./data/backups/usb:" -ForegroundColor Gray
    if (Test-Path "./data/backups/usb") {
        Get-ChildItem "./data/backups/usb" -Filter "*.age" | Select-Object -First 5 | ForEach-Object {
            Write-Host "  -> $($_.FullName)" -ForegroundColor DarkCyan
        }
    }

    Write-Host "Snapshots detectados en ./data/snapshots:" -ForegroundColor Gray
    if (Test-Path "./data/snapshots") {
        Get-ChildItem "./data/snapshots" -Filter "*.db" | Select-Object -First 3 | ForEach-Object {
            Write-Host "  -> $($_.FullName)" -ForegroundColor DarkCyan
        }
    }
    Write-Host ""

    $BackupPath = Read-Host "Ingrese la ruta completa o relativa del archivo de respaldo (.db.age o .db)"
}

if (-not (Test-Path $BackupPath)) {
    Write-Host "[ERROR CRITICO] El archivo especificado no existe: $BackupPath" -ForegroundColor Red
    exit 1
}

$isAge = $BackupPath.EndsWith(".age", [System.StringComparison]::OrdinalIgnoreCase)

# 2. Solicitar clave privada si es un archivo .age y no se pasó como parámetro
if ($isAge -and (-not $PrivateKey -or $PrivateKey.Trim() -eq "")) {
    Write-Host ""
    Write-Host "[ATENCION] El archivo esta cifrado con age (.age)." -ForegroundColor Yellow
    Write-Host "Ingrese la clave privada de recuperacion (Sra. Olinelcys en sobre sellado o Varons Media en gestor de contraseñas)." -ForegroundColor Gray
    Write-Host "Formato: clave privada age..." -ForegroundColor Gray
    $secureInput = Read-Host "Clave Privada" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureInput)
    $PrivateKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}

Write-Host ""
Write-Host "Iniciando proceso de verificacion y restauracion..." -ForegroundColor Green
$sw = [System.Diagnostics.Stopwatch]::StartNew()

# 3. Invocar motor de restauracion CLI
$nodeArgs = @("scripts/restore-cli.ts", "--backup", $BackupPath, "--target", $TargetDb)
if ($PrivateKey -and $PrivateKey.Trim() -ne "") {
    $nodeArgs += @("--key", $PrivateKey)
}
if ($DryRun) {
    $nodeArgs += @("--dry-run")
}

try {
    & npx tsx @nodeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "El motor de restauracion termino con codigo de error $LASTEXITCODE."
    }
    $sw.Stop()
    $elapsedSeconds = [math]::Round($sw.Elapsed.TotalSeconds, 2)
    Write-Host "Operacion completada exitosamente en $elapsedSeconds segundos (limite maximo: 900 s / 15 min)." -ForegroundColor Green
    exit 0
} catch {
    $sw.Stop()
    Write-Host ""
    Write-Host "[FALLO DE RESTAURACION] La operacion no pudo completarse:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor DarkRed
    exit 1
}
