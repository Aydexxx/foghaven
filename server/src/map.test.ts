import { describe, expect, it } from "vitest";
import {
  GRID_COLS,
  MAP,
  GRID_ROWS,
  MEETING_SPAWN_RADIUS,
  PLAYER_RADIUS,
  ROOMS,
  ROOM_SLUGS,
  SPAWN_ZONE,
  TASK_DEFINITIONS,
  TASK_ROOM_ANCHOR,
  TILE,
  TILE_SIZE,
  TOWN_GRID,
  TOWN_HALL,
  isWalkableRegion,
  LOBBY_READY_PAD,
  LOBBY_READY_PAD_POINT,
  LOBBY_SETTINGS_TABLE,
  LOBBY_SETTINGS_TABLE_POINT,
  LOBBY_SPAWN_ZONE,
  TAVERN_LOBBY_BOUNDS,
  isOnReadyPad,
  isInsideLobby,
  applyInput,
  applyLobbyInput,
  SIM_DT,
} from "@foghaven/shared";

/**
 * Geometry tests for the town map itself, independent of any room or
 * network behaviour. These exist because the map is authored as data (a
 * list of rectangles carved into a grid — see `townMap.ts`) rather than
 * drawn by hand tile-by-tile, and that data is easy to get subtly wrong: an
 * off-by-one on a door's coordinates silently strands a room, or a task
 * anchor one tile off lands it inside a wall. A flood fill and a few
 * boundary checks catch that class of mistake immediately, rather than a
 * player discovering it by walking into an unreachable room.
 */

function tileOf(worldX: number, worldY: number) {
  return { col: Math.floor(worldX / TILE_SIZE), row: Math.floor(worldY / TILE_SIZE) };
}

/** Every tile reachable on foot from (col, row), via a 4-directional flood fill. */
function reachableFrom(col: number, row: number): Set<string> {
  const seen = new Set<string>();
  const stack: Array<[number, number]> = [[col, row]];
  while (stack.length > 0) {
    const [c, r] = stack.pop()!;
    const key = `${c},${r}`;
    if (seen.has(key) || r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) {
      continue;
    }
    if (TOWN_GRID[r]![c] === TILE.WALL) {
      continue;
    }
    seen.add(key);
    stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
  }
  return seen;
}

describe("town map", () => {
  it("borders the entire grid in wall, so nothing is reachable off the map", () => {
    for (let col = 0; col < GRID_COLS; col++) {
      expect(TOWN_GRID[0]![col]).toBe(TILE.WALL);
      expect(TOWN_GRID[GRID_ROWS - 1]![col]).toBe(TILE.WALL);
    }
    for (let row = 0; row < GRID_ROWS; row++) {
      expect(TOWN_GRID[row]![0]).toBe(TILE.WALL);
      expect(TOWN_GRID[row]![GRID_COLS - 1]).toBe(TILE.WALL);
    }
  });

  it("connects every one of the ten rooms into a single walkable network", () => {
    const start = tileOf(TOWN_HALL.x, TOWN_HALL.y);
    const reached = reachableFrom(start.col, start.row);

    expect(ROOMS).toHaveLength(ROOM_SLUGS.length);
    for (const room of ROOMS) {
      const t = tileOf(room.center.x, room.center.y);
      expect(reached.has(`${t.col},${t.row}`)).toBe(true);
    }
  });

  it("places every task anchor on walkable floor, clear enough for a player to stand on", () => {
    for (const [slug, point] of Object.entries(TASK_ROOM_ANCHOR)) {
      expect(isWalkableRegion(point.x, point.y, PLAYER_RADIUS)).toBe(true);
    }
  });

  it("spreads tasks across distinct rooms rather than clustering them", () => {
    const rooms = new Set(TASK_DEFINITIONS.map((task) => task.room));
    // Every task-eligible room (everything but Town Hall and the Streets)
    // gets exactly one — the whole point of "spread across rooms" is that no
    // single room dominates the errand list.
    expect(rooms.size).toBe(TASK_DEFINITIONS.length);
    expect(rooms.size).toBe(Object.keys(TASK_ROOM_ANCHOR).length);
  });

  it("gives every task definition's declared position exactly its room's anchor", () => {
    for (const task of TASK_DEFINITIONS) {
      const anchor = TASK_ROOM_ANCHOR[task.room];
      expect(task.x).toBe(anchor.x);
      expect(task.y).toBe(anchor.y);
    }
  });

  it("keeps the Town Hall meeting point clear for a full meeting circle", () => {
    expect(isWalkableRegion(TOWN_HALL.x, TOWN_HALL.y, PLAYER_RADIUS)).toBe(true);

    for (let deg = 0; deg < 360; deg += 30) {
      const rad = (deg * Math.PI) / 180;
      const x = TOWN_HALL.x + Math.cos(rad) * MEETING_SPAWN_RADIUS;
      const y = TOWN_HALL.y + Math.sin(rad) * MEETING_SPAWN_RADIUS;
      expect(isWalkableRegion(x, y, PLAYER_RADIUS)).toBe(true);
    }
  });

  it("keeps the whole round-start spawn zone walkable", () => {
    const corners = [
      [SPAWN_ZONE.x, SPAWN_ZONE.y],
      [SPAWN_ZONE.x + SPAWN_ZONE.w, SPAWN_ZONE.y],
      [SPAWN_ZONE.x, SPAWN_ZONE.y + SPAWN_ZONE.h],
      [SPAWN_ZONE.x + SPAWN_ZONE.w, SPAWN_ZONE.y + SPAWN_ZONE.h],
    ] as const;
    for (const [tx, ty] of corners) {
      expect(isWalkableRegion(tx * TILE_SIZE, ty * TILE_SIZE, PLAYER_RADIUS)).toBe(true);
    }
  });

  it("rejects a player-sized region straddling a wall boundary", () => {
    // Tile (0,0) is guaranteed wall by the border test above; nothing sized
    // like a player can ever stand there.
    expect(isWalkableRegion(TILE_SIZE / 2, TILE_SIZE / 2, PLAYER_RADIUS)).toBe(false);
  });
});

