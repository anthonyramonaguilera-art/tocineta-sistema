import React, { useState } from 'react';
import { Card, Button, Icon } from '../../ui/index.js';
import type { BusinessSettings } from './types.js';

interface OnboardingWizardModalProps {
  isOpen: boolean;
  currentSettings: BusinessSettings | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const OnboardingWizardModal: React.FC<OnboardingWizardModalProps> = ({
  isOpen,
  currentSettings,
  onClose,
  onSuccess
}) => {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [businessName, setBusinessName] = useState(currentSettings?.business_name || 'TOCINETA');
  const [slogan, setSlogan] = useState(currentSettings?.slogan || 'Cocinamos con amor y servimos como mereces');
  const [rif, setRif] = useState(currentSettings?.rif || 'V-17040918-0');
  const [phone, setPhone] = useState(currentSettings?.phone || '04249728209');
  const [address, setAddress] = useState(currentSettings?.address || 'Detrás de Torre Movistar, Puerto Ordaz');
  const [locationName, setLocationName] = useState('Sede Alta Vista');
  const [primaryColor, setPrimaryColor] = useState(currentSettings?.primary_color || '#EAB308');
  const [rateChangeHour, setRateChangeHour] = useState(currentSettings?.rate_change_hour || '13:00');

  if (!isOpen) return null;

  const handleFinish = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/business-settings/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: businessName.trim(),
          slogan: slogan.trim(),
          rif: rif.trim(),
          phone: phone.trim(),
          address: address.trim(),
          primaryColor,
          rateChangeHour,
          locationName: locationName.trim()
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error en el asistente');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      alert(err.message || 'Error al completar el asistente de instalación');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-xs select-none animate-in fade-in duration-200">
      <Card variant="surface" className="w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl border-2 border-border">
        {/* Header con pasos */}
        <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-black">
              {step}/4
            </div>
            <div>
              <h3 className="text-base font-black text-ink">Asistente de Primera Instalación</h3>
              <p className="text-xs text-ink-muted">Personalización para cualquier restaurante o franquicia.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-alt flex items-center justify-center text-ink-muted hover:text-ink">
            <Icon name="X" size={16} />
          </button>
        </div>

        {/* Barra de progreso */}
        <div className="w-full bg-surface-alt h-1.5 overflow-hidden">
          <div
            className="bg-primary h-full transition-all duration-300"
            style={{ width: `${(step / 4) * 100}%` }}
          />
        </div>

        {/* Contenido del Paso Actual */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 text-xs">
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-ink">
                <Icon name="Building2" size={18} className="text-primary" />
                <h4 className="font-extrabold text-sm uppercase tracking-wide">Paso 1: Identidad Corporativa</h4>
              </div>
              <p className="text-ink-muted leading-relaxed">
                Define el nombre comercial de tu restaurante. Cero nombres quemados en el código fuente.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-ink-muted mb-1">Nombre Comercial de la Marca *</label>
                  <input
                    type="text"
                    required
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="Ej. TOCINETA"
                    className="w-full min-h-[48px] rounded-xl border border-border bg-surface px-3 text-sm text-ink outline-none focus:border-primary font-black uppercase"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-ink-muted mb-1">Eslogan de la Marca</label>
                  <input
                    type="text"
                    value={slogan}
                    onChange={(e) => setSlogan(e.target.value)}
                    placeholder="Cocinamos con amor y servimos como mereces"
                    className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-ink-muted mb-1">Registro Fiscal (RIF)</label>
                  <input
                    type="text"
                    value={rif}
                    onChange={(e) => setRif(e.target.value)}
                    placeholder="J-12345678-0"
                    className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-ink">
                <Icon name="MapPin" size={18} className="text-primary" />
                <h4 className="font-extrabold text-sm uppercase tracking-wide">Paso 2: Contacto y Sede Principal</h4>
              </div>
              <p className="text-ink-muted leading-relaxed">
                Datos de ubicación y teléfono de atención al cliente y pedidos por WhatsApp.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-ink-muted mb-1">Nombre de la Sede Principal</label>
                  <input
                    type="text"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder="Sede Alta Vista"
                    className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-ink-muted mb-1">Teléfono / WhatsApp Oficial</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="04249728209"
                    className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-ink-muted mb-1">Dirección Física del Local</label>
                  <textarea
                    rows={2}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Dirección detallada para tickets y delivery"
                    className="w-full rounded-xl border border-border bg-surface p-3 text-xs text-ink outline-none focus:border-primary resize-none"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-ink">
                <Icon name="Sliders" size={18} className="text-primary" />
                <h4 className="font-extrabold text-sm uppercase tracking-wide">Paso 3: Operaciones y Tasa</h4>
              </div>
              <p className="text-ink-muted leading-relaxed">
                Parámetros de cambio de tasa oficial y estilo visual.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-ink-muted mb-1">Hora de Notificación de Cambio de Tasa BCV</label>
                  <input
                    type="time"
                    value={rateChangeHour}
                    onChange={(e) => setRateChangeHour(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-mono font-bold"
                  />
                  <span className="text-[10px] text-ink-muted mt-1 block">Hora oficial en Venezuela donde el BCV suele actualizar la cotización.</span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-ink-muted mb-1">Color Corporativo de la Marca</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-12 h-12 rounded-xl border border-border cursor-pointer bg-surface p-1"
                    />
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-32 min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs font-mono font-bold text-ink"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-ink">
                <Icon name="CheckCircle" size={18} className="text-success" />
                <h4 className="font-extrabold text-sm uppercase tracking-wide">Paso 4: Confirmación y Puesta en Marcha</h4>
              </div>
              <p className="text-ink-muted leading-relaxed">
                Revisa los datos configurados antes de aplicar los cambios en todo el sistema.
              </p>

              <div className="p-4 rounded-2xl bg-surface-alt/60 border border-border space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-ink-muted">Marca:</span><strong className="text-ink">{businessName}</strong></div>
                <div className="flex justify-between"><span className="text-ink-muted">RIF:</span><strong className="text-ink font-mono">{rif}</strong></div>
                <div className="flex justify-between"><span className="text-ink-muted">Teléfono:</span><strong className="text-ink font-mono">{phone}</strong></div>
                <div className="flex justify-between"><span className="text-ink-muted">Sede:</span><strong className="text-ink">{locationName}</strong></div>
                <div className="flex justify-between"><span className="text-ink-muted">Tasa BCV:</span><strong className="text-ink">{rateChangeHour} hrs</strong></div>
              </div>
            </div>
          )}
        </div>

        {/* Footer con Navegación Guiada Siguiente / Siguiente */}
        <div className="p-4 border-t border-border flex items-center justify-between gap-3 bg-surface-alt/30">
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={step === 1}
            onClick={() => setStep(Math.max(1, step - 1))}
            className="min-h-[48px] px-4 font-bold"
            leftIcon={<Icon name="ChevronLeft" size={16} />}
          >
            Anterior
          </Button>

          {step < 4 ? (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => setStep(step + 1)}
              className="min-h-[48px] px-6 font-black"
              rightIcon={<Icon name="ChevronRight" size={16} />}
            >
              Siguiente
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={isSubmitting}
              onClick={handleFinish}
              className="min-h-[48px] px-6 font-black bg-success hover:bg-success/90"
              leftIcon={<Icon name="Check" size={18} />}
            >
              {isSubmitting ? 'Guardando...' : 'Aplicar Configuración'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
};
