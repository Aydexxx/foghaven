import { createNoiseBuffer } from "./noise";

/**
 * One remote player's footstep voice: a persistent stereo-pan → distance-
 * gain → muffle-filter chain, plus a stateless `step()` that fires a short
 * noise burst through whatever that chain is currently set to.
 *
 * The chain is persistent and the burst is not, because a footstep isn't
 * one long sound — it's a walk cycle's worth of short, discrete taps, each
 * one panned and attenuated by wherever its source happens to be *right
 * now*. Splitting it this way means `updateSpatial` (cheap — a few
 * `AudioParam` writes, called every frame) and `step` (a genuine new noise
 * burst, called only on the cadence of an actual footfall) never have to
 * agree on timing with each other.
 *
 * "Direction" here means left/right stereo pan (`StereoPannerNode`), not a
 * full 3D HRTF panner: this is a top-down game with a camera that
 * translates but never rotates, so there is no listener "forward" for a
 * front/back cue to mean anything relative to. Distance is conveyed by
 * volume and by how much a low-pass filter dulls the burst — the same pair
 * of cues real distant footsteps actually lose first.
 */
export class FootstepVoice {
  private readonly panner: StereoPannerNode;
  private readonly distanceGain: GainNode;
  private readonly muffle: BiquadFilterNode;

  constructor(private readonly ctx: BaseAudioContext, destination: AudioNode) {
    this.panner = ctx.createStereoPanner();
    this.distanceGain = ctx.createGain();
    this.distanceGain.gain.value = 0;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = 3500;

    this.panner.connect(this.distanceGain).connect(this.muffle).connect(destination);
  }

  /**
   * @param pan -1 (full left) to 1 (full right).
   * @param proximity 1 at point-blank, fading to 0 at the edge of earshot.
   *   Callers are expected to have already gated this to 0 for anyone
   *   outside the listener's fog — see `GameScene.updateFootsteps` — so
   *   this only ever shapes *how* an already-permitted source sounds, never
   *   whether it's audible at all.
   */
  updateSpatial(pan: number, proximity: number): void {
    const now = this.ctx.currentTime;
    const clamped = Math.min(1, Math.max(0, proximity));
    // A short time-constant smooths per-frame jitter without adding
    // perceptible lag to the pan following a fast-moving source.
    this.panner.pan.setTargetAtTime(pan, now, 0.06);
    this.distanceGain.gain.setTargetAtTime(clamped, now, 0.06);
    this.muffle.frequency.setTargetAtTime(700 + clamped * 3300, now, 0.06);
  }

  /** Fire one footfall through the chain's current spatial settings. */
  step(): void {
    const now = this.ctx.currentTime;
    const duration = 0.09;
    const source = this.ctx.createBufferSource();
    source.buffer = createNoiseBuffer(this.ctx, duration, "brown");

    const shape = this.ctx.createBiquadFilter();
    shape.type = "bandpass";
    shape.frequency.value = 260 + Math.random() * 80;
    shape.Q.value = 1.4;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.7, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    source.connect(shape).connect(gain).connect(this.panner);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  dispose(): void {
    this.panner.disconnect();
    this.distanceGain.disconnect();
    this.muffle.disconnect();
  }
}
