import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import {
  DISCUSSION_MS,
  MEETING_STAGE,
  ROLE_DEFINITIONS,
  SKIP_VOTE,
  VOTING_MS,
  roleById,
  type AbilityStateMessage,
  type CameraRevealMessage,
  type ChatMessage,
} from "@foghaven/shared";
import type { GameState } from "../net/types";
import { privateStateFor } from "../net/client";
import { ChatPanel } from "./ChatPanel";
import { VotePanel, type Candidate } from "./VotePanel";
import { useCountdown } from "./useCountdown";

interface MeetingScreenProps {
  room: Room<GameState>;
  messages: ChatMessage[];
  onSendChat: (text: string) => void;
  /** The local player's own secret role — decides which meeting-only control, if any, to show. */
  role: string | null;
  /** A watchman's camera footage, if the local player placed one this round — captured in App. */
  cameraReveal: CameraRevealMessage | null;
  /** Whether the Silencer gagged the local player for this meeting — captured in App. */
  silenced: boolean;
  /** Open the report dialog for a player. Absent for guests, who cannot report. */
  onReport?: (playerId: string, playerName: string) => void;
  /** Cast a vote to mute someone. Absent when the host has turned vote-mute off. */
  onVoteMute?: (playerId: string) => void;
}

interface MeetingSnapshot {
  stage: string;
  isEmergency: boolean;
  reporterName: string;
  bodyName: string;
  candidates: Candidate[];
  isGhost: boolean;
  ejectedName: string;
  ejectedWasStranger: boolean;
  ejectionConfirmed: boolean;
  tallies: Array<{ targetId: string; targetName: string; count: number; voterNames: string }>;
}

function readSnapshot(room: Room<GameState>): MeetingSnapshot {
  const dead = new Set<string>(room.state.deadPlayerIds);

  const candidates: Candidate[] = [];
  room.state.players.forEach((player, id) => {
    // The graveyard is the reliable liveness signal here — a living client's
    // copy of a dead player is a frozen snapshot that still says alive.
    if (!dead.has(id)) {
      candidates.push({ id, name: player.name, hasVoted: player.hasVoted });
    }
  });

  const tallies: MeetingSnapshot["tallies"] = [];
  room.state.voteResults.forEach((tally) => {
    tallies.push({
      targetId: tally.targetId,
      targetName: tally.targetName,
      count: tally.count,
      voterNames: tally.voterNames,
    });
  });
  tallies.sort((a, b) => b.count - a.count);

  return {
    stage: room.state.meetingStage,
    isEmergency: room.state.meetingIsEmergency,
    reporterName: room.state.players.get(room.state.meetingReporterId)?.name ?? "?",
    // Sent as a name rather than looked up by id: the reported player is dead
    // by now and so is filtered out of a living client's `players` map.
    bodyName: room.state.meetingBodyName,
    candidates,
    isGhost: dead.has(room.sessionId),
    ejectedName: room.state.ejectedPlayerName,
    ejectedWasStranger: room.state.ejectedWasStranger,
    ejectionConfirmed: room.state.ejectionConfirmed,
    tallies,
  };
}

/**
 * The whole meeting: discussion, ballot, then results. This replaces the game
 * view entirely (see `App`'s `SCREEN_FOR_PHASE`), which is what makes the
 * movement lock free — there is no Phaser input loop running underneath.
 *
 * Every transition between stages is the server's call; this only renders
 * whichever stage it is told about. The two meeting-only abilities
 * (Alderman, Constable) render here rather than in `GameView` because their
 * `usablePhase` is `"meeting"` — see the shared role registry.
 */
