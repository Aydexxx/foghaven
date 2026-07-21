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

/**
 * A small, deliberately conservative slur/obscenity list. Not exhaustive —
 * exhaustive is impossible and not the point; this stops the obvious cases at
 * registration, and a real deployment would layer a maintained service on top.
 * Kept as roots so simple suffixing ("...s", "...er") is caught by substring.
 */
const PROFANITY_ROOTS = [
  "fuck",
  "shit",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "bitch",
  "whore",
  "rape",
  "slut",
  "dick",
  "pussy",
  "asshole",
  "bastard",
];

/**
 * Fold common evasions down to plain lowercase letters before matching, so
 * "sh1t", "f_u_c_k" and "F.U.C.K" all collapse onto their root. Digits map to
 * the letters they imitate; every non-letter is dropped, which also closes the
 * "spaces between letters" trick.
 */
function normalizeForProfanity(name: string): string {
  const leet: Record<string, string> = {
    "0": "o",
    "1": "i",
    "3": "e",
    "4": "a",
    "5": "s",
    "7": "t",
    "8": "b",
    "@": "a",
    $: "s",
  };
  return name
    .toLowerCase()
    .split("")
    .map((ch) => leet[ch] ?? ch)
    .filter((ch) => ch >= "a" && ch <= "z")
    .join("");
}

/** Whether a name contains a blocked root once evasions are normalized away. */
export function containsProfanity(name: string): boolean {
  const normalized = normalizeForProfanity(name);
  return PROFANITY_ROOTS.some((root) => normalized.includes(root));
}
