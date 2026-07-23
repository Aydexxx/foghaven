import { beforeAll, describe, expect, it } from "vitest";
import { validateName, containsProfanity } from "@foghaven/shared";
import { hashPassword, verifyPassword } from "./password";
import { signToken, verifyToken } from "./token";
import { isValidEmail, validatePassword } from "./validation";
import { RateLimiter } from "./rateLimit";
import { InMemoryAuthProvider, isBanActive } from "./provider";

// Hashing at the default cost is deliberately slow; the roundtrip is what's
// under test, not the work factor, so drop it for a fast suite.
beforeAll(() => {
  process.env.BCRYPT_COST = "4";
});

describe("password hashing", () => {
  it("hashes to something other than the plaintext and verifies it back", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).not.toBe("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
  });

  it("rejects the wrong password and never throws on a malformed hash", async () => {
    const hash = await hashPassword("sesame-open-now");
    expect(await verifyPassword("not-it", hash)).toBe(false);
    expect(await verifyPassword("anything", "not-a-real-hash")).toBe(false);
  });
});

describe("auth tokens", () => {
  it("round-trips a user id through sign and verify", () => {
    const token = signToken("user_123");
    expect(verifyToken(token)).toEqual({ userId: "user_123" });
  });

  it("rejects a tampered or garbage token", () => {
    const token = signToken("user_123");
    expect(verifyToken(token + "x")).toBeNull();
    expect(verifyToken("clearly.not.a.jwt")).toBeNull();
    expect(verifyToken("")).toBeNull();
  });
});

describe("name validation (shared)", () => {
  it("accepts reasonable names", () => {
    expect(validateName("Ada")).toBeNull();
    expect(validateName("Ada_Lovelace")).toBeNull();
    expect(validateName("player-01")).toBeNull();
  });

  it("rejects the wrong length and bad characters", () => {
    expect(validateName("ab")).toBe("length");
    expect(validateName("a".repeat(21))).toBe("length");
    expect(validateName("bad!name")).toBe("charset");
    expect(validateName("_leading")).toBe("charset");
    expect(validateName("double__sep")).toBe("charset");
  });

  it("catches profanity, including simple leetspeak evasions", () => {
    expect(validateName("shithead")).toBe("profanity");
    expect(containsProfanity("sh1t")).toBe(true);
    expect(containsProfanity("f.u.c.k")).toBe(true);
    expect(containsProfanity("Ada")).toBe(false);
  });
});

describe("credential validation", () => {
  it("judges email shape", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("no-at-sign")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.com")).toBe(false);
  });

  it("enforces the password policy", () => {
    expect(validatePassword("longenough1")).toBeNull();
    expect(validatePassword("short")).toBe("too_short");
    expect(validatePassword("aaaaaaaa")).toBe("too_weak");
    expect(validatePassword("x".repeat(201))).toBe("too_long");
  });
});

describe("rate limiter", () => {
  it("allows up to the max in a window, then blocks until it rolls over", () => {
    const limiter = new RateLimiter(3, 1000);
    const now = 10_000;
    expect(limiter.check("k", now).allowed).toBe(true);
    expect(limiter.check("k", now).allowed).toBe(true);
    expect(limiter.check("k", now).allowed).toBe(true);
    expect(limiter.check("k", now).allowed).toBe(false);
    // A different key has its own budget.
    expect(limiter.check("other", now).allowed).toBe(true);
    // Past the window, the budget resets.
    expect(limiter.check("k", now + 1001).allowed).toBe(true);
  });

  it("clears a key's budget on reset", () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.check("k", 0).allowed).toBe(true);
    expect(limiter.check("k", 0).allowed).toBe(false);
    limiter.reset("k");
    expect(limiter.check("k", 0).allowed).toBe(true);
  });
});

describe("isBanActive", () => {
  it("is true for a permanent ban and a future temporary ban", () => {
    expect(isBanActive({ banned: true, banUntil: null })).toBe(true);
    expect(isBanActive({ banned: true, banUntil: new Date(Date.now() + 60_000) })).toBe(true);
  });

  it("is false when not banned or the temporary ban has expired", () => {
    expect(isBanActive({ banned: false, banUntil: null })).toBe(false);
    expect(isBanActive({ banned: true, banUntil: new Date(Date.now() - 60_000) })).toBe(false);
  });
});

