/**
 * Persistence for rebindable keybindings. Same localStorage-with-try/catch
 * shape as `graphics/settings.ts`/`audio/settings.ts`. Values are Phaser key
 * names (the same strings `Phaser.Input.Keyboard.KeyCodes` and
 * `addKey(string)` already accept — see `GameScene.ts`), not raw DOM
 * `KeyboardEvent` codes, so a stored binding can be handed straight to
 * Phaser with no translation step.
 *
 * Movement is captured as four independent bindings (not "WASD as a unit")
 * so a player can, say, swap only "up" without losing the rest — the arrow
 * keys are NOT part of this settings surface at all: they always work as a
 * fixed alternate underneath whatever is bound here (see `GameScene.ts`'s
 * `sampleInput`), so movement never has a zero-bindings state.
 */

export interface InputSettings {
  moveUp: string;
  moveDown: string;
  moveLeft: string;
  moveRight: string;
  interact: string;
  report: string;
  bell: string;
  /** §3.5/§4.1: "extinguish your lantern to hide" — always available, no role gate. */
  lantern: string;
}

export const DEFAULT_INPUT_SETTINGS: InputSettings = {
  moveUp: "W",
  moveDown: "S",
  moveLeft: "A",
  moveRight: "D",
  interact: "E",
  report: "R",
  bell: "B",
  lantern: "L",
};

const STORAGE_KEY = "foghaven.input";

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** The saved bindings, defensively parsed — a corrupt or missing entry (or field) just falls back to the default for that one action. */
export function loadInputSettings(): InputSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_INPUT_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<InputSettings>;
    return {
      moveUp: str(parsed.moveUp, DEFAULT_INPUT_SETTINGS.moveUp),
      moveDown: str(parsed.moveDown, DEFAULT_INPUT_SETTINGS.moveDown),
      moveLeft: str(parsed.moveLeft, DEFAULT_INPUT_SETTINGS.moveLeft),
      moveRight: str(parsed.moveRight, DEFAULT_INPUT_SETTINGS.moveRight),
      interact: str(parsed.interact, DEFAULT_INPUT_SETTINGS.interact),
      report: str(parsed.report, DEFAULT_INPUT_SETTINGS.report),
      bell: str(parsed.bell, DEFAULT_INPUT_SETTINGS.bell),
      lantern: str(parsed.lantern, DEFAULT_INPUT_SETTINGS.lantern),
    };
  } catch {
    return { ...DEFAULT_INPUT_SETTINGS };
  }
}

export function saveInputSettings(settings: InputSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode, quota, disabled) — losing
    // the saved preference must never break rebinding itself.
  }
}
