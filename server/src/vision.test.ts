import { describe, expect, it } from "vitest";
import {
  VISION_RADIUS_INDOOR,
  VISION_RADIUS_OUTDOOR,
  KILL_RANGE,
  REPORT_BODY_RANGE,
  canSee,
  hasLineOfSight,
  visionRadiusAt,
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
 */
describe("fog vision rules", () => {
  it("gives shorter vision outdoors than indoors — the fog is denser in the streets", () => {
    // Open plaza, south of Town Hall.
    expect(visionRadiusAt({ x: 400, y: 832 })).toBe(VISION_RADIUS_OUTDOOR);
    // Inside the warehouse.
    expect(visionRadiusAt({ x: 1280, y: 440 })).toBe(VISION_RADIUS_INDOOR);
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
    expect(canSee({ x: 1280, y: 440 }, { x: 1420, y: 580 })).toBe(true);
  });

  it("hides a close player behind a wall despite the distance being tiny", () => {
    expect(canSee({ x: 272, y: 656 }, { x: 336, y: 656 })).toBe(false);
  });

  it("cuts vision at the outdoor radius", () => {
    // 200 units apart in the open plaza: beyond outdoor vision.
    expect(canSee({ x: 400, y: 832 }, { x: 600, y: 832 })).toBe(false);
    // 48 units apart: well within it.
    expect(canSee({ x: 352, y: 832 }, { x: 400, y: 832 })).toBe(true);
  });

  it("lets a sheltered viewer see further than the fog-bound viewer sees back", () => {
    // Tavern doorway, 200 units: the indoor viewer's clear air reaches the
    // plaza figure; the outdoor viewer's fog does not reach back. This
    // asymmetry is deliberate — see `visionRadiusAt`.
    const indoors = { x: 272, y: 560 };
    const inTheFog = { x: 472, y: 560 };
    expect(canSee(indoors, inTheFog)).toBe(true);
    expect(canSee(inTheFog, indoors)).toBe(false);
  });

  it("always sees itself — zero distance is trivially visible", () => {
    const spot = { x: 400, y: 832 };
    expect(canSee(spot, spot)).toBe(true);
  });
});
