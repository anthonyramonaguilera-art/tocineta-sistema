<#
.SYNOPSIS
    Script de generacion de paquete de diagnostico forense para TOCINETA (R1).
.DESCRIPTION
    Genera un archivo comprimido .zip que contiene:
    1. Los ultimos 50 errores de la tabla server_errors (completamente sanitizados: sin PINs, contrasenas ni datos personales).
    2. Los registros de logs generados en las ultimas 24 horas en apps/server/logs.
    3. La informacion de version y estado actual del sistema leida desde package.json.
.PARAMETER OutputPath
    Ruta completa de destino para el archivo .zip generado (opcional; por defecto genera en ./data/diagnostico/).
.PARAMETER DbPath
    Ruta a la base de datos principal SQLite (opcional; lee DB_PATH de .env por defecto).
.PARAMETER LogsDir
    Directorio de logs del servidor (opcional; por defecto apps/server/logs).
.PARAMETER EnvFile
    Ruta al archivo .env (por defecto .env en la raiz del proyecto).
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$OutputPath,

    [Parameter(Mandatory = $false)]
    [string]$DbPath,

    [Parameter(Mandatory = $false)]
    [string]$LogsDir,

    [Parameter(Mandatory = $false)]
    [string]$EnvFile = ".env"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "       SISTEMA TOCINETA - GENERADOR DE DIAGNOSTICO (R1)          " -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Iniciando captura de diagnostico: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray

# 1. Comprobar Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "[ERROR CRITICO] Node.js no esta disponible en el PATH del sistema." -ForegroundColor Red
    exit 1
}

# 2. Localizar archivo .env
$resolvedEnv = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
    $EnvFile
} else {
    Join-Path $repoRoot $EnvFile
}

# 3. Preparar directorio de staging temporal
$tempBase = Join-Path $repoRoot "data\temp"
if (-not (Test-Path $tempBase)) {
    New-Item -ItemType Directory -Path $tempBase -Force | Out-Null
}

$stageDir = Join-Path $tempBase "diag-stage-$timestamp-$([System.IO.Path]::GetRandomFileName().Substring(0, 6))"
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

$helperPath = Join-Path $PSScriptRoot "diagnostico-helper.ts"
if (-not (Test-Path $helperPath)) {
    Write-Host "[ERROR CRITICO] No se encontro el script helper: $helperPath" -ForegroundColor Red
    exit 1
}

$helperArgs = @($helperPath, "--stage", $stageDir, "--env", $resolvedEnv)
if ($DbPath -and $DbPath.Trim() -ne "") {
    $helperArgs += @("--db", $DbPath)
}
if ($LogsDir -and $LogsDir.Trim() -ne "") {
    $helperArgs += @("--logs", $LogsDir)
}

try {
    # 4. Ejecutar helper de sanitizacion y recopilacion
    & npx tsx @helperArgs
    $helperExit = $LASTEXITCODE

    if ($helperExit -ne 0) {
        Write-Host "[ERROR] El helper de diagnostico finalizo con codigo de error: $helperExit" -ForegroundColor Red
        if (Test-Path $stageDir) { Remove-Item -Recurse -Force $stageDir -ErrorAction SilentlyContinue }
        exit $helperExit
    }

    # 5. Determinar archivo .zip de destino
    $finalZipPath = if ($OutputPath -and $OutputPath.Trim() -ne "") {
        if ([System.IO.Path]::IsPathRooted($OutputPath)) {
            $OutputPath
        } else {
            Join-Path $repoRoot $OutputPath
        }
    } else {
        $diagOutputDir = Join-Path $repoRoot "data\diagnostico"
        if (-not (Test-Path $diagOutputDir)) {
            New-Item -ItemType Directory -Path $diagOutputDir -Force | Out-Null
        }
        Join-Path $diagOutputDir "diagnostico-tocineta-$timestamp.zip"
    }

    $parentDir = [System.IO.Path]::GetDirectoryName($finalZipPath)
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }

    if (Test-Path $finalZipPath) {
        Remove-Item -Path $finalZipPath -Force
    }

    # 6. Comprimir artefactos en formato .zip
    Write-Host "- Empaquetando artefactos forenses en archivo comprimido..." -ForegroundColor DarkCyan
    Compress-Archive -Path "$stageDir\*" -DestinationPath $finalZipPath -Force

    # 7. Validar creacion del .zip
    if (Test-Path $finalZipPath) {
        $zipSizeKb = [math]::Round(((Get-Item $finalZipPath).Length / 1KB), 2)
        Write-Host ""
        Write-Host "[OK] Paquete de diagnostico generado exitosamente." -ForegroundColor Green
        Write-Host "     Destino: $finalZipPath ($zipSizeKb KB)" -ForegroundColor Yellow
        Write-Output $finalZipPath
        exit 0
    } else {
        Write-Host "[ERROR] No se pudo crear el archivo comprimido en: $finalZipPath" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "[ERROR CRITICO] Excepcion inesperada al generar diagnostico:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor DarkRed
    exit 1
} finally {
    # 8. Limpieza de directorio temporal
    if (Test-Path $stageDir) {
        Remove-Item -Recurse -Force $stageDir -ErrorAction SilentlyContinue
    }
}
