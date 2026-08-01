import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RECONNECT_GRACE_MS } from "@foghaven/shared";
import { useCountdown } from "./useCountdown";
import { Panel } from "./primitives";

/**
 * Shown while a dropped connection is being chased. Deliberately an overlay
 * rather than a screen of its own: the game underneath is still running and
 * the seat is still held, so this is a temporary state to sit through, not a
 * place the player has been sent.
 *
 * The countdown is honest — it is the server's grace period, after which the
 * seat really is gone.
 */
export function ReconnectOverlay() {
  const { t } = useTranslation();
  // Pinned once, on mount: `useCountdown` restarts whenever its start time
  // changes, so a fresh `Date.now()` every render would reset it every render.
  const [startedAt] = useState(() => Date.now());
  const remainingMs = useCountdown(RECONNECT_GRACE_MS, startedAt);
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <div className="reconnect-overlay" role="status" aria-live="polite">
      <Panel className="reconnect-card">
        <p className="reconnect-title">{t("reconnect.title")}</p>
        <p className="hint">{t("reconnect.remaining", { seconds })}</p>
      </Panel>
    </div>
  );
}
