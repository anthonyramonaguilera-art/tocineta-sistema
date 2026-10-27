/**
 * SISTEMA OPERATIVO TOCINETA — MÓDULO DE IMPRESIÓN Y PDF DE DESPACHOS
 * Generación de PDF local con PDFKit y Ticket IR para impresora térmica 58mm.
 */

import PDFDocument from 'pdfkit';
import type { TicketIR, TicketBlock } from '@tocineta/shared';

export interface DispatchNoteData {
  dispatchNoteCode: string;
  fromLocationName: string;
  toLocationName: string;
  status: string;
  mode: string;
  createdAtMs: number;
  createdByName: string;
  receivedByName?: string | null;
  receivedAtMs?: number | null;
  items: Array<{
    supplyId: string;
    supplyName: string;
    quantity: number;
    unit: string;
  }>;
  dishEquivalents?: Array<{
    productId: string;
    productName?: string;
    quantity: number;
  }> | null;
  forcedWithPin?: boolean;
  forceReason?: string | null;
  notes?: string | null;
}

/**
 * 1. Genera el buffer PDF oficial de la Nota de Despacho (100% local con PDFKit)
 */
export function generateDispatchNotePdf(data: DispatchNoteData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      const dateStr = new Date(data.createdAtMs).toLocaleString('es-VE', {
        timeZone: 'America/Caracas',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      // Cabecera
      doc.fontSize(22).font('Helvetica-Bold').text('TOCINETA', { align: 'center' });
      doc.fontSize(14).font('Helvetica-Bold').text('NOTA DE DESPACHO INTER-SEDES', { align: 'center' });
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#b91c1c').text(data.dispatchNoteCode, { align: 'center' });
      doc.fillColor('#000000');
      doc.moveDown(0.8);

      // Metadatos
      doc.fontSize(10).font('Helvetica-Bold').text('INFORMACIÓN DE TRASLADO:');
      doc.font('Helvetica').fontSize(10);
      doc.text(`Fecha y Hora: ${dateStr}`);
      doc.text(`Sede Origen: ${data.fromLocationName || (data as any).from_location_id || 'SEDE A'}`);
      doc.text(`Sede Destino: ${data.toLocationName || (data as any).to_location_id || 'SEDE B'}`);
      doc.text(`Estado del Envío: ${data.status || 'COMPLETADO'}`);
      doc.text(`Despachado por: ${data.createdByName || (data as any).created_by_user_id || 'OPERADOR'}`);
      if (data.receivedByName) {
        doc.text(`Recibido por: ${data.receivedByName}`);
      }
      if (data.notes) {
        doc.text(`Observaciones: ${data.notes}`);
      }

      if (data.forcedWithPin) {
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').fillColor('#c2410c');
        doc.text(`AVISO: DESPACHO AUTORIZADO CON PIN POR STOCK INSUFICIENTE`);
        doc.font('Helvetica').text(`Motivo registrado: ${data.forceReason || 'No especificado'}`);
        doc.fillColor('#000000');
      }

      if (data.dishEquivalents && data.dishEquivalents.length > 0) {
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').text('EQUIVALENCIA DE PLATOS PREPARADOS:');
        doc.font('Helvetica');
        const eqStr = data.dishEquivalents.map(d => `${d.quantity}x ${d.productName || (d as any).dishName || d.productId}`).join('  |  ');
        doc.text(eqStr);
      }

      doc.moveDown(1);
      doc.font('Helvetica-Bold').fontSize(11).text('DETALLE DE INSUMOS DESPACHADOS:');
      doc.moveDown(0.3);

      // Tabla de ítems
      const tableTop = doc.y;
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('CANTIDAD', 40, tableTop);
      doc.text('UNIDAD', 120, tableTop);
      doc.text('INSUMO / MATERIA PRIMA', 200, tableTop);
      doc.moveDown(0.4);

      doc.strokeColor('#cccccc').lineWidth(1).moveTo(40, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.4);

      doc.font('Helvetica').fontSize(10);
      for (const itm of data.items) {
        const y = doc.y;
        if (y > 700) {
          doc.addPage();
        }
        doc.text(String(itm.quantity), 40, doc.y);
        doc.text(itm.unit, 120, y);
        doc.text(itm.supplyName, 200, y);
        doc.moveDown(0.5);
      }

      doc.moveDown(1);
      doc.strokeColor('#cccccc').lineWidth(1).moveTo(40, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(2);

      // Firmas
      const signY = doc.y;
      doc.fontSize(9).font('Helvetica');
      doc.text('_____________________________________', 50, signY);
      doc.text('Firma y Cédula Sede Origen (Despacho)', 50, signY + 15);

      doc.text('_____________________________________', 330, signY);
      doc.text('Firma y Cédula Sede Destino (Recepción)', 330, signY + 15);

      doc.moveDown(4);
      doc.fontSize(8).fillColor('#666666').text('Documento oficial generado por Sistema Operativo Gastronómico TOCINETA.', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * 2. Genera el Ticket IR para impresión térmica de 58mm (32 columnas)
 */
export function buildDispatchNoteTicketIR(data: DispatchNoteData): TicketIR {
  const blocks: TicketBlock[] = [
    { type: 'header_logo' },
    { type: 'title_double', text: 'TOCINETA', align: 'center' },
    { type: 'text', text: 'NOTA DE DESPACHO', bold: true, align: 'center' },
    { type: 'banner_inverted', text: data.dispatchNoteCode },
    { type: 'separator', style: 'dashed' },
    { type: 'key_value', key: 'Origen:', value: (data.fromLocationName || (data as any).from_location_id || 'SEDE A').slice(0, 18) },
    { type: 'key_value', key: 'Destino:', value: (data.toLocationName || (data as any).to_location_id || 'SEDE B').slice(0, 18) },
    { type: 'key_value', key: 'Estado:', value: data.status || 'COMPLETADO' },
    { type: 'key_value', key: 'Despacha:', value: (data.createdByName || (data as any).created_by_user_id || 'OPERADOR').slice(0, 18) }
  ];

  if (data.dishEquivalents && data.dishEquivalents.length > 0) {
    blocks.push({ type: 'separator', style: 'single' });
    blocks.push({ type: 'text', text: 'EQUIVALENTE PLATOS:', bold: true });
    for (const d of data.dishEquivalents) {
      blocks.push({ type: 'text', text: ` ${d.quantity}x ${d.productName || (d as any).dishName || d.productId}` });
    }
  }

  blocks.push({ type: 'separator', style: 'double' });
  blocks.push({ type: 'text', text: 'INSUMOS ENVIADOS:', bold: true });

  for (const itm of data.items) {
    blocks.push({
      type: 'line_item',
      qty: itm.quantity,
      name: `${itm.supplyName} (${itm.unit})`
    });
  }

  if (data.forcedWithPin) {
    blocks.push({ type: 'separator', style: 'dashed' });
    blocks.push({ type: 'text', text: '* AUTORIZADO CON PIN *', bold: true, align: 'center' });
    if (data.forceReason) {
      blocks.push({ type: 'text', text: `Motivo: ${data.forceReason.slice(0, 30)}` });
    }
  }

  blocks.push({ type: 'separator', style: 'single' });
  blocks.push({
    type: 'footer',
    lines: [
      'Entregado por: _________________',
      'Recibido por:  _________________',
      'TOCINETA Sistema de Traslados'
    ],
    align: 'left'
  });
  blocks.push({ type: 'cut', feedLines: 4 });

  return {
    title: `Despacho ${data.dispatchNoteCode}`,
    widthColumns: 32,
    blocks
  };
}

/**
 * 3. Formato de texto para compartir por WhatsApp
 */
export function buildWhatsAppTransferText(data: DispatchNoteData): string {
  const lines: string[] = [
    `*TOCINETA — NOTA DE DESPACHO ${data.dispatchNoteCode}*`,
    `📍 *Origen:* ${data.fromLocationName || (data as any).from_location_id || 'SEDE A'}`,
    `🏁 *Destino:* ${data.toLocationName || (data as any).to_location_id || 'SEDE B'}`,
    `📦 *Estado:* ${data.status || 'COMPLETADO'}`,
    `👤 *Despachó:* ${data.createdByName || (data as any).created_by_user_id || 'OPERADOR'}`,
    ''
  ];

  if (data.dishEquivalents && data.dishEquivalents.length > 0) {
    lines.push('*Equivalencia de platos:*');
    data.dishEquivalents.forEach(d => {
      lines.push(`• ${d.quantity}x ${d.productName || (d as any).dishName || d.productId}`);
    });
    lines.push('');
  }

  lines.push('*Insumos Despachados:*');
  data.items.forEach(itm => {
    lines.push(`• *${itm.quantity} ${itm.unit}* — ${itm.supplyName}`);
  });

  if (data.notes) {
    lines.push('');
    lines.push(`📝 *Nota:* ${data.notes}`);
  }

  if (data.forcedWithPin) {
    lines.push('');
    lines.push(`⚠️ *Autorizado con PIN Supervisor:* ${data.forceReason}`);
  }

  return lines.join('\n');
}

export const generateDispatchNotePdfBuffer = generateDispatchNotePdf;
export const generateDispatchNoteWhatsAppText = buildWhatsAppTransferText;
