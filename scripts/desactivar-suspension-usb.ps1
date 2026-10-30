param(
    [switch]$Revertir
)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "ERROR: Este script debe ejecutarse como Administrador. Abra PowerShell como Administrador y vuelva a intentarlo."
    exit 1
}

# USB Selective Suspend GUIDs
# Subgroup: USB Settings (2a734441-92d0-4declarative... or standard GUID 2a734441-92d0-4eb3-80b1-87a7303799d0)
# Setting: USB selective suspend setting (48e6b7a6-50f5-4782-a5d4-53bb8f07e226)
$usbSubgroup = "2a734441-92d0-4eb3-80b1-87a7303799d0"
$usbSetting = "48e6b7a6-50f5-4782-a5d4-53bb8f07e226"

if ($Revertir) {
    Write-Host "Rehabilitando suspensión selectiva USB y ahorro de energía..."
    powercfg -setacvalueindex SCHEME_CURRENT $usbSubgroup $usbSetting 1
    powercfg -setdcvalueindex SCHEME_CURRENT $usbSubgroup $usbSetting 1
    powercfg -SetActive SCHEME_CURRENT
    
    # Habilitar apagado en dispositivos USB
    try {
        $usbDevices = Get-CimInstance -Namespace root\wmi -ClassName MSPower_DeviceEnable -ErrorAction SilentlyContinue
        foreach ($dev in $usbDevices) {
            if ($dev.InstanceName -match 'USB') {
                Set-CimInstance -Query "SELECT * FROM MSPower_DeviceEnable WHERE InstanceName = '$($dev.InstanceName)'" -Property @{ Enable = $true } -ErrorAction SilentlyContinue
            }
        }
    } catch {}

    Write-Host "Configuración USB revertida a los valores predeterminados de energía."
} else {
    Write-Host "Desactivando suspensión selectiva USB en el plan de energía activo..."
    powercfg -setacvalueindex SCHEME_CURRENT $usbSubgroup $usbSetting 0
    powercfg -setdcvalueindex SCHEME_CURRENT $usbSubgroup $usbSetting 0
    powercfg -SetActive SCHEME_CURRENT
    Write-Host "Suspension selectiva USB desactivada (AC y DC = 0)."

    Write-Host "Desactivando apagado automático en dispositivos USB (MSPower_DeviceEnable)..."
    $changedCount = 0
    try {
        $usbDevices = Get-CimInstance -Namespace root\wmi -ClassName MSPower_DeviceEnable -ErrorAction SilentlyContinue
        foreach ($dev in $usbDevices) {
            if ($dev.InstanceName -like '*USB*' -and $dev.Enable -eq $true) {
                Set-CimInstance -CimInstance $dev -Property @{ Enable = $false } -ErrorAction SilentlyContinue
                $changedCount++
            }
        }
    } catch {
        Write-Host "Nota: No se pudieron modificar algunas instancias WMI de MSPower_DeviceEnable (puede ser normal en entornos virtuales o sin permisos avanzados de WMI)."
    }
    Write-Host "Dispositivos USB actualizados para no apagarse por ahorro de energía: $changedCount"
}
