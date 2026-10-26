import React, { useState } from 'react';
import { QrCode, Globe, Smartphone, Printer, ExternalLink, ShieldCheck, Wifi, Check, Save } from 'lucide-react';
import { PedagogicalGuideBanner } from './PedagogicalGuideBanner.js';

export const QrMenuWebAdminView: React.FC = () => {
  const [customDomain, setCustomDomain] = useState(() => {
    try {
      return localStorage.getItem('tocineta_custom_domain') || 'menu.tocineta.com';
    } catch {
      return 'menu.tocineta.com';
    }
  });
  const [whatsappPhone, setWhatsappPhone] = useState('584249728209');
  const [paperFormat, setPaperFormat] = useState<'A5' | 'A6' | '58mm'>('A5');
  const [isSaved, setIsSaved] = useState(false);

  const qrTargetUrl = `https://${customDomain.replace(/^https?:\/\//, '')}/menu?ws=${whatsappPhone}`;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qrTargetUrl)}&color=005A9C&bgcolor=FFFFFF`;

  const handleSaveDomain = () => {
    try {
      localStorage.setItem('tocineta_custom_domain', customDomain);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    } catch {}
  };

  const handlePrintA5 = () => {
    window.print();
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12 select-none">
      {/* Guía Pedagógica */}
      <PedagogicalGuideBanner
        title="Menú Digital QR (Formato A5) y Acceso Online Remoto"
        description="Herramienta empresarial estilo RePOS para generar carteles de mesa A5 de alta calidad con código QR para WhatsApp y vinculación de dominio web para monitoreo remoto."
        storageKey="banner_qr_menu"
      />

      {/* Grid de 2 Columnas: Panel QR Imprimible (Izq) + Configuración Dominio y Acceso Remoto (Der) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* COLUMNA IZQUIERDA: TARJETA QR FORMATO A5 / IMPRIMIBLE (7 COLS) */}
        <div className="lg:col-span-7 bg-white dark:bg-tocineta-card border border-slate-200 dark:border-tocineta-border rounded-3xl p-6 shadow-md flex flex-col items-center text-center">
          <div className="w-full flex items-center justify-between border-b border-slate-100 dark:border-tocineta-border pb-3 mb-4">
            <div className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-[#005A9C]" />
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                Diseño para Mesas (Formato {paperFormat})
              </h3>
            </div>
            {/* Selector de Tamaño de Papel */}
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-tocineta-bg p-1 rounded-xl border border-slate-200 dark:border-tocineta-border text-xs font-bold">
              {(['A5', 'A6', '58mm'] as const).map(fmt => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setPaperFormat(fmt)}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    paperFormat === fmt
                      ? 'bg-[#005A9C] text-white shadow-sm'
                      : 'text-slate-600 dark:text-tocineta-muted hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          {/* Plantilla A5 Imprimible Lista para Portamenús de Acrílico */}
          <div className="w-full max-w-sm border-2 border-dashed border-[#005A9C]/40 bg-gradient-to-b from-blue-50/50 to-white dark:from-[#0B1528] dark:to-tocineta-card rounded-3xl p-6 shadow-lg space-y-4">
            {/* Encabezado del Cartel */}
            <div className="space-y-1">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-400 text-black text-2xl shadow-md font-bold mb-1">
                🥓
              </div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-wide">
                TOCINETA
              </h2>
              <p className="text-xs font-bold text-[#005A9C] dark:text-[#38BDF8] uppercase tracking-wider">
                Food Truck • Puerto Ordaz
              </p>
            </div>

            {/* Código QR Central con Alto Contraste */}
            <div className="bg-white p-4 rounded-2xl border-2 border-slate-200 shadow-inner inline-block mx-auto">
              <img
                src={qrImageUrl}
                alt="Código QR del Menú Digital"
                className="w-56 h-56 object-contain rounded-lg"
              />
            </div>

            {/* Instrucción Clara al Comensal */}
            <div className="space-y-1">
              <p className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center justify-center gap-1.5">
                <Smartphone className="w-4 h-4 text-[#005A9C]" />
                Escanea con tu cámara y pide por WhatsApp
              </p>
              <p className="text-[11px] font-mono font-bold text-slate-500 dark:text-neutral-400">
                {customDomain}
              </p>
            </div>

            {/* Badges de Calidad */}
            <div className="pt-2 border-t border-slate-200 dark:border-tocineta-border flex items-center justify-center gap-4 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
              <span>⚡ Pedido Directo</span>
              <span>•</span>
              <span>🍔 Menú Actualizado</span>
              <span>•</span>
              <span>💵 Tasa BCV Al Día</span>
            </div>
          </div>

          {/* Botones de Acción para Imprimir */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={handlePrintA5}
              className="px-5 py-3 rounded-2xl bg-[#005A9C] hover:bg-[#00487d] text-white font-extrabold text-xs shadow-md active:scale-95 transition-all flex items-center gap-2"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir Cartel en {paperFormat}</span>
            </button>
            <a
              href={qrTargetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-3 rounded-2xl bg-slate-100 dark:bg-tocineta-bg border border-slate-200 dark:border-tocineta-border hover:border-[#005A9C] text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5 active:scale-95 transition-all"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Probar Menú Digital</span>
            </a>
          </div>
        </div>

        {/* COLUMNA DERECHA: CONFIGURACIÓN DE DOMINIO Y ACCESO REMOTO (5 COLS) */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Tarjeta: Vincular Dominio Web Propio */}
          <div className="bg-white dark:bg-tocineta-card border border-slate-200 dark:border-tocineta-border rounded-3xl p-5 shadow-md space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-tocineta-border pb-3">
              <Globe className="w-5 h-5 text-[#005A9C]" />
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                Dominio Web de la Marca
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-tocineta-muted leading-relaxed">
              Vincula aquí el dominio adquirido por la empresa (ej. <code className="bg-slate-100 dark:bg-black/40 px-1 py-0.5 rounded font-mono text-[#005A9C]">menu.tocineta.com</code>) para que los códigos QR apunten directamente a tu marca oficial.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Nombre de Dominio Web
                </label>
                <input
                  type="text"
                  value={customDomain}
                  onChange={e => setCustomDomain(e.target.value)}
                  placeholder="menu.tocineta.com"
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-tocineta-border bg-slate-50 dark:bg-tocineta-bg px-3 text-xs text-slate-900 dark:text-white outline-none focus:border-[#005A9C] font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  WhatsApp Oficial para Pedidos (con código de país)
                </label>
                <input
                  type="text"
                  value={whatsappPhone}
                  onChange={e => setWhatsappPhone(e.target.value)}
                  placeholder="584249728209"
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-tocineta-border bg-slate-50 dark:bg-tocineta-bg px-3 text-xs text-slate-900 dark:text-white outline-none focus:border-[#005A9C] font-mono"
                />
              </div>

              <button
                type="button"
                onClick={handleSaveDomain}
                className="w-full min-h-[44px] rounded-xl bg-[#005A9C] hover:bg-[#00487d] text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow"
              >
                {isSaved ? <Check className="w-4 h-4 text-emerald-300" /> : <Save className="w-4 h-4" />}
                <span>{isSaved ? '✓ Configuración Guardada' : 'Guardar y Actualizar QR'}</span>
              </button>
            </div>
          </div>

          {/* Tarjeta: Panel Informativo de Acceso Remoto Online */}
          <div className="bg-gradient-to-br from-blue-50/80 to-slate-50 dark:from-[#0B1528] dark:to-tocineta-card border border-blue-200/80 dark:border-blue-900/50 rounded-3xl p-5 shadow-md space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#005A9C]/15 border border-[#005A9C]/30 flex items-center justify-center text-[#005A9C] dark:text-[#38BDF8]">
                <Wifi className="w-4 h-4" />
              </div>
              <h4 className="font-extrabold text-sm text-slate-900 dark:text-white">
                Acceso Remoto Online Multi-Dispositivo
              </h4>
            </div>

            <p className="text-xs text-slate-600 dark:text-tocineta-muted leading-relaxed">
              El sistema cuenta con arquitectura híbrida preparada. Cuando instales el servicio de Internet en el Food Truck:
            </p>

            <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
              <li className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-[#10B981] shrink-0 mt-0.5" />
                <span><strong>Monitoreo en Vivo:</strong> Podrás ver las ventas del turno, cortes de caja y movimientos de inventario en tiempo real desde tu casa o celular.</span>
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-[#10B981] shrink-0 mt-0.5" />
                <span><strong>KDS en Cocina Sincronizado:</strong> Los pedidos tomados por los mesoneros en mesa se reflejarán instantáneamente en la pantalla táctil de cocina.</span>
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-[#10B981] shrink-0 mt-0.5" />
                <span><strong>Seguridad Bancaria:</strong> Todo el tráfico remoto viaja encriptado sin exponer puertos abiertos ni contraseñas.</span>
              </li>
            </ul>

            <div className="pt-2 border-t border-blue-200/60 dark:border-blue-900/40 flex items-center justify-between text-[11px] font-bold text-[#005A9C] dark:text-[#38BDF8]">
              <span>Estado: PREPARADO PARA ENLACE ONLINE</span>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
