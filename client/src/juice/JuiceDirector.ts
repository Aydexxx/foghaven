import { graphicsEngine } from "../graphics/graphicsEngine";

/**
 * The one place any screen-level effect in the game is allowed to originate
 * (ART_BIBLE §9). Five primitives — `shake`, `hitStop`, `flash`, `punch`,
 * `vignette` — and every row of the §9 table is expressed as some
 * combination of them by `juiceEvents.ts`.
 *
 * The rule this exists to enforce: **nothing shakes the screen, freezes it,
 * flashes it, punches a widget or closes the vignette without going through
 * here.** An ad-hoc `cameras.main.shake()` or a one-off tween in gameplay
 * code is a bug, not a shortcut — scattered effects are exactly how a game
 * ends up with two systems fighting over the same camera, an effect nobody
 * can find the source of, and an accessibility setting that only covers the
 * effects someone remembered to route through it.
 *
 * ---
 *
 * ## The world/DOM split
 *
 * `shake` and the hit-stop freeze are *world* effects: they belong to the
 * Phaser camera and must not move the HUD, so they are delegated to a
 * `JuiceStage` that `GameScene` binds on create and unbinds on teardown.
 * Requests made with no stage bound are dropped rather than queued — a shake
 * that arrives before there is a camera to shake is stale by the time one
 * exists.
 *
 * `flash` and `vignette` are *screen* effects owned directly by this class
 * as a single DOM overlay. That is deliberate: they need to cover the UI as
 * well as the canvas, and they need to keep working on screens where Phaser
 * is not mounted at all (the meeting, the vote, the round end). `punch`
 * dispatches on its target — an `HTMLElement` animates via WAAPI, anything
 * else goes to the stage as a game object.
 *
 * ---
 *
 * ## Hit-stop: what is frozen and what is emphatically not
 *
 * `hitStop` freezes **rendering only**. It never touches:
 *
 *   - the fixed-timestep input sample/send loop (`GameScene.sampleAndSend`),
 *     which keeps producing sequenced commands at the same cadence, so the
 *     server sees an unbroken input stream and client prediction stays in
 *     step with it;
 *   - the interpolation clock, which reads `performance.now()` directly.
 *
 * That second point is the subtle one. Interpolation is driven by real
 * wall-clock time, not by an accumulated "visual time" this class advances.
 * So when a hit-stop releases, remote players are drawn at their true
 * current interpolated position — they jump forward by the frozen duration
 * rather than resuming from where they were when the freeze began. Any
 * design where the visual clock is paused and later resumed would leave
 * every remote entity permanently behind server truth by the total frozen
 * time, and that error would compound over a match. The freeze is a gate on
 * whether we draw, never a subtraction from what time it is.
 *
 * Overlapping hit-stops **extend, they never accumulate**: two 80 ms stops
 * 10 ms apart release 90 ms after the first, not 160 ms. Summing is the
 * obvious implementation and it is wrong — a burst of kills would otherwise
 * multiply into a freeze long enough to read as a hang, and the player would
 * be blind for it while still moving and still being killable.
 * `MAX_HIT_STOP_MS` is a second, absolute backstop on the same failure.
 */

/** The world-space backend — implemented by `PhaserJuiceStage`, bound by `GameScene`. */
export interface JuiceStage {
  /** Displacement in CSS pixels, already amplitude-scaled. Zero must be a no-op, not a zero-amplitude shake. */
  shake(px: number, ms: number): void;
  /** Scale multiplier already amplitude-scaled; 1 must be a no-op. */
  punchObject(target: unknown, scale: number, ms: number): void;
  /** Called on every transition only, never per frame. */
  setFrozen(frozen: boolean): void;
}

/**
 * Hard ceiling on a single hit-stop, and therefore on how long the screen can
 * be held still by one call. §9's longest is 120 ms (body discovered); this
 * leaves headroom for a future cutscene beat while still being far short of
 * anything a player would read as a freeze.
 */
export const MAX_HIT_STOP_MS = 200;

/** §9: "Persistent vignette at 25%, rising to 55% during critical sabotage." */
export const VIGNETTE_BASE_INTENSITY = 0.25;
export const VIGNETTE_CRITICAL_INTENSITY = 0.55;

