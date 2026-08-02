import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import {
  INJURED_MINIGAME_HANDICAP,
  type ClientTask,
  type MinigameType,
  type TaskOutcomeMessage,
  type TaskRejectedMessage,
  type TaskStartedMessage,
} from "@foghaven/shared";
import type { GameState } from "../net/types";
import type { MinigameProps } from "../game/minigames/types";
import * as juiceEvents from "../juice/juiceEvents";
import { Button, Panel } from "./primitives";

// Lazy so none of the six mini-games' code ships in the initial bundle — only
// one is ever shown at a time, and a given session may never open some of them
// at all. Each becomes its own chunk, fetched the first time it is needed.
const MINIGAMES: Record<MinigameType, ComponentType<MinigameProps>> = {
  wick: lazy(() => import("../game/minigames/WickGame").then((m) => ({ default: m.WickGame }))),
  net: lazy(() => import("../game/minigames/NetGame").then((m) => ({ default: m.NetGame }))),
  gear: lazy(() => import("../game/minigames/GearGame").then((m) => ({ default: m.GearGame }))),
  bilge: lazy(() => import("../game/minigames/BilgeGame").then((m) => ({ default: m.BilgeGame }))),
  ledger: lazy(() => import("../game/minigames/LedgerGame").then((m) => ({ default: m.LedgerGame }))),
  crane: lazy(() => import("../game/minigames/CraneGame").then((m) => ({ default: m.CraneGame }))),
};

/**
 * Where the overlay is in the attempt lifecycle. Deliberately explicit rather
 * than a pile of booleans — the whole point of 8.2 is that a task has stages
 * with different rules, and "am I allowed to close this window" is a different
 * answer in each one.
 */
type Stage =
  | "brief" // lethal only: the warning, before anything is sent
  | "opening" // task_start sent, waiting for the server to accept
  | "playing" // server accepted; the puzzle is live
  | "resolving" // outcome reported, waiting for the server's verdict
  | "verdict"; // server answered

interface TaskAttemptOverlayProps {
  room: Room<GameState>;
  task: ClientTask;
  /** True while the local player is injured — see `MinigameProps.handicap`. */
  injured?: boolean;
  /** The overlay is done and should be unmounted. */
  onClose: () => void;
}

/**
 * The standard task overlay: one mount/unmount lifecycle wrapped around any
 * mini-game, built from the Phase 7 primitives (`Panel`, `Button`).
 *
 * ## Why the overlay owns the network and the puzzle does not
 *
 * A mini-game reports "solved" or "failed" and nothing else. This component is
 * the only thing that talks to the server about a task, which means there is
 * exactly one place where an attempt can be opened, reported, or abandoned —
 * and therefore exactly one place to get the hostile-client rules right. A
 * puzzle cannot accidentally complete a task twice, resolve one it never
 * started, or keep playing after the server has already closed the attempt.
 *
 * ## What this can and cannot promise
 *
 * Nothing here is a security boundary. A modified client can send whatever it
 * likes, and every rule below is re-decided server-side (see
 * `GameRoom.handleTaskStart`). What this component provides is that an HONEST
 * client behaves correctly — including the parts a player would otherwise
 * experience as unfair, like a lethal task refusing to let you back out.
 */
