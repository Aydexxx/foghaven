import { describe, expect, it } from "vitest";
import {
  VISION_RADIUS_INDOOR,
  VISION_RADIUS_OUTDOOR,
  KILL_RANGE,
  REPORT_BODY_RANGE,
  LANTERN_EXTINGUISHED_VISION_MULTIPLIER,
  LANTERN_EXTINGUISHED_DETECTION_RADIUS,
  canSee,
  hasLineOfSight,
  visionRadiusAt,
  type LanternState,
} from "@foghaven/shared";

/**
 * Pure geometry tests for the fog rules. All coordinates below are derived
 * from the town map layout in `townMap.ts`:
 *
 *   - The tavern's interior spans tiles (3..8, 15..21); its east wall is
 *     column 9, except for the door at rows 17-18 (world y 544..608).
 *   - (272, 656) is inside the tavern against the east wall; (336, 656) is
 *     just across that wall in the plaza — 64 units apart, wall between.
 *   - The same pair shifted up to y = 560 faces the open door instead.
 *   - The plaza (the Streets) is outdoor STREET tile; room interiors are
 *     ROOM tile.
 *
 * `lit` is used throughout except where a test is specifically about
 * `extinguished` — it is the numeric no-op state (identical results to the
 * pre-lantern behaviour these tests originally covered), so it changes
 * nothing about what any of the non-lantern assertions below verify.
 */
const LIT = (x: number, y: number) => ({ x, y, lanternState: "lit" as LanternState });
const EXTINGUISHED = (x: number, y: number) => ({ x, y, lanternState: "extinguished" as LanternState });

describe("fog vision rules", () => {
  it("gives shorter vision outdoors than indoors — the fog is denser in the streets", () => {
    // Open plaza, south of Town Hall.
    expect(visionRadiusAt(LIT(400, 832))).toBe(VISION_RADIUS_OUTDOOR);
    // Inside the warehouse.
    expect(visionRadiusAt(LIT(1280, 440))).toBe(VISION_RADIUS_INDOOR);
    expect(VISION_RADIUS_OUTDOOR).toBeLessThan(VISION_RADIUS_INDOOR);
  });

  it("keeps both radii beyond interaction range, so nothing is interactable-but-invisible", () => {
    expect(VISION_RADIUS_OUTDOOR).toBeGreaterThan(KILL_RANGE);
    expect(VISION_RADIUS_OUTDOOR).toBeGreaterThan(REPORT_BODY_RANGE);
  });

  it("blocks line of sight through a wall", () => {
    // Tavern interior vs plaza, straight through the east wall at row 20.
    expect(hasLineOfSight({ x: 272, y: 656 }, { x: 336, y: 656 })).toBe(false);
  });

  it("passes line of sight through an open door", () => {
    // The same crossing shifted to the door rows.
    expect(hasLineOfSight({ x: 272, y: 560 }, { x: 336, y: 560 })).toBe(true);
  });

  it("sees freely within one room", () => {
    // Warehouse corner to corner: ~198 units, all interior floor.
    expect(canSee(LIT(1280, 440), LIT(1420, 580))).toBe(true);
  });

  it("hides a close player behind a wall despite the distance being tiny", () => {
    expect(canSee(LIT(272, 656), LIT(336, 656))).toBe(false);
  });

  it("cuts vision at the outdoor radius", () => {
    // 200 units apart in the open plaza: beyond outdoor vision.
    expect(canSee(LIT(400, 832), LIT(600, 832))).toBe(false);
    // 48 units apart: well within it.
    expect(canSee(LIT(352, 832), LIT(400, 832))).toBe(true);
  });

  it("lets a sheltered viewer see further than the fog-bound viewer sees back", () => {
    // Tavern doorway, 200 units: the indoor viewer's clear air reaches the
    // plaza figure; the outdoor viewer's fog does not reach back. This
    // asymmetry is deliberate — see `visionRadiusAt`.
    const indoors = LIT(272, 560);
    const inTheFog = LIT(472, 560);
    expect(canSee(indoors, inTheFog)).toBe(true);
    expect(canSee(inTheFog, indoors)).toBe(false);
  });

  it("always sees itself — zero distance is trivially visible", () => {
    const spot = LIT(400, 832);
    expect(canSee(spot, spot)).toBe(true);
  });

  describe("lantern-driven vision (§3.5/§6.2)", () => {
    it("sharply cuts the DOUSER's own vision radius when their lantern is extinguished", () => {
      const litRadius = visionRadiusAt(LIT(400, 832));
      const extinguishedRadius = visionRadiusAt(EXTINGUISHED(400, 832));
      expect(extinguishedRadius).toBe(litRadius * LANTERN_EXTINGUISHED_VISION_MULTIPLIER);
      expect(extinguishedRadius).toBeLessThan(litRadius);
    });

    it("still lets an extinguished player see at close range — the drop is severe, not blindness", () => {
      expect(visionRadiusAt(EXTINGUISHED(400, 832))).toBeGreaterThan(0);
    });

    it("hides an extinguished TARGET from a viewer who would otherwise see them", () => {
      // Open plaza, comfortably inside the viewer's own (lit, outdoor) radius
      // but past the extinguished-detection cap.
      const viewer = LIT(400, 832);
      const farEnoughToNormallySee = LIT(400 + VISION_RADIUS_OUTDOOR - 10, 832);
      expect(canSee(viewer, farEnoughToNormallySee)).toBe(true);

      const sameSpotExtinguished = EXTINGUISHED(400 + VISION_RADIUS_OUTDOOR - 10, 832);
      expect(canSee(viewer, sameSpotExtinguished)).toBe(false);
    });

    it("still lets a viewer spot an extinguished target up close — hiding isn't invisibility at melee range", () => {
      const viewer = LIT(400, 832);
      const closeExtinguished = EXTINGUISHED(400 + LANTERN_EXTINGUISHED_DETECTION_RADIUS - 10, 832);
      expect(canSee(viewer, closeExtinguished)).toBe(true);
    });

    it("never lets extinguishing grant invisibility at KILL_RANGE/REPORT_BODY_RANGE — the same invariant the base radii protect", () => {
      expect(LANTERN_EXTINGUISHED_DETECTION_RADIUS).toBeGreaterThan(KILL_RANGE);
      expect(LANTERN_EXTINGUISHED_DETECTION_RADIUS).toBeGreaterThan(REPORT_BODY_RANGE);
    });
  });
});