/** §9's button-press curve — `back.out`, expressed as its CSS equivalent. */
export const BACK_OUT_EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

const OVERLAY_ID = "foghaven-juice-overlay";
const FLASH_ID = "foghaven-juice-flash";
const VIGNETTE_ID = "foghaven-juice-vignette";
const PULSE_ID = "foghaven-juice-pulse";

/** Sabotage edge-pulse envelope. The mean is what reduced motion holds steady at. */
const PULSE_MIN_OPACITY = 0.18;
const PULSE_MAX_OPACITY = 0.42;
const PULSE_MEAN_OPACITY = (PULSE_MIN_OPACITY + PULSE_MAX_OPACITY) / 2;

type Clock = () => number;

export class JuiceDirector {
  private stage: JuiceStage | null = null;
  private hitStopUntil = 0;
  private frozen = false;

  private overlay?: HTMLElement;
  private flashLayer?: HTMLElement;
  private vignetteLayer?: HTMLElement;
  private pulseLayer?: HTMLElement;
  private pulseAnimation?: Animation;
  private vignetteIntensity = 0;

  /**
   * Injectable purely so the hit-stop tests can drive time deterministically
   * instead of sleeping. Production always uses `performance.now()`, the same
   * clock `GameScene`'s interpolation reads — they must not diverge.
   */
  constructor(private readonly clock: Clock = () => performance.now()) {}

  // --- Settings -----------------------------------------------------------

  /**
   * The factor every *displacement* amplitude is multiplied by before it
   * reaches a backend: 0 when the player (or their OS) asks for reduced
   * motion, or when atmosphere effects are off entirely.
   *
   * Scaling happens here, once, rather than in each backend — a backend that
   * forgets to check the setting is a silently inaccessible effect, and the
   * only way to make that structurally impossible is for the un-scaled value
   * never to leave this class.
   */
  private amplitudeScale(): number {
    if (graphicsEngine.prefersReducedMotion()) {
      return 0;
    }
    return graphicsEngine.getSettings().effectsEnabled ? 1 : 0;
  }

  // --- Primitives ---------------------------------------------------------

  /**
   * Camera shake of `px` pixels decaying over `ms`. Reduced motion scales the
   * displacement to zero; the duration is passed through untouched so a
   * caller sequencing a follow-up beat off the same timeline lands in the
   * same place for every player.
   */
  shake(px: number, ms: number): void {
    const amplitude = px * this.amplitudeScale();
    if (amplitude <= 0 || ms <= 0) {
      return;
    }
    this.stage?.shake(amplitude, ms);
  }

  /**
   * Holds rendering still for `ms`. Deliberately NOT amplitude-scaled — see
   * the class doc. A hit-stop is a duration, and duration is exactly what
   * reduced motion must preserve: a player whose screen kept moving during
   * everyone else's 80 ms kill freeze would see the aftermath 80 ms sooner
   * than the rest of the lobby, which is an information advantage handed out
   * by an accessibility setting. It also already *is* a reduction in motion,
   * so suppressing it under reduced motion would be backwards.
   */
  hitStop(ms: number): void {
    if (ms <= 0) {
      return;
    }
    const release = this.clock() + Math.min(ms, MAX_HIT_STOP_MS);
    // Extend, never sum.
    if (release > this.hitStopUntil) {
      this.hitStopUntil = release;
    }
  }

  /**
   * Whether rendering should be held this frame. Call once per frame from the
   * scene's update; it also drives the stage's freeze transitions, so it must
   * be called even on frames where the caller already knows it will draw.
   */
  isFrozen(): boolean {
    const frozen = this.clock() < this.hitStopUntil;
    if (frozen !== this.frozen) {
      this.frozen = frozen;
      this.stage?.setFrozen(frozen);
    }
    return frozen;
  }

  /** Milliseconds of freeze remaining, for tests and for cutscene sequencing. */
  hitStopRemaining(): number {
    return Math.max(0, this.hitStopUntil - this.clock());
  }

