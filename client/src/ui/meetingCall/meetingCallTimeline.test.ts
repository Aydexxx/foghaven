import { describe, expect, it } from "vitest";
import {
  MEETING_CALL_BEATS,
  MEETING_CALL_BEAT_START,
  MEETING_CALL_TOTAL_MS,
  meetingCallBeatAt,
  meetingCallTitle,
  ringPosition,
} from "./meetingCallTimeline";

describe("§10.3 meeting call timeline", () => {
  it("totals roughly 1.8s", () => {
    expect(MEETING_CALL_TOTAL_MS).toBe(1800);
    expect(Math.abs(MEETING_CALL_TOTAL_MS - 1800)).toBeLessThanOrEqual(100);
  });

  it("orders the four beats without gaps or overlaps", () => {
    expect(MEETING_CALL_BEAT_START.ring).toBe(0);
    expect(MEETING_CALL_BEAT_START.bell).toBe(MEETING_CALL_BEATS.ringMs);
    expect(MEETING_CALL_BEAT_START.title).toBe(MEETING_CALL_BEAT_START.bell + MEETING_CALL_BEATS.bellMs);
    expect(MEETING_CALL_BEAT_START.slide).toBe(MEETING_CALL_BEAT_START.title + MEETING_CALL_BEATS.titleMs);
    expect(MEETING_CALL_BEAT_START.slide + MEETING_CALL_BEATS.slideMs).toBe(MEETING_CALL_TOTAL_MS);
  });

  it("resolves the correct beat at each boundary", () => {
    expect(meetingCallBeatAt(0)).toBe("ring");
    expect(meetingCallBeatAt(MEETING_CALL_BEAT_START.bell - 1)).toBe("ring");
    expect(meetingCallBeatAt(MEETING_CALL_BEAT_START.bell)).toBe("bell");
    expect(meetingCallBeatAt(MEETING_CALL_BEAT_START.title - 1)).toBe("bell");
    expect(meetingCallBeatAt(MEETING_CALL_BEAT_START.title)).toBe("title");
    expect(meetingCallBeatAt(MEETING_CALL_BEAT_START.slide - 1)).toBe("title");
    expect(meetingCallBeatAt(MEETING_CALL_BEAT_START.slide)).toBe("slide");
    expect(meetingCallBeatAt(MEETING_CALL_TOTAL_MS - 1)).toBe("slide");
  });

  it("has a genuine terminal state, unlike the ejection cutscene's 'stay in reveal'", () => {
    expect(meetingCallBeatAt(MEETING_CALL_TOTAL_MS)).toBe("done");
    expect(meetingCallBeatAt(MEETING_CALL_TOTAL_MS + 10_000)).toBe("done");
  });
});

describe("§10.3 two variants, one timeline", () => {
  it("names the room for a body report", () => {
    const title = meetingCallTitle(false, "Alice", "Tavern");
    expect(title.titleKey).toBe("meeting.call.bodyTitle");
    expect(title.titleParams).toEqual({ room: "Tavern" });
    // The caller's name must not leak into the body-report variant's params.
    expect(Object.values(title.titleParams)).not.toContain("Alice");
  });

  it("names the caller for an emergency", () => {
    const title = meetingCallTitle(true, "Bob", "Tavern");
    expect(title.titleKey).toBe("meeting.call.emergencyTitle");
    expect(title.titleParams).toEqual({ name: "Bob" });
    expect(Object.values(title.titleParams)).not.toContain("Tavern");
  });

  it("is synchronous and takes no clock — both variants share identical timing by construction", () => {
    // Same reasoning as `ejectionRevealKeys`'s equivalent test: the function
    // that decides WHAT the title says has no path to affecting HOW LONG any
    // beat runs, because it returns data, not a duration. The actual timing
    // guarantee lives entirely in `MEETING_CALL_BEATS`, plain constants no
    // caller can parameterise by variant.
    expect(meetingCallTitle.length).toBe(3);
    expect(meetingCallTitle(true, "x", "y")).not.toHaveProperty("then");
  });
});

describe("§10.3 ring layout", () => {
  it("places every lantern on the circle, at a constant radius from center", () => {
    for (const total of [5, 6, 8, 10, 14]) {
      for (let i = 0; i < total; i++) {
        const { xPercent, yPercent } = ringPosition(i, total);
        const dx = xPercent - 50;
        const dy = yPercent - 50;
        const radius = Math.sqrt(dx * dx + dy * dy);
        expect(radius).toBeCloseTo(38, 1);
      }
    }
  });

  it("starts index 0 at the top of the ring", () => {
    const { xPercent, yPercent } = ringPosition(0, 8);
    expect(xPercent).toBeCloseTo(50, 5);
    expect(yPercent).toBeCloseTo(12, 1); // 50 - 38
  });

  it("spaces every lantern evenly — no two players ever overlap regardless of room size", () => {
    for (const total of [5, 14]) {
      const positions = Array.from({ length: total }, (_, i) => ringPosition(i, total));
      const distances: number[] = [];
      for (let i = 0; i < total; i++) {
        const a = positions[i]!;
        const b = positions[(i + 1) % total]!;
        distances.push(Math.hypot(a.xPercent - b.xPercent, a.yPercent - b.yPercent));
      }
      // Every adjacent pair is the same distance apart — a regular polygon,
      // not clustered or uneven spacing.
      const first = distances[0]!;
      for (const d of distances) {
        expect(d).toBeCloseTo(first, 1);
      }
    }
  });

  it("degrades to the center rather than dividing by zero for an empty roster", () => {
    expect(ringPosition(0, 0)).toEqual({ xPercent: 50, yPercent: 50 });
  });
});
