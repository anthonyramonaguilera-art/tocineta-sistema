package com.tocineta.terminal.bt

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.appcompat.app.AlertDialog
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

object PermissionHelper {

    const val REQUEST_BLUETOOTH_CONNECT = 2001
    const val RATIONALE_MESSAGE = "Para imprimir en la impresora Bluetooth, permite el acceso a dispositivos cercanos."
    const val SETTINGS_BUTTON_TEXT = "Abrir ajustes"

    fun hasBluetoothPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return true
        }
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.BLUETOOTH_CONNECT
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun requestBluetoothPermission(activity: Activity, requestCode: Int = REQUEST_BLUETOOTH_CONNECT) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.BLUETOOTH_CONNECT),
                requestCode
            )
        }
    }

    fun requestBluetoothPermissionIfNeeded(activity: Activity, requestCode: Int = REQUEST_BLUETOOTH_CONNECT): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!hasBluetoothPermission(activity)) {
                requestBluetoothPermission(activity, requestCode)
                return true
            }
        }
        return false
    }

    fun showPermissionDeniedNotice(activity: Activity) {
        AlertDialog.Builder(activity)
            .setMessage(RATIONALE_MESSAGE)
            .setPositiveButton(SETTINGS_BUTTON_TEXT) { _, _ ->
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", activity.packageName, null)
                }
                activity.startActivity(intent)
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    fun handlePermissionResult(
        activity: Activity,
        requestCode: Int,
        grantResults: IntArray
    ): Boolean {
        if (requestCode == REQUEST_BLUETOOTH_CONNECT) {
            val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                showPermissionDeniedNotice(activity)
            }
            return granted
        }
        return false
    }
}
