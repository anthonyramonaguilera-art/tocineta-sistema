package com.tocineta.terminal.bt

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.os.Build
import com.tocineta.terminal.bridge.PrinterInfo

class PrinterStore(private val context: Context) {

    companion object {
        const val PREFS_NAME = "tocineta_printer_prefs"
        const val KEY_PRINTER_NAME = "printer_name"
        const val KEY_PRINTER_MAC = "printer_mac"
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @Volatile
    var isConnected: Boolean = false
        internal set

    private var isRegistered = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, intent: Intent?) {
            intent ?: return
            when (intent.action) {
                BluetoothAdapter.ACTION_STATE_CHANGED -> {
                    val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                    if (state == BluetoothAdapter.STATE_OFF || state == BluetoothAdapter.STATE_TURNING_OFF) {
                        isConnected = false
                    }
                }
                BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                    val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    }
                    val selectedMac = getSelectedPrinter()?.mac
                    if (selectedMac != null && device?.address?.equals(selectedMac, ignoreCase = true) == true) {
                        isConnected = false
                    }
                }
                BluetoothDevice.ACTION_ACL_CONNECTED -> {
                    val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    }
                    val selectedMac = getSelectedPrinter()?.mac
                    if (selectedMac != null && device?.address?.equals(selectedMac, ignoreCase = true) == true) {
                        isConnected = true
                    }
                }
            }
        }
    }

    init {
        register()
    }

    fun register() {
        if (!isRegistered) {
            try {
                val filter = IntentFilter().apply {
                    addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
                    addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
                    addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
                } else {
                    context.registerReceiver(receiver, filter)
                }
                isRegistered = true
            } catch (_: Throwable) {
            }
        }
    }

    fun unregister() {
        if (isRegistered) {
            try {
                context.unregisterReceiver(receiver)
            } catch (_: Throwable) {
            }
            isRegistered = false
        }
    }

    fun getSelectedPrinter(): PrinterInfo? {
        val mac = prefs.getString(KEY_PRINTER_MAC, null) ?: return null
        if (mac.isBlank()) return null
        val name = prefs.getString(KEY_PRINTER_NAME, null) ?: mac
        return PrinterInfo(name = name, mac = mac)
    }

    fun saveSelectedPrinter(name: String, mac: String) {
        prefs.edit()
            .putString(KEY_PRINTER_NAME, name)
            .putString(KEY_PRINTER_MAC, mac)
            .apply()
    }

    fun clearSelectedPrinter() {
        prefs.edit()
            .remove(KEY_PRINTER_NAME)
            .remove(KEY_PRINTER_MAC)
            .apply()
    }
}
