import {
  DEFAULT_GRAPHICS_SETTINGS,
  loadGraphicsSettings,
  saveGraphicsSettings,
  type GraphicsSettings,
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

  constructor() {
    this.applyDomAttribute();
  }

  getSettings(): GraphicsSettings {
    return this.settings;
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

  /** Subscribe to settings changes (for the React panel and `PhaseAtmosphere`); returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private applyDomAttribute(): void {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.effects = this.settings.effectsEnabled ? "on" : "off";
  }
}

export const graphicsEngine = new GraphicsEngine();
export { DEFAULT_GRAPHICS_SETTINGS };
export type { GraphicsSettings };