  /**
   * A full-screen colour wash at `alpha`, fading out over `ms`. Covers the UI
   * as well as the world — a kill flash that stopped at the canvas edge would
   * read as a canvas artifact rather than a hit.
   */
  flash(color: string, alpha: number, ms: number): void {
    const peak = alpha * this.amplitudeScale();
    if (peak <= 0 || ms <= 0) {
      return;
    }
    const layer = this.ensureFlashLayer();
    if (!layer) {
      return;
    }
    layer.style.backgroundColor = color;
    layer.animate(
      [{ opacity: String(peak) }, { opacity: "0" }],
      { duration: ms, easing: "ease-out", fill: "forwards" },
    );
  }

  /**
   * Scale-punch on a widget or game object: `1 → scale → 1` over `ms` on
   * §9's `back.out` curve.
   *
   * Reduced motion scales the *delta* from 1 to zero rather than the
   * multiplier itself — scaling `scale` directly would collapse the element
   * to nothing instead of leaving it at rest.
   */
  punch(target: HTMLElement | unknown, scale: number, ms: number): void {
    const peak = 1 + (scale - 1) * this.amplitudeScale();
    if (peak === 1 || ms <= 0) {
      return;
    }
    if (isElement(target)) {
      target.animate(
        [
          { transform: "scale(1)" },
          { transform: `scale(${peak})`, offset: 0.5 },
          { transform: "scale(1)" },
        ],
        { duration: ms, easing: BACK_OUT_EASING },
      );
      return;
    }
    this.stage?.punchObject(target, peak, ms);
  }

  /**
   * Eases the persistent vignette to `intensity` over `ms`.
   *
   * The one primitive reduced motion does NOT zero, and the reasoning is the
   * same fairness rule that keeps `hitStop` unconditional. The vignette is
   * not a displacement — it is a steady-state level that *carries game
   * state*: §9 has it sitting at 25% and rising to 55% for the duration of a
   * critical sabotage. Zeroing it would delete a standing signal that a
   * sabotage is running, which is precisely the "loses information" outcome
   * the accessibility requirement forbids. A static darkening at the screen
   * edge is also not what `prefers-reduced-motion` is about; vestibular
   * triggers are displacement, parallax and zoom, all of which are zeroed
   * above.
   *
   * The transition still runs over the caller's `ms` in both modes, so the
   * moment the signal becomes readable is identical either way.
   */
  vignette(intensity: number, ms: number): void {
    const clamped = Math.max(0, Math.min(1, intensity));
    this.vignetteIntensity = clamped;
    const layer = this.ensureVignetteLayer();
    if (!layer) {
      return;
    }
    layer.style.transition = `opacity ${Math.max(0, ms)}ms ease-out`;
    layer.style.opacity = String(clamped);
  }

  /** Current vignette level, for tests and for restoring after a cutscene. */
  currentVignette(): number {
    return this.vignetteIntensity;
  }

  /**
   * The one sustained effect in §9 — "screen edges pulse `strangerRed` at
   * 1.5 Hz **until resolved**". A sixth member rather than one of the five
   * primitives because it genuinely is not expressible as a composition of
   * them: every other primitive is a one-shot with a known end, and faking an
   * open-ended pulse with a repeating timer of `flash` calls would both fight
   * every other flash for the same layer and leave a timer running if the
   * resolving event were ever missed.
   *
   * Reduced motion drops the pulse to a steady wash at the same colour and
   * mean opacity: the *signal* that a sabotage is unresolved is preserved
   * exactly (it is game state, like the vignette), only the oscillation that
   * carries it goes away.
   */
  edgePulse(color: string | null, hz = 1.5): void {
    // Clearing a pulse that was never started is the common case (every
    // teardown and every `reset`); building the layer just to hide it would
    // touch the DOM on paths that have no effect to show.
    if (!color && !this.pulseLayer) {
      return;
    }
    const layer = this.ensurePulseLayer();
    if (!layer) {
      return;
    }
    this.pulseAnimation?.cancel();
    this.pulseAnimation = undefined;
    if (!color) {
      layer.style.opacity = "0";
      return;
    }
    layer.style.background = `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, ${color} 100%)`;
    if (this.amplitudeScale() === 0) {
      layer.style.opacity = String(PULSE_MEAN_OPACITY);
      return;
    }
    layer.style.opacity = String(PULSE_MEAN_OPACITY);
    this.pulseAnimation = layer.animate(
      [
        { opacity: String(PULSE_MIN_OPACITY) },
        { opacity: String(PULSE_MAX_OPACITY) },
        { opacity: String(PULSE_MIN_OPACITY) },
      ],
      { duration: 1000 / hz, iterations: Infinity, easing: "ease-in-out" },
    );
  }

