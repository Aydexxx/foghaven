/**
 * ART_BIBLE §10.3's meeting call, as pure data and pure functions — the same
 * split `ejectionTimeline.ts` uses for the ejection cutscene, and for the
 * same reason: this project has no DOM test environment, so anything that
 * CAN be decided without React, a translation function, or a DOM node is
 * kept here where it is directly unit-testable.
 */

/**
 * §10.3's four beats. Sum is exactly 1800ms — "roughly 1.8s".
 *
 * Unlike the ejection cutscene, there is no terminal "stay here" state: the
 * whole point of the final beat is that it uncovers the discussion UI, which
 * has been sitting fully rendered underneath this overlay the entire time
 * (see `MeetingCallCutscene`'s own doc for why that is what makes the
 * transition continuous). So the sequence has a genuine end — `"done"` in
 * `MeetingCallBeat` — at which point the overlay renders nothing at all.
 */
export const MEETING_CALL_BEATS = {
  /** Every player's lantern flares to full brightness at once against black, arranged in a ring. */
  ringMs: 500,
  /** The bell tolls. */
  bellMs: 300,
  /** Title slams in. */
  titleMs: 500,
  /** The discussion UI slides up from below — really, the overlay retreats to reveal it; see the component doc. */
  slideMs: 500,
} as const;

export const MEETING_CALL_TOTAL_MS =
  MEETING_CALL_BEATS.ringMs +
  MEETING_CALL_BEATS.bellMs +
  MEETING_CALL_BEATS.titleMs +
  MEETING_CALL_BEATS.slideMs;

/** Where each beat starts, measured from t=0 — derived so the beats cannot drift apart. */
export const MEETING_CALL_BEAT_START = {
  ring: 0,
  bell: MEETING_CALL_BEATS.ringMs,
  title: MEETING_CALL_BEATS.ringMs + MEETING_CALL_BEATS.bellMs,
  slide: MEETING_CALL_BEATS.ringMs + MEETING_CALL_BEATS.bellMs + MEETING_CALL_BEATS.titleMs,
} as const;

export type MeetingCallBeat = "ring" | "bell" | "title" | "slide" | "done";

/** Which beat is active at a given elapsed time. Clamps to `"done"` past the end. */
export function meetingCallBeatAt(elapsedMs: number): MeetingCallBeat {
  if (elapsedMs < MEETING_CALL_BEAT_START.bell) {
    return "ring";
  }
  if (elapsedMs < MEETING_CALL_BEAT_START.title) {
    return "bell";
  }
  if (elapsedMs < MEETING_CALL_BEAT_START.slide) {
    return "title";
  }
  if (elapsedMs < MEETING_CALL_TOTAL_MS) {
    return "slide";
  }
  return "done";
}

export interface MeetingCallTitle {
  titleKey: string;
  titleParams: Record<string, string>;
}

/**
 * Which i18n key (and params) the title-slam beat uses for the two variants —
 * kept separate from the actual `t()` call so it stays testable without
 * react-i18next, the same reasoning as `ejectionRevealKeys`.
 *
 * `bodyRoomName` and `callerName` arrive already resolved to display strings
 * (the room name already run through `t(\`rooms.${slug}\`)`, since that
 * translation is itself variant-independent lookup table, not part of what
 * this function needs to decide) — this function's only job is picking WHICH
 * variant's copy to use and which value fills its placeholder.
 */
export function meetingCallTitle(
  isEmergency: boolean,
  callerName: string,
  bodyRoomName: string,
): MeetingCallTitle {
  return isEmergency
    ? { titleKey: "meeting.call.emergencyTitle", titleParams: { name: callerName } }
    : { titleKey: "meeting.call.bodyTitle", titleParams: { room: bodyRoomName } };
}

export interface RingPosition {
  /** Percentage from the left edge of the ring's bounding box, 0-100. */
  xPercent: number;
  /** Percentage from the top edge, 0-100. */
  yPercent: number;
}

const RING_CENTER = 50;
const RING_RADIUS = 38;

/**
 * Where the `index`-th of `total` lanterns sits on the ring, as a percentage
 * position within its container — independent of the actual player count (5
 * to `MAX_PLAYERS`), so the same layout logic covers every room size. Index 0
 * sits at the top (12 o'clock); the rest proceed clockwise.
 */
export function ringPosition(index: number, total: number): RingPosition {
  if (total <= 0) {
    return { xPercent: RING_CENTER, yPercent: RING_CENTER };
  }
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return {
    xPercent: RING_CENTER + Math.cos(angle) * RING_RADIUS,
    yPercent: RING_CENTER + Math.sin(angle) * RING_RADIUS,
  };
}
