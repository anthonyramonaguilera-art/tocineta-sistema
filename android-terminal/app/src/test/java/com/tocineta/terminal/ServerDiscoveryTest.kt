package com.tocineta.terminal

import com.tocineta.terminal.net.ServerDiscovery
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerDiscoveryTest {

    @Test
    fun testCalculateSubnetIpsFromLocalIp() {
        val ips = ServerDiscovery.calculateSubnetIps("192.168.1.45")
        assertEquals(254, ips.size)
        assertEquals("192.168.1.1", ips.first())
        assertEquals("192.168.1.254", ips.last())
        assertTrue(ips.contains("192.168.1.50"))
        assertTrue(ips.contains("192.168.1.100"))
        assertTrue(ips.contains("192.168.1.200"))
    }

    @Test
    fun testCalculateSubnetIpsFromPrefix() {
        val ips = ServerDiscovery.calculateSubnetIps("10.0.0")
        assertEquals(254, ips.size)
        assertEquals("10.0.0.1", ips.first())
        assertEquals("10.0.0.254", ips.last())
        assertTrue(ips.contains("10.0.0.12"))
    }

    @Test
    fun testCalculateSubnetIpsInvalidInputs() {
        assertTrue(ServerDiscovery.calculateSubnetIps("").isEmpty())
        assertTrue(ServerDiscovery.calculateSubnetIps("invalid-ip").isEmpty())
        assertTrue(ServerDiscovery.calculateSubnetIps("192.168").isEmpty())
        assertTrue(ServerDiscovery.calculateSubnetIps("192.168.1.2.3").isEmpty())
        assertTrue(ServerDiscovery.calculateSubnetIps("999.999.999.999").isEmpty())
    }

    @Test
    fun testParseHealthJsonValid() {
        val json = """
            {
              "status": "ok",
              "version": "0.1.0",
              "db": "wal_full",
              "serverId": "server-alpha-123"
            }
        """.trimIndent()

        val parsed = ServerDiscovery.parseHealthJson(json)
        assertNotNull(parsed)
        assertEquals("ok", parsed?.status)
        assertEquals("server-alpha-123", parsed?.serverId)
    }

    @Test
    fun testValidateHealthJsonMatchingServerId() {
        val json = """{"status":"ok","serverId":"srv-456"}"""

        val validated = ServerDiscovery.validateHealthJson(json, expectedServerId = "srv-456")
        assertNotNull(validated)
        assertEquals("srv-456", validated?.serverId)
    }

    @Test
    fun testValidateHealthJsonMismatchedServerId() {
        val json = """{"status":"ok","serverId":"srv-456"}"""

        val validated = ServerDiscovery.validateHealthJson(json, expectedServerId = "srv-789")
        assertNull(validated)
    }

    @Test
    fun testValidateHealthJsonNoExpectedServerId() {
        val json = """{"status":"ok","serverId":"srv-new"}"""

        val validated = ServerDiscovery.validateHealthJson(json, expectedServerId = null)
        assertNotNull(validated)
        assertEquals("srv-new", validated?.serverId)
    }

    @Test
    fun testValidateHealthJsonStatusNotOk() {
        val json = """{"status":"error","serverId":"srv-456"}"""

        val validated = ServerDiscovery.validateHealthJson(json, expectedServerId = "srv-456")
        assertNull(validated)
    }

    @Test
    fun testValidateHealthJsonBlankServerId() {
        val json = """{"status":"ok","serverId":""}"""

        val validated = ServerDiscovery.validateHealthJson(json, expectedServerId = null)
        assertNull(validated)
    }

    @Test
    fun testValidateHealthJsonMalformed() {
        val json = "Not a json response"
        assertNull(ServerDiscovery.validateHealthJson(json, expectedServerId = null))
    }
}
