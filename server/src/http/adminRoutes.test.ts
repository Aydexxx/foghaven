import { beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { REPORT_REASON, REPORT_STATUS, USER_ROLE, type UserRole } from "@foghaven/shared";
import { signToken } from "../auth/token";
import { RateLimiter } from "../auth/rateLimit";
import { InMemoryModerationProvider, setModerationProvider } from "../moderation/provider";
import { createAdminRouter } from "./adminRoutes";

let provider: InMemoryModerationProvider;
let seq = 0;

function buildApp(limiter?: RateLimiter): Express {
  const app = express();
  app.use(express.json());
  app.use("/admin", createAdminRouter(limiter ? { limiter } : {}));
  return app;
}

/** Seed an account at a given privilege level and hand back a usable bearer token. */
function seedUser(username: string, role: UserRole = USER_ROLE.PLAYER, banned = false) {
  const id = `u${++seq}`;
  provider.registerUser({ id, username, role, banned });
  return { id, username, role, token: signToken(id) };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  provider = new InMemoryModerationProvider();
  setModerationProvider(provider);
  seq = 0;
});

describe("authorisation — the guard on the whole surface", () => {
  it("refuses every route without a token", async () => {
    const app = buildApp();
    for (const path of ["/admin/me", "/admin/reports", "/admin/users", "/admin/chat?roomCode=AB12CD"]) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  it("refuses a malformed or forged token", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/reports").set(auth("not-a-real-jwt"));
    expect(res.status).toBe(401);
  });

  it("refuses a valid token for an account that no longer exists", async () => {
    const app = buildApp();
    // A correctly signed token for a user the store has never heard of — a
    // deleted account, or a token minted against a different database.
    const res = await request(app).get("/admin/reports").set(auth(signToken("ghost")));
    expect(res.status).toBe(401);
  });

  it("refuses an ordinary player with 403, not 401", async () => {
    const player = seedUser("Ada");
    const res = await request(buildApp()).get("/admin/reports").set(auth(player.token));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("admits a moderator", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const res = await request(buildApp()).get("/admin/me").set(auth(mod.token));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe(USER_ROLE.MODERATOR);
  });

  it("reads the role from the store on every request, never from the token", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const app = buildApp();
    expect((await request(app).get("/admin/reports").set(auth(mod.token))).status).toBe(200);

    // Demoted after the token was minted. The very same token must now fail —
    // this is the whole reason the role is not a token claim.
    await provider.setRole(mod.id, USER_ROLE.PLAYER);
    expect((await request(app).get("/admin/reports").set(auth(mod.token))).status).toBe(403);
  });

  it("refuses a moderator whose own account is banned", async () => {
    const mod = seedUser("Rogue", USER_ROLE.MODERATOR);
    await provider.banUser({
      userId: mod.id,
      issuedById: mod.id,
      reason: "compromised",
      until: null,
    });
    const res = await request(buildApp()).get("/admin/reports").set(auth(mod.token));
    expect(res.status).toBe(403);
  });

  it("lets a moderator back in once an expired ban lapses", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    await provider.banUser({
      userId: mod.id,
      issuedById: mod.id,
      reason: "cooldown",
      until: new Date(Date.now() - 60_000),
    });
    const res = await request(buildApp()).get("/admin/reports").set(auth(mod.token));
    expect(res.status).toBe(200);
  });

  it("rate-limits a hammering admin", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const app = buildApp(new RateLimiter(2, 60_000));
    expect((await request(app).get("/admin/reports").set(auth(mod.token))).status).toBe(200);
    expect((await request(app).get("/admin/reports").set(auth(mod.token))).status).toBe(200);
    const blocked = await request(app).get("/admin/reports").set(auth(mod.token));
    expect(blocked.status).toBe(429);
  });
});

