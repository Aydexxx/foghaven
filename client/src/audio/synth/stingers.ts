import { createNoiseBuffer } from "./noise";

/**
 * The stingers. Each one is built from a different *shape* of sound, not
 * just a different pitch — register, duration, contour and timbre all
 * differ, because "instantly recognisable" has to survive a player who
 * isn't looking at the screen when it plays:
 *
 *   - kill: a short, low noise stab — violence, over in a quarter second.
 *   - bodyFound: a slow two-note minor fall on a soft tone — dread, not
 *     violence; the moment of finding, not doing.
 *   - meetingStart: a long metallic bell swell — the only stinger that
 *     rings out for seconds rather than hitting once.
 *   - sabotageAlarm: a rapid alternating two-tone siren — the only stinger
 *     that repeats, and the loudest, most urgent one in the set.
 *   - ejection: a falling filtered sweep into a thud — motion, not a hit;
 *     nothing else here has a pitch that slides.
 *   - bellToll: the same struck-metal partials as `meetingStart`, but ONE
 *     short strike rather than a swell — §10.2's ejection cutscene calls for
 *     "one bell toll", not the meeting bell's ring-out, so this shares the
 *     timbre (both are "the same bell") while staying clearly distinct in
 *     shape (this decays in under a second; `meetingStart` rings for 2.4s).
 *   - win: a bright ascending major arpeggio, high register.
 *   - loss: a slow descending minor pair, low register — win played backwards
 *     and inverted, so the two payoff stingers read as opposites at a glance.
 *   - taskComplete (8.3): two soft ascending bell-like tones — a small, warm
 *     payoff, deliberately quieter and shorter than `win` so it never
 *     competes with it; this fires many times a round, `win` fires once.
 *   - taskInjury (8.3): a metallic kick-back — a short detuned clang plus a
 *     percussive snap. Distinct from `kill`'s low noise-stab: that one is
 *     violence done TO someone, this is a spring snapping back at you.
 *     (A lethal task's own failure reuses `kill` outright — `applyDeath`
 *     sends the same `"killed"` message a murder does, and this file's own
 *     `playKillStinger` already answers it identically either way, which is
 *     exactly the point: a task death and a murder must sound the same.)
 *
 * Every function fires a self-contained, self-cleaning Web Audio graph:
 * nodes are created, scheduled, and `stop()`-ped a beat after their own
 * envelope ends, so nothing needs to be torn down by the caller.
 */

interface StingerCtx {
  ctx: BaseAudioContext;
  destination: AudioNode;
}

function envelopeGain(
  ctx: BaseAudioContext,
  attack: number,
  peak: number,
  release: number,
  startAt: number,
): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + attack + release);
  return gain;
}

function tone(
  ctx: BaseAudioContext,
  destination: AudioNode,
  freq: number,
  type: OscillatorType,
  startAt: number,
  attack: number,
  peak: number,
  release: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const gain = envelopeGain(ctx, attack, peak, release, startAt);
  osc.connect(gain).connect(destination);
  osc.start(startAt);
  osc.stop(startAt + attack + release + 0.1);
}

export function playKillStinger({ ctx, destination }: StingerCtx): void {
  const now = ctx.currentTime;
  const duration = 0.28;

  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, duration, "white");
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1400, now);
  filter.frequency.exponentialRampToValueAtTime(120, now + duration);
  const noiseGain = envelopeGain(ctx, 0.005, 0.55, duration, now);
  noise.connect(filter).connect(noiseGain).connect(destination);
  noise.start(now);
  noise.stop(now + duration + 0.1);

  // A low thud underneath the stab gives it weight the noise alone can't.
  tone(ctx, destination, 90, "sine", now, 0.005, 0.5, 0.22);
}

export function playBodyFoundStinger({ ctx, destination }: StingerCtx): void {
  const now = ctx.currentTime;
  tone(ctx, destination, 261.6, "triangle", now, 0.03, 0.35, 0.45);
  tone(ctx, destination, 220.0, "triangle", now + 0.28, 0.03, 0.32, 0.65);
}

export function playMeetingStartStinger({ ctx, destination }: StingerCtx): void {
  const now = ctx.currentTime;
  const fundamental = 220;
  // Inharmonic partials, not a clean overtone series — a struck-metal bell
  // rather than a musical note, and the long release is what makes this the
  // one stinger that keeps ringing after everything else has already cut off.
  const partials: Array<[number, number]> = [
    [1, 0.4],
    [2.4, 0.22],
    [3.9, 0.14],
    [5.2, 0.08],
  ];
  for (const [mult, peak] of partials) {
    tone(ctx, destination, fundamental * mult, "sine", now, 0.01, peak, 2.4);
  }
}

export function playBellTollStinger({ ctx, destination }: StingerCtx): void {
  const now = ctx.currentTime;
  const fundamental = 220;
  // The same inharmonic partial set as `playMeetingStartStinger` — it is
  // meant to read as the same physical bell — but a fraction of the release,
  // so this hits once and dies rather than ringing on.
  const partials: Array<[number, number]> = [
    [1, 0.42],
    [2.4, 0.2],
    [3.9, 0.1],
  ];
  for (const [mult, peak] of partials) {
    tone(ctx, destination, fundamental * mult, "sine", now, 0.005, peak, 0.6);
  }
}

