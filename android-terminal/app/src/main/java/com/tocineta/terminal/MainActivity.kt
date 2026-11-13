package com.tocineta.terminal

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.tocineta.terminal.bridge.BridgeScript
import com.tocineta.terminal.bridge.NativeBridge
import com.tocineta.terminal.bridge.NoopPrinterGateway
import com.tocineta.terminal.bridge.PrinterGateway
import com.tocineta.terminal.net.ServerDiscovery
import com.tocineta.terminal.net.WifiBinder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

class MainActivity : AppCompatActivity() {

    private lateinit var prefs: SharedPreferences
    private lateinit var wifiBinder: WifiBinder

    private lateinit var nativeBridge: NativeBridge
    private val printerGateway: PrinterGateway = NoopPrinterGateway()
    private var bridgeScript: String = ""
    private var documentStartScriptHandler: ScriptHandler? = null
    private var isDocumentStartScriptActive = false

    private val activityScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var discoveryJob: Job? = null

    private lateinit var rootContainer: FrameLayout
    private lateinit var webView: WebView
    private lateinit var setupView: LinearLayout
    private lateinit var searchingView: LinearLayout
    private lateinit var searchingStatusText: TextView
    private lateinit var errorView: LinearLayout

    private var currentAllowedUri: Uri? = null

