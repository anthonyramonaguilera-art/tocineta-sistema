import type Database from 'better-sqlite3';
import PDFDocument from 'pdfkit';

/**
 * Generar Recibo de Liquidación en PDF (PDFKit)
 * Cumple con formato oficial TOCINETA en modo claro
 */
export function generateSettlementPdf(rawDb: Database.Database, settlementId: string): Promise<Buffer> {
  const settlement = rawDb.prepare(`
    SELECT s.*, u.name as employee_name, u.role as employee_role, u.cedula as employee_cedula,
           a.name as settled_by_name
    FROM staff_payroll_settlements s
    JOIN users u ON s.user_id = u.id
    JOIN users a ON s.settled_by_user_id = a.id
    WHERE s.id = ?
  `).get(settlementId) as any;

  if (!settlement) {
    throw new Error('Liquidación no encontrada');
  }

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Cabecera Oficial TOCINETA
      doc.font('Helvetica-Bold').fontSize(16).text('TOCINETA', { align: 'center' });
      doc.font('Helvetica').fontSize(10).fillColor('#666666')
        .text('SISTEMA DE GESTIÓN OPERATIVA Y FINANCIERA', { align: 'center' });
      doc.moveDown(0.5);

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000')
        .text('RECIBO OFICIAL DE LIQUIDACIÓN DE NÓMINA', { align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#666666')
        .text(`Identificador de Recibo: ${settlement.id}`, { align: 'center' });
      doc.moveDown(1);
      doc.fillColor('#000000');

      // Cuadro de Información del Trabajador
      doc.rect(40, doc.y, 515, 60).fillAndStroke('#F9FAFB', '#E5E7EB');
      const startBoxY = doc.y + 8;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827');
      doc.text(`Empleado: ${settlement.employee_name}`, 50, startBoxY);
      doc.font('Helvetica').text(`Cargo / Rol: ${settlement.employee_role.toUpperCase()}`, 50, startBoxY + 14);
      doc.text(`Cédula: ${settlement.employee_cedula || 'No registrada'}`, 50, startBoxY + 28);

      doc.font('Helvetica-Bold').text(`Período: ${settlement.frequency}`, 320, startBoxY);
      doc.font('Helvetica').text(`Fecha Emisión: ${new Date(settlement.created_at_ms).toLocaleDateString('es-VE')}`, 320, startBoxY + 14);
      doc.text(`Método: ${settlement.payment_method.replace('_', ' ')}`, 320, startBoxY + 28);
      doc.y = startBoxY + 50;
      doc.moveDown(1);

      // Desglose de Haberes y Deducciones
      doc.font('Helvetica-Bold').fontSize(10).text('DETALLE DE CONCEPTOS LIQUIDADOS:');
      doc.moveDown(0.5);

      const drawLine = (concept: string, amount: string, isDeduction = false) => {
        const y = doc.y;
        doc.font('Helvetica').fontSize(9).fillColor('#374151').text(concept, 50, y);
        doc.font(isDeduction ? 'Helvetica' : 'Helvetica-Bold')
          .fillColor(isDeduction ? '#DC2626' : '#16A34A')
          .text(amount, 450, y, { align: 'right', width: 90 });
        doc.y = y + 16;
      };

      drawLine('Salario Base del Período', `+$${(settlement.base_salary_usd_cents / 100).toFixed(2)}`);

      if (settlement.bonuses_usd_cents > 0) {
        drawLine('Bonificaciones y Gratificaciones', `+$${(settlement.bonuses_usd_cents / 100).toFixed(2)}`);
      }

      if (settlement.advances_usd_cents > 0) {
        drawLine('Adelantos y Vales Entregados', `-$${(settlement.advances_usd_cents / 100).toFixed(2)}`, true);
      }

      if (settlement.consumptions_charged_usd_cents > 0) {
        drawLine('Consumos Adicionales Cobrados', `-$${(settlement.consumptions_charged_usd_cents / 100).toFixed(2)}`, true);
      }

      if (settlement.consumptions_forgiven_usd_cents > 0) {
        drawLine('Consumos Perdonados / Cortesía (No descontados)', `$0.00 (Valor: $${(settlement.consumptions_forgiven_usd_cents / 100).toFixed(2)})`);
      }

      if (settlement.fixed_dinner_count > 0) {
        drawLine(`Cenas del Turno Asumidas por el Local (${settlement.fixed_dinner_count})`, `$0.00 (Gasto del Local)`);
      }

      doc.moveDown(0.5);
      doc.strokeColor('#E5E7EB').moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(0.5);

      // Total Neto
      doc.rect(40, doc.y, 515, 36).fillAndStroke('#FEF3C7', '#F59E0B');
      const totalY = doc.y + 10;
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#92400E').text('NETO A PAGAR:', 50, totalY);
      doc.fontSize(12).text(
        `$${(settlement.net_usd_cents / 100).toFixed(2)} USD  /  Bs. ${(settlement.net_bs_cents / 100).toFixed(2)}`,
        300, totalY, { align: 'right', width: 240 }
      );
      doc.y = totalY + 36;
      doc.moveDown(2);

      // Firmas
      const sigY = doc.y + 40;
      doc.strokeColor('#9CA3AF').moveTo(60, sigY).lineTo(220, sigY).stroke();
      doc.moveTo(340, sigY).lineTo(500, sigY).stroke();

      doc.font('Helvetica').fontSize(8).fillColor('#6B7280');
      doc.text(`Firma del Empleado:\n${settlement.employee_name}`, 60, sigY + 6, { align: 'center', width: 160 });
      doc.text(`Autorizado por:\n${settlement.settled_by_name} (Administración)`, 340, sigY + 6, { align: 'center', width: 160 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
