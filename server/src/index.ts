import "dotenv/config";
// Initialized before every other import that might throw during its own
// setup — Sentry can only report what happens after `init()` runs. A no-op
// (no events sent, no perf overhead) when SENTRY_DSN is unset, which is the
// normal case in local dev.
import * as Sentry from "@sentry/node";
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? "development",
  // No tracing/performance monitoring — this project only wants error
  // tracking, not the sampled span data `tracesSampleRate > 0` would start
  // collecting (and its extra dependency surface — see the OpenTelemetry
  // instrumentation packages `@sentry/node` bundles).
  tracesSampleRate: 0,
});

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import { GameRoom } from "./rooms/GameRoom";
import { HubRoom } from "./rooms/HubRoom";
import { setAuthProvider } from "./auth/provider";
import { PrismaAuthProvider } from "./auth/prismaProvider";
import { hasRealSecret } from "./auth/token";
import { createAuthRouter } from "./http/authRoutes";
import { setFriendProvider, PrismaFriendProvider } from "./friends/provider";
import { createFriendRouter } from "./http/friendRoutes";
import { setPresenceStore, RedisPresenceStore } from "./presence/presenceStore";
import { setModerationProvider, PrismaModerationProvider } from "./moderation/provider";
import { createAdminRouter } from "./http/adminRoutes";
import { CHAT_LOG_RETENTION_DAYS, RETENTION_SWEEP_INTERVAL_MS } from "@foghaven/shared";
import { setCosmeticProvider, PrismaCosmeticProvider, syncCosmeticCatalog } from "./cosmetics/provider";
import { createCosmeticsRouter } from "./http/cosmeticsRoutes";
import { setStatsProvider, PrismaStatsProvider } from "./stats/provider";
import { createStatsRouter } from "./http/statsRoutes";
import { createHealthRouter } from "./http/healthRoutes";
import { buildServerOptions, assertProdEnv } from "./serverOptions";
import { logger } from "./logger";
import { register } from "./metrics";

const port = Number(process.env.PORT ?? 2567);
const isProd = process.env.NODE_ENV === "production";

// A process in an unknown state after an uncaught exception is more
// dangerous left running than restarted — Railway's `restartPolicyType:
// ON_FAILURE` (railway.json) brings it back. Colyseus's own
// `onUncaughtException` room hook (see GameRoom.ts/HubRoom.ts) catches
// exceptions thrown inside room lifecycle methods before they'd ever reach
// here; this is the backstop for everything else.
process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaught exception — exiting");
  Sentry.captureException(err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection — exiting");
  Sentry.captureException(reason);
  process.exit(1);
});

// Fail loudly at boot, not at the first login, if production is missing its
// signing secret — a placeholder secret would mint forgeable tokens.
if (isProd && !hasRealSecret()) {
  logger.error("Refusing to start: JWT_SECRET must be a real secret in production.");
  process.exit(1);
}

// The rest of the required-in-production configuration (database, CORS origin,
// and — when scaling out with the Redis driver — Redis and this instance's
// public address). Also fails the boot rather than a later request.
assertProdEnv(process.env);

// The one process-wide account store. Everything auth-related — the HTTP
// endpoints and the room's ban check — goes through whatever is installed
// here; tests install an in-memory fake instead.
const prisma = new PrismaClient();
setAuthProvider(new PrismaAuthProvider(prisma));
setFriendProvider(new PrismaFriendProvider(prisma));
const moderationProvider = new PrismaModerationProvider(prisma);
setModerationProvider(moderationProvider);
setCosmeticProvider(new PrismaCosmeticProvider(prisma));
setStatsProvider(new PrismaStatsProvider(prisma));

// Online presence for the friend system — see `presence/presenceStore.ts`.
// `lazyConnect: false` (the default) means this starts connecting
// immediately rather than waiting for the first command; a Redis that isn't
// up yet logs and retries rather than failing boot, the same tolerance
// ioredis gives any transient network hiccup later on.
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6380");
redis.on("error", (err) => logger.error({ err }, "Redis presence store error"));
setPresenceStore(new RedisPresenceStore(redis));

/**
 * A minimal HTTP Basic auth gate for the Colyseus monitor — constant-time
 * compared so a wrong guess leaks nothing through timing. Kept inline rather
 * than pulling in a dependency for one protected route.
 */
function basicAuth(user: string, password: string): express.RequestHandler {
  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  return (req, res, next) => {
    const provided = req.headers.authorization ?? "";
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      next();
      return;
    }
    res.set("WWW-Authenticate", 'Basic realm="Foghaven monitor"').status(401).send("Authentication required.");
  };
}

/**
 * A minimal bearer-token gate for `/metrics`, same constant-time-compare
 * shape as `basicAuth` above — metrics (room/player counts, tick timing)
 * aren't as sensitive as the monitor's live client detail, but there's no
 * reason to leave them fully public either. No token configured means no
 * gate — fine for local dev, where nothing sensitive is at stake.
 */
function bearerAuth(token: string): express.RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    const a = Buffer.from(provided);
    const b = Buffer.from(token);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      next();
      return;
    }
    res.status(401).send("Authentication required.");
  };
}

