import { useCallback, useSyncExternalStore } from "react";
import { graphicsEngine, type GraphicsSettings, type MotionPreference } from "./graphicsEngine";

/**
 * Reactive access to the graphics engine's settings, for the settings panel.
 * `useSyncExternalStore` rather than local `useState` for the same reason
 * `useAudioSettings` uses it — the engine is a module-level singleton
 * `GameScene` also reads and writes to, so the panel needs to reflect
 * whatever the source of truth actually holds.
 */
export function useGraphicsSettings(): {
  settings: GraphicsSettings;
  /** The tri-state preference already resolved against the OS query. */
  reducedMotionActive: boolean;
  setEffectsEnabled: (enabled: boolean) => void;
  setColorBlindMode: (enabled: boolean) => void;
  setReducedMotion: (preference: MotionPreference) => void;
} {
  const settings = useSyncExternalStore(
    useCallback((onChange) => graphicsEngine.subscribe(onChange), []),
    () => graphicsEngine.getSettings(),
  );

  return {
    settings,
    reducedMotionActive: graphicsEngine.prefersReducedMotion(),
    setEffectsEnabled: useCallback(
      (enabled: boolean) => graphicsEngine.setEffectsEnabled(enabled),
      [],
    ),
    setColorBlindMode: useCallback(
      (enabled: boolean) => graphicsEngine.setColorBlindMode(enabled),
      [],
    ),
    setReducedMotion: useCallback(
      (preference: MotionPreference) => graphicsEngine.setReducedMotion(preference),
      [],
    ),
  };
}
