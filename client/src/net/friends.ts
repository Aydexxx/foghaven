/**
 * Client half of the friend system's HTTP surface — `/friends`, mounted
 * alongside `/auth` (see `server/src/http/friendRoutes.ts`). Every call needs
 * a bearer token; there is no guest path here (see that file's own doc for
 * why), so this module is never reachable from a guest session.
 */

export interface FriendUserRef {
  id: string;
  username: string;
}

export interface Friend extends FriendUserRef {
  online: boolean;
}

export interface FriendRequestSummary {
  id: string;
  requester: FriendUserRef;
  addressee: FriendUserRef;
  status: "PENDING" | "ACCEPTED";
  createdAt: string;
}

/** A failed friend-API call, carrying the server's stable error code for i18n. */
export class FriendError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "FriendError";
  }
}

/** The friends API base — same derivation as `net/auth.ts`'s `authBaseUrl`. */
function baseUrl(): string {
  const override = import.meta.env.VITE_AUTH_URL;
  if (override) {
    return override.replace(/\/$/, "");
  }
  const server = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";
  return server.replace(/^ws/, "http").replace(/\/$/, "");
}

async function call(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${baseUrl()}/friends${path}`, {
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
    throw new FriendError((data as { error?: string }).error ?? "unknown", res.status);
  }
  return data;
}

export async function listFriends(token: string): Promise<Friend[]> {
  const data = (await call(token, "GET", "/")) as { friends: Friend[] };
  return data.friends;
}

export async function listFriendRequests(
  token: string,
): Promise<{ incoming: FriendRequestSummary[]; outgoing: FriendRequestSummary[] }> {
  return (await call(token, "GET", "/requests")) as {
    incoming: FriendRequestSummary[];
    outgoing: FriendRequestSummary[];
  };
}

export async function sendFriendRequest(
  token: string,
  username: string,
): Promise<FriendRequestSummary> {
  const data = (await call(token, "POST", "/requests", { username })) as {
    request: FriendRequestSummary;
  };
  return data.request;
}

export async function acceptFriendRequest(token: string, requestId: string): Promise<FriendUserRef> {
  const data = (await call(token, "POST", `/requests/${requestId}/accept`)) as {
    friend: FriendUserRef;
  };
  return data.friend;
}

export async function declineFriendRequest(token: string, requestId: string): Promise<void> {
  await call(token, "POST", `/requests/${requestId}/decline`);
}

export async function removeFriend(token: string, userId: string): Promise<void> {
  await call(token, "DELETE", `/${userId}`);
}

export async function listBlocked(token: string): Promise<FriendUserRef[]> {
  const data = (await call(token, "GET", "/blocked")) as { blocked: FriendUserRef[] };
  return data.blocked;
}

export async function blockUser(token: string, username: string): Promise<FriendUserRef> {
  const data = (await call(token, "POST", "/blocked", { username })) as {
    blocked: FriendUserRef;
  };
  return data.blocked;
}

export async function unblockUser(token: string, userId: string): Promise<void> {
  await call(token, "DELETE", `/blocked/${userId}`);
}
