package com.tocineta.terminal.bridge

data class CapabilitiesResult(
    val bluetoothSpp: Boolean
)

data class PrinterInfo(
    val name: String,
    val mac: String
)

data class PrintResult(
    val success: Boolean,
    val bytesSent: Int? = null,
    val error: String? = null
)

data class SelectPrinterResult(
    val ok: Boolean,
    val error: String? = null
)

data class TestPrintResult(
    val success: Boolean,
    val error: String? = null
)

data class BluetoothStatusResult(
    val permission: Boolean,
    val enabled: Boolean,
    val connected: Boolean
)

interface PrinterGateway {
    suspend fun getCapabilities(): CapabilitiesResult
    suspend fun getSelectedPrinter(): PrinterInfo?
    suspend fun printEscPos(mac: String, base64: String): PrintResult
    suspend fun listPairedPrinters(): List<PrinterInfo>
    suspend fun selectPrinter(mac: String): SelectPrinterResult
    suspend fun testPrint(): TestPrintResult
    suspend fun getBluetoothStatus(): BluetoothStatusResult
}

class NoopPrinterGateway : PrinterGateway {
    override suspend fun getCapabilities(): CapabilitiesResult =
        CapabilitiesResult(bluetoothSpp = false)

    override suspend fun getSelectedPrinter(): PrinterInfo? = null

    override suspend fun printEscPos(mac: String, base64: String): PrintResult =
        PrintResult(success = false, error = "Impresora no configurada")

    override suspend fun listPairedPrinters(): List<PrinterInfo> = emptyList()

    override suspend fun selectPrinter(mac: String): SelectPrinterResult =
        SelectPrinterResult(ok = false, error = "Impresora no configurada")

    override suspend fun testPrint(): TestPrintResult =
        TestPrintResult(success = false, error = "Impresora no configurada")

    override suspend fun getBluetoothStatus(): BluetoothStatusResult =
        BluetoothStatusResult(permission = false, enabled = false, connected = false)
}
