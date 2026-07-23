import { describe, expect, it } from "vitest";
import {
  proximityGain,
  VOICE_PROXIMITY_FULL_RANGE,
  VOICE_PROXIMITY_MAX_RANGE,
} from "./voice";

describe("proximityGain", () => {
  it("is full volume at zero distance and inside the full range", () => {
    expect(proximityGain(0)).toBe(1);
    expect(proximityGain(VOICE_PROXIMITY_FULL_RANGE - 1)).toBe(1);
    expect(proximityGain(VOICE_PROXIMITY_FULL_RANGE)).toBe(1);
  });

  it("is silent at and beyond the max range", () => {
    expect(proximityGain(VOICE_PROXIMITY_MAX_RANGE)).toBe(0);
    expect(proximityGain(VOICE_PROXIMITY_MAX_RANGE + 500)).toBe(0);
  });

  it("falls off monotonically between the two ranges", () => {
    const mid = (VOICE_PROXIMITY_FULL_RANGE + VOICE_PROXIMITY_MAX_RANGE) / 2;
    const near = proximityGain(VOICE_PROXIMITY_FULL_RANGE + 10);
    const middle = proximityGain(mid);
    const far = proximityGain(VOICE_PROXIMITY_MAX_RANGE - 10);

    expect(near).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(far);
    // The midpoint of a linear falloff sits at half volume.
    expect(middle).toBeCloseTo(0.5, 5);
  });

  it("clamps to the valid 0..1 range for every input, including nonsense", () => {
    for (const d of [-100, 0, 42, 200, 10_000, NaN, Infinity]) {
      const gain = proximityGain(d);
      expect(gain).toBeGreaterThanOrEqual(0);
      expect(gain).toBeLessThanOrEqual(1);
    }
  });
});
