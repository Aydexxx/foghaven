import { Client, type Room } from "colyseus.js";
import type { GameState } from "./types";

/** Room name registered on the server (see server `gameServer.define("game", ...)`). */
const ROOM_NAME = "game";

const serverUrl = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export const client = new Client(serverUrl);

/**
 * Join an existing room by its code, or create/join a shared room when no code
 * is given. Returns the connected room with typed state.
 */
export async function joinGame(
  name: string,
  roomCode?: string,
): Promise<Room<GameState>> {
  const options = { name };
  if (roomCode && roomCode.trim() !== "") {
    return client.joinById<GameState>(roomCode.trim(), options);
  }
  return client.joinOrCreate<GameState>(ROOM_NAME, options);
}
