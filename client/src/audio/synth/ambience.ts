import type { RoomSlug } from "@foghaven/shared";
import { createNoiseBuffer } from "./noise";

/**
 * Room ambience: four synthesized layers — waves, wind, creaking timber,
 * distant gulls — mixed to a different balance per room. Waves and wind are
 * continuous, slowly-modulated noise beds; timber and gulls are sparse,
 * randomly-timed one-shot events, because a creak or a gull cry is
 * something that *happens*, not a drone that plays forever.
 */

const CROSSFADE_S = 1.4;

/** How loud each layer sits in a given room, 0..1 — the whole of "ambience varies by room". */
const ROOM_MIX: Record<RoomSlug, { waves: number; wind: number; timber: number; gulls: number }> = {
  streets: { waves: 0.35, wind: 0.55, timber: 0, gulls: 0.4 },
  docks: { waves: 0.75, wind: 0.3, timber: 0.05, gulls: 0.6 },
  fishMarket: { waves: 0.5, wind: 0.2, timber: 0.15, gulls: 0.55 },
  lighthouse: { waves: 0.45, wind: 0.7, timber: 0.2, gulls: 0.3 },
  lampRoom: { waves: 0.2, wind: 0.4, timber: 0.25, gulls: 0.1 },
  tavern: { waves: 0, wind: 0.05, timber: 0.5, gulls: 0 },
  warehouse: { waves: 0, wind: 0.08, timber: 0.4, gulls: 0 },
  infirmary: { waves: 0, wind: 0.05, timber: 0.3, gulls: 0 },
  townHall: { waves: 0, wind: 0.05, timber: 0.35, gulls: 0 },
  cellar: { waves: 0, wind: 0, timber: 0.2, gulls: 0 },
};

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * A continuous noise bed with slow LFOs on filter cutoff and amplitude, so
 * it breathes instead of sitting static.
 *
 * Amplitude modulation is a *second*, cascaded gain stage (`breath`, held
 * near 1.0) multiplying into the level stage (`level`, the one `setTarget`
 * ramps) — not summed directly onto one gain. Summing an oscillator onto a
 * single `GainNode.gain` would make the "breathing" audible even at level
 * 0 (an LFO added to a base of 0 still swings above and below it), and this
 * layer needs to actually go silent in a room with none of it in the mix.
 * Multiplying two stages means the breath scales with — and vanishes
 * alongside — the level.
 */
class SwellLayer {
  private readonly level: GainNode;
  private readonly filter: BiquadFilterNode;

  constructor(
    ctx: BaseAudioContext,
    destination: AudioNode,
    opts: {
      color: "pink" | "brown";
      filterType: BiquadFilterType;
      baseFreq: number;
      freqLfoRange: number;
      freqLfoHz: number;
      ampLfoHz: number;
      ampLfoDepth: number;
    },
  ) {
    const source = ctx.createBufferSource();
    source.buffer = createNoiseBuffer(ctx, 6, opts.color);
    source.loop = true;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = opts.filterType;
    this.filter.frequency.value = opts.baseFreq;
    this.filter.Q.value = 0.7;

    const breath = ctx.createGain();
    breath.gain.value = 1 - opts.ampLfoDepth;

    this.level = ctx.createGain();
    this.level.gain.value = 0;

    source.connect(this.filter).connect(breath).connect(this.level).connect(destination);
    source.start();

    // Slow filter-cutoff LFO — the "swell" of surf breathing in and out.
    const freqLfo = ctx.createOscillator();
    freqLfo.frequency.value = opts.freqLfoHz;
    const freqLfoGain = ctx.createGain();
    freqLfoGain.gain.value = opts.freqLfoRange;
    freqLfo.connect(freqLfoGain).connect(this.filter.frequency);
    freqLfo.start();

    // A second, independent LFO drives `breath`'s gain between
    // (1 - depth) and 1 — deliberately a different rate than the filter
    // LFO above, so loudness and brightness don't swell in lockstep the
    // way real surf never does.
    const ampLfo = ctx.createOscillator();
    ampLfo.frequency.value = opts.ampLfoHz;
    const ampLfoGain = ctx.createGain();
    ampLfoGain.gain.value = opts.ampLfoDepth;
    ampLfo.connect(ampLfoGain).connect(breath.gain);
    ampLfo.start();
  }

  /** Target level for this layer, 0..1, smoothly ramped. */
  setTarget(level: number, now: number): void {
    this.level.gain.cancelScheduledValues(now);
    this.level.gain.setValueAtTime(this.level.gain.value, now);
    this.level.gain.linearRampToValueAtTime(level, now + CROSSFADE_S);
  }
}

