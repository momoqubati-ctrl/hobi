/**
 * Global Audio Player
 * Plays audio in the background even when switching tabs.
 * Uses HTML5 Audio API directly (outside React render cycle).
 */

let currentAudio: HTMLAudioElement | null = null;

export function playAudio(url: string): HTMLAudioElement {
  // Stop current audio if playing
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
  }

  const audio = new Audio(url);
  audio.preload = "metadata";
  currentAudio = audio;
  audio.play().catch(() => {});

  return audio;
}

export function pauseAudio(): void {
  if (currentAudio) {
    currentAudio.pause();
  }
}

export function resumeAudio(): void {
  if (currentAudio) {
    currentAudio.play().catch(() => {});
  }
}

export function stopAudio(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio.src = "";
    currentAudio = null;
  }
}

export function getCurrentAudio(): HTMLAudioElement | null {
  return currentAudio;
}
