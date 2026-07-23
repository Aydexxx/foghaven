import { Router } from "express";

/**
 * Liveness/readiness probes for the platform (Railway's `healthcheckPath`) and
 * for eyeballing a live deploy.
 *
 * `GET /health` is deliberately trivial — no I/O — so it answers instantly and
 * a slow database can never make the platform think the process is dead and
 * restart-loop it. `GET /health/ready` is the deeper check: it actually pings
 * Postgres and Redis, so it distinguishes "process up" from "process up and
 * able to serve", and reports which dependency is down.
 *
 * The checks are injected rather than importing the Prisma/Redis clients here,
 * so this router stays a pure Express surface that a supertest test can drive
 * with fakes — the same shape as the other routers in this folder.
 */
export interface HealthChecks {
  /** Resolve truthy if Postgres is reachable. May throw/reject — treated as not-ready. */
  db: () => Promise<unknown>;
  /** Resolve truthy if Redis is reachable. May throw/reject — treated as not-ready. */
  redis: () => Promise<unknown>;
}

async function reachable(check: () => Promise<unknown>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch {
    return false;
  }
}

export function createHealthRouter(checks: HealthChecks): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  router.get("/ready", async (_req, res) => {
    const [db, redis] = await Promise.all([reachable(checks.db), reachable(checks.redis)]);
    const ready = db && redis;
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "unavailable", db, redis });
  });

  return router;
}