export function TaskAttemptOverlay({ room, task, injured = false, onClose }: TaskAttemptOverlayProps) {
  const { t } = useTranslation();
  const Minigame = MINIGAMES[task.minigame];
  const isLethal = task.tier === "lethal";
  const [stage, setStage] = useState<Stage>(isLethal ? "brief" : "opening");
  const [verdict, setVerdict] = useState<TaskOutcomeMessage | null>(null);
  const [rejection, setRejection] = useState<TaskRejectedMessage["reason"] | null>(null);
  /**
   * Set the moment the server accepts, and never unset. Once an attempt is
   * open the player is committed to *something* happening — the guard below
   * uses this to decide whether an unmount still owes the server an abort.
   */
  const openedRef = useRef(false);

  // Server → client. Mounted before the first `task_start` goes out so the
  // acceptance can never arrive before there is a listener for it.
  useEffect(() => {
    const offStarted: () => void = room.onMessage<TaskStartedMessage>("taskStarted", (msg) => {
      if (msg.taskId !== task.id) return;
      openedRef.current = true;
      setStage("playing");
    });
    const offRejected: () => void = room.onMessage<TaskRejectedMessage>("taskRejected", (msg) => {
      if (msg.taskId !== task.id) return;
      setRejection(msg.reason);
      setStage("verdict");
    });
    const offOutcome: () => void = room.onMessage<TaskOutcomeMessage>("taskOutcome", (msg) => {
      if (msg.taskId !== task.id) return;
      openedRef.current = false; // the server has closed it; nothing left to abort
      setVerdict(msg);
      setStage("verdict");
      // §9/§8.3's screen-level consequence. Success (the bar-punch) is fired
      // from `GameView` instead, off the PUBLIC bar itself — see its own doc
      // for why that is the more correct trigger than this private message.
      // A lethal failure needs nothing here: the server's `"killed"` message
      // already drives the full kill cutscene independently of this overlay.
      if (!msg.success && msg.tier === "injury") {
        juiceEvents.taskInjury();
      }
    });
    return () => {
      offStarted();
      offRejected();
      offOutcome();
    };
  }, [room, task.id]);

  // Open the attempt. A lethal task waits for the player to accept the brief
  // first — see `confirm` below.
  useEffect(() => {
    if (stage !== "opening") {
      return;
    }
    room.send("task_start", { taskId: task.id, confirmed: isLethal });
  }, [room, task.id, stage, isLethal]);

  /**
   * On unmount with an attempt still open, tell the server we are gone.
   *
   * It will honour that only for a `safe` task; at `injury`/`lethal` the
   * attempt stands and its deadline will resolve it as a failure. That
   * asymmetry is the design, not an oversight — the alternative is that
   * closing a window is a way to un-choose a risk you already took.
   */
  useEffect(() => {
    return () => {
      if (openedRef.current) {
        room.send("task_abort", { taskId: task.id });
      }
    };
  }, [room, task.id]);

  const report = useCallback(
    (success: boolean) => {
      setStage("resolving");
      room.send("task_resolve", { taskId: task.id, success });
    },
    [room, task.id],
  );

  // Escape closes the overlay, but only where backing out is actually
  // allowed. On a committed attempt it does nothing, so a reflexive Escape
  // cannot quietly hand the player a failure they did not watch happen.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (stage === "brief" || stage === "verdict" || task.tier === "safe") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stage, task.tier, onClose]);

  const canBackOut = stage === "brief" || stage === "verdict" || task.tier === "safe";

  return (
    <div className="minigame-overlay">
      <Panel
        className={`minigame-panel task-attempt task-attempt-${task.tier}`}
        role="dialog"
        aria-modal="true"
        aria-label={t(`rooms.${task.room}`)}
      >
        <header className="minigame-panel-header">
          <span>{t(`rooms.${task.room}`)}</span>
          {task.tier !== "safe" && (
            <span className={`task-risk-badge task-risk-${task.tier}`}>
              {t(`task.risk.${task.tier}`)}
            </span>
          )}
          {canBackOut && (
            <Button
              className="minigame-panel-close"
              onClick={onClose}
              aria-label={t("minigame.cancel")}
            >
              ✕
            </Button>
          )}
        </header>

        {/*
          The lethal brief. Shown BEFORE anything is sent, and the only route
          past it is the confirm button — which is what makes the server's
          `confirmed` flag honest rather than something the client asserts on
          the player's behalf. "Never a surprise death" starts here.
        */}
        {stage === "brief" && (
          <div className="task-brief">
            <p className="task-brief-warning">{t("task.brief.lethalWarning")}</p>
            <p className="task-brief-detail">{t("task.brief.lethalDetail")}</p>
            <div className="task-brief-actions">
              <Button variant="default" onClick={onClose}>
                {t("task.brief.back")}
              </Button>
              <Button variant="destructive" onClick={() => setStage("opening")}>
                {t("task.brief.accept")}
              </Button>
            </div>
          </div>
        )}

        {stage === "opening" && <p className="minigame-instructions">{t("app.loading")}</p>}

        {stage === "playing" && (
          <Suspense fallback={<p className="minigame-instructions">{t("app.loading")}</p>}>
            <Minigame
              onComplete={() => report(true)}
              onFail={() => report(false)}
              onCancel={() => (task.tier === "safe" ? onClose() : undefined)}
              handicap={injured ? INJURED_MINIGAME_HANDICAP : 1}
            />
          </Suspense>
        )}

        {stage === "resolving" && <p className="minigame-instructions">{t("task.resolving")}</p>}

        {stage === "verdict" && (
          <div className="task-verdict">
            <p className="task-verdict-line">
              {rejection
                ? t(`task.rejected.${rejection}`)
                : verdict?.success
                  ? t("task.verdict.success")
                  : t(
                      verdict?.timedOut
                        ? "task.verdict.timedOut"
                        : `task.verdict.failed.${verdict?.tier ?? "safe"}`,
                    )}
            </p>
            <Button variant="primary" onClick={onClose}>
              {t("task.verdict.close")}
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
