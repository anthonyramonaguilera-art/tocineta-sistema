package com.tocineta.terminal.service

import com.tocineta.terminal.bt.FakeBtTransport
import com.tocineta.terminal.bt.FakeChecker
import com.tocineta.terminal.bt.PrinterSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class FakeServiceLauncher : ServiceLauncher {
    var startCount = 0
    var stopCount = 0

    override fun startService() {
        startCount++
    }

    override fun stopService() {
        stopCount++
    }
}

class PrintKeepAliveControllerTest {

    @Test
    fun testStartIsIdempotent() {
        val launcher = FakeServiceLauncher()
        val session = PrinterSession(
            transport = FakeBtTransport(),
            btChecker = FakeChecker()
        )
        val controller = PrintKeepAliveController(launcher, session)

        assertFalse("Inicialmente el controlador no debe estar en ejecución", controller.isRunning)
        assertEquals(0, launcher.startCount)

        // Primer inicio: debe iniciar el servicio
        val firstStart = controller.start()
        assertTrue("El primer inicio debe retornar true", firstStart)
        assertTrue("El controlador debe estar en ejecución", controller.isRunning)
        assertEquals(1, launcher.startCount)

        // Segundo inicio: idempotente, no duplica llamada al servicio
        val secondStart = controller.start()
        assertFalse("El segundo inicio debe retornar false al estar ya iniciado", secondStart)
        assertTrue("El controlador continúa en ejecución", controller.isRunning)
        assertEquals(1, launcher.startCount)

        // Tercer inicio: igualmente idempotente
        val thirdStart = controller.start()
        assertFalse("El tercer inicio consecutivo debe retornar false", thirdStart)
        assertEquals(1, launcher.startCount)
    }

    @Test
    fun testStopIsIdempotent() {
        val launcher = FakeServiceLauncher()
        val session = PrinterSession(
            transport = FakeBtTransport(),
            btChecker = FakeChecker()
        )
        val controller = PrintKeepAliveController(launcher, session)

        // Detener sin haber iniciado: idempotente
        val stopBeforeStart = controller.stop()
        assertFalse("Detener sin haber iniciado debe retornar false", stopBeforeStart)
        assertEquals(0, launcher.stopCount)
        assertFalse(controller.isRunning)

        // Iniciar
        controller.start()
        assertTrue(controller.isRunning)

        // Primera detención: debe detener el servicio
        val firstStop = controller.stop()
        assertTrue("La primera detención debe retornar true", firstStop)
        assertFalse("El controlador ya no debe estar en ejecución", controller.isRunning)
        assertEquals(1, launcher.stopCount)

        // Segunda detención: idempotente, no duplica llamada
        val secondStop = controller.stop()
        assertFalse("La segunda detención debe retornar false al ya estar detenido", secondStop)
        assertFalse(controller.isRunning)
        assertEquals(1, launcher.stopCount)
    }

    @Test
    fun testReusesSamePrinterSessionInstanceAcrossLifecycle() {
        val launcher = FakeServiceLauncher()
        var sessionCreationCount = 0

        val controller = PrintKeepAliveController(
            launcher = launcher,
            sessionProvider = {
                sessionCreationCount++
                PrinterSession(
                    transport = FakeBtTransport(),
                    btChecker = FakeChecker()
                )
            }
        )

        // Obtener sesión antes de iniciar
        val session1 = controller.printerSession
        val session2 = controller.printerSession

        assertSame("Múltiples lecturas de printerSession deben retornar exactamente la misma instancia", session1, session2)
        assertEquals("La sesión solo debe haberse creado una vez", 1, sessionCreationCount)

        // Iniciar servicio
        controller.start()
        val sessionAfterStart = controller.printerSession
        assertSame("La sesión tras iniciar el servicio debe ser la misma instancia", session1, sessionAfterStart)
        assertEquals(1, sessionCreationCount)

        // Detener servicio
        controller.stop()
        val sessionAfterStop = controller.printerSession
        assertSame("La sesión tras detener el servicio debe ser la misma instancia", session1, sessionAfterStop)
        assertEquals(1, sessionCreationCount)

        // Reanudar servicio
        controller.start()
        val sessionAfterResume = controller.printerSession
        assertSame("La sesión tras reanudar el servicio debe ser la misma instancia", session1, sessionAfterResume)
        assertEquals(1, sessionCreationCount)
    }

    @Test
    fun testDirectSessionConstructorReusesInstance() {
        val launcher = FakeServiceLauncher()
        val session = PrinterSession(
            transport = FakeBtTransport(),
            btChecker = FakeChecker()
        )
        val controller = PrintKeepAliveController(launcher, session)

        assertSame("Debe retornar la instancia provista directamente en el constructor", session, controller.printerSession)

        controller.start()
        assertSame(session, controller.printerSession)

        controller.stop()
        assertSame(session, controller.printerSession)
    }
}
