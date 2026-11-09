/**
 * BrowserAliveKeeper — v2 (Background-Proof)
 * ═══════════════════════════════════════════════════════════════════════
 * يبقي التبويب فعّالاً بالكامل حتى في الخلفية عبر 5 طبقات مستقلة:
 *
 *  1. <audio> حقيقي صامت في حلقة — الطبقة الأهم:
 *     iOS Safari يعلّق WebAudio وجميع المؤقتات في الخلفية، لكن يشغّل
 *     الوسائط الحقيقية بكامل قوتها (كأنه تطبيق مشغّل موسيقى).
 *     ملف WAV صامت مُولَّد وقتياً في حلقة مفتوحة = خيط JS لا يتجمّد أبداً.
 *
 *  2. MediaSession API — نُعلن playbackState="playing" لنظام التشغيل،
 *     فيعامل التبويب كتطبيق وسائط نشط (معفى من Doze/tab-freezing على
 *     Android Chrome ومن تعليق العمليات على iOS).
 *
 *  3. AudioContext (oscillator 18.75kHz + gain فائق الانخفاض) — تردد
 *     خارج نطاق السمع البشري لكن المتصفح يعدّه "مسموعاً" فيُعفى التبويب
 *     من Intensive Timer Throttling على Chrome بعد 5 دقائق في الخلفية.
 *     مع حارس زمني يستأنفه تلقائياً إذا علّقه المتصفح.
 *
 *  4. Web Locks API — قفل مشترك معلّق يمنع Chrome/Edge من فريز الصفحة.
 *
 *  5. Heartbeat لا ي trusts setInterval — يقيس الانجراف بنفسه (Date.now)
 *     ويُطلق onTick حتى لو خنّق المتصفح المؤقتات، ليستخدمه أي طرف لإرسال
 *     ping_keepalive للسوكت.
 *
 * الاستخدام:
 *   browserAliveKeeper.start();   // بعد أول تفاعل (أو تلقائياً عند وجود focus)
 *   browserAliveKeeper.onTick(cb) // نبضة كل ~15 ثانية (مثال: ping_keepalive)
 *   browserAliveKeeper.stop();    // عند تسجيل الخروج
 */

// ─── ثوابت ───────────────────────────────────────────────────────────────────
const HEARTBEAT_TARGET_MS = 15_000;   // الهدف النظري للنبضة
const WATCHDOG_MS         = 8_000;    // فحص حالة الصوت
const SILENCE_SECONDS     = 1;        // طول مقطع الصمت في الحلقة
const SILENCE_SAMPLE_RATE = 8_000;    // 8kHz كافية لملف صغير
const OSC_FREQ_HZ         = 18_750;   // خارج نطاق السمع (>17kHz للبالغين)
const OSC_GAIN            = 0.002;    // شبه معدوم لكنه "مسموع" للمتصفح

type TickCallback = (driftMs: number) => void;

class BrowserAliveKeeper {
  // WebAudio
  private audioCtx: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;

  // عنصر وسائط حقيقي (الحارس الأساسي للخلفية)
  private silentAudio: HTMLAudioElement | null = null;
  private silentAudioUrl: string | null = null;

  // مؤقتات
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTickAt = 0;

  // Web Locks
  private lockAbortController: AbortController | null = null;

  // Wake Lock
  private wakeLock: WakeLockSentinel | null = null;

  // حالة
  private started = false;
  private gestureBound = false;
  private tickSubscribers = new Set<TickCallback>();

  // ═════════════════════════ API العام ═════════════════════════

  /** اشترك في نبضات الحارس (كل ~15 ثانية نظرياً؛ قد تتأخر عند الاختناق) */
  onTick(cb: TickCallback): () => void {
    this.tickSubscribers.add(cb);
    return () => { this.tickSubscribers.delete(cb); };
  }

  /** بدء جميع طبقات منع التجميد */
  start(): void {
    if (this.started) return;
    this.started = true;

    this._bindUserInteraction();
    this._startWebLock();
    this._startAudioElement();
    this._startWebAudio();
    this._startMediaSession();
    this._startWatchdog();
    this._startHeartbeat();
    this._bindLifecycleHandlers();

    console.log("[BrowserAliveKeeper] started ✓ (5 layers)");
  }

