package com.tocineta.terminal.bridge

import android.content.SharedPreferences
import java.util.UUID

object BridgeScript {

    const val PREFS_KEY_TERMINAL_ID = "tocineta_terminal_id"

    fun generateTerminalId(): String {
        return UUID.randomUUID().toString().replace("-", "").lowercase()
    }

    fun getOrCreateTerminalId(prefs: SharedPreferences): String {
        val existing = prefs.getString(PREFS_KEY_TERMINAL_ID, null)?.trim()
        if (!existing.isNullOrBlank() && existing.length == 32 && existing.all { it.isLetterOrDigit() }) {
            return existing
        }
        val newId = generateTerminalId()
        prefs.edit().putString(PREFS_KEY_TERMINAL_ID, newId).apply()
        return newId
    }

    fun buildScript(terminalId: String): String {
        val sanitizedId = terminalId.filter { it.isLetterOrDigit() }
        return """
(function() {
  if (window.__TOCINETA_TERMINAL_ID__ && window.TocinetaNative) {
    return;
  }
  window.__TOCINETA_TERMINAL_ID__ = "$sanitizedId";

  var pendingCalls = {};
  var callSeq = 0;

  window.__tocinetaResolve = function(callId, arg2, arg3, arg4) {
    var call = pendingCalls[callId];
    if (!call) return;
    delete pendingCalls[callId];
    if (call.timer) {
      clearTimeout(call.timer);
    }
    if (typeof arg2 === 'boolean') {
      var success = arg2;
      var res = arg3;
      var err = arg4;
      if (success) {
        call.resolve(res);
      } else {
        call.reject(new Error(err || (res && res.error) || 'Error nativo'));
      }
    } else {
      var res = arg2;
      var err = arg3;
      if (err) {
        call.reject(new Error(typeof err === 'string' ? err : (err.message || 'Error nativo')));
      } else {
        call.resolve(res);
      }
    }
  };

  function invoke(method, args, timeoutMs) {
    var timeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 15000;
    return new Promise(function(resolve, reject) {
      var callId = 'call_' + (++callSeq) + '_' + Date.now();
      var timer = setTimeout(function() {
        if (pendingCalls[callId]) {
          delete pendingCalls[callId];
          var timeoutSec = Math.round(timeout / 1000);
          reject(new Error('Timeout de ' + timeoutSec + ' s esperando respuesta nativa para ' + method));
        }
      }, timeout);

      pendingCalls[callId] = {
        resolve: resolve,
        reject: reject,
        timer: timer
      };

      var argsJson = JSON.stringify(args || {});
      try {
        var bridge = window.__TocinetaNativeBridge;
        if (bridge && typeof bridge[method] === 'function') {
          bridge[method](callId, argsJson);
        } else if (bridge && typeof bridge.postMessage === 'function') {
          bridge.postMessage(method, callId, argsJson);
        } else {
          clearTimeout(timer);
          delete pendingCalls[callId];
          reject(new Error('Puente nativo no disponible'));
        }
      } catch (err) {
        clearTimeout(timer);
        delete pendingCalls[callId];
        reject(err);
      }
    });
  }

  window.TocinetaNative = {
    getCapabilities: function() {
      return invoke('getCapabilities', {});
    },
    getSelectedPrinter: function() {
      return invoke('getSelectedPrinter', {});
    },
    printEscPos: function(args) {
      return invoke('printEscPos', args || {});
    },
    listPairedPrinters: function() {
      return invoke('listPairedPrinters', {});
    },
    selectPrinter: function(args) {
      return invoke('selectPrinter', typeof args === 'string' ? { mac: args } : (args || {}));
    },
    testPrint: function() {
      return invoke('testPrint', {});
    },
    getBluetoothStatus: function() {
      return invoke('getBluetoothStatus', {});
    },
    saveAndOpenFile: function(args) {
      return invoke('saveAndOpenFile', args || {}, 60000);
    }
  };
})();
""".trimIndent()
    }
}
