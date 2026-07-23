import { Router, type NextFunction, type Request, type Response } from "express";
import {
  REPORT_STATUS,
  USER_ROLE,
  hasRole,
  isReportStatus,
  type UserRole,
} from "@foghaven/shared";
import { verifyToken } from "../auth/token";
import { getModerationProvider } from "../moderation/provider";
import { RateLimiter } from "../auth/rateLimit";

/**
 * The moderation panel's HTTP surface, mounted at `/admin`.
 *
 * ## Authorisation
 *
 * This is a privileged surface and is treated as one. Every route below sits
 * behind {@link requireRole}, which:
 *
 *  - requires a valid bearer token (401 without one);
 *  - re-reads the caller's role **from the database on every request**, never
 *    from the token. Auth tokens carry only a user id and live for a week, so
 *    trusting a role claim inside one would mean a demoted or compromised
 *    moderator keeping their powers until it expired. This is the same
 *    reasoning that keeps the ban check out of the token — see `auth/token.ts`;
 *  - refuses a caller whose own account is banned, so a compromised moderator
 *    account can be shut down by the same mechanism as anyone else;
 *  - answers 403 for an authenticated non-moderator.
 *
 * On top of that, privilege is *ordered*: a moderator can only act on accounts
 * strictly below their own rank, and nobody can act on themselves. Without
 * that, any moderator could ban every other moderator, or unban themselves.
 *
 * Nothing here is reachable without passing all of it — the router applies the
 * guard with `router.use`, so a route added later is protected by default
 * rather than by remembering to say so.
 */

/** A modest ceiling on admin calls, mostly so user search can't be used to enumerate accounts. */
const ADMIN_MAX_REQUESTS = 120;
const ADMIN_WINDOW_MS = 60_000;

const DEFAULT_REPORT_LIMIT = 50;
const MAX_REPORT_LIMIT = 200;
const DEFAULT_CHAT_LIMIT = 200;
const MAX_CHAT_LIMIT = 500;
const MAX_SEARCH_RESULTS = 50;
const MAX_RESOLUTION_LENGTH = 1000;
const MAX_BAN_REASON_LENGTH = 500;

/** What the guard proves about a caller, handed to the routes via `res.locals`. */
interface AdminIdentity {
  userId: string;
  role: UserRole;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function bearerUserId(req: Request): string | null {
  const header = asString(req.headers.authorization);
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token) {
    return null;
  }
  return verifyToken(token)?.userId ?? null;
}

function locals(res: Response): AdminIdentity {
  return res.locals.admin as AdminIdentity;
}

/**
 * Build the guard for a minimum role. Fails closed at every step: a missing
 * provider, an unknown user, a banned account or an insufficient role all deny
 * rather than fall through.
 */
function requireRole(minimum: UserRole) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = bearerUserId(req);
    if (!userId) {
      res.status(401).json({ error: "auth_invalid" });
      return;
    }
    const provider = getModerationProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const user = await provider.getUser(userId);
    if (!user) {
      res.status(401).json({ error: "auth_invalid" });
      return;
    }
    // A banned moderator is not a moderator. Checked here rather than only at
    // join time because these routes never go near a game room.
    if (user.banned && (user.banUntil === null || new Date(user.banUntil).getTime() > Date.now())) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (!hasRole(user.role, minimum)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    res.locals.admin = { userId, role: user.role } satisfies AdminIdentity;
    next();
  };
}

/**
 * Whether `actor` may act on `target`. Strictly-greater rather than
 * greater-or-equal, and never on oneself: peers cannot ban each other, and no
 * one can lift their own ban or promote themselves.
 */
function canActOn(actor: AdminIdentity, target: { id: string; role: UserRole }): boolean {
  if (actor.userId === target.id) {
    return false;
  }
  // `hasRole` is "at least", so negating it against the actor's own role is
  // exactly "target ranks strictly lower". An admin may act on moderators and
  // players but not on other admins; a moderator only on players.
  return !hasRole(target.role, actor.role);
}

