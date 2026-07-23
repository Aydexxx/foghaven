/**
 * Touch-capability detection, as a plain function rather than a hook so
 * non-component code (like `graphics/settings.ts`'s low-spec default) can
 * call it too. A device's touch capability doesn't change over a session, so
 * nothing here needs to be reactive.
 */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}
