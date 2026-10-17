import crypto from 'node:crypto';
import type { UserRole } from '../../db/schema.js';

// Parámetros canónicos de scrypt según especificación M1
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export function getRequiredPinLength(role: UserRole): 4 | 6 {
  return role === 'admin' || role === 'supervisor' ? 6 : 4;
}

export function validatePinFormat(pin: string, role: UserRole): { valid: boolean; requiredLength: 4 | 6; error?: string } {
  const requiredLength = getRequiredPinLength(role);
  if (typeof pin !== 'string') {
    return { valid: false, requiredLength, error: 'El PIN debe ser una cadena de texto' };
  }

  const trimmed = pin.trim();
  const regex = requiredLength === 6 ? /^\d{6}$/ : /^\d{4}$/;

  if (!regex.test(trimmed)) {
    return {
      valid: false,
      requiredLength,
      error: `El rol '${role}' exige un PIN numérico de exactamente ${requiredLength} dígitos.`
    };
  }

  return { valid: true, requiredLength };
}

export function hashPin(pin: string, existingSalt?: string): { hash: string; salt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(pin, salt, SCRYPT_KEYLEN, {
    cost: SCRYPT_N,
    blockSize: SCRYPT_R,
    parallelization: SCRYPT_P
  });

  return {
    hash: derivedKey.toString('hex'),
    salt
  };
}

export function verifyPin(pin: string, salt: string, expectedHash: string): boolean {
  try {
    const derivedKey = crypto.scryptSync(pin, salt, SCRYPT_KEYLEN, {
      cost: SCRYPT_N,
      blockSize: SCRYPT_R,
      parallelization: SCRYPT_P
    });

    const expectedBuffer = Buffer.from(expectedHash, 'hex');
    if (derivedKey.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(derivedKey, expectedBuffer);
  } catch {
    return false;
  }
}