export function createAdminRouter(options: { limiter?: RateLimiter } = {}): Router {
  const router = Router();
  const limiter = options.limiter ?? new RateLimiter(ADMIN_MAX_REQUESTS, ADMIN_WINDOW_MS);

  // Applied to the whole router, so every route — including any added later —
  // is behind authentication and the moderator floor by default.
  router.use(requireRole(USER_ROLE.MODERATOR));

  router.use((_req, res, next) => {
    const limit = limiter.check(locals(res).userId);
    if (!limit.allowed) {
      res.status(429).json({ error: "rate_limited", retryAfterMs: limit.retryAfterMs });
      return;
    }
    next();
  });

  /** Who the caller is, so the client can decide whether to show the panel at all. */
  router.get("/me", (_req: Request, res: Response) => {
    const admin = locals(res);
    res.status(200).json({ userId: admin.userId, role: admin.role });
  });

  // --- Report queue --------------------------------------------------------

  router.get("/reports", async (req: Request, res: Response) => {
    const provider = getModerationProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const statusParam = asString(req.query.status);
    // An unrecognised status filter is ignored rather than erroring — the
    // sensible reading of "?status=garbage" is "show me everything".
    const status = isReportStatus(statusParam) ? statusParam : null;
    const limit = Math.min(Number(req.query.limit) || DEFAULT_REPORT_LIMIT, MAX_REPORT_LIMIT);
    res.status(200).json({ reports: await provider.listReports(status, limit) });
  });

  router.get("/reports/:id", async (req: Request, res: Response) => {
    const provider = getModerationProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const report = await provider.getReport(asString(req.params.id));
    if (!report) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(200).json({ report });
  });

  router.post("/reports/:id/resolve", async (req: Request, res: Response) => {
    const provider = getModerationProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const status = body.status;
    // Only the two *terminal* statuses can be set by hand; a report goes back
    // to "open" by nobody, which keeps the queue's audit trail meaningful.
    if (status !== REPORT_STATUS.ACTIONED && status !== REPORT_STATUS.DISMISSED) {
      res.status(400).json({ error: "invalid_status" });
      return;
    }
    const resolution = asString(body.resolution).slice(0, MAX_RESOLUTION_LENGTH) || null;
    const updated = await provider.resolveReport(
      asString(req.params.id),
      locals(res).userId,
      status,
      resolution,
    );
    if (!updated) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(200).json({ report: updated });
  });

  // --- Users ---------------------------------------------------------------

  router.get("/users", async (req: Request, res: Response) => {
    const provider = getModerationProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const users = await provider.searchUsers(asString(req.query.q), MAX_SEARCH_RESULTS);
    res.status(200).json({ users });
  });

  router.get("/users/:id", async (req: Request, res: Response) => {
    const provider = getModerationProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const userId = asString(req.params.id);
    const user = await provider.getUser(userId);
    if (!user) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(200).json({ user, banHistory: await provider.listBanHistory(userId) });
  });

  router.post("/users/:id/ban", async (req: Request, res: Response) => {
    const provider = getModerationProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const target = await provider.getUser(asString(req.params.id));
    if (!target) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!canActOn(locals(res), target)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    const reason = asString(body.reason).trim().slice(0, MAX_BAN_REASON_LENGTH);
    if (!reason) {
      res.status(400).json({ error: "reason_required" });
      return;
    }
    // `until` absent or null means permanent; anything unparseable is a
    // mistake worth reporting rather than silently making permanent.
    let until: Date | null = null;
    if (body.until !== undefined && body.until !== null && body.until !== "") {
      const parsed = new Date(asString(body.until));
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "invalid_until" });
        return;
      }
      until = parsed;
    }

    const updated = await provider.banUser({
      userId: target.id,
      issuedById: locals(res).userId,
      reason,
      until,
    });
    res.status(200).json({ user: updated });
  });

  router.post("/users/:id/unban", async (req: Request, res: Response) => {
    const provider = getModerationProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const target = await provider.getUser(asString(req.params.id));
    if (!target) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!canActOn(locals(res), target)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const updated = await provider.unbanUser(target.id, locals(res).userId);
    res.status(200).json({ user: updated });
  });

  /** Granting moderator powers is an admin-only act, not a moderator one. */
  router.post("/users/:id/role", requireRole(USER_ROLE.ADMIN), async (req: Request, res: Response) => {
    const provider = getModerationProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const role = body.role;
    if (role !== USER_ROLE.PLAYER && role !== USER_ROLE.MODERATOR && role !== USER_ROLE.ADMIN) {
      res.status(400).json({ error: "invalid_role" });
      return;
    }
    const target = await provider.getUser(asString(req.params.id));
    if (!target) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (locals(res).userId === target.id) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    res.status(200).json({ user: await provider.setRole(target.id, role) });
  });

  // --- Chat log ------------------------------------------------------------

  router.get("/chat", async (req: Request, res: Response) => {
    const provider = getModerationProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const roomCode = asString(req.query.roomCode).trim().toUpperCase();
    if (!roomCode) {
      res.status(400).json({ error: "room_required" });
      return;
    }
    const limit = Math.min(Number(req.query.limit) || DEFAULT_CHAT_LIMIT, MAX_CHAT_LIMIT);
    res.status(200).json({ entries: await provider.listChatLog(roomCode, limit) });
  });

  return router;
}
