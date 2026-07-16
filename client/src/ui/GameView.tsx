import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import type { GameState } from "../net/types";
import { GameCanvas } from "../game/GameCanvas";

interface GameViewProps {
  room: Room<GameState>;
  onLeave: () => void;
}

/**
 * In-game screen: React owns the surrounding HUD (room code, roster, leave),
 * while the embedded Phaser canvas owns the world. The roster is derived from
 * the same networked state the canvas renders.
 */
export function GameView({ room, onLeave }: GameViewProps) {
  const { t } = useTranslation();
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    // Derive the roster from `onStateChange` rather than caching a reference to
    // `room.state.players`: colyseus.js swaps in a fresh collection when the
    // first full state arrives, so a captured reference goes stale. Reading
    // `room.state.players` fresh on each change always sees the live map.
    const sync = () => {
      const current: string[] = [];
      room.state.players.forEach((player) => current.push(player.name));
      setNames((prev) =>
        prev.length === current.length && prev.every((n, i) => n === current[i])
          ? prev
          : current,
      );
    };

    const handleLeave = () => onLeave();

    room.onStateChange(sync);
    room.onLeave(handleLeave);
    sync();

    return () => {
      room.onStateChange.remove(sync);
      room.onLeave.remove(handleLeave);
    };
  }, [room, onLeave]);

  const leave = () => {
    void room.leave();
    onLeave();
  };

  return (
    <div className="game-view">
      <header className="hud">
        <span className="hud-room">
          {t("game.roomCodeLabel")}: <strong>{room.roomId}</strong>
        </span>
        <span className="hud-players">
          {t("game.playersLabel")}: {names.length}
        </span>
        <button type="button" onClick={leave}>
          {t("game.leaveButton")}
        </button>
      </header>
      <GameCanvas room={room} />
    </div>
  );
}
