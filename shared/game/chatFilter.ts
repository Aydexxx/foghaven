/**
 * The chat filter — English and Turkish, built to survive the evasions people
 * actually use rather than only the literal words.
 *
 * Shared for the same reason `names.ts` is: the client can grey out a send
 * button, but the server's verdict is the only one that counts, and both run
 * this identical code so they can never disagree about what a message says.
 *
 * ## What it defends against
 *
 * Four mechanisms, because no single one covers the real bypasses:
 *
 *  1. **Per-token roots.** Each whitespace-separated token is normalized
 *     (leetspeak folded, diacritics folded, punctuation dropped, repeated
 *     letters collapsed) and matched against {@link MASK_ROOTS} /
 *     {@link BLOCK_ROOTS} as substrings. This catches `sh1t`, `f.u.c.k`,
 *     `fuuuuck`, `S​HIT` and `şıktır`.
 *  2. **Exact tokens.** Short abbreviations (`amk`, `kys`) are matched only as
 *     *whole* tokens. As substrings they would fire constantly — `amk` sits
 *     inside plenty of innocent strings — so they get their own, stricter test.
 *  3. **Evasion joins.** `f u c k` survives per-token matching because no
 *     single token is a word. Adjacent tokens are therefore joined and
 *     re-checked, but *only* when one side is 1–2 characters — the shape of
 *     deliberate spacing. Two ordinary words are never welded together, so
 *     `mass hit` stays clean while `f u c k` does not.
 *  4. **Phrases.** Harassment is often several innocent words in sequence
 *     (`kill yourself`), so {@link PHRASES} is matched against the entire
 *     message squeezed down to bare letters.
 *
 * ## What it deliberately does not do
 *
 * The word lists skip short, collision-prone roots even though they are real
 * profanity — Turkish `göt` folds onto English "got", `bok` is one repeated-
 * letter collapse away from "book", `piç` onto "pic". Including them would
 * mean flagging ordinary sentences many times a game, and a filter that cries
 * wolf gets switched off. Unambiguous longer forms (`götlek`, `siktir`) carry
 * that weight instead. {@link ALLOWLIST} covers the remaining classic false
 * positives — the Scunthorpe problem and its relatives.
 *
 * This is a first line of defence, not a solved problem: determined abuse gets
 * through any word list, which is exactly why the report queue
 * (`server/src/moderation/`) exists alongside it.
 */

/**
 * What the filter decided. `masked` still delivers the message with the
 * offending tokens starred out — ordinary profanity is not worth silencing a
 * player over — while `blocked` refuses it outright, which is reserved for
 * slurs and targeted harassment.
 */
export type ChatVerdict = "clean" | "masked" | "blocked";

export interface ChatFilterResult {
  verdict: ChatVerdict;
  /** The text to deliver. Masked on `masked`; the original on `clean`/`blocked` (the caller drops it). */
  text: string;
  /**
   * Which roots tripped, for the moderation audit trail. The *matched root*,
   * never the player's raw text, so a report's stored evidence stays readable
   * without re-deriving it.
   */
  matches: string[];
}

/** Confusables people substitute for letters. Folded before any matching. */
const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "6": "g",
  "7": "t",
  "8": "b",
  "9": "g",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "i",
  "+": "t",
  "*": "",
};

/**
 * Turkish letters folded to their ASCII shapes so `şıktır` and `siktir` are
 * the same string to the matcher. `İ`/`ı` need explicit handling because
 * JavaScript's `toLowerCase` is locale-independent and maps `İ` to `i` plus a
 * combining dot rather than to a bare `i`.
 */
const DIACRITICS: Record<string, string> = {
  ı: "i",
  İ: "i",
  ş: "s",
  Ş: "s",
  ğ: "g",
  Ğ: "g",
  ü: "u",
  Ü: "u",
  ö: "o",
  Ö: "o",
  ç: "c",
  Ç: "c",
  â: "a",
  î: "i",
  û: "u",
  é: "e",
  á: "a",
};

/**
 * Slurs, hate speech and targeted harassment. A message containing one of
 * these is refused rather than masked — there is no version of it worth
 * delivering, and the sender is told plainly that it was blocked.
 */
const BLOCK_ROOTS: readonly string[] = [
  // English
  "nigger",
  "nigga",
  "faggot",
  "tranny",
  "kike",
  "chink",
  "wetback",
  "beaner",
  "raghead",
  "retard",
  "rape",
  "molest",
  // Turkish
  "orospu",
  "oruspu",
  "ibne",
  "pezevenk",
  "gavat",
  "kahpe",
  "yavsak",
  "pust",
  "gotlek",
  "godos",
];