export function playSabotageAlarmStinger({ ctx, destination }: StingerCtx): void {
  const now = ctx.currentTime;
  const cycles = 6;
  const cycleLength = 0.22;
  const gain = ctx.createGain();
  gain.gain.value = 0.4;
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.connect(gain).connect(destination);

  // The only repeating stinger — an alternating two-tone siren, urgent and
  // impossible to mistake for a one-shot hit.
  for (let i = 0; i < cycles; i++) {
    const t = now + i * cycleLength;
    osc.frequency.setValueAtTime(i % 2 === 0 ? 880 : 660, t);
  }
  osc.start(now);
  osc.stop(now + cycles * cycleLength + 0.05);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.4, now + 0.02);
  gain.gain.setValueAtTime(0.4, now + cycles * cycleLength - 0.05);
  gain.gain.linearRampToValueAtTime(0, now + cycles * cycleLength);
}

export function playEjectionStinger({ ctx, destination }: StingerCtx): void {
  const now = ctx.currentTime;
  const duration = 0.55;

  // The only stinger built around a moving pitch — a falling sweep, thrown
  // out and away, landing in a short thud.
  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, duration, "pink");
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 3;
  filter.frequency.setValueAtTime(2200, now);
  filter.frequency.exponentialRampToValueAtTime(140, now + duration * 0.85);
  const gain = envelopeGain(ctx, 0.01, 0.45, duration, now);
  noise.connect(filter).connect(gain).connect(destination);
  noise.start(now);
  noise.stop(now + duration + 0.1);

  tone(ctx, destination, 80, "sine", now + duration * 0.75, 0.005, 0.4, 0.25);
}

export function playWinStinger({ ctx, destination }: StingerCtx): void {
  const now = ctx.currentTime;
  // A bright, high-register major arpeggio — the one stinger with a rising,
  // multi-note melodic contour.
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    tone(ctx, destination, freq, "triangle", now + i * 0.12, 0.01, 0.3, 0.5);
  });
}

export function playLossStinger({ ctx, destination }: StingerCtx): void {
  const now = ctx.currentTime;
  // Win's mirror: low register, falling, two notes instead of four, and a
  // slight detune on the second note for a dissonant, deflating close.
  tone(ctx, destination, 233.08, "sawtooth", now, 0.02, 0.25, 0.6);
  tone(ctx, destination, 205.0, "sawtooth", now + 0.45, 0.02, 0.28, 0.9);
}

export function playTunnelStinger({ ctx, destination }: StingerCtx): void {
  const now = ctx.currentTime;
  const duration = 0.4;

  // A muffled rush through a buried passage — a bandpass sweep that opens
  // then closes, distinct from the ejection's falling sweep (that one is
  // wide-band and one-directional; this one is narrow and arcs up then
  // down, reading as "through a tunnel" rather than "thrown out").
  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, duration, "pink");
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 4;
  filter.frequency.setValueAtTime(220, now);
  filter.frequency.linearRampToValueAtTime(900, now + duration * 0.45);
  filter.frequency.linearRampToValueAtTime(180, now + duration);
  const gain = envelopeGain(ctx, 0.05, 0.35, duration - 0.05, now);
  noise.connect(filter).connect(gain).connect(destination);
  noise.start(now);
  noise.stop(now + duration + 0.1);
}

/** §8.3: a task attempt resolving successfully — small, warm, fires often. */
export function playTaskCompleteStinger({ ctx, destination }: StingerCtx): void {
  const now = ctx.currentTime;
  // Two-note rise, a fifth apart, both soft triangles — a miniature version
  // of `playWinStinger`'s shape at a fraction of the loudness and length, so
  // the two never read as the same event even heard back to back.
  tone(ctx, destination, 523.25, "triangle", now, 0.008, 0.16, 0.22);
  tone(ctx, destination, 783.99, "triangle", now + 0.09, 0.008, 0.18, 0.28);
}

/** §8.3: an injury-tier task kicking back on failure. */
export function playTaskInjuryStinger({ ctx, destination }: StingerCtx): void {
  const now = ctx.currentTime;
  const duration = 0.22;

  // A short percussive snap — the mechanism giving way.
  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, duration, "white");
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 2.5;
  filter.frequency.setValueAtTime(1800, now);
  filter.frequency.exponentialRampToValueAtTime(500, now + duration);
  const noiseGain = envelopeGain(ctx, 0.003, 0.4, duration - 0.05, now);
  noise.connect(filter).connect(noiseGain).connect(destination);
  noise.start(now);
  noise.stop(now + duration + 0.1);

  // Two close-detuned tones for the metallic "clang" underneath the snap —
  // detuning (rather than a clean single tone) is what reads as metal rather
  // than a struck bell like `meetingStart`/`bellToll`'s clean partial series.
  tone(ctx, destination, 340, "square", now, 0.004, 0.22, 0.18);
  tone(ctx, destination, 355, "square", now, 0.004, 0.2, 0.18);
}
