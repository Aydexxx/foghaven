/**
 * The adaptive score: three always-running layers, crossfaded rather than
 * swapped, so a tension change is heard as the mix shifting under the
 * player rather than one track cutting to another.
 *
 *   - calm: a soft, consonant detuned drone — the resting state, and it
 *     never fully disappears even at maximum tension; a foggy town is never
 *     silent.
 *   - tense: a slow, dissonant pulsing bass, gain tied directly to the
 *     tension value.
 *   - critical: a fast, harsh rhythmic layer that only exists for sabotage
 *     — independent of tension, because a sabotage in progress is urgent
 *     regardless of how many players have died.
 *
 * See `useGameAudio.ts` for what tension is actually computed *from* — the
 * one rule that matters there is that it may only react to information a
 * player would legitimately know, the same discipline the fog and the
 * position sync already apply to every other channel.
 */

const RAMP_S = 2.5;

/**
 * A gain stage whose own level is driven entirely by a square-wave LFO
 * summed onto its `AudioParam`'s base value — `base` sits at the range's
 * midpoint and the LFO's gain scales to swing exactly to `floor` and `1` on
 * either side. Multiplying this into a signal chain (rather than adding the
 * LFO straight onto a bus gain) is what lets the pulse depth stay
 * proportional however loud that bus currently is.
 */
function createPulseGate(ctx: BaseAudioContext, hz: number, floor: number): GainNode {
  const gate = ctx.createGain();
  gate.gain.value = (1 + floor) / 2;

  const lfo = ctx.createOscillator();
  lfo.type = "square";
  lfo.frequency.value = hz;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = (1 - floor) / 2;
  lfo.connect(lfoDepth).connect(gate.gain);
  lfo.start();

  return gate;
}

export class TensionMusic {
  private readonly calmGain: GainNode;
  private readonly tenseGain: GainNode;
  private readonly criticalGain: GainNode;
  private tension = 0;

  constructor(private readonly ctx: BaseAudioContext, destination: AudioNode) {
    this.calmGain = ctx.createGain();
    this.calmGain.gain.value = 0.22;
    this.tenseGain = ctx.createGain();
    this.tenseGain.gain.value = 0;
    this.criticalGain = ctx.createGain();
    this.criticalGain.gain.value = 0;

    this.calmGain.connect(destination);
    this.tenseGain.connect(destination);
    this.criticalGain.connect(destination);

    this.buildCalmLayer();
    this.buildTenseLayer();
    this.buildCriticalLayer();
  }

  /** A soft pad from three slightly-detuned sines — the classic "beating" shimmer of a calm drone. */
  private buildCalmLayer(): void {
    const root = 110;
    const detunes = [0, 4, -6];
    for (const cents of detunes) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = root;
      osc.detune.value = cents;
      const voiceGain = this.ctx.createGain();
      voiceGain.gain.value = 0.33;
      osc.connect(voiceGain).connect(this.calmGain);
      osc.start();
    }

    // A very slow amplitude LFO so the pad breathes rather than droning flat.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.06;
    lfo.connect(lfoGain).connect(this.calmGain.gain);
    lfo.start();
  }

  /** A dissonant low pulse — a sawtooth a tritone below the calm root, gated at a slow, uneasy rate. */
  private buildTenseLayer(): void {
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 58;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 220;

    const pulse = createPulseGate(this.ctx, 0.9, 0.35);
    osc.connect(filter).connect(pulse).connect(this.tenseGain);
    osc.start();
  }

  /** A fast, harsh rhythmic layer — a square-wave tone chopped by a quick pulse, reserved for sabotage. */
  private buildCriticalLayer(): void {
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 146.8;

    const pulse = createPulseGate(this.ctx, 6, 0.15);
    osc.connect(pulse).connect(this.criticalGain);
    osc.start();
  }

  /** 0 (calm) to 1 (maximum tension) — see the doc on this class for what should drive it. */
  setTension(value: number): void {
    const clamped = Math.min(1, Math.max(0, value));
    if (clamped === this.tension) {
      return;
    }
    this.tension = clamped;
    const now = this.ctx.currentTime;
    this.rampTo(this.calmGain, 0.22 - clamped * 0.1, now);
    this.rampTo(this.tenseGain, clamped * 0.3, now);
  }

  setSabotage(active: boolean): void {
    const now = this.ctx.currentTime;
    this.rampTo(this.criticalGain, active ? 0.28 : 0, now);
  }

  private rampTo(node: GainNode, target: number, now: number): void {
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(node.gain.value, now);
    node.gain.linearRampToValueAtTime(target, now + RAMP_S);
  }
}
