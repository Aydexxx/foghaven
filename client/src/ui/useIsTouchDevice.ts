import { useState } from "react";
import { isTouchDevice } from "../device";

/**
 * Whether this session should render touch controls. Lazy-initialized from
 * `isTouchDevice()` and never re-checked afterward — a device's touch
 * capability doesn't change mid-session, so there's nothing to react to.
 */
export function useIsTouchDevice(): boolean {
  const [touch] = useState(isTouchDevice);
  return touch;
}
