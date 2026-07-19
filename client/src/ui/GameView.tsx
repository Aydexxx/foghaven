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
 * In-game screen: React owns the surrounding HUD, the embedded Phaser canvas
 * owns the world. The canvas only ever exists while this component is
 * mounted, which is itself gated on the server's phase reaching "playing" —
 * that's the entire React/Phaser boundary.
 */
export function GameView({ room, onLeave }: GameViewProps) {
  const { t } = useTranslation();
  const [playerCount, setPlayerCount] = useState(room.state.players.size);

  useEffect(() => {
    const sync = () => setPlayerCount(room.state.players.size);
    room.onStateChange(sync);
    sync();
    return () => room.onStateChange.remove(sync);
  }, [room]);

  return (
    <div className="game-view">
      <header className="hud">
        <span className="hud-room">
          {t("game.roomCodeLabel")}: <strong>{room.roomId}</strong>
        </span>
        <span className="hud-players">
          {t("game.playersLabel")}: {playerCount}
        </span>
        <button type="button" onClick={onLeave}>
          {t("game.leaveButton")}
        </button>
      </header>
      <GameCanvas room={room} />
    </div>
  );
}
