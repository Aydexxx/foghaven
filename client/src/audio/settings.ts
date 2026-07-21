/**
 * Persistence for the audio settings — master/music/sfx volume and mute,
 * everything the acceptance criteria means by "settings work". Same
 * `localStorage`-with-try/catch shape as `net/session.ts`: a player's audio
 * preference is a convenience, never something a storage failure should be
 * allowed to break the game over.
 */

const STORAGE_KEY = "foghaven.audio";

export type AudioBus = "master" | "music" | "sfx";

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  mutedMaster: boolean;
  mutedMusic: boolean;
  mutedSfx: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  master: 0.8,
  music: 0.6,
  sfx: 0.9,
  mutedMaster: false,
  mutedMusic: false,
  mutedSfx: false,
};

function clamp01(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** The saved settings, defensively parsed — a corrupt or missing entry just falls back to the defaults field by field. */
export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_AUDIO_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      master: clamp01(parsed.master, DEFAULT_AUDIO_SETTINGS.master),
      music: clamp01(parsed.music, DEFAULT_AUDIO_SETTINGS.music),
      sfx: clamp01(parsed.sfx, DEFAULT_AUDIO_SETTINGS.sfx),
      mutedMaster: bool(parsed.mutedMaster, DEFAULT_AUDIO_SETTINGS.mutedMaster),
      mutedMusic: bool(parsed.mutedMusic, DEFAULT_AUDIO_SETTINGS.mutedMusic),
      mutedSfx: bool(parsed.mutedSfx, DEFAULT_AUDIO_SETTINGS.mutedSfx),
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode, quota, disabled) — losing
    // the saved preference must never break adjusting the volume itself.
  }
}
