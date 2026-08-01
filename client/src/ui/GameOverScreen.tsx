import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import { FACTION, roleById, WIN_REASON, type GameSummaryMessage } from "@foghaven/shared";
import type { GameState } from "../net/types";
import { archetypeForColor } from "../game/characters/assign";
import { VICTORY_POSE_VISUALS } from "../game/characters/cosmeticVisuals";
import { RigPreview } from "./RigPreview";
import { Button, Card, Panel } from "./primitives";

interface GameOverScreenProps {
  room: Room<GameState>;
  /**
   * The "who did what" breakdown — task progress and vote history — captured
   * by `App.tsx` at the top level rather than by this screen; see the doc on
   * its own `gameSummary` state for why. Null on a screen reached by
   * reconnecting straight into game-over: the broadcast is one-shot and isn't
   * resent, the same limitation `cameraReveal` already has.
   */
  summary?: GameSummaryMessage | null;
  /**
   * Open the report dialog for a player. Absent for guests, who have no
   * account to file one from. The results screen is the single most useful
   * place for this: the round is over, roles are public, and it is the first
   * moment anyone has the attention to report what happened during it.
   */
  onReport?: (playerId: string, playerName: string) => void;
}

interface RosterEntry {
  id: string;
  name: string;
  role: string;
  color: string;
  hatId: string;
  accessoryId: string;
  petId: string;
  outfitId: string;
  victoryPoseId: string;
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
    roster.push({
      id: entry.id,
      name: entry.name,
      role: entry.role,
      color: entry.color,
      hatId: entry.hatId,
      accessoryId: entry.accessoryId,
      petId: entry.petId,
      outfitId: entry.outfitId,
      victoryPoseId: entry.victoryPoseId,
    });
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
export function GameOverScreen({ room, summary, onReport }: GameOverScreenProps) {
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
    <Panel
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
          const entryFaction = roleById(entry.role)?.faction;
          const hostileFaction = entryFaction === FACTION.STRANGER;
          // Shown for the winning side only — a loser's equipped victory
          // pose stays exactly that: equipped, unused this round.
          const isWinner = entryFaction === room.state.winningFaction;
          return (
            <li key={entry.id}>
              {isWinner && (
                <Card>
                  <RigPreview
                    archetypeId={archetypeForColor(entry.color).id}
                    hat={entry.hatId || undefined}
                    accessory={entry.accessoryId || undefined}
                    outfit={entry.outfitId || undefined}
                    pet={entry.petId || undefined}
                    pose={entry.victoryPoseId ? VICTORY_POSE_VISUALS[entry.victoryPoseId] : undefined}
                    size={40}
                  />
                </Card>
              )}
              <span>{entry.name}</span>
              <span className={hostileFaction ? "role-tag role-tag-stranger" : "role-tag"}>
                {t(`roleInfo.${entry.role}.name`)}
              </span>
              {onReport && entry.id !== room.sessionId && (
                <Button
                  type="button"
                  variant="default"
                  className="moderation-button"
                  title={t("moderation.reportTitle")}
                  aria-label={t("moderation.reportLabel", { name: entry.name })}
                  onClick={() => onReport(entry.id, entry.name)}
                >
                  ⚑
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {summary && (
        <div className="game-summary">
          <h2 className="game-summary-heading">{t("gameOver.summary.heading")}</h2>
          <ul className="game-summary-players">
            {summary.players.map((entry) => (
              <li key={entry.id} className="game-summary-player-row">
                <span>{entry.name}</span>
                <span className={entry.survived ? "game-summary-survived" : "game-summary-eliminated"}>
                  {t(entry.survived ? "gameOver.summary.survived" : "gameOver.summary.eliminated")}
                </span>
                <span className="game-summary-tasks">
                  {t("gameOver.summary.tasks", {
                    completed: entry.tasksCompleted,
                    total: entry.tasksTotal,
                  })}
                </span>
              </li>
            ))}
          </ul>

          {summary.voteRounds.length > 0 && (
            <div className="game-summary-votes">
              <h3 className="game-summary-heading">{t("gameOver.summary.voteHistory")}</h3>
              {summary.voteRounds.map((round, index) => (
                <div key={index} className="game-summary-vote-round">
                  <p className="game-summary-vote-round-label">
                    {t("gameOver.summary.meetingNumber", { number: index + 1 })}
                  </p>
                  <ul className="game-summary-vote-results">
                    {round.results.map((result) => (
                      <li key={result.targetId}>
                        {result.targetId
                          ? t("gameOver.summary.voteCount", { name: result.targetName, count: result.count })
                          : t("gameOver.summary.voteCountSkip", { count: result.count })}
                      </li>
                    ))}
                  </ul>
                  {round.ballots.length > 0 && (
                    <ul className="game-summary-vote-ballots">
                      {round.ballots.map((ballot, ballotIndex) => (
                        <li key={ballotIndex}>
                          {t("gameOver.summary.ballotLine", {
                            voter: ballot.voterName,
                            target: ballot.targetName || t("gameOver.summary.skipVote"),
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isHost ? (
        <Button type="button" variant="primary" onClick={() => room.send("return_to_lobby")}>
          {t("gameOver.backToLobby")}
        </Button>
      ) : (
        <p className="hint">{t("gameOver.waitingForHost")}</p>
      )}
    </Panel>
  );
}
