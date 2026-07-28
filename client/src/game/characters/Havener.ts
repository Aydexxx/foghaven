import Phaser from "phaser";
import { colors } from "../../theme/tokens";
import { AtlasKey } from "../../assets/atlasManifest";
import { CHARACTER_HEIGHT, anchorLocal, type AnchorName } from "./anchors";

/**
 * The Havener — the one composite character from docs/ART_BIBLE.md §4.
 *
 * §4.1: everyone in Foghaven is the *same* Havener, an identical hooded body.
 * Identity is carried entirely by the lantern's colour (§3.5), never by the
 * body. So this is one construction for every player, not the six colour-
 * derived costumes the older procedural rig produced — see the class comment
 * in GameScene for how the two render paths coexist for now.
 *
 * §4.2: it is never one flat image. It is a stack of independent layers, each
 * living in its own holder container so the z-order is fixed and a cosmetic
 * swap never disturbs a sibling:
 *
 *   z0 pet · z1 backItem · z2 bodyBase · z3 legs · z4 face ·
 *   z5 headItem · z6 heldItem (lantern) · z7 glowOverlay
 *
 * The z8 nameplate is deliberately NOT a child here: §4.2 says it must stay
 * upright and never rotate, and this whole container mirrors (scaleX = ±1) to
 * face left/right per §4.5. GameScene keeps the nameplate as an external
 * sibling in world space, as it always has.
 *
 * Animation is intentionally minimal for this task: idle breathing + lantern
 * sway (§4.4) and facing are done properly; walk/task reuse idle and death is
 * a placeholder settle. The full §4.4 choreography — above all the signature
 * detaching-lantern death — is deferred to 7.6.
 */

/** The atlas texture key loaded in GameScene.preload (the 7.3 pipeline output). */
export const HAVENER_ATLAS_KEY = "havener-atlas";
/** §4.5: the side profile drives left/right movement. */
const BODY_FRAME: AtlasKey = "character-side-01";
/** Which way the source art faces before any mirroring (flip this if the art is redrawn facing left). */
const BASE_FACING: Facing = "right";

export type Facing = "left" | "right";
export type HavenerState = "idle" | "walk" | "task" | "ghost" | "death";

const GHOST_ALPHA = 0.45; // §4.4 ghost
const IDLE_PERIOD_MS = 900; // §4.4 idle loop
const LANTERN_LAG_MS = 150; // §4.4 "lantern ... offset 150 ms behind the body"
const LANTERN_SWAY_DEG = 3; // §4.4 idle "Lantern rotates ±3°"

// §4.2 stack, top of file order = draw order. The `anchor` each layer sits on
// is the ONLY place a layer's position comes from (all via `anchorLocal`).
const LAYERS = [
  { key: "pet", anchor: "feet" },
  { key: "backItem", anchor: "back" },
  { key: "bodyBase", anchor: "feet" },
  { key: "legs", anchor: "feet" },
  { key: "face", anchor: "face" },
  { key: "headItem", anchor: "crown" },
  { key: "heldItem", anchor: "hand" },
  { key: "glowOverlay", anchor: "hand" },
] as const;

type LayerKey = (typeof LAYERS)[number]["key"];

/**
 * Which layer holder a cosmetic attaching to a given anchor drops into, so its
 * depth matches §4.2. `chest` has no dedicated §4.2 z-layer (it is a §4.3
 * attach point for badges/emblems worn on the coat), so it rides in the
 * bodyBase holder, drawn above the body — the stubby boots in `legs` sit down
 * at the feet and never overlap a chest emblem.
 */
const ANCHOR_LAYER: Record<AnchorName, LayerKey> = {
  feet: "pet",
  back: "backItem",
  chest: "bodyBase",
  face: "face",
  crown: "headItem",
  hand: "heldItem",
};

function hexNum(hex: string): number {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}
const WHITE = Phaser.Display.Color.GetColor(255, 255, 255);

