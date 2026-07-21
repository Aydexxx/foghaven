import { TILE_SIZE, type Vec2 } from "@foghaven/shared";

/**
 * Fixed, decorative light sources dotted around the town — the lighthouse
 * lamp, a couple of tavern windows, and a handful of street lamps in the
 * plaza. Purely cosmetic: `PhaseAtmosphere` uses these to place glow
 * sprites and to thin the fog overlay nearby (see `stampLightBleed` on that
 * class), but nothing about visibility or gameplay reads from this file —
 * which is why it lives under `game/atmosphere/` on the client rather than
 * in `@foghaven/shared` alongside the map data that both sides must agree
 * on. Coordinates are hand-picked tile positions in open plaza/street space,
 * clear of every building footprint in `shared/map/townMap.ts`.
 */

export type LightSourceKind = "lamp" | "window" | "beam";

export interface LightSource {
  kind: LightSourceKind;
  pos: Vec2;
  /** 0xRRGGBB tint for this light's glow. */
  color: number;
}

function tile(col: number, row: number): Vec2 {
  return { x: col * TILE_SIZE, y: row * TILE_SIZE };
}

const WARM_LAMP = 0xffb15c;
const WARM_WINDOW = 0xffc98a;
const BEAM_WHITE = 0xfff3d6;

/** The lighthouse's own lamp, near the top of its tower — see `LIGHTHOUSE_OUTER` in townMap.ts (cols 12-18, rows 2-9). */
export const LIGHTHOUSE_BEAM: LightSource = {
  kind: "beam",
  pos: tile(15.5, 3.5),
  color: BEAM_WHITE,
};

/** A couple of glowing windows along the tavern's plaza-facing (east) wall — see `TAVERN_OUTER` (cols 2-10, rows 14-23). */
export const TAVERN_WINDOWS: LightSource[] = [
  { kind: "window", pos: tile(10.2, 16.5), color: WARM_WINDOW },
  { kind: "window", pos: tile(10.2, 20.5), color: WARM_WINDOW },
];

/** Street lamps in the open plaza, clear of Town Hall's footprint (cols 20-28, rows 14-20). */
export const STREET_LAMPS: LightSource[] = [
  { kind: "lamp", pos: tile(14.5, 12.5), color: WARM_LAMP },
  { kind: "lamp", pos: tile(34.5, 12.5), color: WARM_LAMP },
  { kind: "lamp", pos: tile(14.5, 28.5), color: WARM_LAMP },
  { kind: "lamp", pos: tile(34.5, 28.5), color: WARM_LAMP },
];

export const LIGHT_SOURCES: LightSource[] = [LIGHTHOUSE_BEAM, ...TAVERN_WINDOWS, ...STREET_LAMPS];
