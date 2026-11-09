import { useState } from "react";
import { Check, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ANNOUNCEMENT_SOUND_OPTIONS,
  getAnnouncementSoundPreference,
  previewAnnouncementSound,
  saveAnnouncementSoundPreference,
  type AnnouncementSoundId,
} from "@/lib/announcementSound";
import { showError } from "@/utils/toast";

export default function AnnouncementSoundSettings() {
  const [selectedSound, setSelectedSound] = useState(getAnnouncementSoundPreference);

  const selectSound = (soundId: AnnouncementSoundId) => {
    try {
      saveAnnouncementSoundPreference(window.localStorage, soundId);
      setSelectedSound(soundId);
    } catch (error) {
      console.error("[Announcements] Could not save the sound preference:", error);
      showError("تعذر حفظ اختيار صوت الإعلان");
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="announcement-sound-heading">
      <h4
        id="announcement-sound-heading"
        className="text-xs font-bold text-muted-foreground px-2 uppercase tracking-wider"
      >
        صوت الإعلانات
      </h4>
      <div className="space-y-2 rounded-xl border border-border/60 bg-card p-3">
        <p className="px-1 text-xs text-muted-foreground">
          جرّب النغمات واختر الصوت الذي يناسبك.
        </p>
        <ul className="space-y-1">
          {ANNOUNCEMENT_SOUND_OPTIONS.map((sound) => {
            const isSelected = selectedSound === sound.id;
            const isSilent = sound.id === "off";

            return (
              <li key={sound.id} className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectSound(sound.id)}
                  className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg border px-3 py-2 text-right transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isSelected
                      ? "border-primary/50 bg-primary/5"
                      : "border-transparent hover:bg-muted"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                    }`}
                    aria-hidden="true"
                  >
                    {isSelected && <Check size={12} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {isSilent ? (
                        <VolumeX size={15} aria-hidden="true" />
                      ) : (
                        <Volume2 size={15} aria-hidden="true" />
                      )}
                      {sound.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {sound.description}
                    </span>
                  </span>
                  {isSelected && (
                    <span className="shrink-0 text-xs font-medium text-primary">محدد</span>
                  )}
                </button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`تجربة صوت ${sound.label}`}
                  disabled={isSilent}
                  onClick={() => previewAnnouncementSound(sound.id)}
                >
                  <Play size={14} aria-hidden="true" />
                  تجربة
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
