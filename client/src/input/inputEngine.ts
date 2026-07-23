import {
  DEFAULT_INPUT_SETTINGS,
  loadInputSettings,
  saveInputSettings,
  type InputSettings,
} from "./settings";

/** Every rebindable action — the settings panel iterates this, `GameScene` reads the bound key for each. */
export type InputAction = keyof InputSettings;

/**
 * The keybinding settings singleton — the one place both React (the
 * settings panel) and Phaser (`GameScene`, outside React's tree entirely)
 * can reach without threading a prop through either. Same reasoning as
 * `graphics/graphicsEngine.ts`.
 */
class InputEngine {
  private settings: InputSettings = loadInputSettings();
  private readonly listeners = new Set<() => void>();

  getSettings(): InputSettings {
    return this.settings;
  }

  setBinding(action: InputAction, key: string): void {
    const normalized = key.toUpperCase();
    if (normalized === this.settings[action]) {
      return;
    }
    this.settings = { ...this.settings, [action]: normalized };
    saveInputSettings(this.settings);
    for (const listener of this.listeners) {
      listener();
    }
  }

  resetToDefaults(): void {
    this.settings = { ...DEFAULT_INPUT_SETTINGS };
    saveInputSettings(this.settings);
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Subscribe to binding changes (for the React panel and `GameScene`'s live rebind); returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const inputEngine = new InputEngine();
export type { InputSettings };
