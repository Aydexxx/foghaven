import { ROLE_DEFINITIONS } from "@foghaven/shared";

/**
 * Role emblems — ART_BIBLE §12.3's `art/prompts/role-emblems.txt` sheet:
 * fourteen circular, rope-bordered symbol icons, one per role, readable at
 * 48px.
 *
 * **The sheet has not been sliced into individual assets yet.** `art/approved/`
 * currently holds only the character and cosmetic-hat sheets, so every emblem
 * below renders as a keyed placeholder: a rope-bordered disc carrying the
 * role's two-letter code. It is deliberately obviously provisional rather than
 * a guessed-at glyph — a wrong symbol that looks finished is harder to notice
 * than a placeholder that announces itself.
 *
 * ## Dropping the real art in
 *
 * Each emblem has a stable key (`roleEmblemKey`) matching the frame name the
 * slicing step should emit — `role-emblem-<roleId>`, in the same
 * `art/approved/` → `npm run atlas` pipeline the character sheet already uses.
 * When those frames exist, the only change needed is inside `RoleEmblem`:
 * render the frame instead of the code. Every call site, every layout rule and
 * every test keys off `roleEmblemKey`, so nothing else moves.
 *
 * The symbol intended for each role, from the art bible's own list, is
 * recorded in `ROLE_EMBLEM_SYMBOL` below so whoever generates the sheet does
 * not have to re-derive the mapping.
 */

/** The atlas frame name for a role's emblem. The one place this string is built. */
export function roleEmblemKey(roleId: string): string {
  return `role-emblem-${roleId}`;
}

/**
 * Which symbol from `art/prompts/role-emblems.txt` belongs to which role.
 * Documentation for the art pass — not used for rendering, and intentionally
 * exhaustive so a role added without an emblem is visible here as a gap.
 */
export const ROLE_EMBLEM_SYMBOL: Readonly<Record<string, string>> = {
  villager: "lit lantern",
  stranger: "hooded figure",
  doctor: "medical cross made of bandages",
  detective: "magnifying glass",
  lamplighter: "oil can",
  watchman: "ship's wheel",
  medium: "spiral seashell",
  alderman: "town seal",
  constable: "constable's whistle",
  shapeshifter: "shifting mask",
  saboteur: "fishing hook",
  assassin: "crossed knives",
  silencer: "silenced bell",
  decoy: "empty coat",
};

/**
 * Two letters per role, distinct across the whole registry — the same
 * "colour is never the only channel" idea the colour-blind lantern codes use
 * (ART_BIBLE §3.5). Derived rather than hand-listed so a new role gets a code
 * for free; collisions fall back to the first two letters plus an index.
 */
const EMBLEM_CODES: Readonly<Record<string, string>> = (() => {
  const used = new Set<string>();
  const codes: Record<string, string> = {};
  for (const definition of ROLE_DEFINITIONS) {
    const letters = definition.id.replace(/[^a-z]/g, "");
    let code = `${letters[0] ?? "?"}${letters[1] ?? ""}`.toUpperCase();
    let index = 2;
    while (used.has(code) && index < letters.length) {
      code = `${letters[0]!}${letters[index]!}`.toUpperCase();
      index++;
    }
    used.add(code);
    codes[definition.id] = code;
  }
  return codes;
})();

interface RoleEmblemProps {
  roleId: string;
  /** Rendered for the Random card, which has no role and therefore no emblem. */
  placeholderLabel?: string;
}

export function RoleEmblem({ roleId, placeholderLabel }: RoleEmblemProps) {
  const code = placeholderLabel ?? EMBLEM_CODES[roleId] ?? "??";
  return (
    <span
      className="role-emblem"
      // The hook the real sliced frame drops onto. Present from day one so the
      // swap is a change of renderer, not a change of contract.
      data-emblem={roleEmblemKey(roleId)}
      aria-hidden="true"
    >
      {code}
    </span>
  );
}
