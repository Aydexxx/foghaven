import { describe, expect, it } from "vitest";
import { PLAYER_COLORS } from "@foghaven/shared";
import { archetypeForColor } from "./assign";
import { ARCHETYPES } from "./archetypes";

/**
 * A regression test for a real bug: the first hash tried here (a plain
 * `hash*31+char` polynomial) distributed ten `PLAYER_COLORS` so unevenly
 * that two of the six archetypes — lamplighter and alderman — were never
 * once selected. Every player would eventually be shown one of the other
 * four, silently making a third of the cast art dead code. Nothing in a
 * type check or a build catches that; only actually enumerating the real
 * colour list and checking the output does.
 */
describe("archetypeForColor", () => {
  it("reaches every archetype across the real player colour palette", () => {
    const seen = new Set(PLAYER_COLORS.map((color) => archetypeForColor(color).id));
    const missing = ARCHETYPES.map((a) => a.id).filter((id) => !seen.has(id));
    expect(missing).toEqual([]);
  });

  it("is deterministic — the same colour always draws the same costume", () => {
    for (const color of PLAYER_COLORS) {
      const first = archetypeForColor(color).id;
      const second = archetypeForColor(color).id;
      expect(second).toBe(first);
    }
  });
});
