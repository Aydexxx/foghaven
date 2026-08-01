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
  type LanternState,
} from "@foghaven/shared";
import type { GameState } from "../net/types";
import { privateStateFor } from "../net/client";
import { ChatPanel } from "./ChatPanel";
import { PlayerVoteCard } from "./PlayerVoteCard";
import { useCountdown } from "./useCountdown";
import { EjectionCutscene } from "./ejection/EjectionCutscene";
import { MeetingCallCutscene } from "./meetingCall/MeetingCallCutscene";
import { OnboardingHintToast } from "./OnboardingHintToast";
import { useOnboardingHint } from "../onboarding/useOnboardingHint";
import { Button, Panel } from "./primitives";
import type { UseVoice } from "../voice/useVoice";
import * as juiceEvents from "../juice/juiceEvents";

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
  /** Drives each card's speaking ring — the same controller `VoiceHud` renders. */
  voice: UseVoice;
  /** Open the report dialog for a player. Absent for guests, who cannot report. */
  onReport?: (playerId: string, playerName: string) => void;
  /** Cast a vote to mute someone. Absent when the host has turned vote-mute off. */
  onVoteMute?: (playerId: string) => void;
}

/** One card's worth of roster data. */
interface RosterCard {
  id: string;
  name: string;
  lanternColor: string;
  lanternState: LanternState;
  dead: boolean;
  hasVoted: boolean;
  connected: boolean;
}

/** Only present once the ballot has resolved — see `PlayerVoteCard`'s own doc on why this must never be populated earlier. */
interface ResolvedTally {
  count: number;
  voterNames: string;
}

interface MeetingSnapshot {
  stage: string;
  isEmergency: boolean;
  reporterName: string;
  bodyName: string;
  /** The room a reported body was found in — empty for an emergency. See the server schema's own doc. */
  bodyRoom: string;
  /**
   * Every player this client currently has cached, living or dead — a card
   * grid is meant to be a room, and a room includes who's already gone. A
   * dead entry only appears here if this client saw them at some point
   * before they died (Colyseus filters gate future changes, not existing
   * data — a client that never had them cached still won't); that is a
   * quiet, acceptable degradation, not a bug: a card for someone this
   * client never actually observed would be inventing information, not
   * displaying it.
   */
  roster: RosterCard[];
  /**
   * Every currently-living player's lantern hex, in roster order — the §10.3
   * meeting-call cutscene's ring. Kept separate from `roster` (which now
   * includes the dead) since the cutscene specifically wants only the living.
   */
  livingLanternColors: string[];
  isGhost: boolean;
  ejectedName: string;
  ejectedWasStranger: boolean;
  ejectionConfirmed: boolean;
  /** Keyed by player id, present only once resolved — see `ResolvedTally`. */
  tallies: Map<string, ResolvedTally>;
}

function readSnapshot(room: Room<GameState>): MeetingSnapshot {
  const dead = new Set<string>(room.state.deadPlayerIds);

  const roster: RosterCard[] = [];
  const livingLanternColors: string[] = [];
  room.state.players.forEach((player, id) => {
    roster.push({
      id,
      name: player.name,
      lanternColor: player.lanternColor,
      lanternState: player.lanternState,
      dead: dead.has(id),
      hasVoted: player.hasVoted,
      connected: player.connected,
    });
    // The graveyard is the reliable liveness signal, not this row's own
    // (possibly stale) `alive` field — see the doc on `roster` above.
    if (!dead.has(id)) {
      livingLanternColors.push(player.lanternColor);
    }
  });
  // Alphabetical, not roster/insertion order: the whole point of a grid over
  // a list is scanning it in under two seconds, and an order that holds
  // still from one render to the next is what makes "where's Alex" a
  // position you memorise rather than a search you redo every glance.
  roster.sort((a, b) => a.name.localeCompare(b.name));

  const tallies = new Map<string, ResolvedTally>();
  room.state.voteResults.forEach((tally) => {
    tallies.set(tally.targetId, { count: tally.count, voterNames: tally.voterNames });
  });

  return {
    stage: room.state.meetingStage,
    isEmergency: room.state.meetingIsEmergency,
    reporterName: room.state.players.get(room.state.meetingReporterId)?.name ?? "?",
    // Sent as a name rather than looked up by id: the reported player is dead
    // by now and so is filtered out of a living client's `players` map.
    bodyName: room.state.meetingBodyName,
    bodyRoom: room.state.meetingBodyRoom,
    roster,
    livingLanternColors,
    isGhost: dead.has(room.sessionId),
    ejectedName: room.state.ejectedPlayerName,
    ejectedWasStranger: room.state.ejectedWasStranger,
    ejectionConfirmed: room.state.ejectionConfirmed,
    tallies,
  };
}

