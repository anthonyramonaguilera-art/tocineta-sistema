# RUNBOOK: ACCESO REMOTO SEGURO AL HUB CENTRAL TOCINETA
**Sistema Operativo Gastronómico TOCINETA**  
*Documento de Ingeniería y Operaciones — Fase 4*

---

## 1. POLÍTICA DE GOBERNANZA: CERO CONTRATACIÓN NO AUTORIZADA
> [!IMPORTANT]
> Siguiendo estrictamente las directrices del proyecto, **ningún software o servicio de terceros ha sido instalado ni contratado**. Este runbook y sus scripts acompañantes proporcionan la arquitectura, análisis técnico, comparativa de costos y plantillas de ejecución listas para ser activadas únicamente tras la decisión y confirmación del usuario.

---

## 2. EVALUACIÓN Y COMPARATIVA DE OPCIONES DE TÚNEL SALIENTE

Para comunicar la **Sede A** y el **Panel Móvil de la Dueña** con el **Hub Central (Sede Principal)** sin exponer la red local a ataques externos ni requerir IP pública estática, se evaluaron las 3 alternativas líderes de la industria:

| Criterio | Opción 1: Cloudflare Tunnel (`cloudflared`) | Opción 2: Tailscale (WireGuard Mesh) | Opción 3: Ngrok / Pinggy |
| :--- | :--- | :--- | :--- |
| **Costo** | **$0.00 / mes** (100% gratuito en Cloudflare Zero Trust) | **$0.00 / mes** (Plan Personal gratis hasta 3 usuarios y 100 nodos) | $8.00 – $20.00 / mes (plan pago para dominio fijo) |
| **Apertura de Puertos Router** | Ninguna (Túnel saliente TCP/UDP 443) | Ninguna (Túnel saliente UDP/WireGuard) | Ninguna (Túnel saliente) |
| **Soporte WebSockets** | Nativo y continuo (crucial para eventos en vivo) | Nativo de red privada | Soportado con límites de concurrencia |
| **Terminación SSL / HTTPS** | Certificados SSL/TLS automáticos y gestionados | Cifrado WireGuard extremo a extremo | Certificados gestionados por el proveedor |
| **Protección contra Ataques** | Blindaje Anti-DDoS y Web Application Firewall (WAF) | Red privada invisible desde internet público | Limitado en planes básicos |
| **Facilidad para Dispositivos** | Acceso web directo (dueña abre URL en su móvil) | Requiere app Tailscale instalada en cada equipo | Acceso web directo mediante subdominio |
| **Limitaciones Actuales** | Requiere que el dominio esté en Cloudflare DNS | Los dispositivos deben autenticarse en la red privada | En plan gratis la URL cambia al reiniciar el túnel |
| **Veredicto Técnico** | **RECOMENDADA para acceso web directo de la dueña** | **RECOMENDADA para tablets cerradas de Sede A** | Descartada para producción continua |

---

## 3. BLINDAJE DE SEGURIDAD IMPLEMENTADO EN EL SERVIDOR (HUB)

El servidor central de TOCINETA cuenta con las siguientes salvaguardas activas en código para conexiones que provienen de túneles remotos:

1. **Restricción Estricta HTTPS**:
   - Todo request marcado con `x-forwarded-proto: http` o que provenga de una URL remota sin cifrado TLS es rechazado inmediatamente con código HTTP 403 (`HTTPS_REQUIRED_FOR_REMOTE`).
2. **Sesiones Cortas de Acceso Remoto**:
   - Las sesiones de usuarios locales en la red del local duran 12 horas.
   - Las sesiones iniciadas desde el exterior tienen una validez reducida de **2 horas** tras las cuales se requiere reautenticación automática.
3. **Protección contra Fuerza Bruta**:
   - Bloqueo preventivo de cuentas tras 5 intentos fallidos consecutivos de PIN o contraseña.
4. **Registro de Auditoría Centralizada**:
   - Cada ingreso remoto genera un evento de auditoría persistente con hash criptográfico (`REMOTE_LOGIN_SUCCESS` con dirección IP de origen y agente de usuario).
5. **Aislamiento de Perfiles**:
   - Los roles operativos de mostrador (`CAJERA`, `PLANCHA`, `MESERO`) operan exclusivamente en su sede configurada. La consulta global multisucursal está reservada para el rol `ADMIN`.

---

## 4. OPERACIÓN OFFLINE EN SEDE A (PWA CON REINTENTOS IDEMPOTENTES)

Cuando la conexión entre Sede A y el Hub se degrade o caiga:

- **Cola Fuera de Línea (Outbox)**: Los pedidos y comandas se almacenan localmente en IndexedDB (`outbox.ts`).
- **Llaves de Idempotencia**: Cada mutación utiliza un UUID v7 único (`Idempotency-Key` / `clientMutationId`).
- **Reconexión Automática**: El motor de sincronización reintenta la entrega con backoff exponencial. El servidor detecta la llave previa y devuelve la respuesta cacheada sin duplicar cargos, comandas ni rebajas de inventario.

---

## 5. SCRIPTS DE EJECUCIÓN (LISTOS PARA CUANDO SE AUTORICE)

En la carpeta `scripts/` se han dispuesto los lanzadores listos para producción:

1. **`scripts/remote-tunnel-cloudflare.bat`**:
   - Descarga o ejecuta `cloudflared.exe`.
   - Conecta el puerto local `http://localhost:3000` con el túnel configurado.
2. **`scripts/remote-tunnel-tailscale.bat`**:
   - Inicia el servicio de red privada mallada para enlazar el Hub con las tablets de Sede A.

---

## 6. PROCEDIMIENTO DE VERIFICACIÓN POST-ACTIVACIÓN
1. Desde un teléfono desconectado del WiFi del restaurante (usando datos móviles 4G/LTE), abrir la URL segura del túnel.
2. Iniciar sesión con perfil `ADMIN`.
3. Comprobar que en la pantalla aparezca el **Panel de la Dueña** con los datos en tiempo real de Sede A y Sede B.
4. Verificar en `audit_events` que figure la entrada `REMOTE_LOGIN_SUCCESS` con la IP remota del operador.
