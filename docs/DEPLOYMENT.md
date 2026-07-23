# Deploying Foghaven (Railway)

Foghaven is two deployables plus two managed data stores:

| Piece | What it is | How it's hosted |
|---|---|---|
| **Server** | Colyseus game server + HTTP API (auth/friends/admin/cosmetics/stats). **Stateful** — rooms live in the process's memory. | Railway service, from the root [`Dockerfile`](../Dockerfile) |
| **Client** | React + Vite + Phaser SPA (static files) | Railway static service ([`client/Dockerfile`](../client/Dockerfile)) **or** Netlify/Vercel ([`client/netlify.toml`](../client/netlify.toml)) |
| **Postgres** | Accounts, friends, moderation, cosmetics, stats | Railway Postgres plugin |
| **Redis** | Friend online-presence (always) + Colyseus room registry (only when scaled to >1 instance) | Railway Redis plugin |

This is a **single server instance** to start — enough for real games with friends. It is wired so scaling to N instances later is a config change, not a rewrite (see [Scaling out](#scaling-out-to-a-second-instance)).

> **Because the server is stateful, treat it differently from a normal web app.** A redeploy restarts the process and **ends any in-progress rooms** — see [Deploy safety](#deploy-safety-stateful-server). Plan deploys for quiet times until you run multiple instances.

---

## One-time setup

### 1. Create the Railway project and environments

1. Create a new Railway project.
2. Create the environments you want kept separate — at minimum **production**; optionally **staging** and **dev**. Each environment holds its own variables and its own database/Redis, so staging can never touch production data.
3. Pick a region close to your players — start with an **EU** region (e.g. `europe-west4`). Add regions only when latency data says you need them.

### 2. Add the data stores

In each environment:

1. **Add a Postgres plugin.** Railway exposes `DATABASE_URL` — reference it from the server service (see variables below).
2. **Add a Redis plugin.** Railway exposes a Redis connection string — map it to the server's `REDIS_URL`.

### 3. Create the server service

1. Add a service from this GitHub repo. Railway reads [`railway.json`](../railway.json): it builds the root `Dockerfile` and health-checks `/health`.
2. Set the server service's **variables** (Railway → service → Variables). The authoritative list is [`server/.env.production.example`](../server/.env.production.example):

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | a long random string — `openssl rand -base64 48` |
   | `CLIENT_ORIGIN` | the client's public origin (set after step 4; comma-separate multiple) |
   | `DATABASE_URL` | reference the Postgres plugin's variable |
   | `REDIS_URL` | reference the Redis plugin's variable |
   | `ALLOW_GUESTS` | `true` or `false` |
   | `MONITOR_USER` / `MONITOR_PASSWORD` | optional — enables the `/colyseus` dashboard behind basic auth; omit both to keep it off |
   | `COLYSEUS_DRIVER` | `local` for now (see [Scaling out](#scaling-out-to-a-second-instance)) |
   | `SENTRY_DSN` | from your Sentry project (see [Observability](#observability)) — omit to disable error tracking |
   | `METRICS_TOKEN` | a random string; gates `GET /metrics` — omit only if you're fine with metrics being publicly readable |

   `PORT` is injected by Railway automatically — don't set it.

3. Deploy. On release the container runs [`server/scripts/start-prod.sh`](../server/scripts/start-prod.sh): it applies pending Prisma migrations (`prisma migrate deploy`) **before** opening the socket, then starts the server.
4. Note the server's public domain (e.g. `foghaven-server-production.up.railway.app`).

### 4. Create the client service

**Option A — Railway (Docker + Caddy):** add a second service from the repo pointing at [`client/Dockerfile`](../client/Dockerfile). Set the **build args** `VITE_SERVER_URL=wss://<server-domain>` (from step 3) and, optionally, `VITE_SENTRY_DSN` (see [Observability](#observability)). Both are build-time — baked into the bundle, so a change means a rebuild.

**Option B — Netlify/Vercel (simpler):** point it at the repo; [`client/netlify.toml`](../client/netlify.toml) sets the build command, publish dir (`client/dist`), and SPA fallback. Set `VITE_SERVER_URL=wss://<server-domain>` (and optionally `VITE_SENTRY_DSN`) as **build environment variables** in the host's UI.

Either way the client derives the HTTP API base from `VITE_SERVER_URL` (`ws→http`), so one value covers both the game socket and the REST calls. Template: [`client/.env.production.example`](../client/.env.production.example).

### 5. Close the CORS loop

Set the **server's** `CLIENT_ORIGIN` to the client's public origin from step 4 (e.g. `https://foghaven.example`) and redeploy the server. The game WebSocket doesn't need CORS, but the auth/friends/stats HTTP calls do.

---

## Verify the deploy

1. `GET https://<server-domain>/health` → `200 {"status":"ok"}`.
2. `GET https://<server-domain>/health/ready` → `200 {"status":"ready","db":true,"redis":true}`. A `503` here names which dependency is unreachable (`db`/`redis`) — check that plugin's variable wiring.
3. Open the client, register an account, create a room, move around, run a task. Have a friend join over the internet and play a full round.
4. Spot-check latency from your target region; if it's poor for most players, reconsider the region choice (not more instances).

---

## Deploy safety (stateful server)

A single stateful instance **cannot** carry in-flight rooms across a restart. On a Railway redeploy:

- Railway sends `SIGTERM`; Colyseus runs its built-in graceful shutdown (disposes rooms, disconnects clients cleanly) and the server closes Postgres/Redis via the `onShutdown` hook in [`server/src/index.ts`](../server/src/index.ts).
- Clients see a clean close and enter their reconnect flow (a 45s grace window, `RECONNECT_GRACE_MS` in `shared/config/gameConfig.ts`). But the room's memory is gone with the old process, so a mid-game deploy **ends that game** — players reconnect and land back at the menu, not into their round.

**Until you run multiple instances, deploy during quiet periods.** True zero-interruption deploys need connection draining across instances (deploy the new instance, stop routing new rooms to the old one, wait for its rooms to empty) — that's the multi-instance work below, not something a single instance can do.

---

## Observability

A live game needs to be watchable: Sentry for errors (client + server), Grafana Cloud for metrics/dashboard/alerts, structured logs for everything else, and an anti-cheat log tapping the server's own request-validation rejections. Code and config for all of this already ships; this section is the account setup + wiring the rest needs.

### Sentry (errors)

1. Create a free Sentry account and project (platform: Node for the server errors, or one combined project if you'd rather keep everything in one place — either works, since events are tagged by `environment`).
2. Copy the project's DSN.
3. Set `SENTRY_DSN` on the **server** service (table above) and `VITE_SENTRY_DSN` as a **client build arg/env var** (step 4 above). Both are no-ops if left unset — safe to add later.
4. **Alert rule**: in Sentry → Alerts, add a rule on "a new issue is created" (crash) and one on error-rate spike (e.g. "more than N events in 5 minutes"), each pointed at a notification channel (email/Slack/Discord — whichever you set up in Sentry's Integrations).
5. **Acceptance test** (do this after deploying): sign in as an admin and use the two buttons in the moderation panel (🛡️) — "Send client test error" (throws in the browser) and "Send server test error" (hits `GET /admin/debug/test-error`). Both should appear as distinct issues in Sentry within seconds. (The server route is `requireRole(ADMIN)` — a moderator won't see the buttons.)

### Metrics + dashboard (Grafana Cloud)

The server exposes Prometheus metrics at `GET /metrics` (gated by `METRICS_TOKEN` if set) — concurrent players, active rooms, match duration, tick duration, anti-cheat rejection counts by reason, plus free Node.js process metrics (heap, RSS, event-loop lag, CPU). A small **Grafana Alloy** service scrapes that endpoint and ships it to Grafana Cloud.

1. Create a free Grafana Cloud account/stack if you don't have one.
2. In the Grafana Cloud UI: **Connections → Add new connection → Hosted Prometheus metrics**. It generates a ready `remote_write` config with the correct URL, your stack's Prometheus username, and a scoped access-policy token — keep this page open, you'll need those three values next.
3. Deploy [`observability/alloy/`](../observability/alloy/) as its own Railway service (Dockerfile builder, same as the other two services). Set its variables:

   | Variable | Value |
   |---|---|
   | `FOGHAVEN_METRICS_HOST` | the game server's domain, e.g. `foghaven-server-production.up.railway.app` |
   | `FOGHAVEN_METRICS_TOKEN` | the same value as the server's `METRICS_TOKEN` |
   | `GRAFANA_CLOUD_PROMETHEUS_URL` | from step 2 |
   | `GRAFANA_CLOUD_PROMETHEUS_USER` | from step 2 |
   | `GRAFANA_CLOUD_API_KEY` | the access-policy token from step 2 |

   [`observability/alloy/config.alloy`](../observability/alloy/config.alloy) has a note on double-checking its block syntax against Alloy's current docs at deploy time — config-language details do shift between Alloy releases, and the generated `remote_write` block from step 2 is the authoritative version of that half either way.
4. Import [`observability/grafana/foghaven-dashboard.json`](../observability/grafana/foghaven-dashboard.json) in Grafana Cloud (Dashboards → New → Import → upload/paste JSON), picking your hosted Prometheus data source when prompted.
5. **Alert rules** (Grafana → Alerting → new alert rule, using the same Prometheus data source):
   - Tick lag: `histogram_quantile(0.95, sum by (le) (rate(foghaven_tick_duration_ms_bucket[5m]))) > 100` (the tick budget is 50ms at 20/sec — sustained p95 over 100ms means the simulation is falling behind).
   - Server down: `up{job="foghaven_server"} == 0`.
6. **Acceptance test**: once deployed, open the imported dashboard while a real room is open — "Concurrent players" and "Active rooms" should move live.

### Structured logs + anti-cheat log

Both are plain stdout JSON (via `pino`, see [`server/src/logger.ts`](../server/src/logger.ts)) — no separate destination to set up. Railway's own log viewer already displays and lets you search these. The anti-cheat log ([`server/src/anticheat.ts`](../server/src/anticheat.ts)) tags every entry `"event": "anticheat_reject"` with a `reason` (e.g. `ability_cooldown`, `report_fog_of_war`, `chat_rate_limit`) plus `sessionId`/`userId` — filter Railway's log search on `anticheat_reject` to review attempts, or watch the `foghaven_anticheat_rejections_total` counter on the dashboard for a rate-over-time view without reading a single log line.

---

## Scaling out to a second instance

The moment you run **more than one** server instance, the in-memory match-maker is wrong: each instance only knows its own rooms, so a player can be matched to a room the instance they connect to has never heard of. Switch Colyseus to the shared Redis registry:

1. Set `COLYSEUS_DRIVER=redis` on the server service.
2. Set `PUBLIC_ADDRESS` to the instance's externally reachable `host:port` (used to advertise which instance owns a room). The boot-time check requires both `REDIS_URL` and `PUBLIC_ADDRESS` in this mode — the server refuses to start otherwise.
3. Ensure the client's matchmake request and its follow-up WebSocket connection reach a consistent instance — i.e. **sticky sessions / room-aware routing**. Colyseus's own seat-reservation + `publicAddress` handle routing *if each instance is individually addressable*; per-instance addressing is the weak spot on Railway's single-proxy model, so verify a room created on instance A is actually reachable when a second client joins it. If Railway's routing can't guarantee this, the practical options are enabling sticky sessions at the proxy or fronting the instances with a router that honours Colyseus's seat reservations. **Validate with 2 instances + 2 clients before relying on it.**

The code path is already in place and unit-tested (`server/src/serverOptions.ts`, `serverOptions.test.ts`) — this is configuration and routing verification, not new code.

---

## Environments (dev / staging / production)

Separation is by **Railway environment**, not committed files: each environment has its own variables and its own Postgres/Redis. Same keys everywhere (the list in [`server/.env.production.example`](../server/.env.production.example)), different values. Never commit a real `.env`; local dev uses [`server/.env.example`](../server/.env.example) + the root `docker-compose.yml`.

## Local production smoke test

Before trusting a cloud deploy, exercise the production image locally against the dev Postgres/Redis:

```bash
docker compose up -d                     # dev Postgres + Redis (root docker-compose.yml)
docker build -t foghaven-server .        # build the production image
docker run --rm -p 2567:2567 \
  -e NODE_ENV=production \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e CLIENT_ORIGIN=http://localhost:5173 \
  -e DATABASE_URL="postgresql://foghaven:foghaven_dev@host.docker.internal:5434/foghaven?schema=public" \
  -e REDIS_URL="redis://host.docker.internal:6380" \
  foghaven-server
# → migrations apply, then: curl localhost:2567/health and /health/ready should be 200
```

To exercise the (future) multi-instance path without a second instance, add `-e COLYSEUS_DRIVER=redis -e PUBLIC_ADDRESS=localhost:2567` and confirm it still boots and `/health/ready` passes.
