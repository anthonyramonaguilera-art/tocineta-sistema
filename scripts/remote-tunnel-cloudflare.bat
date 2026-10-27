@echo off
REM ============================================================================
REM SISTEMA OPERATIVO GASTRONÓMICO TOCINETA
REM Script de Lanzamiento de Túnel Saliente Cloudflare (Zero Trust)
REM
REM Este script NO instala servicios de terceros automáticamente.
REM Requiere confirmación y descarga previa del binario oficial cloudflared.exe
REM desde https://github.com/cloudflare/cloudflared/releases
REM ============================================================================

echo =======================================================
echo   SISTEMA TOCINETA - TUNEL REMOTO CLOUDFLARE (HUB)
echo =======================================================
echo.

set CLOUDFLARED_BIN=C:\tocineta-tools\cloudflared.exe
if not exist "%CLOUDFLARED_BIN%" (
    set CLOUDFLARED_BIN=cloudflared
)

where cloudflared >nul 2>nul
if %errorlevel% neq 0 (
    if not exist "%CLOUDFLARED_BIN%" (
        echo [ERROR] No se encontro el ejecutable 'cloudflared'.
        echo Por favor descargue 'cloudflared-windows-amd64.exe' de:
        echo https://github.com/cloudflare/cloudflared/releases
        echo y coloquelo en C:\tocineta-tools\cloudflared.exe o en el PATH del sistema.
        echo.
        pause
        exit /b 1
    )
)

echo [INFO] Iniciando tunel saliente seguro hacia el Hub local (puerto 3000)...
echo [SEGURIDAD] Recuerde que el servidor Hub exige HTTPS para sesiones remotas.
echo.

REM Inicia el túnel apuntando al puerto HTTP local del Hub de TOCINETA
"%CLOUDFLARED_BIN%" tunnel --url http://localhost:3000

pause
