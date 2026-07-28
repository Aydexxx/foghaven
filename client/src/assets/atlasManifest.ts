/**
 * GENERATED FILE — do not hand-edit. Run `npm run atlas` to regenerate.
 * Source: art/approved/ (packed by scripts/atlas.mjs).
 *
 * Atlas keys are a string-literal union (`AtlasKey`) so a mistyped asset name
 * is a compile error rather than a runtime missing-texture. The runtime sheets
 * and their Phaser JSON live in client/public/assets/atlas/.
 */

export const ATLAS_DIR = 'assets/atlas';

export const ATLAS_PAGES = ['foghaven-0.png'] as const;
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
  'character-base-01': { page: 0, x: 52, y: 2, w: 42, h: 65, trimX: 42, trimY: 3, sourceW: 128, sourceH: 70 },
  'character-side-01': { page: 0, x: 2, y: 2, w: 48, h: 66, trimX: 42, trimY: 2, sourceW: 128, sourceH: 70 },
  'cosmetic-hats-01': { page: 0, x: 96, y: 2, w: 116, h: 64, trimX: 7, trimY: 2, sourceW: 128, sourceH: 70 },
} as const satisfies Record<string, AtlasFrame>;

export type AtlasKey = keyof typeof ATLAS_FRAMES;
