import type { TicketIR } from '@tocineta/shared';
import PDFDocument from 'pdfkit';

/**
 * Normaliza el número de comanda a formato canónico '#EMG-001'
 */
export function formatSlipNumber(num: number | string): string {
  if (typeof num === 'string') {
    const cleaned = num.replace(/[^0-9]/g, '');
    const intVal = parseInt(cleaned, 10);
    if (!isNaN(intVal)) {
      return `#EMG-${String(intVal).padStart(3, '0')}`;
    }
    return num.startsWith('#') ? num : `#${num}`;
  }
  return `#EMG-${String(num).padStart(3, '0')}`;
}

/**
 * Genera la Representación Intermedia (Ticket IR) para una comanda física de emergencia
 * optimizada para impresión térmica de 58mm (32 columnas).
 */
export function buildEmergencySlipTicketIR(slipNum: number | string): TicketIR {
  const slipLabel = formatSlipNumber(slipNum);

  return {
    id: `emg_slip_${slipLabel.replace('#', '')}`,
    title: `Comanda de Emergencia ${slipLabel}`,
    widthColumns: 32,
    blocks: [
      { type: 'header_logo' },
      { type: 'title_double', text: 'TOCINETA', align: 'center' },
      { type: 'banner_inverted', text: `*** ${slipLabel} ***` },
      { type: 'text', text: 'COMANDA DE CONTINGENCIA', align: 'center', bold: true },
      { type: 'separator', style: 'double' },
      { type: 'key_value', key: 'FECHA:', value: '____/____/____' },
      { type: 'key_value', key: 'HORA:', value: '____:____' },
      { type: 'key_value', key: 'MESONERO:', value: '____________' },
      { type: 'key_value', key: 'MESA/CLI:', value: '____________' },
      { type: 'separator', style: 'dashed' },
      { type: 'text', text: 'TIPO DE PEDIDO:', bold: true },
      { type: 'text', text: '[ ] Salon  [ ] Llevar  [ ] Delivery' },
      { type: 'separator', style: 'single' },
      { type: 'text', text: 'PRODUCTO Y PERSONALIZACION:', bold: true },
      { type: 'text', text: '1. ____________________________' },
      { type: 'modifier_item', text: '[ ] Sin salsas  [ ] Barra Libre' },
      { type: 'text', text: '2. ____________________________' },
      { type: 'modifier_item', text: '[ ] Sin salsas  [ ] Barra Libre' },
      { type: 'text', text: '3. ____________________________' },
      { type: 'modifier_item', text: '[ ] Sin salsas  [ ] Barra Libre' },
      { type: 'text', text: 'BEBIDAS / SABORES:' },
      { type: 'text', text: '_______________________________' },
      { type: 'separator', style: 'double' },
      { type: 'key_value', key: 'TOTAL USD: $', value: '____________', bold: true },
      { type: 'key_value', key: 'TOTAL Bs:', value: '____________' },
      { type: 'separator', style: 'dashed' },
      { type: 'text', text: 'METODO DE PAGO:', bold: true },
      { type: 'text', text: '[ ] USD Efectivo   [ ] Bs Efectivo' },
      { type: 'text', text: '[ ] Pago Movil     [ ] Punto Ubii' },
      { type: 'text', text: '[ ] Binance' },
      { type: 'key_value', key: 'REF / COMP:', value: '____________' },
      { type: 'separator', style: 'single' },
      {
        type: 'footer',
        lines: [
          'TALONARIO OFICIAL DE EMERGENCIA',
          'Guardar comanda firmada.',
          'Transcribir al reanudar sistema.'
        ],
        align: 'center'
      },
      { type: 'cut', feedLines: 4 }
    ]
  };
}

/**
 * Genera el paquete de las 200 comandas numeradas de emergencia en formato Ticket IR
 */
export function buildAllEmergencySlipsTicketIR(count = 200): TicketIR[] {
  const slips: TicketIR[] = [];
  for (let i = 1; i <= count; i++) {
    slips.push(buildEmergencySlipTicketIR(i));
  }
  return slips;
}

/**
 * Genera un documento PDF imprimible en hojas Carta/A4 con las 200 comandas numeradas
 * organizadas en cuadrícula de 2 comandas por página con líneas de corte punteadas.
 */
