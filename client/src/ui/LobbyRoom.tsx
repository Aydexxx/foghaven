import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import { MIN_PLAYERS } from "@foghaven/shared";
import type { GameState } from "../net/types";

interface LobbyRoomProps {
  room: Room<GameState>;
  onLeave: () => void;
}

interface RosterEntry {
  id: string;
  name: string;
}

/**
 * The waiting room: room code, a live roster, and a Start button that only
 * the host ever sees. Starting is a *request* — the server is the one that
 * decides whether the room actually advances past the lobby.
 */
export function LobbyRoom({ room, onLeave }: LobbyRoomProps) {
  const { t } = useTranslation();
  const [players, setPlayers] = useState<RosterEntry[]>([]);
  const [hostId, setHostId] = useState(room.state.hostId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const sync = () => {
      const current: RosterEntry[] = [];
      room.state.players.forEach((player, id) => current.push({ id, name: player.name }));
      setPlayers(current);
    };

    const unlistenHost = room.state.listen("hostId", setHostId);
    room.onStateChange(sync);
    sync();

    return () => {
      unlistenHost();
      room.onStateChange.remove(sync);
    };
  }, [room]);

  const isHost = hostId === room.sessionId;
  const canStart = players.length >= MIN_PLAYERS;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission can be denied; the code is already visible on
      // screen, so failing to copy silently is an acceptable fallback.
    }
  };

  return (
    <div className="panel">
      <h1>{t("lobbyRoom.heading")}</h1>

      <div className="room-code">
        <span className="room-code-value">{room.roomId}</span>
        <button type="button" className="secondary" onClick={copyCode}>
          {copied ? t("lobbyRoom.copied") : t("lobbyRoom.copyButton")}
        </button>
      </div>

      <ul className="roster">
        {players.map((player) => (
          <li key={player.id}>
            <span>{player.name}</span>
            {player.id === hostId && <span className="host-tag">{t("lobbyRoom.hostTag")}</span>}
          </li>
        ))}
      </ul>

      <p className="hint">
        {t("lobbyRoom.playerCount", { count: players.length, min: MIN_PLAYERS })}
      </p>

      {isHost && (
        <button type="button" onClick={() => room.send("start")} disabled={!canStart}>
          {t("lobbyRoom.startButton")}
        </button>
      )}

      <button type="button" className="secondary" onClick={onLeave}>
        {t("lobbyRoom.leaveButton")}
      </button>
    </div>
  );
}
