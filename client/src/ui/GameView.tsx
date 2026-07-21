import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import {
  roleById,
  type AbilityEffectMessage,
  type AbilityStateMessage,
  type ClientTask,
  type CommuneHintMessage,
  type CriticalSabotageResolvedMessage,
  type CriticalSabotageStartedMessage,
  type InvestigateHintMessage,
} from "@foghaven/shared";
import type { GameState } from "../net/types";
import { privateStateFor } from "../net/client";
import { GameCanvas } from "../game/GameCanvas";
import type { AbilitySlotInfo, AbilityTargetInfo } from "../game/GameScene";
import { TaskBar } from "./TaskBar";
import { TaskList } from "./TaskList";
import { MinigameModal } from "./MinigameModal";
import { AbilityButton } from "./AbilityButton";
import { AbilityHintToast } from "./AbilityHintToast";
import { CriticalSabotageBanner } from "./CriticalSabotageBanner";

interface GameViewProps {
  room: Room<GameState>;
  tasks: ClientTask[];
  /** The local player's own secret role, or null if not yet received. */
  role: string | null;
  onLeave: () => void;
}

/** How long a hint toast stays on screen before clearing itself. */
const HINT_TOAST_MS = 6000;

/** Plain-array snapshot of a colyseus `ArraySchema<string>` — spreading one directly types as `(string | undefined)[]`. */
function snapshotStrings(schemaArray: Iterable<string>): string[] {
  const out: string[] = [];
  for (const value of schemaArray) {
    out.push(value);
  }
  return out;
}

/**
 * In-game screen: React owns the surrounding HUD, the embedded Phaser canvas
 * owns the world. The canvas only ever exists while this component is
 * mounted, which is itself gated on the server's phase reaching "playing" —
 * that's the entire React/Phaser boundary.
 *
 * Mini-games and the ability button are both owned here: the scene reports
 * what is *possible* (a task in range, a target in range), React renders the
 * control, and the server decides whether the resulting request is allowed.
 * Which button appears, what it targets, and what its hints say are all read
 * off the local player's own role definition — a new role needs no change
 * here beyond its i18n strings.
 */
