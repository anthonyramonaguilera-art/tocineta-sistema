/**
 * TOCINETA — Utilidades de validación y cálculo de PIN
 */

export function getRequiredPinLength(user?: { role?: string; pinLength?: number } | null): number {
  if (user?.pinLength && typeof user.pinLength === 'number' && user.pinLength > 0) {
    return user.pinLength;
  }
  if (user?.role === 'admin' || user?.role === 'supervisor') {
    return 6;
  }
  return 4;
}

export function isTrivialPin(pin: string): boolean {
  if (!pin || pin.length < 4) return true;
  // Todos los dígitos iguales (p. ej. '000000', '111111')
  if (pin.split('').every((c) => c === pin[0])) return true;

  // Secuencias ascendentes o descendentes (p. ej. '123456', '654321', '012345')
  let isAsc = true;
  let isDesc = true;
  for (let i = 1; i < pin.length; i++) {
    const prev = parseInt(pin[i - 1], 10);
    const curr = parseInt(pin[i], 10);
    if (isNaN(prev) || isNaN(curr)) return true;
    if (curr !== prev + 1) isAsc = false;
    if (curr !== prev - 1) isDesc = false;
  }
  return isAsc || isDesc;
}

export function sanitizePinInput(input: string, maxLength?: number): string {
  const digitsOnly = input.replace(/\D/g, '');
  return maxLength ? digitsOnly.slice(0, maxLength) : digitsOnly;
}

export function validatePinChange(
  newPin: string,
  confirmPin: string,
  requiredLength: number,
  isAdminOrSupervisor: boolean
): { valid: boolean; error?: string } {
  if (!newPin || newPin.length !== requiredLength) {
    return {
      valid: false,
      error: `El nuevo PIN debe tener exactamente ${requiredLength} dígitos.`
    };
  }

  if (!/^\d+$/.test(newPin)) {
    return {
      valid: false,
      error: 'El PIN debe contener únicamente dígitos numéricos.'
    };
  }

  if (newPin !== confirmPin) {
    return {
      valid: false,
      error: 'Los PINs no coinciden.'
    };
  }

  if (isAdminOrSupervisor && isTrivialPin(newPin)) {
    return {
      valid: false,
      error: 'El PIN no puede ser una secuencia numérica (ej: 123456) ni dígitos repetidos (ej: 111111).'
    };
  }

  return { valid: true };
}
