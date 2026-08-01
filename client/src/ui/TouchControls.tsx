import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import Phaser from "phaser";
import type { Direction } from "@foghaven/shared";
import type { PromptVisibility, TouchActionKind } from "../game/GameScene";
import { Button } from "./primitives";

/** Pixel radius the knob can travel from the base's center. */
const JOYSTICK_RADIUS = 50;
/** Fraction of the radius the knob must clear before a direction registers — absorbs an imprecise thumb, matches a relaxed rest position. */
const DEADZONE_RATIO = 0.25;

interface TouchControlsProps {
  /** The active `Phaser.Game`'s event emitter — the same React/Phaser bridge `GameCanvas` already uses for the mini-game and ability hooks. */
  gameEvents: Phaser.Events.EventEmitter;
  /**
   * Which action buttons to render. Defaults to the full in-world set; the
   * lobby passes `["interact"]`, since a waiting room has a table to open
   * and nothing to report, ring or douse. The joystick is always rendered —
   * walking is the one thing every scene using this needs.
   */
  actions?: readonly TouchActionKind[];
}

const ALL_ACTIONS: readonly TouchActionKind[] = ["interact", "report", "bell", "lantern"];

/**
 * Touch equivalent of WASD + E/R/B: a virtual joystick that emits `"touch:move"`
 * and tap buttons that emit `"touch:action"`, both consumed by `GameScene`
 * (and `LobbyScene`) exactly like their keyboard counterparts — see
 * `sampleInput` and `consumeTouchAction` there. Only mounted when
 * `useIsTouchDevice()` is true — see `GameCanvas.tsx` / `LobbyCanvas.tsx`.
 *
 * The joystick quantizes to the same -1/0/1-per-axis shape the keyboard
 * already produces rather than a free analog angle, because the server's
 * `sanitizeDirection` collapses anything else to that shape anyway — sending
 * a true analog vector would just make client prediction diverge from what
 * the server resolves every tick.
 */
export function TouchControls({ gameEvents, actions = ALL_ACTIONS }: TouchControlsProps) {
  const { t } = useTranslation();
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [prompts, setPrompts] = useState<PromptVisibility>({
    interact: false,
    report: false,
    bell: false,
    repair: false,
  });

  useEffect(() => {
    const onPrompts = (next: PromptVisibility) => setPrompts(next);
    gameEvents.on("prompts:update", onPrompts);
    return () => {
      gameEvents.off("prompts:update", onPrompts);
    };
  }, [gameEvents]);

  const updateFromPoint = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) {
      return;
    }
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const distance = Math.hypot(dx, dy);
    if (distance > JOYSTICK_RADIUS) {
      dx = (dx / distance) * JOYSTICK_RADIUS;
      dy = (dy / distance) * JOYSTICK_RADIUS;
    }
    setKnob({ x: dx, y: dy });

    const deadzone = JOYSTICK_RADIUS * DEADZONE_RATIO;
    const dir: Direction = {
      x: Math.abs(dx) > deadzone ? Math.sign(dx) : 0,
      y: Math.abs(dy) > deadzone ? Math.sign(dy) : 0,
    };
    gameEvents.emit("touch:move", dir.x === 0 && dir.y === 0 ? null : dir);
  };

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const onMove = (e: PointerEvent) => updateFromPoint(e.clientX, e.clientY);
    const onUp = () => {
      setDragging(false);
      setKnob({ x: 0, y: 0 });
      gameEvents.emit("touch:move", null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, gameEvents]);

  const onBaseDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
    updateFromPoint(e.clientX, e.clientY);
  };

  const triggerAction = (action: TouchActionKind) => {
    gameEvents.emit("touch:action", action);
  };

  return (
    <div className="touch-controls">
      <div ref={baseRef} className="touch-joystick-base" onPointerDown={onBaseDown}>
        <div
          className="touch-joystick-knob"
          style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        />
      </div>

      <div className="touch-action-buttons">
        {actions.includes("interact") && (
          <Button
            variant="primary"
            className="touch-action-button"
            disabled={!prompts.interact && !prompts.repair}
            onClick={() => triggerAction("interact")}
          >
            {t("game.touchInteractLabel")}
          </Button>
        )}
        {actions.includes("report") && (
          <Button
            variant="primary"
            className="touch-action-button"
            disabled={!prompts.report}
            onClick={() => triggerAction("report")}
          >
            {t("game.touchReportLabel")}
          </Button>
        )}
        {actions.includes("bell") && (
          <Button
            variant="primary"
            className="touch-action-button"
            disabled={!prompts.bell}
            onClick={() => triggerAction("bell")}
          >
            {t("game.touchBellLabel")}
          </Button>
        )}
        {actions.includes("lantern") && (
          <Button
            variant="primary"
            className="touch-action-button"
            onClick={() => triggerAction("lantern")}
          >
            {t("game.touchLanternLabel")}
          </Button>
        )}
      </div>
    </div>
  );
}
