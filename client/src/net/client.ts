import { Client, type Room } from "colyseus.js";
import {
  JOIN_ERROR,
  type AbilityStateMessage,
  type ClientTask,
  type RoleAssignment,
  type TasksMessage,
} from "@foghaven/shared";
import type { GameState } from "./types";
import { saveSession } from "./session";

/** Room name registered on the server (see server `gameServer.define("game", ...)`). */
const ROOM_NAME = "game";

const serverUrl = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export const client = new Client(serverUrl);

/**
 * Always creates a brand new room, never joins an existing one. `authToken` is
 * the signed-in user's token (null for a guest — but the server rejects a guest
 * CREATE, and the UI hides this path from guests, so `authToken` is expected
 * here). The `intent` tells the server this is a create, which is what the
 * guest-cannot-create rule keys off.
 */
export async function createRoom(
  name: string,
  authToken: string | null,
): Promise<Room<GameState>> {
  const room = await client.create<GameState>(ROOM_NAME, {
    name,
    token: authToken ?? undefined,
    intent: "create",
  });
  onConnected(room, name);
  return room;
}

/** Joins an existing room by its code. Rejects if the code doesn't exist. */
export async function joinRoomByCode(
  name: string,
  roomCode: string,
  authToken: string | null,
): Promise<Room<GameState>> {
  const room = await client.joinById<GameState>(roomCode.trim(), {
    name,
    token: authToken ?? undefined,
    intent: "join",
  });
  onConnected(room, name);
  return room;
}

/**
 * Reclaim a seat the server is still holding, using a token from a previous
 * connection. Rejects if the grace period has already closed, the room is
 * gone, or the token has been spent — the caller's job is then to fall back to
 * the main menu.
 */
export async function resumeRoom(token: string, name: string): Promise<Room<GameState>> {
  const room = await client.reconnect<GameState>(token);
  onConnected(room, name);
  return room;
}

/**
 * The reasons a join can fail, as the UI needs to distinguish them. The first
 * three come from the server's own refusal codes; `unknown` covers a bad room
 * code and an unreachable server alike, since from the player's side both mean
 * "that didn't work, check the code".
 */
export type JoinFailure =
  | "full"
  | "inProgress"
  | "banned"
  | "authInvalid"
  | "guestNoCreate"
  | "unknown";

/**
 * Classify a rejected join. Colyseus reports "no such room", "room is locked"
 * and "room is full" with one shared code, which is why the server refuses
 * over-capacity, mid-round, banned, unauthenticated and guest-create joins with
 * codes of its own — see `JOIN_ERROR`.
 */
export function classifyJoinError(error: unknown): JoinFailure {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === JOIN_ERROR.ROOM_FULL) {
    return "full";
  }
  if (code === JOIN_ERROR.IN_PROGRESS) {
    return "inProgress";
  }
  if (code === JOIN_ERROR.BANNED) {
    return "banned";
  }
  if (code === JOIN_ERROR.AUTH_INVALID) {
    return "authInvalid";
  }
  if (code === JOIN_ERROR.GUEST_NO_CREATE) {
    return "guestNoCreate";
  }
  return "unknown";
}

/**
 * The private, per-client messages a player cannot function without: their
 * role, their task list and their ability availability. `abilities` is keyed
 * by ability id rather than a single slot — a role can now have several
 * abilities (Stranger: kill, sabotage, tunnel), each with its own cooldown
 * and uses, tracked independently.
 */
export interface PrivateState {
  role: RoleAssignment | null;
  tasks: ClientTask[] | null;
  abilities: Record<string, AbilityStateMessage>;
}

const privateState = new WeakMap<Room<GameState>, PrivateState>();

/**
 * The private messages this room has delivered so far.
 *
 * This exists because of reconnection specifically. On a fresh join these
 * messages all arrive long after the UI is listening, but a returning player
 * is re-sent everything the instant the server accepts them back — which can
 * land before React has mounted the component that would have listened for it.
 * Capturing them at the connection itself means a component can seed its own
 * initial state from here and never miss a beat.
 */
export function privateStateFor(room: Room<GameState>): PrivateState {
  return privateState.get(room) ?? { role: null, tasks: null, abilities: {} };
}

function onConnected(room: Room<GameState>, name: string): void {
  // Every attach issues a new reconnection token, so this has to run on
  // reconnections too, not just first joins.
  saveSession(room, name);
  capturePrivateState(room);
  exposeForDev(room);
}

/**
 * Attached here, at the connection, rather than in a component — this runs one
 * microtask after the socket is up, a full round trip before the server can
 * deliver anything, so nothing can slip past it.
 */
function capturePrivateState(room: Room<GameState>): void {
  const state: PrivateState = { role: null, tasks: null, abilities: {} };
  privateState.set(room, state);

  room.onMessage<RoleAssignment>("role", (message) => {
    state.role = message;
  });
  room.onMessage<TasksMessage>("tasks", (message) => {
    state.tasks = message.tasks;
  });
  room.onMessage<AbilityStateMessage>("abilityState", (message) => {
    state.abilities[message.abilityId] = message;
  });
}

function exposeForDev(room: Room<GameState>): void {
  if (import.meta.env.DEV) {
    (globalThis as unknown as { __foghavenRoom?: unknown }).__foghavenRoom = room;
  }
}
