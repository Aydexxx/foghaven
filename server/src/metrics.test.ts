import { beforeEach, describe, expect, it } from "vitest";
import {
  register,
  activeRooms,
  concurrentPlayers,
  matchDurationSeconds,
  tickDurationMs,
  anticheatRejections,
} from "./metrics";

async function valueOf(metric: { get(): Promise<{ values: Array<{ value: number }> }> }): Promise<number> {
  const { values } = await metric.get();
  return values[0]?.value ?? 0;
}

beforeEach(() => {
  activeRooms.reset();
  concurrentPlayers.reset();
  matchDurationSeconds.reset();
  tickDurationMs.reset();
  anticheatRejections.reset();
});

describe("gauges", () => {
  it("activeRooms tracks inc/dec", async () => {
    expect(await valueOf(activeRooms)).toBe(0);
    activeRooms.inc();
    activeRooms.inc();
    expect(await valueOf(activeRooms)).toBe(2);
    activeRooms.dec();
    expect(await valueOf(activeRooms)).toBe(1);
  });

  it("concurrentPlayers tracks inc/dec", async () => {
    concurrentPlayers.inc();
    concurrentPlayers.inc();
    concurrentPlayers.inc();
    concurrentPlayers.dec();
    expect(await valueOf(concurrentPlayers)).toBe(2);
  });
});

describe("histograms", () => {
  it("matchDurationSeconds records an observation under its reason label", async () => {
    matchDurationSeconds.observe({ reason: "tasks" }, 245);
    const { values } = await matchDurationSeconds.get();
    const sum = values.find((v) => v.metricName?.endsWith("_sum") && v.labels.reason === "tasks");
    expect(sum?.value).toBe(245);
  });

  it("tickDurationMs records an observation", async () => {
    tickDurationMs.observe(12);
    const { values } = await tickDurationMs.get();
    const count = values.find((v) => v.metricName?.endsWith("_count"));
    expect(count?.value).toBe(1);
  });
});

describe("anticheatRejections", () => {
  it("increments the counter for the given reason label only", async () => {
    anticheatRejections.inc({ reason: "ability_cooldown" });
    anticheatRejections.inc({ reason: "ability_cooldown" });
    anticheatRejections.inc({ reason: "chat_rate_limit" });

    const { values } = await anticheatRejections.get();
    const cooldown = values.find((v) => v.labels.reason === "ability_cooldown");
    const chat = values.find((v) => v.labels.reason === "chat_rate_limit");
    expect(cooldown?.value).toBe(2);
    expect(chat?.value).toBe(1);
  });
});

describe("register", () => {
  it("exposes every custom metric plus the default Node.js process metrics", async () => {
    const text = await register.metrics();
    expect(text).toContain("foghaven_active_rooms");
    expect(text).toContain("foghaven_concurrent_players");
    expect(text).toContain("foghaven_match_duration_seconds");
    expect(text).toContain("foghaven_tick_duration_ms");
    expect(text).toContain("foghaven_anticheat_rejections_total");
    // From prom-client's collectDefaultMetrics() — confirms the free process
    // metrics (memory, event loop lag) are actually wired in, not just the
    // custom instruments above.
    expect(text).toContain("process_resident_memory_bytes");
    expect(text).toContain("nodejs_eventloop_lag_seconds");
  });
});
