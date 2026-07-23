import type { PrismaClient, FriendRequestStatus as PrismaFriendRequestStatus } from "@prisma/client";
import type { Result } from "../auth/provider";

/**
 * The friend service, behind one interface with two implementations —
 * `PrismaFriendProvider` (real Postgres, wired at boot in `index.ts`) and
 * `InMemoryFriendProvider` (tests) — the same seam `auth/provider.ts` uses
 * and for the same reason: tests exercise the real add/accept/block logic
 * with no database.
 *
 * Unlike `AuthProvider`, there is no shared `BaseFriendProvider`: the two
 * backends' natural query shapes (one relational query with an `OR` and an
 * `include`, vs. filtering a `Map` by hand) diverge enough that forcing them
 * through shared primitives would cost more code than it saves, so each
 * implements the public interface directly.
 */

// --- Public shapes -----------------------------------------------------

export interface FriendUserRef {
  id: string;
  username: string;
}

export type FriendRequestStatus = "PENDING" | "ACCEPTED";

export interface FriendRequestSummary {
  id: string;
  requester: FriendUserRef;
  addressee: FriendUserRef;
  status: FriendRequestStatus;
  createdAt: string;
}

export type SendRequestError =
  | "not_found"
  | "self"
  | "already_friends"
  | "already_pending"
  | "blocked";
export type RespondError = "not_found" | "forbidden";
export type RemoveFriendError = "not_found";
export type BlockError = "not_found" | "self";

export interface FriendProvider {
  /**
   * Send a request by username. A crossed request — the target already has a
   * pending request in to this sender — is auto-accepted instead of creating
   * a second row, so two people who both hit "add" land as friends
   * immediately rather than both waiting on the other.
   */
  sendRequest(
    fromUserId: string,
    toUsername: string,
  ): Promise<Result<FriendRequestSummary, SendRequestError>>;
  acceptRequest(userId: string, requestId: string): Promise<Result<FriendUserRef, RespondError>>;
  /** Declines an incoming request or withdraws one this user sent — either party to a pending row may end it. */
  declineRequest(userId: string, requestId: string): Promise<Result<void, RespondError>>;
  removeFriend(userId: string, friendUserId: string): Promise<Result<void, RemoveFriendError>>;
  listFriends(userId: string): Promise<FriendUserRef[]>;
  listIncomingRequests(userId: string): Promise<FriendRequestSummary[]>;
  listOutgoingRequests(userId: string): Promise<FriendRequestSummary[]>;
  /** Blocking severs any existing friendship/pending request between the two, in both directions. */
  block(userId: string, targetUsername: string): Promise<Result<FriendUserRef, BlockError>>;
  /** Idempotent — unblocking someone who was never blocked is not an error. */
  unblock(userId: string, targetUserId: string): Promise<void>;
  listBlocked(userId: string): Promise<FriendUserRef[]>;
  areFriends(userIdA: string, userIdB: string): Promise<boolean>;
  /** True if either side has blocked the other. */
  isBlocked(userIdA: string, userIdB: string): Promise<boolean>;
}

// --- Prisma implementation ----------------------------------------------

export class PrismaFriendProvider implements FriendProvider {
  constructor(private readonly prisma: PrismaClient) {}

  async sendRequest(
    fromUserId: string,
    toUsername: string,
  ): Promise<Result<FriendRequestSummary, SendRequestError>> {
    const target = await this.prisma.user.findUnique({
      where: { usernameLower: toUsername.trim().toLowerCase() },
    });
    if (!target) {
      return { ok: false, error: "not_found" };
    }
    if (target.id === fromUserId) {
      return { ok: false, error: "self" };
    }
    if (await this.isBlocked(fromUserId, target.id)) {
      return { ok: false, error: "blocked" };
    }

    const forward = await this.prisma.friendRequest.findUnique({
      where: { requesterId_addresseeId: { requesterId: fromUserId, addresseeId: target.id } },
    });
    if (forward) {
      return { ok: false, error: forward.status === "ACCEPTED" ? "already_friends" : "already_pending" };
    }

    // Crossed request: the target already asked this user — accept theirs
    // rather than creating a redundant second row.
    const reverse = await this.prisma.friendRequest.findUnique({
      where: { requesterId_addresseeId: { requesterId: target.id, addresseeId: fromUserId } },
    });
    if (reverse) {
      if (reverse.status === "ACCEPTED") {
        return { ok: false, error: "already_friends" };
      }
      const accepted = await this.prisma.friendRequest.update({
        where: { id: reverse.id },
        data: { status: "ACCEPTED", respondedAt: new Date() },
        include: { requester: true, addressee: true },
      });
      return { ok: true, value: toSummary(accepted) };
    }

    const created = await this.prisma.friendRequest.create({
      data: { requesterId: fromUserId, addresseeId: target.id },
      include: { requester: true, addressee: true },
    });
    return { ok: true, value: toSummary(created) };
  }