export class Havener extends Phaser.GameObjects.Container {
  private readonly holders: Record<LayerKey, Phaser.GameObjects.Container>;
  private readonly cosmetics = new Map<AnchorName, Phaser.GameObjects.GameObject>();
  private lantern!: Phaser.GameObjects.Rectangle;
  private glow!: Phaser.GameObjects.Rectangle;
  private facing: Facing = BASE_FACING;
  private visualState: HavenerState = "idle";
  private idleTweens: Phaser.Tweens.Tween[] = [];
  private deathTimer?: Phaser.Time.TimerEvent;
  private lanternColorNum = WHITE;

  constructor(scene: Phaser.Scene, x: number, y: number, lanternHex: string) {
    super(scene, x, y);
    this.lanternColorNum = hexNum(lanternHex);

    // Build the eight holders in z-order and add them as children in that same
    // order — Phaser draws container children by index, so this IS the stack.
    this.holders = {} as Record<LayerKey, Phaser.GameObjects.Container>;
    for (const layer of LAYERS) {
      const holder = scene.add.container(0, 0);
      this.holders[layer.key] = holder;
      this.add(holder);
    }

    this.buildBody();
    this.buildLanternAndGlow();

    scene.add.existing(this);
    this.setFacing(BASE_FACING);
    this.startIdle();
  }

  // --- Construction -------------------------------------------------------

  private buildBody(): void {
    const hasArt = this.scene.textures.exists(HAVENER_ATLAS_KEY);
    if (hasArt) {
      // Real side art (from the 7.3 atlas, already the .clean.png version).
      // Scaled to the §4.1 ~96px body height so the fixed §4.3 anchors land on
      // it whatever the raw frame size is; origin bottom-centre so its feet sit
      // on the composite origin.
      const body = this.scene.add.image(0, 0, HAVENER_ATLAS_KEY, BODY_FRAME).setOrigin(0.5, 1);
      const scale = CHARACTER_HEIGHT / (body.height || CHARACTER_HEIGHT);
      body.setScale(scale);
      this.holders.bodyBase.add(body);
      // legs + face are baked into this un-sliced art. Their holders still
      // exist (z-order + future slices + cosmetic visors), just empty for now.
      return;
    }
    // No atlas yet (`npm run atlas` not run): pure placeholder composite, so
    // the architecture is still fully visible and verifiable.
    this.holders.bodyBase.add(
      this.scene.add.rectangle(0, -CHARACTER_HEIGHT / 2, 40, CHARACTER_HEIGHT, hexNum(colors.fogMid)),
    );
    const feet = anchorLocal("feet");
    this.holders.legs.add(this.scene.add.rectangle(feet.x, feet.y - 6, 26, 12, hexNum(colors.ink)));
    const face = anchorLocal("face");
    this.holders.face.add(this.scene.add.ellipse(face.x - 6, face.y, 7, 9, hexNum(colors.flameGlow)));
    this.holders.face.add(this.scene.add.ellipse(face.x + 6, face.y, 6, 8, hexNum(colors.flameGlow)));
  }

  private buildLanternAndGlow(): void {
    const hand = anchorLocal("hand");

    // §4.2 z7 glow: an additive, tinted sprite at the hand. Placeholder soft
    // blob; a real radial-gradient texture swaps in later without touching this.
    this.glow = this.scene.add
      .rectangle(hand.x, hand.y, 40, 40, WHITE)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.45);
    this.holders.glowOverlay.add(this.glow);

    // §4.2 z6 lantern: tinted at runtime with the player's colour. Origin
    // top-centre so the idle sway pendulums from where the hand holds it.
    this.lantern = this.scene.add.rectangle(hand.x, hand.y - 8, 12, 18, WHITE).setOrigin(0.5, 0);
    this.holders.heldItem.add(this.lantern);