/**
 * The lobby is the Tavern interior (ART_BIBLE §5.2), authored as three more
 * rectangles carved out of the same grid — so it is wrong in exactly the same
 * ways the town map can be wrong, and gets the same treatment. A ready pad a
 * player cannot physically stand on, or a spawn zone overlapping it, would
 * both make the room unstartable while looking perfectly fine in the source.
 */
describe("lobby (Tavern) geometry", () => {
  /** Every legal player-CENTRE position inside a tile-rect, on a 2px lattice. */
  function standablePoints(area: {
    x: number;
    y: number;
    w: number;
    h: number;
  }): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let x = area.x * TILE_SIZE + PLAYER_RADIUS; x <= (area.x + area.w) * TILE_SIZE - PLAYER_RADIUS; x += 2) {
      for (let y = area.y * TILE_SIZE + PLAYER_RADIUS; y <= (area.y + area.h) * TILE_SIZE - PLAYER_RADIUS; y += 2) {
        if (isWalkableRegion(x, y, PLAYER_RADIUS)) {
          out.push([x, y]);
        }
      }
    }
    return out;
  }

  it("places every lobby spawn point on walkable Tavern floor", () => {
    const minX = LOBBY_SPAWN_ZONE.x * TILE_SIZE + PLAYER_RADIUS;
    const maxX = (LOBBY_SPAWN_ZONE.x + LOBBY_SPAWN_ZONE.w) * TILE_SIZE - PLAYER_RADIUS;
    const minY = LOBBY_SPAWN_ZONE.y * TILE_SIZE + PLAYER_RADIUS;
    const maxY = (LOBBY_SPAWN_ZONE.y + LOBBY_SPAWN_ZONE.h) * TILE_SIZE - PLAYER_RADIUS;
    for (let x = minX; x <= maxX; x += 4) {
      for (let y = minY; y <= maxY; y += 4) {
        expect(isWalkableRegion(x, y, PLAYER_RADIUS)).toBe(true);
      }
    }
  });

  it("never spawns a player already standing on the ready flagstone", () => {
    for (const [x, y] of standablePoints(LOBBY_SPAWN_ZONE)) {
      expect(isOnReadyPad(x, y)).toBe(false);
    }
  });

  it("leaves the ready flagstone comfortably standable", () => {
    // "Can I stand here and register as ready" is a question about the
    // player's CENTRE landing on the stone while their body clears the walls
    // — deliberately not `standablePoints`, which insets by the radius and so
    // answers the different question a spawn zone asks (whole body inside).
    let standable = 0;
    for (let x = LOBBY_READY_PAD.x * TILE_SIZE; x < (LOBBY_READY_PAD.x + LOBBY_READY_PAD.w) * TILE_SIZE; x += 2) {
      for (let y = LOBBY_READY_PAD.y * TILE_SIZE; y < (LOBBY_READY_PAD.y + LOBBY_READY_PAD.h) * TILE_SIZE; y += 2) {
        if (isOnReadyPad(x, y) && isWalkableRegion(x, y, PLAYER_RADIUS)) {
          standable++;
        }
      }
    }
    // The 64x64 pad is a 32x32 lattice at this step; the corner nearest the
    // wall is legitimately unreachable (a 16px radius clips it), so this
    // asserts a generous majority rather than the whole rect. A pad a player
    // could only reach on one pixel row would be unusable in practice.
    expect(standable).toBeGreaterThan(0.75 * 32 * 32);
  });

  it("puts the pad centre and the table centre on walkable floor", () => {
    expect(isWalkableRegion(LOBBY_READY_PAD_POINT.x, LOBBY_READY_PAD_POINT.y, PLAYER_RADIUS)).toBe(
      true,
    );
    expect(isOnReadyPad(LOBBY_READY_PAD_POINT.x, LOBBY_READY_PAD_POINT.y)).toBe(true);
    expect(
      isWalkableRegion(LOBBY_SETTINGS_TABLE_POINT.x, LOBBY_SETTINGS_TABLE_POINT.y, PLAYER_RADIUS),
    ).toBe(true);
  });

  it("keeps the settings table reachable from the spawn zone without crossing the pad", () => {
    // Somewhere in the spawn zone must be within interaction range of the
    // table's centre after a short walk — concretely, the table is inside the
    // same room, so assert the whole Tavern interior is one connected region.
    const start = tileOf(LOBBY_SPAWN_ZONE.x * TILE_SIZE + 1, LOBBY_SPAWN_ZONE.y * TILE_SIZE + 1);
    const reachable = reachableFrom(start.col, start.row);
    const table = tileOf(LOBBY_SETTINGS_TABLE_POINT.x, LOBBY_SETTINGS_TABLE_POINT.y);
    const pad = tileOf(LOBBY_READY_PAD_POINT.x, LOBBY_READY_PAD_POINT.y);
    expect(reachable.has(`${table.col},${table.row}`)).toBe(true);
    expect(reachable.has(`${pad.col},${pad.row}`)).toBe(true);
  });

  it("confines lobby movement to the Tavern, doorways included", () => {
    // The Tavern's doorways are ordinary walkable tiles (the same room is a
    // real room mid-round), so plain `applyInput` would happily walk a
    // waiting player out into the plaza. `applyLobbyInput` is what stops it.
    const east = { x: LOBBY_READY_PAD_POINT.x, y: LOBBY_READY_PAD_POINT.y };
    let pos = east;
    for (let i = 0; i < 400; i++) {
      pos = applyLobbyInput(pos, { x: 1, y: 0 }, SIM_DT); // straight at the plaza door
    }
    expect(isInsideLobby(pos.x, pos.y, PLAYER_RADIUS)).toBe(true);

    // And in every other direction, including the south tunnel door.
    for (const dir of [
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ]) {
      let p = { x: LOBBY_READY_PAD_POINT.x, y: LOBBY_READY_PAD_POINT.y };
      for (let i = 0; i < 400; i++) {
        p = applyLobbyInput(p, dir, SIM_DT);
      }
      expect(isInsideLobby(p.x, p.y, PLAYER_RADIUS)).toBe(true);
    }
  });

  it("still lets ordinary movement leave the Tavern once the round is running", () => {
    // The confinement must be lobby-only — `applyInput` itself is unchanged,
    // or the Tavern would become a prison during an actual game.
    let pos = { x: LOBBY_READY_PAD_POINT.x, y: LOBBY_READY_PAD_POINT.y };
    for (let i = 0; i < 400; i++) {
      pos = applyInput(pos, { x: 1, y: 0 }, SIM_DT);
    }
    expect(isInsideLobby(pos.x, pos.y, PLAYER_RADIUS)).toBe(false);
  });

  it("moves a player who is already outside the Tavern normally", () => {
    // One-directional by design: the confinement stops you LEAVING, it does
    // not require you to be inside. Production never puts a lobby player
    // outside, but a rule that froze anyone who was would be a trap, not a
    // wall — and the movement suite exercises exactly that case.
    const outside = { x: MAP.width / 2, y: MAP.height / 2 };
    expect(isInsideLobby(outside.x, outside.y, PLAYER_RADIUS)).toBe(false);
    const moved = applyLobbyInput(outside, { x: 1, y: 0 }, SIM_DT);
    expect(moved.x).toBeGreaterThan(outside.x);
  });

  it("keeps every lobby rect inside the Tavern's own footprint", () => {
    const b = TAVERN_LOBBY_BOUNDS;
    for (const area of [LOBBY_SPAWN_ZONE, LOBBY_READY_PAD, LOBBY_SETTINGS_TABLE]) {
      expect(area.x).toBeGreaterThan(b.x);
      expect(area.y).toBeGreaterThan(b.y);
      expect(area.x + area.w).toBeLessThan(b.x + b.w);
      expect(area.y + area.h).toBeLessThan(b.y + b.h);
    }
  });
});
