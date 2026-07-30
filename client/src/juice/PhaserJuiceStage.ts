import Phaser from "phaser";
import type { JuiceStage } from "./JuiceDirector";

/**
 * The world-space half of the juice layer: the Phaser camera and game-object
 * effects `JuiceDirector` delegates rather than implementing itself.
 *
 * Bound by `GameScene` on create and unbound on teardown, so every effect
 * routed here dies with the scene that could render it. Nothing in this file
 * consults the reduced-motion setting — amplitudes arrive already scaled (see
 * `JuiceDirector.amplitudeScale`), and re-checking here would be a second
 * place for the accessibility behaviour to drift out of agreement with the
 * first.
 */
export class PhaserJuiceStage implements JuiceStage {
  /**
   * Restored verbatim on unfreeze rather than assumed to be 1 — the scene may
   * legitimately be running at another time scale (a cutscene slow-motion
   * beat), and a hit-stop must hand back exactly what it took.
   */
  private savedTweenTimeScale = 1;
  private savedAnimTimeScale = 1;

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * §9 specifies shake in pixels; Phaser's `Camera.shake` takes intensity as
   * a *fraction of the viewport*, which it multiplies by width and height to
   * get the per-axis offset. Converting here — where the viewport size is
   * actually known — is why the director's API can stay in the honest unit
   * the art bible is written in.
   */
  shake(px: number, ms: number): void {
    const camera = this.scene.cameras?.main;
    if (!camera) {
      return;
    }
    const width = this.scene.scale.width || 1;
    camera.shake(ms, px / width);
  }

  punchObject(target: unknown, scale: number, ms: number): void {
    if (!isTweenable(target)) {
      return;
    }
    const baseX = target.scaleX;
    const baseY = target.scaleY;
    this.scene.tweens.add({
      targets: target,
      scaleX: baseX * scale,
      scaleY: baseY * scale,
      duration: ms / 2,
      yoyo: true,
      ease: "Back.easeOut",
      // Snapping back to the captured base rather than letting the yoyo land
      // wherever it lands keeps repeated punches from accumulating scale
      // drift on a widget that gets punched every time it is pressed.
      onComplete: () => {
        target.setScale(baseX, baseY);
      },
    });
  }

  /**
   * Holds the *presentation* clocks only. Tween and sprite-animation time
   * scales are what make a hit-stop read as a freeze rather than as a dropped
   * frame; neither has anything to do with the input/network path, which
   * `GameScene.update` deliberately runs outside this gate.
   */
  setFrozen(frozen: boolean): void {
    const tweens = this.scene.tweens;
    const anims = this.scene.anims;
    if (frozen) {
      this.savedTweenTimeScale = tweens?.timeScale ?? 1;
      this.savedAnimTimeScale = anims?.globalTimeScale ?? 1;
      if (tweens) {
        tweens.timeScale = 0;
      }
      if (anims) {
        anims.globalTimeScale = 0;
      }
      return;
    }
    if (tweens) {
      tweens.timeScale = this.savedTweenTimeScale;
    }
    if (anims) {
      anims.globalTimeScale = this.savedAnimTimeScale;
    }
  }
}

interface Scalable {
  scaleX: number;
  scaleY: number;
  setScale(x: number, y: number): unknown;
}

function isTweenable(value: unknown): value is Scalable {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<Scalable>;
  return (
    typeof candidate.scaleX === "number" &&
    typeof candidate.scaleY === "number" &&
    typeof candidate.setScale === "function"
  );
}
