import Phaser from "phaser";
import { ARCHETYPES } from "./archetypes";
import { PALETTE } from "./palette";
import { ANIMATION_TABLE, type AnimationName } from "./poses";
import {
  FRAME_SIZE,
  RIG_ORIGIN,
  applyBodyTransform,
  posePoints,
  type ArchetypeRig,
  type FramePose,
  type Point,
  type Shape,
} from "./rig";

/**
 * Builds the character atlas — one real Phaser texture, sliced into named
 * frames, driving real `AnimationManager` animations. Everything is drawn
 * once at scene boot with `Graphics` primitives and baked in with
 * `generateTexture`, the same technique `GameScene.createTilemap` already
 * uses for the town's tileset: no external art files, but still a genuine
 * spritesheet as far as the renderer and every performance characteristic
 * are concerned — one texture, GPU-batched, not sixteen live canvases.
 */

const ATLAS_KEY = "characters";
const LINE_WIDTH = 1.5;

/** Fixed per-archetype frame order — see `poses.ts` for what each holds. */
const FRAME_PLAN: Array<{ anim: AnimationName; index: number }> = (
  Object.keys(ANIMATION_TABLE) as AnimationName[]
).flatMap((anim) => ANIMATION_TABLE[anim].map((_, index) => ({ anim, index })));

function frameName(archetypeId: string, anim: AnimationName, index: number): string {
  return `${archetypeId}_${anim}${index}`;
}

/** A light, deterministic-enough scatter of dots for the "handmade" grain — not photographic noise, just enough irregularity that flat fills don't look vector-perfect. */
function paintGrain(g: Phaser.GameObjects.Graphics, points: Point[], baseFill: number): void {
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const area = (maxX - minX) * (maxY - minY);
  const dots = Math.max(2, Math.round(area / 18));
  const tone = baseFill === PALETTE.ink ? PALETTE.slateLight : PALETTE.ink;
  g.fillStyle(tone, 0.06);
  for (let i = 0; i < dots; i++) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    g.fillRect(x, y, 1, 1);
  }
}

function drawShape(
  g: Phaser.GameObjects.Graphics,
  shape: Shape,
  pose: FramePose,
  body: FramePose["body"],
  partKey: Exclude<keyof FramePose, "body">,
  cellX: number,
  cellY: number,
  outline: number,
): void {
  const posed = posePoints(shape.points, pose[partKey]);
  const withBody = applyBodyTransform(posed, body);
  const placed = withBody.map((p) => ({
    x: cellX + RIG_ORIGIN.x + p.x,
    y: cellY + RIG_ORIGIN.y + p.y,
  }));

  g.fillStyle(shape.fill);
  g.fillPoints(placed, true);
  g.lineStyle(LINE_WIDTH, shape.stroke ?? outline, 1);
  g.strokePoints(placed, true, true);
  paintGrain(g, placed, shape.fill);
}

function drawFrame(
  g: Phaser.GameObjects.Graphics,
  rig: ArchetypeRig,
  pose: FramePose,
  cellX: number,
  cellY: number,
): void {
  const body = pose.body;

  if (rig.prop?.behindTorso) {
    drawShape(g, rig.prop, pose, body, "prop", cellX, cellY, rig.outline);
  }

  drawShape(g, rig.parts.legL, pose, body, "legL", cellX, cellY, rig.outline);
  drawShape(g, rig.parts.legR, pose, body, "legR", cellX, cellY, rig.outline);
  drawShape(g, rig.parts.torso, pose, body, "torso", cellX, cellY, rig.outline);
  drawShape(g, rig.parts.armL, pose, body, "armL", cellX, cellY, rig.outline);
  drawShape(g, rig.parts.armR, pose, body, "armR", cellX, cellY, rig.outline);
  drawShape(g, rig.parts.head, pose, body, "head", cellX, cellY, rig.outline);

  if (rig.prop && !rig.prop.behindTorso) {
    drawShape(g, rig.prop, pose, body, "prop", cellX, cellY, rig.outline);
  }
}

/** Per-archetype animation keys, once registered — see `GameScene` for how these get played. */
export interface CharacterAnimSet {
  archetypeId: string;
  idle: string;
  walk: string;
  task: string;
  death: string;
  ghost: string;
}

/**
 * Build the atlas and register every animation. Idempotent per scene
 * instance — Phaser's texture manager is scene-independent (it lives on
 * the game), so a second `GameScene` (a StrictMode remount, a returned-to-
 * lobby restart) would otherwise try to redeclare the same texture key.
 */
export function buildCharacterSpriteSheet(scene: Phaser.Scene): CharacterAnimSet[] {
  const sets: CharacterAnimSet[] = ARCHETYPES.map((rig) => ({
    archetypeId: rig.id,
    idle: `char-${rig.id}-idle`,
    walk: `char-${rig.id}-walk`,
    task: `char-${rig.id}-task`,
    death: `char-${rig.id}-death`,
    ghost: `char-${rig.id}-ghost`,
  }));

  if (scene.textures.exists(ATLAS_KEY)) {
    ensureAnimations(scene, sets);
    return sets;
  }

  const cols = FRAME_PLAN.length;
  const rows = ARCHETYPES.length;
  const g = scene.add.graphics();

  ARCHETYPES.forEach((rig, row) => {
    FRAME_PLAN.forEach(({ anim, index }, col) => {
      const pose = ANIMATION_TABLE[anim][index]!;
      drawFrame(g, rig, pose, col * FRAME_SIZE, row * FRAME_SIZE);
    });
  });

  g.generateTexture(ATLAS_KEY, cols * FRAME_SIZE, rows * FRAME_SIZE);
  g.destroy();

  const texture = scene.textures.get(ATLAS_KEY);
  ARCHETYPES.forEach((rig, row) => {
    FRAME_PLAN.forEach(({ anim, index }, col) => {
      texture.add(
        frameName(rig.id, anim, index),
        0,
        col * FRAME_SIZE,
        row * FRAME_SIZE,
        FRAME_SIZE,
        FRAME_SIZE,
      );
    });
  });

  ensureAnimations(scene, sets);
  return sets;
}

function ensureAnimations(scene: Phaser.Scene, sets: CharacterAnimSet[]): void {
  for (const set of sets) {
    registerLoop(scene, set.idle, set.archetypeId, "idle", 3, true);
    registerLoop(scene, set.walk, set.archetypeId, "walk", 8, false);
    registerLoop(scene, set.task, set.archetypeId, "task", 4, true);
    registerLoop(scene, set.ghost, set.archetypeId, "ghost", 2, true);

    if (!scene.anims.exists(set.death)) {
      scene.anims.create({
        key: set.death,
        frames: ANIMATION_TABLE.death.map((_, index) => ({
          key: ATLAS_KEY,
          frame: frameName(set.archetypeId, "death", index),
        })),
        frameRate: 6,
        repeat: 0,
      });
    }
  }
}

function registerLoop(
  scene: Phaser.Scene,
  key: string,
  archetypeId: string,
  anim: AnimationName,
  frameRate: number,
  yoyo: boolean,
): void {
  if (scene.anims.exists(key)) {
    return;
  }
  scene.anims.create({
    key,
    frames: ANIMATION_TABLE[anim].map((_, index) => ({
      key: ATLAS_KEY,
      frame: frameName(archetypeId, anim, index),
    })),
    frameRate,
    repeat: -1,
    yoyo,
  });
}

export { ATLAS_KEY };
