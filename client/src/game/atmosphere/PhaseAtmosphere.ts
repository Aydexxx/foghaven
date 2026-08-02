import Phaser from "phaser";
import { TILE_SIZE } from "@foghaven/shared";
import { graphicsEngine } from "../../graphics/graphicsEngine";
import { LIGHT_SOURCES } from "./lightSources";
import { colors } from "../../theme/tokens";
import { hexNum, hexToRgbTriplet } from "../../theme/phaserColor";

const RAIN_RGB = hexToRgbTriplet(colors.foam);
const PUDDLE_BASE_RGB = hexToRgbTriplet(colors.ink);
const PUDDLE_SHEEN_RGB = hexToRgbTriplet(colors.foam);

/**
 * Everything "finish the atmosphere" asked for that lives inside the Phaser
 * world: the per-phase colour grade (cold blue while playing, a pulsing red
 * alarm during a sabotage), static light sources bleeding into the fog,
 * ambient particles (drifting fog wisps, light rain) and shimmering puddles.
 *
 * Screen shake is NOT here — see the "Screen shake" section below.
 *
 * Kept as its own class rather than folded into `GameScene` so that file
 * doesn't grow past what it already is — `GameScene` only ever calls into
 * this at a handful of well-defined points (`create`, `update`, `renderFog`,
 * a body being found, and the `sabotageActive` listener).
 *
 * Every piece here is decorative. None of it changes what data exists to
 * draw — see the doc on `stampLightBleed` for why thinning the fog's
 * darkness near a light source cannot leak anything the fog itself
 * wouldn't already have hidden.
 */

// --- Colour grade ---------------------------------------------------------

const TASK_GRADE_COLOR = hexNum(colors.fogDark);
const TASK_GRADE_ALPHA = 0.16;
const SABOTAGE_GRADE_COLOR = hexNum(colors.bloodDeep);
const SABOTAGE_GRADE_BASE_ALPHA = 0.22;
const SABOTAGE_PULSE_ALPHA = 0.07;
/** Alarm pulse rate, in radians/ms. */
const SABOTAGE_PULSE_SPEED = 0.005;
/** Per-frame lerp rate for the grade's colour and alpha — same easing idiom `GameScene.renderFog` already uses for `fogRadius`/`fogAlpha`. */
const GRADE_LERP_RATE = 0.05;
/** Depth just under the fog overlay (`FOG_DEPTH` = 50 in `GameScene`) — the grade tints the whole world, then the fog darkens/erases on top of it. */
const GRADE_DEPTH = 40;

// --- Light sources ----------------------------------------------------------

const GLOW_KEY = "atmosphere-glow";
const GLOW_SIZE = 256;
const GLOW_DEPTH = 41;
const LIGHTHOUSE_BEAM_SCALE_X = 1.6;
const LIGHTHOUSE_BEAM_SCALE_Y = 0.12;
const LIGHTHOUSE_BEAM_ROTATE_MS = 9000;
const LAMP_GLOW_SCALE = 0.55;
const WINDOW_GLOW_SCALE = 0.4;

/** How far a light source thins the fog's darkness, and by how much (never a full hole — see `stampLightBleed`). */
const LIGHT_BLEED_RADIUS = 100;
const LIGHT_BLEED_ALPHA = 0.4;

// --- Particles --------------------------------------------------------------

const RAIN_KEY = "atmosphere-rain";
const RAIN_W = 3;
const RAIN_H = 26;
const PARTICLE_DEPTH = 51;

// --- Puddles ------------------------------------------------------------

const PUDDLE_KEY = "atmosphere-puddle";
const PUDDLE_W = 100;
const PUDDLE_H = 40;
/** Fixed street-tile puddle spots, clear of doorways and Town Hall — purely decorative. */
const PUDDLE_TILES: Array<[number, number]> = [
  [17, 17],
  [31, 17],
  [17, 27],
  [31, 27],
  [23.5, 30],
];

