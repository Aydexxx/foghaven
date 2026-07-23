/**
 * Persistence for the graphics settings — currently just the one master
 * effects toggle the performance requirement calls for. Same
 * `localStorage`-with-try/catch shape as `audio/settings.ts`: a player's
 * graphics preference is a convenience, never something a storage failure
 * should be allowed to break the game over.
 */

import { isTouchDevice } from "../device";

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
  /**
   * Swaps `PLAYER_COLORS` for a color-blind-safe palette (see
   * `characters/palette.ts`) wherever a player's color is rendered. This is
   * only half of the actual color-blind fix — the accent badge glyph (see
   * `GameScene.ts`) is unconditional and doesn't depend on this flag at all,
   * since a flat color swap alone still leaves two colors that hash onto the
   * same character archetype indistinguishable by hue alone.
   */
  colorBlindMode: boolean;
}

export const DEFAULT_GRAPHICS_SETTINGS: GraphicsSettings = {
  effectsEnabled: true,
  colorBlindMode: false,
};

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * The saved settings, defensively parsed — a corrupt or missing entry just
 * falls back to the defaults field by field. When there is no saved entry at
 * all (first run) *and* the device is touch-capable, `effectsEnabled`
 * defaults to off instead of the usual `true` — a touch device is the
 * heuristic for "possibly low-end mobile hardware", and this toggle is
 * documented above as safe to default off there. Still fully overridable in
 * `GraphicsSettingsPanel` either way.
 */
export function loadGraphicsSettings(): GraphicsSettings {
  const firstRunDefaults: GraphicsSettings = isTouchDevice()
    ? { ...DEFAULT_GRAPHICS_SETTINGS, effectsEnabled: false }
    : DEFAULT_GRAPHICS_SETTINGS;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...firstRunDefaults };
    }
    const parsed = JSON.parse(raw) as Partial<GraphicsSettings>;
    return {
      effectsEnabled: bool(parsed.effectsEnabled, firstRunDefaults.effectsEnabled),
      colorBlindMode: bool(parsed.colorBlindMode, firstRunDefaults.colorBlindMode),
    };
  } catch {
    return { ...firstRunDefaults };
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