const app = express();
app.use(express.json());

// The browser client (Vite dev server, or the real web origin in prod) calls
// the auth endpoints cross-origin; the game socket does not need CORS.
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins }));

// Liveness/readiness probes for the platform health check. Mounted before the
// auth/monitor surfaces and reads no auth — a health probe must answer even
// when everything else is misconfigured. `/health/ready` is the one that
// actually pings Postgres and Redis; see `http/healthRoutes.ts`.
app.use(
  "/health",
  createHealthRouter({
    db: () => prisma.$queryRaw`SELECT 1`,
    redis: () => redis.ping(),
  }),
);

app.use("/auth", createAuthRouter());
app.use("/friends", createFriendRouter());
app.use("/admin", createAdminRouter());
app.use("/cosmetics", createCosmeticsRouter());
app.use("/stats", createStatsRouter());

// Prometheus exposition for a Grafana Alloy agent to scrape and remote_write
// to Grafana Cloud — see observability/alloy/ and docs/DEPLOYMENT.md. Gated
// the same lightweight way as the monitor below: a token if one is
// configured, open in dev if not.
const metricsToken = process.env.METRICS_TOKEN;
app.get(
  "/metrics",
  ...(metricsToken ? [bearerAuth(metricsToken)] : []),
  async (_req, res) => {
    res.set("Content-Type", register.contentType);
    res.send(await register.metrics());
  },
);

// Colyseus monitor (room dashboard). It exposes live room and client detail,
// so it is protected in production: HTTP basic auth when credentials are set,
// and simply NOT mounted if production forgot to set them — never left open.
const monitorUser = process.env.MONITOR_USER;
const monitorPassword = process.env.MONITOR_PASSWORD;
if (monitorUser && monitorPassword) {
  app.use("/colyseus", basicAuth(monitorUser, monitorPassword), monitor());
} else if (!isProd) {
  app.use("/colyseus", monitor());
} else {
  logger.warn(
    "Colyseus monitor disabled: set MONITOR_USER and MONITOR_PASSWORD to enable it in production.",
  );
}

// Reports any error passed to `next(err)` (or thrown synchronously in a
// route) to Sentry before Express's default handler answers 500 — must be
// registered after every other route/middleware above, per Express's
// error-middleware ordering rules.
Sentry.setupExpressErrorHandler(app);

const httpServer = createServer(app);

const gameServer = new Server(
  buildServerOptions({ transport: new WebSocketTransport({ server: httpServer }) }),
);

// Close the shared clients cleanly once Colyseus has finished its own
// graceful shutdown (disposing rooms and disconnecting clients — on by
// default, triggered by the SIGTERM the platform sends on redeploy). A single
// stateful instance cannot carry in-flight rooms across a restart; the
// client's reconnect grace window is what lands players back cleanly. See
// docs/DEPLOYMENT.md.
gameServer.onShutdown(async () => {
  await prisma.$disconnect().catch(() => undefined);
  redis.disconnect();
});

gameServer.define("game", GameRoom);
// One shared social channel for presence + friend invites — see `HubRoom`'s
// own doc comment for why a single instance is safe to assume here.
gameServer.define("hub", HubRoom);

/**
 * Chat retention. Logs exist to make reports reviewable, so they are kept for
 * a bounded window and then deleted outright — reports carry their own
 * evidence snapshot (see `Report.chatExcerpt`), which is what lets this be a
 * real deletion rather than an archive nobody ever empties.
 *
 * Swept on an interval rather than by a cron job so a single-process
 * deployment needs no extra moving parts; `unref` keeps it from holding the
 * process open on shutdown.
 */
function sweepChatLogRetention(): void {
  const cutoff = new Date(Date.now() - CHAT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  void moderationProvider
    .purgeChatLogsBefore(cutoff)
    .then((deleted) => {
      if (deleted > 0) {
        logger.info({ deleted, cutoff: cutoff.toISOString() }, "Retention sweep: deleted chat log entries");
      }
    })
    .catch((err: unknown) => {
      logger.error({ err }, "Retention sweep failed");
      Sentry.captureException(err);
    });
}

setInterval(sweepChatLogRetention, RETENTION_SWEEP_INTERVAL_MS).unref();

gameServer.listen(port).then(async () => {
  // Once at boot too, so a server that is restarted more often than the sweep
  // interval still clears its backlog.
  sweepChatLogRetention();
  // Idempotent — keeps the `Cosmetic` table's rows in sync with the shared
  // registry every boot, so editing `shared/config/cosmetics.ts` is the only
  // step adding or re-pricing an item ever needs.
  await syncCosmeticCatalog(prisma).catch((err: unknown) => {
    logger.error({ err }, "Cosmetic catalog sync failed");
    Sentry.captureException(err);
  });
  const scaling = process.env.COLYSEUS_DRIVER === "redis" ? "redis (multi-instance)" : "local (single-instance)";
  logger.info(
    { port, scaling, sentry: Boolean(process.env.SENTRY_DSN), metrics: Boolean(metricsToken) },
    "Foghaven server listening",
  );
});
