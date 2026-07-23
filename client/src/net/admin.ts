/**
 * Client half of the moderation panel's API — `/admin` (see
 * `server/src/http/adminRoutes.ts`).
 *
 * Every call carries the bearer token and every route re-checks the caller's
 * role server-side, so nothing here is a security boundary: hiding the panel
 * from a player who isn't a moderator is a courtesy, and editing
 * `localStorage` to claim otherwise gets you a wall of 403s.
 */

import type { ReportReason, ReportStatus, UserRole } from "@foghaven/shared";

export interface AdminReport {
  id: string;
  reporterId: string | null;
  reporterName: string;
  reportedId: string;
  reportedName: string;
  reason: ReportReason;
  note: string | null;
  roomCode: string;
  status: ReportStatus;
  createdAt: string;
  chatExcerpt: Array<{ senderName: string; text: string; sentAt: string }>;
  reviewedById: string | null;
  reviewedAt: string | null;
  resolution: string | null;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  banned: boolean;
  banReason: string | null;
  banUntil: string | null;
  createdAt: string;
  reportsAgainst: number;
}

export interface BanHistoryEntry {
  id: string;
  reason: string;
  until: string | null;
  createdAt: string;
  liftedAt: string | null;
  issuedById: string | null;
}

export interface AdminChatEntry {
  roomCode: string;
  userId: string | null;
  senderName: string;
  channel: string;
  text: string;
  filtered: boolean;
  sentAt: string;
}

/** A failed admin call, carrying the server's stable error code. */
export class AdminError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "AdminError";
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

async function call(token: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${baseUrl()}/admin${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) {
    return undefined;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AdminError((data as { error?: string }).error ?? "unknown", res.status);
  }
  return data;
}

/** Confirm the caller really does have moderation powers, per the server. */
export async function fetchAdminIdentity(
  token: string,
): Promise<{ userId: string; role: UserRole } | null> {
  try {
    return (await call(token, "GET", "/me")) as { userId: string; role: UserRole };
  } catch {
    return null;
  }
}

/**
 * Deliberately throws server-side (`GET /admin/debug/test-error`) — the
 * repeatable "does Sentry actually work here?" check alongside
 * `AdminPanel`'s client-side test-error button. Admin-only.
 */
export async function sendServerTestError(token: string): Promise<void> {
  await call(token, "GET", "/debug/test-error");
}

export async function listReports(token: string, status: ReportStatus | null): Promise<AdminReport[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = (await call(token, "GET", `/reports${query}`)) as { reports: AdminReport[] };
  return data.reports;
}

export async function resolveReport(
  token: string,
  id: string,
  status: ReportStatus,
  resolution: string,
): Promise<AdminReport> {
  const data = (await call(token, "POST", `/reports/${id}/resolve`, { status, resolution })) as {
    report: AdminReport;
  };
  return data.report;
}

export async function searchUsers(token: string, query: string): Promise<AdminUser[]> {
  const data = (await call(token, "GET", `/users?q=${encodeURIComponent(query)}`)) as {
    users: AdminUser[];
  };
  return data.users;
}

export async function getUser(
  token: string,
  userId: string,
): Promise<{ user: AdminUser; banHistory: BanHistoryEntry[] }> {
  return (await call(token, "GET", `/users/${userId}`)) as {
    user: AdminUser;
    banHistory: BanHistoryEntry[];
  };
}

export async function banUser(
  token: string,
  userId: string,
  reason: string,
  until: string | null,
): Promise<AdminUser> {
  const data = (await call(token, "POST", `/users/${userId}/ban`, { reason, until })) as {
    user: AdminUser;
  };
  return data.user;
}

export async function unbanUser(token: string, userId: string): Promise<AdminUser> {
  const data = (await call(token, "POST", `/users/${userId}/unban`)) as { user: AdminUser };
  return data.user;
}

export async function setUserRole(
  token: string,
  userId: string,
  role: UserRole,
): Promise<AdminUser> {
  const data = (await call(token, "POST", `/users/${userId}/role`, { role })) as { user: AdminUser };
  return data.user;
}

export async function fetchChatLog(token: string, roomCode: string): Promise<AdminChatEntry[]> {
  const data = (await call(token, "GET", `/chat?roomCode=${encodeURIComponent(roomCode)}`)) as {
    entries: AdminChatEntry[];
  };
  return data.entries;
}