export function MeetingScreen({
  room,
  messages,
  onSendChat,
  role,
  cameraReveal,
  silenced,
  onReport,
  onVoteMute,
}: MeetingScreenProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState(() => readSnapshot(room));
  const [myVote, setMyVote] = useState<string | null>(null);
  const [stageStartedAt, setStageStartedAt] = useState(() => Date.now());

  // The local role's one meeting-phase ability, if it has one (Alderman,
  // Constable, Assassin — mutually exclusive, a role never has two).
  const meetingAbilitySlot = useMemo(() => {
    const definition = role ? roleById(role) : undefined;
    return definition?.abilities.find((slot) => slot.usablePhase === "meeting");
  }, [role]);

  const [abilityUsesLeft, setAbilityUsesLeft] = useState<number | null>(() => {
    const seeded = meetingAbilitySlot ? privateStateFor(room).abilities[meetingAbilitySlot.ability] : undefined;
    return seeded ? seeded.usesLeft : null;
  });
  // Which candidate the constable/assassin has armed a shot/accusation
  // against, pending a second confirming click — both are irreversible and
  // can turn on the actor themselves, so a single misclick must not fire it.
  const [armedShotTargetId, setArmedShotTargetId] = useState<string | null>(null);
  // The Assassin's currently-picked role guess for the armed target, if any.
  const [armedRoleGuess, setArmedRoleGuess] = useState<string>("");

  useEffect(() => {
    const sync = () => setSnapshot(readSnapshot(room));
    room.onStateChange(sync);
    sync();

    const offAbilityState: () => void = room.onMessage<AbilityStateMessage>(
      "abilityState",
      (msg) => {
        if (meetingAbilitySlot && msg.abilityId === meetingAbilitySlot.ability) {
          setAbilityUsesLeft(msg.usesLeft);
        }
      },
    );

    return () => {
      room.onStateChange.remove(sync);
      offAbilityState();
    };
  }, [room, meetingAbilitySlot]);

  // Restart the local countdown whenever the server moves the stage on.
  useEffect(() => {
    setStageStartedAt(Date.now());
    setArmedShotTargetId(null);
    setArmedRoleGuess("");
  }, [snapshot.stage]);

  const stageDurationMs =
    snapshot.stage === MEETING_STAGE.DISCUSSION
      ? DISCUSSION_MS
      : snapshot.stage === MEETING_STAGE.VOTING
        ? VOTING_MS
        : 0;
  const remainingMs = useCountdown(stageDurationMs, stageStartedAt);
  const seconds = Math.ceil(remainingMs / 1000);

  const handleVote = useCallback(
    (targetId: string) => {
      // Optimistic only for the local "you picked this" highlight; the server
      // decides whether the ballot actually counts.
      setMyVote(targetId);
      room.send("vote", { targetId });
    },
    [room],
  );

  const handleDoubleVote = useCallback(() => {
    room.send("ability", { abilityId: "double_vote" });
  }, [room]);

  const handleConfirmShot = useCallback(
    (targetId: string) => {
      room.send("ability", { abilityId: "execute_shot", targetId });
      setArmedShotTargetId(null);
    },
    [room],
  );

  const handleConfirmAccusation = useCallback(
    (targetId: string, roleGuess: string) => {
      room.send("ability", { abilityId: "assassinate", targetId, roleGuess });
      setArmedShotTargetId(null);
      setArmedRoleGuess("");
    },
    [room],
  );

  const contextLine = snapshot.isEmergency
    ? t("meeting.emergencyContext", { reporter: snapshot.reporterName })
    : t("meeting.bodyContext", {
        reporter: snapshot.reporterName,
        victim: snapshot.bodyName,
      });

  const ejectionLine = useMemo(() => {
    if (!snapshot.ejectedName) {
      return t("meeting.nobodyEjected");
    }
    if (!snapshot.ejectionConfirmed) {
      return t("meeting.ejectedPlain", { name: snapshot.ejectedName });
    }
    return snapshot.ejectedWasStranger
      ? t("meeting.ejectedWasStranger", { name: snapshot.ejectedName })
      : t("meeting.ejectedWasNotStranger", { name: snapshot.ejectedName });
  }, [snapshot.ejectedName, snapshot.ejectionConfirmed, snapshot.ejectedWasStranger, t]);

  const ability = meetingAbilitySlot?.ability ?? null;
  const abilitySpent = abilityUsesLeft !== null && abilityUsesLeft <= 0;
  const showAlderman =
    ability === "double_vote" && !snapshot.isGhost && snapshot.stage === MEETING_STAGE.VOTING;
  const showConstable =
    ability === "execute_shot" &&
    !snapshot.isGhost &&
    (snapshot.stage === MEETING_STAGE.DISCUSSION || snapshot.stage === MEETING_STAGE.VOTING);
  const showAssassin =
    ability === "assassinate" &&
    !snapshot.isGhost &&
    (snapshot.stage === MEETING_STAGE.DISCUSSION || snapshot.stage === MEETING_STAGE.VOTING);
  // Every role id in the registry, for the Assassin's guess dropdown — the
  // fill role (Villager) is a legitimate guess like any other.
  const guessableRoles = useMemo(() => ROLE_DEFINITIONS.map((definition) => definition.id), []);

  return (
    <div className="meeting-layout">
      <div className="panel meeting">
        <h1>{t("meeting.heading")}</h1>
        <p className="hint">{contextLine}</p>
        {silenced && !snapshot.isGhost && (
          <p className="hint silenced-notice">{t("abilities.silence.notifyTarget")}</p>
        )}

        {cameraReveal && (
          <div className="camera-reveal">
            <p className="meeting-stage-label">
              {t("abilities.place_camera.revealHeading", { room: t(`rooms.${cameraReveal.roomSlug}`) })}
            </p>
            {cameraReveal.names.length > 0 ? (
              <ul className="roster">
                {cameraReveal.names.map((name, index) => (
                  <li key={`${name}-${index}`}>{name}</li>
                ))}
              </ul>
            ) : (
              <p className="hint">{t("abilities.place_camera.revealEmpty")}</p>
            )}
            {cameraReveal.blinded && (
              <p className="hint">{t("abilities.place_camera.revealBlinded")}</p>
            )}
          </div>
        )}

        {snapshot.stage === MEETING_STAGE.DISCUSSION && (
          <>
            <p className="meeting-stage-label">{t("meeting.discussion")}</p>
            <p className="meeting-timer" data-countdown="discussion">
              {seconds}
            </p>
            {/* The discussion roster doubles as the moderation surface: this is
                when someone is actually being abusive, and the moment they will
                bother to do something about it. Never offered against oneself. */}
            <ul className="roster">
              {snapshot.candidates.map((candidate) => (
                <li key={candidate.id}>
                  <span>{candidate.name}</span>
                  {candidate.id !== room.sessionId && (
                    <span className="roster-moderation">
                      {onVoteMute && (
                        <button
                          type="button"
                          className="moderation-button"
                          title={t("moderation.voteMuteTitle")}
                          aria-label={t("moderation.voteMuteLabel", { name: candidate.name })}
                          onClick={() => onVoteMute(candidate.id)}
                        >
                          🔇
                        </button>
                      )}
                      {onReport && (
                        <button
                          type="button"
                          className="moderation-button"
                          title={t("moderation.reportTitle")}
                          aria-label={t("moderation.reportLabel", { name: candidate.name })}
                          onClick={() => onReport(candidate.id, candidate.name)}
                        >
                          ⚑
                        </button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {snapshot.stage === MEETING_STAGE.VOTING && (
          <>
            <p className="meeting-stage-label">{t("meeting.voting")}</p>
            <p className="meeting-timer" data-countdown="voting">
              {seconds}
            </p>
            <VotePanel
              candidates={snapshot.candidates}
              myVote={myVote}
              canVote={!snapshot.isGhost}
              onVote={handleVote}
            />
            {showAlderman && (
              <button
                type="button"
                className="secondary alderman-double-vote"
                onClick={handleDoubleVote}
                disabled={abilitySpent}
              >
                {abilitySpent
                  ? t("abilities.double_vote.armed")
                  : t("abilities.double_vote.button")}
              </button>
            )}
          </>
        )}

        {showConstable && (
          <div className="constable-panel">
            <p className="meeting-stage-label">{t("abilities.execute_shot.heading")}</p>
            <ul className="constable-target-list">
              {snapshot.candidates
                .filter((candidate) => candidate.id !== room.sessionId)
                .map((candidate) => (
                  <li key={candidate.id}>
                    {armedShotTargetId === candidate.id ? (
                      <>
                        <span>{t("abilities.execute_shot.confirmPrompt", { name: candidate.name })}</span>
                        <button
                          type="button"
                          className="constable-confirm"
                          onClick={() => handleConfirmShot(candidate.id)}
                        >
                          {t("abilities.execute_shot.confirmButton")}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setArmedShotTargetId(null)}
                        >
                          {t("abilities.execute_shot.cancelButton")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="constable-target"
                        onClick={() => setArmedShotTargetId(candidate.id)}
                        disabled={abilitySpent}
                      >
                        {t("abilities.execute_shot.button", { name: candidate.name })}
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        )}

        {showAssassin && (
          <div className="assassin-panel">
            <p className="meeting-stage-label">{t("abilities.assassinate.heading")}</p>
            <ul className="assassin-target-list">
              {snapshot.candidates
                .filter((candidate) => candidate.id !== room.sessionId)
                .map((candidate) => (
                  <li key={candidate.id}>
                    {armedShotTargetId === candidate.id ? (
                      <>
                        <select
                          className="assassin-role-select"
                          value={armedRoleGuess}
                          onChange={(event) => setArmedRoleGuess(event.target.value)}
                        >
                          <option value="">{t("abilities.assassinate.pickRole")}</option>
                          {guessableRoles.map((roleId) => (
                            <option key={roleId} value={roleId}>
                              {t(`roleInfo.${roleId}.name`)}
                            </option>
                          ))}
                        </select>
                        <span>
                          {t("abilities.assassinate.confirmPrompt", { name: candidate.name })}
                        </span>
                        <button
                          type="button"
                          className="assassin-confirm"
                          disabled={!armedRoleGuess}
                          onClick={() => handleConfirmAccusation(candidate.id, armedRoleGuess)}
                        >
                          {t("abilities.assassinate.confirmButton")}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setArmedShotTargetId(null);
                            setArmedRoleGuess("");
                          }}
                        >
                          {t("abilities.assassinate.cancelButton")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="assassin-target"
                        onClick={() => setArmedShotTargetId(candidate.id)}
                        disabled={abilitySpent}
                      >
                        {t("abilities.assassinate.button", { name: candidate.name })}
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        )}

        {snapshot.stage === MEETING_STAGE.RESULTS && (
          <>
            <p className="meeting-stage-label">{t("meeting.results")}</p>
            <p className="ejection-line" data-ejection>
              {ejectionLine}
            </p>
            <ul className="tally-list">
              {snapshot.tallies.map((tally) => (
                <li key={tally.targetId}>
                  <span className="tally-name">
                    {tally.targetId === SKIP_VOTE ? t("vote.skip") : tally.targetName}
                  </span>
                  <span className="tally-count">{tally.count}</span>
                  {tally.voterNames && <span className="tally-voters">{tally.voterNames}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <ChatPanel
        messages={messages}
        canSend={snapshot.stage !== MEETING_STAGE.RESULTS && (snapshot.isGhost || !silenced)}
        isGhost={snapshot.isGhost}
        onSend={onSendChat}
      />
    </div>
  );
}
