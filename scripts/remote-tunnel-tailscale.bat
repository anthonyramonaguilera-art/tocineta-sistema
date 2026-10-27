@echo off
REM ============================================================================
REM SISTEMA OPERATIVO GASTRONÓMICO TOCINETA
REM Script de Lanzamiento de Red Privada Mallada Tailscale (WireGuard)
REM
REM Este script NO instala software de terceros automáticamente.
REM Requiere tener instalado el cliente oficial Tailscale para Windows.
REM https://tailscale.com/download/windows
REM ============================================================================

echo =======================================================
echo   SISTEMA TOCINETA - MALLA PRIVADA TAILSCALE (HUB)
echo =======================================================
echo.

where tailscale >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] No se encontro el comando 'tailscale'.
    echo Asegurese de tener instalado Tailscale desde https://tailscale.com/download
    echo.
    pause
    exit /b 1
)

echo [INFO] Verificando estado de la red privada Tailscale...
tailscale status

echo.
echo [INFO] La IP de esta maquina dentro de la malla Tailscale es:
tailscale ip -4

echo.
echo [INFO] Las tablets de Sede A pueden acceder al Hub usando la IP anterior en el puerto 3000.
echo.
pause
