import { describe, expect, it } from "vitest";
import {
  EJECTION_BEATS,
  EJECTION_BEAT_START,
  EJECTION_CUTSCENE_TOTAL_MS,
  EJECTION_SKIP_ELIGIBLE_MS,
  ejectionBackdropUrl,
  ejectionBeatAt,
  ejectionRevealKeys,
} from "./ejectionTimeline";

describe("§10.2 ejection timeline", () => {
  it("totals roughly 3.5s", () => {
    expect(EJECTION_CUTSCENE_TOTAL_MS).toBe(3500);
    expect(Math.abs(EJECTION_CUTSCENE_TOTAL_MS - 3500)).toBeLessThanOrEqual(100);
  });

  it("orders the four beats without gaps or overlaps", () => {
    expect(EJECTION_BEAT_START.walk).toBe(0);
    expect(EJECTION_BEAT_START.still).toBe(EJECTION_BEATS.walkMs);
    expect(EJECTION_BEAT_START.bell).toBe(EJECTION_BEAT_START.still + EJECTION_BEATS.stillMs);
    expect(EJECTION_BEAT_START.reveal).toBe(EJECTION_BEAT_START.bell + EJECTION_BEATS.bellMs);
    expect(EJECTION_BEAT_START.reveal + EJECTION_BEATS.revealMs).toBe(EJECTION_CUTSCENE_TOTAL_MS);
  });

  it("resolves the correct beat at each boundary", () => {
    expect(ejectionBeatAt(0)).toBe("walk");
    expect(ejectionBeatAt(EJECTION_BEAT_START.still - 1)).toBe("walk");
    expect(ejectionBeatAt(EJECTION_BEAT_START.still)).toBe("still");
    expect(ejectionBeatAt(EJECTION_BEAT_START.bell - 1)).toBe("still");
    expect(ejectionBeatAt(EJECTION_BEAT_START.bell)).toBe("bell");
    expect(ejectionBeatAt(EJECTION_BEAT_START.reveal - 1)).toBe("bell");
    expect(ejectionBeatAt(EJECTION_BEAT_START.reveal)).toBe("reveal");
  });

  it("clamps to the reveal beat past the end — the same state a skip jumps to", () => {
    expect(ejectionBeatAt(EJECTION_CUTSCENE_TOTAL_MS)).toBe("reveal");
    expect(ejectionBeatAt(EJECTION_CUTSCENE_TOTAL_MS + 50_000)).toBe("reveal");
  });

  it("makes input eligible to skip only from 1.5s onward", () => {
    expect(EJECTION_SKIP_ELIGIBLE_MS).toBe(1500);
    // Sits inside the walk beat, so the requirement "any input after 1.5s"
    // does not accidentally line up with a beat boundary.
    expect(EJECTION_SKIP_ELIGIBLE_MS).toBeLessThan(EJECTION_BEAT_START.still);
  });
});

describe("§10.2 backdrop is swappable via one asset key", () => {
  it("builds a URL from the key alone, with no other parameter threaded through", () => {
    expect(ejectionBackdropUrl("cutscene-pier")).toBe("/cutscenes/cutscene-pier.png");
  });

  it("defaults to the shared constant, so a future real-art swap is a one-line change", () => {
    expect(ejectionBackdropUrl()).toBe("/cutscenes/cutscene-pier.png");
  });
});

describe("§10.2 reveal respects the confirmEjects setting", () => {
  it("always includes the cast-into-fog line", () => {
    expect(ejectionRevealKeys(true, true).line1Key).toBe("meeting.ejection.castIntoFog");
    expect(ejectionRevealKeys(false, false).line1Key).toBe("meeting.ejection.castIntoFog");
  });

  it("includes the faction line only when confirmEjects is on", () => {
    expect(ejectionRevealKeys(true, true).line2Key).toBe("meeting.ejection.wasStranger");
    expect(ejectionRevealKeys(true, false).line2Key).toBe("meeting.ejection.wasNotStranger");
  });

  it("omits the second line entirely when confirmEjects is off — null, not a blank string", () => {
    // ejectedWasStranger true here models the server's actual behaviour when
    // confirmEjects is off: the field is simply never written (stays at its
    // schema default, false), but this must omit the line regardless of that
    // value, because the FLAG is what governs disclosure, not the data.
    expect(ejectionRevealKeys(false, true).line2Key).toBeNull();
    expect(ejectionRevealKeys(false, false).line2Key).toBeNull();
  });

  /**
   * The requirement this test exists for: "make sure there is no timing
   * difference that betrays what it would have said. Same total duration
   * either way." `ejectionRevealKeys` takes no clock and returns no timing —
   * it cannot possibly make the reveal beat run long or short, because
   * nothing about its return shape or call cost depends on which branch was
   * taken. The actual duration guarantee is `EJECTION_BEATS.revealMs`, a
   * single constant no caller can parameterise.
   */
  it("is synchronous and takes no clock — nothing here can make one branch run longer than the other", () => {
    const withFaction = ejectionRevealKeys(true, true);
    const withoutFaction = ejectionRevealKeys(false, false);
    // Neither call returns a Promise/thenable, and the function accepts only
    // the two booleans — there is no time value in or out for a bug to hide
    // inside. The actual duration guarantee lives entirely in
    // `EJECTION_BEATS.revealMs`, a plain constant.
    expect(withFaction).not.toHaveProperty("then");
    expect(withoutFaction).not.toHaveProperty("then");
    expect(ejectionRevealKeys.length).toBe(2);
  });
});
