import { useTranslation } from "react-i18next";
import { useCountdown } from "./useCountdown";
import { Panel } from "./primitives";

interface CriticalSabotageBannerProps {
  /** The countdown's full duration, as told by the "criticalSabotageStarted" broadcast. */
  durationMs: number;
  /** When this client learned the countdown had started — the local clock it counts down from. */
  startedAt: number;
  /** Which of the two repair points have been fixed so far. */
  repairedPoints: readonly string[];
}

const POINT_IDS = ["north", "south"] as const;

/**
 * The critical sabotage's countdown and repair status — the one screen-wide
 * warning that a real, unrepaired loss is on the clock. Presentation only:
 * the countdown here is a local estimate (see `useCountdown`), the server
 * alone decides when it actually runs out.
 */
export function CriticalSabotageBanner({
  durationMs,
  startedAt,
  repairedPoints,
}: CriticalSabotageBannerProps) {
  const { t } = useTranslation();
  const remainingMs = useCountdown(durationMs, startedAt);
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <Panel className="critical-sabotage-banner" role="alert">
      <p className="critical-sabotage-heading">{t("sabotage.critical.heading")}</p>
      <p className="critical-sabotage-timer">{seconds}</p>
      <ul className="critical-sabotage-points">
        {POINT_IDS.map((id) => (
          <li key={id} data-fixed={repairedPoints.includes(id)}>
            {t(`sabotage.critical.point.${id}`)}:{" "}
            {repairedPoints.includes(id)
              ? t("sabotage.critical.fixed")
              : t("sabotage.critical.broken")}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
