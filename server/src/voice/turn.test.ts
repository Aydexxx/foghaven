import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { buildIceServers, turnCredentials } from "./turn";

describe("turnCredentials", () => {
  it("builds a coturn REST username of <expiry>:<name> and an HMAC-SHA1 base64 credential", () => {
    const now = 1_700_000_000_000; // fixed ms
    const { username, credential } = turnCredentials("s3cret", 3600, "foghaven", now);

    expect(username).toBe(`${Math.floor(now / 1000) + 3600}:foghaven`);
    const expected = createHmac("sha1", "s3cret").update(username).digest("base64");
    expect(credential).toBe(expected);
  });

  it("advances the expiry with the clock so a later request mints a longer-lived credential", () => {
    const a = turnCredentials("s", 60, "n", 1_000_000);
    const b = turnCredentials("s", 60, "n", 2_000_000);
    expect(a.username).not.toBe(b.username);
  });
});

describe("buildIceServers", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.VOICE_STUN_URLS;
    delete process.env.VOICE_TURN_URLS;
    delete process.env.VOICE_TURN_SECRET;
    delete process.env.VOICE_TURN_TTL_SECONDS;
    delete process.env.VOICE_TURN_USERNAME;
    delete process.env.VOICE_TURN_CREDENTIAL;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns a default STUN server and no TURN when nothing is configured", () => {
    const servers = buildIceServers();
    expect(servers).toHaveLength(1);
    expect(servers[0]!.urls).toEqual(["stun:stun.l.google.com:19302"]);
    expect(servers[0]!.credential).toBeUndefined();
  });

  it("adds a TURN entry with time-limited credentials when a secret is set", () => {
    process.env.VOICE_TURN_URLS = "turn:turn.example.com:3478,turns:turn.example.com:5349";
    process.env.VOICE_TURN_SECRET = "shared-secret";
    const now = 1_700_000_000_000;

    const servers = buildIceServers(now);
    expect(servers).toHaveLength(2);
    const turn = servers[1]!;
    expect(turn.urls).toEqual([
      "turn:turn.example.com:3478",
      "turns:turn.example.com:5349",
    ]);
    expect(turn.username).toBe(turnCredentials("shared-secret", 12 * 60 * 60, "foghaven", now).username);
    expect(turn.credential).toBeTruthy();
  });

  it("uses a static long-term credential when no secret is given", () => {
    process.env.VOICE_TURN_URLS = "turn:turn.example.com:3478";
    process.env.VOICE_TURN_USERNAME = "alice";
    process.env.VOICE_TURN_CREDENTIAL = "hunter2";

    const servers = buildIceServers();
    expect(servers).toHaveLength(2);
    expect(servers[1]).toMatchObject({ username: "alice", credential: "hunter2" });
  });

  it("omits TURN entirely when urls are set but no credentials are available", () => {
    process.env.VOICE_TURN_URLS = "turn:turn.example.com:3478";
    const servers = buildIceServers();
    expect(servers).toHaveLength(1);
  });

  it("honours a custom STUN list", () => {
    process.env.VOICE_STUN_URLS = "stun:stun1.example.com:3478, stun:stun2.example.com:3478";
    const servers = buildIceServers();
    expect(servers[0]!.urls).toEqual([
      "stun:stun1.example.com:3478",
      "stun:stun2.example.com:3478",
    ]);
  });
});
