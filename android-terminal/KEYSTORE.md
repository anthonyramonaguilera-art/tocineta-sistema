# Firma y Keystore de Producción — TOCINETA Terminal

Esta guía documenta la generación de la llave de firma release para la aplicación Android de TOCINETA, la configuración del archivo local de propiedades y las directrices de respaldo seguro fuera del repositorio.

---

## 1. Generación de Keystore

Para generar el archivo de almacén de claves (`.jks`), ejecuta en una terminal el comando exacto de `keytool`:

```bash
keytool -genkeypair -v -keystore tocineta-terminal.jks -alias tocineta -keyalg RSA -keysize 2048 -validity 10000
```

Durante la ejecución, `keytool` solicitará una contraseña para el keystore y los datos de identificación del certificado (nombre, unidad organizativa, organización, ciudad, estado, país).

---

## 2. Formato de `keystore.properties`

Crea el archivo `android-terminal/keystore.properties` con los parámetros correspondientes a la llave generada:

```properties
storeFile=tocineta-terminal.jks
storePassword=tu_password_del_keystore
keyAlias=tocineta
keyPassword=tu_password_de_la_clave
```

> [!NOTE]
> La ruta especificada en `storeFile` es relativa a la carpeta `android-terminal/` o puede definirse como una ruta absoluta del sistema de archivos.

---

## 3. Respaldo y Seguridad Fuera del Repositorio

> [!CAUTION]
> El archivo `keystore.properties` y el archivo de almacén `tocineta-terminal.jks` contienen secretos criptográficos críticos.
> Están explícitamente ignorados en `.gitignore` para evitar su exposición accidental.

1. **Nunca confirmar al repositorio:** No elimines del `.gitignore` las extensiones `*.jks`, `*.keystore` ni el archivo `keystore.properties`.
2. **Respaldo en almacenamiento seguro externo:** Guarda una copia de `tocineta-terminal.jks` y las contraseñas en un gestor de credenciales corporativo o almacenamiento cifrado externo y desconectado.
3. **Imposibilidad de recuperación:** Si se pierde la clave privada o el archivo `.jks`, no será posible actualizar la aplicación en dispositivos existentes sin desinstalarla previamente, lo que causaría la pérdida del almacenamiento local fuera de línea.
