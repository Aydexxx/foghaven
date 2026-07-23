import { Registry, collectDefaultMetrics, Gauge, Histogram, Counter } from "prom-client";

/**
 * The process-wide Prometheus registry, exposed at `GET /metrics` (see
 * `index.ts`) for a Grafana Alloy agent to scrape and forward to Grafana
 * Cloud — see `observability/alloy/`. Metrics live per-process: this is a
 * single-instance deployment today (see `docs/DEPLOYMENT.md`), and even once
 * scaled out, each instance exporting its own series with an `instance` label
 * (added by the scraper) is the normal Prometheus multi-instance model, not
 * something this module needs to coordinate.
 */
export const register = new Registry();

// Free Node.js process metrics — heap, RSS, event-loop lag, CPU — covers the
// "memory" requirement with zero custom instrumentation.
collectDefaultMetrics({ register });

export const activeRooms = new Gauge({
  name: "foghaven_active_rooms",
  help: "Number of GameRoom instances currently open on this process.",
  registers: [register],
});

export const concurrentPlayers = new Gauge({
  name: "foghaven_concurrent_players",
  help: "Number of players currently connected across all rooms on this process.",
  registers: [register],
});

/** Buckets in seconds — a round runs from a couple of minutes to tens of minutes across several meetings. */
export const matchDurationSeconds = new Histogram({
  name: "foghaven_match_duration_seconds",
  help: "Wall-clock duration of a completed match, from world-open (PLAYING) to game-over.",
  labelNames: ["reason"],
  buckets: [60, 120, 180, 300, 450, 600, 900, 1200, 1800],
  registers: [register],
});

/**
 * Buckets in ms. The theoretical ceiling is 50ms (20Hz, TICK_RATE) before a
 * tick would actually overrun its slot, but the real target is stricter:
 * `GameRoom.perf.test.ts` pins p95 under 10ms with 12 players and active
 * movement traffic — the bucket boundaries are chosen to resolve that
 * target clearly (a 10ms result could be anywhere in [5,10) without a
 * boundary right at 10) rather than just the wider 50ms budget.
 */
export const tickDurationMs = new Histogram({
  name: "foghaven_tick_duration_ms",
  help: "Time spent executing one GameRoom simulation tick.",
  buckets: [1, 2, 5, 10, 20, 30, 50, 75, 100, 150, 250],
  registers: [register],
});

/** Incremented alongside every `logAntiCheatEvent` call — see `anticheat.ts`. */
export const anticheatRejections = new Counter({
  name: "foghaven_anticheat_rejections_total",
  help: "Count of server-side rejections of a suspicious or invalid client request, by reason.",
  labelNames: ["reason"],
  registers: [register],
});