/**
 * Ordinary profanity. Masked out of the delivered message, which keeps the
 * conversation legible without handing anyone a silencing tool.
 */
const MASK_ROOTS: readonly string[] = [
  // English
  "fuck",
  "shit",
  "cunt",
  "bitch",
  "whore",
  "slut",
  "pussy",
  "asshole",
  "bastard",
  "dickhead",
  "jackass",
  "douche",
  "wanker",
  "bollock",
  // Turkish — long, unambiguous forms only; see the module doc for why the
  // short ones (`göt`, `bok`, `piç`) are deliberately absent.
  "siktir",
  "sikeyim",
  "sikiyim",
  "sikim",
  "sikik",
  "sikerim",
  "amcik",
  "aminakoy",
  "yarrak",
  "yarak",
  "surtuk",
  "salaksin",
  "aptalsin",
  "gerizekali",
  "serefsiz",
  "haysiyetsiz",
];

/**
 * Matched only as complete tokens. Every entry here is short enough that
 * substring matching would fire on innocent text constantly.
 *
 * Kept deliberately small. Turkish `göt`/`bok`/`piç` are absent even as exact
 * tokens, because folding diacritics lands them on English "got", "book"
 * (after a repeat collapse) and "pic" — all of which are ordinary chat.
 */
const BLOCK_EXACT: ReadonlySet<string> = new Set(["kys", "fag"]);

const MASK_EXACT: ReadonlySet<string> = new Set(["amk", "amq", "aq", "wtf", "stfu"]);

/**
 * Multi-word harassment, matched against the whole message squeezed to bare
 * letters — these are individually innocent words that are only abusive in
 * sequence, so no per-token rule can see them.
 */
const BLOCK_PHRASES: readonly string[] = [
  "killyourself",
  "killurself",
  "killyoself",
  "hangyourself",
  "kendinioldur",
  "gebersene",
  "gebermissin",
  "olsenderde",
];

/**
 * Words that legitimately contain a flagged root. Checked against a token's
 * normalized form *before* the roots are, so `Scunthorpe` and `grape` survive
 * a list that necessarily contains `cunt` and `rape`.
 */
const ALLOWLIST: ReadonlySet<string> = new Set([
  // "cunt"
  "scunthorpe",
  // "rape"
  "grape",
  "grapes",
  "grapevine",
  "drape",
  "drapes",
  "draped",
  "scrape",
  "scraped",
  "scraper",
  "scrapes",
  "trapeze",
  "therapeutic",
  "therapeutics",
  // "shit"
  "mishit",
  // Turkish words that collide once diacritics fold away
  "sikke", // coin
  "siklet", // weight class
  "siklon", // cyclone
]);

/** Everything that can trip the filter, with the verdict it implies. */
interface Match {
  root: string;
  verdict: Exclude<ChatVerdict, "clean">;
}

/**
 * Fold one token down to bare lowercase letters: diacritics and leetspeak
 * resolved, everything else dropped. Dropping non-letters is what closes the
 * `f.u.c.k` and `f_u_c_k` bypasses in a single step.
 */
function normalizeToken(token: string): string {
  let out = "";
  for (const rawChar of token) {
    const folded = DIACRITICS[rawChar] ?? rawChar;
    const lower = folded.toLowerCase();
    const mapped = LEET[lower] ?? lower;
    for (const ch of mapped) {
      if (ch >= "a" && ch <= "z") {
        out += ch;
      }
    }
  }
  return out;
}

/**
 * Collapse repeated letters, which is how `fuuuuck` and `shiiiit` are caught.
 *
 * Two variants are produced rather than one because neither is safe alone:
 * collapsing every run to a single letter turns the innocent `book` into
 * Turkish profanity, while collapsing only long runs lets `fuuck` through. The
 * caller tests both and takes a hit on either, so each variant covers the
 * other's blind spot.
 */
function collapseVariants(normalized: string): string[] {
  const toDouble = normalized.replace(/(.)\1{2,}/g, "$1$1");
  const toSingle = normalized.replace(/(.)\1+/g, "$1");
  return toDouble === toSingle ? [normalized, toDouble] : [normalized, toDouble, toSingle];
}

/** Test one already-normalized string against the substring root lists. */
function matchRoots(candidate: string): Match | null {
  for (const root of BLOCK_ROOTS) {
    if (candidate.includes(root)) {
      return { root, verdict: "blocked" };
    }
  }
  for (const root of MASK_ROOTS) {
    if (candidate.includes(root)) {
      return { root, verdict: "masked" };
    }
  }
  return null;
}

/**
 * The full verdict for a single token: allowlist first, then whole-token
 * abbreviations, then substring roots across every repeat-collapse variant.
 */
