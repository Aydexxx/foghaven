import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { signToken } from "../auth/token";
import { InMemoryFriendProvider, setFriendProvider } from "../friends/provider";
import { InMemoryPresenceStore, setPresenceStore } from "../presence/presenceStore";
import { createFriendRouter } from "./friendRoutes";

beforeAll(() => {
  // Same reasoning as `authRoutes.test.ts`: the default bcrypt cost is tuned
  // for production, not for seeding a dozen throwaway accounts per test.
  process.env.BCRYPT_COST = "4";
});

let authProvider: InMemoryAuthProvider;
let friendProvider: InMemoryFriendProvider;
let presenceStore: InMemoryPresenceStore;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/friends", createFriendRouter());
  return app;
}

/** Seeds the same account into both providers — auth for tokens/usernames, friends for the graph. */
async function seedUser(username: string, email: string) {
  const stored = await authProvider.seedUser({ username, email });
  friendProvider.registerUser({ id: stored.id, username: stored.username });
  return { id: stored.id, username: stored.username, token: signToken(stored.id) };
}

beforeEach(() => {
  authProvider = new InMemoryAuthProvider();
  setAuthProvider(authProvider);
  friendProvider = new InMemoryFriendProvider();
  setFriendProvider(friendProvider);
  presenceStore = new InMemoryPresenceStore();
  setPresenceStore(presenceStore);
});

describe("auth", () => {
  it("refuses every route without a bearer token", async () => {
    const app = buildApp();
    expect((await request(app).get("/friends")).status).toBe(401);
    expect((await request(app).post("/friends/requests").send({ username: "x" })).status).toBe(401);
  });
});

describe("POST /friends/requests", () => {
  it("sends a request and lists it on both sides", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const bea = await seedUser("Bea", "bea@example.com");
    const app = buildApp();

    const res = await request(app)
      .post("/friends/requests")
      .set("Authorization", `Bearer ${ada.token}`)
      .send({ username: "Bea" });
    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe("PENDING");

    const incoming = await request(app)
      .get("/friends/requests")
      .set("Authorization", `Bearer ${bea.token}`);
    expect(incoming.body.incoming).toHaveLength(1);
    expect(incoming.body.incoming[0].requester.username).toBe("Ada");
  });

  it("404s for an unknown username, 409s for a duplicate", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    await seedUser("Bea", "bea@example.com");
    const app = buildApp();

    const notFound = await request(app)
      .post("/friends/requests")
      .set("Authorization", `Bearer ${ada.token}`)
      .send({ username: "Ghost" });
    expect(notFound.status).toBe(404);

    await request(app)
      .post("/friends/requests")
      .set("Authorization", `Bearer ${ada.token}`)
      .send({ username: "Bea" });
    const dupe = await request(app)
      .post("/friends/requests")
      .set("Authorization", `Bearer ${ada.token}`)
      .send({ username: "Bea" });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error).toBe("already_pending");
  });

  it("403s a request to someone who blocked the caller", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const bea = await seedUser("Bea", "bea@example.com");
    friendProvider.seedBlock(bea.id, ada.id);
    const app = buildApp();

    const res = await request(app)
      .post("/friends/requests")
      .set("Authorization", `Bearer ${ada.token}`)
      .send({ username: "Bea" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("blocked");
  });
});

