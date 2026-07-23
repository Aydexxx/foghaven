/**
 * Client half of the stats HTTP surface — `/stats` (see
 * `server/src/http/statsRoutes.ts`). One route, the caller's own lifetime
 * stat line; there is no way to ask for anyone else's, on purpose — see the
 * project note on why there is no global leaderboard.
 */

import type { PlayerStats } from "@foghaven/shared";

/** A failed stats-API call, carrying the server's stable error code. */
export class StatsError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "StatsError";
  }
}

/** Same derivation as `net/auth.ts`'s `authBaseUrl`. */
function baseUrl(): string {
  const override = import.meta.env.VITE_AUTH_URL;
  if (override) {
    return override.replace(/\/$/, "");
  }
  const server = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";
  return server.replace(/^ws/, "http").replace(/\/$/, "");
}

export async function fetchStats(token: string): Promise<PlayerStats> {
  const res = await fetch(`${baseUrl()}/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new StatsError((data as { error?: string }).error ?? "unknown", res.status);
  }
  return (data as { stats: PlayerStats }).stats;
}
