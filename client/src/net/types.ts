import type { MapSchema, Schema } from "@colyseus/schema";

/**
 * Client-side view of the server's `Player` schema. Extending `Schema` gives
 * us the runtime callback methods colyseus.js attaches to decoded instances
 * (`listen`, `onChange`, ...) without pulling the decorator-based classes into
 * the Vite build. Field names must mirror the server's `Player` schema.
 *
 * There is no `role` here because roles are not public state: the server sends
 * each client its own role over a private message instead. See the `Player`
 * schema on the server.
 */
export interface PlayerState extends Schema {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  alive: boolean;
  lastSeq: number;
}

/** Client-side view of the server's `GameState` schema. */
export interface GameState extends Schema {
  players: MapSchema<PlayerState>;
  phase: string;
  hostId: string;
}
