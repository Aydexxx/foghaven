/**
 * Persistence for the graphics settings — currently just the one master
 * effects toggle the performance requirement calls for. Same
 * `localStorage`-with-try/catch shape as `audio/settings.ts`: a player's
 * graphics preference is a convenience, never something a storage failure
 * should be allowed to break the game over.
 */

const STORAGE_KEY = "foghaven.graphics";

export interface GraphicsSettings {
  /**
   * Master switch for every atmosphere effect added on top of the base game
   * (colour grade, light bleed, particles, puddle shimmer, screen shake).
   * False must reproduce exactly the pre-atmosphere rendering — not a
   * reduced version of it — so this is safe to recommend on low-end or
   * mobile hardware.
   */
  effectsEnabled: boolean;
}

export const DEFAULT_GRAPHICS_SETTINGS: GraphicsSettings = {
  effectsEnabled: true,
};

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** The saved settings, defensively parsed — a corrupt or missing entry just falls back to the defaults field by field. */
export function loadGraphicsSettings(): GraphicsSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_GRAPHICS_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<GraphicsSettings>;
    return {
      effectsEnabled: bool(parsed.effectsEnabled, DEFAULT_GRAPHICS_SETTINGS.effectsEnabled),
    };
  } catch {
    return { ...DEFAULT_GRAPHICS_SETTINGS };
  }
}

export function saveGraphicsSettings(settings: GraphicsSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode, quota, disabled) — losing
    // the saved preference must never break toggling the setting itself.
  }
}
