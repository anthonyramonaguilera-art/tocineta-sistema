import { Encrypter, Decrypter } from 'age-encryption';
import { DEFAULT_AGE_RECIPIENTS } from './constants.js';

export interface AgeEncryptionResult {
  encryptedBuffer: Buffer;
  recipientsCount: number;
}

/**
 * Cifra un buffer binario (ej. base de datos SQLite o JSON) con age utilizando
 * múltiples claves públicas destinatarias.
 * Cualquier destinatario que posea su clave privada correspondiente podrá descifrarlo.
 */
export async function encryptWithAge(
  data: Buffer | Uint8Array,
  recipients: string[] = DEFAULT_AGE_RECIPIENTS
): Promise<AgeEncryptionResult> {
  if (!recipients || recipients.length === 0) {
    throw new Error('Se requiere al menos una clave pública destinataria age para cifrar.');
  }

  const encrypter = new Encrypter();

  for (const recipient of recipients) {
    const trimmed = recipient.trim();
    if (!trimmed.startsWith('age1')) {
      throw new Error(`Clave pública inválida: '${trimmed}'. Debe comenzar con 'age1'.`);
    }
    await encrypter.addRecipient(trimmed);
  }

  const ciphertextUint8 = await encrypter.encrypt(data);
  return {
    encryptedBuffer: Buffer.from(ciphertextUint8),
    recipientsCount: recipients.length
  };
}

/**
 * Descifra un buffer cifrado con age utilizando una clave privada (AGE-SECRET-KEY-1...).
 * Se utiliza exclusivamente en pruebas y en el script de restauración/verificación.
 */
export async function decryptWithAge(
  encryptedData: Buffer | Uint8Array,
  privateIdentity: string
): Promise<Buffer> {
  const trimmedKey = privateIdentity.trim();
  if (!trimmedKey.startsWith('AGE-SECRET-KEY-1')) {
    throw new Error("Clave privada inválida. Debe comenzar con 'AGE-SECRET-KEY-1'.");
  }

  const decrypter = new Decrypter();
  await decrypter.addIdentity(trimmedKey);

  const decryptedUint8 = await decrypter.decrypt(encryptedData, 'uint8array');
  return Buffer.from(decryptedUint8);
}