/** A sparse, randomly-timed one-shot event layer — a creak, a distant cry. */
class EventLayer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private intensity = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly destination: AudioNode,
    private readonly fire: (ctx: BaseAudioContext, destination: AudioNode, loudness: number) => void,
    /** Average seconds between events at full intensity; scales inversely with intensity below that. */
    private readonly baseIntervalS: number,
  ) {
    this.scheduleNext();
  }

  setTarget(level: number): void {
    this.intensity = level;
  }

  private scheduleNext(): void {
    if (this.disposed) {
      return;
    }
    // Silent rooms just check back slowly rather than spinning; a live
    // room fires roughly every `baseIntervalS` seconds, jittered so it
    // never feels like a metronome.
    const interval =
      this.intensity <= 0.01 ? this.baseIntervalS * 3 : this.baseIntervalS / Math.max(0.15, this.intensity);
    const jittered = randRange(interval * 0.6, interval * 1.6);
    this.timer = setTimeout(() => {
      if (!this.disposed && this.intensity > 0.01) {
        this.fire(this.ctx, this.destination, this.intensity);
      }
      this.scheduleNext();
    }, jittered * 1000);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }
}

function fireTimberCreak(ctx: BaseAudioContext, destination: AudioNode, loudness: number): void {
  const now = ctx.currentTime;
  const duration = randRange(0.5, 1.1);
  const source = ctx.createBufferSource();
  source.buffer = createNoiseBuffer(ctx, duration, "white");

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = randRange(4, 9);
  const startFreq = randRange(180, 420);
  filter.frequency.setValueAtTime(startFreq, now);
  filter.frequency.exponentialRampToValueAtTime(startFreq * randRange(0.6, 1.5), now + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.22 * loudness, now + duration * 0.15);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  source.connect(filter).connect(gain).connect(destination);
  source.start(now);
  source.stop(now + duration + 0.05);
}

function fireGullCry(ctx: BaseAudioContext, destination: AudioNode, loudness: number): void {
  const now = ctx.currentTime;
  const duration = randRange(0.35, 0.7);
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  const baseFreq = randRange(1400, 2200);
  osc.frequency.setValueAtTime(baseFreq, now);
  osc.frequency.linearRampToValueAtTime(baseFreq * 1.4, now + duration * 0.4);
  osc.frequency.linearRampToValueAtTime(baseFreq * 0.7, now + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.06 * loudness, now + duration * 0.2);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  const pan = ctx.createStereoPanner();
  pan.pan.value = randRange(-0.8, 0.8);

  osc.connect(gain).connect(pan).connect(destination);
  osc.start(now);
  osc.stop(now + duration + 0.05);
}

/** Owns the four ambience layers and crossfades their mix as the local player moves between rooms. */
export class RoomAmbience {
  private readonly waves: SwellLayer;
  private readonly wind: SwellLayer;
  private readonly timber: EventLayer;
  private readonly gulls: EventLayer;
  private currentRoom: RoomSlug | null = null;

  constructor(private readonly ctx: BaseAudioContext, destination: AudioNode) {
    this.waves = new SwellLayer(ctx, destination, {
      color: "pink",
      filterType: "lowpass",
      baseFreq: 420,
      freqLfoRange: 180,
      freqLfoHz: 0.09,
      ampLfoHz: 0.13,
      ampLfoDepth: 0.35,
    });
    this.wind = new SwellLayer(ctx, destination, {
      color: "brown",
      filterType: "bandpass",
      baseFreq: 700,
      freqLfoRange: 260,
      freqLfoHz: 0.06,
      ampLfoHz: 0.21,
      ampLfoDepth: 0.4,
    });
    this.timber = new EventLayer(ctx, destination, fireTimberCreak, 9);
    this.gulls = new EventLayer(ctx, destination, fireGullCry, 7);
  }

  setRoom(slug: RoomSlug): void {
    if (slug === this.currentRoom) {
      return;
    }
    this.currentRoom = slug;
    const mix = ROOM_MIX[slug];
    const now = this.ctx.currentTime;
    this.waves.setTarget(mix.waves, now);
    this.wind.setTarget(mix.wind, now);
    this.timber.setTarget(mix.timber);
    this.gulls.setTarget(mix.gulls);
  }

  dispose(): void {
    this.timber.dispose();
    this.gulls.dispose();
  }
}
