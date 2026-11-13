package com.tocineta.terminal.bt

import com.tocineta.terminal.bridge.PrinterInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.nio.charset.Charset
import java.util.Base64
import java.util.Collections

class FakeBtTransport(
    var isConnectedState: Boolean = true,
    var failWriteCount: Int = 0,
    var failConnectCount: Int = 0,
    var writeDelayMs: Long = 0L
) : BtTransport {
    var connectCount = 0
    var closeCount = 0
    var cancelDiscoveryCount = 0
    var flushCount = 0
    val writtenChunks = mutableListOf<ByteArray>()
    val writtenByteEvents = Collections.synchronizedList(mutableListOf<Byte>())

    override fun isConnected(): Boolean = isConnectedState

    override fun cancelDiscovery() {
        cancelDiscoveryCount++
    }

    override suspend fun connect(mac: String) {
        connectCount++
        if (failConnectCount > 0) {
            failConnectCount--
            isConnectedState = false
            throw IOException("Error simulado al conectar")
        }
        isConnectedState = true
    }

    override suspend fun writeChunk(chunk: ByteArray) {
        if (!isConnectedState) {
            throw IOException("Socket no conectado")
        }
        if (failWriteCount > 0) {
            failWriteCount--
            isConnectedState = false
            throw IOException("Error simulado al escribir bloque")
        }
        if (writeDelayMs > 0) {
            delay(writeDelayMs)
        }
        writtenChunks.add(chunk)
        for (b in chunk) {
            writtenByteEvents.add(b)
        }
    }

    override suspend fun flush() {
        if (!isConnectedState) {
            throw IOException("Socket no conectado")
        }
        flushCount++
    }

    override suspend fun close() {
        closeCount++
        isConnectedState = false
    }
}

class FakeChecker(
    var permission: Boolean = true,
    var enabled: Boolean = true,
    var pairedMacs: Set<String> = setOf("00:11:22:33:44:55")
) : BluetoothChecker {
    override fun hasPermission(): Boolean = permission
    override fun isEnabled(): Boolean = enabled
    override fun isPaired(mac: String): Boolean = pairedMacs.any { it.equals(mac, ignoreCase = true) }
    override fun getPairedPrinters(): List<PrinterInfo> = pairedMacs.map {
        PrinterInfo(name = "MP583", mac = it)
    }
}

class PrinterSessionTest {

    @Test
    fun testChunkBytesExactPartitioningIncludingPartialLastBlock() {
        // 600 bytes => 256 + 256 + 88
        val data600 = ByteArray(600) { (it % 100).toByte() }
        val chunks600 = PrinterSession.chunkBytes(data600, 256)
        assertEquals(3, chunks600.size)
        assertEquals(256, chunks600[0].size)
        assertEquals(256, chunks600[1].size)
        assertEquals(88, chunks600[2].size)
        assertEquals(600, chunks600.sumOf { it.size })

        // Multiple exacto: 512 => 256 + 256
        val data512 = ByteArray(512) { 0x01.toByte() }
        val chunks512 = PrinterSession.chunkBytes(data512, 256)
        assertEquals(2, chunks512.size)
        assertEquals(256, chunks512[0].size)
        assertEquals(256, chunks512[1].size)

        // Bloque único menor a 256
        val data100 = ByteArray(100) { 0x02.toByte() }
        val chunks100 = PrinterSession.chunkBytes(data100, 256)
        assertEquals(1, chunks100.size)
        assertEquals(100, chunks100[0].size)

        // Vacío
        assertTrue(PrinterSession.chunkBytes(ByteArray(0), 256).isEmpty())

        // Verificación con envío real sobre FakeBtTransport
        runBlocking {
            val transport = FakeBtTransport()
            val session = PrinterSession(
                transport = transport,
                btChecker = FakeChecker()
            )
            val base64 = Base64.getEncoder().encodeToString(data600)
            val result = session.printEscPos("00:11:22:33:44:55", base64)

            assertTrue(result.success)
            assertEquals(600, result.bytesSent)
            assertEquals(3, transport.writtenChunks.size)
            assertEquals(256, transport.writtenChunks[0].size)
            assertEquals(256, transport.writtenChunks[1].size)
            assertEquals(88, transport.writtenChunks[2].size)
            assertEquals(1, transport.flushCount)
        }
    }

