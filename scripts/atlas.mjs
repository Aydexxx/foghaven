#!/usr/bin/env node
/**
 * Foghaven texture-atlas packer — the last step of the §12.4 workflow.
 *
 * Packs every approved asset in art/approved/ into one or more texture atlas
 * pages under client/public/assets/atlas/, and emits:
 *   - foghaven-<n>.png            the packed sheet(s)
 *   - foghaven-<n>.json           a Phaser JSON-hash atlas per page (runtime)
 *   - client/src/assets/atlasManifest.ts   a typed manifest (compile time)
 *
 * The TypeScript manifest is the point: asset keys become a string-literal
 * union (`AtlasKey`), so a typo in `this.load` or a sprite lookup is a compile
 * error, not a silent missing-texture at runtime.
 *
 * Where both <name>.png and <name>.clean.png exist, the cleaned version wins —
 * the raw approved file is the archive, the .clean.png is what ships.
 *
 * Usage:
 *   node scripts/atlas.mjs        (or: npm run atlas)
 */

import { readdirSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const APPROVED_DIR = path.join(REPO_ROOT, 'art', 'approved');
const ATLAS_DIR = path.join(REPO_ROOT, 'client', 'public', 'assets', 'atlas');
const MANIFEST_PATH = path.join(REPO_ROOT, 'client', 'src', 'assets', 'atlasManifest.ts');
const PAGE_PREFIX = 'foghaven';

const MAX_PAGE = 2048; // max atlas page dimension
const GUTTER = 2; // transparent padding between frames, guards against bleed

// ---------------------------------------------------------------------------
// Collect assets: base-name -> chosen file, preferring <name>.clean.png.
// ---------------------------------------------------------------------------

function collectAssets() {
  if (!existsSync(APPROVED_DIR)) return [];
  const files = readdirSync(APPROVED_DIR).filter((f) => f.endsWith('.png'));
  const byKey = new Map(); // key -> { key, file, clean }
  for (const file of files) {
    const isClean = file.endsWith('.clean.png');
    const key = file.replace(/\.clean\.png$/, '').replace(/\.png$/, '');
    const existing = byKey.get(key);
    if (!existing || (isClean && !existing.clean)) {
      byKey.set(key, { key, file: path.join(APPROVED_DIR, file), clean: isClean });
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Trim each asset to its opaque bounding box (tighter packing), keeping the
// original canvas dimensions + trim offset so anchor maths (§4.3) still works.
// ---------------------------------------------------------------------------

async function measureAsset(asset) {
  const { data, info } = await sharp(asset.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + 3] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  // Fully transparent asset — keep a 1x1 placeholder so nothing crashes.
  if (maxX < 0) {
    return { ...asset, sourceW: W, sourceH: H, trimX: 0, trimY: 0, w: 1, h: 1, empty: true };
  }
  return {
    ...asset,
    sourceW: W,
    sourceH: H,
    trimX: minX,
    trimY: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

// ---------------------------------------------------------------------------
// Shelf packer. Sort tallest-first, lay frames along shelves, wrap to a new
// shelf when the row is full, and start a new page when the page is full.
// Small asset counts don't need MaxRects; shelves waste little here and stay
// easy to reason about.
// ---------------------------------------------------------------------------

function pack(assets) {
  const sorted = [...assets].sort((a, b) => b.h - a.h);
  const pages = [];

  function newPage() {
    const page = { index: pages.length, shelfX: GUTTER, shelfY: GUTTER, shelfH: 0, width: 0, height: 0, frames: [] };
    pages.push(page);
    return page;
  }

  let page = newPage();
  for (const asset of sorted) {
    const fw = asset.w + GUTTER;
    const fh = asset.h + GUTTER;
    if (asset.w + GUTTER * 2 > MAX_PAGE || asset.h + GUTTER * 2 > MAX_PAGE) {
      throw new Error(`Asset "${asset.key}" (${asset.w}x${asset.h}) is larger than the ${MAX_PAGE}px atlas page.`);
    }
    // New shelf if this frame overflows the current row.
    if (page.shelfX + fw > MAX_PAGE) {
      page.shelfY += page.shelfH;
      page.shelfX = GUTTER;
      page.shelfH = 0;
    }
    // New page if this frame overflows the page height.
    if (page.shelfY + fh > MAX_PAGE) {
      page = newPage();
    }
    page.frames.push({ ...asset, x: page.shelfX, y: page.shelfY });
    page.shelfX += fw;
    page.shelfH = Math.max(page.shelfH, fh);
    page.width = Math.max(page.width, page.shelfX);
    page.height = Math.max(page.height, page.shelfY + page.shelfH);
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Render + write
// ---------------------------------------------------------------------------

function ceilPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

async function renderPage(page) {
  // Power-of-two page dimensions — friendlier to GPU texture upload.
  const width = ceilPow2(page.width + GUTTER);
  const height = ceilPow2(page.height + GUTTER);

  const composites = [];
  for (const frame of page.frames) {
    if (frame.empty) continue;
    const region = await sharp(frame.file)
      .ensureAlpha()
      .extract({ left: frame.trimX, top: frame.trimY, width: frame.w, height: frame.h })
      .png()
      .toBuffer();
    composites.push({ input: region, left: frame.x, top: frame.y });
  }

  const pngPath = path.join(ATLAS_DIR, `${PAGE_PREFIX}-${page.index}.png`);
  await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .png()
    .toFile(pngPath);

  return { width, height, pngName: `${PAGE_PREFIX}-${page.index}.png` };
}

function writePhaserJson(page, dims) {
  const frames = {};
  for (const f of page.frames) {
    frames[f.key] = {
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      rotated: false,
      trimmed: f.trimX !== 0 || f.trimY !== 0 || f.w !== f.sourceW || f.h !== f.sourceH,
      spriteSourceSize: { x: f.trimX, y: f.trimY, w: f.w, h: f.h },
      sourceSize: { w: f.sourceW, h: f.sourceH },
    };
  }
  const json = {
    frames,
    meta: {
      app: 'scripts/atlas.mjs',
      image: dims.pngName,
      format: 'RGBA8888',
      size: { w: dims.width, h: dims.height },
      scale: '1',
    },
  };
  writeFileSync(path.join(ATLAS_DIR, `${PAGE_PREFIX}-${page.index}.json`), JSON.stringify(json, null, 2) + '\n');
}

function writeManifest(pages, pageDims) {
  const allFrames = [];
  pages.forEach((page, pageIndex) => {
    for (const f of page.frames) {
      allFrames.push({ pageIndex, f });
    }
  });
  allFrames.sort((a, b) => a.f.key.localeCompare(b.f.key));

  const pageList = pageDims.map((d) => `'${d.pngName}'`).join(', ');

  const frameLines = allFrames
    .map(({ pageIndex, f }) => {
      return (
        `  '${f.key}': { page: ${pageIndex}, x: ${f.x}, y: ${f.y}, w: ${f.w}, h: ${f.h}, ` +
        `trimX: ${f.trimX}, trimY: ${f.trimY}, sourceW: ${f.sourceW}, sourceH: ${f.sourceH} },`
      );
    })
    .join('\n');

  const body = `/**
 * GENERATED FILE — do not hand-edit. Run \`npm run atlas\` to regenerate.
 * Source: art/approved/ (packed by scripts/atlas.mjs).
 *
 * Atlas keys are a string-literal union (\`AtlasKey\`) so a mistyped asset name
 * is a compile error rather than a runtime missing-texture. The runtime sheets
 * and their Phaser JSON live in client/public/assets/atlas/.
 */

export const ATLAS_DIR = 'assets/atlas';

export const ATLAS_PAGES = [${pageList}] as const;
export type AtlasPage = (typeof ATLAS_PAGES)[number];

export interface AtlasFrame {
  /** Index into ATLAS_PAGES. */
  page: number;
  /** Frame position + size within its page, in pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Offset of the trimmed frame within the original source canvas. */
  trimX: number;
  trimY: number;
  /** The original (untrimmed) source canvas size. */
  sourceW: number;
  sourceH: number;
}

export const ATLAS_FRAMES = {
${frameLines}
} as const satisfies Record<string, AtlasFrame>;

export type AtlasKey = keyof typeof ATLAS_FRAMES;
`;

  mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, body);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const assets = collectAssets();
  if (assets.length === 0) {
    console.error(`No approved assets found in ${path.relative(REPO_ROOT, APPROVED_DIR)}. Nothing to pack.`);
    process.exit(1);
  }

  const measured = [];
  for (const asset of assets) measured.push(await measureAsset(asset));

  const pages = pack(measured);

  // Clean out stale pages/json so a rename or removal never leaves an orphan.
  mkdirSync(ATLAS_DIR, { recursive: true });
  for (const file of readdirSync(ATLAS_DIR)) {
    if (file.startsWith(`${PAGE_PREFIX}-`)) rmSync(path.join(ATLAS_DIR, file));
  }

  const pageDims = [];
  for (const page of pages) {
    const dims = await renderPage(page);
    writePhaserJson(page, dims);
    pageDims.push(dims);
  }

  writeManifest(pages, pageDims);

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\nPacked ${measured.length} asset(s) into ${pages.length} page(s):`);
  pages.forEach((page, i) => {
    const cleanCount = page.frames.filter((f) => f.clean).length;
    console.log(`  ${pageDims[i].pngName}  ${pageDims[i].width}x${pageDims[i].height}  (${page.frames.length} frames)`);
    for (const f of page.frames) {
      const src = f.clean ? 'clean' : 'raw';
      console.log(`    ${f.key.padEnd(24)} ${String(f.w).padStart(4)}x${String(f.h).padEnd(4)} @ (${f.x},${f.y})  [${src}]`);
    }
    void cleanCount;
  });
  console.log(`\n  sheets + Phaser JSON -> ${path.relative(REPO_ROOT, ATLAS_DIR)}`);
  console.log(`  typed manifest       -> ${path.relative(REPO_ROOT, MANIFEST_PATH)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
