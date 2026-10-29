import type { FastifyPluginAsync } from 'fastify';
import { ensureBusinessSettingsDefensive } from '../../db/business-settings.js';

export const businessSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  const rawDb = (fastify as any).rawDb;

  // 1. Obtener configuración integral del negocio
  fastify.get('/api/business-settings', async (_req, reply) => {
    try {
      const settings = ensureBusinessSettingsDefensive(rawDb);
      const locations = rawDb.prepare('SELECT * FROM locations WHERE is_active = 1 ORDER BY name ASC').all();
      const augmentedSettings = {
        ...settings,
        brandName: settings.business_name,
        businessName: settings.business_name,
        legalName: settings.business_name,
        slogan: settings.slogan,
        logoUrl: settings.logo_url,
        primaryColor: settings.primary_color,
        rif: settings.rif,
        phone: settings.phone,
        address: settings.address,
        rateChangeHour: settings.rate_change_hour,
        ticketHeaderMessage: settings.ticket_header_message,
        ticketFooterMessage: settings.ticket_footer_message,
        taxIvaEnabled: Boolean(settings.iva_enabled),
        taxIgtfEnabled: Boolean(settings.igtf_enabled),
        blindClosureEnabled: Boolean(settings.blind_closure_enabled),
        partnersModuleEnabled: Boolean(settings.partners_module_enabled),
        eventsQuoteEnabled: Boolean(settings.events_quote_enabled),
        onboardingCompleted: Boolean(settings.onboarding_completed),
        askTableOnOrder: Boolean(settings.ask_table_on_order),
        inventoryOperationMode: settings.inventory_operation_mode,
        inventory_operation_mode: settings.inventory_operation_mode,
        inventoryTrackingSinceMs: settings.inventory_tracking_since_ms,
        inventory_tracking_since_ms: settings.inventory_tracking_since_ms,
        ask_table_on_order: settings.ask_table_on_order ?? 0
      };

      return reply.send({
        success: true,
        settings: augmentedSettings,
        locations,
        ...augmentedSettings
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  });

  // 2. Actualizar configuración integral (PUT o PATCH)
  const updateSettingsHandler = async (req: any, reply: any) => {
    try {
      const b = req.body as any;
      const current = ensureBusinessSettingsDefensive(rawDb);
      const now = Date.now();

      const newBusinessName = b.business_name ?? b.businessName ?? b.brandName ?? current.business_name;
      const newSlogan = b.slogan ?? current.slogan;
      const newLogoUrl = b.logo_url !== undefined ? b.logo_url : (b.logoUrl !== undefined ? b.logoUrl : current.logo_url);
      const newPrimaryColor = b.primary_color ?? b.primaryColor ?? current.primary_color;
      const newRif = b.rif ?? current.rif;
      const newPhone = b.phone ?? current.phone;
      const newAddress = b.address ?? current.address;
      const newRateChangeHour = b.rate_change_hour ?? b.rateChangeHour ?? current.rate_change_hour;
      const newTicketHeader = b.ticket_header_message ?? b.ticketHeaderMessage ?? current.ticket_header_message;
      const newTicketFooter = b.ticket_footer_message ?? b.ticketFooterMessage ?? current.ticket_footer_message;
      
      const newIvaEnabled = b.iva_enabled !== undefined ? (b.iva_enabled ? 1 : 0) : (b.taxIvaEnabled !== undefined ? (b.taxIvaEnabled ? 1 : 0) : current.iva_enabled);
      const newIvaRateBps = b.iva_rate_bps !== undefined ? Number(b.iva_rate_bps) : (b.taxIvaPercent !== undefined ? Math.round(Number(b.taxIvaPercent) * 100) : current.iva_rate_bps);
      
      const newIgtfEnabled = b.igtf_enabled !== undefined ? (b.igtf_enabled ? 1 : 0) : (b.taxIgtfEnabled !== undefined ? (b.taxIgtfEnabled ? 1 : 0) : current.igtf_enabled);
      const newIgtfRateBps = b.igtf_rate_bps !== undefined ? Number(b.igtf_rate_bps) : (b.taxIgtfPercent !== undefined ? Math.round(Number(b.taxIgtfPercent) * 100) : current.igtf_rate_bps);
      const newIgtfAppliesTo = b.igtf_applies_to ?? current.igtf_applies_to;

      const newPartners = b.partners_module_enabled !== undefined ? (b.partners_module_enabled ? 1 : 0) : current.partners_module_enabled;
      const newQuotes = b.events_quote_enabled !== undefined ? (b.events_quote_enabled ? 1 : 0) : current.events_quote_enabled;
      const newOnboarding = b.onboarding_completed !== undefined ? (b.onboarding_completed ? 1 : 0) : current.onboarding_completed;
      const newBlind = b.blind_closure_enabled !== undefined ? (b.blind_closure_enabled ? 1 : 0) : (b.blindClosureEnabled !== undefined ? (b.blindClosureEnabled ? 1 : 0) : current.blind_closure_enabled);
      const newAskTable = b.ask_table_on_order !== undefined ? (b.ask_table_on_order ? 1 : 0) : (b.askTableOnOrder !== undefined ? (b.askTableOnOrder ? 1 : 0) : current.ask_table_on_order);

      const newInventoryMode = b.inventory_operation_mode ?? b.inventoryOperationMode ?? current.inventory_operation_mode;
      let newInventoryTrackingSince = current.inventory_tracking_since_ms;
      if (newInventoryMode === 'tracked' && (current.inventory_operation_mode !== 'tracked' || !current.inventory_tracking_since_ms)) {
        newInventoryTrackingSince = now;
      }
      if (b.inventory_tracking_since_ms !== undefined) {
        newInventoryTrackingSince = b.inventory_tracking_since_ms;
      }

      rawDb.prepare(`
        UPDATE business_settings
        SET business_name = ?,
            slogan = ?,
            logo_url = ?,
            primary_color = ?,
            rif = ?,
            phone = ?,
            address = ?,
            rate_change_hour = ?,
            ticket_header_message = ?,
            ticket_footer_message = ?,
            iva_enabled = ?,
            iva_rate_bps = ?,
            igtf_enabled = ?,
            igtf_rate_bps = ?,
            igtf_applies_to = ?,
            partners_module_enabled = ?,
            events_quote_enabled = ?,
            onboarding_completed = ?,
            blind_closure_enabled = ?,
            ask_table_on_order = ?,
            inventory_operation_mode = ?,
            inventory_tracking_since_ms = ?,
            updated_at_ms = ?
        WHERE id = 'default'
      `).run(
        newBusinessName,
        newSlogan,
        newLogoUrl,
        newPrimaryColor,
        newRif,
        newPhone,
        newAddress,
        newRateChangeHour,
        newTicketHeader,
        newTicketFooter,
        newIvaEnabled,
        newIvaRateBps,
        newIgtfEnabled,
        newIgtfRateBps,
        newIgtfAppliesTo,
        newPartners,
        newQuotes,
        newOnboarding,
        newBlind,
        newAskTable,
        newInventoryMode,
        newInventoryTrackingSince,
        now
      );

      const updated = ensureBusinessSettingsDefensive(rawDb);
      return reply.send({
        success: true,
        ok: true,
        settings: {
          ...updated,
          brandName: updated.business_name,
          businessName: updated.business_name,
          legalName: updated.business_name,
          slogan: updated.slogan,
          logoUrl: updated.logo_url,
          primaryColor: updated.primary_color,
          rif: updated.rif,
          phone: updated.phone,
          address: updated.address,
          rateChangeHour: updated.rate_change_hour,
          ticketHeaderMessage: updated.ticket_header_message,
          ticketFooterMessage: updated.ticket_footer_message,
          taxIvaEnabled: Boolean(updated.iva_enabled),
          taxIgtfEnabled: Boolean(updated.igtf_enabled),
          blindClosureEnabled: Boolean(updated.blind_closure_enabled),
          partnersModuleEnabled: Boolean(updated.partners_module_enabled),
          eventsQuoteEnabled: Boolean(updated.events_quote_enabled),
          onboardingCompleted: Boolean(updated.onboarding_completed),
          askTableOnOrder: Boolean(updated.ask_table_on_order),
          inventoryOperationMode: updated.inventory_operation_mode,
          inventory_operation_mode: updated.inventory_operation_mode,
          inventoryTrackingSinceMs: updated.inventory_tracking_since_ms,
          inventory_tracking_since_ms: updated.inventory_tracking_since_ms,
          ask_table_on_order: updated.ask_table_on_order ?? 0
        }
      });
    } catch (err: any) {
      return reply.status(400).send({ success: false, message: err.message });
    }
  };

  fastify.put('/api/business-settings', updateSettingsHandler);
  fastify.patch('/api/business-settings', updateSettingsHandler);

  // 3. Asistente de Primera Instalación (Onboarding Wizard)
  fastify.post('/api/business-settings/onboarding', async (req, reply) => {
    try {
      const b = req.body as {
        businessName: string;
        slogan?: string;
        rif?: string;
        phone?: string;
        address?: string;
        primaryColor?: string;
        rateChangeHour?: string;
        locationName?: string;
      };

      const now = Date.now();
      const current = ensureBusinessSettingsDefensive(rawDb);

      rawDb.transaction(() => {
        // Actualizar parámetros corporativos
        rawDb.prepare(`
          UPDATE business_settings
          SET business_name = ?,
              slogan = ?,
              rif = ?,
              phone = ?,
              address = ?,
              primary_color = ?,
              rate_change_hour = ?,
              onboarding_completed = 1,
              updated_at_ms = ?
          WHERE id = 'default'
        `).run(
          b.businessName?.trim() || current.business_name,
          b.slogan?.trim() || current.slogan,
          b.rif?.trim() || current.rif,
          b.phone?.trim() || current.phone,
          b.address?.trim() || current.address,
          b.primaryColor?.trim() || current.primary_color,
          b.rateChangeHour?.trim() || current.rate_change_hour,
          now
        );

        // Actualizar sede principal si se especifica
        if (b.locationName) {
          rawDb.prepare(`
            UPDATE locations
            SET name = ?, address = ?, phone = ?, updated_at_ms = ?
            WHERE id = 'loc_alta_vista'
          `).run(b.locationName.trim(), b.address?.trim() || null, b.phone?.trim() || null, now);
        }
      })();

      const updated = ensureBusinessSettingsDefensive(rawDb);
      return reply.send({
        success: true,
        message: 'Asistente de configuración completado con éxito.',
        settings: updated
      });
    } catch (err: any) {
      return reply.status(400).send({ success: false, message: err.message });
    }
  });
};
