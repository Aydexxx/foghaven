import type { PrismaClient } from "@prisma/client";
import {
  REPORT_STATUS,
  USER_ROLE,
  type ReportReason,
  type ReportStatus,
  type UserRole,
} from "@foghaven/shared";

/**
 * The moderation service: reports, retained chat, bans and their history,
 * behind one interface with a Prisma implementation for production and an
 * in-memory one for tests — the same seam `auth/provider.ts` and
 * `friends/provider.ts` use, and for the same reason (the suite runs with no
 * database).
 *
 * Ban *state* deliberately stays on the `User` row rather than being derived
 * from this table: `GameRoom.onAuth` re-reads that row on every single join,
 * and making the ban check a query over ban history instead would put a scan
 * on the hot path of every join for no benefit. {@link BanRecord} is the audit
 * trail of how that state got there, written in the same transaction.
 */

// --- Public shapes ---------------------------------------------------------

/** One retained chat line, as stored and as snapshotted onto a report. */
export interface ChatLogEntry {
  roomCode: string;
  userId: string | null;
  senderName: string;
  channel: string;
  text: string;
  /** Whether the filter masked or blocked this line when it was sent. */
  filtered: boolean;
  sentAt: Date;
}

export interface NewReport {
  reporterId: string | null;
  reporterName: string;
  reportedId: string;
  reportedName: string;
  reason: ReportReason;
  note: string | null;
  roomCode: string;
  chatExcerpt: Array<{ senderName: string; text: string; sentAt: string }>;
}

export interface ReportSummary {
  id: string;
  reporterId: string | null;
  reporterName: string;
  reportedId: string;
  reportedName: string;
  reason: string;
  note: string | null;
  roomCode: string;
  status: ReportStatus;
  createdAt: string;
  chatExcerpt: Array<{ senderName: string; text: string; sentAt: string }>;
  reviewedById: string | null;
  reviewedAt: string | null;
  resolution: string | null;
}

export interface BanHistoryEntry {
  id: string;
  reason: string;
  until: string | null;
  createdAt: string;
  liftedAt: string | null;
  issuedById: string | null;
}

/** A user as the admin panel sees them — more than `PublicUser`, still no hash. */
export interface AdminUserSummary {
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

export interface BanInput {
  userId: string;
  issuedById: string;
  reason: string;
  /** Null for permanent. */
  until: Date | null;
}

export interface ModerationProvider {
  fileReport(report: NewReport): Promise<ReportSummary>;
  listReports(status: ReportStatus | null, limit: number): Promise<ReportSummary[]>;
  getReport(id: string): Promise<ReportSummary | null>;
  /** Resolve a report. Returns null if there is no such report. */
  resolveReport(
    id: string,
    reviewerId: string,
    status: ReportStatus,
    resolution: string | null,
  ): Promise<ReportSummary | null>;

  appendChatLog(entry: ChatLogEntry): Promise<void>;
  /** Recent lines from one room, oldest first — what a moderator reads on a report. */
  listChatLog(roomCode: string, limit: number): Promise<ChatLogEntry[]>;
  /** Delete every log line older than `before`. Returns how many went. */
  purgeChatLogsBefore(before: Date): Promise<number>;

  searchUsers(query: string, limit: number): Promise<AdminUserSummary[]>;
  getUser(userId: string): Promise<AdminUserSummary | null>;
  /** Applies the ban to the user row AND records it in the history. */
  banUser(input: BanInput): Promise<AdminUserSummary | null>;
  unbanUser(userId: string, liftedById: string): Promise<AdminUserSummary | null>;
  listBanHistory(userId: string): Promise<BanHistoryEntry[]>;
  /** The caller's current role, read fresh — the basis of every admin authorisation check. */
  getRole(userId: string): Promise<UserRole | null>;
  setRole(userId: string, role: UserRole): Promise<AdminUserSummary | null>;
}

// --- Prisma implementation -------------------------------------------------

/** Prisma's enum casing (`OPEN`) ↔ the shared lowercase wire values (`open`). */
const STATUS_TO_DB = {
  [REPORT_STATUS.OPEN]: "OPEN",
  [REPORT_STATUS.ACTIONED]: "ACTIONED",
  [REPORT_STATUS.DISMISSED]: "DISMISSED",
} as const;

const STATUS_FROM_DB: Record<string, ReportStatus> = {
  OPEN: REPORT_STATUS.OPEN,
  ACTIONED: REPORT_STATUS.ACTIONED,
  DISMISSED: REPORT_STATUS.DISMISSED,
};

const ROLE_TO_DB = {
  [USER_ROLE.PLAYER]: "PLAYER",
  [USER_ROLE.MODERATOR]: "MODERATOR",
  [USER_ROLE.ADMIN]: "ADMIN",
} as const;

const ROLE_FROM_DB: Record<string, UserRole> = {
  PLAYER: USER_ROLE.PLAYER,
  MODERATOR: USER_ROLE.MODERATOR,
  ADMIN: USER_ROLE.ADMIN,
};

type ExcerptLine = { senderName: string; text: string; sentAt: string };

/** `chatExcerpt` is `Json`, so it comes back as `unknown` and is re-validated here. */
function readExcerpt(value: unknown): ExcerptLine[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const line = entry as Record<string, unknown>;
    if (typeof line.senderName !== "string" || typeof line.text !== "string") {
      return [];
    }
    return [
      {
        senderName: line.senderName,
        text: line.text,
        sentAt: typeof line.sentAt === "string" ? line.sentAt : "",
      },
    ];
  });
}

