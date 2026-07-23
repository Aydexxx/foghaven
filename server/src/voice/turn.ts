import { createHmac } from "node:crypto";
import type { IceServerConfig } from "@foghaven/shared";

/**
 * ICE server configuration for the proximity-voice WebRTC mesh, assembled from
 * the environment. Two things live here, and both exist because a plain STUN
 * setup is not enough for a real deployment:
 *
 *   - STUN lets two peers discover their public addresses and, for most NATs,
 *     connect directly. Free and always worth having.
 *   - TURN is the relay of last resort. A player behind a *symmetric* NAT
 *     (common on mobile networks and strict corporate firewalls) cannot be
 *     reached by any direct candidate at all — every one of their peers must
 *     bounce audio off a TURN server or hear nothing. This is why TURN is
 *     mandatory, not optional: without it, some fraction of players are simply
 *     mute to everyone, seemingly at random.
 *
 * TURN credentials are minted per request using coturn's standard time-limited
 * REST scheme (`use-auth-secret` / `static-auth-secret`), so the long-lived
 * shared secret never leaves the server — each client gets a username/password
 * pair that expires on its own. See `turnCredentials`.
 */

/** Default public STUN server, used when `VOICE_STUN_URLS` is unset. */
const DEFAULT_STUN_URLS = ["stun:stun.l.google.com:19302"];

/** How long a minted TURN credential stays valid, in seconds. */
const DEFAULT_TURN_TTL_SECONDS = 12 * 60 * 60;

/**
 * A username/credential pair for coturn's time-limited REST scheme. The
 * username is `<unix-expiry>:<name>` and the credential is the base64 HMAC-SHA1
 * of that username under the shared secret — exactly what coturn recomputes and
 * checks on its side, so no per-user state is stored anywhere. Pure and
 * `now`-injectable so it can be tested without the clock.
 */
export function turnCredentials(
  secret: string,
  ttlSeconds: number,
  name: string,
  now: number = Date.now(),
): { username: string; credential: string } {
  const expiry = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expiry}:${name}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential };
}

/** Split a comma-separated env list into trimmed, non-empty entries. */
function envList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Build the ICE server list a client should use, freshly per call so TURN
 * credentials are always well within their TTL when they arrive. Reads:
 *
 *   - `VOICE_STUN_URLS`  — comma-separated STUN urls (defaults to a public one)
 *   - `VOICE_TURN_URLS`  — comma-separated TURN urls; TURN is off if unset
 *   - `VOICE_TURN_SECRET` (+ optional `VOICE_TURN_TTL_SECONDS`) — enables the
 *     time-limited REST scheme above
 *   - `VOICE_TURN_USERNAME` / `VOICE_TURN_CREDENTIAL` — a static long-term
 *     credential instead, for a TURN server not configured with a shared secret
 *
 * A deployment with no TURN configured still returns STUN, so direct-path
 * players work in development; the symmetric-NAT case is what needs TURN in
 * production, and the env is where that gets switched on.
 */
export function buildIceServers(now: number = Date.now()): IceServerConfig[] {
  const servers: IceServerConfig[] = [];

  const stunUrls = envList(process.env.VOICE_STUN_URLS);
  servers.push({ urls: stunUrls.length > 0 ? stunUrls : DEFAULT_STUN_URLS });

  const turnUrls = envList(process.env.VOICE_TURN_URLS);
  if (turnUrls.length === 0) {
    return servers;
  }

  const secret = process.env.VOICE_TURN_SECRET?.trim();
  if (secret) {
    const ttl = Number(process.env.VOICE_TURN_TTL_SECONDS) || DEFAULT_TURN_TTL_SECONDS;
    const { username, credential } = turnCredentials(secret, ttl, "foghaven", now);
    servers.push({ urls: turnUrls, username, credential });
    return servers;
  }

  const staticUser = process.env.VOICE_TURN_USERNAME?.trim();
  const staticCredential = process.env.VOICE_TURN_CREDENTIAL?.trim();
  if (staticUser && staticCredential) {
    servers.push({ urls: turnUrls, username: staticUser, credential: staticCredential });
  }

  return servers;
}
