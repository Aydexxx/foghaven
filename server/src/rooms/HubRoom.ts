import { Room, ServerError, type Client } from "@colyseus/core";
import { JOIN_ERROR } from "@foghaven/shared";
import { getAuthProvider, type Identity } from "../auth/provider";
import { getFriendProvider } from "../friends/provider";
import { getPresenceStore } from "../presence/presenceStore";
import { hubEvents } from "../presence/hubEvents";
import * as Sentry from "@sentry/node";
import { logger } from "../logger";

export interface HubJoinOptions {
  /** Auth token from login/register — required; guests have no account to be social with. */
  token?: string;
}

/** What a connected socket in this room remembers about itself, set once at `onJoin`. */
interface HubClientData {
  userId: string;
  username: string;
}

/**
 * The always-open social channel a signed-in player holds for as long as
 * they're using the app — connected once right after sign-in
 * (`client/src/App.tsx`) and kept open across every screen after, game
 * rooms included (a `GameRoom` connection is a separate socket entirely).
 * Two jobs, both about the player's standing *friends*, never about any one
 * round: tracking online presence, and delivering "come play" the instant
 * it's sent rather than whenever the recipient next happens to poll — this
 * is the room the "invite a friend" button and the in-game invite toast talk
 * through.
 *
 * No game state lives here — `state` is never set — because nothing here is
 * patched to clients; every message is a one-off event, not a value to keep
 * synchronised.
 *
 * Guests never reach this room: `onAuth` refuses a missing/invalid token
 * unconditionally (`allowGuests: false`). A guest has no account for a
 * friend request to attach to, so there is nothing here for them to do.
 *
 * Single-instance by construction: the client always calls `joinOrCreate`
 * with no filter options, which Colyseus routes to any existing unlocked
 * room of this name before creating a new one — so in the common case
 * everyone lands in the very instance whose `connections` map this class
 * keeps. That map is therefore safe to hold as plain instance state rather
 * than something shared (e.g. via Redis) across processes; correct today
 * because the server is a single process. A second process would need this
 * bridged the same way `presenceStore.ts` bridges online/offline, and
 * `hubEvents` would need to become real pub/sub instead of an in-process
 * `EventEmitter`.
 */
export class HubRoom extends Room {
  /** userId -> every socket that user currently holds open here (multiple tabs/devices). */
  private readonly connections = new Map<string, Set<Client>>();

  private readonly onFriendRequest = (payload: {
    toUserId: string;
    requestId: string;
    fromUserId: string;
    fromUsername: string;
  }): void => {
    this.sendTo(payload.toUserId, "friendRequest", {
      requestId: payload.requestId,
      fromUserId: payload.fromUserId,
      fromUsername: payload.fromUsername,
    });
  };

  private readonly onFriendAccepted = (payload: {
    toUserId: string;
    friendUserId: string;
    friendUsername: string;
  }): void => {
    this.sendTo(payload.toUserId, "friendAccepted", {
      friendUserId: payload.friendUserId,
      friendUsername: payload.friendUsername,
    });
  };

  override onCreate(): void {
    this.onMessage("invite", (client, message) => this.handleInvite(client, message));

    // Bridges the HTTP `/friends` routes' side effects into this room's
    // live sockets — see `presence/hubEvents.ts` for why this can be a
    // plain EventEmitter rather than something process-wide.
    hubEvents.on("friendRequest", this.onFriendRequest);
    hubEvents.on("friendAccepted", this.onFriendAccepted);
  }

  override onDispose(): void {
    hubEvents.off("friendRequest", this.onFriendRequest);
    hubEvents.off("friendAccepted", this.onFriendAccepted);
  }

  /** Same tap point as `GameRoom`'s override — see its doc comment. */
  override onUncaughtException(error: Error, methodName: string): void {
    logger.error({ err: error, methodName, room: "hub" }, "uncaught exception in room lifecycle method");
    Sentry.captureException(error, { tags: { methodName, room: "hub" } });
  }