function screenToken(normalized: string): Match | null {
  if (!normalized) {
    return null;
  }
  const variants = collapseVariants(normalized);

  // An allowlisted word wins outright — this is what saves "Scunthorpe".
  if (variants.some((variant) => ALLOWLIST.has(variant))) {
    return null;
  }

  for (const variant of variants) {
    if (BLOCK_EXACT.has(variant)) {
      return { root: variant, verdict: "blocked" };
    }
  }
  for (const variant of variants) {
    if (MASK_EXACT.has(variant)) {
      return { root: variant, verdict: "masked" };
    }
  }
  for (const variant of variants) {
    const hit = matchRoots(variant);
    if (hit) {
      return hit;
    }
  }
  return null;
}

/** The more severe of two verdicts — `blocked` always wins. */
function worse(a: ChatVerdict, b: ChatVerdict): ChatVerdict {
  if (a === "blocked" || b === "blocked") {
    return "blocked";
  }
  if (a === "masked" || b === "masked") {
    return "masked";
  }
  return "clean";
}

/**
 * Screen a chat message.
 *
 * Returns the verdict, the text to actually deliver (masked where ordinary
 * profanity was found), and the roots that tripped — the last of which is what
 * a moderator sees on a report, so it records *what rule fired*, never a
 * second copy of the player's text.
 */
export function screenText(raw: string): ChatFilterResult {
  // Whitespace is kept as its own segment so the masked message can be
  // reassembled with the original spacing intact.
  const segments = raw.split(/(\s+)/);
  const wordIndices: number[] = [];
  segments.forEach((segment, index) => {
    if (segment && !/^\s+$/.test(segment)) {
      wordIndices.push(index);
    }
  });

  const normalized = wordIndices.map((index) => normalizeToken(segments[index] ?? ""));
  const matches: string[] = [];
  const maskedIndices = new Set<number>();
  /** Tokens that tripped on their own, at either tier — see the join loop below. */
  const flagged = new Set<number>();
  let verdict: ChatVerdict = "clean";

  // 1–3. Per-token roots, exact tokens and their repeat-collapse variants.
  normalized.forEach((token, i) => {
    const hit = screenToken(token);
    if (!hit) {
      return;
    }
    matches.push(hit.root);
    verdict = worse(verdict, hit.verdict);
    flagged.add(i);
    if (hit.verdict === "masked") {
      maskedIndices.add(i);
    }
  });

  // 4. Evasion joins: only across a 1–2 character neighbour, which is the
  // signature of deliberate spacing rather than of two ordinary words.
  for (let i = 0; i < normalized.length - 1; i += 1) {
    let joined = normalized[i] ?? "";
    let end = i;
    for (let j = i + 1; j < normalized.length; j += 1) {
      const previous = normalized[j - 1] ?? "";
      const current = normalized[j] ?? "";
      if (previous.length > 2 && current.length > 2) {
        break;
      }
      joined += current;
      end = j;
    }
    if (end === i) {
      continue;
    }
    // If any token in this group already tripped by itself, the message is
    // caught and masked at exactly the right word — joining would only spread
    // the asterisks onto innocent neighbours ("oh shit" masking "oh" too).
    let alreadyCaught = false;
    for (let k = i; k <= end; k += 1) {
      if (flagged.has(k)) {
        alreadyCaught = true;
        break;
      }
    }
    if (alreadyCaught) {
      continue;
    }
    const hit = screenToken(joined);
    if (!hit) {
      continue;
    }
    matches.push(hit.root);
    verdict = worse(verdict, hit.verdict);
    if (hit.verdict === "masked") {
      for (let k = i; k <= end; k += 1) {
        maskedIndices.add(k);
      }
    }
  }

  // 5. Whole-message phrases.
  const squeezed = normalized.join("");
  for (const phrase of BLOCK_PHRASES) {
    if (squeezed.includes(phrase)) {
      matches.push(phrase);
      verdict = "blocked";
    }
  }

  if (verdict === "clean" || verdict === "blocked") {
    return { verdict, text: raw, matches: [...new Set(matches)] };
  }

  const out = [...segments];
  for (const i of maskedIndices) {
    const index = wordIndices[i];
    if (index !== undefined) {
      out[index] = "*".repeat((segments[index] ?? "").length);
    }
  }
  return { verdict, text: out.join(""), matches: [...new Set(matches)] };
}

/**
 * Whether a *name* contains anything from either list. Names get no masking
 * tier — a display name is worn for the whole game, so anything that trips the
 * filter at all is simply refused at registration. Backs `validateName`.
 */
export function containsProfanity(name: string): boolean {
  return screenText(name).verdict !== "clean";
}
