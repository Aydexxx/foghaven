/**
 * Credential validation for the fields the shared name rules don't cover —
 * email and password. Username/display-name rules live in
 * `@foghaven/shared`'s `names.ts` so the client and server agree; email and
 * password are only ever checked server-side at register time, so they live
 * here.
 *
 * Every check returns a stable string code (not a sentence), so the HTTP layer
 * and the client's i18n both key off the same value.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * A pragmatic email shape check, not RFC 5322 — one `@`, something before it,
 * and a dotted domain after. The goal is to reject obvious typos and junk, not
 * to be the authority on deliverability (only sending mail proves that).
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(raw: string): boolean {
  const email = raw.trim();
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export type PasswordError = "too_short" | "too_long" | "too_weak";

/**
 * Password policy: a length floor plus a "not trivially uniform" check (rejects
 * "aaaaaaaa" / "11111111"). Deliberately not a maze of character-class rules —
 * length is what actually resists guessing, and heavy composition rules mostly
 * push people toward predictable patterns. The upper bound guards against a
 * multi-megabyte string being fed through bcrypt as a cheap DoS.
 */
export function validatePassword(password: string): PasswordError | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return "too_short";
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return "too_long";
  }
  if (new Set(password).size < 4) {
    return "too_weak";
  }
  return null;
}
