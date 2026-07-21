import "dotenv/config";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import { GameRoom } from "./rooms/GameRoom";
import { setAuthProvider } from "./auth/provider";
import { PrismaAuthProvider } from "./auth/prismaProvider";
import { hasRealSecret } from "./auth/token";
import { createAuthRouter } from "./http/authRoutes";

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

// Colyseus monitor (development dashboard) at /colyseus.
app.use("/colyseus", monitor());

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("game", GameRoom);

gameServer.listen(port).then(() => {
  console.log(`Foghaven server listening on ws://localhost:${port}`);
  console.log(`Auth API at http://localhost:${port}/auth`);
  console.log(`Colyseus monitor at http://localhost:${port}/colyseus`);
});