  // --- Lifecycle ----------------------------------------------------------

  bindStage(stage: JuiceStage): () => void {
    this.stage = stage;
    // A stage bound mid-freeze (a scene created while a hit-stop from the
    // previous one is still running) must not start out of sync with the
    // clock that outlived it.
    stage.setFrozen(this.frozen);
    return () => {
      if (this.stage === stage) {
        this.stage = null;
      }
    };
  }

  /**
   * Drops any in-flight freeze and clears the overlay. Called on scene
   * teardown and on leaving a room — a hit-stop that outlived the scene that
   * asked for it would freeze the next one's first frames for no reason.
   */
  reset(): void {
    this.hitStopUntil = 0;
    if (this.frozen) {
      this.frozen = false;
      this.stage?.setFrozen(false);
    }
    this.vignette(0, 0);
    this.edgePulse(null);
  }

  // --- DOM overlay --------------------------------------------------------

  /**
   * Both screen layers live in one container appended to `<body>`, created
   * lazily so importing this module has no side effect on the document (it is
   * imported by tests and by code paths that never render).
   *
   * `pointer-events: none` throughout: the juice layer sits above the whole
   * app and must never intercept a click meant for a button underneath it.
   */
  private ensureOverlay(): HTMLElement | undefined {
    if (typeof document === "undefined") {
      return undefined;
    }
    if (this.overlay?.isConnected) {
      return this.overlay;
    }
    const existing = document.getElementById(OVERLAY_ID);
    if (existing instanceof HTMLElement) {
      this.overlay = existing;
      return existing;
    }
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden;";
    document.body.appendChild(overlay);
    this.overlay = overlay;
    return overlay;
  }

  private ensureFlashLayer(): HTMLElement | undefined {
    if (this.flashLayer?.isConnected) {
      return this.flashLayer;
    }
    const overlay = this.ensureOverlay();
    if (!overlay) {
      return undefined;
    }
    const layer = document.createElement("div");
    layer.id = FLASH_ID;
    layer.style.cssText = "position:absolute;inset:0;opacity:0;pointer-events:none;";
    overlay.appendChild(layer);
    this.flashLayer = layer;
    return layer;
  }

  private ensureVignetteLayer(): HTMLElement | undefined {
    if (this.vignetteLayer?.isConnected) {
      return this.vignetteLayer;
    }
    const overlay = this.ensureOverlay();
    if (!overlay) {
      return undefined;
    }
    const layer = document.createElement("div");
    layer.id = VIGNETTE_ID;
    // Sized past the viewport so the gradient's dark stop is off-screen and
    // the falloff reads as depth rather than as a visible ring.
    layer.style.cssText =
      "position:absolute;inset:0;opacity:0;pointer-events:none;" +
      "background:radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.85) 100%);";
    overlay.appendChild(layer);
    this.vignetteLayer = layer;
    return layer;
  }

  private ensurePulseLayer(): HTMLElement | undefined {
    if (this.pulseLayer?.isConnected) {
      return this.pulseLayer;
    }
    const overlay = this.ensureOverlay();
    if (!overlay) {
      return undefined;
    }
    const layer = document.createElement("div");
    layer.id = PULSE_ID;
    layer.style.cssText = "position:absolute;inset:0;opacity:0;pointer-events:none;";
    overlay.appendChild(layer);
    this.pulseLayer = layer;
    return layer;
  }
}

function isElement(value: unknown): value is HTMLElement {
  return typeof HTMLElement !== "undefined" && value instanceof HTMLElement;
}

/**
 * The singleton every caller uses. Module-level rather than a React context
 * for the same reason `audioEngine` and `graphicsEngine` are: Phaser scenes
 * are plain classes living entirely outside React's tree, and threading this
 * through both worlds would mean two sources of truth for one screen.
 */
export const juice = new JuiceDirector();