    companion object {
        private const val PREFS_NAME = "tocineta_terminal_prefs"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_SERVER_ID = "server_id"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Mantener pantalla encendida
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        val terminalId = BridgeScript.getOrCreateTerminalId(prefs)
        bridgeScript = BridgeScript.buildScript(terminalId)

        wifiBinder = WifiBinder(this)
        wifiBinder.start()

        rootContainer = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        setContentView(rootContainer)

        setupWebView()
        setupSearchingView()
        setupErrorView()
        setupNativeConfigView()

        // Iniciar flujo de descubrimiento
        startDiscoveryFlow()

        // Manejo del botón físico Atrás: si webView puede ir atrás, navega; si no, NO cierra la app.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.visibility == View.VISIBLE && webView.canGoBack()) {
                    webView.goBack()
                }
            }
        })
    }

    override fun onDestroy() {
        if (::nativeBridge.isInitialized) {
            nativeBridge.destroy()
        }
        discoveryJob?.cancel()
        activityScope.cancel()
        wifiBinder.release()
        super.onDestroy()
    }

    private fun startDiscoveryFlow() {
        discoveryJob?.cancel()
        discoveryJob = activityScope.launch {
            showSearchingView("Buscando el servidor...")

            // Espera wifiBound hasta 4 s
            val bound = withTimeoutOrNull(4000L) {
                wifiBinder.wifiBound.first { it }
            } ?: false

            if (!bound) {
                searchingStatusText.text = "Sin Wi-Fi: conéctate a la red del local"
                // Espera hasta que se enlace el Wi-Fi
                wifiBinder.wifiBound.first { it }
                searchingStatusText.text = "Buscando el servidor..."
            }

            val savedUrl = prefs.getString(KEY_SERVER_URL, null)
            val savedServerId = prefs.getString(KEY_SERVER_ID, null)

            // Capa A: Probar URL guardada en SharedPreferences
            if (!savedUrl.isNullOrBlank()) {
                val serverA = ServerDiscovery.tryLayerA(savedUrl, savedServerId)
                if (serverA != null) {
                    saveServerInfo(serverA.url, serverA.serverId)
                    connectToServer(serverA.url)
                    return@launch
                }
            }

            // Capa B: Barrido /24 en el puerto 3000
            val prefix = withTimeoutOrNull(2000L) {
                wifiBinder.localIpv4Prefix.first { !it.isNullOrBlank() }
            } ?: wifiBinder.localIpv4Prefix.value

            if (!prefix.isNullOrBlank()) {
                val serverB = ServerDiscovery.scanSubnet(prefix, savedServerId, port = 3000)
                if (serverB != null) {
                    saveServerInfo(serverB.url, serverB.serverId)
                    connectToServer(serverB.url)
                    return@launch
                }
            }

            // Capa C: Pantalla manual
            showConfigView()
        }
    }

    private fun retryScanLayerB() {
        discoveryJob?.cancel()
        discoveryJob = activityScope.launch {
            showSearchingView("Buscando el servidor...")

            val isBound = wifiBinder.wifiBound.value
            if (!isBound) {
                val bound = withTimeoutOrNull(2000L) {
                    wifiBinder.wifiBound.first { it }
                } ?: false
                if (!bound) {
                    searchingStatusText.text = "Sin Wi-Fi: conéctate a la red del local"
                    wifiBinder.wifiBound.first { it }
                    searchingStatusText.text = "Buscando el servidor..."
                }
            }

            val prefix = withTimeoutOrNull(2000L) {
                wifiBinder.localIpv4Prefix.first { !it.isNullOrBlank() }
            } ?: wifiBinder.localIpv4Prefix.value

            val savedServerId = prefs.getString(KEY_SERVER_ID, null)

            if (!prefix.isNullOrBlank()) {
                val serverB = ServerDiscovery.scanSubnet(prefix, savedServerId, port = 3000)
                if (serverB != null) {
                    saveServerInfo(serverB.url, serverB.serverId)
                    connectToServer(serverB.url)
                    return@launch
                }
            }

            showConfigView()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            visibility = View.GONE
        }

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        nativeBridge = NativeBridge(webView, printerGateway)
        webView.addJavascriptInterface(nativeBridge, NativeBridge.JAVASCRIPT_INTERFACE_NAME)

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                if (!isDocumentStartScriptActive) {
                    view?.evaluateJavascript(bridgeScript, null)
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val targetUri = request?.url ?: return true
                val allowed = currentAllowedUri

                if (allowed != null &&
                    targetUri.scheme.equals(allowed.scheme, ignoreCase = true) &&
                    targetUri.host.equals(allowed.host, ignoreCase = true) &&
                    targetUri.port == allowed.port
                ) {
                    return false
                }
                return true
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    showErrorView()
                }
            }
        }

        rootContainer.addView(webView)
    }

    private fun setupSearchingView() {
        searchingView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.WHITE)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            val padding = dpToPx(24)
            setPadding(padding, padding, padding, padding)
            visibility = View.GONE
        }

        val titleView = TextView(this).apply {
            text = "TOCINETA"
            textSize = 28f
            setTextColor(Color.parseColor("#111827"))
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(24)
            }
        }

        val progressBar = ProgressBar(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(20)
            }
        }

        searchingStatusText = TextView(this).apply {
            text = "Buscando el servidor..."
            textSize = 16f
            setTextColor(Color.parseColor("#374151"))
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(28)
            }
        }

        val manualButton = Button(this).apply {
            text = "Ingresar dirección manualmente"
            minHeight = dpToPx(48)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            setOnClickListener {
                discoveryJob?.cancel()
                showConfigView()
            }
        }

        searchingView.addView(titleView)
        searchingView.addView(progressBar)
        searchingView.addView(searchingStatusText)
        searchingView.addView(manualButton)

        rootContainer.addView(searchingView)
    }

    private fun setupErrorView() {
        errorView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.WHITE)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            val padding = dpToPx(24)
            setPadding(padding, padding, padding, padding)
            visibility = View.GONE
        }

        val titleView = TextView(this).apply {
            text = "TOCINETA"
            textSize = 28f
            setTextColor(Color.parseColor("#111827"))
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(16)
            }
        }

        val messageView = TextView(this).apply {
            text = "Sin conexión con el servidor"
            textSize = 18f
            setTextColor(Color.parseColor("#DC2626"))
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(32)
            }
        }

        val retryButton = Button(this).apply {
            text = "Reintentar"
            minHeight = dpToPx(48)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(12)
            }
            setOnClickListener {
                val savedUrl = prefs.getString(KEY_SERVER_URL, null)
                if (!savedUrl.isNullOrBlank()) {
                    activityScope.launch {
                        showSearchingView("Reconectando...")
                        val valid = ServerDiscovery.checkHealth(savedUrl, timeoutMs = 1500)
                        if (valid != null) {
                            saveServerInfo(valid.url, valid.serverId)
                            connectToServer(valid.url)
                        } else {
                            showErrorView()
                        }
                    }
                } else {
                    startDiscoveryFlow()
                }
            }
        }

        val searchAgainButton = Button(this).apply {
            text = "Buscar de nuevo"
            minHeight = dpToPx(48)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(12)
            }
            setOnClickListener {
                retryScanLayerB()
            }
        }

        val changeServerButton = Button(this).apply {
            text = "Cambiar servidor"
            minHeight = dpToPx(48)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            setOnClickListener {
                showConfigView()
            }
        }

        errorView.addView(titleView)
        errorView.addView(messageView)
        errorView.addView(retryButton)
        errorView.addView(searchAgainButton)
        errorView.addView(changeServerButton)

        rootContainer.addView(errorView)
    }

    private fun setupNativeConfigView() {
        setupView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.WHITE)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            val padding = dpToPx(24)
            setPadding(padding, padding, padding, padding)
            visibility = View.GONE
        }

        val titleView = TextView(this).apply {
            text = "TOCINETA"
            textSize = 28f
            setTextColor(Color.parseColor("#111827"))
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(24)
            }
        }

        val labelView = TextView(this).apply {
            text = "Dirección del servidor"
            textSize = 16f
            setTextColor(Color.parseColor("#374151"))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(8)
            }
        }

        val urlInput = EditText(this).apply {
            hint = "http://192.168.1.50:3000"
            setSingleLine(true)
            val existing = prefs.getString(KEY_SERVER_URL, "")
            setText(existing)
            minHeight = dpToPx(48)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(16)
            }
        }

        val connectButton = Button(this).apply {
            text = "Conectar"
            minHeight = dpToPx(48)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            setOnClickListener {
                val inputUrl = urlInput.text.toString().trim()
                if (isValidHttpUrl(inputUrl)) {
                    isEnabled = false
                    activityScope.launch {
                        val server = ServerDiscovery.checkHealth(inputUrl, timeoutMs = 2000)
                        isEnabled = true
                        if (server != null) {
                            saveServerInfo(server.url, server.serverId)
                            connectToServer(server.url)
                        } else {
                            Toast.makeText(
                                this@MainActivity,
                                "No se pudo conectar con el servidor en esa dirección",
                                Toast.LENGTH_LONG
                            ).show()
                        }
                    }
                } else {
                    Toast.makeText(
                        this@MainActivity,
                        "Por favor ingresa una URL válida (http:// o https://)",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }

        setupView.addView(titleView)
        setupView.addView(labelView)
        setupView.addView(urlInput)
        setupView.addView(connectButton)

        rootContainer.addView(setupView)
    }

    private fun showSearchingView(message: String) {
        searchingStatusText.text = message
        webView.visibility = View.GONE
        setupView.visibility = View.GONE
        errorView.visibility = View.GONE
        searchingView.visibility = View.VISIBLE
    }

    private fun showErrorView() {
        discoveryJob?.cancel()
        webView.visibility = View.GONE
        setupView.visibility = View.GONE
        searchingView.visibility = View.GONE
        errorView.visibility = View.VISIBLE
    }

    private fun showConfigView() {
        discoveryJob?.cancel()
        webView.visibility = View.GONE
        searchingView.visibility = View.GONE
        errorView.visibility = View.GONE
        setupView.visibility = View.VISIBLE
    }

    private fun connectToServer(url: String) {
        val parsed = Uri.parse(url)
        currentAllowedUri = parsed
        injectBridgeScript(url)
        searchingView.visibility = View.GONE
        errorView.visibility = View.GONE
        setupView.visibility = View.GONE
        webView.visibility = View.VISIBLE
        webView.loadUrl(url)
    }

    private fun injectBridgeScript(url: String) {
        isDocumentStartScriptActive = false
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            val origin = extractOrigin(url)
            if (origin != null) {
                try {
                    documentStartScriptHandler?.remove()
                    documentStartScriptHandler = WebViewCompat.addDocumentStartJavaScript(
                        webView,
                        bridgeScript,
                        setOf(origin)
                    )
                    isDocumentStartScriptActive = true
                } catch (_: Exception) {
                    isDocumentStartScriptActive = false
                }
            }
        }
    }

    private fun extractOrigin(url: String): String? {
        return try {
            val uri = Uri.parse(url)
            val scheme = uri.scheme?.lowercase() ?: return null
            val host = uri.host ?: return null
            val port = uri.port
            if (port != -1) {
                "$scheme://$host:$port"
            } else {
                "$scheme://$host"
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun saveServerInfo(url: String, serverId: String) {
        prefs.edit()
            .putString(KEY_SERVER_URL, url)
            .putString(KEY_SERVER_ID, serverId)
            .apply()
    }

    private fun isValidHttpUrl(url: String): Boolean {
        return try {
            val uri = Uri.parse(url)
            val scheme = uri.scheme?.lowercase()
            val host = uri.host
            (scheme == "http" || scheme == "https") && !host.isNullOrBlank()
        } catch (_: Exception) {
            false
        }
    }

    private fun dpToPx(dp: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            dp.toFloat(),
            resources.displayMetrics
        ).toInt()
    }
}
