import { Schema, MapSchema, type } from "@colyseus/schema";
import { PHASE } from "@foghaven/shared";

/**
 * A single connected player. Positions are in world units; the client is
 * free to interpret them however it renders.
 *
 * NOTE: there is deliberately no `role` field here, and one must never be
 * added. Everything in this schema is broadcast to every client in the room,
 * so a role stored here would be readable by anyone inspecting their own
 * network traffic — secrecy would be a client-side illusion. Roles live in a
 * server-only map on `GameRoom` and are delivered per-client over private
 * messages instead.
 */
export class Player extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") color = "";
  @type("boolean") alive = true;

  /**
   * Sequence number of the last input this player's position reflects. The
   * client uses it to discard acknowledged inputs during reconciliation.
   */
  @type("number") lastSeq = 0;
}

/**
 * Authoritative room state. `phase` drives the overall game flow and starts
 * in the lobby; `hostId` is the session id of the current host (the first
 * player to join, reassigned if they leave).
 */
export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") phase: string = PHASE.LOBBY;
  @type("string") hostId = "";
}
