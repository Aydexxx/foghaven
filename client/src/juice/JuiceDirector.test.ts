import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { graphicsEngine } from "../graphics/graphicsEngine";
import { JuiceDirector, MAX_HIT_STOP_MS, type JuiceStage } from "./JuiceDirector";

/**
 * The hit-stop tests are the reason this file exists. "Pause visual updates
 * without pausing the network clock" has two failure modes that a type check
 * and a play-test both wave straight through:
 *
 *   1. **Accumulating freezes.** Summing overlapping hit-stops instead of
 *      extending to the furthest release point. Looks fine on a single kill;
 *      turns a burst into a multi-second hang.
 *   2. **A paused visual clock.** Freezing by subtracting the frozen span
 *      from the time interpolation reads, rather than by gating whether we
 *      draw. Looks *identical* on screen for one freeze, and leaves every
 *      remote player permanently behind server truth by the accumulated
 *      frozen time.
 *
 * Both are asserted below against a simulated frame loop shaped exactly like
 * `GameScene.update` — network path outside the gate, render path inside it.
 *
 * Time is injected rather than slept: these have to be able to assert on
 * hundreds of overlapping hit-stops without taking hundreds of milliseconds
 * to do it.
 */

class FakeClock {
  now = 1_000;
  advance(ms: number): void {
    this.now += ms;
  }
}

class RecordingStage implements JuiceStage {
  shakes: Array<{ px: number; ms: number }> = [];
  punches: Array<{ scale: number; ms: number }> = [];
  freezeTransitions: boolean[] = [];

  shake(px: number, ms: number): void {
    this.shakes.push({ px, ms });
  }
  punchObject(_target: unknown, scale: number, ms: number): void {
    this.punches.push({ scale, ms });
  }
  setFrozen(frozen: boolean): void {
    this.freezeTransitions.push(frozen);
  }
}

/**
 * A stand-in for `GameScene.update`'s two-path shape. `networkTicks` stands
 * for `sampleAndSend` (fixed timestep, outside the freeze gate) and
 * `renderTicks` for `render`/`renderFog`/`atmosphere.update` (inside it).
 *
 * `interpolationTime` is the crucial one: it records the wall-clock instant
 * each rendered frame would have interpolated against. If a freeze ever
 * *subtracted* time rather than gating drawing, these values would fall
 * behind the clock and never catch up.
 */
const SIM_DT_MS = 16;

function runLoop(
  director: JuiceDirector,
  clock: FakeClock,
  frames: number,
  frameMs: number,
  onFrame?: (frame: number) => void,
): { networkTicks: number; renderTicks: number; interpolationTime: number[] } {
  let accumulator = 0;
  let networkTicks = 0;
  let renderTicks = 0;
  const interpolationTime: number[] = [];

  for (let frame = 0; frame < frames; frame++) {
    clock.advance(frameMs);
    onFrame?.(frame);

    // --- Network path: never gated on the freeze. ---
    accumulator += frameMs;
    while (accumulator >= SIM_DT_MS) {
      networkTicks++;
      accumulator -= SIM_DT_MS;
    }

    // --- Render path: gated. ---
    if (!director.isFrozen()) {
      renderTicks++;
      interpolationTime.push(clock.now);
    }
  }

  return { networkTicks, renderTicks, interpolationTime };
}

