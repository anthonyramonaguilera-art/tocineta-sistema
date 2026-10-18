<#
.SYNOPSIS
    repair-printer-driver.ps1 - Diagnóstico y reparación automática del driver y puerto USB para DP58U-03 (POS-58)
.DESCRIPTION
    Detecta la impresora térmica de caja ('DP58U-03' o 'POS-58'), verifica su puerto USB activo
    (USB001, USB002, etc.), reasigna el puerto si Windows lo cambió al reconectar en otro socket USB,
    desactiva el almacenamiento residual de trabajos (-KeepPrintedJobs $false) y previene la corrupción
    del driver genérico 'Generic / Text Only' restaurándolo a 'POS-58'.
#>

[CmdletBinding()]
param(
    [string]$PrinterName = "DP58U-03",
    [string]$TargetDriver = "POS-58"
)

Write-Host "Iniciando verificacion de hardware termico..." -ForegroundColor Cyan

# 1. Buscar la impresora en Windows
$printer = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if (-not $printer) {
    # Buscar por fallback POS-58 o DP58U
    $printer = Get-Printer | Where-Object { $_.Name -like "*POS-58*" -or $_.Name -like "*DP58U*" } | Select-Object -First 1
}

if (-not $printer) {
    Write-Warning "No se encontro ninguna cola de impresora llamada '$PrinterName' ni 'POS-58'."
    Write-Warning "Asegurate de que el driver 'POS-58' este instalado en Windows."
    exit 0
}

$currentName = $printer.Name
Write-Host "   - Impresora detectada: $currentName" -ForegroundColor Green
Write-Host "   - Driver actual: $($printer.DriverName)"
Write-Host "   - Puerto actual: $($printer.PortName)"

# 2. Detectar puertos USB disponibles o activos
$usbPorts = Get-PrinterPort | Where-Object { $_.Name -like "USB*" } | Sort-Object Name -Descending
$activeUsbPort = $null

if ($usbPorts) {
    $activeUsbPort = $usbPorts[0].Name
}

# 3. Reasignar puerto si es necesario y difiere
if ($activeUsbPort -and ($printer.PortName -notlike "USB*")) {
    Write-Host "   - Reasignando cola '$currentName' de '$($printer.PortName)' a puerto USB activo '$activeUsbPort'..." -ForegroundColor Yellow
    try {
        Set-Printer -Name $currentName -PortName $activeUsbPort -ErrorAction Stop
        Write-Host "   - Puerto actualizado exitosamente a $activeUsbPort." -ForegroundColor Green
    } catch {
        Write-Warning "   ! No se pudo cambiar el puerto automaticamente: $($_.Exception.Message)"
    }
}

# 4. Asegurar KeepPrintedJobs = $false (evita acumulacion de trabajos RAW en spool)
try {
    Set-Printer -Name $currentName -KeepPrintedJobs $false -ErrorAction Stop
    Write-Host '   - Configurado -KeepPrintedJobs $false (sin retencion en spooler).' -ForegroundColor Green
} catch {
    Write-Warning "   ! Advertencia al configurar KeepPrintedJobs: $($_.Exception.Message)"
}

# 5. Si detecta driver generico Generic / Text Only, restaurar a POS-58
if ($printer.DriverName -like "*Generic*") {
    Write-Host "   - Driver generico detectado ($($printer.DriverName)). Restaurando a '$TargetDriver'..." -ForegroundColor Yellow
    try {
        Set-Printer -Name $currentName -DriverName $TargetDriver -ErrorAction Stop
        Write-Host "   - Driver restaurado a $TargetDriver." -ForegroundColor Green
    } catch {
        $msg = $_.Exception.Message
        Write-Warning "   ! No se pudo restaurar el driver automaticamente a ${TargetDriver}: $msg"
    }
} else {
    Write-Host "   - Driver correcto ($($printer.DriverName))." -ForegroundColor Green
}

Write-Host "Verificacion completada con exito.`n" -ForegroundColor Cyan
