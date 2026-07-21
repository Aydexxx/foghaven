import type { Room } from "colyseus.js";
import { SETTING_DEFINITIONS, parseSettingValue } from "@foghaven/shared";
import type { GameState } from "./types";

/**
 * The client-side mirror of `GameRoom`'s `getNumberSetting`/`getBooleanSetting`
 * readers: every balance setting, parsed from the room's public
 * `state.settings` map back into its typed value (falling back to the
 * registry default for anything the host hasn't touched yet). One generic
 * loop over `SETTING_DEFINITIONS` — a new setting needs no change here.
 *
 * Used by `LobbyRoom` (to render the host's current tuning) and by whichever
 * screen needs a specific value (e.g. the reveal screen's stranger tally,
 * which must apply the same `strangerCount` override the server dealt with).
 */
export function readRoomSettings(room: Room<GameState>): Record<string, number | boolean> {
  const values: Record<string, number | boolean> = {};
  for (const definition of SETTING_DEFINITIONS) {
    values[definition.id] = parseSettingValue(definition, room.state.settings.get(definition.id));
  }
  return values;
}
