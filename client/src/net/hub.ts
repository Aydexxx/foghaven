import type { Room } from "colyseus.js";
import { client } from "./client";

/** Room name registered on the server (see server `gameServer.define("hub", ...)`). */
const ROOM_NAME = "hub";

/**
 * Connect to the always-open social channel — presence and friend invites,
 * separate from (and alongside) whatever `GameRoom` connection may also be
 * open. See `server/src/rooms/HubRoom.ts` for the server side; this mirrors
 * `net/client.ts`'s `createRoom`/`joinRoomByCode` shape, minus the
 * reconnection-token bookkeeping those do — the hub is not something a
 * player ever needs to *resume*, only to reconnect to fresh, which signing
 * back in already triggers.
 */
export async function connectHub(token: string): Promise<Room> {
  return client.joinOrCreate(ROOM_NAME, { token });
}

// --- Message payloads, mirroring `HubRoom`'s `send`/`broadcast` calls ------

export interface FriendOnlineMessage {
  userId: string;
  username: string;
}

export interface FriendOfflineMessage {
  userId: string;
}

export interface FriendInviteMessage {
  fromUserId: string;
  fromUsername: string;
  roomCode: string;
}

export interface FriendRequestMessage {
  requestId: string;
  fromUserId: string;
  fromUsername: string;
}

export interface FriendAcceptedMessage {
  friendUserId: string;
  friendUsername: string;
}

export interface InviteResultMessage {
  toUserId: string;
  delivered: boolean;
  reason?: "blocked" | "not_friends" | "offline";
}

/** Ask the hub to deliver a "come play" toast to a friend, if they're online. */
export function sendInvite(hub: Room, toUserId: string, roomCode: string): void {
  hub.send("invite", { toUserId, roomCode });
}
