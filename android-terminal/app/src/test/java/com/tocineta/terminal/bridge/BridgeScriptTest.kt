package com.tocineta.terminal.bridge

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeScriptTest {

    @Test
    fun testGenerateTerminalIdHas32AlphanumericChars() {
        val id = BridgeScript.generateTerminalId()
        assertEquals("El ID generado debe tener exactamente 32 caracteres", 32, id.length)
        assertTrue(
            "El ID generado debe contener exclusivamente caracteres alfanuméricos",
            id.matches(Regex("^[a-zA-Z0-9]{32}$"))
        )
    }

    @Test
    fun testGenerateTerminalIdUniqueness() {
        val id1 = BridgeScript.generateTerminalId()
        val id2 = BridgeScript.generateTerminalId()
        assertNotEquals("IDs generados consecutivamente deben ser únicos", id1, id2)
    }

    @Test
    fun testBuildScriptContainsTerminalIdAndGlobals() {
        val terminalId = "c7b2a6e9f1a24d8b9e1c2d3e4f5a6b7c"
        val script = BridgeScript.buildScript(terminalId)

        assertTrue(
            "El script debe definir window.__TOCINETA_TERMINAL_ID__",
            script.contains("window.__TOCINETA_TERMINAL_ID__")
        )
        assertTrue(
            "El script debe contener el valor exacto del identificador de terminal",
            script.contains(terminalId)
        )
        assertTrue(
            "El script debe exponer el objeto window.TocinetaNative",
            script.contains("window.TocinetaNative")
        )
        assertTrue(
            "El script debe exponer la función de resolución window.__tocinetaResolve",
            script.contains("window.__tocinetaResolve")
        )
        assertTrue(
            "El script debe configurar un timeout de 15 segundos (15000 ms)",
            script.contains("15000")
        )
    }

    @Test
    fun testBuildScriptContainsAllSevenContractMethods() {
        val terminalId = "0123456789abcdef0123456789abcdef"
        val script = BridgeScript.buildScript(terminalId)

        val requiredContractMethods = listOf(
            "getCapabilities",
            "getSelectedPrinter",
            "printEscPos",
            "listPairedPrinters",
            "selectPrinter",
            "testPrint",
            "getBluetoothStatus"
        )

        for (method in requiredContractMethods) {
            assertTrue(
                "El script generado debe incluir el método del contrato: $method",
                script.contains(method)
            )
        }
    }

    @Test
    fun testNoopPrinterGatewayContract() = runBlocking {
        val gateway = NoopPrinterGateway()

        val caps = gateway.getCapabilities()
        assertFalse("bluetoothSpp debe ser false en NoopPrinterGateway", caps.bluetoothSpp)

        val printer = gateway.getSelectedPrinter()
        assertNull("getSelectedPrinter debe ser null en NoopPrinterGateway", printer)

        val printRes = gateway.printEscPos("00:11:22:33:44:55", "SGVsbG8=")
        assertFalse("success debe ser false en NoopPrinterGateway", printRes.success)
        assertEquals("Impresora no configurada", printRes.error)

        val paired = gateway.listPairedPrinters()
        assertTrue("listPairedPrinters debe ser lista vacía", paired.isEmpty())

        val selectRes = gateway.selectPrinter("00:11:22:33:44:55")
        assertFalse("selectPrinter ok debe ser false", selectRes.ok)
        assertEquals("Impresora no configurada", selectRes.error)

        val testPrintRes = gateway.testPrint()
        assertFalse("testPrint success debe ser false", testPrintRes.success)
        assertEquals("Impresora no configurada", testPrintRes.error)

        val btStatus = gateway.getBluetoothStatus()
        assertFalse("permission debe ser false", btStatus.permission)
        assertFalse("enabled debe ser false", btStatus.enabled)
        assertFalse("connected debe ser false", btStatus.connected)
    }

    @Test
    fun testBuildScriptContainsSaveAndOpenFile() {
        val terminalId = "0123456789abcdef0123456789abcdef"
        val script = BridgeScript.buildScript(terminalId)

        assertTrue(
            "El script generado debe incluir saveAndOpenFile",
            script.contains("saveAndOpenFile")
        )
        assertTrue(
            "El script generado debe configurar timeout extendido de 60000 ms para saveAndOpenFile",
            script.contains("60000")
        )
    }

    @Test
    fun testSanitizeFileName() {
        assertEquals("cierre.pdf", NativeBridge.sanitizeFileName("cierre.pdf"))
        assertEquals("cierre.pdf", NativeBridge.sanitizeFileName("reportes/cierre.pdf"))
        assertEquals("cierre.pdf", NativeBridge.sanitizeFileName("C:\\reportes\\cierre.pdf"))
        assertEquals("cierre.pdf", NativeBridge.sanitizeFileName("../cierre.pdf"))
        assertEquals("cierre.pdf", NativeBridge.sanitizeFileName("..\\..\\cierre.pdf"))
        assertEquals("cierrepdf", NativeBridge.sanitizeFileName("cierre..pdf"))
        assertEquals("archivo_descargado", NativeBridge.sanitizeFileName(""))
        assertEquals("archivo_descargado", NativeBridge.sanitizeFileName("   "))
        assertEquals("archivo_descargado", NativeBridge.sanitizeFileName(".."))
        assertEquals("archivo_descargado", NativeBridge.sanitizeFileName("../"))
        assertEquals("archivo_descargado", NativeBridge.sanitizeFileName("\\"))
    }
}
