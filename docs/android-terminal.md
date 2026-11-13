# Terminal Android — TOCINETA

Este documento detalla la arquitectura, el proceso de compilación release firmado y el mecanismo de distribución local del instalador APK para los terminales Android de servicio del ecosistema TOCINETA.

---

## 1. Arquitectura y Función del Terminal

El terminal Android (`android-terminal/`) es una aplicación nativa diseñada para dispositivos de servicio (caja, mesoneros y comandas de cocina). Integra:
- WebView acelerado por hardware para renderizar la interfaz de TOCINETA.
- Descubrimiento de red local en tres capas (memoria, barrido `/24` y configuración manual).
- Soporte para operación sin internet (LAN pura) respetando el aislamiento de almacenamiento local.

---

## 2. Configuración del Build Release y Firma

El archivo `android-terminal/app/build.gradle.kts` gestiona la variante `release` con las siguientes directivas:
- `versionCode = 1`
- `versionName = "1.0.0"`
- `isMinifyEnabled = false`

### Requisitos de Firma
Para compilar la variante `release`, es obligatorio configurar `android-terminal/keystore.properties` con las credenciales de la llave:
- `storeFile`: Ruta del archivo de almacén (`.jks`).
- `storePassword`: Contraseña del keystore.
- `keyAlias`: Alias de la clave privada.
- `keyPassword`: Contraseña de la clave privada.

Si se invoca una tarea `Release` sin dicho archivo, la compilación de Gradle se detiene arrojando:
```text
Falta android-terminal/keystore.properties. Consulta KEYSTORE.md
```
*(Las tareas `Debug` como `assembleDebug` y `testDebugUnitTest` continúan funcionando sin requerir este archivo).*

Consulta la guía completa de generación y resguardo en `android-terminal/KEYSTORE.md`.

---

## 3. Publicación Automatizada del APK

Para compilar y disponibilizar el instalador en el servidor local, ejecuta el script oficial:

```powershell
.\scripts\publicar-apk.ps1
```

Este script ejecuta las siguientes acciones:
1. Compila `.\gradlew.bat assembleRelease` dentro de `android-terminal/`.
2. Verifica la generación del binario en `android-terminal/app/build/outputs/apk/release/app-release.apk`.
3. Copia el binario a `data/apk/tocineta-terminal.apk`.
4. Genera `data/apk/version.txt` con el contenido `1.0.0 (1)`.

---

## 4. Distribución desde la Laptop Servidora

El servidor Fastify expone los siguientes recursos estáticos desde la laptop:

| Ruta | Descripción | Acceso |
|---|---|---|
| `/apk-instalar.html` | Portal web de descarga asistida con instrucciones | Público |
| `/apk/tocineta-terminal.apk` | Binario del instalador Android de producción | Público |
| `/apk/version.txt` | Versión actual publicada (`1.0.0 (1)`) | Público |

### Seguridad y Enrutamiento
- **Aislamiento 404:** Las peticiones a rutas inexistentes bajo `/apk/*` devuelven un error `404` JSON/texto y nunca el `index.html` de la Single Page Application (SPA).
- **Control de Traversal:** Peticiones de escape de directorio (como `GET /apk/../server-id.txt`) son bloqueadas por el servidor estático (403/404).
- **Política de Rutas:** Clasificado automáticamente como recurso estático público en `route-policy.ts`.

---

## 5. Procedimiento de Instalación en Celulares de Turno

1. **Conexión Wi-Fi:** Conectar el teléfono a la red local del restaurante y aceptar la notificación del sistema para mantener la conexión activa sin internet.
2. **Descarga:** Abrir el navegador en el dispositivo e ingresar a `http://<IP-LAPTOP>:3000/apk-instalar.html`, pulsando el botón **"Descargar TOCINETA para Android"**.
3. **Instalación:** Abrir el archivo descargado y conceder permiso de instalación de aplicaciones desconocidas al navegador si el sistema lo solicita.
4. **Inicio:** Abrir la aplicación TOCINETA e introducir el PIN de usuario asignado para iniciar el turno.