  async acceptRequest(
    userId: string,
    requestId: string,
  ): Promise<Result<FriendUserRef, RespondError>> {
    const request = await this.prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== "PENDING") {
      return { ok: false, error: "not_found" };
    }
    if (request.addresseeId !== userId) {
      return { ok: false, error: "forbidden" };
    }
    const updated = await this.prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: "ACCEPTED", respondedAt: new Date() },
      include: { requester: true },
    });
    return { ok: true, value: { id: updated.requester.id, username: updated.requester.username } };
  }

  async declineRequest(userId: string, requestId: string): Promise<Result<void, RespondError>> {
    const request = await this.prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== "PENDING") {
      return { ok: false, error: "not_found" };
    }
    if (request.requesterId !== userId && request.addresseeId !== userId) {
      return { ok: false, error: "forbidden" };
    }
    await this.prisma.friendRequest.delete({ where: { id: requestId } });
    return { ok: true, value: undefined };
  }

  async removeFriend(
    userId: string,
    friendUserId: string,
  ): Promise<Result<void, RemoveFriendError>> {
    const existing = await this.findAcceptedBetween(userId, friendUserId);
    if (!existing) {
      return { ok: false, error: "not_found" };
    }
    await this.prisma.friendRequest.delete({ where: { id: existing.id } });
    return { ok: true, value: undefined };
  }

  async listFriends(userId: string): Promise<FriendUserRef[]> {
    const rows = await this.prisma.friendRequest.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
      include: { requester: true, addressee: true },
    });
    return rows.map((row) => {
      const other = row.requesterId === userId ? row.addressee : row.requester;
      return { id: other.id, username: other.username };
    });
  }

  async listIncomingRequests(userId: string): Promise<FriendRequestSummary[]> {
    const rows = await this.prisma.friendRequest.findMany({
      where: { addresseeId: userId, status: "PENDING" },
      include: { requester: true, addressee: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toSummary);
  }

  async listOutgoingRequests(userId: string): Promise<FriendRequestSummary[]> {
    const rows = await this.prisma.friendRequest.findMany({
      where: { requesterId: userId, status: "PENDING" },
      include: { requester: true, addressee: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toSummary);
  }

  async block(userId: string, targetUsername: string): Promise<Result<FriendUserRef, BlockError>> {
    const target = await this.prisma.user.findUnique({
      where: { usernameLower: targetUsername.trim().toLowerCase() },
    });
    if (!target) {
      return { ok: false, error: "not_found" };
    }
    if (target.id === userId) {
      return { ok: false, error: "self" };
    }

    const existing = await this.findAcceptedBetween(userId, target.id, true);
    if (existing) {
      await this.prisma.friendRequest.delete({ where: { id: existing.id } });
    }
    await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId: userId, blockedId: target.id } },
      create: { blockerId: userId, blockedId: target.id },
      update: {},
    });
    return { ok: true, value: { id: target.id, username: target.username } };
  }

  async unblock(userId: string, targetUserId: string): Promise<void> {
    await this.prisma.block
      .delete({ where: { blockerId_blockedId: { blockerId: userId, blockedId: targetUserId } } })
      .catch(() => undefined);
  }

  async listBlocked(userId: string): Promise<FriendUserRef[]> {
    const rows = await this.prisma.block.findMany({
      where: { blockerId: userId },
      include: { blocked: true },
    });
    return rows.map((row) => ({ id: row.blocked.id, username: row.blocked.username }));
  }

  async areFriends(userIdA: string, userIdB: string): Promise<boolean> {
    return (await this.findAcceptedBetween(userIdA, userIdB)) !== null;
  }

  async isBlocked(userIdA: string, userIdB: string): Promise<boolean> {
    const row = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userIdA, blockedId: userIdB },
          { blockerId: userIdB, blockedId: userIdA },
        ],
      },
      select: { id: true },
    });
    return row !== null;
  }

  /** Any request (pending or accepted) between the two, in either direction. */
  private async findAcceptedBetween(userIdA: string, userIdB: string, anyStatus = false) {
    return this.prisma.friendRequest.findFirst({
      where: {
        status: anyStatus ? undefined : "ACCEPTED",
        OR: [
          { requesterId: userIdA, addresseeId: userIdB },
          { requesterId: userIdB, addresseeId: userIdA },
        ],
      },
    });
  }
}

