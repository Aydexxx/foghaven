import { Client, type Room } from "colyseus.js";
import type { GameState } from "./types";

/** Room name registered on the server (see server `gameServer.define("game", ...)`). */
const ROOM_NAME = "game";

const serverUrl = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export const client = new Client(serverUrl);

/** Always creates a brand new room, never joins an existing one. */
export async function createRoom(name: string): Promise<Room<GameState>> {
  const room = await client.create<GameState>(ROOM_NAME, { name });
  exposeForDev(room);
  return room;
}

/** Joins an existing room by its code. Rejects if the code doesn't exist. */
export async function joinRoomByCode(
  name: string,
  roomCode: string,
): Promise<Room<GameState>> {
  const room = await client.joinById<GameState>(roomCode.trim(), { name });
  exposeForDev(room);
  return room;
}

function exposeForDev(room: Room<GameState>): void {
  if (import.meta.env.DEV) {
    (globalThis as unknown as { __foghavenRoom?: unknown }).__foghavenRoom = room;
  }
}
