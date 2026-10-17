/**
 * SISTEMA OPERATIVO LOCAL TOCINETA SONRÍE
 * Sintetizador Web Audio API para alertas sonoras de cocina (KDS).
 * 100% offline, cero dependencias externas ni archivos de audio remotos.
 */

class KdsSoundSynthesizer {
  private ctx: AudioContext | null = null;
  private soundEnabled = true;

  constructor() {
    // Cargar preferencia guardada
    try {
      const saved = localStorage.getItem('tocineta_kds_sound');
      if (saved !== null) {
        this.soundEnabled = saved === 'true';
      }
    } catch {}
  }

  private initContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public isEnabled(): boolean {
    return this.soundEnabled;
  }

  public setEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
    try {
      localStorage.setItem('tocineta_kds_sound', enabled ? 'true' : 'false');
    } catch {}
  }

  public toggle(): boolean {
    this.setEnabled(!this.soundEnabled);
    if (this.soundEnabled) {
      this.playNewOrderSound();
    }
    return this.soundEnabled;
  }

  /**
   * Doble pitido agudo al entrar comanda nueva (880 Hz)
   */
  public playNewOrderSound(): void {
    if (!this.soundEnabled) return;
    const ctx = this.initContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;

      // Beep 1
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.1);

      // Beep 2 (70ms después)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.17);
      gain2.gain.setValueAtTime(0.35, now + 0.17);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.27);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.17);
      osc2.stop(now + 0.27);
    } catch (err) {
      console.warn('Web Audio warning:', err);
    }
  }

  /**
   * Sonido urgente de alarma si entra una REPOSICIÓN SIN COBRO (Tono alternante agresivo)
   */
  public playRefireUrgentSound(): void {
    if (!this.soundEnabled) return;
    const ctx = this.initContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [
        { freq: 587, time: now, dur: 0.12 },
        { freq: 880, time: now + 0.14, dur: 0.12 },
        { freq: 587, time: now + 0.28, dur: 0.12 },
        { freq: 880, time: now + 0.42, dur: 0.2 }
      ];

      for (const n of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle'; // Mayor armónico para sonar más urgente
        osc.frequency.setValueAtTime(n.freq, n.time);
        gain.gain.setValueAtTime(0.4, n.time);
        gain.gain.exponentialRampToValueAtTime(0.01, n.time + n.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(n.time);
        osc.stop(n.time + n.dur);
      }
    } catch (err) {
      console.warn('Web Audio warning:', err);
    }
  }
}

export const kdsSound = new KdsSoundSynthesizer();
