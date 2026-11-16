/**
 * Compresión de imágenes en el navegador para las fotos de platos.
 * Sin dependencias externas: FileReader + canvas + toDataURL.
 *
 * El servidor rechaza fotos de más de 2 MB decodificados, así que el cliente
 * reduce el lado mayor y recodifica antes de enviar el base64.
 */

export interface CompressImageOptions {
  /** Lado mayor máximo en píxeles; la proporción se mantiene. */
  maxSide?: number;
  /** Calidad de codificación entre 0 y 1 para WEBP/JPEG. */
  quality?: number;
}

const DEFAULT_MAX_SIDE = 1280;
const DEFAULT_QUALITY = 0.82;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('El archivo seleccionado no es una imagen válida'));
    image.src = dataUrl;
  });
}

/** Tamaño en bytes del contenido decodificado de un data URL base64. */
export function dataUrlByteSize(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * Escala la imagen manteniendo la proporción y devuelve un data URL comprimido
 * (WEBP cuando el navegador lo soporta, JPEG en caso contrario).
 */
export async function compressImage(file: File, options: CompressImageOptions = {}): Promise<string> {
  const maxSide = options.maxSide ?? DEFAULT_MAX_SIDE;
  const quality = Math.min(1, Math.max(0.1, options.quality ?? DEFAULT_QUALITY));

  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error('La imagen no tiene dimensiones válidas');
  }

  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('El navegador no pudo procesar la imagen');
  }

  // Fondo blanco: las fotos de platos no usan transparencia y así el JPEG
  // de respaldo no aparece con zonas negras.
  context.fillStyle = 'white';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  const webpDataUrl = canvas.toDataURL('image/webp', quality);
  if (webpDataUrl.startsWith('data:image/webp')) {
    return webpDataUrl;
  }
  return canvas.toDataURL('image/jpeg', quality);
}

export default compressImage;
