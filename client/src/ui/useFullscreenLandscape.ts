import { useCallback, useEffect, useState } from "react";

/** Standard `requestFullscreen`, falling back to the WebKit-prefixed method some older iOS Safari builds still need. */
function requestFullscreen(el: HTMLElement): Promise<void> | undefined {
  if (el.requestFullscreen) {
    return el.requestFullscreen();
  }
  const legacy = el as HTMLElement & { webkitRequestFullscreen?: () => void };
  legacy.webkitRequestFullscreen?.();
  return undefined;
}

function exitFullscreen(): Promise<void> | undefined {
  if (document.exitFullscreen) {
    return document.exitFullscreen();
  }
  const legacy = document as Document & { webkitExitFullscreen?: () => void };
  legacy.webkitExitFullscreen?.();
  return undefined;
}

function currentFullscreenElement(): Element | null {
  const legacy = document as Document & { webkitFullscreenElement?: Element | null };
  return document.fullscreenElement ?? legacy.webkitFullscreenElement ?? null;
}

/**
 * Requests fullscreen + a landscape orientation lock for gameplay screens on
 * touch devices. Browsers only grant `requestFullscreen()` from within a
 * user gesture, and the phase transitions into "game"/"meeting" are
 * server-driven rather than a click — so instead of adding a dedicated
 * "enter game" tap, this attaches a one-time listener for the player's very
 * next tap (moving the joystick, tapping any HUD button) and treats that as
 * the gesture.
 *
 * `screen.orientation.lock` doesn't exist on iOS Safari at all — feature-
 * detected and skipped silently there. `.rotate-device-overlay`'s CSS media
 * query (see index.css) is the fallback for any device that can't, or
 * wouldn't, grant the lock. `toggle` is exposed for a manual HUD button so a
 * player can retry a failed/dismissed attempt or back out of fullscreen.
 */
export function useFullscreenLandscape(active: boolean): { isFullscreen: boolean; toggle: () => void } {
  const [isFullscreen, setIsFullscreen] = useState(() => currentFullscreenElement() !== null);

  const requestFullscreenAndLock = useCallback(async () => {
    if (currentFullscreenElement()) {
      return;
    }
    try {
      await requestFullscreen(document.documentElement);
    } catch {
      return;
    }
    const orientation = screen.orientation as
      | (ScreenOrientation & { lock?: (orientation: string) => Promise<void> })
      | undefined;
    try {
      await orientation?.lock?.("landscape");
    } catch {
      // No orientation-lock API at all (iOS Safari) or the browser/OS
      // refused it (e.g. a system rotation-lock setting) — either way, the
      // CSS rotate overlay is the fallback the player actually sees.
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(currentFullscreenElement() !== null);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    const onFirstTap = () => {
      void requestFullscreenAndLock();
    };
    document.addEventListener("pointerdown", onFirstTap, { once: true });
    return () => document.removeEventListener("pointerdown", onFirstTap);
  }, [active, requestFullscreenAndLock]);

  const toggle = useCallback(() => {
    if (currentFullscreenElement()) {
      void exitFullscreen();
    } else {
      void requestFullscreenAndLock();
    }
  }, [requestFullscreenAndLock]);

  return { isFullscreen, toggle };
}
