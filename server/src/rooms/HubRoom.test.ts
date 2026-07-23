import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ColyseusTestServer } from "@colyseus/testing";
import { HubRoom } from "./HubRoom";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { InMemoryFriendProvider, setFriendProvider } from "../friends/provider";
import { InMemoryPresenceStore, setPresenceStore } from "../presence/presenceStore";

let colyseus: ColyseusTestServer;
let authProvider: InMemoryAuthProvider;
let friendProvider: InMemoryFriendProvider;
let presenceStore: InMemoryPresenceStore;

beforeAll(async () => {
  authProvider = new InMemoryAuthProvider();
  setAuthProvider(authProvider);
  friendProvider = new InMemoryFriendProvider();
  setFriendProvider(friendProvider);
  presenceStore = new InMemoryPresenceStore();
  setPresenceStore(presenceStore);

  const gameServer = new Server({ transport: new WebSocketTransport({}) });
  gameServer.define("hub", HubRoom);

  // Same ephemeral-port workaround as `GameRoom.test.ts` — see its own comment.
  await gameServer.listen(0);
  const address = (gameServer.transport.server as import("net").Server).address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  (gameServer as unknown as { port: number }).port = port;

  colyseus = new ColyseusTestServer(gameServer);
});

afterAll(async () => {
  if (colyseus) {
    await colyseus.shutdown();
  }
  setAuthProvider(null);
  setFriendProvider(null);
  setPresenceStore(null);
});

afterEach(async () => {
  await colyseus.cleanup();
});

beforeEach(() => {
  authProvider.reset();
  friendProvider.reset();
});

async function seedUser(username: string, email: string) {
  const stored = await authProvider.seedUser({ username, email });
  friendProvider.registerUser({ id: stored.id, username: stored.username });
  return { id: stored.id, username: stored.username, token: authProvider.tokenFor(stored.id) };
}

function waitForMessage<T>(client: { onMessage: (type: string, cb: (msg: T) => void) => void }, type: string) {
  return new Promise<T>((resolve) => client.onMessage(type, resolve));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("HubRoom auth", () => {
  it("refuses a connection with no token — guests have no account to be social with", async () => {
    const hub = await colyseus.createRoom("hub");
    await expect(colyseus.connectTo(hub, {})).rejects.toBeDefined();
  });

  it("refuses a malformed token the same way", async () => {
    const hub = await colyseus.createRoom("hub");
    await expect(colyseus.connectTo(hub, { token: "not-a-real-jwt" })).rejects.toBeDefined();
  });
});

describe("HubRoom presence", () => {
  it("tells an already-connected friend when the other comes online, and later goes offline", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const bea = await seedUser("Bea", "bea@example.com");
    friendProvider.seedFriendship(ada.id, bea.id);

    const hub = await colyseus.createRoom("hub");
    const adaClient = await colyseus.connectTo(hub, { token: ada.token });

    const onlinePromise = waitForMessage<{ userId: string; username: string }>(
      adaClient,
      "friendOnline",
    );
    const beaClient = await colyseus.connectTo(hub, { token: bea.token });
    const online = await onlinePromise;
    expect(online).toEqual({ userId: bea.id, username: "Bea" });
    expect(await presenceStore.isOnline(bea.id)).toBe(true);

    const offlinePromise = waitForMessage<{ userId: string }>(adaClient, "friendOffline");
    await beaClient.leave();
    const offline = await offlinePromise;
    expect(offline).toEqual({ userId: bea.id });
    expect(await presenceStore.isOnline(bea.id)).toBe(false);
  });

  it("never notifies a non-friend's connections", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const carl = await seedUser("Carl", "carl@example.com");
    // No friendship seeded between Ada and Carl.

    const hub = await colyseus.createRoom("hub");
    const adaClient = await colyseus.connectTo(hub, { token: ada.token });

    let received = false;
    adaClient.onMessage("friendOnline", () => {
      received = true;
    });

    await colyseus.connectTo(hub, { token: carl.token });
    await sleep(50);
    expect(received).toBe(false);
  });
});

describe("HubRoom invites", () => {
  it("delivers an invite to a friend's open connection and acks the sender", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const bea = await seedUser("Bea", "bea@example.com");
    friendProvider.seedFriendship(ada.id, bea.id);

    const hub = await colyseus.createRoom("hub");
    const adaClient = await colyseus.connectTo(hub, { token: ada.token });
    const beaClient = await colyseus.connectTo(hub, { token: bea.token });

    const invitePromise = waitForMessage<{ fromUserId: string; fromUsername: string; roomCode: string }>(
      beaClient,
      "friendInvite",
    );
    const resultPromise = waitForMessage<{ toUserId: string; delivered: boolean }>(
      adaClient,
      "inviteResult",
    );

    adaClient.send("invite", { toUserId: bea.id, roomCode: "abc123" });

    const invite = await invitePromise;
    expect(invite).toEqual({ fromUserId: ada.id, fromUsername: "Ada", roomCode: "ABC123" });
    expect(await resultPromise).toEqual({ toUserId: bea.id, delivered: true });
  });

  it("refuses to deliver between non-friends", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const carl = await seedUser("Carl", "carl@example.com");

    const hub = await colyseus.createRoom("hub");
    const adaClient = await colyseus.connectTo(hub, { token: ada.token });
    await colyseus.connectTo(hub, { token: carl.token });

    const resultPromise = waitForMessage<{ delivered: boolean; reason?: string }>(
      adaClient,
      "inviteResult",
    );
    adaClient.send("invite", { toUserId: carl.id, roomCode: "XYZ999" });
    expect(await resultPromise).toMatchObject({ delivered: false, reason: "not_friends" });
  });

  it("refuses to deliver when either side has blocked the other", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const bea = await seedUser("Bea", "bea@example.com");
    friendProvider.seedFriendship(ada.id, bea.id);
    friendProvider.seedBlock(bea.id, ada.id);

    const hub = await colyseus.createRoom("hub");
    const adaClient = await colyseus.connectTo(hub, { token: ada.token });
    await colyseus.connectTo(hub, { token: bea.token });

    const resultPromise = waitForMessage<{ delivered: boolean; reason?: string }>(
      adaClient,
      "inviteResult",
    );
    adaClient.send("invite", { toUserId: bea.id, roomCode: "XYZ999" });
    expect(await resultPromise).toMatchObject({ delivered: false, reason: "blocked" });
  });

  it("reports an offline friend rather than silently dropping the invite", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const bea = await seedUser("Bea", "bea@example.com");
    friendProvider.seedFriendship(ada.id, bea.id);
    // Bea is a friend but never connects to the hub.

    const hub = await colyseus.createRoom("hub");
    const adaClient = await colyseus.connectTo(hub, { token: ada.token });

    const resultPromise = waitForMessage<{ delivered: boolean; reason?: string }>(
      adaClient,
      "inviteResult",
    );
    adaClient.send("invite", { toUserId: bea.id, roomCode: "XYZ999" });
    expect(await resultPromise).toMatchObject({ delivered: false, reason: "offline" });
  });
});
