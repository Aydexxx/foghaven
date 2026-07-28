#!/usr/bin/env node
/**
 * Foghaven asset cleanup — the mandatory §12.5 pass from docs/ART_BIBLE.md,
 * run against an already-approved asset in art/approved/.
 *
 * Nothing here destroys the original: the input is art/approved/<name>.png and
 * the output is a sibling art/approved/<name>.clean.png. Re-run it as often as
 * you like.
 *
 * Usage:
 *   node scripts/cleanup.mjs <asset-name> [--size <long-edge-px>]
 *   node scripts/cleanup.mjs <asset-name> [<long-edge-px>]
 *
 * Examples:
 *   node scripts/cleanup.mjs character-base-01
 *   node scripts/cleanup.mjs cosmetic-hats-01 --size 256
 *
 * The four steps, in §12.5 order:
 *   a. Background removal — flood-fill from the border using the background
 *      colour detected in the corners, with a feathered (anti-aliased) edge so
 *      no halo is left behind. Flood-fill (rather than a global colour key)
 *      means interior pixels that happen to be near the background colour —
 *      e.g. `foam` rim light, which is perceptually almost identical to the
 *      grey plate these are generated on — are preserved, because they are not
 *      connected to the border.
 *   b. Palette snap — every visible pixel is quantised to the nearest §3 token
 *      using CIEDE2000 perceptual distance. Naive RGB distance mismatches dark
 *      colours badly, and most of this palette is dark.
 *   c. Outline normalisation — near-black pixels snap to the exact `ink` token
 *      at full opacity, so the outline is one colour at uniform weight.
 *   d. Downscale — to the target long edge (default 128), then the palette snap
 *      and outline normalisation are re-applied, because any resampling filter
 *      blends neighbours back into off-palette colours. This is what keeps the
 *      §13 "every pixel maps to a token" guarantee true of the shipped file.
 *
 * The one palette definition in the repo lives in client/src/theme/tokens.ts;
 * it is imported here (Node runs the TypeScript directly) rather than copied,
 * so the snap targets can never drift from what the React/Phaser layers use.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const APPROVED_DIR = path.join(REPO_ROOT, 'art', 'approved');
const TOKENS_PATH = path.join(REPO_ROOT, 'client', 'src', 'theme', 'tokens.ts');

// ---------------------------------------------------------------------------
// Tunables. These are in CIEDE2000 units (roughly: 1 ≈ a just-noticeable
// difference, ~2.3 ≈ the classic "not the same colour" threshold).
// ---------------------------------------------------------------------------

const DEFAULT_LONG_EDGE = 128;

// Background flood-fill. A border-connected pixel within OUTER of the detected
// background is considered part of the background region; within INNER it is
// fully removed, and between the two its opacity ramps up (the anti-aliased
// edge). OUTER is deliberately well below `foam`'s distance from the plate so
// rim light is never in play even at the border.
const BG_INNER_DELTA = 7;
const BG_OUTER_DELTA = 22;

// Outline detection: a visible pixel this dark (max channel) is treated as
// outline and forced to the exact `ink` token.
const OUTLINE_MAX_CHANNEL = 60;

// A pixel counts as "solid" (vs. a feathered edge) at/above this alpha; solid
// outline pixels are pinned to full opacity, edge pixels keep their ramp.
const SOLID_ALPHA = 128;

// A snapped pixel counts as "changed" for the drift metric only if it moved
// more than this — avoids counting imperceptible nudges as palette drift.
const DRIFT_DELTA = 2.3;

const DRIFT_WARN_FRACTION = 0.40;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { name: null, size: DEFAULT_LONG_EDGE };
  const rest = [...argv];
  args.name = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--size') args.size = parseInt(rest[++i], 10);
    else if (/^\d+$/.test(a)) args.size = parseInt(a, 10);
    else console.warn(`Unknown argument: ${a}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.name) {
  console.error('\nUsage: node scripts/cleanup.mjs <asset-name> [--size <long-edge-px>]\n');
  process.exit(1);
}
if (!Number.isInteger(args.size) || args.size < 8) {
  console.error(`--size must be an integer >= 8, got: ${args.size}`);
  process.exit(1);
}

const inputPath = path.join(APPROVED_DIR, `${args.name}.png`);
const outputPath = path.join(APPROVED_DIR, `${args.name}.clean.png`);

if (!existsSync(inputPath)) {
  console.error(`Approved asset not found: ${inputPath}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Colour maths: sRGB -> CIELAB, and CIEDE2000.
// ---------------------------------------------------------------------------

function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbToLab(r, g, b) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  // sRGB (D65) -> XYZ
  let x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  let y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  let z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;
  // Normalise to D65 white
  x /= 0.95047;
  y /= 1.0;
  z /= 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const kL = 1, kC = 1, kH = 1;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = Math.atan2(b1, a1p);
  const h2p = Math.atan2(b2, a2p);
  const toDeg = (r) => (r * 180) / Math.PI;
  const h1 = (toDeg(h1p) + 360) % 360;
  const h2 = (toDeg(h2p) + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2 - h1) <= 180) dhp = h2 - h1;
  else if (h2 - h1 > 180) dhp = h2 - h1 - 360;
  else dhp = h2 - h1 + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 180 / 2);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp;
  if (C1p * C2p === 0) hbarp = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) hbarp = (h1 + h2) / 2;
  else if (h1 + h2 < 360) hbarp = (h1 + h2 + 360) / 2;
  else hbarp = (h1 + h2 - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos(((hbarp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbarp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbarp + 6) * Math.PI) / 180) -
    0.20 * Math.cos(((4 * hbarp - 63) * Math.PI) / 180);
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin((2 * dTheta * Math.PI) / 180) * RC;

  return Math.sqrt(
    Math.pow(dLp / (kL * SL), 2) +
      Math.pow(dCp / (kC * SC), 2) +
      Math.pow(dHp / (kH * SH), 2) +
      RT * (dCp / (kC * SC)) * (dHp / (kH * SH)),
  );
}

// ---------------------------------------------------------------------------
// Load the one true palette from client/src/theme/tokens.ts.
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const tokens = await import(pathToFileURL(TOKENS_PATH).href);

// §3 world palette = core + materials + light + semantic. This is exactly the
// aggregate `colors` object tokens.ts already exports. The §3.5 player lantern
// colours are deliberately NOT snap targets: they are applied to the lantern /
// glow layers at runtime per player (§4.2), never baked into base art, and
// their high luminance would wrongly capture flame and pale-highlight pixels.
const PALETTE = Object.entries(tokens.colors).map(([name, hex]) => {
  const [r, g, b] = hexToRgb(hex);
  return { name, hex, rgb: [r, g, b], lab: rgbToLab(r, g, b) };
});

const INK = (() => {
  const [r, g, b] = hexToRgb(tokens.colors.ink);
  return { r, g, b };
})();

// ---------------------------------------------------------------------------
// Palette snap with a per-RGB cache (images have far fewer distinct colours
// than pixels, so this collapses ~1M deltaE searches to a few thousand).
// ---------------------------------------------------------------------------

const snapCache = new Map();

function snap(r, g, b) {
  const key = (r << 16) | (g << 8) | b;
  const cached = snapCache.get(key);
  if (cached !== undefined) return cached;
  const lab = rgbToLab(r, g, b);
  let best = PALETTE[0];
  let bestD = Infinity;
  for (const p of PALETTE) {
    const d = deltaE2000(lab, p.lab);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  const result = { rgb: best.rgb, delta: bestD };
  snapCache.set(key, result);
  return result;
}

// ---------------------------------------------------------------------------
// Step a — background removal via border flood-fill with a feathered edge.
// ---------------------------------------------------------------------------

function detectBackground(data, W, H, C) {
  // Median of four corner patches — robust to the per-corner variation these
  // AI plates have (the corners here differ by ~10 in each channel).
  const patch = 24;
  const rs = [], gs = [], bs = [];
  const corners = [
    [0, 0],
    [W - patch, 0],
    [0, H - patch],
    [W - patch, H - patch],
  ];
  for (const [cx, cy] of corners) {
    for (let y = cy; y < cy + patch; y++) {
      for (let x = cx; x < cx + patch; x++) {
        const i = (y * W + x) * C;
        rs.push(data[i]);
        gs.push(data[i + 1]);
        bs.push(data[i + 2]);
      }
    }
  }
  const med = (arr) => {
    arr.sort((p, q) => p - q);
    return arr[Math.floor(arr.length / 2)];
  };
  return [med(rs), med(gs), med(bs)];
}

function removeBackground(data, W, H, C) {
  const bg = detectBackground(data, W, H, C);
  const bgLab = rgbToLab(bg[0], bg[1], bg[2]);
  const N = W * H;

  // deltaE to background, cached per colour.
  const bgDeltaCache = new Map();
  const bgDelta = (i) => {
    const r = data[i * C], g = data[i * C + 1], b = data[i * C + 2];
    const key = (r << 16) | (g << 8) | b;
    let d = bgDeltaCache.get(key);
    if (d === undefined) {
      d = deltaE2000(rgbToLab(r, g, b), bgLab);
      bgDeltaCache.set(key, d);
    }
    return d;
  };

  // Flood fill from every border pixel through the OUTER-tolerance region.
  const alpha = new Uint8Array(N).fill(255);
  const inRegion = new Uint8Array(N); // 1 = part of the connected background
  const stack = [];
  const pushIf = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const idx = y * W + x;
    if (inRegion[idx]) return;
    if (bgDelta(idx) <= BG_OUTER_DELTA) {
      inRegion[idx] = 1;
      stack.push(idx);
    }
  };
  for (let x = 0; x < W; x++) {
    pushIf(x, 0);
    pushIf(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    pushIf(0, y);
    pushIf(W - 1, y);
  }
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % W;
    const y = (idx - x) / W;
    pushIf(x - 1, y);
    pushIf(x + 1, y);
    pushIf(x, y - 1);
    pushIf(x, y + 1);
  }

  // Assign opacity across the connected region: fully clear near the bg colour,
  // ramping up to opaque across the anti-aliased edge band.
  let fullyTransparent = 0;
  for (let idx = 0; idx < N; idx++) {
    if (!inRegion[idx]) continue; // interior object pixel — stays opaque
    const d = bgDelta(idx);
    if (d <= BG_INNER_DELTA) {
      alpha[idx] = 0;
      fullyTransparent++;
    } else if (d >= BG_OUTER_DELTA) {
      alpha[idx] = 255;
    } else {
      alpha[idx] = Math.round((255 * (d - BG_INNER_DELTA)) / (BG_OUTER_DELTA - BG_INNER_DELTA));
      if (alpha[idx] === 0) fullyTransparent++;
    }
  }

  return { alpha, bg, fullyTransparent };
}

// ---------------------------------------------------------------------------
// Steps b + c — palette snap and outline normalisation, applied together over
// the visible pixels. Returns drift stats (only meaningful on the full-res
// pass; the post-downscale pass just re-purifies and its stats are ignored).
// ---------------------------------------------------------------------------

function snapAndNormalise(rgba, W, H) {
  const N = W * H;
  let visible = 0;
  let drifted = 0;
  for (let idx = 0; idx < N; idx++) {
    const a = rgba[idx * 4 + 3];
    if (a === 0) continue;
    visible++;
    const r = rgba[idx * 4], g = rgba[idx * 4 + 1], b = rgba[idx * 4 + 2];

    // Outline: near-black pixels become exactly `ink`. Solid ones are pinned to
    // full opacity for a uniform-weight outline; feathered edge pixels keep
    // their ramp so the silhouette edge stays smooth.
    if (Math.max(r, g, b) < OUTLINE_MAX_CHANNEL) {
      rgba[idx * 4] = INK.r;
      rgba[idx * 4 + 1] = INK.g;
      rgba[idx * 4 + 2] = INK.b;
      if (a >= SOLID_ALPHA) rgba[idx * 4 + 3] = 255;
      // near-black originals are, by definition, already ink-ish — not drift
      continue;
    }

    const { rgb, delta } = snap(r, g, b);
    rgba[idx * 4] = rgb[0];
    rgba[idx * 4 + 1] = rgb[1];
    rgba[idx * 4 + 2] = rgb[2];
    if (delta > DRIFT_DELTA) drifted++;
  }
  return { visible, drifted };
}

// ---------------------------------------------------------------------------
// Metrics helpers
// ---------------------------------------------------------------------------

function countDistinctColours(rgba, W, H, onlyVisible) {
  const seen = new Set();
  const N = W * H;
  for (let idx = 0; idx < N; idx++) {
    if (onlyVisible && rgba[idx * 4 + 3] === 0) continue;
    seen.add((rgba[idx * 4] << 16) | (rgba[idx * 4 + 1] << 8) | rgba[idx * 4 + 2]);
  }
  return seen.size;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { data, info } = await sharp(inputPath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = 3;
  const N = W * H;

  const distinctBefore = (() => {
    const seen = new Set();
    for (let i = 0; i < N; i++) {
      seen.add((data[i * C] << 16) | (data[i * C + 1] << 8) | data[i * C + 2]);
    }
    return seen.size;
  })();

  // a. Background removal
  const { alpha, bg, fullyTransparent } = removeBackground(data, W, H, C);

  // Build a full-res RGBA buffer from the 3-channel data + computed alpha.
  const rgba = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    rgba[i * 4] = data[i * C];
    rgba[i * 4 + 1] = data[i * C + 1];
    rgba[i * 4 + 2] = data[i * C + 2];
    rgba[i * 4 + 3] = alpha[i];
  }

  // b + c. Palette snap + outline normalisation (drift measured here)
  const { visible, drifted } = snapAndNormalise(rgba, W, H);

  // d. Downscale, then re-snap + re-normalise (resampling reintroduces
  // off-palette blends, so the shipped file is re-purified after the resize).
  const longEdge = Math.max(W, H);
  const scale = args.size / longEdge;
  const targetW = Math.max(1, Math.round(W * scale));
  const targetH = Math.max(1, Math.round(H * scale));

  const downFloat = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .resize(targetW, targetH, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  const down = Buffer.from(downFloat);
  snapAndNormalise(down, targetW, targetH);

  const distinctAfter = countDistinctColours(down, targetW, targetH, true);

  await sharp(down, { raw: { width: targetW, height: targetH, channels: 4 } })
    .png()
    .toFile(outputPath);

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const driftFraction = visible > 0 ? drifted / visible : 0;
  const transparentPct = ((fullyTransparent / N) * 100).toFixed(1);

  console.log(`\n${args.name}`);
  console.log(`  source            ${W}x${H}  ->  ${targetW}x${targetH}  (long edge ${args.size}px)`);
  console.log(`  background        rgb(${bg[0]}, ${bg[1]}, ${bg[2]}) detected from corners`);
  console.log(`  distinct colours  ${distinctBefore.toLocaleString('en-US')}  ->  ${distinctAfter}`);
  console.log(
    `  transparent       ${fullyTransparent.toLocaleString('en-US')} px  (${transparentPct}% of source) made fully transparent`,
  );
  console.log(
    `  palette drift     ${(driftFraction * 100).toFixed(1)}% of ${visible.toLocaleString('en-US')} visible px moved > ${DRIFT_DELTA} deltaE`,
  );

  if (driftFraction > DRIFT_WARN_FRACTION) {
    console.log('');
    console.warn(
      `  !!  WARNING: ${(driftFraction * 100).toFixed(1)}% of visible pixels drifted more than ` +
        `${(DRIFT_WARN_FRACTION * 100).toFixed(0)}% threshold.\n` +
        `  !!  The source has strayed far from the §3 palette. Prefer REGENERATING this\n` +
        `  !!  asset over correcting it — a snap this heavy is hiding the drift, not fixing it.`,
    );
  }

  console.log(`\n  wrote ${path.relative(REPO_ROOT, outputPath)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
