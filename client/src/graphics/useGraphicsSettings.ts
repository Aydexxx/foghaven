import { useCallback, useSyncExternalStore } from "react";
import { graphicsEngine, type GraphicsSettings } from "./graphicsEngine";

/**
 * Reactive access to the graphics engine's settings, for the settings panel.
 * `useSyncExternalStore` rather than local `useState` for the same reason
 * `useAudioSettings` uses it — the engine is a module-level singleton
 * `GameScene` also reads and writes to, so the panel needs to reflect
 * whatever the source of truth actually holds.
 */
export function useGraphicsSettings(): {
  settings: GraphicsSettings;
  setEffectsEnabled: (enabled: boolean) => void;
} {
  const settings = useSyncExternalStore(
    useCallback((onChange) => graphicsEngine.subscribe(onChange), []),
    () => graphicsEngine.getSettings(),
  );

  return {
    settings,
    setEffectsEnabled: useCallback(
      (enabled: boolean) => graphicsEngine.setEffectsEnabled(enabled),
      [],
    ),
  };
}
