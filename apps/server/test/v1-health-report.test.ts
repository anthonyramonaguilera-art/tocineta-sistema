import { describe, it, expect } from 'vitest';
import {
  formatDailyMessage,
  validateChatTarget,
  type HealthReport
} from '../../scripts/health-report.js';

describe('V-1: Generador local de salud y validación de destinatario', () => {
  describe('validateChatTarget', () => {
    it('rechaza si botId === chatId', () => {
      const resNum = validateChatTarget(123456789, '123456789');
      expect(resNum.ok).toBe(false);
      expect(resNum.reason).toBe('El destino de avisos apunta a un bot; use su ID personal');

      const resStr = validateChatTarget('987654321', '987654321');
      expect(resStr.ok).toBe(false);
      expect(resStr.reason).toBe('El destino de avisos apunta a un bot; use su ID personal');

      const resTrim = validateChatTarget(' 555666 ', '555666');
      expect(resTrim.ok).toBe(false);
      expect(resTrim.reason).toBe('El destino de avisos apunta a un bot; use su ID personal');
    });

    it('rechaza si chatId está vacío', () => {
      const resEmpty = validateChatTarget('123456789', '');
      expect(resEmpty.ok).toBe(false);
      expect(resEmpty.reason).toBe('El destino de avisos apunta a un bot; use su ID personal');

      const resWhitespace = validateChatTarget('123456789', '   ');
      expect(resWhitespace.ok).toBe(false);
      expect(resWhitespace.reason).toBe('El destino de avisos apunta a un bot; use su ID personal');

      const resUndefined = validateChatTarget('123456789', undefined);
      expect(resUndefined.ok).toBe(false);
      expect(resUndefined.reason).toBe('El destino de avisos apunta a un bot; use su ID personal');

      const resNull = validateChatTarget('123456789', null);
      expect(resNull.ok).toBe(false);
      expect(resNull.reason).toBe('El destino de avisos apunta a un bot; use su ID personal');
    });

    it('aprueba si el ID personal es distinto al del bot', () => {
      const resUser = validateChatTarget(123456789, '987654321');
      expect(resUser.ok).toBe(true);
      expect(resUser.reason).toBeUndefined();

      const resChannel = validateChatTarget('123456789', '-1001234567890');
      expect(resChannel.ok).toBe(true);
      expect(resChannel.reason).toBeUndefined();
    });
  });

  describe('formatDailyMessage', () => {
    it('formatea correctamente con respaldo exitoso', () => {
      const report: HealthReport = {
        version: '1.2.0',
        dbSizeMb: 4.5,
        closedJornadasCount: 15,
        openJornada: true,
        serverErrors24h: 0,
        lastBackup: {
          atMs: Date.parse('2026-11-02T10:00:00Z'),
          ok: true
        },
        diskFreeGb: 45.2,
        logsRecientes: true
      };

      const msg = formatDailyMessage(report);
      expect(msg).toContain('TOCINETA activo.');
      expect(msg).toContain('Versión 1.2.0.');
      expect(msg).toContain('Jornadas cerradas: 15.');
      expect(msg).toContain('Último respaldo:');
      expect(msg).toContain('(exitoso)');
      expect(msg).toContain('Errores 24 h: 0.');
      expect(msg).toContain('Disco libre: 45.2 GB');
    });

    it('formatea correctamente sin respaldo previo', () => {
      const report: HealthReport = {
        version: '1.2.0',
        dbSizeMb: 3.2,
        closedJornadasCount: 5,
        openJornada: false,
        serverErrors24h: 0,
        lastBackup: null,
        diskFreeGb: 20.0,
        logsRecientes: false
      };

      const msg = formatDailyMessage(report);
      expect(msg).toContain('TOCINETA activo.');
      expect(msg).toContain('Versión 1.2.0.');
      expect(msg).toContain('Jornadas cerradas: 5.');
      expect(msg).toContain('Último respaldo: sin respaldo previo.');
      expect(msg).toContain('Errores 24 h: 0.');
      expect(msg).toContain('Disco libre: 20 GB');
    });

    it('formatea correctamente con errores', () => {
      const report: HealthReport = {
        version: '1.2.0',
        dbSizeMb: 5.1,
        closedJornadasCount: 8,
        openJornada: false,
        serverErrors24h: 3,
        lastBackup: {
          atMs: Date.parse('2026-11-02T10:00:00Z'),
          ok: false,
          error: 'Conexión timeout con Telegram'
        },
        diskFreeGb: 15.0,
        logsRecientes: true
      };

      const msg = formatDailyMessage(report);
      expect(msg).toContain('TOCINETA activo.');
      expect(msg).toContain('Versión 1.2.0.');
      expect(msg).toContain('Jornadas cerradas: 8.');
      expect(msg).toContain('Último respaldo:');
      expect(msg).toContain('fallido');
      expect(msg).toContain('Conexión timeout con Telegram');
      expect(msg).toContain('Errores 24 h: 3.');
      expect(msg).toContain('Disco libre: 15 GB');
    });
  });
});