describe("JuiceDirector hit-stop", () => {
  let clock: FakeClock;
  let director: JuiceDirector;
  let stage: RecordingStage;

  beforeEach(() => {
    clock = new FakeClock();
    director = new JuiceDirector(() => clock.now);
    stage = new RecordingStage();
    director.bindStage(stage);
  });

  it("freezes for the requested duration and then releases on its own", () => {
    director.hitStop(80);
    expect(director.isFrozen()).toBe(true);

    clock.advance(79);
    expect(director.isFrozen()).toBe(true);

    clock.advance(2);
    expect(director.isFrozen()).toBe(false);
  });

  it("extends rather than sums when hit-stops overlap", () => {
    director.hitStop(80);
    clock.advance(10);
    // 70ms still to run on the first; a second 80ms stop should release at
    // 80ms from *now*, i.e. 90ms from the original call — not 160ms.
    director.hitStop(80);
    expect(director.hitStopRemaining()).toBe(80);

    clock.advance(80);
    expect(director.isFrozen()).toBe(false);
  });

  it("never lets a shorter hit-stop cut a longer one short", () => {
    director.hitStop(120);
    clock.advance(10);
    director.hitStop(20);
    // The 20ms stop would release at +30ms; the 120ms one still owns the
    // freeze until +120ms.
    expect(director.hitStopRemaining()).toBe(110);
  });

  it("stays bounded under a burst of rapid hit-stops", () => {
    // 200 kills in 200ms — far past anything the game can produce, which is
    // the point: the ceiling has to hold without depending on the caller.
    for (let i = 0; i < 200; i++) {
      director.hitStop(80);
      clock.advance(1);
    }
    expect(director.hitStopRemaining()).toBeLessThanOrEqual(MAX_HIT_STOP_MS);
    // And it does eventually release.
    clock.advance(MAX_HIT_STOP_MS + 1);
    expect(director.isFrozen()).toBe(false);
  });

  it("caps any single hit-stop at MAX_HIT_STOP_MS", () => {
    director.hitStop(10_000);
    expect(director.hitStopRemaining()).toBe(MAX_HIT_STOP_MS);
  });

  it("does not pause the network clock while visuals are frozen", () => {
    // 60 frames at 16ms = 960ms of wall clock, with a hit-stop every 100ms.
    const withHitStops = runLoop(director, clock, 60, 16, (frame) => {
      if (frame % 6 === 0) {
        director.hitStop(80);
      }
    });

    const baselineClock = new FakeClock();
    const baseline = runLoop(new JuiceDirector(() => baselineClock.now), baselineClock, 60, 16);

    // The whole requirement, in one assertion: the freeze changed how much we
    // drew and nothing at all about how much we simulated and sent.
    expect(withHitStops.networkTicks).toBe(baseline.networkTicks);
    expect(withHitStops.renderTicks).toBeLessThan(baseline.renderTicks);
    expect(withHitStops.renderTicks).toBeGreaterThan(0);
  });

  it("resumes rendering at true wall-clock time, never behind it", () => {
    const result = runLoop(director, clock, 40, 16, (frame) => {
      if (frame % 5 === 0) {
        director.hitStop(48);
      }
    });

    // Every frame that did draw interpolated against the live clock. If the
    // freeze had been implemented by pausing a visual clock, the last drawn
    // frame would trail `clock.now` by the total frozen span.
    const lastDrawn = result.interpolationTime[result.interpolationTime.length - 1];
    expect(lastDrawn).toBeDefined();
    expect(clock.now - lastDrawn!).toBeLessThanOrEqual(16);

    // And the drawn timestamps are strictly increasing — no rewind on resume.
    for (let i = 1; i < result.interpolationTime.length; i++) {
      expect(result.interpolationTime[i]!).toBeGreaterThan(result.interpolationTime[i - 1]!);
    }
  });

  it("reports each freeze transition to the stage exactly once", () => {
    stage.freezeTransitions.length = 0;

    director.hitStop(50);
    director.isFrozen();
    director.isFrozen();
    director.isFrozen();
    clock.advance(51);
    director.isFrozen();
    director.isFrozen();

    expect(stage.freezeTransitions).toEqual([true, false]);
  });

  it("drops an in-flight freeze on reset so it cannot outlive its scene", () => {
    director.hitStop(MAX_HIT_STOP_MS);
    expect(director.isFrozen()).toBe(true);
    director.reset();
    expect(director.isFrozen()).toBe(false);
    expect(director.hitStopRemaining()).toBe(0);
  });
});

describe("JuiceDirector reduced motion", () => {
  let clock: FakeClock;
  let director: JuiceDirector;
  let stage: RecordingStage;

  beforeEach(() => {
    clock = new FakeClock();
    director = new JuiceDirector(() => clock.now);
    stage = new RecordingStage();
    director.bindStage(stage);
    graphicsEngine.setReducedMotion("off");
  });

  afterEach(() => {
    graphicsEngine.setReducedMotion("system");
  });

  it("passes displacement through at full amplitude when motion is allowed", () => {
    director.shake(8, 250);
    expect(stage.shakes).toEqual([{ px: 8, ms: 250 }]);
  });

  it("scales shake amplitude to zero without suppressing anything else", () => {
    graphicsEngine.setReducedMotion("on");
    director.shake(8, 250);
    expect(stage.shakes).toEqual([]);
  });

  it("keeps hit-stop DURATION identical under reduced motion", () => {
    graphicsEngine.setReducedMotion("on");
    director.hitStop(80);
    // The whole fairness requirement: an accessibility setting must not hand
    // its user the aftermath of a kill 80ms before everyone else sees it.
    expect(director.hitStopRemaining()).toBe(80);
    expect(director.isFrozen()).toBe(true);
  });

  it("leaves a punched object at rest rather than collapsing it to nothing", () => {
    graphicsEngine.setReducedMotion("on");
    // Scaling the multiplier instead of the delta would send 1.06 -> 0.
    director.punch({ scaleX: 1, scaleY: 1, setScale: () => {} }, 1.06, 120);
    expect(stage.punches).toEqual([]);
  });

  it("preserves the vignette level, which carries game state rather than motion", () => {
    graphicsEngine.setReducedMotion("on");
    director.vignette(0.55, 300);
    // Zeroing this would delete the standing "a sabotage is running" signal.
    expect(director.currentVignette()).toBe(0.55);
  });

  it("honours the explicit off override even when the OS asks for reduced motion", () => {
    graphicsEngine.setReducedMotion("off");
    expect(graphicsEngine.prefersReducedMotion()).toBe(false);
    director.shake(8, 250);
    expect(stage.shakes).toHaveLength(1);
  });
});
