import { apiFetch } from '../api/client.js';

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
