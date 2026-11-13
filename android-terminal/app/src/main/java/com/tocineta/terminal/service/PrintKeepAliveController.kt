package com.tocineta.terminal.service

import android.content.Context
import android.content.Intent
import android.os.Build
import com.tocineta.terminal.bt.PrinterSession

interface ServiceLauncher {
    fun startService()
    fun stopService()
}

class AndroidServiceLauncher(private val context: Context) : ServiceLauncher {
    override fun startService() {
        val intent = Intent(context, PrintKeepAliveService::class.java).apply {
            action = PrintKeepAliveService.ACTION_START
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    override fun stopService() {
        val intent = Intent(context, PrintKeepAliveService::class.java).apply {
            action = PrintKeepAliveService.ACTION_STOP
        }
        context.stopService(intent)
    }
}

class PrintKeepAliveController(
    private val launcher: ServiceLauncher,
    session: PrinterSession? = null,
    private val sessionProvider: (() -> PrinterSession)? = null
) {
    constructor(launcher: ServiceLauncher, session: PrinterSession) : this(
        launcher = launcher,
        session = session,
        sessionProvider = null
    )

    constructor(launcher: ServiceLauncher, sessionProvider: () -> PrinterSession) : this(
        launcher = launcher,
        session = null,
        sessionProvider = sessionProvider
    )

    @Volatile
    private var isStarted = false

    @Volatile
    private var cachedSession: PrinterSession? = session

    val printerSession: PrinterSession
        get() {
            val existing = cachedSession
            if (existing != null) return existing
            return synchronized(this) {
                cachedSession ?: run {
                    val created = sessionProvider?.invoke()
                        ?: throw IllegalStateException("No PrinterSession o sessionProvider disponible")
                    cachedSession = created
                    created
                }
            }
        }

    fun start(): Boolean = synchronized(this) {
        if (isStarted) {
            return false
        }
        isStarted = true
        launcher.startService()
        return true
    }

    fun stop(): Boolean = synchronized(this) {
        if (!isStarted) {
            return false
        }
        isStarted = false
        launcher.stopService()
        return true
    }

    val isRunning: Boolean
        get() = isStarted

    fun destroySession() {
        synchronized(this) {
            cachedSession?.destroy()
            cachedSession = null
        }
    }

    companion object {
        @Volatile
        private var instance: PrintKeepAliveController? = null

        @Volatile
        private var singletonSession: PrinterSession? = null

        fun getOrCreatePrinterSession(context: Context): PrinterSession {
            val existing = singletonSession
            if (existing != null) return existing
            return synchronized(this) {
                singletonSession ?: PrinterSession(context.applicationContext).also {
                    singletonSession = it
                }
            }
        }

        fun getInstance(context: Context): PrintKeepAliveController {
            val existing = instance
            if (existing != null) return existing
            return synchronized(this) {
                instance ?: PrintKeepAliveController(
                    launcher = AndroidServiceLauncher(context.applicationContext),
                    sessionProvider = { getOrCreatePrinterSession(context.applicationContext) }
                ).also { instance = it }
            }
        }

        fun setInstanceForTesting(controller: PrintKeepAliveController?) {
            instance = controller
        }

        fun resetForTesting() {
            instance = null
            singletonSession = null
        }
    }
}
