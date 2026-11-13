package com.tocineta.terminal

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var prefs: SharedPreferences
    private lateinit var rootContainer: FrameLayout
    private lateinit var webView: WebView
    private lateinit var setupView: LinearLayout
    private var currentAllowedUri: Uri? = null

    companion object {
        private const val PREFS_NAME = "tocineta_terminal_prefs"
        private const val KEY_SERVER_URL = "server_url"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Mantener pantalla encendida
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        rootContainer = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        setContentView(rootContainer)

        setupWebView()
        setupNativeConfigView()

        val savedUrl = prefs.getString(KEY_SERVER_URL, null)
        if (!savedUrl.isNullOrBlank() && isValidHttpUrl(savedUrl)) {
            connectToServer(savedUrl)
        } else {
            showConfigView()
        }

        // Manejo del botón físico Atrás: si webView puede ir atrás, navega; si no, NO cierra la app.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.visibility == View.VISIBLE && webView.canGoBack()) {
                    webView.goBack()
                }
                // Si no puede ir atrás, no hacemos nada para evitar cerrar la app del terminal.
            }
        })
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

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val targetUri = request?.url ?: return true
                val allowed = currentAllowedUri

                if (allowed != null &&
                    targetUri.scheme.equals(allowed.scheme, ignoreCase = true) &&
                    targetUri.host.equals(allowed.host, ignoreCase = true) &&
                    targetUri.port == allowed.port
                ) {
                    return false // Permitir navegación dentro del mismo host y port
                }

                // Bloquear cualquier origen externo
                return true
            }
        }

        rootContainer.addView(webView)
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
                    prefs.edit().putString(KEY_SERVER_URL, inputUrl).apply()
                    connectToServer(inputUrl)
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

    private fun showConfigView() {
        webView.visibility = View.GONE
        setupView.visibility = View.VISIBLE
    }

    private fun connectToServer(url: String) {
        val parsed = Uri.parse(url)
        currentAllowedUri = parsed
        setupView.visibility = View.GONE
        webView.visibility = View.VISIBLE
        webView.loadUrl(url)
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
