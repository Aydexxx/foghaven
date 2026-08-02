import { describe, expect, it } from "vitest";
import {
  LANTERN_EXTINGUISH_FADE_MS,
  LANTERN_EXTINGUISH_STAGGER_MS,
  TITLE_SLAM_MS,
  extinguishSequenceMs,
  isExtinguishedAt,
  roundEndBeatAt,
  roundEndTotalMs,
} from "./roundEndTimeline";

describe("§9/§10 round-end lantern extinguish timeline", () => {
  it("stays at 80ms apart — the exact §9 number, taken from juiceEvents, not reinvented", () => {
    expect(LANTERN_EXTINGUISH_STAGGER_MS).toBe(80);
  });

  it("scales the extinguish beat with the losing side's size", () => {
    expect(extinguishSequenceMs(1)).toBe(LANTERN_EXTINGUISH_FADE_MS);
    expect(extinguishSequenceMs(3)).toBe(2 * LANTERN_EXTINGUISH_STAGGER_MS + LANTERN_EXTINGUISH_FADE_MS);
    expect(extinguishSequenceMs(7)).toBe(6 * LANTERN_EXTINGUISH_STAGGER_MS + LANTERN_EXTINGUISH_FADE_MS);
  });

  it("has nothing to extinguish for an empty losing side", () => {
    expect(extinguishSequenceMs(0)).toBe(0);
    expect(roundEndBeatAt(0, 0)).toBe("title");
  });

  it("resolves the correct beat at each boundary for a 3-player losing side", () => {
    const extinguishMs = extinguishSequenceMs(3);
    expect(roundEndBeatAt(0, 3)).toBe("extinguish");
    expect(roundEndBeatAt(extinguishMs - 1, 3)).toBe("extinguish");
    expect(roundEndBeatAt(extinguishMs, 3)).toBe("title");
    expect(roundEndBeatAt(extinguishMs + TITLE_SLAM_MS - 1, 3)).toBe("title");
    expect(roundEndBeatAt(extinguishMs + TITLE_SLAM_MS, 3)).toBe("done");
    expect(roundEndBeatAt(extinguishMs + TITLE_SLAM_MS + 10_000, 3)).toBe("done");
  });

  it("totals the extinguish beat plus the title slam", () => {
    expect(roundEndTotalMs(3)).toBe(extinguishSequenceMs(3) + TITLE_SLAM_MS);
  });

  it("extinguishes lanterns one by one, 80ms apart, in roster order", () => {
    expect(isExtinguishedAt(0, 0)).toBe(true);
    expect(isExtinguishedAt(1, 0)).toBe(false);
    expect(isExtinguishedAt(1, LANTERN_EXTINGUISH_STAGGER_MS - 1)).toBe(false);
    expect(isExtinguishedAt(1, LANTERN_EXTINGUISH_STAGGER_MS)).toBe(true);
    expect(isExtinguishedAt(4, 4 * LANTERN_EXTINGUISH_STAGGER_MS)).toBe(true);
    expect(isExtinguishedAt(4, 4 * LANTERN_EXTINGUISH_STAGGER_MS - 1)).toBe(false);
  });
});
