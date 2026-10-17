<#
.SYNOPSIS
    kiosk-setup.ps1 - Configuración de entorno Windows 11 para Kiosco Food Truck (Laptop HP)
.DESCRIPTION
    Aprovisiona el sistema operativo Windows 11 para operación continua y de alta fiabilidad:
    1. Cambia el perfil de red activo a 'Private'.
    2. Configura regla de Firewall de Windows para TCP 3000 restringido a 'LocalSubnet'.
    3. Desactiva suspensión, apagado de pantalla e hibernación con powercfg.
    4. Configura Horas Activas de Windows Update de 16:00 a 02:00 y programa mantenimiento a las 04:00.
    5. Configura el Guardián de Kiosco (guardian.ps1).
#>

[CmdletBinding()]
param(
    [int]$Port = 3000
)

Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host "🍟 APROVISIONAMIENTO DE WINDOWS 11 - KIOSCO TOCINETA SONRÍE" -ForegroundColor Cyan
Write-Host "=============================================================`n"

# 1. Comprobación de Privilegios de Administrador
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "⚠️ Debe ejecutar este script con privilegios de Administrador para aplicar directivas de red, firewall y energía."
}

# 2. Configurar perfil de red a 'Private'
Write-Host "1️⃣ Configurando perfil de red activo a 'Private'..." -ForegroundColor Yellow
try {
    $connections = Get-NetConnectionProfile -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        if ($conn.NetworkCategory -ne 'Private') {
            Set-NetConnectionProfile -InterfaceIndex $conn.InterfaceIndex -NetworkCategory Private -ErrorAction SilentlyContinue
            Write-Host "   - Red '$($conn.Name)' establecida en modo 'Private'." -ForegroundColor Green
        } else {
            Write-Host "   - Red '$($conn.Name)' ya se encuentra en modo 'Private'." -ForegroundColor Green
        }
    }
} catch {
    Write-Warning "No se pudo cambiar el perfil de red automáticamente: $_"
}

# 3. Configurar Regla en Firewall de Windows (TCP 3000 para LocalSubnet)
Write-Host "`n2️⃣ Configurando regla de Firewall de Windows para TCP $Port (LocalSubnet)..." -ForegroundColor Yellow
$ruleName = "Tocineta Sonrie Local Port $Port"
try {
    # Eliminar regla anterior si existe para evitar duplicados
    Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

    New-NetFirewallRule `
        -DisplayName $ruleName `
        -Description "Permite conexiones HTTP a la API y Web del sistema local Tocineta Sonrie exclusivamente desde la subred local (LAN)." `
        -Direction Inbound `
        -LocalPort $Port `
        -Protocol TCP `
        -Action Allow `
        -RemoteAddress LocalSubnet `
        -Profile Private, Domain `
        -ErrorAction Stop | Out-Null

    Write-Host "   ✅ Regla de firewall '$ruleName' creada exitosamente (LocalSubnet permitido)." -ForegroundColor Green
} catch {
    Write-Warning "No se pudo crear la regla de firewall: $_"
}

# 4. Desactivar suspensión, hibernación e inicio rápido con powercfg
Write-Host "`n3️⃣ Optimizando perfil de energía para operación continua (powercfg)..." -ForegroundColor Yellow
try {
    # Desactivar suspensión con corriente alterna y batería
    powercfg /change standby-timeout-ac 0
    powercfg /change standby-timeout-dc 0
    powercfg /change monitor-timeout-ac 0
    powercfg /change monitor-timeout-dc 0
    powercfg /change disk-timeout-ac 0
    powercfg /change disk-timeout-dc 0

    # Desactivar hibernación (lo que también desactiva el Fast Startup de Windows que suele corromper bloqueos de SQLite)
    powercfg /hibernate off

    Write-Host "   ✅ Suspensión, apagado de pantalla e hibernación desactivados (operación 24/7 segura)." -ForegroundColor Green
} catch {
    Write-Warning "Error al aplicar configuración de energía: $_"
}

# 5. Configurar Horas Activas de Windows Update (16:00 a 02:00) y mantenimiento a las 04:00
Write-Host "`n4️⃣ Protegiendo turno comercial en Windows Update (Horas Activas: 16:00 a 02:00)..." -ForegroundColor Yellow
try {
    $uxPath = "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings"
    if (-not (Test-Path $uxPath)) {
        New-Item -Path $uxPath -Force | Out-Null
    }

    # Desactivar ajuste automático inteligente de horas activas
    Set-ItemProperty -Path $uxPath -Name "SmartActiveHoursState" -Value 0 -Type DWord -Force
    # Hora de inicio: 16 (4:00 PM)
    Set-ItemProperty -Path $uxPath -Name "ActiveHoursStart" -Value 16 -Type DWord -Force
    # Hora de fin: 2 (2:00 AM del día siguiente)
    Set-ItemProperty -Path $uxPath -Name "ActiveHoursEnd" -Value 2 -Type DWord -Force

    Write-Host "   ✅ Horas Activas fijadas de 16:00 a 02:00 (Turno protegido: 6:00 PM - 12:00 AM)." -ForegroundColor Green

    # Programar reinicio de mantenimiento automático diario a las 04:00 AM
    $taskName = "Tocineta_Daily_Maintenance_Reboot"
    $action = New-ScheduledTaskAction -Execute "shutdown.exe" -Argument "/r /t 60 /c ""Reinicio programado de mantenimiento diario Tocineta Sonrie"""
    $trigger = New-ScheduledTaskTrigger -Daily -At "04:00"
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Description "Reinicio preventivo nocturno fuera de horario operativo." | Out-Null

    Write-Host "   ✅ Tarea programada de reinicio de mantenimiento nocturno configurada para las 04:00 AM." -ForegroundColor Green
} catch {
    Write-Warning "No se pudo configurar Windows Update / Tarea de reinicio: $_"
}

# 6. Verificación de Guardian de Kiosco
Write-Host "`n5️⃣ Verificando script de supervisión de Kiosco (guardian.ps1)..." -ForegroundColor Yellow
$guardianPath = Join-Path $PSScriptRoot "guardian.ps1"
if (Test-Path $guardianPath) {
    Write-Host "   ✅ Guardián localizado en: $guardianPath" -ForegroundColor Green
} else {
    Write-Warning "No se encontró guardian.ps1 en: $guardianPath"
}

Write-Host "`n🎉 Aprovisionamiento de Kiosco completado exitosamente.`n" -ForegroundColor Cyan