  /** إيقاف كل الآليات (عند تسجيل الخروج) */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    this._stopAudioElement();
    this._stopAudio();
    this._stopWebLock();
    this._releaseWakeLock();

    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
    if (this.tickTimer) { clearTimeout(this.tickTimer); this.tickTimer = null; }

    this._clearMediaSession();

    document.removeEventListener("click",      this._onUserInteraction);
    document.removeEventListener("touchstart", this._onUserInteraction);
    document.removeEventListener("keydown",    this._onUserInteraction);
    document.removeEventListener("pointerdown",this._onUserInteraction);
    document.removeEventListener("visibilitychange", this._onVisibilityChange);

    console.log("[BrowserAliveKeeper] stopped ✓");
  }

  // ═══════════════ الطبقة 1: وسائط حقيقية صامتة ═══════════════

  /**
   * يولّد ملف WAV صامتاً تماماً وقتياً (بنية RIFF نظيفة) ويشغّله في حلقة.
   * هذه هي الطريقة الوحيدة الموثوقة لمنع iOS Safari من تجميد JS في الخلفية،
   * لأن مشغّل الوسائط الحقيقي يبقى نشطاً (نظام يتعامل معه كموسيقى تعمل).
   */
  private _startAudioElement(): void {
    if (this.silentAudio) return;
    try {
      this.silentAudioUrl = this._createSilentWavUrl();
      const audio = document.createElement("audio");

      audio.src        = this.silentAudioUrl;
      audio.loop       = true;
      audio.preload    = "auto";
      audio.volume     = 1;          // الصمت في محتوى الملف نفسه، لا بمستوى الصوت
      (audio as any).playsInline = true;
      audio.setAttribute("aria-hidden", "true");
      audio.style.display = "none";

      // إخفاؤه من قائمة "يشغّل الوسائط" قدر الإمكان دون كتم النظام
      (audio as any).disableRemotePlayback = true;

      this.silentAudio = audio;
      document.body.appendChild(audio);

      // محاولة تفعيل فورية (قد تفشل قبل تفاعل المستخدم — الحارس يعيد المحاولة)
      audio.play().catch(() => {
        // التوكنليس — سيعيد الحارس المحاولة لاحقاً بعد أول تفاعل
      });
    } catch (e) {
      console.warn("[BrowserAliveKeeper] silent audio unavailable:", e);
    }
  }

  private _createSilentWavUrl(): string {
    const numSamples = SILENCE_SECONDS * SILENCE_SAMPLE_RATE;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeStr = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };

    // RIFF header — PCM 16-bit mono
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);                    // حجم كتلة fmt
    view.setUint16(20, 1, true);                     // PCM
    view.setUint16(22, 1, true);                     // mono
    view.setUint32(24, SILENCE_SAMPLE_RATE, true);
    view.setUint32(28, SILENCE_SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);                     // block align
    view.setUint16(34, 16, true);                    // bits per sample
    writeStr(36, "data");
    view.setUint32(40, numSamples * 2, true);
    // عينات = 0 إفتراضياً (ArrayBuffer مهيأ بالصفر) = صمت تام

    const blob = new Blob([buffer], { type: "audio/wav" });
    return URL.createObjectURL(blob);
  }

  private _stopAudioElement(): void {
    try {
      if (this.silentAudio) {
        this.silentAudio.pause();
        this.silentAudio.removeAttribute("src");
        this.silentAudio.remove();
      }
      if (this.silentAudioUrl) URL.revokeObjectURL(this.silentAudioUrl);
    } catch (_) { /* تجاهل */ }
    this.silentAudio = null;
    this.silentAudioUrl = null;
  }

  // ═══════════════ الطبقة 2: MediaSession ═══════════════

  /** يعلن لنظام التشغيل أن التبويب يشغّل وسائط → معاملة تطبيق وسائط نشط */
  private _startMediaSession(): void {
    try {
      const ms = (navigator as any).mediaSession;
      if (!ms) return;

      ms.metadata = new (window as any).MediaMetadata({
        title:  "DIAD ENGINE",
        artist: "Realtime Session",
        album:  "Background Keepalive",
      });
      ms.playbackState = "playing";

      // نحتضن أزرار النظام: أي play/pause يعيد الحارس للعمل بدل تعطيله
      try { ms.setActionHandler("play",  () => this._reviveMedia()); } catch (_) {}
      try { ms.setActionHandler("pause", () => this._reviveMedia()); } catch (_) {}
    } catch (_) { /* غير مدعوم */ }
  }

  private _clearMediaSession(): void {
    try {
      const ms = (navigator as any).mediaSession;
      if (!ms) return;
      ms.playbackState = "none";
      try { ms.setActionHandler("play",  null); } catch (_) {}
      try { ms.setActionHandler("pause", null); } catch (_) {}
    } catch (_) {}
  }

  private _reviveMedia(): void {
    this.silentAudio?.play().catch(() => {});
    if (this.audioCtx?.state === "suspended") this.audioCtx.resume().catch(() => {});
    try {
      const ms = (navigator as any).mediaSession;
      if (ms) ms.playbackState = "playing";
    } catch (_) {}
  }

  // ═══════════════ الطبقة 3: WebAudio ═══════════════

  /**
   * Oscillator بتردد خارج السمع البشري لكنه يُحسب "مسموعاً" لدى المتصفح،
   * وبذلك يُستثنى التبويب من Intensive Timer Throttling على Chrome.
   * WebSocket ping/pong للسيرفر إذن لن يتأخر أبداً بعد دقائق في الخلفية.
   */
  private _startWebAudio(): void {
    try {
      if (!this.audioCtx || this.audioCtx.state === "closed") {
        this.audioCtx = new AudioContext();
        this.gainNode = this.audioCtx.createGain();
        this.gainNode.gain.value = OSC_GAIN;

        this.oscillator = this.audioCtx.createOscillator();
        this.oscillator.type = "sine";
        this.oscillator.frequency.value = OSC_FREQ_HZ;

        this.oscillator.connect(this.gainNode);
        this.gainNode.connect(this.audioCtx.destination);
        this.oscillator.start();

        // استئناف تلقائي فور تعليقه
        this.audioCtx.onstatechange = () => {
          if (this.started && this.audioCtx?.state === "suspended") {
            this._resumeAudio();
          }
        };
      } else if (this.audioCtx.state === "suspended") {
        this._resumeAudio();
      }
    } catch (e) {
      console.warn("[BrowserAliveKeeper] WebAudio unavailable:", e);
    }
  }

  private _stopAudio(): void {
    try {
      this.oscillator?.stop();
      this.oscillator?.disconnect();
      this.gainNode?.disconnect();
      if (this.audioCtx) this.audioCtx.onstatechange = null;
      this.audioCtx?.close();
    } catch (_) { /* قد يكون مغلق مسبقاً */ }
    this.oscillator = null;
    this.gainNode   = null;
    this.audioCtx   = null;
  }

  private _resumeAudio(): void {
    if (!this.audioCtx) {
      if (this.started) this._startWebAudio();
      return;
    }
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch(() => { /* يحتاج تفاعلاً — الحارس سيعيد */ });
    } else if (this.audioCtx.state === "closed") {
      this._stopAudio();
      this._startWebAudio();
    }
  }

  // ═══════════════ الطبقة 4: Web Locks ═══════════════

  private _startWebLock(): void {
    if (!("locks" in navigator)) return;
    if (this.lockAbortController) return;

    try {
      this.lockAbortController = new AbortController();
      const signal = this.lockAbortController.signal;

      navigator.locks
        .request(
          "browser-alive-keeper-lock",
          { mode: "shared", signal },
          () => new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          })
        )
        .catch(() => { /* إلغاء مقصود عند stop() */ });
    } catch (_) {
      this.lockAbortController = null;
    }
  }

  private _stopWebLock(): void {
    this.lockAbortController?.abort();
    this.lockAbortController = null;
  }

  // ═══════════════ الطبقة 5: Heartbeat مقاوم للانجراف ═══════════════

  /**
   * لا نثق بـ setInterval (يخنق في الخلفية). نقيس الانجراف بأنفسنا عبر
   * Date.now ونشترك المشتركين بميلي ثانية التأخر الفعلي — فيمكنهم
   * القضم فور استيقاظ الصفحة بدل انتظار الدورة التالية.
   */
  private _startHeartbeat(): void {
    if (this.tickTimer) return;
    this.lastTickAt = Date.now();

    const schedule = () => {
      this.tickTimer = setTimeout(() => {
        this.tickTimer = null;
        if (!this.started) return;

        const now = Date.now();
        const drift = now - this.lastTickAt;
        this.lastTickAt = now;

        for (const cb of Array.from(this.tickSubscribers)) {
          try { cb(drift); } catch (_) {}
        }

        schedule();
      }, HEARTBEAT_TARGET_MS);
    };
    schedule();
  }

  // ═════════════ الحارس الزمني (Watchdog) ═════════════

  /** فحص دوري: يشغّل أي وسائط توقفها النظام ويستأنف WebAudio المعلق */
  private _startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      if (!this.started) return;

      // ① عنصر الصوت: إذا أوقفه النظام — أعده
      try {
        if (this.silentAudio && this.silentAudio.paused) {
          this.silentAudio.play().catch(() => {});
        }
      } catch (_) {}

      // ② WebAudio: إذا علّقه المتصفح — استأنفه
      if (this.audioCtx && this.audioCtx.state === "suspended") {
        this._resumeAudio();
      }
    }, WATCHDOG_MS);
  }

  // ═════════════ التفاعل ودورة الحياة ═════════════

  private _onUserInteraction = (): void => {
    if (this.silentAudio && this.silentAudio.paused) {
      this.silentAudio.play().catch(() => {});
    }
    this._resumeAudio();
    this._requestWakeLock();
  };

  private _bindUserInteraction(): void {
    if (this.gestureBound) return;
    this.gestureBound = true;

    const add = (ev: string) => {
      document.addEventListener(ev, this._onUserInteraction, { passive: true, once: true });
    };

    // نربط دائماً — متصفحات الموبايل ترفض play() قبل لمسة حقيقية حتى مع وجود focus
    add("click");
    add("touchstart");
    add("pointerdown");
    add("keydown");

    // تفاعل سابق موجود (الصفحة ليست جديدة) — حاول التفعيل فوراً أيضاً
    if (document.hasFocus()) {
      this._onUserInteraction();
    }
  }

  private _onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") {
      // عاد المستخدم من الخلفية — استأنف كل الطبقات فوراً
      this._onUserInteraction();
    } else {
      // فور الدخول للخلفية: تأكد أن الوسائط تعمل وأن الحالة "playing"
      this._reviveMedia();
    }
  };

  private _bindLifecycleHandlers(): void {
    document.addEventListener("visibilitychange", this._onVisibilityChange);
    // Page Lifecycle API — عودة من فريز
    window.addEventListener("resume", () => this._onUserInteraction(), { passive: true });
    // عودة الشبكة — الوسائط قد تحتاج إعادة تشغيل
    window.addEventListener("online", () => this._reviveMedia(), { passive: true });
  }

  // ═════════════ Wake Lock ═════════════

  private async _requestWakeLock(): Promise<void> {
    try {
      if (!("wakeLock" in navigator)) return;
      if (this.wakeLock && !this.wakeLock.released) return;
      this.wakeLock = await navigator.wakeLock.request("screen");
    } catch (_) {
      // غير مدعوم (أو الخلفية) — الطبقات الأخرى تكفي
    }
  }

  private _releaseWakeLock(): void {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }
}

/** Singleton — استخدم هذا مباشرة في أي مكان */
export const browserAliveKeeper = new BrowserAliveKeeper();
