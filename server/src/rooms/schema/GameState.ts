import { Schema, MapSchema, type } from "@colyseus/schema";

/**
 * A single connected player. Positions are in world units; the client is
 * free to interpret them however it renders. `role` stays empty until a
 * game starts, and `alive` is meaningful only once roles are assigned.
 */
export class Player extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") color = "";
  @type("string") role = "";
  @type("boolean") alive = true;
}

/**
 * Authoritative room state. `phase` drives the overall game flow and starts
 * in the lobby; `hostId` is the session id of the current host (the first
 * player to join, reassigned if they leave).
 */
export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") phase = "lobby";
  @type("string") hostId = "";
}