export class PrismaModerationProvider implements ModerationProvider {
  constructor(private readonly prisma: PrismaClient) {}

  async fileReport(report: NewReport): Promise<ReportSummary> {
    const row = await this.prisma.report.create({
      data: {
        reporterId: report.reporterId,
        reporterName: report.reporterName,
        reportedId: report.reportedId,
        reportedName: report.reportedName,
        reason: report.reason,
        note: report.note,
        roomCode: report.roomCode,
        chatExcerpt: report.chatExcerpt,
      },
    });
    return toReportSummary(row);
  }

  async listReports(status: ReportStatus | null, limit: number): Promise<ReportSummary[]> {
    const rows = await this.prisma.report.findMany({
      where: status ? { status: STATUS_TO_DB[status] } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toReportSummary);
  }

  async getReport(id: string): Promise<ReportSummary | null> {
    const row = await this.prisma.report.findUnique({ where: { id } });
    return row ? toReportSummary(row) : null;
  }

  async resolveReport(
    id: string,
    reviewerId: string,
    status: ReportStatus,
    resolution: string | null,
  ): Promise<ReportSummary | null> {
    const existing = await this.prisma.report.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return null;
    }
    const row = await this.prisma.report.update({
      where: { id },
      data: {
        status: STATUS_TO_DB[status],
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        resolution,
      },
    });
    return toReportSummary(row);
  }

  async appendChatLog(entry: ChatLogEntry): Promise<void> {
    await this.prisma.chatLog.create({
      data: {
        roomCode: entry.roomCode,
        userId: entry.userId,
        senderName: entry.senderName,
        channel: entry.channel,
        text: entry.text,
        filtered: entry.filtered,
        sentAt: entry.sentAt,
      },
    });
  }

  async listChatLog(roomCode: string, limit: number): Promise<ChatLogEntry[]> {
    // Newest `limit` rows, then flipped: a moderator wants the most recent
    // conversation, read in the order it was said.
    const rows = await this.prisma.chatLog.findMany({
      where: { roomCode },
      orderBy: { sentAt: "desc" },
      take: limit,
    });
    return rows.reverse().map((row) => ({
      roomCode: row.roomCode,
      userId: row.userId,
      senderName: row.senderName,
      channel: row.channel,
      text: row.text,
      filtered: row.filtered,
      sentAt: row.sentAt,
    }));
  }

  async purgeChatLogsBefore(before: Date): Promise<number> {
    const result = await this.prisma.chatLog.deleteMany({ where: { sentAt: { lt: before } } });
    return result.count;
  }

  async searchUsers(query: string, limit: number): Promise<AdminUserSummary[]> {
    const trimmed = query.trim();
    const rows = await this.prisma.user.findMany({
      where: trimmed
        ? {
            OR: [
              { usernameLower: { contains: trimmed.toLowerCase() } },
              { email: { contains: trimmed.toLowerCase() } },
              { id: trimmed },
            ],
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { _count: { select: { reportsAgainst: true } } },
    });
    return rows.map(toAdminUser);
  }

  async getUser(userId: string): Promise<AdminUserSummary | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { _count: { select: { reportsAgainst: true } } },
    });
    return row ? toAdminUser(row) : null;
  }

  async banUser(input: BanInput): Promise<AdminUserSummary | null> {
    const exists = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });
    if (!exists) {
      return null;
    }
    // One transaction: a ban that applied but left no audit row (or the
    // reverse) is exactly the inconsistency a moderation trail must not have.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: input.userId },
        data: { banned: true, banReason: input.reason, banUntil: input.until },
      }),
      this.prisma.banRecord.create({
        data: {
          userId: input.userId,
          issuedById: input.issuedById,
          reason: input.reason,
          until: input.until,
        },
      }),
    ]);
    return this.getUser(input.userId);
  }

  async unbanUser(userId: string, liftedById: string): Promise<AdminUserSummary | null> {
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) {
      return null;
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { banned: false, banReason: null, banUntil: null },
      }),
      // Close out every ban still standing for this user, so the history shows
      // when it was lifted rather than just trailing off.
      this.prisma.banRecord.updateMany({
        where: { userId, liftedAt: null },
        data: { liftedAt: new Date(), liftedById },
      }),
    ]);
    return this.getUser(userId);
  }

  async listBanHistory(userId: string): Promise<BanHistoryEntry[]> {
    const rows = await this.prisma.banRecord.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      reason: row.reason,
      until: row.until ? row.until.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      liftedAt: row.liftedAt ? row.liftedAt.toISOString() : null,
      issuedById: row.issuedById,
    }));
  }

  async getRole(userId: string): Promise<UserRole | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return row ? (ROLE_FROM_DB[row.role] ?? USER_ROLE.PLAYER) : null;
  }

  async setRole(userId: string, role: UserRole): Promise<AdminUserSummary | null> {
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) {
      return null;
    }
    await this.prisma.user.update({ where: { id: userId }, data: { role: ROLE_TO_DB[role] } });
    return this.getUser(userId);
  }
}

