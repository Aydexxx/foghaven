import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import {
  MIN_PLAYERS,
  PRESET,
  PRESET_CUSTOM,
  ROLE_DEFINITIONS,
  SETTING_DEFINITIONS,
  type Preset,
} from "@foghaven/shared";
import type { GameState } from "../net/types";
import { readRoomSettings } from "../net/settings";

interface LobbyRoomProps {
  room: Room<GameState>;
  onLeave: () => void;
}

interface RosterEntry {
  id: string;
  name: string;
  connected: boolean;
}

const PRESETS: Preset[] = [PRESET.CLASSIC, PRESET.CHAOS, PRESET.PURE];

/**
 * The waiting room: room code, a live roster, the role settings, and a Start
 * button that only the host ever sees. Everything is a *request* — the
 * server decides whether a start, a preset, or a role toggle actually takes
 * effect; non-hosts see the same settings read-only, straight from the
 * public state the server maintains.
 *
 * The role list renders from the shared registry (`ROLE_DEFINITIONS`), so a
 * new role appears here with no change to this file.
 */
export function LobbyRoom({ room, onLeave }: LobbyRoomProps) {
  const { t } = useTranslation();
  const [players, setPlayers] = useState<RosterEntry[]>([]);
  const [hostId, setHostId] = useState(room.state.hostId);
  const [copied, setCopied] = useState(false);
  const [enabledRoleIds, setEnabledRoleIds] = useState<string[]>([]);
  const [preset, setPreset] = useState(room.state.rolePreset);
  const [settings, setSettings] = useState<Record<string, number | boolean>>(() =>
    readRoomSettings(room),
  );

  useEffect(() => {
    const sync = () => {
      const current: RosterEntry[] = [];
      room.state.players.forEach((player, id) =>
        current.push({ id, name: player.name, connected: player.connected }),
      );
      setPlayers(current);

      const ids: string[] = [];
      room.state.enabledRoleIds.forEach((id) => ids.push(id));
      setEnabledRoleIds(ids);
      setPreset(room.state.rolePreset);
      setSettings(readRoomSettings(room));
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
  // Mirrors the server's own rule: a player inside their reconnection grace
  // period is dropped when the round starts, so they must not be what makes it
  // startable. The server re-checks this regardless — this only keeps the
  // button from promising something that would then quietly not happen.
  const presentCount = players.filter((player) => player.connected).length;
  const canStart = presentCount >= MIN_PLAYERS;

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
          <li key={player.id} className={player.connected ? undefined : "roster-away"}>
            <span>{player.name}</span>
            {!player.connected && (
              <span className="away-tag">{t("lobbyRoom.disconnectedTag")}</span>
            )}
            {player.id === hostId && <span className="host-tag">{t("lobbyRoom.hostTag")}</span>}
          </li>
        ))}
      </ul>

      <div className="role-settings">
        <h2>{t("lobbyRoom.rolesHeading")}</h2>

        <div className="preset-row">
          {PRESETS.map((option) => (
            <button
              key={option}
              type="button"
              className={preset === option ? "preset-button preset-button-active" : "preset-button"}
              onClick={() => room.send("set_preset", { preset: option })}
              disabled={!isHost}
            >
              {t(`lobbyRoom.preset.${option}`)}
            </button>
          ))}
          {preset === PRESET_CUSTOM && (
            <span className="preset-custom-tag">{t("lobbyRoom.preset.custom")}</span>
          )}
        </div>

        <ul className="role-toggle-list">
          {ROLE_DEFINITIONS.map((definition) => {
            const enabled = enabledRoleIds.includes(definition.id);
            // The fill role holds every leftover seat; the server refuses to
            // disable it, so don't offer to.
            const locked = definition.fill === true;
            return (
              <li key={definition.id} className="role-toggle-row">
                <label>
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={!isHost || locked}
                    onChange={(event) =>
                      room.send("set_role_enabled", {
                        roleId: definition.id,
                        enabled: event.target.checked,
                      })
                    }
                  />
                  <span className="role-toggle-name">
                    {t(`roleInfo.${definition.id}.name`)}
                  </span>
                </label>
                <span className={`faction-tag faction-tag-${definition.faction}`}>
                  {t(`factions.${definition.faction}`)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="balance-settings">
        <h2>{t("lobbyRoom.balanceHeading")}</h2>

        <ul className="setting-list">
          {SETTING_DEFINITIONS.map((definition) => {
            const value = settings[definition.id];

            if (definition.type === "boolean") {
              return (
                <li key={definition.id} className="setting-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={value === true}
                      disabled={!isHost}
                      onChange={(event) =>
                        room.send("set_setting", {
                          id: definition.id,
                          value: event.target.checked,
                        })
                      }
                    />
                    <span>{t(`lobbyRoom.settings.${definition.id}Label`)}</span>
                  </label>
                </li>
              );
            }

            // Number setting: ms-unit settings are shown/stepped in whole
            // seconds (nobody wants to read "45000") — the only per-setting
            // knowledge this UI needs, and it's read straight off the
            // registry's own `unit` field, not hardcoded per id.
            const divisor = definition.unit === "ms" ? 1000 : 1;
            const raw = typeof value === "number" ? value : (definition.default as number);
            const displayValue = raw / divisor;
            const displayMin = (definition.min ?? 0) / divisor;
            const displayMax = (definition.max ?? raw) / divisor;
            const displayStep = (definition.step ?? 1) / divisor;
            const isAuto = definition.id === "strangerCount" && raw === 0;

            return (
              <li key={definition.id} className="setting-row">
                <label>
                  <span className="setting-label">
                    {t(`lobbyRoom.settings.${definition.id}Label`)}
                    {": "}
                    <strong>
                      {isAuto
                        ? t("lobbyRoom.settings.autoLabel")
                        : definition.unit === "ms"
                          ? t("lobbyRoom.settings.secondsValue", { value: displayValue })
                          : displayValue}
                    </strong>
                  </span>
                  <input
                    type="range"
                    min={displayMin}
                    max={displayMax}
                    step={displayStep}
                    value={displayValue}
                    disabled={!isHost}
                    onChange={(event) =>
                      room.send("set_setting", {
                        id: definition.id,
                        value: Number(event.target.value) * divisor,
                      })
                    }
                  />
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="hint">
        {t("lobbyRoom.playerCount", { count: presentCount, min: MIN_PLAYERS })}
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
