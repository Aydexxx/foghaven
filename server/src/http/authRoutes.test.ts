import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { hashPassword } from "../auth/password";
import { signToken } from "../auth/token";
import { RateLimiter } from "../auth/rateLimit";
import { createAuthRouter } from "./authRoutes";

beforeAll(() => {
  process.env.BCRYPT_COST = "4";
});

let provider: InMemoryAuthProvider;

/** Build the same Express surface `index.ts` mounts, but with the in-memory store. */
function buildApp(loginLimiter?: RateLimiter): Express {
  const app = express();
  app.use(express.json());
  app.use("/auth", createAuthRouter(loginLimiter ? { loginLimiter } : {}));
  return app;
}

beforeEach(() => {
  provider = new InMemoryAuthProvider();
  setAuthProvider(provider);
});

describe("POST /auth/register", () => {
  it("creates an account and returns a token + hash-free user", async () => {
    const res = await request(buildApp())
      .post("/auth/register")
      .send({ email: "ada@example.com", username: "Ada", password: "longenough1" });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.username).toBe("Ada");
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("rejects a duplicate username (409) and bad input (400)", async () => {
    const app = buildApp();
    await request(app)
      .post("/auth/register")
      .send({ email: "a@b.com", username: "Taken", password: "longenough1" });

    const dupe = await request(app)
      .post("/auth/register")
      .send({ email: "c@d.com", username: "taken", password: "longenough1" });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error).toBe("username_taken");

    const profane = await request(app)
      .post("/auth/register")
      .send({ email: "e@f.com", username: "shithead", password: "longenough1" });
    expect(profane.status).toBe(400);
    expect(profane.body.error).toBe("profanity");

    const weak = await request(app)
      .post("/auth/register")
      .send({ email: "g@h.com", username: "Fine", password: "short" });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toBe("weak_password");
  });
});

describe("POST /auth/login", () => {
  async function seedActive(): Promise<void> {
    await provider.seedUser({
      username: "Ada",
      email: "ada@example.com",
      passwordHash: await hashPassword("longenough1"),
    });
  }

  it("returns a token for correct credentials, 401 for wrong ones", async () => {
    await seedActive();
    const app = buildApp();

    const ok = await request(app)
      .post("/auth/login")
      .send({ identifier: "ada@example.com", password: "longenough1" });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();

    const bad = await request(app)
      .post("/auth/login")
      .send({ identifier: "ada@example.com", password: "wrong" });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("invalid_credentials");
  });

  it("returns 403 with the reason for a banned account", async () => {
    await provider.seedUser({
      username: "Bad",
      email: "bad@example.com",
      passwordHash: await hashPassword("longenough1"),
      banned: true,
      banReason: "cheating",
    });

    const res = await request(buildApp())
      .post("/auth/login")
      .send({ identifier: "bad@example.com", password: "longenough1" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("banned");
    expect(res.body.ban.reason).toBe("cheating");
  });

  it("rate-limits repeated attempts (429) on the same key", async () => {
    await seedActive();
    // A limiter of 2 attempts so the third is blocked. supertest uses a fresh
    // ephemeral port each request but a stable loopback ip, and the identifier
    // is part of the key, so the same wrong login trips it.
    const app = buildApp(new RateLimiter(2, 60_000));

    const attempt = () =>
      request(app).post("/auth/login").send({ identifier: "ada@example.com", password: "wrong" });

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("rate_limited");
  });

  it("a successful login clears the attempt budget", async () => {
    await seedActive();
    const app = buildApp(new RateLimiter(2, 60_000));

    await request(app).post("/auth/login").send({ identifier: "ada@example.com", password: "no" });
    // Success resets the key...
    const ok = await request(app)
      .post("/auth/login")
      .send({ identifier: "ada@example.com", password: "longenough1" });
    expect(ok.status).toBe(200);
    // ...so a subsequent wrong attempt is not immediately blocked.
    const after = await request(app)
      .post("/auth/login")
      .send({ identifier: "ada@example.com", password: "no" });
    expect(after.status).toBe(401);
  });
});

describe("GET /auth/me", () => {
  it("returns the current user for a valid bearer token, 401 otherwise", async () => {
    const user = await provider.seedUser({ username: "Ada", email: "ada@example.com" });
    const app = buildApp();

    const ok = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${signToken(user.id)}`);
    expect(ok.status).toBe(200);
    expect(ok.body.user.username).toBe("Ada");

    expect((await request(app).get("/auth/me")).status).toBe(401);
    expect(
      (await request(app).get("/auth/me").set("Authorization", "Bearer garbage")).status,
    ).toBe(401);
  });
});
