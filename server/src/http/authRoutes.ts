import { Router, type Request, type Response } from "express";
import { getAuthProvider, type RegisterError } from "../auth/provider";
import { verifyToken } from "../auth/token";
import { RateLimiter } from "../auth/rateLimit";

/**
 * The account HTTP surface, mounted at `/auth` on the same Express app that
 * serves the Colyseus monitor (see `index.ts`). Three endpoints: register,
 * login, and a `me` convenience. Everything role-critical — the ban check —
 * happens later at `GameRoom.onAuth`; these endpoints only mint and hand back
 * tokens, and never leak a password hash (the provider's `PublicUser` shape
 * can't carry one).
 *
 * The provider is read fresh on each request via `getAuthProvider()` rather
 * than captured, so tests can install the in-memory fake before hitting these
 * routes. The login limiter is injectable for the same reason.
 */

/** Login attempts allowed per key (ip + identifier) before the window locks. */
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 60_000;

/** Register errors that are the client's fault (400) vs. a uniqueness clash (409). */
const REGISTER_STATUS: Record<RegisterError, number> = {
  invalid_email: 400,
  invalid_username: 400,
  profanity: 400,
  weak_password: 400,
  email_taken: 409,
  username_taken: 409,
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function createAuthRouter(
  options: { loginLimiter?: RateLimiter } = {},
): Router {
  const router = Router();
  const loginLimiter = options.loginLimiter ?? new RateLimiter(LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);

  router.post("/register", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await getAuthProvider().register({
      email: asString(body.email),
      username: asString(body.username),
      password: asString(body.password),
    });
    if (!result.ok) {
      res.status(REGISTER_STATUS[result.error]).json({ error: result.error });
      return;
    }
    res.status(201).json(result.value);
  });

  router.post("/login", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const identifier = asString(body.identifier);
    const password = asString(body.password);

    // One budget per (source, targeted account): a single IP hammering one
    // login and a single account being sprayed from many IPs are both bounded,
    // without letting either lock out an innocent third party.
    const key = `${req.ip ?? "unknown"}:${identifier.trim().toLowerCase()}`;
    const limit = loginLimiter.check(key);
    if (!limit.allowed) {
      res
        .status(429)
        .json({ error: "rate_limited", retryAfterMs: limit.retryAfterMs });
      return;
    }

    const result = await getAuthProvider().login({ identifier, password });
    if (!result.ok) {
      if (result.error === "banned") {
        res.status(403).json({ error: "banned", ban: result.ban });
        return;
      }
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    // A real login shouldn't erode the budget for the next honest attempt.
    loginLimiter.reset(key);
    res.status(200).json(result.value);
  });

  router.get("/me", async (req: Request, res: Response) => {
    const header = asString(req.headers.authorization);
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    const claims = token ? verifyToken(token) : null;
    if (!claims) {
      res.status(401).json({ error: "auth_invalid" });
      return;
    }
    const user = await getAuthProvider().getPublicUser(claims.userId);
    if (!user) {
      res.status(401).json({ error: "auth_invalid" });
      return;
    }
    res.status(200).json({ user });
  });

  return router;
}
