import Phaser from "phaser";
import { colors } from "../../theme/tokens";

/**
 * The kill splatter (ART_BIBLE §10.1 beat 3): one hand-drawn-style ink splash
 * in `bloodDeep`/`bloodBright`.
 *
 * **Not a particle system, and the distinction is the whole point.** §10.1
 * calls for "hand-drawn ink splatter, not a particle system", and §2 rule 4
 * reserves sharp corners and hard angles for danger. A particle emitter gives
 * you round sprites on smooth arcs — soft, incidental, and in this art
 * language it reads as *safe*, which is precisely backwards for the moment a
 * player is murdered. So this is a single stamped sprite whose silhouette is
 * built from straight-edged polygon shards with hard vertices: every outline
 * is a run of line segments, and there is not one curve or radial gradient in
 * the whole texture.
 *
 * Drawn procedurally into a canvas texture rather than shipped as a PNG so it
 * needs no asset-pipeline round trip and cannot go missing from a fresh
 * checkout — the same tolerance `GameScene.preload` already builds in for the
 * Havener atlas. It is deterministic per variant: `SPLATTER_VARIANTS`
 * pre-bakes a handful so repeat kills don't stamp an identical shape, but each
 * one is fixed rather than randomised at draw time, which keeps this a
 * "hand-drawn asset" in behaviour as well as in look.
 *
 * §2 compliance, checked deliberately:
 *   - rule 2 (uniform thick INK outline): every shard is stroked in `ink` at a
 *     constant width, no taper.
 *   - rule 3 (flat fills, one shadow step): exactly two tones — `bloodDeep`
 *     under, `bloodBright` over. No gradient anywhere.
 *   - rule 4 (angular = threat): straight segments only.
 *   - rule 5 (palette lock): both fills and the outline are §3 tokens.
 */

export const SPLATTER_TEXTURE_PREFIX = "kill-splatter";
/** How many distinct pre-baked shapes exist. Repeat kills cycle through them. */
export const SPLATTER_VARIANTS = 3;

const SIZE = 192;
const OUTLINE_WIDTH = 3;

/**
 * One shard: a closed polygon of hard vertices, described as angle/radius
 * pairs around a centre so the shapes stay recognisably "splat" shaped while
 * every edge between vertices stays perfectly straight.
 *
 * These are hand-tuned literals rather than generated from a noise function —
 * a noise field produces the smooth, organic wobble the art bible is
 * specifically steering away from.
 */
interface Shard {
  cx: number;
  cy: number;
  /** [angle in turns, radius] — consecutive points are joined by straight lines. */
  points: Array<[number, number]>;
}

const VARIANT_SHARDS: Shard[][] = [
  [
    {
      cx: 0.5,
      cy: 0.5,
      points: [
        [0.0, 0.46], [0.06, 0.18], [0.13, 0.38], [0.2, 0.15],
        [0.28, 0.42], [0.36, 0.2], [0.43, 0.44], [0.5, 0.22],
        [0.58, 0.4], [0.65, 0.16], [0.72, 0.36], [0.8, 0.19],
        [0.87, 0.41], [0.94, 0.2],
      ],
    },
    { cx: 0.18, cy: 0.24, points: [[0.0, 0.1], [0.3, 0.04], [0.55, 0.09], [0.8, 0.03]] },
    { cx: 0.83, cy: 0.7, points: [[0.1, 0.09], [0.4, 0.03], [0.65, 0.08], [0.9, 0.04]] },
    { cx: 0.700, cy: 0.20, points: [[0.0, 0.06], [0.35, 0.02], [0.7, 0.05]] },
  ],
  [
    {
      cx: 0.48,
      cy: 0.52,
      points: [
        [0.03, 0.42], [0.1, 0.16], [0.18, 0.44], [0.25, 0.19],
        [0.33, 0.38], [0.41, 0.14], [0.48, 0.46], [0.56, 0.18],
        [0.63, 0.4], [0.71, 0.21], [0.78, 0.43], [0.86, 0.17],
        [0.93, 0.39],
      ],
    },
    { cx: 0.22, cy: 0.75, points: [[0.05, 0.11], [0.35, 0.04], [0.6, 0.1], [0.85, 0.05]] },
    { cx: 0.79, cy: 0.28, points: [[0.15, 0.08], [0.45, 0.03], [0.75, 0.07]] },
  ],
  [
    {
      cx: 0.52,
      cy: 0.48,
      points: [
        [0.01, 0.4], [0.09, 0.2], [0.16, 0.46], [0.24, 0.17],
        [0.31, 0.43], [0.39, 0.15], [0.47, 0.41], [0.54, 0.2],
        [0.62, 0.45], [0.69, 0.18], [0.77, 0.38], [0.84, 0.22],
        [0.92, 0.44], [0.97, 0.19],
      ],
    },
    { cx: 0.26, cy: 0.3, points: [[0.2, 0.1], [0.5, 0.03], [0.75, 0.09]] },
    { cx: 0.74, cy: 0.76, points: [[0.0, 0.09], [0.3, 0.04], [0.6, 0.08], [0.88, 0.03]] },
  ],
];

function tracePolygon(
  ctx: CanvasRenderingContext2D,
  shard: Shard,
  scale: number,
  size: number,
): void {
  ctx.beginPath();
  shard.points.forEach(([turn, radius], index) => {
    const angle = turn * Math.PI * 2;
    const x = (shard.cx + Math.cos(angle) * radius * scale) * size;
    const y = (shard.cy + Math.sin(angle) * radius * scale) * size;
    // `lineTo` throughout — never `arc`, `quadraticCurveTo` or
    // `bezierCurveTo`. That is what keeps every corner hard.
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.closePath();
}

/**
 * Builds all splatter variants once. Safe to call repeatedly — existing
 * textures are left alone, same shape as `PhaseAtmosphere`'s texture builders.
 */
export function buildSplatterTextures(scene: Phaser.Scene): void {
  for (let variant = 0; variant < SPLATTER_VARIANTS; variant++) {
    const key = `${SPLATTER_TEXTURE_PREFIX}-${variant}`;
    if (scene.textures.exists(key)) {
      continue;
    }
    const canvas = scene.textures.createCanvas(key, SIZE, SIZE);
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext();
    const shards = VARIANT_SHARDS[variant]!;

    ctx.lineJoin = "miter";
    ctx.lineCap = "butt";
    ctx.miterLimit = 8;
    ctx.lineWidth = OUTLINE_WIDTH;
    ctx.strokeStyle = colors.ink;

    // Pass 1 — the deep tone, drawn slightly larger. This is the "one shadow
    // step" of §2 rule 3, not a gradient and not an outline glow.
    ctx.fillStyle = colors.bloodDeep;
    for (const shard of shards) {
      tracePolygon(ctx, shard, 1.0, SIZE);
      ctx.fill();
      ctx.stroke();
    }

    // Pass 2 — the bright tone inset on top. Two tones total, flat.
    ctx.fillStyle = colors.bloodBright;
    for (const shard of shards) {
      tracePolygon(ctx, shard, 0.62, SIZE);
      ctx.fill();
    }

    canvas.refresh();
  }
}

/** The texture key for a given stamp, cycling through the baked variants. */
export function splatterKeyFor(index: number): string {
  const variant = ((index % SPLATTER_VARIANTS) + SPLATTER_VARIANTS) % SPLATTER_VARIANTS;
  return `${SPLATTER_TEXTURE_PREFIX}-${variant}`;
}