    this.applyLanternColor();
  }

  private applyLanternColor(): void {
    this.lantern.setFillStyle(this.lanternColorNum);
    this.glow.setFillStyle(this.lanternColorNum);
  }

  // --- Public API ---------------------------------------------------------

  /** §3.5: retint the lantern (and its glow) to the player's identity light. */
  setLanternColor(hex: string): void {
    this.lanternColorNum = hexNum(hex);
    this.applyLanternColor();
  }

  /** §4.5: face left or right by mirroring the whole composite. No-op if unchanged. */
  setFacing(dir: Facing): void {
    if (dir === this.facing && this.scaleX !== 0) {
      return;
    }
    this.facing = dir;
    const magnitude = Math.abs(this.scaleX) || 1;
    this.scaleX = dir === BASE_FACING ? magnitude : -magnitude;
  }

  /**
   * Attach a cosmetic to a named §4.3 anchor, dropping it into the §4.2 layer
   * that anchor belongs to. Swapping replaces only that slot's object; sibling
   * layers and the container itself are untouched (never rebuilt). Pass the
   * same anchor again to swap; `detach` to clear.
   */
  attach(anchor: AnchorName, object: Phaser.GameObjects.GameObject): void {
    this.detach(anchor);
    const local = anchorLocal(anchor);
    // Every attachable is a Components.Transform object in practice; position
    // it at the anchor without assuming a concrete subclass.
    const withXY = object as unknown as { x: number; y: number };
    withXY.x = local.x;
    withXY.y = local.y;
    this.holders[ANCHOR_LAYER[anchor]].add(object);
    this.cosmetics.set(anchor, object);
  }

  /** Remove whatever cosmetic is on this anchor. No-op if the slot is empty. */
  detach(anchor: AnchorName): void {
    const existing = this.cosmetics.get(anchor);
    if (existing) {
      existing.destroy();
      this.cosmetics.delete(anchor);
    }
  }

  /** Drive the looping visual state. Cheap no-op when unchanged (called every frame). */
  playState(state: HavenerState): void {
    if (state === this.visualState) {
      return;
    }
    this.visualState = state;
    if (state === "ghost") {
      this.enterGhost();
    } else {
      // walk/task reuse idle for now (deferred to 7.6); idle is the real one.
      this.exitGhost();
      this.startIdle();
    }
  }

  /**
   * One-shot death settle. Deliberately minimal — the full §4.4 death (squash,
   * fall, the lantern detaching and rolling with its glow fading) is the 7.6
   * signature-moment task. Here it squashes briefly, then hands back so
   * GameScene can flip to the ghost state, preserving the existing flow.
   */
  playDeath(onComplete: () => void): void {
    this.visualState = "death";
    this.stopIdle();
    this.deathTimer?.remove(false);
    this.scene.tweens.add({
      targets: this.holders.bodyBase,
      scaleX: 1.2,
      scaleY: 0.8,
      duration: 80,
      ease: "Quad.easeOut",
      yoyo: true,
    });
    this.deathTimer = this.scene.time.delayedCall(500, onComplete);
  }

  override destroy(fromScene?: boolean): void {
    this.stopIdle();
    this.deathTimer?.remove(false);
    super.destroy(fromScene);
  }

  // --- Animation ----------------------------------------------------------

  private startIdle(): void {
    this.stopIdle();
    // §4.4 idle: body breathes on scaleY, pivoting at the feet (holder origin),
    // so the hem stays planted.
    this.idleTweens.push(
      this.scene.tweens.add({
        targets: this.holders.bodyBase,
        scaleY: 1.02,
        duration: IDLE_PERIOD_MS / 2,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
      }),
    );
    // §4.4 idle: lantern sways ±3°, a beat (150 ms) behind the body.
    this.lantern.setAngle(-LANTERN_SWAY_DEG);
    this.idleTweens.push(
      this.scene.tweens.add({
        targets: this.lantern,
        angle: LANTERN_SWAY_DEG,
        duration: IDLE_PERIOD_MS / 2,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
        delay: LANTERN_LAG_MS,
      }),
    );
  }

  private stopIdle(): void {
    for (const tween of this.idleTweens) {
      tween.stop();
    }
    this.idleTweens = [];
    this.holders.bodyBase.setScale(1, 1);
    this.lantern.setAngle(0);
  }

  private enterGhost(): void {
    // §4.4 ghost: translucent, and the lantern goes dark.
    this.setAlpha(GHOST_ALPHA);
    this.lantern.setFillStyle(hexNum(colors.void));
    this.glow.setVisible(false);
    this.startIdle();
  }

  private exitGhost(): void {
    this.setAlpha(1);
    this.glow.setVisible(true);
    this.applyLanternColor();
  }
}
