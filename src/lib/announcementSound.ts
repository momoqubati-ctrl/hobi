type AnnouncementAudioContext = Pick<
  AudioContext,
  "currentTime" | "destination" | "createOscillator" | "createGain"
>;

export type AnnouncementSoundId = "classic" | "double" | "chime" | "soft" | "bright" | "off";
export type AnnouncementSoundStorage = Pick<Storage, "getItem" | "setItem">;

export const ANNOUNCEMENT_SOUND_OPTIONS: readonly {
  id: AnnouncementSoundId;
  label: string;
  description: string;
}[] = [
  { id: "classic", label: "كلاسيكي", description: "نغمة قصيرة وواضحة" },
  { id: "double", label: "مزدوج", description: "نغمتان متتاليتان" },
  { id: "chime", label: "رنين", description: "رنين موسيقي خفيف" },
  { id: "soft", label: "هادئ", description: "نغمة منخفضة وناعمة" },
  { id: "bright", label: "تنبيه لامع", description: "ثلاث نغمات صاعدة بنبرة واضحة" },
  { id: "off", label: "بدون صوت", description: "إيقاف صوت الإعلانات" },
];

const ANNOUNCEMENT_SOUND_PREFERENCE_KEY = "announcementSoundPreference";
const DEFAULT_ANNOUNCEMENT_SOUND: AnnouncementSoundId = "classic";

const ANNOUNCEMENT_SOUND_NOTES: Record<
  Exclude<AnnouncementSoundId, "off">,
  readonly { waveform: OscillatorType; frequency: number; delay: number; duration: number; volume: number }[]
> = {
  classic: [{ waveform: "sine", frequency: 880, delay: 0, duration: 0.24, volume: 0.12 }],
  double: [
    { waveform: "sine", frequency: 740, delay: 0, duration: 0.12, volume: 0.1 },
    { waveform: "sine", frequency: 988, delay: 0.16, duration: 0.15, volume: 0.1 },
  ],
  chime: [
    { waveform: "triangle", frequency: 660, delay: 0, duration: 0.34, volume: 0.12 },
    { waveform: "triangle", frequency: 990, delay: 0.06, duration: 0.28, volume: 0.08 },
  ],
  soft: [{ waveform: "sine", frequency: 523, delay: 0, duration: 0.22, volume: 0.08 }],
  bright: [
    { waveform: "sine", frequency: 740, delay: 0, duration: 0.1, volume: 0.09 },
    { waveform: "sine", frequency: 932, delay: 0.11, duration: 0.1, volume: 0.09 },
    { waveform: "sine", frequency: 1244, delay: 0.23, duration: 0.2, volume: 0.1 },
  ],
};

let audioContext: AudioContext | null = null;
let pendingAnnouncementSound: AnnouncementSoundId | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext !== "function") return null;
  audioContext ??= new window.AudioContext();
  return audioContext;
}

function isAnnouncementSoundId(value: string | null): value is AnnouncementSoundId {
  return ANNOUNCEMENT_SOUND_OPTIONS.some(({ id }) => id === value);
}

export function getAnnouncementSoundPreference(
  storage?: AnnouncementSoundStorage,
): AnnouncementSoundId {
  try {
    const preferenceStorage = storage
      ?? (typeof window === "undefined" ? undefined : window.localStorage);
    const savedPreference = preferenceStorage?.getItem(ANNOUNCEMENT_SOUND_PREFERENCE_KEY) ?? null;
    return isAnnouncementSoundId(savedPreference)
      ? savedPreference
      : DEFAULT_ANNOUNCEMENT_SOUND;
  } catch (error) {
    console.warn("[Announcements] Could not read the sound preference:", error);
    return DEFAULT_ANNOUNCEMENT_SOUND;
  }
}

export function saveAnnouncementSoundPreference(
  storage: AnnouncementSoundStorage,
  soundId: AnnouncementSoundId,
): void {
  if (!isAnnouncementSoundId(soundId)) throw new Error("Invalid announcement sound choice");
  storage.setItem(ANNOUNCEMENT_SOUND_PREFERENCE_KEY, soundId);
}

export function playAnnouncementNotificationTone(
  context: AnnouncementAudioContext,
  soundId: AnnouncementSoundId = DEFAULT_ANNOUNCEMENT_SOUND,
): void {
  if (soundId === "off") return;

  for (const note of ANNOUNCEMENT_SOUND_NOTES[soundId]) {
    const startedAt = context.currentTime + note.delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = note.waveform;
    oscillator.frequency.setValueAtTime(note.frequency, startedAt);
    gain.gain.setValueAtTime(0.0001, startedAt);
    gain.gain.exponentialRampToValueAtTime(note.volume, startedAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + note.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startedAt);
    oscillator.stop(startedAt + note.duration);
  }
}

function playPendingAnnouncementSound(): void {
  const context = getAudioContext();
  if (!pendingAnnouncementSound || !context || context.state !== "running") return;
  const soundId = pendingAnnouncementSound;
  pendingAnnouncementSound = null;
  playAnnouncementNotificationTone(context, soundId);
}

export function setupAnnouncementSoundUnlock(): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.AudioContext !== "function"
  ) return () => {};

  const context = getAudioContext();
  if (!context) return () => {};

  let listening = true;
  const removeUnlockListeners = () => {
    if (!listening) return;
    listening = false;
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };

  const unlock = () => {
    if (context.state === "running") {
      removeUnlockListeners();
      playPendingAnnouncementSound();
      return;
    }

    void context.resume().then(() => {
      if (context.state === "running") removeUnlockListeners();
      playPendingAnnouncementSound();
    }).catch((error: unknown) => {
      console.warn("[Announcements] Browser audio could not be enabled:", error);
    });
  };

  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  return removeUnlockListeners;
}

export function playIncomingAnnouncementSound(): void {
  const soundId = getAnnouncementSoundPreference();
  if (soundId === "off") return;

  const context = getAudioContext();
  if (!context) return;
  if (context.state !== "running") {
    pendingAnnouncementSound = soundId;
    return;
  }
  playAnnouncementNotificationTone(context, soundId);
}

export function previewAnnouncementSound(soundId: AnnouncementSoundId): void {
  if (soundId === "off") return;
  const context = getAudioContext();
  if (!context) return;
  if (context.state === "running") {
    playAnnouncementNotificationTone(context, soundId);
    return;
  }

  void context.resume().then(() => {
    if (context.state === "running") playAnnouncementNotificationTone(context, soundId);
  }).catch((error: unknown) => {
    console.warn("[Announcements] Browser audio preview could not be played:", error);
  });
}
