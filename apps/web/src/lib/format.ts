/**
 * Funciones de formateo canónicas para el Sistema TOCINETA
 */

/**
 * Normaliza y formatea la etiqueta de mesa para evitar duplicaciones como "Mesa Mesa 1".
 * - Si es undefined o null o vacío -> ""
 * - Si ya incluye "Mesa" o "mesa" al inicio -> normaliza a "Mesa X"
 * - Si solo es un número "1" -> "Mesa 1"
 * - Si es un canal o texto no numérico (ej. "Barra Food Truck", "Para Llevar", "Delivery") -> se respeta tal cual.
 */
export function formatTableLabel(value?: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  // Si ya empieza con "Mesa" (ej. "Mesa 1", "Mesa Mesa 1", "mesa 2", "MESA  4")
  // Elimina repeticiones del prefijo y normaliza
  const cleanMesaRegex = /^(?:mesa\s*)+(\d+.*)$/i;
  const match = trimmed.match(cleanMesaRegex);
  if (match) {
    return `Mesa ${match[1].trim()}`;
  }

  // Si es un número puro (ej. "1", "12")
  if (/^\d+$/.test(trimmed)) {
    return `Mesa ${trimmed}`;
  }

  // Si dice p. ej. "Barra Food Truck", "Para Llevar", "Delivery", etc.
  return trimmed;
}

/**
 * Formatea una cantidad monetaria en centavos a una cadena decimal con 2 decimales (ej. 5000 -> "50.00").
 * Implementado estrictamente con aritmética entera para evitar inconsistencias de coma flotante.
 */
export function formatCents(cents: number): string {
  const safeCents = Number.isFinite(cents) ? Math.round(cents) : 0;
  const isNegative = safeCents < 0;
  const absCents = Math.abs(safeCents);
  const units = Math.floor(absCents / 100);
  const remainder = absCents % 100;
  const remainderStr = remainder < 10 ? `0${remainder}` : `${remainder}`;
  return `${isNegative ? '-' : ''}${units}.${remainderStr}`;
}

