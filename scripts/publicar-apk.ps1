# Compilacion y publicacion del APK de Produccion para terminales TOCINETA
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$rootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidDir = Join-Path $rootDir "android-terminal"
$apkOutputDir = Join-Path $rootDir "data\apk"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  TOCINETA - Compilacion y Publicacion APK" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. Verificar directorio android-terminal y gradlew.bat
if (-not (Test-Path (Join-Path $androidDir "gradlew.bat"))) {
    Write-Error "No se encontro gradlew.bat en $androidDir"
    exit 1
}

# 2. Compilar assembleRelease
Write-Host "`n[1/3] Compilando APK Release..." -ForegroundColor Yellow
Push-Location $androidDir
try {
    & .\gradlew.bat assembleRelease
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Fallo la compilacion de Gradle con codigo $LASTEXITCODE"
        exit $LASTEXITCODE
    }
}
finally {
    Pop-Location
}

# 3. Ubicar APK generado
$sourceApk = Join-Path $androidDir "app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $sourceApk)) {
    Write-Error "No se encontro el archivo compilado en $sourceApk"
    exit 1
}

# 4. Asegurar carpeta destino en data/apk
Write-Host "`n[2/3] Copiando APK a carpeta de distribucion..." -ForegroundColor Yellow
if (-not (Test-Path $apkOutputDir)) {
    New-Item -ItemType Directory -Path $apkOutputDir -Force | Out-Null
}

$destApk = Join-Path $apkOutputDir "tocineta-terminal.apk"
Copy-Item -Path $sourceApk -Destination $destApk -Force
Write-Host "APK copiado a: $destApk" -ForegroundColor Green

# 5. Generar version.txt
Write-Host "`n[3/3] Generando archivo de version..." -ForegroundColor Yellow
$versionFilePath = Join-Path $apkOutputDir "version.txt"
"1.0.0 (1)" | Set-Content -Path $versionFilePath -NoNewline -Encoding utf8
Write-Host "Version registrada: 1.0.0 (1) en $versionFilePath" -ForegroundColor Green

Write-Host "`nPublicacion de APK completada con exito." -ForegroundColor Cyan
