package com.tocineta.terminal.bridge

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.tocineta.terminal.bt.PermissionHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class NativeBridge(
    private val webView: WebView,
    private val printerGateway: PrinterGateway,
    private val activity: Activity? = null
) {

    companion object {
        const val JAVASCRIPT_INTERFACE_NAME = "__TocinetaNativeBridge"
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
