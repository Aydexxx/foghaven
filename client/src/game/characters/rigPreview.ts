import { ARCHETYPES_BY_ID } from "./archetypes";
import { PALETTE } from "./palette";
import {
  ACCESSORY_VISUALS,
  HAT_VISUALS,
  OUTFIT_VISUALS,
  PET_VISUALS,
} from "./cosmeticVisuals";
import { FRAME_SIZE, RIG_ORIGIN, applyBodyTransform, posePoints, type FramePose, type Point, type Shape } from "./rig";

/**
 * A static, non-Phaser render of one rig — used wherever a costumed preview
 * is needed outside the live game world: the equip screen (so choosing a hat
 * shows the hat) and the game-over results screen (a winner's victory pose).
 *
 * Deliberately plain `CanvasRenderingContext2D`, not a second Phaser
 * instance. Both of those screens are ordinary React DOM, `GameScene` is
 * never mounted behind them (see `GameOverScreen`'s own doc), and spinning up
 * a real `Phaser.Game`/WebGL context per preview row would be real overhead
 * for something that only ever needs one still frame. Reusing `rig.ts`'s pure
 * geometry functions (`posePoints`, `applyBodyTransform`) instead of
 * duplicating them is what keeps this pixel-consistent with the live sprite
 * sheet despite the two having entirely different renderers underneath.
 */

export interface RigPreviewOptions {
  archetypeId: string;
  /** A single static frame — omit for the plain rest pose. */
  pose?: FramePose;
  hat?: string;
  accessory?: string;
  outfit?: string;
  pet?: string;
}

const OUTLINE_WIDTH = 1.5;

function toHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function fillPolygon(ctx: CanvasRenderingContext2D, points: Point[], fill: number, stroke: number): void {
  if (points.length === 0) {
    return;
  }
  ctx.beginPath();
  const first = points[0]!;
  ctx.moveTo(first.x, first.y);
  for (const p of points.slice(1)) {
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = toHex(fill);
  ctx.fill();
  ctx.strokeStyle = toHex(stroke);
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
}

function drawArchetypeShape(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  pose: FramePose,
  body: FramePose["body"],
  partKey: keyof Omit<FramePose, "body">,
  outline: number,
): void {
  const posed = posePoints(shape.points, pose[partKey]);
  const withBody = applyBodyTransform(posed, body);
  fillPolygon(ctx, withBody, shape.fill, shape.stroke ?? outline);
}

/** A cosmetic overlay's points are already absolute rig-local coordinates — no per-frame pose applied, matching the live scene's fixed-anchor behaviour (see `cosmeticVisuals.ts`'s module doc). */
function drawCosmeticShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  fillPolygon(ctx, shape.points, shape.fill, shape.stroke ?? PALETTE.ink);
}

/**
 * Render one frame onto `ctx`, which should already be sized to at least
 * `FRAME_SIZE x FRAME_SIZE` CSS pixels (see `RIG_PREVIEW_SIZE`). The canvas is
 * cleared first, so this is safe to call repeatedly (e.g. once per selection
 * change while browsing the equip screen).
 */
export function drawRigPreview(ctx: CanvasRenderingContext2D, options: RigPreviewOptions): void {
  const rig = ARCHETYPES_BY_ID.get(options.archetypeId);
  ctx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE);
  if (!rig) {
    return;
  }

  ctx.save();
  ctx.translate(RIG_ORIGIN.x, RIG_ORIGIN.y);

  const pose = options.pose ?? {};
  const body = pose.body;

  if (rig.prop?.behindTorso) {
    drawArchetypeShape(ctx, rig.prop, pose, body, "prop", rig.outline);
  }
  drawArchetypeShape(ctx, rig.parts.legL, pose, body, "legL", rig.outline);
  drawArchetypeShape(ctx, rig.parts.legR, pose, body, "legR", rig.outline);
  drawArchetypeShape(ctx, rig.parts.torso, pose, body, "torso", rig.outline);

  const outfit = options.outfit ? OUTFIT_VISUALS[options.outfit] : undefined;
  if (outfit) {
    drawCosmeticShape(ctx, outfit);
  }

  drawArchetypeShape(ctx, rig.parts.armL, pose, body, "armL", rig.outline);
  drawArchetypeShape(ctx, rig.parts.armR, pose, body, "armR", rig.outline);
  drawArchetypeShape(ctx, rig.parts.head, pose, body, "head", rig.outline);

  const accessory = options.accessory ? ACCESSORY_VISUALS[options.accessory] : undefined;
  if (accessory) {
    drawCosmeticShape(ctx, accessory);
  }
  const hat = options.hat ? HAT_VISUALS[options.hat] : undefined;
  if (hat) {
    drawCosmeticShape(ctx, hat);
  }

  if (rig.prop && !rig.prop.behindTorso) {
    drawArchetypeShape(ctx, rig.prop, pose, body, "prop", rig.outline);
  }

  const pet = options.pet ? PET_VISUALS[options.pet] : undefined;
  if (pet) {
    drawCosmeticShape(ctx, pet);
  }

  ctx.restore();
}

/** The natural canvas size for a preview at 1:1 with rig-local units — see `FRAME_SIZE`. */
export const RIG_PREVIEW_SIZE = FRAME_SIZE;
