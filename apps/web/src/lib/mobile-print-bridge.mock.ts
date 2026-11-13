/**
 * TOCINETA — Mock Manual del Puente Nativo de Impresión Móvil
 *
 * Permite simular window.TocinetaNative en entornos web/desarrollo sin APK instalada.
 * Cubre los 4 escenarios de prueba requeridos:
 *  1. Éxito de impresión
 *  2. Fallo de impresora (sin impresora o error de conexión SPP)
 *  3. Claim 409 (trabajo ya reclamado o en conflicto)
 *  4. Serie de 3 trabajos con uno fallido
 */

export interface MockNativeBridgeOptions {
  capabilities?: { bluetoothSpp: boolean };
  printer?: { name: string; mac: string } | null;
  shouldFailPrint?: boolean;
  printErrorMessage?: string;
  bytesSent?: number;
}

/**
 * Instala un mock de window.TocinetaNative en el entorno global.
 * Devuelve una función para desinstalarlo y restaurar el estado previo.
 */
export function installMockNativeBridge(options: MockNativeBridgeOptions = {}): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const originalBridge = window.TocinetaNative;

  const capabilities = options.capabilities ?? { bluetoothSpp: true };
  const printer = options.printer !== undefined ? options.printer : { name: 'POS-58-BT', mac: 'AA:BB:CC:DD:EE:FF' };
  const shouldFailPrint = Boolean(options.shouldFailPrint);
  const printErrorMessage = options.printErrorMessage || 'Error de conexión Bluetooth SPP';
  const bytesSent = options.bytesSent ?? 256;

  window.TocinetaNative = {
    async getCapabilities() {
      return { ...capabilities };
    },
    async getSelectedPrinter() {
      return printer ? { ...printer } : null;
    },
    async printEscPos(args: { mac: string; base64: string }) {
      if (shouldFailPrint) {
        return {
          success: false,
          error: printErrorMessage
        };
      }
      return {
        success: true,
        bytesSent: args.base64 ? Math.max(bytesSent, args.base64.length) : bytesSent
      };
    }
  };

  return () => {
    window.TocinetaNative = originalBridge;
  };
}
