package com.tocineta.terminal.bridge

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.FileProvider
import com.tocineta.terminal.bt.PermissionHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.File
import java.io.IOException

class NativeBridge(
    private val webView: WebView,
    private val printerGateway: PrinterGateway,
    private val activity: Activity? = null
) {

    companion object {
        const val JAVASCRIPT_INTERFACE_NAME = "__TocinetaNativeBridge"
        const val MAX_BASE64_LENGTH = 35 * 1024 * 1024 // ~25 MB binario en Base64

        fun sanitizeFileName(rawName: String): String {
            var name = rawName.replace('\\', '/').substringAfterLast('/')
            while (name.contains("..")) {
                name = name.replace("..", "")
            }
            name = name.replace("/", "").replace("\\", "").trim()
            return if (name.isEmpty() || name == ".") "archivo_descargado" else name
        }
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val mainHandler = Handler(Looper.getMainLooper())

    fun destroy() {
        try {
            scope.cancel()
        } catch (_: Throwable) {
        }
    }

    @JavascriptInterface
    fun getCapabilities(callId: String, argsJson: String) {
        dispatch("getCapabilities", callId, argsJson)
    }

    @JavascriptInterface
    fun getSelectedPrinter(callId: String, argsJson: String) {
        dispatch("getSelectedPrinter", callId, argsJson)
    }

    @JavascriptInterface
    fun printEscPos(callId: String, argsJson: String) {
        dispatch("printEscPos", callId, argsJson)
    }

    @JavascriptInterface
    fun listPairedPrinters(callId: String, argsJson: String) {
        dispatch("listPairedPrinters", callId, argsJson)
    }

    @JavascriptInterface
    fun selectPrinter(callId: String, argsJson: String) {
        dispatch("selectPrinter", callId, argsJson)
    }

    @JavascriptInterface
    fun testPrint(callId: String, argsJson: String) {
        dispatch("testPrint", callId, argsJson)
    }

    @JavascriptInterface
    fun getBluetoothStatus(callId: String, argsJson: String) {
        dispatch("getBluetoothStatus", callId, argsJson)
    }

    @JavascriptInterface
    fun saveAndOpenFile(callId: String, argsJson: String) {
        dispatch("saveAndOpenFile", callId, argsJson)
    }

    @JavascriptInterface
    fun postMessage(method: String, callId: String, argsJson: String) {
        dispatch(method, callId, argsJson)
    }

    @JavascriptInterface
    fun postMessage(callId: String, argsJson: String) {
        val method = extractString(argsJson, "action").ifEmpty { extractString(argsJson, "method") }
        dispatch(method, callId, argsJson)
    }

    private fun dispatch(method: String, callId: String, argsJson: String) {
        scope.launch {
            try {
                when (method) {
                    "getCapabilities" -> {
                        val caps = printerGateway.getCapabilities()
                        val json = """{"bluetoothSpp":${caps.bluetoothSpp}}"""
                        resolve(callId, json)
                    }
                    "getSelectedPrinter" -> {
                        val printer = printerGateway.getSelectedPrinter()
                        val json = if (printer != null) {
                            """{"name":"${escapeJson(printer.name)}","mac":"${escapeJson(printer.mac)}"}"""
                        } else {
                            "null"
                        }
                        resolve(callId, json)
                    }
                    "printEscPos" -> {
                        val mac = extractString(argsJson, "mac")
                        val base64 = extractString(argsJson, "base64")
                        val res = printerGateway.printEscPos(mac, base64)
                        val sb = StringBuilder()
                        sb.append("""{"success":${res.success}""")
                        if (res.bytesSent != null) {
                            sb.append(""","bytesSent":${res.bytesSent}""")
                        }
                        if (res.error != null) {
                            sb.append(""","error":"${escapeJson(res.error)}"""")
                        }
                        sb.append("}")
                        resolve(callId, sb.toString())
                    }
                    "listPairedPrinters" -> {
                        requestBluetoothPermissionIfNeeded()
                        val list = printerGateway.listPairedPrinters()
                        val json = list.joinToString(prefix = "[", postfix = "]") { p ->
                            """{"name":"${escapeJson(p.name)}","mac":"${escapeJson(p.mac)}"}"""
                        }
                        resolve(callId, json)
                    }
                    "selectPrinter" -> {
                        val mac = extractString(argsJson, "mac")
                        val res = printerGateway.selectPrinter(mac)
                        val json = if (res.error != null) {
                            """{"ok":${res.ok},"error":"${escapeJson(res.error)}"}"""
                        } else {
                            """{"ok":${res.ok}}"""
                        }
                        resolve(callId, json)
                    }
                    "testPrint" -> {
                        val res = printerGateway.testPrint()
                        val json = if (res.error != null) {
                            """{"success":${res.success},"error":"${escapeJson(res.error)}"}"""
                        } else {
                            """{"success":${res.success}}"""
                        }
                        resolve(callId, json)
                    }
                    "getBluetoothStatus" -> {
                        requestBluetoothPermissionIfNeeded()
                        val status = printerGateway.getBluetoothStatus()
                        val json = """{"permission":${status.permission},"enabled":${status.enabled},"connected":${status.connected}}"""
                        resolve(callId, json)
                    }
                    "saveAndOpenFile" -> {
                        handleSaveAndOpenFile(callId, argsJson)
                    }
                    else -> {
                        reject(callId, "Método desconocido: $method")
                    }
                }
            } catch (t: Throwable) {
                reject(callId, t.message ?: "Error al ejecutar $method")
            }
        }
    }

    private fun requestBluetoothPermissionIfNeeded() {
        val act = activity ?: (webView.context as? Activity) ?: return
        mainHandler.post {
            PermissionHelper.requestBluetoothPermissionIfNeeded(act)
        }
    }

    private fun handleSaveAndOpenFile(callId: String, argsJson: String) {
        val rawFileName = extractString(argsJson, "fileName").ifEmpty { extractString(argsJson, "filename") }
        val mimeType = extractString(argsJson, "mimeType").trim()
        val base64Data = extractString(argsJson, "base64Data").trim()

        if (mimeType.isEmpty()) {
            reject(callId, "Tipo MIME vacío o no especificado")
            return
        }

        if (base64Data.isEmpty()) {
            reject(callId, "Datos del archivo vacíos")
            return
        }

        if (base64Data.length > MAX_BASE64_LENGTH) {
            reject(callId, "El archivo excede el tamaño máximo permitido de 25 MB")
            return
        }

        val bytes = try {
            android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
        } catch (t: Throwable) {
            reject(callId, "Error al decodificar base64: ${t.message ?: "formato inválido"}")
            return
        }

        if (bytes.isEmpty()) {
            reject(callId, "El archivo está vacío")
            return
        }

        if (bytes.size > 25 * 1024 * 1024) {
            reject(callId, "El archivo excede el tamaño máximo permitido de 25 MB")
            return
        }

        val sanitizedFileName = sanitizeFileName(rawFileName)
        val context = activity ?: webView.context

        val opened = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val contentValues = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, sanitizedFileName)
                put(MediaStore.Downloads.MIME_TYPE, mimeType)
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
                ?: throw IOException("No se pudo crear el archivo en Descargas")

            try {
                resolver.openOutputStream(uri)?.use { stream ->
                    stream.write(bytes)
                    stream.flush()
                } ?: throw IOException("No se pudo abrir el flujo para escribir en Descargas")

                contentValues.clear()
                contentValues.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, contentValues, null, null)
            } catch (e: Throwable) {
                try {
                    resolver.delete(uri, null, null)
                } catch (_: Throwable) {
                }
                throw e
            }

            openFileUri(context, uri, mimeType)
        } else {
            val downloadDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                ?: throw IOException("No se pudo acceder al directorio de Descargas")
            if (!downloadDir.exists()) {
                downloadDir.mkdirs()
            }
            val targetFile = File(downloadDir, sanitizedFileName)
            targetFile.writeBytes(bytes)

            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                targetFile
            )
            openFileUri(context, uri, mimeType)
        }

        val resultJson = """{"ok":true,"fileName":"${escapeJson(sanitizedFileName)}","opened":$opened}"""
        resolve(callId, resultJson)
    }

    private fun openFileUri(context: Context, uri: Uri, mimeType: String): Boolean {
        return try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mimeType)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: Throwable) {
            false
        }
    }

    private fun resolve(callId: String, resultJson: String) {
        val escapedCallId = escapeJs(callId)
        val script = "window.__tocinetaResolve('$escapedCallId', $resultJson, null);"
        evaluateOnMainThread(script)
    }

    private fun reject(callId: String, errorMessage: String) {
        val escapedCallId = escapeJs(callId)
        val escapedError = escapeJs(errorMessage)
        val script = "window.__tocinetaResolve('$escapedCallId', null, '$escapedError');"
        evaluateOnMainThread(script)
    }

    private fun evaluateOnMainThread(script: String) {
        try {
            mainHandler.post {
                try {
                    webView.evaluateJavascript(script, null)
                } catch (_: Throwable) {
                    // Silenciar excepciones en caso de que el WebView se haya destruido
                }
            }
        } catch (_: Throwable) {
            // Silenciar excepciones en caso de fallo del Handler
        }
    }

    private fun extractString(json: String?, key: String): String {
        if (json.isNullOrBlank()) return ""
        return try {
            val regex = Regex("\"$key\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"")
            val match = regex.find(json)
            if (match != null) {
                val raw = match.groupValues[1]
                raw.replace("\\\"", "\"").replace("\\\\", "\\")
            } else {
                ""
            }
        } catch (_: Throwable) {
            ""
        }
    }

    private fun escapeJson(value: String): String {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\b", "\\b")
            .replace("\u000C", "\\f")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    }

    private fun escapeJs(value: String): String {
        return value
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\"", "\\\"")
            .replace("\r", "\\r")
            .replace("\n", "\\n")
            .replace("\u2028", "\\u2028")
            .replace("\u2029", "\\u2029")
    }
}