describe("accept / decline", () => {
  it("accepting a request makes the two friends, visible via GET /friends", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const bea = await seedUser("Bea", "bea@example.com");
    const app = buildApp();

    const sent = await request(app)
      .post("/friends/requests")
      .set("Authorization", `Bearer ${ada.token}`)
      .send({ username: "Bea" });
    const requestId = sent.body.request.id;

    const accept = await request(app)
      .post(`/friends/requests/${requestId}/accept`)
      .set("Authorization", `Bearer ${bea.token}`);
    expect(accept.status).toBe(200);
    expect(accept.body.friend.username).toBe("Ada");

    const list = await request(app).get("/friends").set("Authorization", `Bearer ${ada.token}`);
    expect(list.body.friends).toEqual([{ id: bea.id, username: "Bea", online: false }]);
  });

  it("GET /friends reports online status from the presence store", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const bea = await seedUser("Bea", "bea@example.com");
    friendProvider.seedFriendship(ada.id, bea.id);
    await presenceStore.connect(bea.id);
    const app = buildApp();

    const list = await request(app).get("/friends").set("Authorization", `Bearer ${ada.token}`);
    expect(list.body.friends).toEqual([{ id: bea.id, username: "Bea", online: true }]);
  });

  it("declining removes the pending request without creating a friendship", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const bea = await seedUser("Bea", "bea@example.com");
    const app = buildApp();

    const sent = await request(app)
      .post("/friends/requests")
      .set("Authorization", `Bearer ${ada.token}`)
      .send({ username: "Bea" });
    const requestId = sent.body.request.id;

    const decline = await request(app)
      .post(`/friends/requests/${requestId}/decline`)
      .set("Authorization", `Bearer ${bea.token}`);
    expect(decline.status).toBe(204);

    const list = await request(app).get("/friends").set("Authorization", `Bearer ${ada.token}`);
    expect(list.body.friends).toEqual([]);
  });

  it("404s accepting/declining a request that isn't yours or doesn't exist", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const carl = await seedUser("Carl", "carl@example.com");
    const app = buildApp();

    const missing = await request(app)
      .post("/friends/requests/nope/accept")
      .set("Authorization", `Bearer ${ada.token}`);
    expect(missing.status).toBe(404);

    const bea = await seedUser("Bea", "bea@example.com");
    const sent = await request(app)
      .post("/friends/requests")
      .set("Authorization", `Bearer ${ada.token}`)
      .send({ username: bea.username });
    const requestId = sent.body.request.id;

    const forbidden = await request(app)
      .post(`/friends/requests/${requestId}/accept`)
      .set("Authorization", `Bearer ${carl.token}`);
    expect(forbidden.status).toBe(403);
  });
});

describe("DELETE /friends/:userId", () => {
  it("removes an existing friendship", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const bea = await seedUser("Bea", "bea@example.com");
    friendProvider.seedFriendship(ada.id, bea.id);
    const app = buildApp();

    const res = await request(app)
      .delete(`/friends/${bea.id}`)
      .set("Authorization", `Bearer ${ada.token}`);
    expect(res.status).toBe(204);
    expect(await friendProvider.areFriends(ada.id, bea.id)).toBe(false);
  });

  it("404s when there is nothing to remove", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const app = buildApp();
    const res = await request(app)
      .delete("/friends/nobody")
      .set("Authorization", `Bearer ${ada.token}`);
    expect(res.status).toBe(404);
  });
});

describe("blocking", () => {
  it("blocks by username, then lists and unblocks", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const bea = await seedUser("Bea", "bea@example.com");
    const app = buildApp();

    const block = await request(app)
      .post("/friends/blocked")
      .set("Authorization", `Bearer ${ada.token}`)
      .send({ username: "Bea" });
    expect(block.status).toBe(200);

    const listed = await request(app)
      .get("/friends/blocked")
      .set("Authorization", `Bearer ${ada.token}`);
    expect(listed.body.blocked).toEqual([{ id: bea.id, username: "Bea" }]);

    const unblock = await request(app)
      .delete(`/friends/blocked/${bea.id}`)
      .set("Authorization", `Bearer ${ada.token}`);
    expect(unblock.status).toBe(204);

    const after = await request(app)
      .get("/friends/blocked")
      .set("Authorization", `Bearer ${ada.token}`);
    expect(after.body.blocked).toEqual([]);
  });

  it("blocking a friend severs the friendship", async () => {
    const ada = await seedUser("Ada", "ada@example.com");
    const bea = await seedUser("Bea", "bea@example.com");
    friendProvider.seedFriendship(ada.id, bea.id);
    const app = buildApp();

    await request(app)
      .post("/friends/blocked")
      .set("Authorization", `Bearer ${ada.token}`)
      .send({ username: "Bea" });

    expect(await friendProvider.areFriends(ada.id, bea.id)).toBe(false);
  });
});
