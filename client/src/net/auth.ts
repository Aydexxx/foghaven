/**
 * Client half of the account system: talking to the `/auth` HTTP API and
 * remembering who is signed in.
 *
 * The auth token lives in `localStorage` under its own key, separate from the
 * reconnection seat (`net/session.ts`) — they have different lifetimes, a token
 * outlives any single room. The token is the one thing that proves identity to
 * the server; it is sent as a join option and re-verified server-side on every
 * join (see `GameRoom.onAuth`), so nothing here is trusted on its own.
 */

/** A user as the server exposes it — never includes a password hash. */
export interface PublicUser {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  banned: boolean;
  banReason: string | null;
  banUntil: string | null;
}

export interface AuthSession {
  token: string;
  user: PublicUser;
}

/** A failed auth call, carrying the server's stable error code for i18n. */
export class AuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly ban?: { reason: string | null; until: string | null },
  ) {
    super(code);
    this.name = "AuthError";
  }
}

const STORAGE_KEY = "foghaven.auth";

/** The auth API base, derived from the game server URL (ws→http) unless overridden. */
function authBaseUrl(): string {
  const override = import.meta.env.VITE_AUTH_URL;
  if (override) {
    return override.replace(/\/$/, "");
  }
  const server = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";
  return server.replace(/^ws/, "http").replace(/\/$/, "");
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${authBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function toSession(res: Response): Promise<AuthSession> {
  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    user?: PublicUser;
    error?: string;
    ban?: { reason: string | null; until: string | null };
  };
  if (!res.ok || !data.token || !data.user) {
    throw new AuthError(data.error ?? "unknown", res.status, data.ban);
  }
  return { token: data.token, user: data.user };
}

export async function register(
  email: string,
  username: string,
  password: string,
): Promise<AuthSession> {
  return toSession(await post("/auth/register", { email, username, password }));
}

export async function login(identifier: string, password: string): Promise<AuthSession> {
  return toSession(await post("/auth/login", { identifier, password }));
}

/** Revalidate a stored token against the server; null if it's no longer good. */
export async function fetchMe(token: string): Promise<PublicUser | null> {
  try {
    const res = await fetch(`${authBaseUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { user?: PublicUser };
    return data.user ?? null;
  } catch {
    return null;
  }
}

// --- Persistence -----------------------------------------------------------

export function saveAuth(session: AuthSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage can be unavailable (private mode, quota). Staying signed in is a
    // convenience; losing it must never break playing.
  }
}

export function loadAuth(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (typeof parsed.token === "string" && parsed.user && typeof parsed.user.username === "string") {
      return { token: parsed.token, user: parsed.user as PublicUser };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See saveAuth.
  }
}
