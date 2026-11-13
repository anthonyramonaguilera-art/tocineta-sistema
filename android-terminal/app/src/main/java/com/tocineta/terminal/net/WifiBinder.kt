package com.tocineta.terminal.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkAddress
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.Inet4Address

class WifiBinder(context: Context) {

    private val connectivityManager =
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    private val _wifiBound = MutableStateFlow(false)
    val wifiBound: StateFlow<Boolean> = _wifiBound.asStateFlow()

    private val _localIpv4Prefix = MutableStateFlow<String?>(null)
    val localIpv4Prefix: StateFlow<String?> = _localIpv4Prefix.asStateFlow()

    private var activeNetwork: Network? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    fun start() {
        if (networkCallback != null) return

        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                activeNetwork = network
                try {
                    connectivityManager.bindProcessToNetwork(network)
                } catch (_: Exception) {}
                _wifiBound.value = true
                updateLocalPrefix(network)
            }

            override fun onLost(network: Network) {
                if (activeNetwork == network) {
                    activeNetwork = null
                    try {
                        connectivityManager.bindProcessToNetwork(null)
                    } catch (_: Exception) {}
                    _wifiBound.value = false
                    _localIpv4Prefix.value = null
                }
            }

            override fun onLinkPropertiesChanged(
                network: Network,
                linkProperties: android.net.LinkProperties
            ) {
                if (activeNetwork == network) {
                    val prefix = extractPrefixFromAddresses(linkProperties.linkAddresses)
                    if (prefix != null) {
                        _localIpv4Prefix.value = prefix
                    }
                }
            }
        }

        networkCallback = callback
        try {
            connectivityManager.requestNetwork(request, callback)
        } catch (_: Exception) {
            // Manejo de excepción en caso de entorno restringido
        }
    }

    private fun updateLocalPrefix(network: Network) {
        val linkProperties = connectivityManager.getLinkProperties(network)
        val prefix = extractPrefixFromAddresses(linkProperties?.linkAddresses)
        if (prefix != null) {
            _localIpv4Prefix.value = prefix
        }
    }

    fun release() {
        networkCallback?.let { callback ->
            try {
                connectivityManager.unregisterNetworkCallback(callback)
            } catch (_: Exception) {}
            networkCallback = null
        }
        try {
            connectivityManager.bindProcessToNetwork(null)
        } catch (_: Exception) {}
        activeNetwork = null
        _wifiBound.value = false
        _localIpv4Prefix.value = null
    }

    companion object {
        fun extractPrefixFromAddresses(linkAddresses: List<LinkAddress>?): String? {
            if (linkAddresses == null) return null
            for (linkAddr in linkAddresses) {
                val addr = linkAddr.address
                if (addr is Inet4Address && !addr.isLoopbackAddress) {
                    val host = addr.hostAddress ?: continue
                    val prefix = extractIpv4Prefix(host)
                    if (prefix != null) return prefix
                }
            }
            return null
        }

        fun extractIpv4Prefix(ip: String): String? {
            val parts = ip.split(".")
            if (parts.size == 4 && parts.all { it.toIntOrNull() in 0..255 }) {
                return "${parts[0]}.${parts[1]}.${parts[2]}"
            }
            return null
        }
    }
}
