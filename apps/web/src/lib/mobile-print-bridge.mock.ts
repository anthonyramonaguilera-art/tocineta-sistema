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
  pairedPrinters?: Array<{ name: string; mac: string }>;
  bluetoothStatus?: {
    enabled: boolean;
    hasPermission?: boolean;
    permission?: boolean;
    connected?: boolean;
  };
  shouldFailPrint?: boolean;
  printErrorMessage?: string;
  bytesSent?: number;
  shouldFailSelectPrinter?: boolean;
  selectPrinterErrorMessage?: string;
  shouldFailTestPrint?: boolean;
  testPrintErrorMessage?: string;
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
  let selectedPrinter = options.printer !== undefined ? options.printer : { name: 'POS-58-BT', mac: 'AA:BB:CC:DD:EE:FF' };
  const pairedPrinters = options.pairedPrinters ?? [
    { name: 'POS-58-BT', mac: 'AA:BB:CC:DD:EE:FF' },
    { name: 'POS-80-BT', mac: '11:22:33:44:55:66' }
  ];
  const bluetoothStatus = options.bluetoothStatus ?? {
    enabled: true,
    hasPermission: true,
    permission: true,
    connected: true
  };
  const shouldFailPrint = Boolean(options.shouldFailPrint);
  const printErrorMessage = options.printErrorMessage || 'Error de conexión Bluetooth SPP';
  const bytesSent = options.bytesSent ?? 256;

  window.TocinetaNative = {
    async getCapabilities() {
      return { ...capabilities };
    },
    async getSelectedPrinter() {
      return selectedPrinter ? { ...selectedPrinter } : null;
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
    },
    async listPairedPrinters() {
      return [...pairedPrinters];
    },
    async selectPrinter(args: { mac: string } | string) {
      if (options.shouldFailSelectPrinter) {
        return {
          ok: false,
          success: false,
          error: options.selectPrinterErrorMessage || 'Error al seleccionar impresora'
        };
      }
      const mac = typeof args === 'string' ? args : args?.mac;
      const found = pairedPrinters.find((p) => p.mac === mac);
      selectedPrinter = found ? { ...found } : { name: `Impresora (${mac})`, mac };
      return { ok: true, success: true };
    },
    async testPrint() {
      if (options.shouldFailTestPrint) {
        return {
          success: false,
          error: options.testPrintErrorMessage || 'Fallo de impresión de prueba'
        };
      }
      return { success: true };
    },
    async getBluetoothStatus() {
      return { ...bluetoothStatus };
    }
  };

  return () => {
    window.TocinetaNative = originalBridge;
  };
}