describe("InMemoryAuthProvider (same logic as the real Postgres one)", () => {
  const provider = () => new InMemoryAuthProvider();

  it("registers a user and hands back a token + a hash-free public user", async () => {
    const result = await provider().register({
      email: "Ada@Example.com",
      username: "Ada",
      password: "longenough1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.token).toBeTruthy();
    expect(result.value.user.username).toBe("Ada");
    // Emails are normalized to lowercase; nothing hash-shaped leaks out.
    expect(result.value.user.email).toBe("ada@example.com");
    expect(JSON.stringify(result.value.user)).not.toContain("passwordHash");
    expect(verifyToken(result.value.token)?.userId).toBe(result.value.user.id);
  });

  it("rejects duplicate email or username (case-insensitively), profanity and weak passwords", async () => {
    const p = provider();
    await p.register({ email: "a@b.com", username: "Taken", password: "longenough1" });

    expect((await p.register({ email: "A@B.com", username: "Other", password: "longenough1" })).ok)
      .toBe(false);
    expect((await p.register({ email: "c@d.com", username: "taken", password: "longenough1" })).ok)
      .toBe(false);

    const profane = await p.register({
      email: "e@f.com",
      username: "shithead",
      password: "longenough1",
    });
    expect(profane).toMatchObject({ ok: false, error: "profanity" });

    const weak = await p.register({ email: "g@h.com", username: "Fine", password: "short" });
    expect(weak).toMatchObject({ ok: false, error: "weak_password" });

    const badEmail = await p.register({ email: "nope", username: "Fine2", password: "longenough1" });
    expect(badEmail).toMatchObject({ ok: false, error: "invalid_email" });
  });

  it("logs in by email or username but not with a wrong password", async () => {
    const p = provider();
    await p.register({ email: "ada@x.com", username: "Ada", password: "longenough1" });

    expect((await p.login({ identifier: "ada@x.com", password: "longenough1" })).ok).toBe(true);
    expect((await p.login({ identifier: "ADA", password: "longenough1" })).ok).toBe(true);
    expect(await p.login({ identifier: "ada@x.com", password: "wrong" })).toMatchObject({
      ok: false,
      error: "invalid_credentials",
    });
    // An account that doesn't exist is indistinguishable from a wrong password.
    expect(await p.login({ identifier: "ghost@x.com", password: "whatever" })).toMatchObject({
      ok: false,
      error: "invalid_credentials",
    });
  });

  it("blocks login for a banned account and reports the reason", async () => {
    const p = provider();
    const user = await p.seedUser({
      username: "Bad",
      email: "bad@x.com",
      passwordHash: await hashPassword("longenough1"),
      banned: true,
      banReason: "cheating",
    });
    const result = await p.login({ identifier: "bad@x.com", password: "longenough1" });
    expect(result).toMatchObject({ ok: false, error: "banned" });
    if (result.ok) return;
    expect(result.ban?.reason).toBe("cheating");
    // authenticate (the onAuth path) blocks the same account by token.
    expect(await p.authenticate(signToken(user.id), { allowGuests: true })).toMatchObject({
      ok: false,
      error: "banned",
    });
  });

  it("deleteAccount removes the row on a correct password, refuses on a wrong one", async () => {
    const p = provider();
    const reg = await p.register({ email: "z@x.com", username: "Zed", password: "longenough1" });
    if (!reg.ok) throw new Error("setup");
    const userId = reg.value.user.id;

    const wrong = await p.deleteAccount(userId, "not-the-password");
    expect(wrong).toMatchObject({ ok: false, error: "invalid_password" });
    // Still there — a wrong password must not touch the account.
    expect(await p.getPublicUser(userId)).not.toBeNull();

    const ok = await p.deleteAccount(userId, "longenough1");
    expect(ok).toMatchObject({ ok: true, value: true });
    expect(await p.getPublicUser(userId)).toBeNull();

    // Deleting an id that no longer exists (or never did) reports "not_found".
    expect(await p.deleteAccount(userId, "longenough1")).toMatchObject({
      ok: false,
      error: "not_found",
    });
  });

  it("register succeeds regardless of the consent flags — that gate lives at the HTTP layer", async () => {
    const p = provider();
    const withConsent = await p.register({
      email: "a@a.com",
      username: "Aya",
      password: "longenough1",
      ageConfirmed: true,
      consentAccepted: true,
    });
    expect(withConsent.ok).toBe(true);

    const withoutConsent = await p.register({
      email: "b@b.com",
      username: "Bea",
      password: "longenough1",
    });
    // `register()` itself never refuses on missing consent — see the doc on
    // `RegisterInput.ageConfirmed`. Enforcing that is `authRoutes.ts`'s job.
    expect(withoutConsent.ok).toBe(true);
  });

  it("authenticates a valid token, a guest, and refuses junk", async () => {
    const p = provider();
    const reg = await p.register({ email: "z@x.com", username: "Zed", password: "longenough1" });
    if (!reg.ok) throw new Error("setup");

    expect(await p.authenticate(reg.value.token, { allowGuests: true })).toMatchObject({
      ok: true,
      value: { userId: reg.value.user.id, username: "Zed", isGuest: false },
    });
    // No token + guests allowed → a guest identity.
    expect(await p.authenticate(undefined, { allowGuests: true })).toMatchObject({
      ok: true,
      value: { isGuest: true, userId: null },
    });
    // No token + guests disabled → refused.
    expect(await p.authenticate(undefined, { allowGuests: false })).toMatchObject({
      ok: false,
      error: "auth_invalid",
    });
    // A garbage token is refused, not silently guested.
    expect(await p.authenticate("garbage", { allowGuests: true })).toMatchObject({
      ok: false,
      error: "auth_invalid",
    });
  });
});
