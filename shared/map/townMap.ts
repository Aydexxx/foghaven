/**
 * `movement.ts` imports `isWalkableRegion` from here at runtime, so this
 * import must stay type-only — erased at compile time, it creates no runtime
 * cycle even though the two modules depend on each other.
 */
import type { Vec2 } from "../game/movement";

/**
 * Foghaven's town map.
 *
 * Authored as data — a list of rectangles carved into a tile grid — rather
 * than hand-drawn tile-by-tile or in an external editor. The grid built here
 * is the ONE thing both sides of the network boundary render and collide
 * against: the client turns it into a Phaser tilemap, the server (via
 * `isWalkableRegion`, called from `applyInput`) uses the exact same grid to
 * decide whether a move is legal. There is no second copy of the walls to
 * drift out of sync — that drift is exactly what a wall-clipping exploit
 * would live in.
 */

export const TILE_SIZE = 32;
export const GRID_COLS = 48;
export const GRID_ROWS = 44;

export const WORLD_WIDTH = GRID_COLS * TILE_SIZE;
export const WORLD_HEIGHT = GRID_ROWS * TILE_SIZE;

/** Tile kinds. Doubles as the tileset frame index the client renders. */
export const TILE = {
  WALL: 0,
  /** Outdoor plaza floor, and every door/corridor threshold. */
  STREET: 1,
  /** Floor inside a room's four walls. */
  ROOM: 2,
} as const;
export type TileKind = (typeof TILE)[keyof typeof TILE];

/**
 * The ten rooms, keyed by an English slug. Slugs are the wire format (task
 * definitions, the client's room-label lookups); display names live in i18n
 * under `rooms.<slug>` so translation never touches game data.
 */
export const ROOM_SLUGS = [
  "docks",
  "lighthouse",
  "tavern",
  "fishMarket",
  "warehouse",
  "cellar",
  "infirmary",
  "townHall",
  "lampRoom",
  "streets",
] as const;
export type RoomSlug = (typeof ROOM_SLUGS)[number];

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A rectangle carved as one tile kind. Order matters — later rects win. */
interface Carve extends TileRect {
  kind: TileKind;
}

function rect(x: number, y: number, w: number, h: number): TileRect {
  return { x, y, w, h };
}

/** The rect shrunk by one tile on every side — a room's outer footprint to its interior floor. */
function inset(r: TileRect): TileRect {
  return { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 };
}

function center(r: TileRect): Vec2 {
  return {
    x: (r.x + r.w / 2) * TILE_SIZE,
    y: (r.y + r.h / 2) * TILE_SIZE,
  };
}

// ---------------------------------------------------------------------------
// Layout
//
// A big open plaza (the Streets) forms the main loop: it has no walls of its
// own, so walking around Town Hall — the one building sitting inside it — is
// already two routes between anything on opposite sides. Eight further rooms
// hang off the plaza's four edges, each through its own door. Three of those
// connections are narrowed into chokepoints: the Docks<->Fish Market alley
// (a shortcut that bypasses the plaza entirely), the Warehouse->Cellar
// tunnel joint, and the long buried tunnel that continues from the Cellar
// all the way back to the Tavern — which is what keeps the Cellar from being
// a dead end. Chokepoints are still two tiles wide, not one: a corridor
// exactly as wide as a player is unplayable, since the player's own bounding
// box would have to sit pixel-perfect centered to avoid clipping a wall on
// every step.
// ---------------------------------------------------------------------------

const PLAZA = rect(10, 9, 28, 24);

const TOWN_HALL_OUTER = rect(20, 14, 8, 6);
const TOWN_HALL_INTERIOR = inset(TOWN_HALL_OUTER);
const TOWN_HALL_DOOR = rect(23, 19, 2, 1);

const LIGHTHOUSE_OUTER = rect(12, 2, 6, 7);
const LIGHTHOUSE_INTERIOR = inset(LIGHTHOUSE_OUTER);
const LIGHTHOUSE_DOOR = rect(14, 8, 2, 1);

