import jwt from "jsonwebtoken";

/**
 * Auth tokens: a signed JWT carrying only a user id. Deliberately minimal —
 * the token proves "the bearer logged in as this user id", nothing more.
 * Everything that can change (username, and crucially ban status) is looked up
 * fresh from the database on every use (see `AuthProvider.authenticate`), so a
 * stale token can never smuggle stale authority.
 *
 * Stateless on purpose: `GameRoom.onAuth` verifies the signature without a
 * database round-trip for the token itself, then does one fresh ban check. No
 * server-side session store to keep in sync across restarts or instances.
 */

const PLACEHOLDER_SECRET = "dev-only-change-me-to-a-long-random-string";

/**
 * The signing secret, resolved at call time. In production a real secret is
 * mandatory — an unset or left-at-placeholder value throws, so the server
 * fails loudly at first use rather than silently signing forgeable tokens. In
 * development it falls back to the placeholder so `npm run dev` works with no
 * setup.
 */
function secret(): string {
  const value = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === "production";
  if (!value || value === PLACEHOLDER_SECRET) {
    if (isProd) {
      throw new Error(
        "JWT_SECRET must be set to a real secret in production (see server/.env.example).",
      );
    }
    return PLACEHOLDER_SECRET;
  }
  return value;
}

function expiresIn(): string {
  return process.env.JWT_EXPIRES_IN || "7d";
}

/** The claims a Foghaven token carries — just the subject. */
export interface TokenClaims {
  userId: string;
}

export function signToken(userId: string): string {
  return jwt.sign({ userId }, secret(), { expiresIn: expiresIn() as jwt.SignOptions["expiresIn"] });
}

/**
 * Verify and decode a token. Returns the claims, or `null` for anything wrong —
 * bad signature, expired, malformed, or missing the `userId` claim. Callers
 * treat `null` uniformly as "not authenticated"; the distinction between
 * "expired" and "forged" is deliberately not surfaced (it would only help an
 * attacker probe).
 */
export function verifyToken(token: string): TokenClaims | null {
  try {
    const decoded = jwt.verify(token, secret());
    if (typeof decoded === "object" && decoded !== null && typeof decoded.userId === "string") {
      return { userId: decoded.userId };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Whether a real signing secret is configured. `index.ts` uses this to fail
 * fast at boot in production instead of at the first login.
 */
export function hasRealSecret(): boolean {
  const value = process.env.JWT_SECRET;
  return Boolean(value) && value !== PLACEHOLDER_SECRET;
}
