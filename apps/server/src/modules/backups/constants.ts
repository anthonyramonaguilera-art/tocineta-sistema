import * as path from 'node:path';

/**
 * Claves públicas age oficiales de los dos únicos destinatarios autorizados:
 * 1. Sra. Olinelcys (Dueña del Food Truck) -> Clave privada en sobre sellado físico
 * 2. Varons Media (Agencia tecnológica y soporte) -> Clave privada en gestor de contraseñas
 *
 * REGLA CRÍTICA DE SEGURIDAD:
 * La laptop del Food Truck ÚNICAMENTE almacena las claves públicas (age1...).
 * JAMÁS almacena claves privadas de age.
 */
export const DEFAULT_AGE_RECIPIENTS = [
  // Sra. Olinelcys
  process.env.AGE_RECIPIENT_OLINELCYS || 'age1q5q9c7am7xx9e4flj0j8ugyfqejpyp5dc8qsvqpnv7uamg4wkcuqye3f0r',
  // Varons Media
  process.env.AGE_RECIPIENT_VARONS || 'age15asuchr5fv6fvqhpxm7zedh0n54p7sukdzn5zjp4auqaju8h5cfslg5ne7'
];

/**
 * Políticas de retención automática de snapshots:
 * - Últimos 12 snapshots de 5 minutos (cubre la última hora)
 * - 1 snapshot por hora durante 24 horas
 * - 1 snapshot por día durante 30 días
 */
export const SNAPSHOT_RETENTION = {
  RECENT_5MIN_COUNT: 12,
  HOURLY_COUNT: 24,
  DAILY_COUNT: 30
} as const;

export const DEFAULT_SNAPSHOTS_DIR = path.resolve(process.cwd(), './data/snapshots');
export const DEFAULT_USB_BACKUP_DIR = process.env.USB_BACKUP_PATH || path.resolve(process.cwd(), './data/backups/usb');
export const DEFAULT_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