describe("report queue", () => {
  async function seedReport(reportedId: string, reportedName = "Troll") {
    return provider.fileReport({
      reporterId: "reporter",
      reporterName: "Ada",
      reportedId,
      reportedName,
      reason: REPORT_REASON.HARASSMENT,
      note: "was abusive in chat",
      roomCode: "AB12CD",
      chatExcerpt: [{ senderName: "Troll", text: "something nasty", sentAt: "2026-07-22T00:00:00Z" }],
    });
  }

  it("lists open reports with their evidence attached", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const troll = seedUser("Troll");
    await seedReport(troll.id);

    const res = await request(buildApp()).get("/admin/reports").set(auth(mod.token));
    expect(res.status).toBe(200);
    expect(res.body.reports).toHaveLength(1);
    expect(res.body.reports[0].reason).toBe(REPORT_REASON.HARASSMENT);
    expect(res.body.reports[0].chatExcerpt).toHaveLength(1);
  });

  it("filters by status", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const troll = seedUser("Troll");
    const report = await seedReport(troll.id);
    await provider.resolveReport(report.id, mod.id, REPORT_STATUS.DISMISSED, null);
    await seedReport(troll.id);

    const app = buildApp();
    const open = await request(app).get("/admin/reports?status=open").set(auth(mod.token));
    expect(open.body.reports).toHaveLength(1);
    const dismissed = await request(app).get("/admin/reports?status=dismissed").set(auth(mod.token));
    expect(dismissed.body.reports).toHaveLength(1);
  });

  it("resolves a report and records who did it", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const troll = seedUser("Troll");
    const report = await seedReport(troll.id);

    const res = await request(buildApp())
      .post(`/admin/reports/${report.id}/resolve`)
      .set(auth(mod.token))
      .send({ status: REPORT_STATUS.ACTIONED, resolution: "banned for a week" });

    expect(res.status).toBe(200);
    expect(res.body.report.status).toBe(REPORT_STATUS.ACTIONED);
    expect(res.body.report.reviewedById).toBe(mod.id);
    expect(res.body.report.resolution).toBe("banned for a week");
  });

  it("refuses to move a report back to open", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const troll = seedUser("Troll");
    const report = await seedReport(troll.id);

    const res = await request(buildApp())
      .post(`/admin/reports/${report.id}/resolve`)
      .set(auth(mod.token))
      .send({ status: REPORT_STATUS.OPEN });
    expect(res.status).toBe(400);
  });

  it("404s an unknown report", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const res = await request(buildApp())
      .post("/admin/reports/nope/resolve")
      .set(auth(mod.token))
      .send({ status: REPORT_STATUS.DISMISSED });
    expect(res.status).toBe(404);
  });
});

describe("user search and detail", () => {
  it("finds users by partial username", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    seedUser("Trollface");
    seedUser("Innocent");

    const res = await request(buildApp()).get("/admin/users?q=troll").set(auth(mod.token));
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].username).toBe("Trollface");
  });

  it("never exposes a password hash", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    seedUser("Ada");
    const res = await request(buildApp()).get("/admin/users?q=ada").set(auth(mod.token));
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("returns ban history alongside the user", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const troll = seedUser("Troll");
    await provider.banUser({ userId: troll.id, issuedById: mod.id, reason: "spam", until: null });
    await provider.unbanUser(troll.id, mod.id);
    await provider.banUser({ userId: troll.id, issuedById: mod.id, reason: "again", until: null });

    const res = await request(buildApp()).get(`/admin/users/${troll.id}`).set(auth(mod.token));
    expect(res.status).toBe(200);
    expect(res.body.banHistory).toHaveLength(2);
    expect(res.body.user.banned).toBe(true);
  });
});

describe("issuing bans", () => {
  it("bans a player permanently and records the history", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const troll = seedUser("Troll");

    const res = await request(buildApp())
      .post(`/admin/users/${troll.id}/ban`)
      .set(auth(mod.token))
      .send({ reason: "harassment" });

    expect(res.status).toBe(200);
    expect(res.body.user.banned).toBe(true);
    expect(res.body.user.banReason).toBe("harassment");
    expect(res.body.user.banUntil).toBeNull();

    const history = await provider.listBanHistory(troll.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.issuedById).toBe(mod.id);
  });

  it("bans temporarily when given an expiry", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const troll = seedUser("Troll");
    const until = new Date(Date.now() + 86_400_000).toISOString();

    const res = await request(buildApp())
      .post(`/admin/users/${troll.id}/ban`)
      .set(auth(mod.token))
      .send({ reason: "cooling off", until });
    expect(res.status).toBe(200);
    expect(res.body.user.banUntil).toBe(new Date(until).toISOString());
  });

  it("requires a reason and rejects an unparseable expiry", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const troll = seedUser("Troll");
    const app = buildApp();

    const noReason = await request(app)
      .post(`/admin/users/${troll.id}/ban`)
      .set(auth(mod.token))
      .send({ reason: "   " });
    expect(noReason.status).toBe(400);

    const badDate = await request(app)
      .post(`/admin/users/${troll.id}/ban`)
      .set(auth(mod.token))
      .send({ reason: "spam", until: "next tuesday" });
    expect(badDate.status).toBe(400);
  });

  it("unbanning clears the ban and closes out the history entry", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const troll = seedUser("Troll");
    await provider.banUser({ userId: troll.id, issuedById: mod.id, reason: "spam", until: null });

    const res = await request(buildApp())
      .post(`/admin/users/${troll.id}/unban`)
      .set(auth(mod.token));
    expect(res.status).toBe(200);
    expect(res.body.user.banned).toBe(false);
    expect((await provider.listBanHistory(troll.id))[0]!.liftedAt).not.toBeNull();
  });
});

