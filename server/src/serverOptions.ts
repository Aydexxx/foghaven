import type { ServerOptions, Transport, Presence } from "@colyseus/core";
import { RedisPresence } from "@colyseus/redis-presence";
import { RedisDriver } from "@colyseus/redis-driver";

/**
 * How the Colyseus match-maker keeps its room registry and presence.
 *
 * - `local` (default): the built-in in-memory `LocalPresence`/`LocalDriver`.
 *   Correct and fastest for a SINGLE server process — which is all a dev
 *   machine or a one-instance production deploy ever runs.
 * - `redis`: `RedisPresence` + `RedisDriver`, so every instance shares one
 *   room registry. REQUIRED the moment there is more than one instance —
 *   without it, each instance only knows about its own rooms and matchmaking
 *   silently sends players to rooms that "don't exist" on the instance they
 *   land on.
 *
 * Flag-gated rather than always-on so the common single-instance case carries
 * no Redis dependency for matchmaking (the friend-presence store's Redis use
 * is separate — see `presence/presenceStore.ts`). Flip `COLYSEUS_DRIVER=redis`
 * as part of scaling to a second instance; see `docs/DEPLOYMENT.md`.
 */
export type ScalingMode = "local" | "redis";

/** Minimal shape read here — a plain record so callers (and tests) can pass a fake env. */
export type EnvLike = Record<string, string | undefined>;

export function resolveScalingMode(env: EnvLike): ScalingMode {
  return env.COLYSEUS_DRIVER === "redis" ? "redis" : "local";
}

/** A required-but-missing (or placeholder) production variable, for a single loud boot-time error. */
export interface ProdEnvProblem {
  key: string;
  message: string;
}

/**
 * The production variables that must be present, given the chosen scaling
 * mode. Pure — returns the list of problems rather than throwing, so it is
 * trivially unit-testable; `assertProdEnv` is the throwing wrapper `index.ts`
 * actually calls. `JWT_SECRET` is intentionally NOT re-checked here: it has
 * its own dedicated placeholder-aware guard in `auth/token.ts`
 * (`hasRealSecret`), which `index.ts` already runs at boot.
 */
export function checkProdEnv(env: EnvLike): ProdEnvProblem[] {
  const problems: ProdEnvProblem[] = [];
  const require = (key: string, message: string) => {
    if (!env[key]) {
      problems.push({ key, message });
    }
  };

  require("DATABASE_URL", "Postgres connection string (injected by the Railway Postgres plugin).");
  require("CLIENT_ORIGIN", "The deployed web client's origin, for CORS (e.g. https://foghaven.example).");

  if (resolveScalingMode(env) === "redis") {
    require("REDIS_URL", "Redis connection string — required when COLYSEUS_DRIVER=redis.");
    require(
      "PUBLIC_ADDRESS",
      "This instance's externally reachable host:port — required for room-aware routing when COLYSEUS_DRIVER=redis.",
    );
  }

  return problems;
}

/**
 * In production, fail loudly at boot if a required variable is missing —
 * never limp along to fail at the first request instead. A no-op outside
 * production so `npm run dev` needs no setup. `exit`/`log` are injectable so
 * a test can assert the behaviour without killing the test process.
 */
export function assertProdEnv(
  env: EnvLike,
  { exit = process.exit, log = console.error }: { exit?: (code: number) => never; log?: (msg: string) => void } = {},
): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  const problems = checkProdEnv(env);
  if (problems.length === 0) {
    return;
  }
  log(
    "Refusing to start: missing required production configuration:\n" +
      problems.map((p) => `  - ${p.key}: ${p.message}`).join("\n"),
  );
  exit(1);
}

/** Injectable factories so tests can exercise the redis branch without opening real connections. */
export interface BuildServerOptionsDeps {
  transport: Transport;
  env?: EnvLike;
  makePresence?: (url: string) => Presence;
  makeDriver?: (url: string) => NonNullable<ServerOptions["driver"]>;
}

/**
 * The Colyseus `ServerOptions` for this process. In `local` mode this is
 * exactly today's behaviour — just the transport, letting Colyseus use its
 * default in-memory presence/driver. In `redis` mode it adds the shared
 * `RedisPresence` + `RedisDriver` and this instance's `publicAddress`, which
 * is what lets a second instance ever be correct.
 */
export function buildServerOptions(deps: BuildServerOptionsDeps): ServerOptions {
  const env = deps.env ?? process.env;
  const options: ServerOptions = { transport: deps.transport };

  if (resolveScalingMode(env) === "redis") {
    // Presence of REDIS_URL is guaranteed by assertProdEnv in production; the
    // fallback keeps a misconfigured dev flip-on from crashing on undefined.
    const url = env.REDIS_URL ?? "redis://localhost:6380";
    const makePresence = deps.makePresence ?? ((u: string) => new RedisPresence(u));
    const makeDriver = deps.makeDriver ?? ((u: string) => new RedisDriver(u));
    options.presence = makePresence(url);
    options.driver = makeDriver(url);
    if (env.PUBLIC_ADDRESS) {
      options.publicAddress = env.PUBLIC_ADDRESS;
    }
  }

  return options;
}