function toReportSummary(row: {
  id: string;
  reporterId: string | null;
  reporterName: string;
  reportedId: string;
  reportedName: string;
  reason: string;
  note: string | null;
  roomCode: string;
  status: string;
  createdAt: Date;
  chatExcerpt: unknown;
  reviewedById: string | null;
  reviewedAt: Date | null;
  resolution: string | null;
}): ReportSummary {
  return {
    id: row.id,
    reporterId: row.reporterId,
    reporterName: row.reporterName,
    reportedId: row.reportedId,
    reportedName: row.reportedName,
    reason: row.reason,
    note: row.note,
    roomCode: row.roomCode,
    status: STATUS_FROM_DB[row.status] ?? REPORT_STATUS.OPEN,
    createdAt: row.createdAt.toISOString(),
    chatExcerpt: readExcerpt(row.chatExcerpt),
    reviewedById: row.reviewedById,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    resolution: row.resolution,
  };
}

function toAdminUser(row: {
  id: string;
  username: string;
  email: string;
  role: string;
  banned: boolean;
  banReason: string | null;
  banUntil: Date | null;
  createdAt: Date;
  _count?: { reportsAgainst: number };
}): AdminUserSummary {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: ROLE_FROM_DB[row.role] ?? USER_ROLE.PLAYER,
    banned: row.banned,
    banReason: row.banReason,
    banUntil: row.banUntil ? row.banUntil.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    reportsAgainst: row._count?.reportsAgainst ?? 0,
  };
}

// --- In-memory implementation (tests) --------------------------------------

interface StoredUserRow {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  banned: boolean;
  banReason: string | null;
  banUntil: Date | null;
  createdAt: Date;
}

/**
 * A RAM-backed provider for tests. `registerUser` seeds the account rows this
 * would otherwise share with `InMemoryAuthProvider` — the two are separate
 * stores in tests, so a suite exercising both seeds both (see
 * `adminRoutes.test.ts`).
 */
export class InMemoryModerationProvider implements ModerationProvider {
  private readonly users = new Map<string, StoredUserRow>();
  private readonly reports = new Map<string, ReportSummary>();
  private readonly bans: Array<BanHistoryEntry & { userId: string; liftedById: string | null }> = [];
  private chatLogs: ChatLogEntry[] = [];
  private nextId = 1;

  registerUser(user: {
    id: string;
    username: string;
    email?: string;
    role?: UserRole;
    banned?: boolean;
  }): void {
    this.users.set(user.id, {
      id: user.id,
      username: user.username,
      email: user.email ?? `${user.username.toLowerCase()}@example.com`,
      role: user.role ?? USER_ROLE.PLAYER,
      banned: user.banned ?? false,
      banReason: null,
      banUntil: null,
      createdAt: new Date(),
    });
  }

  async fileReport(report: NewReport): Promise<ReportSummary> {
    const summary: ReportSummary = {
      id: `rep_${this.nextId++}`,
      reporterId: report.reporterId,
      reporterName: report.reporterName,
      reportedId: report.reportedId,
      reportedName: report.reportedName,
      reason: report.reason,
      note: report.note,
      roomCode: report.roomCode,
      status: REPORT_STATUS.OPEN,
      createdAt: new Date().toISOString(),
      chatExcerpt: report.chatExcerpt,
      reviewedById: null,
      reviewedAt: null,
      resolution: null,
    };
    this.reports.set(summary.id, summary);
    return summary;
  }

