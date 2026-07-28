/**
 * The single source of truth for every duration, amplitude, and easing the
 * Havener's six ART_BIBLE §4.4 animation states use.
 *
 * Nothing in `Havener.ts` hardcodes a tween number — every tween reads its
 * values from `HAVENER_ANIM_CONFIG` at the moment it starts, not once at
 * construction, so mutating this object (as the dev playground's sliders do)
 * takes effect immediately. This is deliberately a plain mutable object, not
 * `as const`: a live-tunable config has to be writable.
 *
 * `walkConfigLeaves` is the generic mechanism that makes the playground's
 * "a live slider for every value" possible without hand-listing every field:
 * it walks the object once and yields a `{ path, get, set }` handle per
 * numeric leaf, inferring a sensible slider range from the key's own name
 * (a field ending in `Ms` gets a duration range, `Deg` an angle range, and so
 * on — see `RANGE_HINTS`). Add a field here and the playground grows a
 * correctly-ranged slider for it with zero other code changes.
 */

export interface HavenerAnimConfig {
  idle: {
    /** §4.4: "900 ms loop". */
    periodMs: number;
    /** §4.4: "Body scaleY 1.0 → 1.02". Stored as the delta above 1.0. */
    bodyScaleYAmplitude: number;
    /** §4.4: "Lantern rotates ±3°". */
    lanternSwayDeg: number;
    /** §4.4: "offset 150 ms behind the body". */
    lanternLagMs: number;
  };
  walk: {
    /** §4.4: "450 ms loop". */
    periodMs: number;
    /** §4.4: "Body bobs ±2 px". */
    bodyBobPx: number;
    /**
     * §4.4: "Legs alternate ±14° from hip" and "Coat hem lags body by 60 ms".
     * There is no separate sliced hem layer yet (§4.2 `legs` is the closest
     * lower-body layer today), so the hem lag is applied to the same leg
     * swing that stands in for it — see `Havener.startWalk`.
     */
    legSwingDeg: number;
    hemLagMs: number;
    /** §4.4: "Lantern swings ±8°". */
    lanternSwingDeg: number;
  };
  run: {
    /** §4.4: "320 ms loop". */
    periodMs: number;
    /** §4.4: "Same as walk, amplitudes ×1.4". */
    amplitudeMultiplier: number;
    /** §4.4: "body leans 5° into direction". */
    leanDeg: number;
  };
  interact: {
    /** §4.4: "400 ms once". */
    durationMs: number;
    /** §4.4: "Body squashes to scaleY 0.94". */
    squashScaleY: number;
    /** §4.4: "lantern raises 6 px". */
    lanternRaisePx: number;
    /** §4.4: "small flameCore sparkle at hand" — this animation's own duration. */
    sparkleDurationMs: number;
    sparkleRadiusPx: number;
  };
  ghost: {
    /** §4.4: "1200 ms loop". */
    periodMs: number;
    /** §4.4: "Alpha 0.45". */
    alpha: number;
    /** §4.4: "vertical float ±4 px". */
    floatPx: number;
    /** §4.4: "hem dissolves into three drifting wisps". */
    wispCount: number;
    wispDriftPx: number;
    wispDriftMs: number;
    wispAlpha: number;
    wispRadiusPx: number;
  };
  death: {
    squash: {
      /** §4.4: "Squash to scaleX 1.2 / scaleY 0.8 over 80 ms". */
      durationMs: number;
      scaleX: number;
      scaleY: number;
    };
    fall: {
      /** The body's topple, filling the remainder of the §4.4 "500 ms once" total. */
      durationMs: number;
      /** How far the whole composite topples over — rotation, not translation (see class doc on why). */
      rotationDeg: number;
      /** Extra flattening squash layered on top as it settles. */
      settleScaleY: number;
    };
    lantern: {
      /** A beat after the squash starts before the lantern visibly lets go. */
      detachDelayMs: number;
      /** The accelerating toss away from the hand — gravity taking over. */
      fallDurationMs: number;
      fallSidewaysPx: number;
      fallDownPx: number;
      /** §4.4: "bounces once" — one decelerate-up/accelerate-down hop, not Phaser's multi-bounce ease. */
      bounceDurationMs: number;
      bounceHeightPx: number;
      /** §4.4: "rolls" — a decaying slide with continuous rotation after the bounce settles. */
      rollDurationMs: number;
      rollDistancePx: number;
      rollRotationDeg: number;
      /** §4.4: "its glow fades to zero over 400 ms" — literal spec value, still tunable. */
      glowFadeMs: number;
    };
  };
}