export function GameView({ room, tasks, role, onLeave }: GameViewProps) {
  const { t } = useTranslation();
  const [playerCount, setPlayerCount] = useState(room.state.players.size);
  const [taskBar, setTaskBar] = useState({
    completed: room.state.taskBarCompleted,
    total: room.state.taskBarTotal,
  });
  const [activeTask, setActiveTask] = useState<ClientTask | null>(null);
  const [abilityTargets, setAbilityTargets] = useState<Record<string, AbilityTargetInfo | null>>(
    {},
  );
  // Seeded from what the connection has already been told, so a player who
  // reconnects mid-cooldown (or with their one use already spent) comes back
  // to the truth rather than to a button that claims to be ready. Keyed by
  // ability id — a role can have several abilities now, each on its own
  // independent cooldown.
  const [abilityStates, setAbilityStates] = useState<
    Record<string, { cooldownMs: number; usesLeft: number | null; setAt: number }>
  >(() => {
    const seeded = privateStateFor(room).abilities;
    const initial: Record<string, { cooldownMs: number; usesLeft: number | null; setAt: number }> =
      {};
    for (const [abilityId, message] of Object.entries(seeded)) {
      initial[abilityId] = { cooldownMs: message.cooldownMs, usesLeft: message.usesLeft, setAt: Date.now() };
    }
    return initial;
  });
  const [isGhost, setIsGhost] = useState(false);
  const [commsSabotageActive, setCommsSabotageActive] = useState(
    room.state.commsSabotageActive,
  );
  // Seeded from state (a client already mid-round when this mounts, or a
  // reconnect — see `GameRoom.handleReconnect`'s resend of this same
  // message) so a critical sabotage already running shows up immediately
  // rather than waiting for a broadcast that already happened.
  const [criticalSabotage, setCriticalSabotage] = useState<{
    durationMs: number;
    startedAt: number;
  } | null>(room.state.criticalSabotageActive ? { durationMs: 0, startedAt: Date.now() } : null);
  const [repairedPoints, setRepairedPoints] = useState<string[]>(() =>
    snapshotStrings(room.state.criticalRepairedPoints),
  );
  // A monotonic key alongside the text itself, so two identical hints in a
  // row (two empty communes back to back, say) each still restart the timer
  // rather than the second one silently doing nothing.
  const [hint, setHint] = useState<{ text: string; key: number } | null>(null);

  useEffect(() => {
    const sync = () => {
      setPlayerCount(room.state.players.size);
      setTaskBar({ completed: room.state.taskBarCompleted, total: room.state.taskBarTotal });
      // Read liveness from the public bodies map rather than `alive`: the
      // per-child filter means a living client never receives another
      // player's `alive: false`, so bodies are the one reliable signal.
      setIsGhost(room.state.bodies.has(room.sessionId));
      setCommsSabotageActive(room.state.commsSabotageActive);
      setRepairedPoints(snapshotStrings(room.state.criticalRepairedPoints));
    };
    room.onStateChange(sync);
    sync();

    const offCriticalStarted: () => void = room.onMessage<CriticalSabotageStartedMessage>(
      "criticalSabotageStarted",
      (msg) => setCriticalSabotage({ durationMs: msg.durationMs, startedAt: Date.now() }),
    );
    const offCriticalResolved: () => void = room.onMessage<CriticalSabotageResolvedMessage>(
      "criticalSabotageResolved",
      () => setCriticalSabotage(null),
    );

    const offAbilityState: () => void = room.onMessage<AbilityStateMessage>(
      "abilityState",
      (msg) =>
        setAbilityStates((prev) => ({
          ...prev,
          [msg.abilityId]: { cooldownMs: msg.cooldownMs, usesLeft: msg.usesLeft, setAt: Date.now() },
        })),
    );

    let hintKey = 0;
    const offInvestigate: () => void = room.onMessage<InvestigateHintMessage>(
      "investigateHint",
      (msg) => {
        const text =
          msg.witnessName && msg.apparentFaction
            ? t("abilities.investigate.hintWitness", {
                name: msg.witnessName,
                faction: t(`factions.${msg.apparentFaction}`),
              })
            : t("abilities.investigate.hintNone");
        setHint({ text, key: hintKey++ });
      },
    );
    const offCommune: () => void = room.onMessage<CommuneHintMessage | null>(
      "communeHint",
      (msg) => {
        const text = msg
          ? t("abilities.commune.hintFact", {
              name: msg.name,
              room: t(`rooms.${msg.room}`),
              faction: msg.killerFaction
                ? t(`factions.${msg.killerFaction}`)
                : t("abilities.commune.unknownFaction"),
            })
          : t("abilities.commune.hintNone");
        setHint({ text, key: hintKey++ });
      },
    );
    const offAbilityEffect: () => void = room.onMessage<AbilityEffectMessage>(
      "abilityEffect",
      (msg) => {
        if (msg.type !== "shielded") {
          return;
        }
        const name = room.state.players.get(msg.targetId)?.name ?? "?";
        setHint({ text: t("abilities.protect.hintShielded", { name }), key: hintKey++ });
      },
    );

    return () => {
      room.onStateChange.remove(sync);
      offAbilityState();
      offInvestigate();
      offCommune();
      offAbilityEffect();
      offCriticalStarted();
      offCriticalResolved();
    };
  }, [room, t]);

  // Auto-dismiss whatever hint is currently showing.
  useEffect(() => {
    if (!hint) {
      return;
    }
    const id = setTimeout(() => setHint(null), HINT_TOAST_MS);
    return () => clearTimeout(id);
  }, [hint]);

  const handleTaskTrigger = useCallback((task: ClientTask) => {
    setActiveTask(task);
  }, []);

  const handleMinigameComplete = useCallback(() => {
    setActiveTask((task) => {
      if (task) {
        // The server re-checks distance and ownership itself right now —
        // solving the mini-game only earns the *request*, not the credit.
        room.send("task_interact", { taskId: task.id });
      }
      return null;
    });
  }, [room]);

  const handleMinigameCancel = useCallback(() => setActiveTask(null), []);

  const handleUseAbility = useCallback(
    (abilityId: string, target: AbilityTargetInfo) => {
      // Only ever a request: everything — cooldown, uses, range, faction
      // rules — is re-validated server-side before anything happens. The
      // payload shape follows the target kind: a player or body id, a room
      // slug, or nothing at all.
      if (target.kind === "player" || target.kind === "body") {
        room.send("ability", { abilityId, targetId: target.id });
      } else if (target.kind === "room") {
        room.send("ability", { abilityId, roomSlug: target.room });
      } else {
        room.send("ability", { abilityId });
      }
    },
    [room],
  );

  const roleDefinition = role ? roleById(role) : undefined;
  // Meeting-phase abilities (Alderman, Constable, Assassin) render entirely
  // inside `MeetingScreen` instead — this screen only ever shows the ones
  // usable during open play.
  const abilitySlots: AbilitySlotInfo[] = useMemo(
    () =>
      (roleDefinition?.abilities ?? [])
        .filter((slot) => (slot.usablePhase ?? "playing") === "playing")
        .map((slot) => ({ ability: slot.ability, targetKind: slot.abilityTargetKind ?? "player" })),
    [roleDefinition],
  );

  return (
    <div className="game-view">
      <header className="hud">
        <span className="hud-room">
          {t("game.roomCodeLabel")}: <strong>{room.roomId}</strong>
        </span>
        <span className="hud-players">
          {t("game.playersLabel")}: {playerCount}
        </span>
        {isGhost && <span className="hud-ghost">{t("game.ghostBanner")}</span>}
        <button type="button" onClick={onLeave}>
          {t("game.leaveButton")}
        </button>
      </header>

      <TaskBar completed={taskBar.completed} total={taskBar.total} />

      {criticalSabotage && (
        <CriticalSabotageBanner
          durationMs={criticalSabotage.durationMs}
          startedAt={criticalSabotage.startedAt}
          repairedPoints={repairedPoints}
        />
      )}

      <div className="game-stage">
        {commsSabotageActive ? (
          <p className="task-list-offline">{t("sabotage.comms.taskListOffline")}</p>
        ) : (
          <TaskList tasks={tasks} />
        )}
        <GameCanvas
          room={room}
          tasks={tasks}
          abilitySlots={abilitySlots}
          onTaskTrigger={handleTaskTrigger}
          activeTaskId={activeTask?.id ?? null}
          onAbilityTargetsChange={setAbilityTargets}
        />
        {!isGhost &&
          abilitySlots.map((slot) => {
            const definitionSlot = roleDefinition?.abilities.find(
              (candidate) => candidate.ability === slot.ability,
            );
            const state = abilityStates[slot.ability];
            return (
              <AbilityButton
                key={slot.ability}
                abilityId={slot.ability}
                cooldownMs={state?.cooldownMs ?? 0}
                cooldownSetAt={state?.setAt ?? Date.now()}
                fullCooldownMs={definitionSlot?.cooldownMs ?? 0}
                usesLeft={state ? state.usesLeft : null}
                target={abilityTargets[slot.ability] ?? null}
                onUse={(target) => handleUseAbility(slot.ability, target)}
              />
            );
          })}
        <AbilityHintToast text={hint?.text ?? null} />
      </div>

      {activeTask && (
        <MinigameModal
          task={activeTask}
          onComplete={handleMinigameComplete}
          onCancel={handleMinigameCancel}
        />
      )}
    </div>
  );
}
