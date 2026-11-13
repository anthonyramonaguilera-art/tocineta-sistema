# TOCINETA Terminal (Android)

Aplicación Android en Kotlin para terminales de punto de venta (POS) y visualización web del sistema TOCINETA mediante WebView dedicado.

## Requisitos de desarrollo

- **JDK:** OpenJDK 21 o superior (compatibilidad jvmTarget 17 configurada).
- **Android SDK:** API 34 (Android 14) instalado en `local.properties`.
- **Gradle:** 8.7 (utiliza el wrapper incluido `gradlew`).

## Compilación

Para compilar el APK de depuración en Windows (PowerShell / CMD):

```powershell
cd android-terminal
.\gradlew.bat assembleDebug
```

Para ejecutar pruebas unitarias:

```powershell
cd android-terminal
.\gradlew.bat testDebugUnitTest
```

## Ubicación del APK resultante

Tras ejecutar `assembleDebug`, el APK generado se encuentra en:

```
android-terminal/app/build/outputs/apk/debug/app-debug.apk
```
