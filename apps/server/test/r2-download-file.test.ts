import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Importamos la función directamente desde apps/web
import { downloadWithAuth } from '../../web/src/lib/download-file.js';
import * as clientModule from '../../web/src/api/client.js';

describe('R2 — downloadWithAuth Helper & Download Auth Contracts', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalUrl = globalThis.URL;

  let clicked = false;
  let downloadedFilename = '';
  let appendedChild: any = null;
  let removedChild: any = null;
  let createdObjectUrl = '';
  let revokedObjectUrl = '';

  beforeEach(() => {
    clicked = false;
    downloadedFilename = '';
    appendedChild = null;
    removedChild = null;
    createdObjectUrl = 'blob:http://localhost/mock-blob-uuid';
    revokedObjectUrl = '';

    const mockAnchor: any = {
      href: '',
      download: '',
      click: vi.fn(() => {
        clicked = true;
        downloadedFilename = mockAnchor.download;
      })
    };

    const mockDocument: any = {
      createElement: vi.fn((tag: string) => {
        if (tag === 'a') return mockAnchor;
        return {};
      }),
      body: {
        appendChild: vi.fn((el: any) => {
          appendedChild = el;
        }),
        removeChild: vi.fn((el: any) => {
          removedChild = el;
        })
      }
    };

    const mockUrlClass: any = {
      createObjectURL: vi.fn(() => createdObjectUrl),
      revokeObjectURL: vi.fn((url: string) => {
        revokedObjectUrl = url;
      })
    };

    const mockWindow: any = {
      URL: mockUrlClass,
      localStorage: {
        getItem: vi.fn(() => 'mock_token_123')
      },
      dispatchEvent: vi.fn()
    };

    // Asignar al entorno global
    globalThis.window = mockWindow;
    globalThis.document = mockDocument;
    (globalThis as any).URL = mockUrlClass;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.URL = originalUrl;
    vi.restoreAllMocks();
  });

  it('1) Éxito: dispara click en <a download> con el nombre indicado y revoca la URL', async () => {
    const mockBlob = new Blob(['mock content'], { type: 'application/pdf' });
    const mockResponse = {
      ok: true,
      status: 200,
      blob: async () => mockBlob
    } as unknown as Response;

    const apiFetchSpy = vi.spyOn(clientModule, 'apiFetch').mockResolvedValue(mockResponse);

    await downloadWithAuth('/api/quotes/q_123/pdf', 'cotizacion-q_123.pdf');

    expect(apiFetchSpy).toHaveBeenCalledWith('/api/quotes/q_123/pdf');
    expect(clicked).toBe(true);
    expect(downloadedFilename).toBe('cotizacion-q_123.pdf');
    expect(appendedChild).toBeDefined();
    expect(removedChild).toBeDefined();
    expect(revokedObjectUrl).toBe(createdObjectUrl);
  });

  it('2) Error: propaga el mensaje devuelto por el servidor cuando res.ok es false', async () => {
    const mockResponse = {
      ok: false,
      status: 403,
      json: async () => ({ error: 'Acceso denegado: rol insuficiente' })
    } as unknown as Response;

    vi.spyOn(clientModule, 'apiFetch').mockResolvedValue(mockResponse);

    await expect(downloadWithAuth('/api/finances/export/excel', 'finanzas-excel.xlsx')).rejects.toThrow(
      'Acceso denegado: rol insuficiente'
    );
    expect(clicked).toBe(false);
  });

  it('3) Error: genera mensaje por código HTTP si el cuerpo no contiene JSON válido', async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      json: async () => {
        throw new Error('Invalid JSON');
      }
    } as unknown as Response;

    vi.spyOn(clientModule, 'apiFetch').mockResolvedValue(mockResponse);

    await expect(downloadWithAuth('/api/staff/settlements/s_1/pdf', 'liquidacion-s_1.pdf')).rejects.toThrow(
      'Error 401 al descargar el archivo'
    );
    expect(clicked).toBe(false);
  });

  it('4) Contratos en vistas: ninguna pantalla usa window.open con rutas relativas /api', () => {
    const webSrc = path.resolve(__dirname, '../../web/src');

    const quotesContent = fs.readFileSync(path.join(webSrc, 'features/quotes/EventQuotesView.tsx'), 'utf8');
    const staffContent = fs.readFileSync(path.join(webSrc, 'features/staff/SettlementModal.tsx'), 'utf8');
    const financesContent = fs.readFileSync(path.join(webSrc, 'features/finances/FinancesDashboardView.tsx'), 'utf8');
    const dispatchContent = fs.readFileSync(
      path.join(webSrc, 'features/profitability/components/DispatchNoteSuccessModal.tsx'),
      'utf8'
    );

    // Ninguna vista debe tener window.open hacia /api/...
    expect(quotesContent).not.toMatch(/window\.open\(\s*[`'"]\/api/);
    expect(staffContent).not.toMatch(/window\.open\(\s*[`'"]\/api/);
    expect(financesContent).not.toMatch(/window\.open\(\s*[`'"]\/api/);
    expect(dispatchContent).not.toMatch(/window\.open\(\s*[`'"]\/api/);

    // Todas deben usar downloadWithAuth
    expect(quotesContent).toContain('downloadWithAuth');
    expect(staffContent).toContain('downloadWithAuth');
    expect(financesContent).toContain('downloadWithAuth');
    expect(dispatchContent).toContain('downloadWithAuth');

    // Las URLs externas (wa.me) siguen intactas
    expect(quotesContent).toContain("window.open(d.url, '_blank')");
    expect(financesContent).toContain("window.open(json.data.url, '_blank')");
    expect(dispatchContent).toContain('https://wa.me/?text=');
  });
});
