import { useEffect, useRef } from "react";
import Phaser from "phaser";
import type { Room } from "colyseus.js";
import { type ClientTask } from "@foghaven/shared";
import type { GameState } from "../net/types";
import { GameScene, type AbilitySlotInfo, type AbilityTargetInfo } from "./GameScene";

/**
 * The canvas element's own size. The *world* (the town map — see
 * `@foghaven/shared`'s `MAP`) is considerably larger than this; the camera
 * follows the local player around it. Deliberately not the same constant:
 * conflating "how big the map is" with "how big the window onto it is" is
 * exactly what stopped this game from ever having a map bigger than one
 * screen.
 */
const VIEWPORT_WIDTH = 960;
const VIEWPORT_HEIGHT = 640;

interface GameCanvasProps {
  room: Room<GameState>;
  /**
   * The player's task list, as already captured by App (see its comment on
   * why the "tasks" message is subscribed there and not here). Used only as
   * the scene's *initial* seed — live progress after that flows into the
   * scene through its own `room.onMessage("taskProgress", ...)`, not through
   * this prop, since the Phaser game below is created once and does not
   * re-run on every React re-render.
   */
  tasks: ClientTask[];
  /**
   * The local role's PLAYING-phase abilities and how to gather each one's
   * target — see `roleById(role)?.abilities` in the shared registry. Fixed
   * for the whole round, so it's safe as scene init data rather than a prop
   * the scene would need to react to changing.
   */
  abilitySlots: AbilitySlotInfo[];
  /** Fired when the scene wants to open a mini-game for the given task. */
  onTaskTrigger: (task: ClientTask) => void;
  /** The id of the task whose mini-game modal is currently open, or null. */
  activeTaskId: string | null;
  /** Fired when any PLAYING-phase ability's current target changes, keyed by ability id. */
  onAbilityTargetsChange: (targets: Record<string, AbilityTargetInfo | null>) => void;
}

/**
 * Bridges React and Phaser: React owns the surrounding UI, this component owns
 * the canvas. The Phaser game is created once per room and fully destroyed on
 * unmount so nothing leaks across React StrictMode remounts.
 *
 * Mini-games are a second, narrower bridge on top of that: the scene decides
 * *when* to open one (proximity + E) and emits `"task:open"` on the Game's
 * global event emitter; this component relays that to React via
 * `onTaskTrigger`. When the resulting modal closes, `activeTaskId` becomes
 * null again and this component emits `"task:close"` back to the scene so it
 * un-freezes movement. `game.events` is used rather than scene refs because
 * it's stable across the scene's own lifecycle and needs no extra plumbing.
 */
export function GameCanvas({
  room,
  tasks,
  abilitySlots,
  onTaskTrigger,
  activeTaskId,
  onAbilityTargetsChange,
}: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  // Kept fresh every render so the one-time listeners below never close over
  // a stale callback without having to reattach themselves.
  const onTaskTriggerRef = useRef(onTaskTrigger);
  onTaskTriggerRef.current = onTaskTrigger;
  const onAbilityTargetsChangeRef = useRef(onAbilityTargetsChange);
  onAbilityTargetsChangeRef.current = onAbilityTargetsChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: container,
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      backgroundColor: "#16120c",
      scene: [],
    });
    gameRef.current = game;

    game.scene.add("game", GameScene, true, { room, tasks, abilitySlots });
    game.events.on("task:open", (task: ClientTask) => onTaskTriggerRef.current(task));
    game.events.on("ability:targets", (targets: Record<string, AbilityTargetInfo | null>) =>
      onAbilityTargetsChangeRef.current(targets),
    );

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, [room]);

  useEffect(() => {
    if (activeTaskId === null) {
      gameRef.current?.events.emit("task:close");
    }
  }, [activeTaskId]);

  return <div ref={containerRef} className="game-canvas" />;
}