  async listReports(status: ReportStatus | null, limit: number): Promise<ReportSummary[]> {
    return [...this.reports.values()]
      .filter((report) => status === null || report.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async getReport(id: string): Promise<ReportSummary | null> {
    return this.reports.get(id) ?? null;
  }

  async resolveReport(
    id: string,
    reviewerId: string,
    status: ReportStatus,
    resolution: string | null,
  ): Promise<ReportSummary | null> {
    const report = this.reports.get(id);
    if (!report) {
      return null;
    }
    const updated: ReportSummary = {
      ...report,
      status,
      reviewedById: reviewerId,
      reviewedAt: new Date().toISOString(),
      resolution,
    };
    this.reports.set(id, updated);
    return updated;
  }

  async appendChatLog(entry: ChatLogEntry): Promise<void> {
    this.chatLogs.push(entry);
  }

  async listChatLog(roomCode: string, limit: number): Promise<ChatLogEntry[]> {
    return this.chatLogs.filter((entry) => entry.roomCode === roomCode).slice(-limit);
  }

  async purgeChatLogsBefore(before: Date): Promise<number> {
    const kept = this.chatLogs.filter((entry) => entry.sentAt.getTime() >= before.getTime());
    const removed = this.chatLogs.length - kept.length;
    this.chatLogs = kept;
    return removed;
  }

  async searchUsers(query: string, limit: number): Promise<AdminUserSummary[]> {
    const needle = query.trim().toLowerCase();
    return [...this.users.values()]
      .filter(
        (user) =>
          !needle ||
          user.username.toLowerCase().includes(needle) ||
          user.email.toLowerCase().includes(needle) ||
          user.id === query.trim(),
      )
      .slice(0, limit)
      .map((user) => this.summarize(user));
  }

  async getUser(userId: string): Promise<AdminUserSummary | null> {
    const user = this.users.get(userId);
    return user ? this.summarize(user) : null;
  }

  async banUser(input: BanInput): Promise<AdminUserSummary | null> {
    const user = this.users.get(input.userId);
    if (!user) {
      return null;
    }
    user.banned = true;
    user.banReason = input.reason;
    user.banUntil = input.until;
    this.bans.push({
      id: `ban_${this.nextId++}`,
      userId: input.userId,
      issuedById: input.issuedById,
      reason: input.reason,
      until: input.until ? input.until.toISOString() : null,
      createdAt: new Date().toISOString(),
      liftedAt: null,
      liftedById: null,
    });
    return this.summarize(user);
  }

  async unbanUser(userId: string, liftedById: string): Promise<AdminUserSummary | null> {
    const user = this.users.get(userId);
    if (!user) {
      return null;
    }
    user.banned = false;
    user.banReason = null;
    user.banUntil = null;
    for (const ban of this.bans) {
      if (ban.userId === userId && ban.liftedAt === null) {
        ban.liftedAt = new Date().toISOString();
        ban.liftedById = liftedById;
      }
    }
    return this.summarize(user);
  }

  async listBanHistory(userId: string): Promise<BanHistoryEntry[]> {
    return this.bans
      .filter((ban) => ban.userId === userId)
      .map(({ id, reason, until, createdAt, liftedAt, issuedById }) => ({
        id,
        reason,
        until,
        createdAt,
        liftedAt,
        issuedById,
      }))
      .reverse();
  }

  async getRole(userId: string): Promise<UserRole | null> {
    return this.users.get(userId)?.role ?? null;
  }

  async setRole(userId: string, role: UserRole): Promise<AdminUserSummary | null> {
    const user = this.users.get(userId);
    if (!user) {
      return null;
    }
    user.role = role;
    return this.summarize(user);
  }

  private summarize(user: StoredUserRow): AdminUserSummary {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      banUntil: user.banUntil ? user.banUntil.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
      reportsAgainst: [...this.reports.values()].filter((r) => r.reportedId === user.id).length,
    };
  }

  reset(): void {
    this.users.clear();
    this.reports.clear();
    this.bans.length = 0;
    this.chatLogs = [];
    this.nextId = 1;
  }
}

// --- Swappable registry ----------------------------------------------------

let current: ModerationProvider | null = null;

/** Install the process-wide provider — Prisma at boot, in-memory in tests. */
export function setModerationProvider(provider: ModerationProvider | null): void {
  current = provider;
}

/**
 * The active provider, or null when none is installed. Unlike the auth and
 * friend registries this does *not* throw: `GameRoom` calls it on the chat
 * path, and a room whose moderation store is missing must still let people
 * play rather than crashing the tick. Callers treat null as "not recording".
 */
export function getModerationProvider(): ModerationProvider | null {
  return current;
}