    @Test
    fun testMutexSerializesConcurrentCallsWithoutInterleavingBytes() = runBlocking {
        val transport = FakeBtTransport(writeDelayMs = 25L)
        val session = PrinterSession(
            transport = transport,
            btChecker = FakeChecker()
        )

        val bytesA = ByteArray(500) { 0x11.toByte() }
        val bytesB = ByteArray(500) { 0x22.toByte() }
        val b64A = Base64.getEncoder().encodeToString(bytesA)
        val b64B = Base64.getEncoder().encodeToString(bytesB)

        val deferredA = async(Dispatchers.Default) {
            session.printEscPos("00:11:22:33:44:55", b64A)
        }
        val deferredB = async(Dispatchers.Default) {
            session.printEscPos("00:11:22:33:44:55", b64B)
        }

        val resA = deferredA.await()
        val resB = deferredB.await()

        assertTrue(resA.success)
        assertTrue(resB.success)
        assertEquals(1000, transport.writtenByteEvents.size)

        // El primer lote de 500 bytes debe ser totalmente homogéneo (todo 0x11 o todo 0x22)
        val firstBatchByte = transport.writtenByteEvents[0]
        val first500 = transport.writtenByteEvents.subList(0, 500)
        val second500 = transport.writtenByteEvents.subList(500, 1000)

        assertTrue(
            "El primer trabajo de 500 bytes no debe mezclarse con el segundo",
            first500.all { it == firstBatchByte }
        )
        val secondBatchByte = second500[0]
        assertNotEquals(firstBatchByte, secondBatchByte)
        assertTrue(
            "El segundo trabajo de 500 bytes debe ser continuo sin fragmentos del primero",
            second500.all { it == secondBatchByte }
        )
    }

    @Test
    fun testReconnectAndSingleRetryWhenFirstAttemptThrowsIOException() = runBlocking {
        // Intento 1 falla en escritura -> debe cerrar socket, reconectar una vez (con cancelDiscovery) y reintentar todo
        val transport = FakeBtTransport(isConnectedState = true, failWriteCount = 1)
        val session = PrinterSession(
            transport = transport,
            btChecker = FakeChecker()
        )

        val data = ByteArray(300) { 0x33.toByte() }
        val b64 = Base64.getEncoder().encodeToString(data)
        val result = session.printEscPos("00:11:22:33:44:55", b64)

        assertTrue("La impresión debe tener éxito tras el reintento", result.success)
        assertEquals(300, result.bytesSent)
        assertTrue("Debe invocar close() tras el error del socket", transport.closeCount >= 1)
        assertTrue("Debe llamar cancelDiscovery() antes de reconectar", transport.cancelDiscoveryCount >= 1)
        assertTrue("Debe llamar connect() para reconectar", transport.connectCount >= 1)
        assertEquals("Debe ejecutar flush al completar", 1, transport.flushCount)

        // Si ambos intentos fallan, retorna mensaje claro en español
        val failingTransport = FakeBtTransport(isConnectedState = true, failWriteCount = 10)
        val failingSession = PrinterSession(
            transport = failingTransport,
            btChecker = FakeChecker()
        )
        val failResult = failingSession.printEscPos("00:11:22:33:44:55", b64)
        assertFalse(failResult.success)
        assertEquals("La impresora no responde. Revisa que esté encendida y cerca.", failResult.error)
    }

