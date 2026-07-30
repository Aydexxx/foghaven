/**
 * ART_BIBLE §10.2's ejection sequence, as pure data and pure functions —
 * everything about it that can be decided without a DOM, a translation
 * function, or React, kept separate from `EjectionCutscene.tsx` so it can be
 * unit-tested directly (this project has no DOM test environment set up; see
 * `client/src/game/cutscenes/killCutscene.ts` for the same split applied to
 * the kill cutscene).
 */

/**
 * The single point of contact with real art. `EjectionCutscene` layers
 * `ejectionBackdropUrl()` as an extra `background-image` on top of an
 * always-present CSS gradient placeholder; a failed image load only fails
 * that one layer; the gradient underneath keeps rendering regardless (this is
 * standard `background-image` behaviour — a comma-separated list's layers
 * fail independently). So dropping a real file at this path is the entire
 * integration: nothing about the beats, the component, or the timing needs to
 * change, and a checkout with no art still renders correctly, the same
 * tolerance `GameScene.preload` already gives the Havener atlas.
 */
export const EJECTION_BACKDROP_KEY = "cutscene-pier";

export function ejectionBackdropUrl(key: string = EJECTION_BACKDROP_KEY): string {
  return `/cutscenes/${key}.png`;
}

/**
 * §10.2's beats, collapsed from six list items to four timed phases — items
 * 2 and 3 ("walks away... lantern shrinks with it") are one continuous motion,
 * not two sequential ones, and item 6 (the reveal text) is the resting state
 * the sequence lands on rather than something that plays and then un-plays.
 *
 * Sum is exactly 3500ms — "roughly 3.5s".
 */
export const EJECTION_BEATS = {
  /**
   * 1+2+3: cut to the pier, walk into the fog, silhouette and lantern shrink
   * together. Longer than `EJECTION_SKIP_ELIGIBLE_MS` on purpose — skip
   * becomes eligible while the walk is still playing, not exactly at its end.
   */
  walkMs: 1600,
  /** 4: beat of stillness — just fog and the tiny light. */
  stillMs: 300,
  /** 5: the light goes out. One bell toll. */
  bellMs: 600,
  /** 6: text resolves. This is also where the sequence stays once done. */
  revealMs: 1000,
} as const;

export const EJECTION_CUTSCENE_TOTAL_MS =
  EJECTION_BEATS.walkMs + EJECTION_BEATS.stillMs + EJECTION_BEATS.bellMs + EJECTION_BEATS.revealMs;

/** Where each beat starts, measured from t=0 — derived so the beats cannot drift apart. */
export const EJECTION_BEAT_START = {
  walk: 0,
  still: EJECTION_BEATS.walkMs,
  bell: EJECTION_BEATS.walkMs + EJECTION_BEATS.stillMs,
  reveal: EJECTION_BEATS.walkMs + EJECTION_BEATS.stillMs + EJECTION_BEATS.bellMs,
} as const;

/** "Add a skip on any input after 1.5s." */
export const EJECTION_SKIP_ELIGIBLE_MS = 1500;

export type EjectionBeat = "walk" | "still" | "bell" | "reveal";

/**
 * Which beat is active at a given elapsed time, clamped to `"reveal"` past
 * the end — the terminal state a skip also jumps straight to.
 */
export function ejectionBeatAt(elapsedMs: number): EjectionBeat {
  if (elapsedMs < EJECTION_BEAT_START.still) {
    return "walk";
  }
  if (elapsedMs < EJECTION_BEAT_START.bell) {
    return "still";
  }
  if (elapsedMs < EJECTION_BEAT_START.reveal) {
    return "bell";
  }
  return "reveal";
}

export interface EjectionRevealKeys {
  line1Key: string;
  /** `null` when the "reveal ejected player's faction" lobby setting is off — omitted entirely, not blanked. */
  line2Key: string | null;
}

/**
 * Which i18n keys the beat-6 reveal text uses, kept separate from the actual
 * `t()` call so this stays testable without pulling in react-i18next.
 *
 * The whole point of returning a key rather than deciding content inline: the
 * function's SHAPE never depends on `ejectionConfirmed` — it is always "one
 * key, plus an optional second key", computed instantly and rendered inside
 * the same fixed-duration `reveal` beat either way. There is no branch here
 * that takes measurably longer for the two-line case, because there is no
 * timing in this function at all — see `EJECTION_BEATS.revealMs`, a single
 * constant, for where the actual duration guarantee lives.
 */
export function ejectionRevealKeys(
  ejectionConfirmed: boolean,
  ejectedWasStranger: boolean,
): EjectionRevealKeys {
  return {
    line1Key: "meeting.ejection.castIntoFog",
    line2Key: ejectionConfirmed
      ? ejectedWasStranger
        ? "meeting.ejection.wasStranger"
        : "meeting.ejection.wasNotStranger"
      : null,
  };
}
