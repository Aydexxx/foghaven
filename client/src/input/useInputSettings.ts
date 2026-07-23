import { useCallback, useSyncExternalStore } from "react";
import { inputEngine, type InputAction, type InputSettings } from "./inputEngine";

/**
 * Reactive access to the keybinding engine's settings, for the settings
 * panel. `useSyncExternalStore` for the same reason `useGraphicsSettings`/
 * `useAudioSettings` use it — the engine is a module-level singleton
 * `GameScene` also reads (and live-rebinds from), so the panel needs to
 * reflect whatever the source of truth actually holds.
 */
export function useInputSettings(): {
  settings: InputSettings;
  setBinding: (action: InputAction, key: string) => void;
  resetToDefaults: () => void;
} {
  const settings = useSyncExternalStore(
    useCallback((onChange) => inputEngine.subscribe(onChange), []),
    () => inputEngine.getSettings(),
  );

  return {
    settings,
    setBinding: useCallback((action: InputAction, key: string) => inputEngine.setBinding(action, key), []),
    resetToDefaults: useCallback(() => inputEngine.resetToDefaults(), []),
  };
}
