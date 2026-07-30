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
  /**
   * Reduced motion, as a preference rather than a plain boolean: `"system"`
   * (the default) follows the OS `prefers-reduced-motion` media query, and
   * `"on"`/`"off"` are explicit player overrides of it.
   *
   * Tri-state rather than a boolean because "the player has never touched
   * this" and "the player deliberately turned it off" have to stay
   * distinguishable — collapsing them would mean either ignoring the OS
   * setting or making it impossible to opt back into motion on a machine
   * that requests reduced motion globally.
   *
   * This scales effect AMPLITUDES only, never durations — see
   * `JuiceDirector` for why preserving durations is a fairness requirement
   * and not just a stylistic one.
   */
  reducedMotion: MotionPreference;
}

export type MotionPreference = "system" | "on" | "off";

const MOTION_PREFERENCES: readonly MotionPreference[] = ["system", "on", "off"];

export const DEFAULT_GRAPHICS_SETTINGS: GraphicsSettings = {
  effectsEnabled: true,
  colorBlindMode: false,
  reducedMotion: "system",
};

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function motionPreference(value: unknown, fallback: MotionPreference): MotionPreference {
  return MOTION_PREFERENCES.includes(value as MotionPreference)
    ? (value as MotionPreference)
    : fallback;
}

/**
 * Whether the OS currently asks for reduced motion. Guarded for non-browser
 * environments (tests, SSR) and for the older browsers where `matchMedia`
 * exists but the query is unsupported — both fall back to "no", which is the
 * pre-existing behaviour rather than a silent global disabling of motion.
 */
export function systemPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Resolves the tri-state preference against the OS query into a plain yes/no. */
export function resolveReducedMotion(preference: MotionPreference): boolean {
  if (preference === "on") {
    return true;
  }
  if (preference === "off") {
    return false;
  }
  return systemPrefersReducedMotion();
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
      reducedMotion: motionPreference(parsed.reducedMotion, firstRunDefaults.reducedMotion),
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
