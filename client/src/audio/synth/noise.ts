/**
 * Noise generation — the raw material behind almost every sound in this
 * game. There are no audio files: every ambience loop and stinger here is
 * synthesized at runtime from oscillators and shaped noise, the same
 * "generate it, don't ship it" approach already used for the tileset and
 * the character sprites. A few seconds of noise, looped and filtered
 * differently, is what becomes waves, wind, a footstep, or a percussive hit
 * — the shaping (which `synth/*` files provide) is what tells them apart,
 * not the source material.
 */

export type NoiseColor = "white" | "pink" | "brown";

/**
 * A buffer of the given noise colour, `seconds` long, ready to loop.
 *
 * - white: equal energy at every frequency — harsh, hiss-like, good for
 *   short percussive transients (a footstep, a struck bell's attack).
 * - pink: energy falls off with frequency (1/f) — the "shhh" of surf and
 *   rain; the natural base for wave ambience.
 * - brown: falls off faster still (1/f²) — a deep, rumbling wash; wind and
 *   the low end of waves.
 */
export function createNoiseBuffer(
  ctx: BaseAudioContext,
  seconds: number,
  color: NoiseColor,
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (color === "white") {
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  if (color === "pink") {
    // Paul Kellet's refined pink-noise filter — a standard, cheap
    // approximation built from a handful of running averages.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = pink * 0.11;
    }
    return buffer;
  }

  // Brown: integrate white noise (a random walk), leaking slightly so it
  // can't wander off to silence or clip.
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + white * 0.02) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

/** A looping noise source, already started, routed through the given destination. */
export function playLoopingNoise(
  ctx: BaseAudioContext,
  color: NoiseColor,
  seconds: number,
  destination: AudioNode,
): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = createNoiseBuffer(ctx, seconds, color);
  source.loop = true;
  source.connect(destination);
  source.start();
  return source;
}
