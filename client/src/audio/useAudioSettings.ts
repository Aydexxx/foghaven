import { useCallback, useSyncExternalStore } from "react";
import { audioEngine, type AudioBus, type AudioSettings } from "./audioEngine";

/**
 * Reactive access to the audio engine's settings, for the settings panel.
 * `useSyncExternalStore` rather than local `useState` because the engine is
 * a module-level singleton `GameScene` can also write to directly (a
 * footstep-triggered future "duck the ambience" tweak, say) — the panel
 * needs to reflect whatever the source of truth actually holds, not its own
 * copy that could drift from it.
 */
export function useAudioSettings(): {
  settings: AudioSettings;
  setVolume: (bus: AudioBus, value: number) => void;
  setMuted: (bus: AudioBus, muted: boolean) => void;
} {
  const settings = useSyncExternalStore(
    useCallback((onChange) => audioEngine.subscribe(onChange), []),
    () => audioEngine.getSettings(),
  );

  return {
    settings,
    setVolume: useCallback((bus: AudioBus, value: number) => audioEngine.setVolume(bus, value), []),
    setMuted: useCallback((bus: AudioBus, muted: boolean) => audioEngine.setMuted(bus, muted), []),
  };
}
