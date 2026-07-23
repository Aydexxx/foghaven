import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { hasSeenHint, markHintSeen } from "./seenHints";

/** How long a contextual hint stays on screen before clearing itself — same duration as GameView's ability-hint toast. */
const HINT_DURATION_MS = 6000;

/**
 * A first-time-only contextual hint. `active` is the trigger condition
 * (computed by the caller — e.g. "the local player has tasks", "the meeting
 * just reached its voting stage"); the moment it goes true for a given `id`
 * that hasn't been shown before, this returns the translated hint text for
 * `HINT_DURATION_MS`, then reverts to null — and never again for that `id`,
 * in this browser, ever (see `seenHints.ts`).
 *
 * Deliberately not tied to any particular render target: both `GameView` and
 * `MeetingScreen` use this with their own hint `id`s and render the result
 * through `OnboardingHintToast`.
 */
export function useOnboardingHint(id: string, active: boolean, i18nKey: string): string | null {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active || hasSeenHint(id)) {
      return;
    }
    markHintSeen(id);
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), HINT_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, id]);

  return visible ? t(i18nKey) : null;
}
