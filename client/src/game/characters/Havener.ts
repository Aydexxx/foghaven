import Phaser from "phaser";
import { colors } from "../../theme/tokens";
import { hexNum } from "../../theme/phaserColor";
import type { LanternState } from "@foghaven/shared";
import { AtlasKey } from "../../assets/atlasManifest";
import { CHARACTER_HEIGHT, anchorLocal, type AnchorName } from "./anchors";
import { HAVENER_ANIM_CONFIG } from "./havenerAnimConfig";

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
 * §4.4: every animation is a tween on this stack, never frame-by-frame sprite
 * art. Every number driving those tweens comes from `HAVENER_ANIM_CONFIG`
 * (havenerAnimConfig.ts) — nothing here is a hardcoded duration/amplitude —
 * so the feel can be retuned (see the dev playground, havenerPlayground.ts)
 * without touching this file.
 *
 * A design note on WHY the topple/lean tweens animate `this.angle` and never
 * `this.x`/`this.y`: GameScene repositions the container every render frame
 * via `setPosition(pos.x, pos.y)` — that authoritative position sync would
 * fight (and win against) any tween trying to also drive x/y here. Rotation
 * and scale are untouched by that sync, so every in-place flourish (idle
 * breathing, the run lean, the death topple) lives there instead. The one
 * exception is the DETACHED lantern during death: once it's removed from this
 * container and re-parented to the scene, it is no longer subject to that
 * sync at all, and is free to move in world space on its own.
 */

/** The atlas texture key loaded in GameScene.preload (the 7.3 pipeline output). */
export const HAVENER_ATLAS_KEY = "havener-atlas";
/** §4.5: the side profile drives left/right movement. */
const BODY_FRAME: AtlasKey = "character-side-01";
/** Which way the source art faces before any mirroring (flip this if the art is redrawn facing left). */
const BASE_FACING: Facing = "right";

export type Facing = "left" | "right";
/** The six ART_BIBLE §4.4 states, verbatim. */
export type HavenerState = "idle" | "walk" | "run" | "interact" | "ghost" | "death";

/** The glow overlay's resting opacity — see `buildLanternAndGlow`/`setLanternState`. */
const GLOW_BASE_ALPHA = 0.45;
/** §6.2/`LanternState`'s doc: a visual tell only, not wired to a game condition. Fast enough to read as "unsteady," not a strobe. */
const FLICKER_PERIOD_MS = 90;
const FLICKER_MIN_ALPHA = 0.12;

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

const WHITE = Phaser.Display.Color.GetColor(255, 255, 255);

export class Havener extends Phaser.GameObjects.Container {
  private readonly holders: Record<LayerKey, Phaser.GameObjects.Container>;
  private readonly cosmetics = new Map<AnchorName, Phaser.GameObjects.GameObject>();
  private lantern!: Phaser.GameObjects.Rectangle;
  private glow!: Phaser.GameObjects.Rectangle;
  private facing: Facing = BASE_FACING;
  private visualState: HavenerState = "idle";
  /** Every tween belonging to the CURRENT looping/one-shot state — stopped and cleared on every transition. */
  private stateTweens: Phaser.Tweens.Tween[] = [];
  private stateTimers: Phaser.Time.TimerEvent[] = [];
  private ghostWisps: Phaser.GameObjects.Ellipse[] = [];
  private lanternColorNum = WHITE;
  /** The server-authoritative lit/flickering/extinguished/dropped value — see `setLanternState`. Distinct from `visualState` (idle/walk/.../ghost), which is purely local animation. */
  private lanternState: LanternState = "lit";
  private flickerTween?: Phaser.Tweens.Tween;
  /** True once `dropLantern` has detached the lantern — see the class doc. */
  private lanternDropped = false;
  /** The detached lantern's own display objects, kept only so `destroy()` can clean them up. */
  private droppedLanternObjects: Phaser.GameObjects.GameObject[] = [];

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
      // exist (z-order + future slices + cosmetic visors), just empty for now
      // — the walk/run/ghost tweens below still target them, so the moment a
      // sliced leg layer lands, those tweens start moving real art with no
      // other change.
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
      .setAlpha(GLOW_BASE_ALPHA);
    this.holders.glowOverlay.add(this.glow);

