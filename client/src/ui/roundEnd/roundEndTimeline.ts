/**
 * ART_BIBLE §9's round-end row ("Losing side's lanterns all extinguish one by
 * one, 80 ms apart") plus §10's "title slams in", as pure data and pure
 * functions — the same split `ejectionTimeline.ts` and `meetingCallTimeline.ts`
 * use, and for the same reason: this project has no DOM test environment, so
 * anything decidable without React or a DOM node lives here.
 *
 * Unlike the other two cutscenes, this one's duration is not a fixed constant
 * — it scales with how many players are on the losing side, from a single
 * lone Stranger to a nearly-full room. `roundEndTotalMs` is a function of
 * `losingCount` for exactly that reason.
 */

import { LANTERN_EXTINGUISH_STAGGER_MS } from "../../juice/juiceEvents";

export { LANTERN_EXTINGUISH_STAGGER_MS };

/** How long a single lantern's own extinguish (glow to dark) takes. */
export const LANTERN_EXTINGUISH_FADE_MS = 200;

/** The result title's slam-in beat, once every losing lantern is dark. */
export const TITLE_SLAM_MS = 500;

/**
 * Total time the extinguish beat runs for a losing side of `losingCount`
 * players: the last lantern starts fading at `(losingCount - 1) * stagger`
 * and takes `LANTERN_EXTINGUISH_FADE_MS` to finish. Zero for an empty losing
 * side (e.g. the last Stranger left the room rather than dying in it, so
 * nobody on the losing side has a row on `finalRoster` at all) — the
 * cutscene then has nothing to extinguish and falls straight through to the
 * title beat.
 */
export function extinguishSequenceMs(losingCount: number): number {
  if (losingCount <= 0) {
    return 0;
  }
  return (losingCount - 1) * LANTERN_EXTINGUISH_STAGGER_MS + LANTERN_EXTINGUISH_FADE_MS;
}

/** The whole cutscene's length: every lantern out, then the title slams in. */
export function roundEndTotalMs(losingCount: number): number {
  return extinguishSequenceMs(losingCount) + TITLE_SLAM_MS;
}

export type RoundEndBeat = "extinguish" | "title" | "done";

/**
 * Which beat is active at a given elapsed time for a losing side of
 * `losingCount` players. Clamps to `"done"` past the end — the terminal state
 * at which the cutscene overlay hands off to the real results screen
 * underneath.
 */
export function roundEndBeatAt(elapsedMs: number, losingCount: number): RoundEndBeat {
  const extinguishMs = extinguishSequenceMs(losingCount);
  if (elapsedMs < extinguishMs) {
    return "extinguish";
  }
  if (elapsedMs < extinguishMs + TITLE_SLAM_MS) {
    return "title";
  }
  return "done";
}

/**
 * Whether the `index`-th (of the losing side, in roster order) lantern has
 * finished going dark by `elapsedMs` — "one by one, 80 ms apart" resolved to
 * a per-lantern boolean so the component only has to ask, never compute.
 */
export function isExtinguishedAt(index: number, elapsedMs: number): boolean {
  return elapsedMs >= index * LANTERN_EXTINGUISH_STAGGER_MS;
}
