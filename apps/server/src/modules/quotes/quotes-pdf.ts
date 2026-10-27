import type Database from 'better-sqlite3';
import PDFDocument from 'pdfkit';
import { getEventQuotationById } from './quotes-service.js';
import { ensureBusinessSettingsDefensive } from '../../db/business-settings.js';

/**
 * Genera el documento PDF formal de cotización para entregar al cliente.
 * REGLA ESTRICTA: CERO costos internos, CERO márgenes privados.
 */
export function generateQuotationPdf(rawDb: Database.Database, quotationId: string): Promise<Buffer> {
  const quote = getEventQuotationById(rawDb, quotationId);
  if (!quote) {
    throw new Error('Cotización no encontrada');
  }

  const settings = ensureBusinessSettingsDefensive(rawDb);
  const storeName = settings.business_name || 'TOCINETA';

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // 1. Cabecera Comercial
      doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827').text(storeName, { align: 'left' });
      doc.font('Helvetica').fontSize(9).fillColor('#6B7280');
      doc.text(`RIF: ${settings.rif || 'V-17040918-0'}`);
      doc.text(`Teléfono: ${settings.phone || '04249728209'}`);
      doc.text(`Dirección: ${settings.address || 'Puerto Ordaz, Venezuela'}`);

      // Recuadro de Cotización N°
      doc.rect(380, 40, 175, 55).fillAndStroke('#F3F4F6', '#D1D5DB');
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#1F2937').text('COTIZACIÓN DE EVENTO', 390, 48);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#B45309').text(quote.quotation_number, 390, 64);
      doc.font('Helvetica').fontSize(8).fillColor('#4B5563')
        .text(`Fecha: ${new Date(quote.created_at_ms).toLocaleDateString('es-VE')}`, 390, 80);

      doc.moveDown(2);
      const customerBoxY = 115;

      // 2. Información del Evento y Cliente
      doc.rect(40, customerBoxY, 515, 65).fillAndStroke('#FFFFFF', '#E5E7EB');
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151');
      doc.text('DATOS DEL CLIENTE Y EVENTO:', 50, customerBoxY + 8);

      doc.font('Helvetica-Bold').text(`Cliente:`, 50, customerBoxY + 24);
      doc.font('Helvetica').text(quote.customer_name, 100, customerBoxY + 24);

      doc.font('Helvetica-Bold').text(`Teléfono:`, 50, customerBoxY + 38);
      doc.font('Helvetica').text(quote.customer_phone || 'No indicado', 100, customerBoxY + 38);

      doc.font('Helvetica-Bold').text(`Fecha Evento:`, 310, customerBoxY + 24);
      const eventDateStr = quote.event_date_ms ? new Date(quote.event_date_ms).toLocaleDateString('es-VE') : 'Por definir';
      doc.font('Helvetica').text(eventDateStr, 390, customerBoxY + 24);

      doc.font('Helvetica-Bold').text(`Lugar:`, 310, customerBoxY + 38);
      doc.font('Helvetica').text(quote.event_location || 'A convenir', 390, customerBoxY + 38);

      doc.font('Helvetica-Bold').text(`Invitados:`, 310, customerBoxY + 52);
      doc.font('Helvetica').text(`${quote.guest_count} personas`, 390, customerBoxY + 52);

      // 3. Tabla de Platos
      let tableY = customerBoxY + 85;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('DETALLE DEL MENÚ SELECCIONADO', 40, tableY);
      tableY += 16;

      // Encabezado de tabla
      doc.rect(40, tableY, 515, 20).fillAndStroke('#E5E7EB', '#D1D5DB');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#374151');
      doc.text('CANT', 50, tableY + 6);
      doc.text('DESCRIPCIÓN DEL PLATO', 90, tableY + 6);
      doc.text('PRECIO UNIT.', 380, tableY + 6, { width: 70, align: 'right' });
      doc.text('TOTAL USD', 470, tableY + 6, { width: 75, align: 'right' });
      tableY += 20;

      // Filas de platos
      doc.font('Helvetica').fontSize(9).fillColor('#1F2937');
      for (const item of quote.items) {
        doc.rect(40, tableY, 515, 20).fillAndStroke('#FFFFFF', '#F3F4F6');
        doc.text(String(item.quantity), 50, tableY + 5);
        doc.text(item.product_name, 90, tableY + 5);
        doc.text(`$${(item.unit_price_usd_cents / 100).toFixed(2)}`, 380, tableY + 5, { width: 70, align: 'right' });
        doc.text(`$${(item.subtotal_usd_cents / 100).toFixed(2)}`, 470, tableY + 5, { width: 75, align: 'right' });
        tableY += 20;
      }

      // 4. Servicios Extras si existen
      if (quote.extras && quote.extras.length > 0) {
        tableY += 10;
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('SERVICIOS Y COSTOS ADICIONALES', 40, tableY);
        tableY += 16;

        doc.rect(40, tableY, 515, 20).fillAndStroke('#E5E7EB', '#D1D5DB');
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#374151');
        doc.text('CATEGORÍA', 50, tableY + 6);
        doc.text('CONCEPTO', 150, tableY + 6);
        doc.text('TOTAL USD', 470, tableY + 6, { width: 75, align: 'right' });
        tableY += 20;

        doc.font('Helvetica').fontSize(9).fillColor('#1F2937');
        for (const ex of quote.extras) {
          doc.rect(40, tableY, 515, 20).fillAndStroke('#FFFFFF', '#F3F4F6');
          doc.text(ex.category, 50, tableY + 5);
          doc.text(ex.concept, 150, tableY + 5);
          doc.text(`$${(ex.price_usd_cents / 100).toFixed(2)}`, 470, tableY + 5, { width: 75, align: 'right' });
          tableY += 20;
        }
      }

      // 5. Totales y Resumen
      tableY += 15;
      const totalBoxY = tableY;
      doc.rect(320, totalBoxY, 235, 95).fillAndStroke('#F9FAFB', '#D1D5DB');

      doc.font('Helvetica').fontSize(9).fillColor('#4B5563');
      doc.text('Subtotal Alimentos:', 330, totalBoxY + 10);
      doc.text(`$${(quote.subtotal_food_usd_cents / 100).toFixed(2)}`, 460, totalBoxY + 10, { width: 85, align: 'right' });

      if (quote.discount_usd_cents > 0) {
        doc.font('Helvetica').fillColor('#DC2626');
        doc.text(`Descuento (${quote.discount_percent}%):`, 330, totalBoxY + 24);
        doc.text(`-$${(quote.discount_usd_cents / 100).toFixed(2)}`, 460, totalBoxY + 24, { width: 85, align: 'right' });
      }

      if (quote.extra_costs_usd_cents > 0) {
        doc.font('Helvetica').fillColor('#4B5563');
        doc.text('Servicios Extras:', 330, totalBoxY + 38);
        doc.text(`$${(quote.extra_costs_usd_cents / 100).toFixed(2)}`, 460, totalBoxY + 38, { width: 85, align: 'right' });
      }

      doc.rect(320, totalBoxY + 55, 235, 1).fill('#D1D5DB');

      doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827');
      doc.text('TOTAL COTIZADO:', 330, totalBoxY + 62);
      doc.text(`$${(quote.total_price_usd_cents / 100).toFixed(2)}`, 450, totalBoxY + 62, { width: 95, align: 'right' });

      doc.font('Helvetica-Bold').fontSize(9).fillColor('#2563EB');
      doc.text(`Equivalente en Bs:`, 330, totalBoxY + 78);
      doc.text(`Bs. ${(quote.totalPriceBsCents / 100).toFixed(2)}`, 440, totalBoxY + 78, { width: 105, align: 'right' });

      // Condiciones Comerciales
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#374151').text('CONDICIONES COMERCIALES:', 40, totalBoxY + 10);
      doc.font('Helvetica').fontSize(8).fillColor('#6B7280');
      doc.text('1. Presupuesto válido por 5 días calendario desde su emisión.', 40, totalBoxY + 24);
      doc.text('2. Para reservar la fecha se requiere un anticipo del 50%.', 40, totalBoxY + 36);
      doc.text('3. El saldo restante debe cancelarse 48 horas antes del evento.', 40, totalBoxY + 48);
      doc.text(`4. Tasa BCV aplicada: ${quote.rateFormatted} por USD.`, 40, totalBoxY + 60);

      if (quote.notes) {
        doc.moveDown(2);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text(`NOTAS ESPECIALES:`, 40, totalBoxY + 115);
        doc.font('Helvetica').fontSize(8).fillColor('#4B5563').text(quote.notes, 40, totalBoxY + 128);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
