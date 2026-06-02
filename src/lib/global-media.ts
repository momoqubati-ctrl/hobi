/**
 * Global Media Player
 * Plays audio/video in the background even when switching tabs.
 * Uses HTML5 Media API directly (outside React render cycle).
 */

type Listener = () => void;

interface GlobalVideoState {
  url: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  type: "video" | "audio" | null;
}

let videoElement: HTMLVideoElement | null = null;
let audioElement: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let currentState: GlobalVideoState = {
  url: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  type: null,
};
let listeners: Set<Listener> = new Set();

function notify() {
  listeners.forEach((l) => l());
}

function ensureVideoElement(): HTMLVideoElement {
  if (!videoElement) {
    videoElement = document.createElement("video");
    videoElement.preload = "auto";
    videoElement.style.cssText =
      "width:100%;height:auto;max-height:100%;object-fit:contain;display:block;background:#000;";

    videoElement.addEventListener("play", () => {
      currentState.isPlaying = true;
      notify();
    });
    videoElement.addEventListener("pause", () => {
      currentState.isPlaying = false;
      notify();
    });
    videoElement.addEventListener("timeupdate", () => {
      currentState.currentTime = videoElement!.currentTime;
      notify();
    });
    videoElement.addEventListener("loadedmetadata", () => {
      currentState.duration = videoElement!.duration;
      notify();
    });
    videoElement.addEventListener("ended", () => {
      currentState.isPlaying = false;
      currentState.currentTime = 0;
      notify();
    });
  }
  return videoElement;
}

function ensureAudioElement(): HTMLAudioElement {
  if (!audioElement) {
    audioElement = new Audio();
    audioElement.preload = "auto";

    audioElement.addEventListener("play", () => {
      currentState.isPlaying = true;
      notify();
    });
    audioElement.addEventListener("pause", () => {
      currentState.isPlaying = false;
      notify();
    });
    audioElement.addEventListener("timeupdate", () => {
      currentState.currentTime = audioElement!.currentTime;
      notify();
    });
    audioElement.addEventListener("loadedmetadata", () => {
      currentState.duration = audioElement!.duration;
      notify();
    });
    audioElement.addEventListener("ended", () => {
      currentState.isPlaying = false;
      currentState.currentTime = 0;
      notify();
    });
  }
  return audioElement;
}

export function attachVideoTo(container: HTMLElement): void {
  const video = ensureVideoElement();
  if (video.parentElement !== container) {
    container.appendChild(video);
  }
}

export function playVideo(url: string): void {
  const video = ensureVideoElement();
  const isSameVideo = video.src === url || currentUrl === url;

  if (!isSameVideo) {
    video.src = url;
    video.load();
    currentUrl = url;
    currentState.url = url;
    currentState.currentTime = 0;
    currentState.type = "video";
  }

  video.play().catch(() => {});
}

export function playAudio(url: string): void {
  const audio = ensureAudioElement();
  const isSameAudio = audio.src === url || currentUrl === url;

  if (!isSameAudio) {
    audio.src = url;
    audio.load();
    currentUrl = url;
    currentState.url = url;
    currentState.currentTime = 0;
    currentState.type = "audio";
  }

  audio.play().catch(() => {});
}

export function pauseMedia(): void {
  if (videoElement && !videoElement.paused) videoElement.pause();
  if (audioElement && !audioElement.paused) audioElement.pause();
}

export function resumeMedia(): void {
  if (currentState.type === "audio" && audioElement) {
    audioElement.play().catch(() => {});
  } else if (videoElement) {
    videoElement.play().catch(() => {});
  }
}

export function seekMedia(time: number): void {
  if (currentState.type === "audio" && audioElement) {
    audioElement.currentTime = time;
  } else if (videoElement) {
    videoElement.currentTime = time;
  }
  currentState.currentTime = time;
  notify();
}

export function closeMedia(): void {
  if (videoElement) {
    videoElement.pause();
    videoElement.removeAttribute("src");
    videoElement.load();
  }
  if (audioElement) {
    audioElement.pause();
    audioElement.removeAttribute("src");
  }
  currentUrl = null;
  currentState = {
    url: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    type: null,
  };
  notify();
}

export function stopMedia(): void {
  closeMedia();
}

export function getGlobalVideoElement(): HTMLVideoElement | null {
  return videoElement;
}

export function getGlobalVideoState(): GlobalVideoState {
  return { ...currentState };
}

export function isMediaPlaying(): boolean {
  return currentState.isPlaying;
}

export function getMediaUrl(): string | null {
  return currentUrl;
}

export function subscribeToGlobalMedia(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Legacy API
let currentMedia: HTMLMediaElement | null = null;

export function setCurrentMedia(el: HTMLMediaElement): void {
  if (currentMedia && currentMedia !== el) {
    currentMedia.pause();
  }
  currentMedia = el;
}

export function getCurrentMedia(): HTMLMediaElement | null {
  return currentMedia;
}

export function resumeMediaEl(el?: HTMLMediaElement): void {
  const target = el || currentMedia;
  if (target) target.play().catch(() => {});
}

