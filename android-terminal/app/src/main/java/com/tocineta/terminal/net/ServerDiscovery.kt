package com.tocineta.terminal.net

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicInteger

data class ServerHealth(
    val status: String,
    val serverId: String
)

data class DiscoveredServer(
    val url: String,
    val serverId: String
)

object ServerDiscovery {

    /**
     * Calcula las 254 IPs /24 (.1 a .254) a partir de una IP local o prefijo de red.
     */
    fun calculateSubnetIps(ipOrPrefix: String): List<String> {
        val parts = ipOrPrefix.trim().split(".")
        val prefix = when {
            parts.size == 4 && parts.all { it.toIntOrNull() in 0..255 } -> {
                "${parts[0]}.${parts[1]}.${parts[2]}"
            }
            parts.size == 3 && parts.all { it.toIntOrNull() in 0..255 } -> {
                "${parts[0]}.${parts[1]}.${parts[2]}"
            }
            else -> return emptyList()
        }
        return (1..254).map { host -> "$prefix.$host" }
    }

    /**
     * Parsea el JSON devuelto por /api/health buscando "status" y "serverId".
     */
    fun parseHealthJson(json: String): ServerHealth? {
        val statusRegex = """"status"\s*:\s*"([^"]+)"""".toRegex()
        val serverIdRegex = """"serverId"\s*:\s*"([^"]+)"""".toRegex()

        val status = statusRegex.find(json)?.groupValues?.get(1)?.trim()
        val serverId = serverIdRegex.find(json)?.groupValues?.get(1)?.trim()

        if (!status.isNullOrEmpty() && !serverId.isNullOrEmpty()) {
            return ServerHealth(status = status, serverId = serverId)
        }
        return null
    }

    /**
     * Valida el JSON de /api/health asegurando status == "ok", serverId no vacío
     * y, si expectedServerId no es nulo ni vacío, que coincida exactamente.
     */
    fun validateHealthJson(json: String, expectedServerId: String? = null): ServerHealth? {
        val health = parseHealthJson(json) ?: return null
        if (health.status != "ok") return null
        if (health.serverId.isBlank()) return null
        if (!expectedServerId.isNullOrBlank() && health.serverId != expectedServerId.trim()) {
            return null
        }
        return health
    }

    fun normalizeBaseUrl(url: String): String {
        return url.trim().trimEnd('/')
    }

    /**
     * Ejecuta GET {url}/api/health usando HttpURLConnection con timeout especificado.
     */
    suspend fun checkHealth(
        url: String,
        expectedServerId: String? = null,
        timeoutMs: Int = 1500
    ): DiscoveredServer? = withContext(Dispatchers.IO) {
        val normalized = normalizeBaseUrl(url)
        val endpoint = "$normalized/api/health"
        var connection: HttpURLConnection? = null
        try {
            val urlObj = URL(endpoint)
            connection = (urlObj.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                instanceFollowRedirects = false
                useCaches = false
                setRequestProperty("Accept", "application/json")
            }

            val code = connection.responseCode
            if (code == 200) {
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                val validHealth = validateHealthJson(body, expectedServerId)
                if (validHealth != null) {
                    return@withContext DiscoveredServer(
                        url = normalized,
                        serverId = validHealth.serverId
                    )
                }
            }
        } catch (_: Exception) {
            // Ignora fallos de conexión o timeout
        } finally {
            connection?.disconnect()
        }
        null
    }

    /**
     * Capa A: Comprueba la URL guardada previamente en SharedPreferences.
     */
    suspend fun tryLayerA(
        savedUrl: String?,
        savedServerId: String?
    ): DiscoveredServer? {
        if (savedUrl.isNullOrBlank()) return null
        return checkHealth(savedUrl, savedServerId, timeoutMs = 1500)
    }

    /**
     * Capa B: Barrido de subred /24 con Semaphore(32) y timeout de 700 ms por host.
     */
    suspend fun scanSubnet(
        prefix: String,
        expectedServerId: String? = null,
        port: Int = 3000
    ): DiscoveredServer? = coroutineScope {
        val ips = calculateSubnetIps(prefix)
        if (ips.isEmpty()) return@coroutineScope null

        val semaphore = Semaphore(32)
        val resultDeferred = CompletableDeferred<DiscoveredServer?>()
        val remaining = AtomicInteger(ips.size)

        val jobs = ips.map { ip ->
            launch(Dispatchers.IO) {
                if (resultDeferred.isCompleted) return@launch
                val targetUrl = "http://$ip:$port"
                try {
                    semaphore.withPermit {
                        if (resultDeferred.isCompleted) return@withPermit
                        val discovered = checkHealth(targetUrl, expectedServerId, timeoutMs = 700)
                        if (discovered != null) {
                            resultDeferred.complete(discovered)
                        }
                    }
                } catch (_: Exception) {
                } finally {
                    if (remaining.decrementAndGet() == 0) {
                        resultDeferred.complete(null)
                    }
                }
            }
        }

        try {
            val result = resultDeferred.await()
            jobs.forEach { it.cancel() }
            result
        } catch (e: CancellationException) {
            jobs.forEach { it.cancel() }
            throw e
        }
    }
}