/**
 * The whole meeting: discussion, ballot, then results — one persistent grid
 * of player Cards (ART_BIBLE §8) throughout, rather than three different
 * lists. What each card offers changes with the stage (moderation controls
 * in discussion, a click-to-vote target in voting, the resolved tally once
 * results are in); the roster and the card identity stay exactly the same,
 * which is what makes "where is so-and-so" answerable at a glance the whole
 * way through the meeting instead of resetting every time the stage changes.
 *
 * This replaces the game view entirely (see `App`'s `SCREEN_FOR_PHASE`),
 * which is what makes the movement lock free — there is no Phaser input loop
 * running underneath. Every transition between stages is the server's call;
 * this only renders whichever stage it is told about.
 */
export function MeetingScreen({
  room,
  messages,
  onSendChat,
  role,
  cameraReveal,
  silenced,
  voice,
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
  const timerFraction = stageDurationMs > 0 ? Math.max(0, Math.min(1, remainingMs / stageDurationMs)) : 0;

  // First-time-only, per browser — see onboarding/seenHints.ts. Every mount
  // of this component IS a meeting, so `active` is unconditionally true; the
  // hook itself is what makes sure this only ever fires once.
  const meetingHint = useOnboardingHint("meeting", true, "onboarding.meeting");
  const votingHint = useOnboardingHint(
    "voting",
    snapshot.stage === MEETING_STAGE.VOTING,
    "onboarding.voting",
  );
  const onboardingHint = votingHint ?? meetingHint;

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
  // Only living, non-ghost candidates get the ability panels' target lists
  // below the grid.
  const abilityTargets = useMemo(
    () => snapshot.roster.filter((entry) => !entry.dead && entry.id !== room.sessionId),
    [snapshot.roster, room.sessionId],
  );

  // Resolved here (not inside the cutscene) because `rooms.*` is a plain
  // lookup table independent of which meeting-call variant is playing —
  // `meetingCallTitle` only needs to decide which key/param to use, not how
  // a room slug becomes a display string. Empty for an emergency, same as
  // the underlying `bodyRoom` field.
  const bodyRoomName = snapshot.bodyRoom ? t(`rooms.${snapshot.bodyRoom}`) : "";

  const votingOpen = snapshot.stage === MEETING_STAGE.VOTING;
  const votingLocked = myVote !== null;
  const showResults = snapshot.stage === MEETING_STAGE.RESULTS;

  const speakingPeers = useMemo(() => {
    const ids = new Set<string>();
    voice.state?.peers.forEach((peer) => {
      if (peer.speaking) {
        ids.add(peer.id);
      }
    });
    return ids;
  }, [voice.state]);
  const localSpeaking = voice.state?.transmitting ?? false;

  return (
    <div className="meeting-layout">
      <OnboardingHintToast text={onboardingHint} />
      {snapshot.stage === MEETING_STAGE.DISCUSSION && (
        <MeetingCallCutscene
          isEmergency={snapshot.isEmergency}
          callerName={snapshot.reporterName}
          bodyRoomName={bodyRoomName}
          livingLanternColors={snapshot.livingLanternColors}
        />
      )}
      <Panel className="panel meeting">
        {stageDurationMs > 0 && (
          <div className="meeting-timer-bar" data-countdown-bar={snapshot.stage}>
            <div className="meeting-timer-bar-fill" style={{ transform: `scaleX(${timerFraction})` }} />
          </div>
        )}

        <h1>{t("meeting.heading")}</h1>
        <p className="hint meeting-context">{contextLine}</p>
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

        <p className="meeting-stage-label">
          {snapshot.stage === MEETING_STAGE.DISCUSSION
            ? t("meeting.discussion")
            : snapshot.stage === MEETING_STAGE.VOTING
              ? t("meeting.voting")
              : t("meeting.results")}
        </p>
        {stageDurationMs > 0 && (
          <p className="meeting-timer" data-countdown={snapshot.stage}>
            {seconds}
          </p>
        )}

        {showResults && !snapshot.ejectedName && (
          <p className="ejection-line" data-ejection>
            {t("meeting.nobodyEjected")}
          </p>
        )}
        {showResults && snapshot.ejectedName && (
          // Keyed on `stageStartedAt` so a second ejection later in the same
          // match — or even a different meeting reusing the same player name
          // — remounts fresh rather than reusing a finished-and-settled
          // instance from a previous meeting.
          <EjectionCutscene
            key={stageStartedAt}
            name={snapshot.ejectedName}
            ejectionConfirmed={snapshot.ejectionConfirmed}
            ejectedWasStranger={snapshot.ejectedWasStranger}
          />
        )}

        <ul className="player-vote-grid">
          {snapshot.roster.map((entry) => {
            const isSelf = entry.id === room.sessionId;
            const tally = snapshot.tallies.get(entry.id);
            return (
              <li key={entry.id}>
                <PlayerVoteCard
                  name={entry.name}
                  lanternColor={entry.lanternColor}
                  lanternState={entry.lanternState}
                  dead={entry.dead}
                  hasVoted={entry.hasVoted}
                  connected={entry.connected}
                  speaking={isSelf ? localSpeaking : speakingPeers.has(entry.id)}
                  isSelf={isSelf}
                  selectedByMe={myVote === entry.id}
                  voteCount={showResults ? (tally?.count ?? 0) : undefined}
                  voterNames={showResults ? tally?.voterNames : undefined}
                  onSelect={
                    votingOpen && !snapshot.isGhost && !votingLocked && !entry.dead
                      ? () => handleVote(entry.id)
                      : undefined
                  }
                  onMute={
                    snapshot.stage === MEETING_STAGE.DISCUSSION && onVoteMute && !isSelf && !entry.dead
                      ? () => onVoteMute(entry.id)
                      : undefined
                  }
                  onReport={
                    snapshot.stage === MEETING_STAGE.DISCUSSION && onReport && !isSelf && !entry.dead
                      ? () => onReport(entry.id, entry.name)
                      : undefined
                  }
                />
              </li>
            );
          })}
        </ul>

        {votingOpen && (
          <>
            {/* First-class per the design brief: same size and weight as any
                other primary screen action, not a link buried in the list.
                `data-no-juice` + the explicit `voteCast` call give it the
                same §9 "vote cast" punch a card gets on selection, in place
                of the milder generic button-press punch every other Button
                already receives for free — see `useButtonJuice`'s own doc. */}
            <Button
              variant="default"
              className="vote-skip-button"
              onClick={(event) => {
                juiceEvents.voteCast(event.currentTarget);
                handleVote(SKIP_VOTE);
              }}
              disabled={snapshot.isGhost || votingLocked}
              data-vote-target={SKIP_VOTE}
              data-no-juice
            >
              {myVote === SKIP_VOTE ? t("vote.locked") : t("vote.skip")}
            </Button>
            {snapshot.isGhost && <p className="hint">{t("vote.ghostCannotVote")}</p>}
            {!snapshot.isGhost && votingLocked && <p className="hint">{t("vote.locked")}</p>}

            {showAlderman && (
              <Button
                type="button"
                variant="default"
                className="secondary alderman-double-vote"
                onClick={handleDoubleVote}
                disabled={abilitySpent}
              >
                {abilitySpent
                  ? t("abilities.double_vote.armed")
                  : t("abilities.double_vote.button")}
              </Button>
            )}
          </>
        )}

        {showConstable && (
          <div className="constable-panel">
            <p className="meeting-stage-label">{t("abilities.execute_shot.heading")}</p>
            <ul className="constable-target-list">
              {abilityTargets.map((candidate) => (
                <li key={candidate.id}>
                  {armedShotTargetId === candidate.id ? (
                    <>
                      <span>{t("abilities.execute_shot.confirmPrompt", { name: candidate.name })}</span>
                      <Button
                        type="button"
                        variant="destructive"
                        className="constable-confirm"
                        onClick={() => handleConfirmShot(candidate.id)}
                      >
                        {t("abilities.execute_shot.confirmButton")}
                      </Button>
                      <Button
                        type="button"
                        variant="default"
                        className="secondary"
                        onClick={() => setArmedShotTargetId(null)}
                      >
                        {t("abilities.execute_shot.cancelButton")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="destructive"
                      className="constable-target"
                      onClick={() => setArmedShotTargetId(candidate.id)}
                      disabled={abilitySpent}
                    >
                      {t("abilities.execute_shot.button", { name: candidate.name })}
                    </Button>
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
              {abilityTargets.map((candidate) => (
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
                      <Button
                        type="button"
                        variant="destructive"
                        className="assassin-confirm"
                        disabled={!armedRoleGuess}
                        onClick={() => handleConfirmAccusation(candidate.id, armedRoleGuess)}
                      >
                        {t("abilities.assassinate.confirmButton")}
                      </Button>
                      <Button
                        type="button"
                        variant="default"
                        className="secondary"
                        onClick={() => {
                          setArmedShotTargetId(null);
                          setArmedRoleGuess("");
                        }}
                      >
                        {t("abilities.assassinate.cancelButton")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="destructive"
                      className="assassin-target"
                      onClick={() => setArmedShotTargetId(candidate.id)}
                      disabled={abilitySpent}
                    >
                      {t("abilities.assassinate.button", { name: candidate.name })}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <ChatPanel
        messages={messages}
        canSend={snapshot.stage !== MEETING_STAGE.RESULTS && (snapshot.isGhost || !silenced)}
        isGhost={snapshot.isGhost}
        onSend={onSendChat}
      />
    </div>
  );
}
