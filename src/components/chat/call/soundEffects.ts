/**
 * نغمات ومؤثرات صوتية نقية باستخدام Web Audio API دون الحاجة لملفات mp3 خارجية
 */
class SoundEffectsManager {
  private ctx: AudioContext | null = null;
  private ringtoneInterval: any = null;
  private ringbackInterval: any = null;

  private getAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    try {
      if (!this.ctx || this.ctx.state === "closed") {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === "suspended") {
        this.ctx.resume();
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  // تشغيل نغمة اتصال واردة ناعمة وفخمة (Melodic Chime)
  public startIncomingRingtone() {
    this.stopAll();
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const playChime = () => {
      try {
        const now = ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + idx * 0.12);

          gain.gain.setValueAtTime(0, now + idx * 0.12);
          gain.gain.linearRampToValueAtTime(0.2, now + idx * 0.12 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.35);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now + idx * 0.12);
          osc.stop(now + idx * 0.12 + 0.4);
        });
      } catch {}
    };

    playChime();
    this.ringtoneInterval = setInterval(playChime, 2200);
  }

  // تشغيل نغمة الاتصال الصادر (Standard Soft Ringback Tone)
  public startOutgoingRingback() {
    this.stopAll();
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const playBeep = () => {
      try {
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = "sine";
        osc1.frequency.setValueAtTime(440, now); // 440 Hz
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(480, now); // 480 Hz

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
        gain.gain.setValueAtTime(0.12, now + 1.2);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.35);
        osc2.stop(now + 1.35);
      } catch {}
    };

    playBeep();
    this.ringbackInterval = setInterval(playBeep, 3500);
  }

  // صوت نقرة انتهاء المكالمة
  public playCallEndSound() {
    this.stopAll();
    const ctx = this.getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.25);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.26);
    } catch {}
  }

  // إيقاف جميع النغمات
  public stopAll() {
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
    if (this.ringbackInterval) {
      clearInterval(this.ringbackInterval);
      this.ringbackInterval = null;
    }
  }
}

export const soundEffects = new SoundEffectsManager();
