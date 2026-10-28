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