describe("privilege ordering — moderators cannot act sideways or upwards", () => {
  it("a moderator cannot ban another moderator", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const peer = seedUser("Peer", USER_ROLE.MODERATOR);

    const res = await request(buildApp())
      .post(`/admin/users/${peer.id}/ban`)
      .set(auth(mod.token))
      .send({ reason: "disagreement" });
    expect(res.status).toBe(403);
    expect((await provider.getUser(peer.id))!.banned).toBe(false);
  });

  it("a moderator cannot ban an admin", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const admin = seedUser("Boss", USER_ROLE.ADMIN);

    const res = await request(buildApp())
      .post(`/admin/users/${admin.id}/ban`)
      .set(auth(mod.token))
      .send({ reason: "coup" });
    expect(res.status).toBe(403);
  });

  it("nobody can ban themselves, or unban themselves", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const app = buildApp();

    const selfBan = await request(app)
      .post(`/admin/users/${mod.id}/ban`)
      .set(auth(mod.token))
      .send({ reason: "oops" });
    expect(selfBan.status).toBe(403);

    const selfUnban = await request(app).post(`/admin/users/${mod.id}/unban`).set(auth(mod.token));
    expect(selfUnban.status).toBe(403);
  });

  it("an admin can ban a moderator", async () => {
    const admin = seedUser("Boss", USER_ROLE.ADMIN);
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);

    const res = await request(buildApp())
      .post(`/admin/users/${mod.id}/ban`)
      .set(auth(admin.token))
      .send({ reason: "abuse of powers" });
    expect(res.status).toBe(200);
    expect(res.body.user.banned).toBe(true);
  });

  it("an admin cannot ban another admin", async () => {
    const admin = seedUser("Boss", USER_ROLE.ADMIN);
    const peer = seedUser("OtherBoss", USER_ROLE.ADMIN);

    const res = await request(buildApp())
      .post(`/admin/users/${peer.id}/ban`)
      .set(auth(admin.token))
      .send({ reason: "coup" });
    expect(res.status).toBe(403);
  });
});

describe("granting roles is admin-only", () => {
  it("a moderator cannot promote anyone", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const ada = seedUser("Ada");

    const res = await request(buildApp())
      .post(`/admin/users/${ada.id}/role`)
      .set(auth(mod.token))
      .send({ role: USER_ROLE.MODERATOR });
    expect(res.status).toBe(403);
    expect(await provider.getRole(ada.id)).toBe(USER_ROLE.PLAYER);
  });

  it("an admin can promote and demote", async () => {
    const admin = seedUser("Boss", USER_ROLE.ADMIN);
    const ada = seedUser("Ada");
    const app = buildApp();

    const promote = await request(app)
      .post(`/admin/users/${ada.id}/role`)
      .set(auth(admin.token))
      .send({ role: USER_ROLE.MODERATOR });
    expect(promote.status).toBe(200);
    expect(await provider.getRole(ada.id)).toBe(USER_ROLE.MODERATOR);

    await request(app)
      .post(`/admin/users/${ada.id}/role`)
      .set(auth(admin.token))
      .send({ role: USER_ROLE.PLAYER });
    expect(await provider.getRole(ada.id)).toBe(USER_ROLE.PLAYER);
  });

  it("rejects an invented role", async () => {
    const admin = seedUser("Boss", USER_ROLE.ADMIN);
    const ada = seedUser("Ada");

    const res = await request(buildApp())
      .post(`/admin/users/${ada.id}/role`)
      .set(auth(admin.token))
      .send({ role: "superadmin" });
    expect(res.status).toBe(400);
    expect(await provider.getRole(ada.id)).toBe(USER_ROLE.PLAYER);
  });

  it("an admin cannot change their own role", async () => {
    const admin = seedUser("Boss", USER_ROLE.ADMIN);
    const res = await request(buildApp())
      .post(`/admin/users/${admin.id}/role`)
      .set(auth(admin.token))
      .send({ role: USER_ROLE.PLAYER });
    expect(res.status).toBe(403);
  });
});

describe("chat log review", () => {
  it("returns a room's retained chat in the order it was said", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    for (const text of ["first", "second", "third"]) {
      await provider.appendChatLog({
        roomCode: "AB12CD",
        userId: null,
        senderName: "Troll",
        channel: "living",
        text,
        filtered: false,
        sentAt: new Date(),
      });
    }

    const res = await request(buildApp()).get("/admin/chat?roomCode=AB12CD").set(auth(mod.token));
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: { text: string }) => e.text)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("requires a room code", async () => {
    const mod = seedUser("Mod", USER_ROLE.MODERATOR);
    const res = await request(buildApp()).get("/admin/chat").set(auth(mod.token));
    expect(res.status).toBe(400);
  });

  it("is not reachable by a player", async () => {
    const player = seedUser("Ada");
    const res = await request(buildApp()).get("/admin/chat?roomCode=AB12CD").set(auth(player.token));
    expect(res.status).toBe(403);
  });
});

describe("retention", () => {
  it("purges only chat older than the cutoff", async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const recent = new Date();
    for (const [text, sentAt] of [
      ["ancient", old],
      ["fresh", recent],
    ] as const) {
      await provider.appendChatLog({
        roomCode: "AB12CD",
        userId: null,
        senderName: "Ada",
        channel: "living",
        text,
        filtered: false,
        sentAt,
      });
    }

    const deleted = await provider.purgeChatLogsBefore(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    );
    expect(deleted).toBe(1);
    const left = await provider.listChatLog("AB12CD", 100);
    expect(left.map((entry) => entry.text)).toEqual(["fresh"]);
  });
});
