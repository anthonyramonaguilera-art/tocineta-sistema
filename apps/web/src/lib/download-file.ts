import { apiFetch } from '../api/client.js';

interface TocinetaNativeDownloadBridge {
  saveAndOpenFile?(args: {
    fileName: string;
    mimeType: string;
    base64Data: string;
  }): Promise<{ ok?: boolean; fileName?: string; opened?: boolean; error?: string }>;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        const commaIndex = result.indexOf(',');
        const base64 = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
        resolve(base64);
      } else {
        reject(new Error('No se pudo convertir el archivo a base64'));
      }
    };
    reader.onerror = () => {
      reject(reader.error || new Error('Error al leer el archivo'));
    };
    reader.readAsDataURL(blob);
  });
}

export async function downloadWithAuth(path: string, filename: string): Promise<void> {
  const res = await apiFetch(path);
  if (!res.ok) {
    let message = `Error ${res.status} al descargar el archivo`;
    try {
      const data = await res.json();
      if (data && (data.error || data.message)) {
        message = data.error || data.message;
      }
    } catch {
      // Body no es JSON o respuesta vacía
    }
    throw new Error(message);
  }

  const blob = await res.blob();

  const nativeBridge = typeof window !== 'undefined'
    ? (window as Window & { TocinetaNative?: TocinetaNativeDownloadBridge }).TocinetaNative
    : undefined;

  if (typeof nativeBridge?.saveAndOpenFile === 'function') {
    const base64Data = await blobToBase64(blob);
    await nativeBridge.saveAndOpenFile({
      fileName: filename,
      mimeType: blob.type || 'application/octet-stream',
      base64Data,
    });
    return;
  }

  const createUrl = window.URL?.createObjectURL || URL?.createObjectURL;
  const revokeUrl = window.URL?.revokeObjectURL || URL?.revokeObjectURL;

  const url = createUrl(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (revokeUrl) {
    revokeUrl(url);
  }
}
