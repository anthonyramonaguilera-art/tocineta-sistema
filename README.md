# SISTEMA OPERATIVO LOCAL TOCINETA SONRÍE
## Gate G0: Herramientas de Diagnóstico Físico de Impresoras Térmicas y Red

Herramienta de diagnóstico CLI y servidor HTTP ligero para la validación en vivo de las impresoras térmicas de 58mm (**DP58U-03** y **MP583**), red LAN y conectividad de dispositivos Android sin acceso a internet en el Food Truck de **Tocineta Sonríe** (Varons Media).

---

### Entregables del Gate G0
* [tools/g0-probe/raw-spooler.ps1](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/tools/g0-probe/raw-spooler.ps1): Script PowerShell con `Add-Type` a `winspool.Drv` para envío binario ESC/POS en modo `"RAW"` sin diálogos ni `Out-Printer`.
* [tools/g0-probe/probe.ts](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/tools/g0-probe/probe.ts): Diagnóstico completo en Node.js 24 LTS + TypeScript (USB Spooler RAW, TCP 9100, regla de 42 columnas, matriz de codepages en español, logo raster `GS v 0` a 384 dots y servidor HTTP con `/health`).
* [docs/g0-checklist.md](file:///c:/Users/Shell/Documents/Varonsmedia/clientes/tocinetasonrie/SISTEMA/docs/g0-checklist.md): Hoja de ruta y protocolo paso a paso para la visita técnica al Food Truck.

---

### Comandos de Aceptación

```powershell
# 1. Listar impresoras instaladas en Windows
pnpm tsx tools/g0-probe/probe.ts --list

# 2. Enviar ticket de prueba completo por USB Spooler RAW
pnpm tsx tools/g0-probe/probe.ts --usb "<NombreImpresora>"

# 3. Enviar ticket de prueba completo por TCP 9100 (LAN)
pnpm tsx tools/g0-probe/probe.ts --tcp "192.168.31.200:9100"

# 4. Iniciar Servidor HTTP Dashboard para celulares Android
pnpm tsx tools/g0-probe/probe.ts --port 3000
```

Desde cualquier celular Android conectado a la red Wi-Fi del Food Truck (sin internet):
1. Abrir Chrome y navegar a: `http://<IP_LAPTOP>:3000/health`
2. Usar el botón grande **"🔔 PROBAR PITIDO Y CORTE"** para probar la respuesta en tiempo real.
