import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "colyseus.js";
import type { GameState } from "../net/types";
import { VoiceController, type VoiceUiState } from "./VoiceController";

/** The key that keys push-to-talk when that mode is on. */
const PTT_CODE = "KeyV";

export interface UseVoice {
  /** Whether this browser can do voice at all (has `getUserMedia`). */
  supported: boolean;
  /** True once the mic is captured and the mesh is running. */
  enabled: boolean;
  /** True while the mic permission prompt / capture is in flight. */
  enabling: boolean;
  /** A short error key if enabling failed (e.g. the user denied the mic). */
  error: string | null;
  /** Live controller state for the UI, or null before voice is enabled. */
  state: VoiceUiState | null;
  enable: () => void;
  disable: () => void;
  toggleSelfMute: () => void;
  setPushToTalk: (enabled: boolean) => void;
  togglePeerMute: (peerId: string) => void;
}

/**
 * React lifecycle wrapper around `VoiceController`. Voice is opt-in: nothing
 * touches the microphone until `enable` is called from a real click. The
 * controller itself is plain (no React), so it survives the game↔meeting screen
 * swaps that would otherwise remount a component — this hook lives at the app
 * root, above those screens, for exactly that reason.
 *
 * Push-to-talk is wired here rather than in the controller because it is a
 * document-level key binding, which is a React/DOM concern: while PTT is on and
 * voice is enabled, holding the PTT key opens the mic and releasing it closes
 * it again.
 */
export function useVoice(room: Room<GameState> | null): UseVoice {
  const supported =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const controllerRef = useRef<VoiceController | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<VoiceUiState | null>(null);

  // Tear the mesh down whenever the room goes away or changes (leaving a game,
  // reconnecting into a fresh room object). A new room means a new controller.
  useEffect(() => {
    return () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
      setEnabled(false);
      setEnabling(false);
      setState(null);
    };
  }, [room]);

  const enable = useCallback(() => {
    if (!room || !supported || controllerRef.current) {
      return;
    }
    const controller = new VoiceController(room, setState);
    controllerRef.current = controller;
    setEnabling(true);
    setError(null);
    void controller
      .start()
      .then(() => {
        setEnabled(true);
      })
      .catch((err: unknown) => {
        controller.dispose();
        controllerRef.current = null;
        setEnabled(false);
        setError(err instanceof Error ? err.message : "voice/failed");
      })
      .finally(() => setEnabling(false));
  }, [room, supported]);

  const disable = useCallback(() => {
    controllerRef.current?.dispose();
    controllerRef.current = null;
    setEnabled(false);
    setState(null);
  }, []);

  const toggleSelfMute = useCallback(() => controllerRef.current?.toggleSelfMute(), []);
  const setPushToTalk = useCallback(
    (value: boolean) => controllerRef.current?.setPushToTalk(value),
    [],
  );
  const togglePeerMute = useCallback(
    (peerId: string) => controllerRef.current?.togglePeerMute(peerId),
    [],
  );

  // Push-to-talk key handling. Only bound while it's actually the active mode,
  // and it ignores auto-repeat so a held key opens the mic once, not per frame.
  const pushToTalk = state?.pushToTalk ?? false;
  useEffect(() => {
    if (!enabled || !pushToTalk) {
      return;
    }
    const down = (event: KeyboardEvent) => {
      if (event.code === PTT_CODE && !event.repeat) {
        controllerRef.current?.setPttActive(true);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === PTT_CODE) {
        controllerRef.current?.setPttActive(false);
      }
    };
    // Releasing focus (alt-tab) must not leave the mic stuck open.
    const blur = () => controllerRef.current?.setPttActive(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [enabled, pushToTalk]);

  return {
    supported,
    enabled,
    enabling,
    error,
    state,
    enable,
    disable,
    toggleSelfMute,
    setPushToTalk,
    togglePeerMute,
  };
}
