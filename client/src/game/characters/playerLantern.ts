/**
 * Maps a player to their §3.5 lantern colour — the light they carry, which
 * ART_BIBLE §3.5/§4.1 make the *entire* basis of player identity (everyone is
 * an identical Havener; only the lantern differs).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * TODO(7.7+): DOCUMENTED DEBT — the lantern identity is not actually unique.
 *
 * There is no lantern-identity field on the server. It sends `player.color`
 * from the 10-entry `PLAYER_COLORS`, and `GameRoom.pickColor()` WRAPS once all
 * ten are taken (`size % PLAYER_COLORS.length`), so players 11–15 in a full
 * room receive DUPLICATE `player.color` values. That collision is upstream of
 * this helper — two players already share a colour before we ever map it to a
 * lantern.
 *
 * On top of that, §3.5 defines 14 lanterns but `MAX_PLAYERS` is 15, so even a
 * perfect per-player lantern field could not uniquely light a full lobby.
 *
 * This helper therefore maps through all 14 §3.5 lanterns (not the 10-colour
 * bridge) and is faithful to whatever colour it is given — but it CANNOT
 * invent uniqueness the source data doesn't have. A real fix is a server-side
 * lantern-identity field drawn from §3.5, plus reconciling MAX_PLAYERS(15)
 * against the 14-lantern ceiling (cap the room, or §3.5 gains a 15th). That is
 * a 7.7+ gameplay/server change, deliberately NOT solved in this rendering
 * task — flagged here so it is inherited loudly, not silently.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { lanternColors } from "../../theme/tokens";
import { playerColorIndex } from "../../graphics/colorBlindPalette";

/** The §3.5 lantern hex for a player, keyed off their stable `PLAYER_COLORS` slot. */
export function lanternHexForColor(color: string): string {
  const index = playerColorIndex(color);
  if (index < 0) {
    // A colour outside PLAYER_COLORS (custom/legacy). Fall back rather than crash.
    if (import.meta.env.DEV) {
      console.warn(`[Havener] unrecognised player colour "${color}"; using the default lantern.`);
    }
    return lanternColors[0]!.hex;
  }
  // Guard for the day PLAYER_COLORS ever grows past the 14 lanterns §3.5 defines.
  if (index >= lanternColors.length && import.meta.env.DEV) {
    console.warn(
      `[Havener] player colour index ${index} exceeds ${lanternColors.length} §3.5 lanterns — ` +
        `see the 7.7+ debt note in playerLantern.ts.`,
    );
  }
  return lanternColors[index % lanternColors.length]!.hex;
}