function toSummary(row: {
  id: string;
  status: PrismaFriendRequestStatus;
  createdAt: Date;
  requester: { id: string; username: string };
  addressee: { id: string; username: string };
}): FriendRequestSummary {
  return {
    id: row.id,
    requester: { id: row.requester.id, username: row.requester.username },
    addressee: { id: row.addressee.id, username: row.addressee.username },
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

// --- In-memory implementation (tests) ------------------------------------

interface StoredRequest {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendRequestStatus;
  createdAt: Date;
}

/**
 * A RAM-backed provider for tests. Exposes `registerUser` so a test can
 * declare a username→id mapping directly, mirroring how
 * `InMemoryAuthProvider.seedUser` arranges an account without a real
 * register flow — the two are typically seeded together in a test that
 * exercises both auth and friends.
 */
export class InMemoryFriendProvider implements FriendProvider {
  private readonly users = new Map<string, FriendUserRef>();
  private readonly requests = new Map<string, StoredRequest>();
  /** blockerId -> Set<blockedId> */
  private readonly blocks = new Map<string, Set<string>>();
  private nextId = 1;

  registerUser(user: FriendUserRef): void {
    this.users.set(user.id, user);
  }

  private ref(id: string): FriendUserRef {
    return this.users.get(id) ?? { id, username: id };
  }

  private findByUsernameLower(usernameLower: string): FriendUserRef | null {
    for (const user of this.users.values()) {
      if (user.username.toLowerCase() === usernameLower) {
        return user;
      }
    }
    return null;
  }

  private findBetween(userIdA: string, userIdB: string, status?: FriendRequestStatus) {
    for (const request of this.requests.values()) {
      const between =
        (request.requesterId === userIdA && request.addresseeId === userIdB) ||
        (request.requesterId === userIdB && request.addresseeId === userIdA);
      if (between && (status === undefined || request.status === status)) {
        return request;
      }
    }
    return null;
  }

  private findDirected(requesterId: string, addresseeId: string) {
    for (const request of this.requests.values()) {
      if (request.requesterId === requesterId && request.addresseeId === addresseeId) {
        return request;
      }
    }
    return null;
  }

  private toSummary(request: StoredRequest): FriendRequestSummary {
    return {
      id: request.id,
      requester: this.ref(request.requesterId),
      addressee: this.ref(request.addresseeId),
      status: request.status,
      createdAt: request.createdAt.toISOString(),
    };
  }

  async sendRequest(
    fromUserId: string,
    toUsername: string,
  ): Promise<Result<FriendRequestSummary, SendRequestError>> {
    const target = this.findByUsernameLower(toUsername.trim().toLowerCase());
    if (!target) {
      return { ok: false, error: "not_found" };
    }
    if (target.id === fromUserId) {
      return { ok: false, error: "self" };
    }
    if (await this.isBlocked(fromUserId, target.id)) {
      return { ok: false, error: "blocked" };
    }

    const forward = this.findDirected(fromUserId, target.id);
    if (forward) {
      return { ok: false, error: forward.status === "ACCEPTED" ? "already_friends" : "already_pending" };
    }

    const reverse = this.findDirected(target.id, fromUserId);
    if (reverse) {
      if (reverse.status === "ACCEPTED") {
        return { ok: false, error: "already_friends" };
      }
      reverse.status = "ACCEPTED";
      return { ok: true, value: this.toSummary(reverse) };
    }

    const request: StoredRequest = {
      id: `freq_${this.nextId++}`,
      requesterId: fromUserId,
      addresseeId: target.id,
      status: "PENDING",
      createdAt: new Date(),
    };
    this.requests.set(request.id, request);
    return { ok: true, value: this.toSummary(request) };
  }

  async acceptRequest(
    userId: string,
    requestId: string,
  ): Promise<Result<FriendUserRef, RespondError>> {
    const request = this.requests.get(requestId);
    if (!request || request.status !== "PENDING") {
      return { ok: false, error: "not_found" };
    }
    if (request.addresseeId !== userId) {
      return { ok: false, error: "forbidden" };
    }
    request.status = "ACCEPTED";
    return { ok: true, value: this.ref(request.requesterId) };
  }

  async declineRequest(userId: string, requestId: string): Promise<Result<void, RespondError>> {
    const request = this.requests.get(requestId);
    if (!request || request.status !== "PENDING") {
      return { ok: false, error: "not_found" };
    }
    if (request.requesterId !== userId && request.addresseeId !== userId) {
      return { ok: false, error: "forbidden" };
    }
    this.requests.delete(requestId);
    return { ok: true, value: undefined };
  }

  async removeFriend(
    userId: string,
    friendUserId: string,
  ): Promise<Result<void, RemoveFriendError>> {
    const existing = this.findBetween(userId, friendUserId, "ACCEPTED");
    if (!existing) {
      return { ok: false, error: "not_found" };
    }
    this.requests.delete(existing.id);
    return { ok: true, value: undefined };
  }

  async listFriends(userId: string): Promise<FriendUserRef[]> {
    const out: FriendUserRef[] = [];
    for (const request of this.requests.values()) {
      if (request.status !== "ACCEPTED") {
        continue;
      }
      if (request.requesterId === userId) {
        out.push(this.ref(request.addresseeId));
      } else if (request.addresseeId === userId) {
        out.push(this.ref(request.requesterId));
      }
    }
    return out;
  }

  async listIncomingRequests(userId: string): Promise<FriendRequestSummary[]> {
    return [...this.requests.values()]
      .filter((r) => r.addresseeId === userId && r.status === "PENDING")
      .map((r) => this.toSummary(r));
  }

  async listOutgoingRequests(userId: string): Promise<FriendRequestSummary[]> {
    return [...this.requests.values()]
      .filter((r) => r.requesterId === userId && r.status === "PENDING")
      .map((r) => this.toSummary(r));
  }

  async block(userId: string, targetUsername: string): Promise<Result<FriendUserRef, BlockError>> {
    const target = this.findByUsernameLower(targetUsername.trim().toLowerCase());
    if (!target) {
      return { ok: false, error: "not_found" };
    }
    if (target.id === userId) {
      return { ok: false, error: "self" };
    }
    const existing = this.findBetween(userId, target.id);
    if (existing) {
      this.requests.delete(existing.id);
    }
    if (!this.blocks.has(userId)) {
      this.blocks.set(userId, new Set());
    }
    this.blocks.get(userId)?.add(target.id);
    return { ok: true, value: target };
  }

  async unblock(userId: string, targetUserId: string): Promise<void> {
    this.blocks.get(userId)?.delete(targetUserId);
  }

  async listBlocked(userId: string): Promise<FriendUserRef[]> {
    return [...(this.blocks.get(userId) ?? [])].map((id) => this.ref(id));
  }

  async areFriends(userIdA: string, userIdB: string): Promise<boolean> {
    return this.findBetween(userIdA, userIdB, "ACCEPTED") !== null;
  }

  async isBlocked(userIdA: string, userIdB: string): Promise<boolean> {
    return Boolean(this.blocks.get(userIdA)?.has(userIdB) || this.blocks.get(userIdB)?.has(userIdA));
  }

  /** Test convenience: block directly by id, skipping the username lookup `block()` does. */
  seedBlock(blockerId: string, blockedId: string): void {
    if (!this.blocks.has(blockerId)) {
      this.blocks.set(blockerId, new Set());
    }
    this.blocks.get(blockerId)?.add(blockedId);
  }

  /** Test convenience: mark two ids as accepted friends directly, skipping `sendRequest`/`acceptRequest`. */
  seedFriendship(userIdA: string, userIdB: string): void {
    const request: StoredRequest = {
      id: `freq_${this.nextId++}`,
      requesterId: userIdA,
      addresseeId: userIdB,
      status: "ACCEPTED",
      createdAt: new Date(),
    };
    this.requests.set(request.id, request);
  }

  reset(): void {
    this.users.clear();
    this.requests.clear();
    this.blocks.clear();
    this.nextId = 1;
  }
}

// --- Swappable registry ----------------------------------------------------

let current: FriendProvider | null = null;

/** Install the process-wide provider — Prisma at boot, in-memory in tests. */
export function setFriendProvider(provider: FriendProvider | null): void {
  current = provider;
}

/** The active provider. Throws if none is installed, so a misconfigured boot fails loudly. */
export function getFriendProvider(): FriendProvider {
  if (!current) {
    throw new Error("No FriendProvider configured — call setFriendProvider() during boot.");
  }
  return current;
}
