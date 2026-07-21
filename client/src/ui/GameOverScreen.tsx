import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import { FACTION, roleById, WIN_REASON } from "@foghaven/shared";
import type { GameState } from "../net/types";

interface GameOverScreenProps {
  room: Room<GameState>;
}

interface RosterEntry {
  id: string;
  name: string;
  role: string;
}

/**
 * Read the full roster from `finalRoster`, never from `players`. A living
 * client's `players` map has never contained its dead teammates — the
 * per-child filter keeps it that way even now — so `finalRoster` is the one
 * place this screen's data comes from. See its doc on the server schema.
 */
function readRoster(room: Room<GameState>): RosterEntry[] {
  const roster: RosterEntry[] = [];
  room.state.finalRoster.forEach((entry) => {
    roster.push({ id: entry.id, name: entry.name, role: entry.role });
  });
  return roster;
}

const REASON_KEY: Record<string, string> = {
  [WIN_REASON.TASKS]: "gameOver.reasonTasks",
  [WIN_REASON.STRANGERS_EJECTED]: "gameOver.reasonStrangersEjected",
  [WIN_REASON.STRANGERS_LEFT]: "gameOver.reasonStrangersLeft",
  [WIN_REASON.PARITY]: "gameOver.reasonParity",
  [WIN_REASON.CRITICAL_SABOTAGE]: "gameOver.reasonCriticalSabotage",
};

/**
 * The results screen: winning faction, every role revealed, and a "Back to
 * Lobby" reset that only the host can trigger — the same host-only pattern
 * as starting the game. Resetting is a request; the server decides whether
 * it actually happens and drives every client back via the phase change.
 */
export function GameOverScreen({ room }: GameOverScreenProps) {
  const { t } = useTranslation();
  const [roster, setRoster] = useState(() => readRoster(room));
  const [hostId, setHostId] = useState(room.state.hostId);

  useEffect(() => {
    const sync = () => setRoster(readRoster(room));
    const unlistenHost = room.state.listen("hostId", setHostId);
    room.onStateChange(sync);
    sync();
    return () => {
      unlistenHost();
      room.onStateChange.remove(sync);
    };
  }, [room]);

  const isHost = hostId === room.sessionId;
  const townsfolkWon = room.state.winningFaction === FACTION.TOWNSFOLK;
  const reasonKey = REASON_KEY[room.state.winReason] ?? "gameOver.reasonTasks";

  return (
    <div
      className={`panel game-over ${townsfolkWon ? "game-over-townsfolk" : "game-over-stranger"}`}
    >
      <p className="reveal-intro">{t("gameOver.intro")}</p>
      <h1 className="reveal-role">
        {townsfolkWon ? t("gameOver.townsfolkWin") : t("gameOver.strangersWin")}
      </h1>
      <p className="hint">{t(reasonKey)}</p>

      <ul className="roster game-over-roster">
        {roster.map((entry) => {
          // Registry-driven: the label comes from the role's own i18n entry
          // and the styling from its faction, so a new role reveals itself
          // here with no change to this file.
          const hostileFaction = roleById(entry.role)?.faction === FACTION.STRANGER;
          return (
            <li key={entry.id}>
              <span>{entry.name}</span>
              <span className={hostileFaction ? "role-tag role-tag-stranger" : "role-tag"}>
                {t(`roleInfo.${entry.role}.name`)}
              </span>
            </li>
          );
        })}
      </ul>

      {isHost ? (
        <button type="button" onClick={() => room.send("return_to_lobby")}>
          {t("gameOver.backToLobby")}
        </button>
      ) : (
        <p className="hint">{t("gameOver.waitingForHost")}</p>
      )}
    </div>
  );
}
