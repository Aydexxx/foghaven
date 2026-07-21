import { describe, expect, it } from "vitest";
import {
  GRID_COLS,
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

  it("keeps the whole lobby spawn zone walkable", () => {
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
