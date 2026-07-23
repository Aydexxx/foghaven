import "dotenv/config";
import { createServer } from "node:http";
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

const port = Number(process.env.PORT ?? 2567);
const isProd = process.env.NODE_ENV === "production";

// Fail loudly at boot, not at the first login, if production is missing its
// signing secret — a placeholder secret would mint forgeable tokens.
if (isProd && !hasRealSecret()) {
  console.error("Refusing to start: JWT_SECRET must be a real secret in production.");
  process.exit(1);
}

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
redis.on("error", (err) => console.error("Redis presence store error:", err.message));
setPresenceStore(new RedisPresenceStore(redis));

const app = express();
app.use(express.json());

// The browser client (Vite dev server, or the real web origin in prod) calls
// the auth endpoints cross-origin; the game socket does not need CORS.
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins }));

app.use("/auth", createAuthRouter());
app.use("/friends", createFriendRouter());
app.use("/admin", createAdminRouter());
app.use("/cosmetics", createCosmeticsRouter());
app.use("/stats", createStatsRouter());

// Colyseus monitor (development dashboard) at /colyseus.
app.use("/colyseus", monitor());

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
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
        console.log(`Retention sweep: deleted ${deleted} chat log entries older than ${cutoff.toISOString()}.`);
      }
    })
    .catch((err: unknown) => {
      console.error("Retention sweep failed:", err instanceof Error ? err.message : err);
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
    console.error("Cosmetic catalog sync failed:", err instanceof Error ? err.message : err);
  });
  console.log(`Foghaven server listening on ws://localhost:${port}`);
  console.log(`Auth API at http://localhost:${port}/auth`);
  console.log(`Friends API at http://localhost:${port}/friends`);
  console.log(`Admin API at http://localhost:${port}/admin`);
  console.log(`Cosmetics API at http://localhost:${port}/cosmetics`);
  console.log(`Stats API at http://localhost:${port}/stats`);
  console.log(`Colyseus monitor at http://localhost:${port}/colyseus`);
});
