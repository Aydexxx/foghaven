import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import {
  PRESET,
  PRESET_CUSTOM,
  ROLE_DEFINITIONS,
  roleSelectOptionCount,
  SETTING_DEFINITIONS,
  type Preset,
} from "@foghaven/shared";
import type { GameState } from "../net/types";
import { Button, Panel, Slider } from "./primitives";

const PRESETS: Preset[] = [PRESET.CLASSIC, PRESET.CHAOS, PRESET.PURE];

interface LobbySettingsPanelProps {
  room: Room<GameState>;
  /** Whether the local player is the host — non-hosts see the same values, read-only. */
  isHost: boolean;
  preset: string;
  enabledRoleIds: readonly string[];
  settings: Record<string, number | boolean>;
  /** Connected head count — feeds the public role-selection availability check. */
  playerCount: number;
  onClose: () => void;
}

/**
 * The role and balance settings, as an overlay opened from the Tavern's long
 * table rather than as the lobby's primary interface (which is now the room
 * itself — see `LobbyRoom`).
 *
 * Every control here is byte-for-byte the same *request* it always was: the
 * server decides whether a preset, toggle or slider actually takes effect,
 * and non-hosts render the identical panel read-only straight from public
 * state. Moving this behind a table changed where it opens from and nothing
 * about what it does.
 *
 * The role list still renders from the shared registry (`ROLE_DEFINITIONS`)
 * and the balance list from `SETTING_DEFINITIONS`, so a new role or tunable
 * appears here with no change to this file.
 */
export function LobbySettingsPanel({
  room,
  isHost,
  preset,
  enabledRoleIds,
  settings,
  playerCount,
  onClose,
}: LobbySettingsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="lobby-settings-overlay" role="dialog" aria-label={t("lobbyRoom.settingsHeading")}>
      <Panel className="lobby-settings-panel">
        <div className="lobby-settings-header">
          <h2>{t("lobbyRoom.settingsHeading")}</h2>
          <Button variant="link" onClick={onClose}>
            {t("lobbyRoom.closeSettingsButton")}
          </Button>
        </div>

        {!isHost && <p className="hint">{t("lobbyRoom.settingsReadOnly")}</p>}

        <div className="role-settings">
          <h3>{t("lobbyRoom.rolesHeading")}</h3>

          <div className="preset-row">
            {PRESETS.map((option) => (
              <Button
                key={option}
                className={
                  preset === option ? "preset-button preset-button-active" : "preset-button"
                }
                onClick={() => room.send("set_preset", { preset: option })}
                disabled={!isHost}
              >
                {t(`lobbyRoom.preset.${option}`)}
              </Button>
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
                    <span className="role-toggle-name">{t(`roleInfo.${definition.id}.name`)}</span>
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
          <h3>{t("lobbyRoom.balanceHeading")}</h3>

          <ul className="setting-list">
            {SETTING_DEFINITIONS.map((definition) => {
              const value = settings[definition.id];

              if (definition.type === "boolean") {
                // Role selection needs both factions to have enough distinct
                // roles in the deal to offer an equal hand. That's computed
                // from public state alone, so saying so here reveals nothing
                // — and silently doing nothing when the host turns it on
                // would be far worse than explaining why.
                const unavailable =
                  definition.id === "roleSelectionEnabled" &&
                  value === true &&
                  roleSelectOptionCount(playerCount, enabledRoleIds) === 0;

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
                    {unavailable && (
                      <p className="hint setting-row-note">
                        {t("lobbyRoom.settings.roleSelectionUnavailable")}
                      </p>
                    )}
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

              return (
                <li key={definition.id} className="setting-row">
                  <Slider
                    label={t(`lobbyRoom.settings.${definition.id}Label`)}
                    min={displayMin}
                    max={displayMax}
                    step={displayStep}
                    value={displayValue}
                    disabled={!isHost}
                    onChange={(next) =>
                      room.send("set_setting", {
                        id: definition.id,
                        value: next * divisor,
                      })
                    }
                    formatValue={(shown) =>
                      definition.id === "strangerCount" && shown === 0
                        ? t("lobbyRoom.settings.autoLabel")
                        : definition.unit === "ms"
                          ? t("lobbyRoom.settings.secondsValue", { value: shown })
                          : String(shown)
                    }
                  />
                </li>
              );
            })}
          </ul>
        </div>
      </Panel>
    </div>
  );
}
