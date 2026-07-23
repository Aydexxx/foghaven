import { Router, type Request, type Response } from "express";
import { verifyToken } from "../auth/token";
import { getStatsProvider } from "../stats/provider";

/**
 * The stats HTTP surface, mounted at `/stats` alongside `/auth`, `/friends`
 * and `/cosmetics`. Bearer-token only, and deliberately a single route: the
 * caller's own lifetime stat line, with no way to ask for anyone else's.
 *
 * That is not an oversight — see the project note on why there is no global
 * leaderboard. A route that took a `userId` would BE a leaderboard's data
 * source the moment someone built a page that called it in a loop; not
 * having one is the actual guard, not a UI choice layered on top of one.
 */

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function bearerUserId(req: Request): string | null {
  const header = asString(req.headers.authorization);
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return token ? (verifyToken(token)?.userId ?? null) : null;
}

export function createStatsRouter(): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    const userId = bearerUserId(req);
    if (!userId) {
      res.status(401).json({ error: "auth_invalid" });
      return;
    }
    const provider = getStatsProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const stats = await provider.getStats(userId);
    res.status(200).json({ stats });
  });

  return router;
}