export const HAVENER_ANIM_CONFIG: HavenerAnimConfig = {
  idle: {
    periodMs: 900,
    bodyScaleYAmplitude: 0.02,
    lanternSwayDeg: 3,
    lanternLagMs: 150,
  },
  walk: {
    periodMs: 450,
    bodyBobPx: 2,
    legSwingDeg: 14,
    hemLagMs: 60,
    lanternSwingDeg: 8,
  },
  run: {
    periodMs: 320,
    amplitudeMultiplier: 1.4,
    leanDeg: 5,
  },
  interact: {
    durationMs: 400,
    squashScaleY: 0.94,
    lanternRaisePx: 6,
    sparkleDurationMs: 260,
    sparkleRadiusPx: 5,
  },
  ghost: {
    periodMs: 1200,
    alpha: 0.45,
    floatPx: 4,
    wispCount: 3,
    wispDriftPx: 6,
    wispDriftMs: 1600,
    wispAlpha: 0.35,
    wispRadiusPx: 3,
  },
  death: {
    squash: {
      durationMs: 80,
      scaleX: 1.2,
      scaleY: 0.8,
    },
    fall: {
      durationMs: 420,
      rotationDeg: 78,
      settleScaleY: 0.85,
    },
    lantern: {
      detachDelayMs: 40,
      fallDurationMs: 220,
      fallSidewaysPx: 26,
      fallDownPx: 20,
      bounceDurationMs: 150,
      bounceHeightPx: 14,
      rollDurationMs: 280,
      rollDistancePx: 24,
      rollRotationDeg: 110,
      glowFadeMs: 400,
    },
  },
};

// ---------------------------------------------------------------------------
// Generic leaf walker — the mechanism the playground uses to build one slider
// per numeric value without hand-listing fields.
// ---------------------------------------------------------------------------

export interface ConfigLeaf {
  /** Dotted path, e.g. "death.lantern.bounceHeightPx" — also the slider's label. */
  path: string;
  get: () => number;
  set: (value: number) => void;
  /** A slider range inferred from the key name — see `RANGE_HINTS`. */
  range: { min: number; max: number; step: number };
}

/** Suffix → slider range. Checked in order; first match wins. */
const RANGE_HINTS: Array<{ suffix: string; min: number; max: number; step: number }> = [
  { suffix: "Ms", min: 0, max: 2000, step: 10 },
  { suffix: "Deg", min: -180, max: 180, step: 1 },
  { suffix: "Px", min: -60, max: 60, step: 1 },
  { suffix: "Alpha", min: 0, max: 1, step: 0.01 },
  { suffix: "Multiplier", min: 0.25, max: 3, step: 0.05 },
  { suffix: "Count", min: 0, max: 8, step: 1 },
  { suffix: "Radius", min: 0, max: 40, step: 1 },
];
const DEFAULT_RANGE = { min: 0, max: 2, step: 0.01 };

function rangeFor(key: string): ConfigLeaf["range"] {
  const lowerKey = key.toLowerCase();
  const hit = RANGE_HINTS.find((h) => lowerKey.endsWith(h.suffix.toLowerCase()));
  return hit ? { min: hit.min, max: hit.max, step: hit.step } : DEFAULT_RANGE;
}

/** Recursively collects every numeric leaf in an object tree as a get/set handle. */
export function walkConfigLeaves(obj: object, prefix = ""): ConfigLeaf[] {
  const leaves: ConfigLeaf[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "number") {
      const container = obj as Record<string, number>;
      leaves.push({
        path,
        get: () => container[key]!,
        set: (v: number) => {
          container[key] = v;
        },
        range: rangeFor(key),
      });
    } else if (value !== null && typeof value === "object") {
      leaves.push(...walkConfigLeaves(value, path));
    }
  }
  return leaves;
}
