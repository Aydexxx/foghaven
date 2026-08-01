import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import { RANDOM_ROLE_PICK } from "@foghaven/shared";
import type { GameState } from "../net/types";
import { useCountdown } from "./useCountdown";
import { RoleEmblem } from "./RoleEmblem";
import { Card, Panel } from "./primitives";

interface RoleSelectScreenProps {
  room: Room<GameState>;
  /** This client's own options — from its own private `roleOptions` message. */
  options: string[];
  /** How long was left when the options arrived. Counted down locally. */
  deadlineMs: number;
  /** When the options arrived, so the countdown restarts on a reconnect re-send. */
  receivedAt: number;
}

interface RosterEntry {
  id: string;
  name: string;
  done: boolean;
  isSelf: boolean;
}

/**
 * Pick your own role, from a hand only you can see.
 *
 * Every card on this screen came from this client's own private
 * `roleOptions` message; there is no path by which it could render anyone
 * else's, because it is never sent anyone else's. What it shows about other
 * players is exactly one bit each — whether they have decided — read from the
 * public `hasPickedRole` flag.
 *
 * The countdown is presentation, like every other timer in this app: the
 * server owns the deadline and resolves the phase whatever this shows. Letting
 * it run out is a real choice and costs nothing — it resolves to Random, which
 * is also a card you can press deliberately.
 *
 * Re-picking before the deadline is allowed. The room learns only that you
 * have chosen, never how many times you changed your mind.
 */
export function RoleSelectScreen({
  room,
  options,
  deadlineMs,
  receivedAt,
}: RoleSelectScreenProps) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const remainingMs = useCountdown(deadlineMs, receivedAt);

  useEffect(() => {
    const sync = () => {
      const entries: RosterEntry[] = [];
      room.state.players.forEach((player, id) => {
        entries.push({
          id,
          name: player.name,
          done: player.hasPickedRole,
          isSelf: id === room.sessionId,
        });
      });
      setRoster(entries);
    };
    room.onStateChange(sync);
    sync();
    return () => {
      room.onStateChange.remove(sync);
    };
  }, [room]);

  const choose = (roleId: string) => {
    setPicked(roleId);
    // A request, like everything else. The server re-checks that this id was
    // actually in our hand before it counts for anything.
    room.send("pick_role", { roleId });
  };

  const seconds = Math.ceil(remainingMs / 1000);
  const decided = roster.filter((entry) => entry.done).length;

  return (
    <Panel className="panel role-select">
      <h1>{t("roleSelect.heading")}</h1>
      <p className="hint">{t("roleSelect.intro")}</p>

      <p className="role-select-timer" data-countdown="roleSelect">
        {t("roleSelect.timer", { seconds })}
      </p>

      <ul className="role-select-options">
        {options.map((roleId) => (
          <li key={roleId}>
            <Card
              selected={picked === roleId}
              className="role-select-card"
              role="button"
              tabIndex={0}
              aria-pressed={picked === roleId}
              onClick={() => choose(roleId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  choose(roleId);
                }
              }}
            >
              <RoleEmblem roleId={roleId} />
              <span className="role-select-card-name">{t(`roleInfo.${roleId}.name`)}</span>
              <span className="role-select-card-hint">{t(`roleInfo.${roleId}.hint`)}</span>
            </Card>
          </li>
        ))}

        {/* Always offered, always last, and identical in every hand — the one
            card whose presence tells nobody anything. */}
        <li>
          <Card
            selected={picked === RANDOM_ROLE_PICK}
            className="role-select-card role-select-card-random"
            role="button"
            tabIndex={0}
            aria-pressed={picked === RANDOM_ROLE_PICK}
            onClick={() => choose(RANDOM_ROLE_PICK)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                choose(RANDOM_ROLE_PICK);
              }
            }}
          >
            <RoleEmblem roleId={RANDOM_ROLE_PICK} placeholderLabel="?" />
            <span className="role-select-card-name">{t("roleSelect.randomName")}</span>
            <span className="role-select-card-hint">{t("roleSelect.randomHint")}</span>
          </Card>
        </li>
      </ul>

      <p className="hint">
        {picked ? t("roleSelect.locked") : t("roleSelect.pending")}
      </p>

      {/* One bit per player, which is all the server publishes. Deliberately
          no card counts, no timings, no hint of what anyone was offered. */}
      <p className="role-select-progress">
        {t("roleSelect.decidedCount", { count: decided, total: roster.length })}
      </p>
      <ul className="role-select-roster">
        {roster.map((entry) => (
          <li key={entry.id} data-done={entry.done}>
            <span>{entry.isSelf ? t("roleSelect.you", { name: entry.name }) : entry.name}</span>
            <span className="role-select-roster-state">
              {entry.done ? t("roleSelect.done") : t("roleSelect.choosing")}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