const DOCKS_OUTER = rect(20, 2, 8, 7);
const DOCKS_INTERIOR = inset(DOCKS_OUTER);
const DOCKS_PLAZA_DOOR = rect(23, 8, 2, 1);
const DOCKS_ALLEY_DOOR = rect(27, 5, 1, 2);

const FISH_MARKET_OUTER = rect(30, 2, 7, 7);
const FISH_MARKET_INTERIOR = inset(FISH_MARKET_OUTER);
const FISH_MARKET_PLAZA_DOOR = rect(32, 8, 2, 1);
const FISH_MARKET_ALLEY_DOOR = rect(30, 5, 1, 2);

/** Chokepoint: a back alley linking Docks and Fish Market, bypassing the plaza. */
const DOCKS_FISH_MARKET_ALLEY = rect(28, 5, 2, 2);

const INFIRMARY_OUTER = rect(14, 33, 7, 7);
const INFIRMARY_INTERIOR = inset(INFIRMARY_OUTER);
const INFIRMARY_DOOR = rect(16, 33, 2, 1);

const LAMP_ROOM_OUTER = rect(26, 33, 6, 7);
const LAMP_ROOM_INTERIOR = inset(LAMP_ROOM_OUTER);
const LAMP_ROOM_DOOR = rect(28, 33, 2, 1);

const TAVERN_OUTER = rect(2, 14, 8, 9);
const TAVERN_INTERIOR = inset(TAVERN_OUTER);
const TAVERN_PLAZA_DOOR = rect(9, 17, 1, 2);
/** South door onto the tunnel that continues on to the Cellar. */
const TAVERN_TUNNEL_DOOR = rect(5, 22, 2, 1);

const WAREHOUSE_OUTER = rect(38, 12, 8, 9);
const WAREHOUSE_INTERIOR = inset(WAREHOUSE_OUTER);
const WAREHOUSE_PLAZA_DOOR = rect(38, 15, 1, 2);
/** South door onto the tunnel joint down to the Cellar — chokepoint. */
const WAREHOUSE_CELLAR_DOOR = rect(39, 20, 2, 1);

const CELLAR_OUTER = rect(38, 23, 8, 8);
const CELLAR_INTERIOR = inset(CELLAR_OUTER);
const CELLAR_NORTH_DOOR = rect(39, 23, 2, 1);
const CELLAR_SOUTH_DOOR = rect(39, 30, 2, 1);

/** Chokepoint: the tunnel joint directly beneath the Warehouse. */
const WAREHOUSE_CELLAR_TUNNEL = rect(39, 21, 2, 2);

/**
 * The long buried tunnel from the Cellar back to the Tavern — the Cellar's
 * second exit, and what keeps it off the map's short list of dead ends. Runs
 * two tiles wide the whole way, well clear of every room it passes under.
 */
const TUNNEL_SOUTH_LEG = rect(39, 31, 2, 10);
const TUNNEL_CROSS_LEG = rect(5, 40, 36, 2);
const TUNNEL_WEST_LEG = rect(5, 23, 2, 18);

/**
 * Where the emergency bell stands and where a meeting teleports everyone —
 * in the open plaza just south of Town Hall's door, with clear space in
 * every direction for a `MEETING_SPAWN_RADIUS` circle of players.
 */
export const TOWN_HALL_POINT: Vec2 = { x: 23.5 * TILE_SIZE, y: 24 * TILE_SIZE };

/**
 * Every door tile-rect, keyed by the room it belongs to — for the Saboteur's
 * `lock_door` ability. Reuses the exact rects the tile grid was already
 * carved from above; there is no second copy of "where a door is" to drift
 * out of sync with the walkable grid.
 */