    // §4.2 z6 lantern: tinted at runtime with the player's colour. Origin
    // top-centre so the idle sway pendulums from where the hand holds it.
    this.lantern = this.scene.add.rectangle(hand.x, hand.y - 8, 12, 18, WHITE).setOrigin(0.5, 0);
    this.holders.heldItem.add(this.lantern);

    this.applyLanternColor();
  }

  private applyLanternColor(): void {
    if (this.lanternDropped) {
      return;
    }
    this.lantern.setFillStyle(this.lanternColorNum);
    this.glow.setFillStyle(this.lanternColorNum);
  }

  // --- Public API ---------------------------------------------------------

  /** §3.5: retint the lantern (and its glow) to the player's identity light. No-op once dropped — a ghost's hand is empty. */
  setLanternColor(hex: string): void {
    this.lanternColorNum = hexNum(hex);
    this.applyLanternColor();
  }

  /**
   * The server-authoritative lit/flickering/extinguished/dropped state —
   * see `LanternState`'s own doc (shared/game/vision.ts) for what each means
   * mechanically. This method only ever renders what it's told; it never
   * decides on its own that a lantern should look a certain way, which is
   * exactly what keeps this a pure client-side *rendering* of server truth
   * rather than a second, client-side opinion about it.
   *
   * `dropped` is the one exception to "just recolour it": it hands off to
   * `dropLantern`'s physics, same as the death animation calling it directly
   * — both paths converge on the same guarded, idempotent method.
   */
  setLanternState(state: LanternState): void {
    if (state === this.lanternState) {
      return;
    }
    this.lanternState = state;
    this.flickerTween?.stop();
    this.flickerTween = undefined;

    if (state === "dropped") {
      this.dropLantern();
      return;
    }
    if (this.lanternDropped) {
      return; // already detached — nothing left on the rig to recolour
    }
    switch (state) {
      case "lit":
        this.glow.setAlpha(GLOW_BASE_ALPHA);
        this.glow.setVisible(true);
        this.applyLanternColor();
        break;
      case "extinguished":
        // §6.2: "much harder for others to see you" — still held, just dark.
        // Distinct from ghost's dark lantern (`enterGhost`): this is a LIVING
        // player's own choice, not a death state.
        this.lantern.setFillStyle(hexNum(colors.void));
        this.glow.setVisible(false);
        break;
      case "flickering":
        // A visual tell only — see `LanternState`'s doc on why this has no
        // mechanical effect yet. True colour, unsteady brightness.
        this.applyLanternColor();
        this.glow.setVisible(true);
        this.flickerTween = this.scene.tweens.add({
          targets: this.glow,
          alpha: FLICKER_MIN_ALPHA,
          duration: FLICKER_PERIOD_MS,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
        break;
    }
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

  /**
   * Drive the state. Cheap no-op when unchanged — GameScene calls this every
   * frame with "whatever should be showing right now", not as a discrete
   * trigger, so idle/walk/run/ghost only restart when they actually change.
   * `interact` is the one exception (see `startInteract`'s own doc). `death`
   * is NOT reachable through here — see `playDeath`, which needs a completion
   * callback `playState` has no way to carry.
   */
  playState(state: Exclude<HavenerState, "death">): void {
    if (state === this.visualState) {
      return;
    }
    this.enterState(state);
  }

  /**
   * Force-restart whichever state is currently showing, re-reading
   * `HAVENER_ANIM_CONFIG` from scratch. This is what makes the dev playground
   * actually live: a slider drag calls this so the loop you're watching
   * updates immediately, instead of only taking effect the next time you
   * click a state button.
   */
  restartCurrentState(): void {
    if (this.visualState === "death") {
      return; // one-shot and already mid-flight; nothing sensible to restart.
    }
    this.enterState(this.visualState);
  }

  private enterState(state: Exclude<HavenerState, "death">): void {
    const wasGhost = this.visualState === "ghost";
    this.visualState = state;
    if (wasGhost && state !== "ghost") {
      this.exitGhost();
    }
    switch (state) {
      case "idle":
        this.startIdle();
        break;
      case "walk":
        this.startWalkOrRun(HAVENER_ANIM_CONFIG.walk.periodMs, 1, 0);
        break;
      case "run":
        this.startWalkOrRun(
          HAVENER_ANIM_CONFIG.run.periodMs,
          HAVENER_ANIM_CONFIG.run.amplitudeMultiplier,
          HAVENER_ANIM_CONFIG.run.leanDeg,
        );
        break;
      case "interact":
        this.startInteract();
        break;
      case "ghost":
        this.enterGhost();
        break;
    }
  }

  /**
   * The one-shot death sequence: squash, then the whole body topples
   * (rotation only — see the class doc), while the lantern detaches and lives
   * out its own gravity/bounce/roll/glow-fade independently (`dropLantern`).
   * `onComplete` fires once the BODY settles — the signature lantern moment is
   * allowed to keep playing after that, unblocking GameScene's transition to
   * the ghost state without waiting on decoration.
   */
  playDeath(onComplete: () => void): void {
    this.visualState = "death";
    this.clearStateTweens();
    const cfg = HAVENER_ANIM_CONFIG.death;

    this.dropLantern();

    this.stateTweens.push(
      this.scene.tweens.add({
        targets: this.holders.bodyBase,
        scaleX: cfg.squash.scaleX,
        scaleY: cfg.squash.scaleY,
        duration: cfg.squash.durationMs,
        ease: "Quad.easeOut",
      }),
    );

    this.stateTweens.push(
      this.scene.tweens.add({
        targets: this,
        angle: this.facing === "right" ? cfg.fall.rotationDeg : -cfg.fall.rotationDeg,
        duration: cfg.fall.durationMs,
        delay: cfg.squash.durationMs,
        ease: "Cubic.easeOut",
      }),
    );
    this.stateTweens.push(
      this.scene.tweens.add({
        targets: this.holders.bodyBase,
        scaleY: cfg.fall.settleScaleY,
        duration: cfg.fall.durationMs,
        delay: cfg.squash.durationMs,
        ease: "Cubic.easeOut",
      }),
    );

    this.stateTimers.push(
      this.scene.time.delayedCall(cfg.squash.durationMs + cfg.fall.durationMs, onComplete),
    );
  }

  override destroy(fromScene?: boolean): void {
    this.clearStateTweens();
    this.flickerTween?.stop();
    for (const obj of this.droppedLanternObjects) {
      obj.destroy();
    }
    super.destroy(fromScene);
  }

  // --- The signature moment -------------------------------------------------

  /**
   * §4.4: "the lantern DETACHES from the rig, falls under gravity, bounces
   * once, rolls, and its glow fades to zero over 400ms." Reparents the lit
   * lantern + glow from this container into the scene at their current world
   * position, then runs a hand-tuned, four-phase motion:
   *
   *   1. fall   — an accelerating toss away from the hand (gravity winning).
   *   2. bounce — ONE decelerate-up/accelerate-down hop (deliberately not
   *      Phaser's built-in `Bounce` ease, which decays over several bounces —
   *      the brief lives here explicitly so there is exactly one).
   *   3. roll   — a decaying slide with continuous rotation, selling "rolling"
   *      rather than "sliding to a stop".
   *   4. the glow, fading out from the moment of impact (the start of the
   *      bounce) rather than the moment of release — the light doesn't dim
   *      mid-air, it dims because the fall disturbed the flame.
   *
   * Public (not private) because 7.7 wires the server-authoritative "dropped"
   * lantern state, and reuses this exact motion for that — the death
   * animation is one caller of it, not its only reason to exist.
   */
  dropLantern(): void {
    if (this.lanternDropped) {
      return;
    }
    this.lanternDropped = true;
    const cfg = HAVENER_ANIM_CONFIG.death.lantern;
    const direction = this.facing === "right" ? 1 : -1;

    const lantern = this.lantern;
    const glow = this.glow;

    // World-space handoff: capture where they are right now (still children,
    // still subject to this container's position/facing/rotation), detach
    // them, then re-express that same spot in absolute scene coordinates —
    // from this point on nothing about the Havener (including its own death
    // topple, playing concurrently) moves them again.
    const lanternWorld = lantern.getWorldTransformMatrix().decomposeMatrix();
    const glowWorld = glow.getWorldTransformMatrix().decomposeMatrix();
    this.holders.heldItem.remove(lantern);
    this.holders.glowOverlay.remove(glow);
    lantern.setPosition(lanternWorld.translateX, lanternWorld.translateY);
    glow.setPosition(glowWorld.translateX, glowWorld.translateY);
    // Keep whatever mid-swing angle the lantern had at the moment of release
    // — a small bit of organic variation the physics then takes over from.
    lantern.setAngle(lanternWorld.rotation * Phaser.Math.RAD_TO_DEG);
    this.scene.add.existing(lantern);
    this.scene.add.existing(glow);
    this.droppedLanternObjects.push(lantern, glow);

    const landX = lanternWorld.translateX + direction * cfg.fallSidewaysPx;
    const landY = lanternWorld.translateY + cfg.fallDownPx;
    const rollX = landX + direction * cfg.rollDistancePx;

    const glowFollow = () => glow.setPosition(lantern.x, lantern.y - 4);

    this.scene.tweens.add({
      targets: lantern,
      x: landX,
      y: landY,
      duration: cfg.fallDurationMs,
      delay: cfg.detachDelayMs,
      ease: "Quad.easeIn", // accelerating — gravity winning
      onUpdate: glowFollow,
      onComplete: () => {
        // Phase 2: one bounce — deliberately hand-built from two tweens
        // rather than Phaser's `Bounce` ease, which decays over several hops.
        this.scene.tweens.add({
          targets: lantern,
          y: landY - cfg.bounceHeightPx,
          duration: cfg.bounceDurationMs / 2,
          ease: "Quad.easeOut", // decelerating on the way up
          yoyo: true,
          onUpdate: glowFollow,
          onComplete: () => {
            // Phase 3: roll — a decaying slide, spinning as it goes.
            this.scene.tweens.add({
              targets: lantern,
              x: rollX,
              angle: lantern.angle + direction * cfg.rollRotationDeg,
              duration: cfg.rollDurationMs,
              ease: "Sine.easeOut",
              onUpdate: glowFollow,
            });
          },
        });
        // Phase 4: the glow fade starts at impact, not release.
        this.scene.tweens.add({
          targets: glow,
          alpha: 0,
          duration: cfg.glowFadeMs,
          ease: "Sine.easeIn",
        });
      },
    });
  }

  // --- Animation ----------------------------------------------------------

  /** Stops and clears every tween/timer belonging to the current state, and resets every property a state tween might have left non-default. */
  private clearStateTweens(): void {
    for (const tween of this.stateTweens) {
      tween.stop();
    }
    this.stateTweens = [];
    for (const timer of this.stateTimers) {
      timer.remove(false);
    }
    this.stateTimers = [];
    // Generic reset of every §4.2 holder, not just the ones the outgoing
    // state happened to touch — cheap, and means a new state never has to
    // know which fields a *different* state's tweens might have left dirty.
    for (const layer of LAYERS) {
      const holder = this.holders[layer.key];
      holder.setPosition(0, 0);
      holder.setAngle(0);
      holder.setScale(1, 1);
      holder.setVisible(true);
    }
    if (!this.lanternDropped) {
      this.lantern.setAngle(0);
      const hand = anchorLocal("hand");
      this.lantern.setPosition(hand.x, hand.y - 8);
    }
    this.setAngle(0);
  }

  private startIdle(): void {
    this.clearStateTweens();
    const cfg = HAVENER_ANIM_CONFIG.idle;
    // §4.4 idle: body breathes on scaleY, pivoting at the feet (holder origin),
    // so the hem stays planted.
    this.stateTweens.push(
      this.scene.tweens.add({
        targets: this.holders.bodyBase,
        scaleY: 1 + cfg.bodyScaleYAmplitude,
        duration: cfg.periodMs / 2,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
      }),
    );
    // §4.4 idle: lantern sways ±3°, a beat behind the body.
    if (!this.lanternDropped) {
      this.lantern.setAngle(-cfg.lanternSwayDeg);
      this.stateTweens.push(
        this.scene.tweens.add({
          targets: this.lantern,
          angle: cfg.lanternSwayDeg,
          duration: cfg.periodMs / 2,
          ease: "Sine.easeInOut",
          yoyo: true,
          repeat: -1,
          delay: cfg.lanternLagMs,
        }),
      );
    }
  }

  /**
   * §4.4 walk + run share one shape — run is explicitly "same as walk,
   * amplitudes ×1.4, body leans 5° into direction" — so both are built here,
   * parameterised by period/amplitude-multiplier/lean rather than duplicated.
   *
   * "Coat hem lags body by 60 ms": there is no separate sliced hem layer yet
   * (§4.2's `legs` is the nearest lower-body layer today — see `buildBody`),
   * so the hem lag is applied to the same leg-swing tween that stands in for
   * it. When a real hem layer exists, split this into its own tween with the
   * same `hemLagMs` and leave the leg swing unlagged.
   */
  private startWalkOrRun(periodMs: number, amplitudeMultiplier: number, leanDeg: number): void {
    this.clearStateTweens();
    const cfg = HAVENER_ANIM_CONFIG.walk;
    const bobPx = cfg.bodyBobPx * amplitudeMultiplier;
    const legDeg = cfg.legSwingDeg * amplitudeMultiplier;
    const lanternDeg = cfg.lanternSwingDeg * amplitudeMultiplier;

    this.setAngle(this.facing === "right" ? leanDeg : -leanDeg);

    // Body bob.
    this.stateTweens.push(
      this.scene.tweens.add({
        targets: this.holders.bodyBase,
        y: -bobPx,
        duration: periodMs / 2,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
      }),
    );
    // Legs alternate (the hem-lag stand-in — see doc above).
    this.holders.legs.setAngle(-legDeg);
    this.stateTweens.push(
      this.scene.tweens.add({
        targets: this.holders.legs,
        angle: legDeg,
        duration: periodMs / 2,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
        delay: cfg.hemLagMs,
      }),
    );
    // Lantern swings.
    if (!this.lanternDropped) {
      this.lantern.setAngle(-lanternDeg);
      this.stateTweens.push(
        this.scene.tweens.add({
          targets: this.lantern,
          angle: lanternDeg,
          duration: periodMs / 2,
          ease: "Sine.easeInOut",
          yoyo: true,
          repeat: -1,
        }),
      );
    }
  }

  /**
   * §4.4 interact: a 400ms once-off squash + lantern raise + hand sparkle.
   * GameScene drives this the same way as every looping state — by calling
   * `playState("interact")` every frame a task modal is open — so once the
   * one-shot finishes, `visualState` is reset back to "idle" here rather than
   * left on "interact". That means the NEXT frame's `playState("interact")`
   * call (still true — the task is still open) sees a real state change and
   * fires the squash again: a small, deliberate, self-sustaining pulse for
   * as long as the player keeps working the task, not a one-time flourish
   * followed by a frozen pose.
   */
  private startInteract(): void {
    this.clearStateTweens();
    const cfg = HAVENER_ANIM_CONFIG.interact;
    const half = cfg.durationMs / 2;

    this.stateTweens.push(
      this.scene.tweens.add({
        targets: this.holders.bodyBase,
        scaleY: cfg.squashScaleY,
        duration: half,
        ease: "Quad.easeOut",
        yoyo: true,
      }),
    );
    if (!this.lanternDropped) {
      this.stateTweens.push(
        this.scene.tweens.add({
          targets: this.lantern,
          y: this.lantern.y - cfg.lanternRaisePx,
          duration: half,
          ease: "Quad.easeOut",
          yoyo: true,
        }),
      );
      this.spawnInteractSparkle(cfg.sparkleDurationMs, cfg.sparkleRadiusPx);
    }

    this.stateTimers.push(
      this.scene.time.delayedCall(cfg.durationMs, () => {
        if (this.visualState === "interact") {
          this.visualState = "idle"; // see doc above — lets the next request re-trigger
        }
      }),
    );
  }

  private spawnInteractSparkle(durationMs: number, radiusPx: number): void {
    const hand = anchorLocal("hand");
    const sparkle = this.scene.add.circle(hand.x, hand.y - 10, 1, hexNum(colors.flameCore), 0.9);
    this.holders.heldItem.add(sparkle);
    this.scene.tweens.add({
      targets: sparkle,
      radius: radiusPx,
      alpha: 0,
      duration: durationMs,
      ease: "Quad.easeOut",
      onComplete: () => sparkle.destroy(),
    });
  }

  private enterGhost(): void {
    this.clearStateTweens();
    const cfg = HAVENER_ANIM_CONFIG.ghost;

    this.setAlpha(cfg.alpha);
    this.holders.legs.setVisible(false);
    if (!this.lanternDropped) {
      // A ghost's lantern is dark — see §4.4. Not the same as `dropLantern`:
      // nothing detaches or falls, it simply stops glowing while still held.
      this.lantern.setFillStyle(hexNum(colors.void));
      this.glow.setVisible(false);
    }
    // Defensive: `restartCurrentState` (the playground's live-tuning path) can
    // re-enter ghost while it's already active, to pick up a slider change —
    // clear any wisps from the previous pass first so they never accumulate.
    for (const wisp of this.ghostWisps) {
      wisp.destroy();
    }
    this.ghostWisps = [];

    // Vertical float — every visible layer except the already-hidden legs, so
    // the whole silhouette drifts together. This targets the §4.2 HOLDERS'
    // own y, never `this.y`: GameScene repositions the container itself every
    // render frame (see the class doc), which would fight a tween on `this.y`
    // frame-for-frame and the float would never visibly happen.
    const floatTargets = LAYERS.filter((l) => l.key !== "legs").map((l) => this.holders[l.key]);
    this.stateTweens.push(
      this.scene.tweens.add({
        targets: floatTargets,
        y: -cfg.floatPx,
        duration: cfg.periodMs / 2,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
      }),
    );

    // §4.4: "hem dissolves into three drifting wisps." Not one of the §4.2
    // named layers (it's a state-specific effect, not a cosmetic slot), so
    // these are loose children of the container itself rather than living in
    // any holder.
    const feet = anchorLocal("feet");
    for (let i = 0; i < cfg.wispCount; i++) {
      const angleOffset = (i / cfg.wispCount) * Math.PI * 2;
      const wisp = this.scene.add.ellipse(
        feet.x + Math.cos(angleOffset) * 6,
        feet.y - 4 + Math.sin(angleOffset) * 3,
        cfg.wispRadiusPx * 2,
        cfg.wispRadiusPx * 2.4,
        hexNum(colors.foam),
        cfg.wispAlpha,
      );
      this.add(wisp);
      this.ghostWisps.push(wisp);
      // Phase-offset per wisp (a third of the period each) so the three drift
      // independently rather than in unison — reads as dissolving mist, not
      // three synchronised dots.
      const phase = (i / cfg.wispCount) * cfg.wispDriftMs;
      this.stateTweens.push(
        this.scene.tweens.add({
          targets: wisp,
          x: wisp.x + Math.cos(angleOffset) * cfg.wispDriftPx,
          y: wisp.y - cfg.wispDriftPx,
          alpha: 0,
          duration: cfg.wispDriftMs,
          delay: -phase,
          ease: "Sine.easeOut",
          yoyo: true,
          repeat: -1,
        }),
      );
    }
  }

  private exitGhost(): void {
    this.setAlpha(1);
    this.holders.legs.setVisible(true);
    // The float tween lives on the holders (see `enterGhost`), and whichever
    // state comes next starts with `clearStateTweens()`, which resets every
    // holder's position generically — nothing further to undo here.
    if (!this.lanternDropped) {
      this.glow.setVisible(true);
      this.applyLanternColor();
    }
    for (const wisp of this.ghostWisps) {
      wisp.destroy();
    }
    this.ghostWisps = [];
  }
}
