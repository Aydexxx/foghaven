import bcrypt from "bcryptjs";

/**
 * Password hashing, isolated so nothing else in the codebase ever touches a raw
 * password or picks a cost factor. bcryptjs (pure JS) rather than a native
 * build — it needs no compiler, which matters for a project that has to install
 * cleanly on any dev machine.
 *
 * The cost is read from the environment per call rather than captured once, so
 * it can be tuned (or lowered in a test) without a restart. 12 is the default:
 * comfortably slow for an attacker, still well under a second per hash.
 */

const DEFAULT_COST = 12;

function cost(): number {
  const raw = Number(process.env.BCRYPT_COST);
  return Number.isInteger(raw) && raw >= 4 && raw <= 15 ? raw : DEFAULT_COST;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, cost());
}

/**
 * Constant-time comparison via bcrypt. Returns false rather than throwing on a
 * malformed hash, so a corrupt row can never crash a login — it just fails to
 * authenticate, which is the safe direction.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