// --- Screen shake ---------------------------------------------------------
//
// Deliberately empty since 7.8. This class used to call
// `scene.cameras.main.shake()` directly for the body-found and sabotage
// beats; both now go through `JuiceDirector` (ART_BIBLE §9), which is the one
// place allowed to touch the camera. Routing them back through here would
// reintroduce exactly the "two systems fighting over one camera" problem the
// director exists to prevent — and would silently escape the reduced-motion
// setting, which is applied inside the director rather than at each call
// site.

function buildGlowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(GLOW_KEY)) {
    return;
  }
  const canvas = scene.textures.createCanvas(GLOW_KEY, GLOW_SIZE, GLOW_SIZE);
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext();
  const half = GLOW_SIZE / 2;
  // Deliberately pure white, not a token: this texture is multiplicatively
  // tinted per-instance by WARM_LAMP/WARM_WINDOW/BEAM_WHITE at draw time (see
  // lightSources.ts), and only a white base reproduces that tint exactly.
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.5)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
  canvas.refresh();
}

function buildRainTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(RAIN_KEY)) {
    return;
  }
  const canvas = scene.textures.createCanvas(RAIN_KEY, RAIN_W, RAIN_H);
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext();
  const gradient = ctx.createLinearGradient(0, 0, 0, RAIN_H);
  gradient.addColorStop(0, `rgba(${RAIN_RGB},0)`);
  gradient.addColorStop(0.5, `rgba(${RAIN_RGB},0.8)`);
  gradient.addColorStop(1, `rgba(${RAIN_RGB},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, RAIN_W, RAIN_H);
  canvas.refresh();
}

function buildPuddleTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(PUDDLE_KEY)) {
    return;
  }
  const canvas = scene.textures.createCanvas(PUDDLE_KEY, PUDDLE_W, PUDDLE_H);
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext();
  const cx = PUDDLE_W / 2;
  const cy = PUDDLE_H / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, PUDDLE_H / PUDDLE_W);
  const base = ctx.createRadialGradient(0, 0, 0, 0, 0, cx);
  base.addColorStop(0, `rgba(${PUDDLE_BASE_RGB},0.55)`);
  base.addColorStop(0.75, `rgba(${PUDDLE_BASE_RGB},0.4)`);
  base.addColorStop(1, `rgba(${PUDDLE_BASE_RGB},0)`);
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(0, 0, cx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // A soft sheen band suggesting a reflected, overcast sky.
  const sheen = ctx.createRadialGradient(cx, cy * 0.7, 0, cx, cy * 0.7, cx * 0.5);
  sheen.addColorStop(0, `rgba(${PUDDLE_SHEEN_RGB},0.28)`);
  sheen.addColorStop(1, `rgba(${PUDDLE_SHEEN_RGB},0)`);
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, PUDDLE_W, PUDDLE_H);
  canvas.refresh();
}

function lerp(current: number, target: number, rate: number): number {
  return current + (target - current) * rate;
}

export class PhaseAtmosphere {
  private effectsEnabled: boolean;
  private readonly unsubscribeSettings: () => void;

  private grade?: Phaser.GameObjects.Rectangle;
  private currentColor = Phaser.Display.Color.IntegerToColor(TASK_GRADE_COLOR);
  private currentAlpha = 0;
  private sabotageActive = false;
  private pulseT = 0;

  private lightGlows: Phaser.GameObjects.Image[] = [];
  private lightBleedBrush?: Phaser.GameObjects.Image;
  private fogWisps?: Phaser.GameObjects.Particles.ParticleEmitter;
  private rain?: Phaser.GameObjects.Particles.ParticleEmitter;
  private puddles: Phaser.GameObjects.Image[] = [];
  private puddleTweens: Phaser.Tweens.Tween[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    buildGlowTexture(scene);
    buildRainTexture(scene);
    buildPuddleTexture(scene);

    this.grade = scene.add
      .rectangle(0, 0, scene.scale.width, scene.scale.height, TASK_GRADE_COLOR, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(GRADE_DEPTH)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);

    this.effectsEnabled = graphicsEngine.getSettings().effectsEnabled;
    this.unsubscribeSettings = graphicsEngine.subscribe(() => {
      this.applyEffectsEnabled(graphicsEngine.getSettings().effectsEnabled);
    });
    this.applyEffectsEnabled(this.effectsEnabled);
  }

  /** Creates or tears down every effect-only piece (everything but the grade, which is cheap enough to always keep). */
  private applyEffectsEnabled(enabled: boolean): void {
    this.effectsEnabled = enabled;
    if (enabled) {
      this.grade?.setAlpha(1);
      this.createLightSources();
      this.createParticles();
      this.createPuddles();
    } else {
      this.destroyLightSources();
      this.destroyParticles();
      this.destroyPuddles();
      this.grade?.setAlpha(0);
      this.currentAlpha = 0;
    }
  }

  private createLightSources(): void {
    if (this.lightGlows.length > 0) {
      return;
    }
    for (const light of LIGHT_SOURCES) {
      const image = this.scene.add
        .image(light.pos.x, light.pos.y, GLOW_KEY)
        .setDepth(GLOW_DEPTH)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(light.color);

      if (light.kind === "beam") {
        // Pivot on the lamp itself (left edge of the texture) and stretch outward,
        // so the sweep reads as a beam radiating from the tower, not a blob spinning on it.
        image
          .setOrigin(0, 0.5)
          .setScale(LIGHTHOUSE_BEAM_SCALE_X, LIGHTHOUSE_BEAM_SCALE_Y)
          .setAlpha(0.5);
        this.scene.tweens.add({
          targets: image,
          angle: 360,
          duration: LIGHTHOUSE_BEAM_ROTATE_MS,
          repeat: -1,
          ease: "Linear",
        });
      } else if (light.kind === "lamp") {
        image.setScale(LAMP_GLOW_SCALE).setAlpha(0.4);
      } else {
        image.setScale(WINDOW_GLOW_SCALE).setAlpha(0.45);
      }
      this.lightGlows.push(image);
    }
    this.lightBleedBrush = this.scene.make.image({ key: GLOW_KEY, add: false });
  }

  private destroyLightSources(): void {
    for (const image of this.lightGlows) {
      image.destroy();
    }
    this.lightGlows = [];
    this.lightBleedBrush?.destroy();
    this.lightBleedBrush = undefined;
  }

  private createParticles(): void {
    if (this.fogWisps || this.rain) {
      return;
    }
    // Weather is screen-space (`setScrollFactor(0)`), but a camera zoom still
    // scales it about the viewport centre — so an emission box of the raw
    // viewport size would spray a zoomed-in camera's worth of particles
    // outside the visible area and leave the rain looking thin. Emitting over
    // the box that actually maps onto the screen keeps density identical at
    // any zoom, including 1, where this collapses to the full viewport.
    const zoom = this.scene.cameras.main.zoom || 1;
    const width = this.scene.scale.width / zoom;
    const height = this.scene.scale.height / zoom;
    const originX = (this.scene.scale.width - width) / 2;
    const originY = (this.scene.scale.height - height) / 2;

    this.fogWisps = this.scene.add
      .particles(0, 0, GLOW_KEY, {
        x: { min: originX, max: originX + width },
        y: { min: originY, max: originY + height },
        lifespan: { min: 9000, max: 15000 },
        speedX: { min: -8, max: 12 },
        speedY: { min: -4, max: 4 },
        scale: { min: 1.1, max: 2.2 },
        alpha: { min: 0.04, max: 0.1 },
        tint: hexNum(colors.mist),
        frequency: 650,
        blendMode: Phaser.BlendModes.ADD,
      })
      .setScrollFactor(0)
      .setDepth(PARTICLE_DEPTH);

    this.rain = this.scene.add
      .particles(0, 0, RAIN_KEY, {
        x: { min: originX, max: originX + width },
        y: { min: originY - 50, max: originY + height },
        lifespan: { min: 900, max: 1300 },
        speedX: { min: -40, max: 20 },
        speedY: { min: 480, max: 680 },
        alpha: { min: 0.12, max: 0.22 },
        scaleY: { min: 0.8, max: 1.3 },
        frequency: 26,
        blendMode: Phaser.BlendModes.NORMAL,
      })
      .setScrollFactor(0)
      .setDepth(PARTICLE_DEPTH);
  }

  private destroyParticles(): void {
    this.fogWisps?.destroy();
    this.fogWisps = undefined;
    this.rain?.destroy();
    this.rain = undefined;
  }

  private createPuddles(): void {
    if (this.puddles.length > 0) {
      return;
    }
    for (const [col, row] of PUDDLE_TILES) {
      const image = this.scene.add
        .image(col * TILE_SIZE, row * TILE_SIZE, PUDDLE_KEY)
        .setDepth(1)
        .setAlpha(0.55);
      this.puddles.push(image);
      this.puddleTweens.push(
        this.scene.tweens.add({
          targets: image,
          alpha: { from: 0.4, to: 0.7 },
          duration: Phaser.Math.Between(2600, 4200),
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
          delay: Phaser.Math.Between(0, 2000),
        }),
      );
    }
  }

  private destroyPuddles(): void {
    for (const tween of this.puddleTweens) {
      tween.stop();
    }
    this.puddleTweens = [];
    for (const image of this.puddles) {
      image.destroy();
    }
    this.puddles = [];
  }

  /**
   * Thins the fog's darkness near each static light source — a *partial*
   * erase (reduced brush alpha, smaller radius than the player's own hole),
   * never a full reveal. Call right after the existing player-hole erase in
   * `GameScene.renderFog()`.
   *
   * Safe by construction: the fog overlay is cosmetic darkness drawn on top
   * of the world (see the doc on `GameState.players`'s filter in the server
   * schema) — nothing is ever drawn at a point unless the server already
   * sent it. Dimming the darkness there changes how dark the void looks,
   * never what data exists to see through it.
   *
   * `originX`/`originY` are the world coordinates the render texture's own
   * (0,0) sits at — the top-left of the camera's world view. Passing the
   * camera's raw scroll instead only happens to work at zoom 1; see the note
   * where `GameScene` creates `fogOverlay`.
   */
  stampLightBleed(rt: Phaser.GameObjects.RenderTexture, originX: number, originY: number): void {
    if (!this.effectsEnabled || !this.lightBleedBrush) {
      return;
    }
    const brush = this.lightBleedBrush;
    brush.setScale((LIGHT_BLEED_RADIUS * 2) / GLOW_SIZE);
    brush.setAlpha(LIGHT_BLEED_ALPHA);
    for (const light of LIGHT_SOURCES) {
      rt.erase(brush, light.pos.x - originX, light.pos.y - originY);
    }
  }

  /**
   * Colour-grade response only. The screen shake that used to live here moved
   * to `JuiceDirector` in 7.8 — see the note above the removed constants.
   */
  setSabotageActive(active: boolean): void {
    if (active === this.sabotageActive) {
      return;
    }
    this.sabotageActive = active;
  }

  update(delta: number): void {
    if (!this.grade) {
      return;
    }
    if (!this.effectsEnabled) {
      return;
    }

    this.pulseT += delta;
    const targetColor = this.sabotageActive ? SABOTAGE_GRADE_COLOR : TASK_GRADE_COLOR;
    const targetAlpha = this.sabotageActive
      ? SABOTAGE_GRADE_BASE_ALPHA + Math.sin(this.pulseT * SABOTAGE_PULSE_SPEED) * SABOTAGE_PULSE_ALPHA
      : TASK_GRADE_ALPHA;

    const target = Phaser.Display.Color.IntegerToColor(targetColor);
    this.currentColor.setTo(
      lerp(this.currentColor.red, target.red, GRADE_LERP_RATE),
      lerp(this.currentColor.green, target.green, GRADE_LERP_RATE),
      lerp(this.currentColor.blue, target.blue, GRADE_LERP_RATE),
    );
    this.currentAlpha = lerp(this.currentAlpha, targetAlpha, GRADE_LERP_RATE);

    this.grade.setFillStyle(this.currentColor.color, this.currentAlpha);
  }

  destroy(): void {
    this.unsubscribeSettings();
    this.grade?.destroy();
    this.grade = undefined;
    this.destroyLightSources();
    this.destroyParticles();
    this.destroyPuddles();
  }
}
