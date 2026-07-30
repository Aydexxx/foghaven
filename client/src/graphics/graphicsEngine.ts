import {
  DEFAULT_GRAPHICS_SETTINGS,
  loadGraphicsSettings,
  resolveReducedMotion,
  saveGraphicsSettings,
  type GraphicsSettings,
  type MotionPreference,
} from "./settings";

/**
 * The graphics settings singleton: the one place both React (the settings
 * panel) and Phaser (`GameScene`'s `PhaseAtmosphere`, a plain class outside
 * React's tree entirely) can reach without threading a prop through either
 * — the same reasoning `audio/audioEngine.ts` documents for why it is a
 * module-level singleton rather than a React context.
 *
 * Every change also stamps `data-effects` on the document root so purely
 * CSS-driven effects (the meeting screen's lamp flicker) can react to the
 * toggle without any React plumbing of their own.
 */
class GraphicsEngine {
  private settings: GraphicsSettings = loadGraphicsSettings();
  private readonly listeners = new Set<() => void>();
  private motionQuery?: MediaQueryList;

  constructor() {
    this.applyDomAttribute();
    this.watchSystemMotionPreference();
  }

  getSettings(): GraphicsSettings {
    return this.settings;
  }

  /**
   * The resolved yes/no the juice layer actually acts on, with the tri-state
   * preference already reconciled against the OS query. Read this rather
   * than `getSettings().reducedMotion` anywhere the answer needs to be a
   * boolean — `"system"` is not a value effects can be scaled by.
   */
  prefersReducedMotion(): boolean {
    return resolveReducedMotion(this.settings.reducedMotion);
  }

  /**
   * Re-notifies subscribers when the OS motion preference changes while the
   * game is open. Only meaningful in `"system"` mode, but the listener is
   * unconditional: the player can switch back to `"system"` at any time and
   * the engine would otherwise be reporting a stale answer until the next
   * unrelated settings write.
   */
  private watchSystemMotionPreference(): void {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    try {
      this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.motionQuery.addEventListener("change", () => {
        this.applyDomAttribute();
        for (const listener of this.listeners) {
          listener();
        }
      });
    } catch {
      // Same fallback as `systemPrefersReducedMotion` — an unsupported query
      // means no OS signal, never a crash on startup.
    }
  }

  setEffectsEnabled(enabled: boolean): void {
    if (enabled === this.settings.effectsEnabled) {
      return;
    }
    this.settings = { ...this.settings, effectsEnabled: enabled };
    saveGraphicsSettings(this.settings);
    this.applyDomAttribute();
    for (const listener of this.listeners) {
      listener();
    }
  }

  setColorBlindMode(enabled: boolean): void {
    if (enabled === this.settings.colorBlindMode) {
      return;
    }
    this.settings = { ...this.settings, colorBlindMode: enabled };
    saveGraphicsSettings(this.settings);
    this.applyDomAttribute();
    for (const listener of this.listeners) {
      listener();
    }
  }

  setReducedMotion(preference: MotionPreference): void {
    if (preference === this.settings.reducedMotion) {
      return;
    }
    this.settings = { ...this.settings, reducedMotion: preference };
    saveGraphicsSettings(this.settings);
    this.applyDomAttribute();
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Subscribe to settings changes (for the React panel, `PhaseAtmosphere`, and `GameScene`'s badge/palette rendering); returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private applyDomAttribute(): void {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.effects = this.settings.effectsEnabled ? "on" : "off";
    document.documentElement.dataset.colorBlind = this.settings.colorBlindMode ? "on" : "off";
    // Stamped resolved, not as the raw tri-state, so CSS can key off
    // `[data-reduced-motion="on"]` without having to re-implement the
    // system-query fallback in a media query of its own.
    document.documentElement.dataset.reducedMotion = this.prefersReducedMotion() ? "on" : "off";
  }
}

export const graphicsEngine = new GraphicsEngine();
export { DEFAULT_GRAPHICS_SETTINGS };
export type { GraphicsSettings, MotionPreference };