  override async onAuth(_client: Client, options: HubJoinOptions = {}): Promise<Identity> {
    const auth = await getAuthProvider().authenticate(options.token, { allowGuests: false });
    if (!auth.ok) {
      throw new ServerError(JOIN_ERROR.AUTH_INVALID, "sign in to connect");
    }
    return auth.value;
  }

  override async onJoin(
    client: Client,
    _options: HubJoinOptions = {},
    auth?: Identity,
  ): Promise<void> {
    // `onAuth` above guarantees a real, non-guest identity — `userId` is
    // never null here.
    const userId = auth?.userId as string;
    const username = auth?.username ?? "";
    client.userData = { userId, username } satisfies HubClientData;

    let sockets = this.connections.get(userId);
    if (!sockets) {
      sockets = new Set();
      this.connections.set(userId, sockets);
    }
    sockets.add(client);

    const cameOnline = await getPresenceStore().connect(userId);
    if (cameOnline) {
      await this.notifyFriends(userId, "friendOnline", { userId, username });
    }
  }

  override async onLeave(client: Client): Promise<void> {
    const data = client.userData as HubClientData | undefined;
    if (!data) {
      return;
    }

    const sockets = this.connections.get(data.userId);
    sockets?.delete(client);
    if (sockets && sockets.size === 0) {
      this.connections.delete(data.userId);
    }

    const wentOffline = await getPresenceStore().disconnect(data.userId);
    if (wentOffline) {
      await this.notifyFriends(data.userId, "friendOffline", { userId: data.userId });
    }
  }

  /** Tell whichever of `userId`'s friends are also connected to this instance right now. */
  private async notifyFriends(userId: string, type: string, payload: unknown): Promise<void> {
    const friends = await getFriendProvider().listFriends(userId);
    for (const friend of friends) {
      this.sendTo(friend.id, type, payload);
    }
  }

  private sendTo(userId: string, type: string, payload: unknown): void {
    for (const client of this.connections.get(userId) ?? []) {
      client.send(type, payload);
    }
  }

  /**
   * "Invite a friend" — the realtime half of the growth loop. The other
   * half, an invite *link* someone can paste into Discord, needs no server
   * message at all: it is just the room code in a URL, consumed client-side
   * (see `client/src/App.tsx`'s `?invite=` handling) via the same join path
   * as typing the code in by hand.
   *
   * Requires an accepted friendship both ways: not-yet-friends and blocked
   * are refused identically from the sender's point of view (a distinct
   * error code so the UI can explain which), and a blocked relationship
   * always wins over a stale friendship, though in practice `block()`
   * already deletes any friend row between the two.
   */
  private async handleInvite(
    client: Client,
    message: { toUserId?: unknown; roomCode?: unknown },
  ): Promise<void> {
    const data = client.userData as HubClientData | undefined;
    if (!data) {
      return;
    }
    const toUserId = typeof message.toUserId === "string" ? message.toUserId : "";
    const roomCode =
      typeof message.roomCode === "string" ? message.roomCode.trim().toUpperCase() : "";
    if (!toUserId || !roomCode) {
      return;
    }

    const friends = getFriendProvider();
    if (await friends.isBlocked(data.userId, toUserId)) {
      client.send("inviteResult", { toUserId, delivered: false, reason: "blocked" });
      return;
    }
    if (!(await friends.areFriends(data.userId, toUserId))) {
      client.send("inviteResult", { toUserId, delivered: false, reason: "not_friends" });
      return;
    }

    const recipients = this.connections.get(toUserId);
    if (!recipients || recipients.size === 0) {
      client.send("inviteResult", { toUserId, delivered: false, reason: "offline" });
      return;
    }

    for (const recipient of recipients) {
      recipient.send("friendInvite", {
        fromUserId: data.userId,
        fromUsername: data.username,
        roomCode,
      });
    }
    client.send("inviteResult", { toUserId, delivered: true });
  }
}
