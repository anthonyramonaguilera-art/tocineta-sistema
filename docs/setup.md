# GUÍA DE INSTALACIÓN Y APROVISIONAMIENTO EN LAPTOP HP (WINDOWS 11)
**Proyecto:** Sistema Operativo Local Tocineta Sonríe  
**Cliente:** Tocineta Sonríe  
**Desarrollado por:** Varons Media  
**Hardware Destino:** Laptop HP (8 GB RAM, SSD, Windows 11)  
**Arquitectura:** Proceso Único Localhost (`apps/server` + SQLite WAL + Web compilada)  

---

## 1. REQUISITOS PREVIOS DEL SISTEMA

1. **Sistema Operativo:** Windows 10/11 Home o Pro x64.
2. **Node.js:** Versión 24 LTS instalada (verificar con `node -v`).
3. **Gestor de Paquetes pnpm:** Instalado globalmente:
   ```powershell
   npm install -g pnpm
   ```
4. **Navegador Web:** Google Chrome (recomendado) o Microsoft Edge para modo kiosco.

---

## 2. INSTALACIÓN Y COMPILACIÓN DEL MONOREPO

Abrir una consola de PowerShell en la raíz del repositorio:

```powershell
# 1. Instalar dependencias del monorepo
pnpm install

# 2. Ejecutar linters y verificación estricta de TypeScript
pnpm lint

# 3. Ejecutar suite de pruebas unitarias y de integración
pnpm test

# 4. Compilar todos los paquetes (@tocineta/shared, @tocineta/server, @tocineta/web)
pnpm build
```

---

## 3. INICIALIZACIÓN DE LA BASE DE DATOS SQLITE (WAL + FULL)

Ejecutar el runner de migraciones forward-only:

```powershell
pnpm db:migrate
```

*Verificación esperada:*
- Creación del archivo `./data/tocineta.db`.
- Activación obligatoria de PRAGMAs:
  - `journal_mode = WAL`
  - `synchronous = FULL (2)`
  - `foreign_keys = ON (1)`
  - `busy_timeout = 5000`
- Creación de la tabla de control `_system_meta` y registro en `_migrations`.

---

## 4. APROVISIONAMIENTO DEL ENTORNO WINDOWS 11 (KIOSCO Y ENERGÍA)

Abrir PowerShell con privilegios de **Administrador** y ejecutar:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\kiosk-setup.ps1
```

Este script automatiza:
1. **Perfil de Red Privada:** Configura la tarjeta de red activa en modo `Private`.
2. **Firewall de Windows:** Abre el puerto `TCP 3000` exclusivamente para la subred local (`LocalSubnet`), impidiendo accesos no autorizados desde otras redes.
3. **Plan de Energía 24/7:** Desactiva la suspensión del equipo, el apagado de pantalla y la hibernación (`powercfg /h off`), previniendo caídas del sistema o bloqueos corruptos en SQLite por Fast Startup.
4. **Protección de Horas Activas de Windows Update:** Fija el horario activo de 16:00 a 02:00 para blindar el turno de ventas del Food Truck (6:00 p. m. a 12:00 a. m.), y programa el reinicio de mantenimiento automático diario a las 04:00 AM.

---

## 5. INSTALACIÓN COMO SERVICIO DE WINDOWS (NSSM)

Para que el servidor Fastify inicie automáticamente con Windows sin requerir inicio de sesión manual de usuario:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1 -Action Install
```

*Propiedades configuradas en el servicio:*
- **Nombre:** `TocinetaSonrieServer`
- **Tipo de Inicio:** Automático (`SERVICE_AUTO_START`).
- **Recuperación ante fallos:** Reinicio automático en 5000 ms (5 segundos).
- **Rotación de Logs:** Ubicados en `./logs/server-out.log` y `./logs/server-err.log`, con rotación automática al alcanzar 10 MB.

### Comandos de Control del Servicio:
```powershell
# Estado del servicio
powershell .\scripts\install-service.ps1 -Action Status

# Reiniciar servicio
powershell .\scripts\install-service.ps1 -Action Restart

# Detener servicio
powershell .\scripts\install-service.ps1 -Action Stop
```

---

## 6. LANZAMIENTO DEL GUARDIÁN DE KIOSCO EN PANTALLA

Para la pantalla táctil de la laptop HP en la caja / barra:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\guardian.ps1
```

*Comportamiento del Guardián:*
- Abre Google Chrome en modo kiosco pantalla completa (`http://localhost:3000`).
- Si el cajero o un usuario cierra Chrome por error, el guardián detecta la salida y relanza el navegador en menos de 5 segundos.

---

## 7. VERIFICACIÓN FINAL EN VIVO

1. **Health Check:** `http://localhost:3000/api/health`
   - Debe responder código 200 con `db: "wal_full"`.
2. **System Health:** `http://localhost:3000/api/system-health`
   - Debe reportar espacio libre en SSD, memoria y hora de `America/Caracas`.
3. **Interfaz Web de Producción:** `http://localhost:3000`
   - Debe mostrar el dashboard oscuro de Tocineta Sonríe con métricas en tiempo real.

---

## 8. REPARACIÓN Y PERSISTENCIA USB DE IMPRESORA TÉRMICA (M10.1)

Las impresoras térmicas USB de 58mm económicas (como `DP58U-03` con chip USB básico `iSerialNumber = 0`) pueden cambiar de puerto (`USB001` ➔ `USB002` / `USB003`) o caer al driver genérico de Windows al reconectarse en otro puerto físico.

Para diagnosticar, remapear el puerto y asegurar el driver oficial:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\repair-printer-driver.ps1
```

*Acciones automáticas:*
- Detecta la cola activa (`DP58U-03` o `POS-58`) y los puertos `USB00*` disponibles.
- Si el puerto USB activo cambió, lo reasigna automáticamente con `Set-Printer -PortName`.
- Configura `Set-Printer -KeepPrintedJobs $false` para evitar acumulación residual de trabajos RAW en el spooler.
- Si Windows intentó asociar el driver genérico `Generic / Text Only`, lo restaura automáticamente al driver oficial `POS-58`.
- Este script se invoca automáticamente en cada arranque mediante `scripts/guardian.ps1`.