    @Test
    fun testWindows1252EncodingOfEnyeProducesSingleByte0xF1AndNotTwoBytesUtf8() {
        val wpc1252 = Charset.forName("windows-1252")
        val enyeBytes1252 = "ñ".toByteArray(wpc1252)

        // Verificación crítica: 1 byte con valor 0xF1 (-15 signed)
        assertEquals("En windows-1252 'ñ' debe ser exactamente 1 byte", 1, enyeBytes1252.size)
        assertEquals("En windows-1252 el byte de 'ñ' debe ser 0xF1", 0xF1.toByte(), enyeBytes1252[0])

        // Comparativa con UTF-8 (2 bytes: 0xC3, 0xB1)
        val enyeBytesUtf8 = "ñ".toByteArray(Charsets.UTF_8)
        assertEquals("En UTF-8 'ñ' ocupa 2 bytes", 2, enyeBytesUtf8.size)
        assertNotEquals(enyeBytes1252.size, enyeBytesUtf8.size)

        // Verificación de los demás acentos requeridos
        val accents = "Acentos: ñ á é í ó ú ¿ ¡ Ñ"
        val accentsBytes1252 = accents.toByteArray(wpc1252)
        assertEquals("Todos los acentos en windows-1252 deben ocupar 1 byte por caracter", accents.length, accentsBytes1252.size)

        // Verificación del payload generado por testPrint()
        val payload = PrinterSession.buildTestPrintPayload()

        // Cabecera ESC @ (0x1B, 0x40) y ESC t 16 (0x1B, 0x74, 0x10)
        val expectedHeader = byteArrayOf(
            0x1B.toByte(), 0x40.toByte(),
            0x1B.toByte(), 0x74.toByte(), 0x10.toByte()
        )
        val headerActual = payload.copyOfRange(0, 5)
        assertArrayEquals(expectedHeader, headerActual)

        // Terminación con 3 saltos de línea (\n\n\n)
        val last3 = payload.copyOfRange(payload.size - 3, payload.size)
        assertArrayEquals(byteArrayOf(0x0A.toByte(), 0x0A.toByte(), 0x0A.toByte()), last3)

        // Comprobación de que 'ñ' (0xF1) está presente en el payload como byte simple
        assertTrue("El payload debe contener el byte 0xF1 para la 'ñ'", payload.contains(0xF1.toByte()))

        // Y no contiene la secuencia multi-byte UTF-8 de 'ñ' (0xC3, 0xB1)
        var containsUtf8Enye = false
        for (i in 0 until payload.size - 1) {
            if (payload[i] == 0xC3.toByte() && payload[i + 1] == 0xB1.toByte()) {
                containsUtf8Enye = true
                break
            }
        }
        assertFalse("El payload NUNCA debe contener la secuencia UTF-8 de 'ñ'", containsUtf8Enye)
    }

    @Test
    fun testBluetoothValidationErrorsInSpanish() = runBlocking {
        // Sin permiso
        val sessionNoPerm = PrinterSession(
            transport = FakeBtTransport(),
            btChecker = FakeChecker(permission = false)
        )
        val resNoPerm = sessionNoPerm.printEscPos("00:11:22:33:44:55", "SGVsbG8=")
        assertFalse(resNoPerm.success)
        assertEquals("Sin permiso de Bluetooth.", resNoPerm.error)

        // Bluetooth apagado
        val sessionOff = PrinterSession(
            transport = FakeBtTransport(),
            btChecker = FakeChecker(enabled = false)
        )
        val resOff = sessionOff.printEscPos("00:11:22:33:44:55", "SGVsbG8=")
        assertFalse(resOff.success)
        assertEquals("Bluetooth apagado.", resOff.error)

        // Impresora no emparejada
        val sessionNotPaired = PrinterSession(
            transport = FakeBtTransport(),
            btChecker = FakeChecker(pairedMacs = emptySet())
        )
        val resNotPaired = sessionNotPaired.printEscPos("00:11:22:33:44:55", "SGVsbG8=")
        assertFalse(resNotPaired.success)
        assertEquals("Impresora no emparejada.", resNotPaired.error)
    }

    @Test
    fun testTestPrintSuccessWithSelectedPrinter() = runBlocking {
        val transport = FakeBtTransport()
        val session = PrinterSession(
            transport = transport,
            btChecker = FakeChecker()
        )
        session.selectPrinter("00:11:22:33:44:55")

        val result = session.testPrint()
        assertTrue(result.success)
        assertTrue(transport.writtenChunks.isNotEmpty())
        assertEquals(1, transport.flushCount)
    }
}
