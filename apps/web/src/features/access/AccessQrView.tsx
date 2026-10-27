import React, { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';
import { Card, Button, Badge, Icon } from '../../ui/index.js';

interface AccessInfo {
  status: string;
  timestamp: number;
  primaryIp: string;
  port: number;
  accessUrl: string;
  interfaces: Array<{ name: string; address: string; family: string }>;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const AccessQrView: React.FC = () => {
  const [accessInfo, setAccessInfo] = useState<AccessInfo | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installInstalled, setInstallInstalled] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const isSecureContext = typeof window !== 'undefined' && window.isSecureContext;

  useEffect(() => {
    // Escuchar beforeinstallprompt si el navegador lo soporta
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', () => setInstallInstalled(true));

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  useEffect(() => {
    async function fetchInfo() {
      try {
        const res = await fetch('/api/system/access-info');
        if (res.ok) {
          const data: AccessInfo = await res.json();
          setAccessInfo(data);
          // Prefer current origin hostname if already accessing via IP, otherwise server primary
          const currentOrigin = window.location.origin;
          const targetUrl = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
            ? currentOrigin
            : data.accessUrl || `http://${data.primaryIp}:${data.port}`;
          setSelectedUrl(targetUrl);
        }
      } catch {
        // Fallback a URL actual
        setSelectedUrl(window.location.origin);
      } finally {
        setLoading(false);
      }
    }
    fetchInfo();
  }, []);

  useEffect(() => {
    if (selectedUrl && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, selectedUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: 'rgba(17, 17, 17, 1)',
          light: 'rgba(255, 255, 255, 1)'
        }
      }).catch((err) => console.error('Error generando QR:', err));
    }
  }, [selectedUrl]);

  const copyToClipboard = async () => {
    if (!selectedUrl) return;
    try {
      await navigator.clipboard.writeText(selectedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstallInstalled(true);
      }
      setDeferredPrompt(null);
    } else {
      setShowGuide(true);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Encabezado */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/20 border border-primary/30 mx-auto">
          <Icon name="QrCode" size={28} className="text-ink" />
        </div>
        <h1 className="text-2xl font-black text-ink tracking-tight">Acceso Rápido y Móvil</h1>
        <p className="text-sm text-ink-muted">
          Escanea con la cámara de tu teléfono o tablet para operar sin escribir la dirección IP.
        </p>
      </div>

      {/* Tarjeta Principal QR */}
      <Card variant="surface" className="flex flex-col items-center p-6 text-center shadow-lg border-2 border-primary/30">
        {loading ? (
          <div className="w-64 h-64 flex items-center justify-center">
            <span className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-3 bg-white rounded-2xl shadow-inner border border-border inline-block">
            <canvas ref={canvasRef} className="rounded-xl max-w-full h-auto" />
          </div>
        )}

        <div className="mt-4 w-full space-y-2">
          <div className="p-3 bg-surface-alt rounded-xl border border-border flex items-center justify-between gap-2">
            <span className="text-xs sm:text-sm font-mono font-bold text-ink truncate select-all">
              {selectedUrl || 'Cargando URL...'}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={copyToClipboard}
              leftIcon={<Icon name={copied ? 'Check' : 'Copy'} size={14} />}
            >
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
          </div>

          {accessInfo?.interfaces && accessInfo.interfaces.length > 1 && (
            <div className="pt-2 text-left">
              <label className="text-xs font-bold text-ink-muted block mb-1.5">Otras redes disponibles:</label>
              <div className="flex flex-wrap gap-1.5">
                {accessInfo.interfaces.map((iface) => {
                  const url = `http://${iface.address}:${accessInfo.port}`;
                  const isCurrent = url === selectedUrl;
                  return (
                    <button
                      key={iface.address}
                      type="button"
                      onClick={() => setSelectedUrl(url)}
                      className={`text-xs px-2.5 py-1 rounded-lg border font-mono transition-colors ${
                        isCurrent
                          ? 'bg-primary text-ink font-bold border-primary'
                          : 'bg-surface text-ink-muted border-border hover:bg-surface-alt'
                      }`}
                    >
                      {iface.name}: {iface.address}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Instalación PWA */}
      <Card variant="alt" className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-primary/20 border border-primary/30 shrink-0">
            <Icon name="Smartphone" size={20} className="text-ink" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-ink">Instalar en la Pantalla de Inicio</h2>
              {installInstalled ? (
                <Badge variant="success">Instalada</Badge>
              ) : isSecureContext ? (
                <Badge variant="primary">Listo</Badge>
              ) : (
                <Badge variant="warning">Red Local HTTP</Badge>
              )}
            </div>
            <p className="text-xs text-ink-muted mt-1 leading-relaxed">
              Agrega TOCINETA a tu dispositivo para acceder a pantalla completa y operar sin barras de navegación.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <Button
            variant="primary"
            fullWidth
            onClick={handleInstallClick}
            leftIcon={<Icon name="Download" size={18} />}
          >
            {deferredPrompt ? 'Instalar Aplicación Directamente' : '¿Cómo Instalar en mi Teléfono?'}
          </Button>
        </div>

        {showGuide && (
          <div className="mt-4 p-4 rounded-xl bg-surface border border-border text-xs text-ink space-y-3">
            <h3 className="font-bold flex items-center gap-1.5 text-ink">
              <Icon name="Info" size={15} className="text-primary" />
              Guía de 2 Pasos para Instalar
            </h3>

            <div className="space-y-2 pl-1">
              <div className="flex gap-2">
                <span className="font-black text-primary">1.</span>
                <span>
                  <strong>En Android (Chrome):</strong> Toca los 3 puntos superiores <Icon name="MoreVertical" size={12} className="inline" /> y selecciona <em>"Agregar a la pantalla principal"</em> o <em>"Instalar app"</em>.
                </span>
              </div>
              <div className="flex gap-2">
                <span className="font-black text-primary">2.</span>
                <span>
                  <strong>En iPhone / iPad (Safari):</strong> Toca el botón Compartir <Icon name="Share2" size={12} className="inline" /> y selecciona <em>"Agregar al inicio"</em>.
                </span>
              </div>
            </div>

            {!isSecureContext && (
              <div className="mt-3 p-2.5 rounded-lg bg-warning/15 border border-warning/30 text-[11px] leading-relaxed">
                <strong>Nota técnica sobre seguridad:</strong> El sistema se encuentra en red local mediante HTTP directo por IP. Algunos navegadores requieren HTTPS para instalación con un solo clic. Instalación completa disponible cuando el sistema use HTTPS.
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

export default AccessQrView;
