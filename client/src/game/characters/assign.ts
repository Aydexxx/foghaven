import { ARCHETYPES } from "./archetypes";

/**
 * Which archetype a player appears as — derived purely from their already-
 * public `color` string, entirely client-side. No server involvement and no
 * new network field: the archetype is flavour, not information, and must
 * never correlate with the one thing that actually is secret (role). Hashing
 * an already-public value can't leak anything a client didn't already have.
 *
 * FNV-1a with a Murmur3-style avalanche finalizer, not a plain polynomial
 * hash: `PLAYER_COLORS` is ten short, structurally similar hex strings
 * (`#e6194b`, `#f032e6`, ...), and a weak hash's low bits — the only ones
 * `% ARCHETYPES.length` actually reads — don't mix well over inputs that
 * similar. A first pass at this used `hash*31+char`, which clumped five of
 * the ten colours onto "drifter" and never once landed on "lamplighter" or
 * "alderman" — silently making a third of the cast unreachable by anyone.
 * The finalizer folds the high bits back down before the modulo, which is
 * exactly the step a plain polynomial hash skips.
 */
export function archetypeForColor(color: string): (typeof ARCHETYPES)[number] {
  // eslint-disable-next-line no-restricted-syntax -- FNV-1a offset basis, not a color
  let hash = 0x811c9dc5;
  for (let i = 0; i < color.length; i++) {
    hash ^= color.charCodeAt(i);
    // eslint-disable-next-line no-restricted-syntax -- FNV-1a prime, not a color
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  // eslint-disable-next-line no-restricted-syntax -- Murmur3 finalizer constant, not a color
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  const index = (hash >>> 0) % ARCHETYPES.length;
  return ARCHETYPES[index]!;
}
