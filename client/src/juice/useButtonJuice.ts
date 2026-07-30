import { useEffect } from "react";
import * as juiceEvents from "./juiceEvents";

/**
 * ART_BIBLE §9's first row — "Any button press | Scale 1.0 → 1.06 → 1.0 over
 * 120 ms, `back.out` easing".
 *
 * One delegated listener at the document root rather than a `juiceEvents`
 * call added to every button's own handler. "Any button" is the requirement,
 * and satisfying it call-site by call-site across ~30 components would mean
 * the row is only as true as the last person to remember it — a new button
 * would silently ship without the punch, and nothing would catch it.
 * Delegation makes the row structurally true instead: to opt out you have to
 * say so explicitly.
 *
 * `pointerdown`, not `click`: the punch is feedback that the press was
 * received, so it has to land when the finger goes down rather than when the
 * button's action resolves. It also means a press that ends in a drag-off
 * still acknowledges, which is what makes a button feel responsive rather
 * than laggy.
 */
export function useButtonJuice(): void {
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      // `closest` rather than a direct tag check — a button's label, icon or
      // span is what actually receives the event, and punching the child
      // would scale the text inside a stationary button.
      const button = target.closest("button");
      if (!(button instanceof HTMLElement)) {
        return;
      }
      // A disabled button did not accept the press, so acknowledging it would
      // be a lie. `data-no-juice` is the explicit opt-out for controls where
      // a scale punch would fight their own animation.
      if (button.matches(":disabled") || button.dataset.noJuice !== undefined) {
        return;
      }
      juiceEvents.buttonPress(button);
    };

    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);
}
