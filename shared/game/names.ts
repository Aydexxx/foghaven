/**
 * Display-name rules — shared for the same reason `movement.ts` and `vision.ts`
 * are: the client pre-validates so a player gets instant feedback, and the
 * server enforces the exact same rules authoritatively. One implementation, so
 * "looks fine in the form" and "the server accepted it" can never disagree.
 *
 * These cover usernames (accounts) AND guest display names — both are shown to
 * every other player, so both must be unique-shaped and free of slurs. Account
 * uniqueness itself is the database's job (see `usernameLower` in the Prisma
 * schema); this module only judges a single name in isolation.
 */

import { containsProfanity } from "./chatFilter";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/** Why a name was rejected — a stable code the client maps to a localized message. */
export type NameError = "length" | "charset" | "profanity";

/**
 * Allowed characters: letters, digits, and a few separators, with no leading or
 * trailing separator and no run of them. Deliberately conservative — exotic
 * unicode is where homoglyph impersonation ("Ada" vs a Cyrillic "Аda") and
 * profanity smuggling both live, so names stay in a plain, legible set.
 */
const USERNAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|[ _-](?![ _-]))*[a-zA-Z0-9]$/;

/**
 * The single-name check both sides run. Returns `null` when the name is
 * acceptable, or the first rule it broke. Length is checked on the trimmed
 * value; callers should store the trimmed form.
 */
export function validateName(raw: string): NameError | null {
  const name = raw.trim();
  if (name.length < USERNAME_MIN_LENGTH || name.length > USERNAME_MAX_LENGTH) {
    return "length";
  }
  if (!USERNAME_PATTERN.test(name)) {
    return "charset";
  }
  if (containsProfanity(name)) {
    return "profanity";
  }
  return null;
}

/** Convenience boolean form of {@link validateName}. */
export function isValidName(raw: string): boolean {
  return validateName(raw) === null;
}

/*
 * Name profanity is the chat filter's word lists and evasion handling, reused
 * wholesale — see `chatFilter.ts`, which is where `containsProfanity` lives
 * and is exported from. There is deliberately only one list in the codebase: a
 * word that would be masked in chat must not be wearable as an identity, and
 * two lists would inevitably drift apart.
 */
