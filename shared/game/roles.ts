import { STRANGER_THRESHOLDS } from "../config/gameConfig";

/**
 * How many strangers a lobby of `playerCount` players gets.
 *
 * This is a *public* rule: every client can compute it from the roster size,
 * so showing "there are 2 strangers among you" reveals nothing about *who*
 * they are. Only the identities are secret.
 */
export function strangerCount(playerCount: number): number {
  for (const [threshold, strangers] of STRANGER_THRESHOLDS) {
    if (playerCount >= threshold) {
      return strangers;
    }
  }
  return 1;
}

/**
 * The payload the server sends privately to a single client. `fellowStrangers`
 * is populated only for strangers; a townsfolk always receives an empty list,
 * so their socket never carries another player's identity.
 */
export interface RoleAssignment {
  role: string;
  fellowStrangers: string[];
}
