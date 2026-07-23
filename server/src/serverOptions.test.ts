import { describe, expect, it, vi } from "vitest";
import type { Transport, Presence, ServerOptions } from "@colyseus/core";
import {
  resolveScalingMode,
  checkProdEnv,
  assertProdEnv,
  buildServerOptions,
  type EnvLike,
} from "./serverOptions";

/** A stand-in transport — buildServerOptions only ever passes it through, never calls it. */
const fakeTransport = {} as Transport;

describe("resolveScalingMode", () => {
  it("defaults to local", () => {
    expect(resolveScalingMode({})).toBe("local");
    expect(resolveScalingMode({ COLYSEUS_DRIVER: "" })).toBe("local");
    expect(resolveScalingMode({ COLYSEUS_DRIVER: "local" })).toBe("local");
  });

  it("selects redis only for the exact flag value", () => {
    expect(resolveScalingMode({ COLYSEUS_DRIVER: "redis" })).toBe("redis");
    expect(resolveScalingMode({ COLYSEUS_DRIVER: "REDIS" })).toBe("local");
  });
});

describe("checkProdEnv", () => {
  const base: EnvLike = {
    DATABASE_URL: "postgres://x",
    CLIENT_ORIGIN: "https://foghaven.example",
  };

  it("passes when the local-mode requirements are all present", () => {
    expect(checkProdEnv(base)).toEqual([]);
  });

  it("flags missing local-mode requirements", () => {
    const problems = checkProdEnv({});
    expect(problems.map((p) => p.key)).toEqual(["DATABASE_URL", "CLIENT_ORIGIN"]);
  });

  it("additionally requires REDIS_URL and PUBLIC_ADDRESS in redis mode", () => {
    const problems = checkProdEnv({ ...base, COLYSEUS_DRIVER: "redis" });
    expect(problems.map((p) => p.key)).toEqual(["REDIS_URL", "PUBLIC_ADDRESS"]);
  });

  it("passes in redis mode once those are supplied", () => {
    expect(
      checkProdEnv({
        ...base,
        COLYSEUS_DRIVER: "redis",
        REDIS_URL: "redis://x",
        PUBLIC_ADDRESS: "host:2567",
      }),
    ).toEqual([]);
  });
});

describe("assertProdEnv", () => {
  it("is a no-op outside production, even with everything missing", () => {
    const exit = vi.fn() as unknown as (code: number) => never;
    assertProdEnv({ NODE_ENV: "development" }, { exit, log: vi.fn() });
    expect(exit).not.toHaveBeenCalled();
  });

  it("exits(1) and logs the offenders in production when required vars are missing", () => {
    const exit = vi.fn() as unknown as (code: number) => never;
    const log = vi.fn();
    assertProdEnv({ NODE_ENV: "production" }, { exit, log });
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain("DATABASE_URL");
  });

  it("does not exit in production when the requirements are met", () => {
    const exit = vi.fn() as unknown as (code: number) => never;
    assertProdEnv(
      { NODE_ENV: "production", DATABASE_URL: "postgres://x", CLIENT_ORIGIN: "https://x" },
      { exit, log: vi.fn() },
    );
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("buildServerOptions", () => {
  it("returns just the transport in local mode (Colyseus keeps its in-memory defaults)", () => {
    const options = buildServerOptions({ transport: fakeTransport, env: {} });
    expect(options.transport).toBe(fakeTransport);
    expect(options.presence).toBeUndefined();
    expect(options.driver).toBeUndefined();
  });

  it("wires the shared presence, driver, and publicAddress in redis mode", () => {
    const presence = { kind: "presence" } as unknown as Presence;
    const driver = { kind: "driver" } as unknown as NonNullable<ServerOptions["driver"]>;
    const makePresence = vi.fn(() => presence);
    const makeDriver = vi.fn(() => driver);

    const options = buildServerOptions({
      transport: fakeTransport,
      env: { COLYSEUS_DRIVER: "redis", REDIS_URL: "redis://example:6379", PUBLIC_ADDRESS: "host:2567" },
      makePresence,
      makeDriver,
    });

    expect(makePresence).toHaveBeenCalledWith("redis://example:6379");
    expect(makeDriver).toHaveBeenCalledWith("redis://example:6379");
    expect(options.presence).toBe(presence);
    expect(options.driver).toBe(driver);
    expect(options.publicAddress).toBe("host:2567");
  });

  it("omits publicAddress in redis mode when it is not set", () => {
    const options = buildServerOptions({
      transport: fakeTransport,
      env: { COLYSEUS_DRIVER: "redis", REDIS_URL: "redis://example:6379" },
      makePresence: vi.fn(() => ({}) as unknown as Presence),
      makeDriver: vi.fn(() => ({}) as unknown as NonNullable<ServerOptions["driver"]>),
    });
    expect(options.publicAddress).toBeUndefined();
  });
});
