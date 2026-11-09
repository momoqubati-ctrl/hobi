import assert from "node:assert/strict";
import test from "node:test";
import {
  ANNOUNCEMENT_SOUND_OPTIONS,
  getAnnouncementSoundPreference,
  playAnnouncementNotificationTone,
  saveAnnouncementSoundPreference,
  type AnnouncementSoundStorage,
} from "../src/lib/announcementSound";

function createSoundStorage(initialValue: string | null = null) {
  let value = initialValue;
  const storage: AnnouncementSoundStorage = {
    getItem: () => value,
    setItem: (_key, nextValue) => {
      value = nextValue;
    },
  };
  return { storage, getValue: () => value };
}

test("announcement sound preference defaults safely and reads a valid saved choice", () => {
  const emptyStorage = createSoundStorage();
  const selectedStorage = createSoundStorage("double");
  const unknownStorage = createSoundStorage("unknown");

  assert.equal(getAnnouncementSoundPreference(emptyStorage.storage), "classic");
  assert.equal(getAnnouncementSoundPreference(selectedStorage.storage), "double");
  assert.equal(getAnnouncementSoundPreference(unknownStorage.storage), "classic");
});

test("announcement sound choices include an original bright mobile-style chime", () => {
  const sound = ANNOUNCEMENT_SOUND_OPTIONS.find(({ id }) => id === "bright");

  assert.equal(sound?.label, "تنبيه لامع");
  assert.ok(sound?.description);

  const frequencies: number[] = [];
  const waveforms: string[] = [];
  const audioContext = {
    currentTime: 0,
    destination: {},
    createOscillator() {
      const oscillator = {
        type: "sine",
        frequency: {
          setValueAtTime(value: number) {
            frequencies.push(value);
          },
        },
        connect() {},
        start() {},
        stop() {},
      };
      waveforms.push(oscillator.type);
      return oscillator;
    },
    createGain: () => ({
      gain: {
        setValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
      connect() {},
    }),
  } as unknown as Parameters<typeof playAnnouncementNotificationTone>[0];

  playAnnouncementNotificationTone(audioContext, "bright");

  assert.deepEqual(frequencies, [740, 932, 1244]);
  assert.deepEqual(waveforms, ["sine", "sine", "sine"]);
});

test("announcement sound preference persists the user's selection", () => {
  const { storage, getValue } = createSoundStorage();

  saveAnnouncementSoundPreference(storage, "bright");

  assert.equal(getValue(), "bright");
  assert.equal(getAnnouncementSoundPreference(storage), "bright");
});

test("announcement notification tone plays a short, fading sine beep", () => {
  const frequencyChanges: number[] = [];
  const gainChanges: number[] = [];
  const automationTimes: number[] = [];
  const connectionEvents: string[] = [];
  const oscillator = {
    type: "square",
    frequency: {
      setValueAtTime(value: number, when: number) {
        frequencyChanges.push(value);
        automationTimes.push(when);
      },
    },
    connect() {
      connectionEvents.push("oscillator");
    },
    start() {
      connectionEvents.push("start");
    },
    stop() {
      connectionEvents.push("stop");
    },
  };
  const gain = {
    gain: {
      setValueAtTime(value: number, when: number) {
        gainChanges.push(value);
        automationTimes.push(when);
      },
      exponentialRampToValueAtTime(value: number, when: number) {
        gainChanges.push(value);
        automationTimes.push(when);
      },
    },
    connect() {
      connectionEvents.push("gain");
    },
  };
  const audioContext = {
    currentTime: 3,
    destination: {},
    createOscillator: () => oscillator,
    createGain: () => gain,
  } as unknown as Parameters<typeof playAnnouncementNotificationTone>[0];

  playAnnouncementNotificationTone(audioContext);

  assert.equal(oscillator.type, "sine");
  assert.deepEqual(frequencyChanges, [880]);
  assert.deepEqual(gainChanges, [0.0001, 0.12, 0.0001]);
  assert.deepEqual(automationTimes, [3, 3, 3.02, 3.24]);
  assert.deepEqual(connectionEvents, ["oscillator", "gain", "start", "stop"]);
});

test("selected announcement sound controls the preview's waveform and can be silent", () => {
  const createdOscillators: Array<{
    type: string;
    frequency: { setValueAtTime(value: number, when: number): void };
    connect(): void;
    start(): void;
    stop(): void;
  }> = [];
  const audioContext = {
    currentTime: 3,
    destination: {},
    createOscillator() {
      const oscillator = {
        type: "sine",
        frequency: { setValueAtTime() {} },
        connect() {},
        start() {},
        stop() {},
      };
      createdOscillators.push(oscillator);
      return oscillator;
    },
    createGain: () => ({
      gain: {
        setValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
      connect() {},
    }),
  } as unknown as Parameters<typeof playAnnouncementNotificationTone>[0];

  playAnnouncementNotificationTone(audioContext, "chime");
  assert.deepEqual(createdOscillators.map(({ type }) => type), ["triangle", "triangle"]);

  playAnnouncementNotificationTone(audioContext, "off");
  assert.equal(createdOscillators.length, 2);
});
