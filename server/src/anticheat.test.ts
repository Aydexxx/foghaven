import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "./logger";
import { anticheatRejections } from "./metrics";
import { logAntiCheatEvent } from "./anticheat";

function fakeLogger(): Logger {
  return { warn: vi.fn() } as unknown as Logger;
}

beforeEach(() => {
  anticheatRejections.reset();
});

describe("logAntiCheatEvent", () => {
  it("logs a structured warning tagged with the reason, sessionId and userId", () => {
    const log = fakeLogger();
    logAntiCheatEvent(log, "ability_cooldown", {
      sessionId: "sess-1",
      userId: "user-1",
      detail: { ability: "kill" },
    });

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "anticheat_reject",
        reason: "ability_cooldown",
        sessionId: "sess-1",
        userId: "user-1",
        detail: { ability: "kill" },
      }),
      expect.stringContaining("ability_cooldown"),
    );
  });

  it("defaults userId to null when not provided (e.g. a guest, or an unresolved session)", () => {
    const log = fakeLogger();
    logAntiCheatEvent(log, "report_fog_of_war", { sessionId: "sess-2" });

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null }),
      expect.any(String),
    );
  });

  it("increments the anticheatRejections counter for the given reason", async () => {
    const log = fakeLogger();
    logAntiCheatEvent(log, "chat_rate_limit", { sessionId: "sess-3" });
    logAntiCheatEvent(log, "chat_rate_limit", { sessionId: "sess-4" });
    logAntiCheatEvent(log, "meeting_quota", { sessionId: "sess-5" });

    const { values } = await anticheatRejections.get();
    const chat = values.find((v) => v.labels.reason === "chat_rate_limit");
    const meeting = values.find((v) => v.labels.reason === "meeting_quota");
    expect(chat?.value).toBe(2);
    expect(meeting?.value).toBe(1);
  });
});
