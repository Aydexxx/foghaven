import { describe, expect, it } from "vitest";
import {
  applyInput,
  applyInputWithLocks,
  speedScaleFor,
  type Direction,
} from "./movement";
import {
  INJURED_SPEED_MULTIPLIER,
  PLAYER_CONDITION,
  PLAYER_SPEED,
  SIM_DT,
} from "../config/gameConfig";

/**
 * §8.1's limp, at the one place it is actually implemented.
 *
 * These live in `shared/` rather than with the server tests on purpose: the
 * whole point of `speedScale` riding through `applyInput` is that the server
 * simulation and the client's prediction call the SAME function, so the
 * property worth pinning is a property of that function, not of either caller.
 */

/** Open plaza, well clear of any wall, so collision never masks a speed change. */
const OPEN = { x: 600, y: 832 };
const EAST: Direction = { x: 1, y: 0 };

describe("§8.1 injured movement speed", () => {
  it("maps condition to a scale, and only injury changes it", () => {
    expect(speedScaleFor(PLAYER_CONDITION.HEALTHY)).toBe(1);
    expect(speedScaleFor(PLAYER_CONDITION.INJURED)).toBe(INJURED_SPEED_MULTIPLIER);
    // Dead players are not simulated at all — see `speedScaleFor`'s doc for
    // why this is deliberately the healthy scale rather than 0.
    expect(speedScaleFor(PLAYER_CONDITION.DEAD)).toBe(1);
  });

  it("is ~25% slower per step while injured", () => {
    const healthy = applyInput(OPEN, EAST, SIM_DT);
    const injured = applyInput(OPEN, EAST, SIM_DT, INJURED_SPEED_MULTIPLIER);

    const healthyStep = healthy.x - OPEN.x;
    const injuredStep = injured.x - OPEN.x;

    expect(healthyStep).toBeCloseTo(PLAYER_SPEED * SIM_DT, 6);
    expect(injuredStep).toBeCloseTo(PLAYER_SPEED * INJURED_SPEED_MULTIPLIER * SIM_DT, 6);
    expect(injuredStep / healthyStep).toBeCloseTo(0.75, 6);
  });

  it("scales both axes, so a limp is not faster diagonally", () => {
    const diagonal: Direction = { x: 1, y: 1 };
    const healthy = applyInput(OPEN, diagonal, SIM_DT);
    const injured = applyInput(OPEN, diagonal, SIM_DT, INJURED_SPEED_MULTIPLIER);

    const healthyDist = Math.hypot(healthy.x - OPEN.x, healthy.y - OPEN.y);
    const injuredDist = Math.hypot(injured.x - OPEN.x, injured.y - OPEN.y);
    expect(injuredDist / healthyDist).toBeCloseTo(INJURED_SPEED_MULTIPLIER, 6);
    // And the existing diagonal normalisation still holds at the new speed.
    expect(injuredDist).toBeCloseTo(PLAYER_SPEED * INJURED_SPEED_MULTIPLIER * SIM_DT, 6);
  });

  it("defaults to full speed, so every pre-8.1 caller is unaffected", () => {
    expect(applyInput(OPEN, EAST, SIM_DT)).toEqual(applyInput(OPEN, EAST, SIM_DT, 1));
    expect(applyInputWithLocks(OPEN, EAST, SIM_DT, [])).toEqual(
      applyInputWithLocks(OPEN, EAST, SIM_DT, [], 1),
    );
  });

  it("carries the scale through the locked-door wrapper both sides call", () => {
    const injured = applyInputWithLocks(OPEN, EAST, SIM_DT, [], INJURED_SPEED_MULTIPLIER);
    expect(injured.x - OPEN.x).toBeCloseTo(PLAYER_SPEED * INJURED_SPEED_MULTIPLIER * SIM_DT, 6);
  });

  it("never lets a limp walk through a wall the healthy stride was stopped by", () => {
    // Walking west into the map edge: clamped identically at either speed,
    // because the scale changes the step, never the collision rule.
    const atEdge = { x: 0, y: 832 };
    const west: Direction = { x: -1, y: 0 };
    const healthy = applyInput(atEdge, west, SIM_DT);
    const injured = applyInput(atEdge, west, SIM_DT, INJURED_SPEED_MULTIPLIER);
    expect(injured.x).toBe(healthy.x);
  });
});
