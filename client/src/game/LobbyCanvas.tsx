import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import type { GameState } from "../net/types";
import { LobbyScene } from "./LobbyScene";
import { TouchControls } from "../ui/TouchControls";
import { useIsTouchDevice } from "../ui/useIsTouchDevice";
import { colors } from "../theme/tokens";

/**
 * Same canvas size as `GameCanvas` — the lobby and the world are the same
 * window onto the same map, just framed differently (the lobby camera is
 * fixed on the Tavern instead of following a player).
 */
const VIEWPORT_WIDTH = 960;
const VIEWPORT_HEIGHT = 640;

/**
 * The only tap action a waiting room has. Report/bell/lantern are in-world
 * verbs with nothing to act on here, so they aren't rendered at all rather
 * than rendered permanently disabled.
 */
const LOBBY_TOUCH_ACTIONS = ["interact"] as const;

interface LobbyCanvasProps {
  room: Room<GameState>;
  /** Fired when the player interacts with the Tavern's settings table. */
  onOpenSettings: () => void;
}

/**
 * React/Phaser bridge for the walkable lobby — the `GameCanvas` of the
 * waiting room, and deliberately built the same way: the Phaser game is
 * created once per room and fully destroyed on unmount so nothing leaks
 * across StrictMode remounts, and scene→React signals travel on
 * `game.events` rather than a scene ref.
 */
export function LobbyCanvas({ room, onOpenSettings }: LobbyCanvasProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const isTouchDevice = useIsTouchDevice();
  const [gameEvents, setGameEvents] = useState<Phaser.Events.EventEmitter | null>(null);

  // Kept fresh every render so the one-time listener below never closes over
  // a stale callback without having to reattach itself.
  const onOpenSettingsRef = useRef(onOpenSettings);
  onOpenSettingsRef.current = onOpenSettings;

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
      backgroundColor: colors.ink,
      scene: [],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
      },
    });
    gameRef.current = game;
    setGameEvents(game.events);

    game.scene.add("lobby", LobbyScene, true, { room });
    game.events.on("lobby:openSettings", () => onOpenSettingsRef.current());

    const onOrientationChange = () => game.scale.refresh();
    window.addEventListener("orientationchange", onOrientationChange);
    window.addEventListener("resize", onOrientationChange);

    return () => {
      window.removeEventListener("orientationchange", onOrientationChange);
      window.removeEventListener("resize", onOrientationChange);
      game.destroy(true);
      gameRef.current = null;
      setGameEvents(null);
    };
  }, [room]);

  // The scene draws canvas text (the table prompt, the "away" tag over a
  // dropped player) but has no i18n catalogue of its own, so React pushes the
  // translated copy in — and again on every language change, since the scene
  // outlives a locale switch. `gameEvents` is in the deps purely as the
  // "scene now exists" signal; it is set in the same effect that creates it.
  useEffect(() => {
    const scene = gameRef.current?.scene.getScene("lobby") as LobbyScene | undefined;
    scene?.setLabels({
      tablePrompt: t("lobbyRoom.tablePrompt"),
      away: t("lobbyRoom.disconnectedTag"),
    });
  }, [t, gameEvents]);

  return (
    <>
      <div ref={containerRef} className="lobby-canvas" />
      {isTouchDevice && gameEvents && (
        <TouchControls gameEvents={gameEvents} actions={LOBBY_TOUCH_ACTIONS} />
      )}
    </>
  );
}