export function generateEmergencySlipsPdf(totalCount = 200): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 25, bottom: 25, left: 25, right: 25 }
      });

      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      const slipsPerPage = 2;
      const totalPages = Math.ceil(totalCount / slipsPerPage);

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) doc.addPage();

        for (let slot = 0; slot < slipsPerPage; slot++) {
          const slipIndex = page * slipsPerPage + slot + 1;
          if (slipIndex > totalCount) break;

          const topY = slot === 0 ? 30 : 410;
          const height = 360;
          const leftX = 35;
          const rightX = 577;
          const width = rightX - leftX;

          // Marco de la comanda
          doc.rect(leftX, topY, width, height).lineWidth(1).stroke('#333333');

          // Encabezado
          doc.rect(leftX, topY, width, 40).fill('#111827');
          doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(14).text('TOCINETA', leftX + 15, topY + 8);
          doc.fontSize(9).font('Helvetica').text('TALONARIO DE CONTINGENCIA Y CORTE ELÉCTRICO', leftX + 15, topY + 24);

          // Número de Comanda destacado
          const slipTag = formatSlipNumber(slipIndex);
          doc.rect(rightX - 140, topY + 6, 125, 28).fill('#F59E0B');
          doc.fillColor('#000000').font('Helvetica-Bold').fontSize(14).text(slipTag, rightX - 135, topY + 13, { width: 115, align: 'center' });

          doc.fillColor('#000000');

          // Campos de cabecera
          const fieldY = topY + 50;
          doc.font('Helvetica-Bold').fontSize(9).text('FECHA: _______________', leftX + 15, fieldY);
          doc.text('HORA: ________', leftX + 180, fieldY);
          doc.text('MESONERO: _______________', leftX + 280, fieldY);
          doc.text('MESA/CLI: _______________', leftX + 430, fieldY);

          // Tipo de pedido
          doc.moveDown(0.5);
          const typeY = fieldY + 20;
          doc.font('Helvetica-Bold').fontSize(9).text('TIPO: ', leftX + 15, typeY);
          doc.font('Helvetica').text('[   ] Salón       [   ] Para Llevar       [   ] Delivery  (Dir / Telf: _________________________________________)', leftX + 55, typeY);

          // Línea divisoria
          doc.moveTo(leftX + 15, typeY + 16).lineTo(rightX - 15, typeY + 16).stroke('#CCCCCC');

          // Tabla de items
          const itemsY = typeY + 24;
          doc.font('Helvetica-Bold').fontSize(9).text('DETALLE DE PRODUCTOS Y PERSONALIZACIÓN (Marcar Barra Libre o ingredientes fuera):', leftX + 15, itemsY);

          const row1Y = itemsY + 16;
          doc.font('Helvetica').fontSize(9).text('1. ____________________________________________________________________  Salsas: [  ] Barra Libre  [  ] Sin salsas', leftX + 15, row1Y);
          const row2Y = row1Y + 18;
          doc.text('2. ____________________________________________________________________  Salsas: [  ] Barra Libre  [  ] Sin salsas', leftX + 15, row2Y);
          const row3Y = row2Y + 18;
          doc.text('3. ____________________________________________________________________  Salsas: [  ] Barra Libre  [  ] Sin salsas', leftX + 15, row3Y);
          const row4Y = row3Y + 18;
          doc.text('4. BEBIDAS / SABORES: ___________________________________________________________________________________________', leftX + 15, row4Y);

          // Línea divisoria
          doc.moveTo(leftX + 15, row4Y + 18).lineTo(rightX - 15, row4Y + 18).stroke('#CCCCCC');

          // Métodos de pago y Totales
          const payY = row4Y + 26;
          doc.font('Helvetica-Bold').fontSize(9).text('MÉTODO DE PAGO UTILIZADO:', leftX + 15, payY);
          doc.font('Helvetica').fontSize(9).text('[  ] USD Efectivo        [  ] Bs Efectivo        [  ] Pago Móvil        [  ] Punto Ubii        [  ] Binance', leftX + 15, payY + 16);
          doc.text('Referencia / Banco / Comprobante: __________________________________   Notas: ___________________________________', leftX + 15, payY + 34);

          // Cuadro de Totales
          const totalBoxY = payY + 54;
          doc.rect(leftX + 15, totalBoxY, 260, 32).fill('#F3F4F6');
          doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10).text('TOTAL USD: $ __________________', leftX + 25, totalBoxY + 10);

          doc.rect(leftX + 285, totalBoxY, 240, 32).fill('#F3F4F6');
          doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10).text('TOTAL Bs: ____________________', leftX + 295, totalBoxY + 10);

          // Pie de comanda
          doc.fillColor('#6B7280').font('Helvetica-Oblique').fontSize(8).text(
            'Documento de control físico oficial. Conservar firmado por cajera y mesonero. Cargar al sistema al reanudar servicio.',
            leftX + 15,
            topY + height - 16,
            { width: width - 30, align: 'center' }
          );

          // Línea punteada de corte entre comandas
          if (slot === 0) {
            doc.save();
            doc.dash(5, { space: 4 });
            doc.moveTo(20, 395).lineTo(592, 395).stroke('#9CA3AF');
            doc.restore();
          }
        }
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