const ROOM_DOORS: Partial<Record<RoomSlug, TileRect[]>> = {
  townHall: [TOWN_HALL_DOOR],
  lighthouse: [LIGHTHOUSE_DOOR],
  docks: [DOCKS_PLAZA_DOOR, DOCKS_ALLEY_DOOR],
  fishMarket: [FISH_MARKET_PLAZA_DOOR, FISH_MARKET_ALLEY_DOOR],
  infirmary: [INFIRMARY_DOOR],
  lampRoom: [LAMP_ROOM_DOOR],
  tavern: [TAVERN_PLAZA_DOOR, TAVERN_TUNNEL_DOOR],
  warehouse: [WAREHOUSE_PLAZA_DOOR, WAREHOUSE_CELLAR_DOOR],
  cellar: [CELLAR_NORTH_DOOR, CELLAR_SOUTH_DOOR],
};

/**
 * Whether a world point falls inside one of a locked room's door tiles — the
 * Saboteur's `lock_door` effect. Pure and side-effect free: both
 * `applyInputWithLocks` (client prediction and server simulation alike) call
 * this identically, so a door is either passable or not for everyone at once.
 */
export function isPointInLockedDoor(
  x: number,
  y: number,
  lockedRoomSlugs: readonly string[],
): boolean {
  if (lockedRoomSlugs.length === 0) {
    return false;
  }
  const col = Math.floor(x / TILE_SIZE);
  const row = Math.floor(y / TILE_SIZE);
  for (const slug of lockedRoomSlugs) {
    const doors = ROOM_DOORS[slug as RoomSlug];
    if (!doors) {
      continue;
    }
    for (const door of doors) {
      if (containsPoint(door, col, row)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The two ends of the buried Cellar<->Tavern tunnel — the Stranger's `tunnel`
 * ability teleports between these. Anchored on the two doors that already
 * bound the walkable corridor above, so there is no new geometry to keep in
 * sync with the tile grid.
 */
export const TUNNEL_ENDPOINTS = {
  cellar: center(CELLAR_SOUTH_DOOR),
  tavern: center(TAVERN_TUNNEL_DOOR),
} as const;

/**
 * The two repair points a critical sabotage (Lighthouse failure/flooding)
 * needs fixed before its countdown runs out — opposite corners of the
 * Lighthouse's interior, far enough apart (comfortably more than
 * `REPAIR_RANGE`) that standing at one is never in range of the other. Both
 * must be repaired; nobody can single-handedly stand in the middle and fix
 * them together.
 */
export const CRITICAL_REPAIR_POINTS = {
  north: { x: 14.5 * TILE_SIZE, y: 4.5 * TILE_SIZE },
  south: { x: 15.5 * TILE_SIZE, y: 6.5 * TILE_SIZE },
} as const;

/** A critical repair point's id — the wire format for `repair_critical`. */
export type CriticalRepairPointId = keyof typeof CRITICAL_REPAIR_POINTS;

/**
 * The rectangle `randomSpawn` draws lobby positions from: open plaza floor,
 * clear of Town Hall's footprint and every door threshold, so every point in
 * it is walkable by construction and needs no rejection sampling.
 */
export const SPAWN_ZONE = rect(12, 21, 24, 10);

/**
 * Every room's OUTER footprint (walls included), for `roomSlugAt` — point-
 * in-rect containment wants the full building, not just its interior floor,
 * so a player standing in a doorway still reads as "inside" the room they're
 * entering rather than falling back to the street between one tile and the
 * next.
 */
const ROOM_OUTER_RECTS: Record<Exclude<RoomSlug, "streets">, TileRect> = {
  townHall: TOWN_HALL_OUTER,
  lighthouse: LIGHTHOUSE_OUTER,
  docks: DOCKS_OUTER,
  fishMarket: FISH_MARKET_OUTER,
  infirmary: INFIRMARY_OUTER,
  lampRoom: LAMP_ROOM_OUTER,
  tavern: TAVERN_OUTER,
  warehouse: WAREHOUSE_OUTER,
  cellar: CELLAR_OUTER,
};

function containsPoint(r: TileRect, col: number, row: number): boolean {
  return col >= r.x && col < r.x + r.w && row >= r.y && row < r.y + r.h;
}

/**
 * Which room a world point falls inside — for ambience mixing, which is the
 * one thing in this file driven by *sound* rather than collision or line of
 * sight. Falls back to `"streets"` for the plaza, every corridor and every
 * tunnel: none of those have their own footprint, they're just the absence
 * of a building.
 */
export function roomSlugAt(x: number, y: number): RoomSlug {
  const col = Math.floor(x / TILE_SIZE);
  const row = Math.floor(y / TILE_SIZE);
  for (const slug of Object.keys(ROOM_OUTER_RECTS) as Array<keyof typeof ROOM_OUTER_RECTS>) {
    if (containsPoint(ROOM_OUTER_RECTS[slug], col, row)) {
      return slug;
    }
  }
  return "streets";
}

const CARVES: Carve[] = [
  { ...PLAZA, kind: TILE.STREET },

  { ...TOWN_HALL_OUTER, kind: TILE.WALL },
  { ...TOWN_HALL_INTERIOR, kind: TILE.ROOM },
  { ...TOWN_HALL_DOOR, kind: TILE.STREET },

  { ...LIGHTHOUSE_INTERIOR, kind: TILE.ROOM },
  { ...LIGHTHOUSE_DOOR, kind: TILE.STREET },

  { ...DOCKS_INTERIOR, kind: TILE.ROOM },
  { ...DOCKS_PLAZA_DOOR, kind: TILE.STREET },
  { ...DOCKS_ALLEY_DOOR, kind: TILE.STREET },

  { ...FISH_MARKET_INTERIOR, kind: TILE.ROOM },
  { ...FISH_MARKET_PLAZA_DOOR, kind: TILE.STREET },
  { ...FISH_MARKET_ALLEY_DOOR, kind: TILE.STREET },

  { ...DOCKS_FISH_MARKET_ALLEY, kind: TILE.STREET },

  { ...INFIRMARY_INTERIOR, kind: TILE.ROOM },
  { ...INFIRMARY_DOOR, kind: TILE.STREET },

  { ...LAMP_ROOM_INTERIOR, kind: TILE.ROOM },
  { ...LAMP_ROOM_DOOR, kind: TILE.STREET },

  { ...TAVERN_INTERIOR, kind: TILE.ROOM },
  { ...TAVERN_PLAZA_DOOR, kind: TILE.STREET },
  { ...TAVERN_TUNNEL_DOOR, kind: TILE.STREET },

  { ...WAREHOUSE_INTERIOR, kind: TILE.ROOM },
  { ...WAREHOUSE_PLAZA_DOOR, kind: TILE.STREET },
  { ...WAREHOUSE_CELLAR_DOOR, kind: TILE.STREET },

  { ...CELLAR_INTERIOR, kind: TILE.ROOM },
  { ...CELLAR_NORTH_DOOR, kind: TILE.STREET },
  { ...CELLAR_SOUTH_DOOR, kind: TILE.STREET },

  { ...WAREHOUSE_CELLAR_TUNNEL, kind: TILE.STREET },
  { ...TUNNEL_SOUTH_LEG, kind: TILE.STREET },
  { ...TUNNEL_CROSS_LEG, kind: TILE.STREET },
  { ...TUNNEL_WEST_LEG, kind: TILE.STREET },
];

function buildGrid(): TileKind[][] {
  const grid: TileKind[][] = Array.from({ length: GRID_ROWS }, () =>
    Array.from({ length: GRID_COLS }, () => TILE.WALL),
  );

  for (const carve of CARVES) {
    for (let row = carve.y; row < carve.y + carve.h; row++) {
      for (let col = carve.x; col < carve.x + carve.w; col++) {
        if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
          grid[row]![col] = carve.kind;
        }
      }
    }
  }

  return grid;
}

/**
 * Built once at module load — the grid is static data, and every collision
 * check and render both need it, so there is nothing to gain from rebuilding
 * it per call.
 */
export const TOWN_GRID: TileKind[][] = buildGrid();

/**
 * Flat, row-major tile indices for a Phaser tilemap (`this.make.tilemap({
 * data, tileWidth, tileHeight })` wants exactly this shape). The values are
 * the same `TILE.*` constants collision uses — index *is* tile kind, so
 * there is only one grid to keep in sync, not two.
 */
export const TILEMAP_DATA: number[][] = TOWN_GRID;

/**
 * The tile kind under a world-space point. Anything off the grid reads as
 * wall, which makes every out-of-bounds query fail closed — for movement
 * ("can't walk there") and for vision ("can't see through there") alike.
 */
export function tileKindAt(x: number, y: number): TileKind {
  const col = Math.floor(x / TILE_SIZE);
  const row = Math.floor(y / TILE_SIZE);
  if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
    return TILE.WALL;
  }
  return TOWN_GRID[row]![col]!;
}

function isWalkableWorldPoint(x: number, y: number): boolean {
  return tileKindAt(x, y) !== TILE.WALL;
}

/**
 * Whether a circular player of the given radius, centered at (cx, cy), fits
 * entirely on floor tiles. Sampling the four corners of its bounding box is
 * exact (not an approximation) because every wall in this map is an
 * axis-aligned rectangle — there is no diagonal geometry a corner sample
 * could miss.
 *
 * This is the one function that decides whether a move is legal, and it is
 * called from `applyInput`, which server and client both run — so a
 * fabricated client position can still smuggle a claimed location, but it
 * can never smuggle passage through a wall the server didn't independently
 * agree was open.
 */
export function isWalkableRegion(cx: number, cy: number, radius: number): boolean {
  return (
    isWalkableWorldPoint(cx - radius, cy - radius) &&
    isWalkableWorldPoint(cx + radius, cy - radius) &&
    isWalkableWorldPoint(cx - radius, cy + radius) &&
    isWalkableWorldPoint(cx + radius, cy + radius)
  );
}

interface RoomInfo {
  slug: RoomSlug;
  /** World-space point to anchor this room's label at. */
  center: Vec2;
}

/** Every room's label anchor, for the client to draw wayfinding signage even before a player has found a task there. */
export const ROOMS: readonly RoomInfo[] = [
  { slug: "lighthouse", center: center(LIGHTHOUSE_INTERIOR) },
  { slug: "docks", center: center(DOCKS_INTERIOR) },
  { slug: "fishMarket", center: center(FISH_MARKET_INTERIOR) },
  { slug: "infirmary", center: center(INFIRMARY_INTERIOR) },
  { slug: "lampRoom", center: center(LAMP_ROOM_INTERIOR) },
  { slug: "tavern", center: center(TAVERN_INTERIOR) },
  { slug: "warehouse", center: center(WAREHOUSE_INTERIOR) },
  { slug: "cellar", center: center(CELLAR_INTERIOR) },
  { slug: "townHall", center: center(TOWN_HALL_INTERIOR) },
  { slug: "streets", center: center(PLAZA) },
];

/**
 * The interior center of each of the eight rooms tasks can be placed in —
 * everything except Town Hall (bell only) and the Streets (transit only).
 * Task positions are derived from this rather than hand-copied so a task can
 * never end up off the walkable grid by a stray number.
 */
export const TASK_ROOM_ANCHOR: Record<
  Exclude<RoomSlug, "townHall" | "streets">,
  Vec2
> = {
  lighthouse: center(LIGHTHOUSE_INTERIOR),
  docks: center(DOCKS_INTERIOR),
  fishMarket: center(FISH_MARKET_INTERIOR),
  infirmary: center(INFIRMARY_INTERIOR),
  lampRoom: center(LAMP_ROOM_INTERIOR),
  tavern: center(TAVERN_INTERIOR),
  warehouse: center(WAREHOUSE_INTERIOR),
  cellar: center(CELLAR_INTERIOR),
};
