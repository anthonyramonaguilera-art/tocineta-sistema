import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Button, Badge, Icon } from '../ui/index.js';
import { PedagogicalGuideBanner } from './PedagogicalGuideBanner.js';

export const QrMenuWebAdminView: React.FC = () => {
  const [customDomain, setCustomDomain] = useState(() => {
    try {
      return localStorage.getItem('tocineta_custom_domain') || 'menu.tocineta.com';
    } catch {
      return 'menu.tocineta.com';
    }
  });

  const [paperFormat, setPaperFormat] = useState<'A5' | 'A6' | '58mm'>('A5');
  const [isSaved, setIsSaved] = useState(false);
  const [showMenuPreview, setShowMenuPreview] = useState(false);

  // Consultar datos reales del menú QR sanitizado
  const { data: qrMenuRes, isLoading } = useQuery({
    queryKey: ['publicQrMenu'],
    queryFn: async () => {
      const res = await fetch('/api/qr-menu');
      if (!res.ok) throw new Error('Error al cargar menú digital');
      return res.json();
    },
    staleTime: 10000
  });

  const menu = qrMenuRes?.menu;
  const storeName = menu?.storeName || 'TOCINETA';
  const slogan = menu?.slogan || 'Cocinamos con amor y servimos como mereces';
  const whatsappNumber = menu?.whatsappNumber || '584249728209';
  const rateFormatted = menu?.currency?.rateFormatted || '40,00';
  const categories = menu?.categories || [];

  const qrTargetUrl = `https://${customDomain.replace(/^https?:\/\//, '')}/menu?ws=${whatsappNumber}`;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qrTargetUrl)}&color=000000&bgcolor=FFFFFF`;

  const handleSaveDomain = () => {
    try {
      localStorage.setItem('tocineta_custom_domain', customDomain);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    } catch {}
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12 select-none">
      <PedagogicalGuideBanner
        title="Menú Digital QR y Carta Web en Vivo"
        description="Generación de carteles de mesa (A5/A6) para comensales, sincronización automática con la carta real y ocultamiento instantáneo de platos agotados."
        storageKey="banner_qr_menu_f7"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* COLUMNA IZQUIERDA: CARTEL IMPRIMIBLE A5 / QR DE MESA (7 COLS) */}
        <div className="lg:col-span-7 bg-surface border border-border rounded-3xl p-6 shadow-sm flex flex-col items-center text-center space-y-4">
          <div className="w-full flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Icon name="QrCode" size={20} className="text-primary" />
              <h3 className="font-extrabold text-base text-ink">
                Cartel para Mesas (Formato {paperFormat})
              </h3>
            </div>

            {/* Selector de Tamaño de Papel */}
            <div className="flex items-center gap-1 bg-surface-alt p-1 rounded-xl border border-border text-xs font-bold">
              {(['A5', 'A6', '58mm'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setPaperFormat(fmt)}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    paperFormat === fmt
                      ? 'bg-primary text-ink shadow-xs font-black'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          {/* Plantilla A5 Imprimible Lista para Portamenús */}
          <div className="w-full max-w-sm border-2 border-dashed border-primary/40 bg-surface rounded-3xl p-6 shadow-md space-y-4">
            <div className="space-y-1">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/20 text-primary shadow-xs mb-1">
                <Icon name="Utensils" size={24} />
              </div>
              <h2 className="text-xl font-black text-ink tracking-wide uppercase">
                {storeName}
              </h2>
              <p className="text-xs font-bold text-ink-muted">
                {slogan}
              </p>
            </div>

            {/* Código QR Central con Alto Contraste */}
            <div className="bg-surface p-3.5 rounded-2xl border-2 border-border shadow-xs inline-block mx-auto">
              <img
                src={qrImageUrl}
                alt="Código QR del Menú Digital"
                className="w-52 h-52 object-contain rounded-lg"
              />
            </div>

            <div className="space-y-1">
              <p className="text-xs font-extrabold text-ink flex items-center justify-center gap-1.5">
                <Icon name="Smartphone" size={16} className="text-primary" />
                Escanea con tu cámara y pide por WhatsApp
              </p>
              <p className="text-[11px] font-mono font-bold text-ink-muted">
                {customDomain}
              </p>
            </div>

            {/* Badges de Calidad */}
            <div className="pt-2 border-t border-border flex items-center justify-center gap-3 text-[10px] text-ink-muted font-bold uppercase tracking-wider">
              <span className="flex items-center gap-1">
                <Icon name="Zap" size={12} className="text-primary" /> Pedido Directo
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Icon name="ShieldCheck" size={12} className="text-success" /> Carta Real
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Icon name="DollarSign" size={12} className="text-primary" /> Tasa {rateFormatted}
              </span>
            </div>
          </div>

          {/* Botonera de Impresión y Previsualización */}
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handlePrint}
              className="min-h-[48px] px-5 font-black shadow-md"
              leftIcon={<Icon name="Printer" size={18} />}
            >
              Imprimir Cartel ({paperFormat})
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setShowMenuPreview(!showMenuPreview)}
              className="min-h-[48px] px-4 font-bold"
              leftIcon={<Icon name="Eye" size={18} />}
            >
              {showMenuPreview ? 'Ocultar Previa de Carta' : 'Ver Carta en Vivo'}
            </Button>
          </div>
        </div>

        {/* COLUMNA DERECHA: CONFIGURACIÓN DE DOMINIO Y ACCESO (5 COLS) */}
        <div className="lg:col-span-5 space-y-5">
          {/* Tarjeta: Dominio y WhatsApp */}
          <Card variant="surface" className="p-5 border border-border space-y-4">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Icon name="Globe" size={18} className="text-primary" />
              <h3 className="font-extrabold text-base text-ink">
                Enlace de Marca y Pedidos
              </h3>
            </div>

            <p className="text-xs text-ink-muted leading-relaxed">
              Configura el subdominio de tu restaurante y el número de WhatsApp oficial donde los comensales enviarán sus órdenes estructuradas.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-ink-muted mb-1">
                  Dominio Web Oficial
                </label>
                <input
                  type="text"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="menu.mirestaurante.com"
                  className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-ink-muted mb-1">
                  WhatsApp Oficial para Pedidos
                </label>
                <div className="w-full min-h-[44px] rounded-xl border border-border bg-surface-alt px-3 flex items-center justify-between text-xs font-mono font-bold text-ink">
                  <span>+{whatsappNumber}</span>
                  <Badge variant="success">Configurado en Ajustes</Badge>
                </div>
              </div>

              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleSaveDomain}
                className="w-full min-h-[48px] font-black"
                leftIcon={<Icon name={isSaved ? 'Check' : 'Save'} size={18} />}
              >
                {isSaved ? 'Dominio Guardado' : 'Guardar y Actualizar QR'}
              </Button>
            </div>
          </Card>

          {/* Tarjeta: Estado de Carta Real y Platos Ocultos */}
          <Card variant="surface" className="p-5 border border-border space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-success/10 flex items-center justify-center text-success">
                <Icon name="CheckCircle2" size={18} />
              </div>
              <h4 className="font-extrabold text-sm text-ink">
                Sincronización de Carta Blindada
              </h4>
            </div>

            <ul className="space-y-2 text-xs text-ink-muted">
              <li className="flex items-start gap-2">
                <Icon name="Check" size={14} className="text-success shrink-0 mt-0.5" />
                <span><strong>Lectura en Tiempo Real:</strong> Lee directamente categorías, platos y fotos de la carta oficial.</span>
              </li>
              <li className="flex items-start gap-2">
                <Icon name="Check" size={14} className="text-success shrink-0 mt-0.5" />
                <span><strong>Ocultamiento de Agotados:</strong> Si un plato se marca sin disponibilidad en cocina, desaparece de inmediato del menú público.</span>
              </li>
              <li className="flex items-start gap-2">
                <Icon name="Check" size={14} className="text-success shrink-0 mt-0.5" />
                <span><strong>Tasa BCV Oficial:</strong> Precios calculados dinámicamente con la tasa oficial vigente ({rateFormatted}).</span>
              </li>
            </ul>
          </Card>
        </div>
      </div>

      {/* Previsualización en Vivo de la Carta con Fotos */}
      {showMenuPreview && (
        <Card variant="surface" className="p-5 sm:p-6 border-2 border-primary/30 rounded-3xl space-y-5 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h3 className="text-base font-black text-ink">Previa en Vivo de la Carta Pública</h3>
              <p className="text-xs text-ink-muted">Tal como la visualiza el cliente al escanear el QR (solo productos disponibles con foto).</p>
            </div>
            <button
              type="button"
              onClick={() => setShowMenuPreview(false)}
              className="w-8 h-8 rounded-lg bg-surface-alt flex items-center justify-center text-ink-muted hover:text-ink"
            >
              <Icon name="X" size={16} />
            </button>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-xs text-ink-muted">Cargando carta...</div>
          ) : (
            <div className="space-y-6">
              {categories.map((cat: any) => (
                <div key={cat.id} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h4 className="font-extrabold text-sm text-ink uppercase tracking-wider">{cat.name}</h4>
                    <span className="text-[11px] text-ink-muted">({cat.products.length} disponibles)</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {cat.products.map((p: any) => (
                      <div key={p.id} className="p-3 rounded-2xl bg-surface-alt/40 border border-border flex gap-3 items-center">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt={p.name} className="w-16 h-16 rounded-xl object-cover shrink-0 border border-border" />
                        ) : (
                          <div className="w-16 h-16 rounded-xl bg-surface flex items-center justify-center text-ink-muted shrink-0 border border-border">
                            <Icon name="Utensils" size={20} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <h5 className="font-extrabold text-xs text-ink truncate">{p.name}</h5>
                          <p className="text-[10px] text-ink-muted line-clamp-1">{p.description || 'Delicioso plato preparado al momento'}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="font-black text-xs text-primary">{p.priceUsdFormatted}</span>
                            <span className="text-[10px] text-ink-muted">{p.priceBsFormatted}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default QrMenuWebAdminView;
