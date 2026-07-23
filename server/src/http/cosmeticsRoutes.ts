import { Router, type Request, type Response } from "express";
import { COSMETICS, isCosmeticType, type CosmeticType } from "@foghaven/shared";
import { verifyToken } from "../auth/token";
import { getCosmeticProvider } from "../cosmetics/provider";

/**
 * The cosmetics HTTP surface, mounted at `/cosmetics` alongside `/auth` and
 * `/friends`. Bearer-token only, same as everything else account-scoped —
 * a guest has no account for a coin balance or ownership row to attach to.
 *
 * The catalog itself (`/cosmetics/catalog`) is the one route that doesn't
 * need the database at all — it's `@foghaven/shared`'s `COSMETICS` array,
 * verbatim. Ownership, equip and purchase all go through
 * `CosmeticProvider`, which — like the moderation provider — returns `null`
 * rather than throwing when unconfigured, so these routes answer 503 instead
 * of crashing the process if boot wiring is ever missing.
 */

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function bearerUserId(req: Request): string | null {
  const header = asString(req.headers.authorization);
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return token ? (verifyToken(token)?.userId ?? null) : null;
}

function requireAuth(req: Request, res: Response, next: () => void): void {
  const userId = bearerUserId(req);
  if (!userId) {
    res.status(401).json({ error: "auth_invalid" });
    return;
  }
  res.locals.userId = userId;
  next();
}

export function createCosmeticsRouter(): Router {
  const router = Router();

  // No auth needed — the catalog is what an anonymous visitor sees browsing
  // the shop preview, and it carries no per-account data.
  router.get("/catalog", (_req: Request, res: Response) => {
    res.status(200).json({ catalog: COSMETICS });
  });

  router.use(requireAuth);

  router.get("/", async (_req: Request, res: Response) => {
    const provider = getCosmeticProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const userId = res.locals.userId as string;
    const [coins, owned] = await Promise.all([provider.getCoins(userId), provider.listOwned(userId)]);
    res.status(200).json({ coins, owned });
  });

  router.post("/purchase", async (req: Request, res: Response) => {
    const provider = getCosmeticProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const cosmeticId = asString((req.body ?? {}).cosmeticId);
    if (!cosmeticId) {
      res.status(400).json({ error: "not_found" });
      return;
    }
    const result = await provider.purchase(res.locals.userId as string, cosmeticId);
    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : result.error === "already_owned" ? 409 : 402;
      res.status(status).json({ error: result.error });
      return;
    }
    res.status(200).json({ coins: result.value.coins });
  });

  router.post("/equip", async (req: Request, res: Response) => {
    const provider = getCosmeticProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const cosmeticId = asString((req.body ?? {}).cosmeticId);
    if (!cosmeticId) {
      res.status(400).json({ error: "not_found" });
      return;
    }
    const result = await provider.equip(res.locals.userId as string, cosmeticId);
    if (!result.ok) {
      res.status(result.error === "not_found" ? 404 : 403).json({ error: result.error });
      return;
    }
    res.status(200).json({ loadout: result.value });
  });

  router.post("/unequip", async (req: Request, res: Response) => {
    const provider = getCosmeticProvider();
    if (!provider) {
      res.status(503).json({ error: "unavailable" });
      return;
    }
    const type = (req.body ?? {}) as { type?: unknown };
    if (!isCosmeticType(type.type)) {
      res.status(400).json({ error: "invalid_type" });
      return;
    }
    const loadout = await provider.unequip(res.locals.userId as string, type.type as CosmeticType);
    res.status(200).json({ loadout });
  });

  return router;
}
