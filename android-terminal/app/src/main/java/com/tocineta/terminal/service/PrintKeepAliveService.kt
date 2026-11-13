package com.tocineta.terminal.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.tocineta.terminal.MainActivity
import com.tocineta.terminal.R
import com.tocineta.terminal.bt.PrinterSession

class PrintKeepAliveService : Service() {

    companion object {
        const val ACTION_START = "com.tocineta.terminal.service.START"
        const val ACTION_STOP = "com.tocineta.terminal.service.STOP"
        const val CHANNEL_ID = "tocineta_print_keepalive"
        const val NOTIFICATION_ID = 1001
    }

    private var printerSession: PrinterSession? = null

    override fun onCreate() {
        super.onCreate()
        printerSession = PrintKeepAliveController.getInstance(this).printerSession
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForegroundService()
            stopSelf()
            return START_NOT_STICKY
        }

        createNotificationChannel()
        val notification = buildNotification()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopForegroundService()
        printerSession = null
        super.onDestroy()
    }

    private fun stopForegroundService() {
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        } catch (_: Throwable) {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "TOCINETA activo",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Servicio de impresión Bluetooth en ejecución"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification() = NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("TOCINETA activo")
        .setContentText("Servicio de impresión Bluetooth en ejecución")
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentIntent(createPendingIntent())
        .setOngoing(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .build()

    private fun createPendingIntent(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        return PendingIntent.getActivity(this, 0, intent, flags)
    }
}
