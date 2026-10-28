import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Badge, Icon } from '../../ui/index.js';
import { OnboardingWizardModal } from './OnboardingWizardModal.js';
import { OperationalManualsModal } from './OperationalManualsModal.js';
import type { BusinessSettings, BusinessLocation } from './types.js';

export const BusinessSettingsView: React.FC = () => {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery<{
    success: boolean;
    settings: BusinessSettings;
    locations: BusinessLocation[];
  }>({
    queryKey: ['businessSettings'],
    queryFn: async () => {
      const res = await fetch('/api/business-settings');
      if (!res.ok) throw new Error('Error al cargar configuración');
      return res.json();
    },
    staleTime: 10000
  });

  const settings = data?.settings;
  const locations = data?.locations || [];

  const [businessName, setBusinessName] = useState(settings?.business_name || '');
  const [slogan, setSlogan] = useState(settings?.slogan || '');
  const [rif, setRif] = useState(settings?.rif || '');
  const [phone, setPhone] = useState(settings?.phone || '');
  const [address, setAddress] = useState(settings?.address || '');
  const [primaryColor, setPrimaryColor] = useState(settings?.primary_color || '#EAB308');
  const [rateChangeHour, setRateChangeHour] = useState(settings?.rate_change_hour || '13:00');
  const [ticketHeader, setTicketHeader] = useState(settings?.ticket_header_message || '¡BIENVENIDOS!');
  const [ticketFooter, setTicketFooter] = useState(settings?.ticket_footer_message || '¡GRACIAS POR SU PREFERENCIA! Dios le bendiga');
  const [ivaEnabled, setIvaEnabled] = useState(Boolean(settings?.iva_enabled));
  const [igtfEnabled, setIgtfEnabled] = useState(Boolean(settings?.igtf_enabled));
  const [partnersEnabled, setPartnersEnabled] = useState(Boolean(settings?.partners_module_enabled));
  const [eventsQuoteEnabled, setEventsQuoteEnabled] = useState(Boolean(settings?.events_quote_enabled ?? 1));
  const [askTableOnOrder, setAskTableOnOrder] = useState(Boolean(settings?.ask_table_on_order));

  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isManualsOpen, setIsManualsOpen] = useState(false);
  const [isSavedBanner, setIsSavedBanner] = useState(false);

  useEffect(() => {
    if (settings) {
      setBusinessName(settings.business_name || '');
      setSlogan(settings.slogan || '');
      setRif(settings.rif || '');
      setPhone(settings.phone || '');
      setAddress(settings.address || '');
      setPrimaryColor(settings.primary_color || '#EAB308');
      setRateChangeHour(settings.rate_change_hour || '13:00');
      setTicketHeader(settings.ticket_header_message || '¡BIENVENIDOS!');
      setTicketFooter(settings.ticket_footer_message || '¡GRACIAS POR SU PREFERENCIA! Dios le bendiga');
      setIvaEnabled(Boolean(settings.iva_enabled));
      setIgtfEnabled(Boolean(settings.igtf_enabled));
      setPartnersEnabled(Boolean(settings.partners_module_enabled));
      setEventsQuoteEnabled(Boolean(settings.events_quote_enabled));
      setAskTableOnOrder(Boolean(settings.ask_table_on_order));
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/business-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Error al guardar configuración');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businessSettings'] });
      setIsSavedBanner(true);
      setTimeout(() => setIsSavedBanner(false), 3000);
    }
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveMutation.mutateAsync({
      business_name: businessName.trim(), slogan: slogan.trim(), rif: rif.trim(),
      phone: phone.trim(), address: address.trim(), primary_color: primaryColor,
      rate_change_hour: rateChangeHour, ticket_header_message: ticketHeader.trim(),
      ticket_footer_message: ticketFooter.trim(), iva_enabled: ivaEnabled,
      igtf_enabled: igtfEnabled, partners_module_enabled: partnersEnabled,
      events_quote_enabled: eventsQuoteEnabled, ask_table_on_order: askTableOnOrder ? 1 : 0
    });
  };

  if (isLoading) {
    return <div className="text-center py-12 text-xs text-ink-muted">Cargando configuración del negocio...</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto select-none pb-12">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface p-5 rounded-2xl border border-border shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-ink tracking-tight">
              Configuración del Negocio
            </h1>
            <Badge variant="primary">MULTI-RESTAURANTE</Badge>
          </div>
          <p className="text-xs text-ink-muted mt-1">
            Personaliza el software para tu marca o franquicia. Cero nombres quemados en el código.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => setIsManualsOpen(true)}
            className="min-h-[48px] px-3.5 text-xs font-bold"
            leftIcon={<Icon name="BookOpen" size={16} />}
          >
            Manuales Operativos
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => setIsOnboardingOpen(true)}
            className="min-h-[48px] px-3.5 text-xs font-bold"
            leftIcon={<Icon name="Sparkles" size={16} />}
          >
            Asistente Inicial
          </Button>
        </div>
      </div>

      {isSavedBanner && (
        <div className="p-3.5 rounded-xl bg-success/15 border border-success/30 flex items-center gap-2 text-xs font-extrabold text-success animate-in fade-in duration-200">
          <Icon name="CheckCircle" size={18} />
          <span>Configuración guardada exitosamente y sincronizada en todo el sistema.</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* 1. Identidad Corporativa */}
        <Card variant="surface" className="p-5 border border-border space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <Icon name="Building2" size={18} className="text-primary" />
            <h3 className="font-extrabold text-sm text-ink uppercase tracking-wide">
              1. Identidad de Marca y Logo
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-ink-muted mb-1">Nombre Comercial de la Marca *</label>
              <input
                type="text"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="TOCINETA"
                className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-black uppercase"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-ink-muted mb-1">Registro de Información Fiscal (RIF)</label>
              <input
                type="text"
                value={rif}
                onChange={(e) => setRif(e.target.value)}
                placeholder="V-17040918-0"
                className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-mono font-bold"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-ink-muted mb-1">Eslogan Oficial</label>
              <input
                type="text"
                value={slogan}
                onChange={(e) => setSlogan(e.target.value)}
                placeholder="Cocinamos con amor y servimos como mereces"
                className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-medium"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-ink-muted mb-1">Color Corporativo</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-11 h-11 rounded-xl border border-border cursor-pointer bg-surface p-1"
                />
                <input
                  type="text"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-28 min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs font-mono font-bold text-ink"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* 2. Contacto y Sedes */}
        <Card variant="surface" className="p-5 border border-border space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <Icon name="MapPin" size={18} className="text-primary" />
            <h3 className="font-extrabold text-sm text-ink uppercase tracking-wide">
              2. Ubicación, Teléfono y Sedes
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-ink-muted mb-1">Teléfono / WhatsApp Oficial</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="04249728209"
                className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-mono font-bold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-ink-muted mb-1">Sedes Activas en Base de Datos</label>
              <div className="min-h-[44px] rounded-xl border border-border bg-surface-alt px-3 flex items-center justify-between text-xs">
                <span className="font-bold text-ink">{locations.length} Sedes registradas</span>
                <span className="text-[10px] text-ink-muted font-bold uppercase">{locations.map(l => l.name).join(', ')}</span>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-ink-muted mb-1">Dirección Física para Tickets y Despacho</label>
              <textarea
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface p-2.5 text-xs text-ink outline-none focus:border-primary resize-none font-medium"
              />
            </div>
          </div>
        </Card>

        {/* 3. Operaciones y Tickets Térmicos */}
        <Card variant="surface" className="p-5 border border-border space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <Icon name="Printer" size={18} className="text-primary" />
            <h3 className="font-extrabold text-sm text-ink uppercase tracking-wide">
              3. Mensajes en Ticket Térmico y Tasa
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-ink-muted mb-1">Hora de Notificación de Cambio de Tasa BCV</label>
              <input
                type="time"
                value={rateChangeHour}
                onChange={(e) => setRateChangeHour(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-mono font-bold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-ink-muted mb-1">Mensaje de Cabecera en Comanda</label>
              <input
                type="text"
                value={ticketHeader}
                onChange={(e) => setTicketHeader(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-bold"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-ink-muted mb-1">Mensaje de Agradecimiento (Pie de Ticket)</label>
              <input
                type="text"
                value={ticketFooter}
                onChange={(e) => setTicketFooter(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary"
              />
            </div>
          </div>
        </Card>

        {/* 4. Impuestos y Módulos Opcionales */}
        <Card variant="surface" className="p-5 border border-border space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <Icon name="Sliders" size={18} className="text-primary" />
            <h3 className="font-extrabold text-sm text-ink uppercase tracking-wide">
              4. Impuestos y Módulos del Sistema
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            {/* IVA */}
            <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border flex items-center justify-between">
              <div>
                <span className="font-extrabold text-ink block">Módulo IVA (16%)</span>
                <span className="text-[11px] text-ink-muted">Apagado por defecto para comida rápida.</span>
              </div>
              <input type="checkbox" checked={ivaEnabled} onChange={(e) => setIvaEnabled(e.target.checked)} className="w-5 h-5 rounded cursor-pointer accent-primary" />
            </div>

            {/* IGTF */}
            <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border flex items-center justify-between">
              <div>
                <span className="font-extrabold text-ink block">Módulo IGTF (3%)</span>
                <span className="text-[11px] text-ink-muted">Apagado por defecto.</span>
              </div>
              <input type="checkbox" checked={igtfEnabled} onChange={(e) => setIgtfEnabled(e.target.checked)} className="w-5 h-5 rounded cursor-pointer accent-primary" />
            </div>

            {/* Socios */}
            <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border flex items-center justify-between">
              <div>
                <span className="font-extrabold text-ink block">Módulo de Socios</span>
                <span className="text-[11px] text-ink-muted">Aportes y reparto por porcentaje.</span>
              </div>
              <input type="checkbox" checked={partnersEnabled} onChange={(e) => setPartnersEnabled(e.target.checked)} className="w-5 h-5 rounded cursor-pointer accent-primary" />
            </div>

            {/* Cotizador */}
            <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border flex items-center justify-between">
              <div>
                <span className="font-extrabold text-ink block">Cotizador de Eventos</span>
                <span className="text-[11px] text-ink-muted">Presupuestos y simulador de compras.</span>
              </div>
              <input type="checkbox" checked={eventsQuoteEnabled} onChange={(e) => setEventsQuoteEnabled(e.target.checked)} className="w-5 h-5 rounded cursor-pointer accent-primary" />
            </div>

            {/* Solicitar mesa al tomar pedido */}
            <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border flex items-center justify-between sm:col-span-2">
              <div>
                <span className="font-extrabold text-ink block">Solicitar mesa al tomar pedido</span>
                <span className="text-[11px] text-ink-muted">Habilita selector de mesa para servicio en salón ("Comer aquí").</span>
              </div>
              <input type="checkbox" checked={askTableOnOrder} onChange={(e) => setAskTableOnOrder(e.target.checked)} className="w-5 h-5 rounded cursor-pointer accent-primary" />
            </div>
          </div>
        </Card>

        {/* Botón Guardar Principal */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={saveMutation.isPending}
            className="min-h-[52px] px-8 font-black text-sm shadow-md"
            leftIcon={<Icon name="Save" size={20} />}
          >
            {saveMutation.isPending ? 'Guardando Ajustes...' : 'Guardar Configuración Integral'}
          </Button>
        </div>
      </form>

      {/* Modal Asistente Inicial */}
      <OnboardingWizardModal
        isOpen={isOnboardingOpen}
        currentSettings={settings || null}
        onClose={() => setIsOnboardingOpen(false)}
        onSuccess={() => refetch()}
      />

      {/* Modal Manuales Operativos de 1 Página */}
      <OperationalManualsModal
        isOpen={isManualsOpen}
        onClose={() => setIsManualsOpen(false)}
      />
    </div>
  );
};

export default BusinessSettingsView;
