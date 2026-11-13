package com.tocineta.terminal.bt

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.Context
import com.tocineta.terminal.bridge.BluetoothStatusResult
import com.tocineta.terminal.bridge.CapabilitiesResult
import com.tocineta.terminal.bridge.PrinterGateway
import com.tocineta.terminal.bridge.PrinterInfo
import com.tocineta.terminal.bridge.PrintResult
import com.tocineta.terminal.bridge.SelectPrinterResult
import com.tocineta.terminal.bridge.TestPrintResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.IOException
import java.io.OutputStream
import java.nio.charset.Charset
import java.util.UUID

interface BtTransport {
    fun isConnected(): Boolean
    suspend fun connect(mac: String)
    suspend fun writeChunk(chunk: ByteArray)
    suspend fun flush()
    suspend fun close()
    fun cancelDiscovery() {}
}

class AndroidBtTransport(
    private val context: Context? = null
) : BtTransport {
    private var socket: BluetoothSocket? = null
    private var outputStream: OutputStream? = null

    @Suppress("DEPRECATION")
    private fun getAdapter(): BluetoothAdapter? {
        return try {
            if (context != null) {
                (context.getSystemService(Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager)?.adapter
                    ?: BluetoothAdapter.getDefaultAdapter()
            } else {
                BluetoothAdapter.getDefaultAdapter()
            }
        } catch (_: Throwable) {
            null
        }
    }

    override fun isConnected(): Boolean {
        return socket?.isConnected == true
    }

    override fun cancelDiscovery() {
        try {
            getAdapter()?.cancelDiscovery()
        } catch (_: SecurityException) {
        } catch (_: Throwable) {
        }
    }

    @SuppressLint("MissingPermission")
    override suspend fun connect(mac: String) = withContext(Dispatchers.IO) {
        close()
        val adapter = getAdapter() ?: throw IOException("Bluetooth no disponible")
        cancelDiscovery()
        val device = adapter.getRemoteDevice(mac) ?: throw IOException("Dispositivo no encontrado")
        val s = device.createRfcommSocketToServiceRecord(PrinterSession.SPP_UUID)
        s.connect()
        socket = s
        outputStream = s.outputStream
    }

    @SuppressLint("MissingPermission")
    override suspend fun writeChunk(chunk: ByteArray) = withContext(Dispatchers.IO) {
        val out = outputStream ?: throw IOException("Socket no conectado")
        out.write(chunk)
    }

    @SuppressLint("MissingPermission")
    override suspend fun flush() = withContext(Dispatchers.IO) {
        val out = outputStream ?: throw IOException("Socket no conectado")
        out.flush()
    }

    override suspend fun close() = withContext(Dispatchers.IO) {
        try {
            outputStream?.close()
        } catch (_: Throwable) {
        }
        outputStream = null
        try {
            socket?.close()
        } catch (_: Throwable) {
        }
        socket = null
    }
}

interface BluetoothChecker {
    fun hasPermission(): Boolean
    fun isEnabled(): Boolean
    fun isPaired(mac: String): Boolean
    fun getPairedPrinters(): List<PrinterInfo>
}

class AndroidBluetoothChecker(
    private val context: Context? = null
) : BluetoothChecker {
    @Suppress("DEPRECATION")
    private val adapter: BluetoothAdapter?
        get() = try {
            if (context != null) {
                (context.getSystemService(Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager)?.adapter
                    ?: BluetoothAdapter.getDefaultAdapter()
            } else {
                BluetoothAdapter.getDefaultAdapter()
            }
        } catch (_: Throwable) {
            null
        }

    override fun hasPermission(): Boolean {
        return context?.let { PermissionHelper.hasBluetoothPermission(it) } ?: true
    }

    override fun isEnabled(): Boolean {
        return try {
            adapter?.isEnabled == true
        } catch (_: SecurityException) {
            false
        } catch (_: Throwable) {
            false
        }
    }

    @SuppressLint("MissingPermission")
    override fun isPaired(mac: String): Boolean {
        return try {
            adapter?.bondedDevices?.any { it.address.equals(mac, ignoreCase = true) } == true
        } catch (_: SecurityException) {
            false
        } catch (_: Throwable) {
            false
        }
    }

    @SuppressLint("MissingPermission")
    override fun getPairedPrinters(): List<PrinterInfo> {
        return try {
            adapter?.bondedDevices?.map { device ->
                PrinterInfo(
                    name = device.name ?: device.address,
                    mac = device.address
                )
            } ?: emptyList()
        } catch (_: SecurityException) {
            emptyList()
        } catch (_: Throwable) {
            emptyList()
        }
    }
}

class DefaultTestBluetoothChecker : BluetoothChecker {
    override fun hasPermission(): Boolean = true
    override fun isEnabled(): Boolean = true
    override fun isPaired(mac: String): Boolean = true
    override fun getPairedPrinters(): List<PrinterInfo> = listOf(
        PrinterInfo(name = "MP583", mac = "00:11:22:33:44:55")
    )
}

class PrinterSession(
    private val context: Context? = null,
    private val transport: BtTransport = AndroidBtTransport(context),
    private val store: PrinterStore? = context?.let { PrinterStore(it) },
    private val btChecker: BluetoothChecker = context?.let { AndroidBluetoothChecker(it) } ?: DefaultTestBluetoothChecker()
) : PrinterGateway {

    @Volatile
    var onPrinterSelectedListener: ((PrinterInfo) -> Unit)? = null

    private val printMutex = Mutex()
    private var inMemoryPrinter: PrinterInfo? = null

    companion object {
        val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        const val CHUNK_SIZE = 256
        const val CHUNK_DELAY_MS = 15L
        const val POST_FLUSH_DELAY_MS = 150L
        const val RECONNECT_DELAY_MS = 300L

        const val ERROR_NO_RESPONSE = "La impresora no responde. Revisa que esté encendida y cerca."
        const val ERROR_BT_OFF = "Bluetooth apagado."
        const val ERROR_NO_PERMISSION = "Sin permiso de Bluetooth."
        const val ERROR_NOT_PAIRED = "Impresora no emparejada."

        const val TEST_PRINT_TITLE = "TOCINETA - PRUEBA 58MM"
        const val TEST_PRINT_SEPARATOR = "--------------------------------"
        const val TEST_PRINT_ACCENTS = "Acentos: ñ á é í ó ú ¿ ¡ Ñ"
        val WPC1252_CHARSET: Charset = Charset.forName("windows-1252")

        fun buildTestPrintPayload(): ByteArray {
            val header = byteArrayOf(
                0x1B.toByte(), 0x40.toByte(),
                0x1B.toByte(), 0x74.toByte(), 0x10.toByte()
            )
            val text = "$TEST_PRINT_TITLE\n$TEST_PRINT_SEPARATOR\n$TEST_PRINT_ACCENTS\n\n\n"
            val body = text.toByteArray(WPC1252_CHARSET)
            return header + body
        }

        fun chunkBytes(data: ByteArray, chunkSize: Int = CHUNK_SIZE): List<ByteArray> {
            if (data.isEmpty()) return emptyList()
            val chunks = mutableListOf<ByteArray>()
            var offset = 0
            while (offset < data.size) {
                val len = minOf(chunkSize, data.size - offset)
                chunks.add(data.copyOfRange(offset, offset + len))
                offset += len
            }
            return chunks
        }

        fun decodeBase64(input: String): ByteArray {
            val clean = input.trim().replace("\n", "").replace("\r", "")
            return try {
                java.util.Base64.getDecoder().decode(clean)
            } catch (_: Throwable) {
                android.util.Base64.decode(clean, android.util.Base64.DEFAULT)
            }
        }
    }

    fun destroy() {
        store?.unregister()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                transport.close()
            } catch (_: Throwable) {
            }
        }
    }

    override suspend fun getCapabilities(): CapabilitiesResult {
        return CapabilitiesResult(bluetoothSpp = true)
    }

    override suspend fun getSelectedPrinter(): PrinterInfo? {
        return store?.getSelectedPrinter() ?: inMemoryPrinter
    }

    override suspend fun selectPrinter(mac: String): SelectPrinterResult {
        if (mac.isBlank()) {
            return SelectPrinterResult(ok = false, error = "MAC de impresora inválida")
        }
        val paired = btChecker.getPairedPrinters()
        val found = paired.firstOrNull { it.mac.equals(mac, ignoreCase = true) }
        val name = found?.name ?: mac
        val info = PrinterInfo(name = name, mac = mac)
        inMemoryPrinter = info
        store?.saveSelectedPrinter(name, mac)
        onPrinterSelectedListener?.invoke(info)
        return SelectPrinterResult(ok = true)
    }

    override suspend fun listPairedPrinters(): List<PrinterInfo> {
        if (!btChecker.hasPermission() || !btChecker.isEnabled()) {
            return emptyList()
        }
        return btChecker.getPairedPrinters()
    }

    override suspend fun getBluetoothStatus(): BluetoothStatusResult {
        val permission = btChecker.hasPermission()
        val enabled = btChecker.isEnabled()
        val connected = transport.isConnected() || (store?.isConnected == true)
        return BluetoothStatusResult(
            permission = permission,
            enabled = enabled,
            connected = connected
        )
    }

    override suspend fun printEscPos(mac: String, base64: String): PrintResult = printMutex.withLock {
        val targetMac = when {
            mac.isNotBlank() -> mac.trim()
            else -> store?.getSelectedPrinter()?.mac ?: inMemoryPrinter?.mac ?: ""
        }
        if (targetMac.isBlank()) {
            return@withLock PrintResult(success = false, error = ERROR_NOT_PAIRED)
        }

        if (!btChecker.hasPermission()) {
            return@withLock PrintResult(success = false, error = ERROR_NO_PERMISSION)
        }

        if (!btChecker.isEnabled()) {
            return@withLock PrintResult(success = false, error = ERROR_BT_OFF)
        }

        if (!btChecker.isPaired(targetMac)) {
            return@withLock PrintResult(success = false, error = ERROR_NOT_PAIRED)
        }

        val bytes = try {
            decodeBase64(base64)
        } catch (_: Throwable) {
            return@withLock PrintResult(success = false, error = "Base64 inválido")
        }

        if (bytes.isEmpty()) {
            return@withLock PrintResult(success = true, bytesSent = 0)
        }

        printBytesInternal(targetMac, bytes)
    }

    override suspend fun testPrint(): TestPrintResult = printMutex.withLock {
        val targetMac = store?.getSelectedPrinter()?.mac ?: inMemoryPrinter?.mac ?: ""
        if (targetMac.isBlank()) {
            return@withLock TestPrintResult(success = false, error = ERROR_NOT_PAIRED)
        }

        if (!btChecker.hasPermission()) {
            return@withLock TestPrintResult(success = false, error = ERROR_NO_PERMISSION)
        }

        if (!btChecker.isEnabled()) {
            return@withLock TestPrintResult(success = false, error = ERROR_BT_OFF)
        }

        if (!btChecker.isPaired(targetMac)) {
            return@withLock TestPrintResult(success = false, error = ERROR_NOT_PAIRED)
        }

        val payload = buildTestPrintPayload()
        val result = printBytesInternal(targetMac, payload)
        TestPrintResult(success = result.success, error = result.error)
    }

    private suspend fun printBytesInternal(targetMac: String, bytes: ByteArray): PrintResult {
        val chunks = chunkBytes(bytes, CHUNK_SIZE)
        return try {
            if (!transport.isConnected()) {
                transport.cancelDiscovery()
                transport.connect(targetMac)
            }
            sendChunks(chunks)
            store?.isConnected = true
            PrintResult(success = true, bytesSent = bytes.size)
        } catch (e1: IOException) {
            // Reconnection and single retry
            try {
                store?.isConnected = false
                transport.close()
                delay(RECONNECT_DELAY_MS)
                transport.cancelDiscovery()
                transport.connect(targetMac)
                sendChunks(chunks)
                store?.isConnected = true
                PrintResult(success = true, bytesSent = bytes.size)
            } catch (e2: IOException) {
                store?.isConnected = false
                try {
                    transport.close()
                } catch (_: Throwable) {
                }
                PrintResult(success = false, error = ERROR_NO_RESPONSE)
            }
        }
    }

    private suspend fun sendChunks(chunks: List<ByteArray>) {
        for (i in chunks.indices) {
            if (i > 0) {
                delay(CHUNK_DELAY_MS)
            }
            transport.writeChunk(chunks[i])
        }
        transport.flush()
        delay(POST_FLUSH_DELAY_MS)
    }
}
