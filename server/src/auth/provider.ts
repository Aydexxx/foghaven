import { USER_ROLE, validateName, type UserRole } from "@foghaven/shared";
import { hashPassword, verifyPassword } from "./password";
import { signToken, verifyToken } from "./token";
import { isValidEmail, validatePassword } from "./validation";

/**
 * The account service, behind one interface with two implementations:
 * `PrismaAuthProvider` (real Postgres, wired at boot in `index.ts`) and
 * `InMemoryAuthProvider` (tests). The whole point of the seam is that the ~200
 * existing Colyseus tests — and the auth HTTP tests — run with no database at
 * all; they install the in-memory fake and exercise the exact same
 * register/login/ban logic, which lives once in `BaseAuthProvider` below.
 *
 * All validation, hashing, token issuance and ban checking are here in the
 * base; the two subclasses supply only four trivial storage primitives. So
 * "the fake and the real thing behave differently" isn't a class of bug this
 * layer can have.
 */

// --- Public shapes (never carry a password hash) ---------------------------

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  banned: boolean;
  banReason: string | null;
  banUntil: string | null;
  /**
   * Moderation privilege, surfaced so the client knows whether to offer the
   * admin panel at all. Purely cosmetic on the client's side — every `/admin`
   * route re-reads this from the database itself and would refuse a caller
   * who edited it in their own local storage.
   */
  role: UserRole;
}

export interface AuthSuccess {
  token: string;
  user: PublicUser;
}

/** What `onAuth` learns about a connection: a real user, or an anonymous guest. */
export interface Identity {
  /** The account id, or `null` for a guest. */
  userId: string | null;
  /** Authoritative display name for a real user; empty for a guest (the room supplies theirs). */
  username: string;
  isGuest: boolean;
}

export interface BanInfo {
  reason: string | null;
  /** ISO timestamp a temporary ban lifts, or null for permanent. */
  until: string | null;
}

export type RegisterError =
  | "invalid_email"
  | "invalid_username"
  | "profanity"
  | "weak_password"
  | "email_taken"
  | "username_taken";
export type LoginError = "invalid_credentials" | "banned";
export type AuthenticateError = "auth_invalid" | "banned";
export type DeleteAccountError = "invalid_password" | "not_found";

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E; ban?: BanInfo };

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
  /**
   * Whether the registering player confirmed the minimum-age declaration.
   * Optional here (defaults to false when omitted) because the actual gate —
   * refusing to register at all without it — lives at the HTTP boundary (see
   * `http/authRoutes.ts`), not in this shared core; that keeps every existing
   * caller of `register()` (most of the test suite) working unchanged while
   * the real registration surface still enforces it.
   */
  ageConfirmed?: boolean;
  /** Same reasoning as `ageConfirmed` — the Terms of Service / Privacy Policy consent checkbox. */
  consentAccepted?: boolean;
}

export interface LoginInput {
  /** Either an email or a username — the login form accepts both. */
  identifier: string;
  password: string;
}

export interface AuthenticateOptions {
  allowGuests: boolean;
}

export interface AuthProvider {
  register(input: RegisterInput): Promise<Result<AuthSuccess, RegisterError>>;
  login(input: LoginInput): Promise<Result<AuthSuccess, LoginError>>;
  authenticate(
    token: string | undefined,
    opts: AuthenticateOptions,
  ): Promise<Result<Identity, AuthenticateError>>;
  getPublicUser(userId: string): Promise<PublicUser | null>;
  /**
   * The GDPR/KVKK "right to erasure" path: verify the account's own password
   * (a bearer token alone is not enough for something this destructive — see
   * `http/authRoutes.ts`'s `DELETE /account`) and, if it matches, remove the
   * row outright. Everything that hangs off it — cosmetics, friendships,
   * stats, ban history — goes with it via the schema's own `onDelete: Cascade`
   * rules; nothing here needs to know what those are.
   */
  deleteAccount(userId: string, password: string): Promise<Result<true, DeleteAccountError>>;
}

// --- Storage primitives the subclasses implement ---------------------------

/** A full stored row, password hash included — never leaves the provider layer. */
export interface StoredUser {
  id: string;
  username: string;
  usernameLower: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  banned: boolean;
  banReason: string | null;
  banUntil: Date | null;
  /** Prisma's enum casing (`PLAYER`); mapped to the shared lowercase form by `toPublic`. */
  role?: string;
  ageConfirmed?: boolean;
  consentAcceptedAt?: Date | null;
}

export interface NewUser {
  username: string;
  usernameLower: string;
  email: string;
  passwordHash: string;
  ageConfirmed: boolean;
  consentAcceptedAt: Date | null;
}

/** Whether a ban is in force right now — permanent, or temporary and not yet expired. */
export function isBanActive(user: Pick<StoredUser, "banned" | "banUntil">): boolean {
  if (!user.banned) {
    return false;
  }
  return user.banUntil === null || user.banUntil.getTime() > Date.now();
}

// --- Shared logic ----------------------------------------------------------

export abstract class BaseAuthProvider implements AuthProvider {
  protected abstract findById(id: string): Promise<StoredUser | null>;
  protected abstract findByEmail(emailLower: string): Promise<StoredUser | null>;
  protected abstract findByUsernameLower(usernameLower: string): Promise<StoredUser | null>;
  protected abstract insert(user: NewUser): Promise<StoredUser>;
  protected abstract remove(id: string): Promise<void>;

  async register(input: RegisterInput): Promise<Result<AuthSuccess, RegisterError>> {
    const email = input.email.trim().toLowerCase();
    const username = input.username.trim();

    if (!isValidEmail(email)) {
      return { ok: false, error: "invalid_email" };
    }
    const nameError = validateName(username);
    if (nameError === "profanity") {
      return { ok: false, error: "profanity" };
    }
    if (nameError !== null) {
      return { ok: false, error: "invalid_username" };
    }
    if (validatePassword(input.password) !== null) {
      return { ok: false, error: "weak_password" };
    }

    // Uniqueness is checked here for a friendly error AND enforced by the
    // database's unique constraints (email, usernameLower) as the real
    // backstop against a race between two simultaneous registrations.
    if (await this.findByEmail(email)) {
      return { ok: false, error: "email_taken" };
    }
    const usernameLower = username.toLowerCase();
    if (await this.findByUsernameLower(usernameLower)) {
      return { ok: false, error: "username_taken" };
    }

    const passwordHash = await hashPassword(input.password);
    let user: StoredUser;
    try {
      user = await this.insert({
        username,
        usernameLower,
        email,
        passwordHash,
        ageConfirmed: input.ageConfirmed === true,
        consentAcceptedAt: input.consentAccepted === true ? new Date() : null,
      });
    } catch {
      // A unique-constraint violation from a race — someone took the name or
      // email between the check above and the insert. Report it the same way.
      if (await this.findByEmail(email)) {
        return { ok: false, error: "email_taken" };
      }
      return { ok: false, error: "username_taken" };
    }

    return { ok: true, value: { token: signToken(user.id), user: toPublic(user) } };
  }

  async login(input: LoginInput): Promise<Result<AuthSuccess, LoginError>> {
    const identifier = input.identifier.trim().toLowerCase();
    // A login form takes either an email or a username.
    const user =
      (await this.findByEmail(identifier)) ?? (await this.findByUsernameLower(identifier));

    // Run the password comparison even when no user matched, against a dummy
    // hash, so a nonexistent account and a wrong password take the same time —
    // login response timing can't be used to enumerate valid usernames.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const passwordOk = await verifyPassword(input.password, hash);
    if (!user || !passwordOk) {
      return { ok: false, error: "invalid_credentials" };
    }

    if (isBanActive(user)) {
      return { ok: false, error: "banned", ban: banInfo(user) };
    }

    return { ok: true, value: { token: signToken(user.id), user: toPublic(user) } };
  }

  async authenticate(
    token: string | undefined,
    opts: AuthenticateOptions,
  ): Promise<Result<Identity, AuthenticateError>> {
    if (!token) {
      if (!opts.allowGuests) {
        return { ok: false, error: "auth_invalid" };
      }
      return { ok: true, value: { userId: null, username: "", isGuest: true } };
    }

    const claims = verifyToken(token);
    if (!claims) {
      return { ok: false, error: "auth_invalid" };
    }
    // Fresh lookup, every time: a ban issued after this token was minted must
    // still block the join. This is the whole reason tokens carry only an id.
    const user = await this.findById(claims.userId);
    if (!user) {
      return { ok: false, error: "auth_invalid" };
    }
    if (isBanActive(user)) {
      return { ok: false, error: "banned", ban: banInfo(user) };
    }
    return { ok: true, value: { userId: user.id, username: user.username, isGuest: false } };
  }

  async getPublicUser(userId: string): Promise<PublicUser | null> {
    const user = await this.findById(userId);
    return user ? toPublic(user) : null;
  }

  async deleteAccount(userId: string, password: string): Promise<Result<true, DeleteAccountError>> {
    const user = await this.findById(userId);
    if (!user) {
      return { ok: false, error: "not_found" };
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      return { ok: false, error: "invalid_password" };
    }
    await this.remove(userId);
    return { ok: true, value: true };
  }
}

/**
 * A fixed bcrypt hash of a random string, compared against when no user matched
 * so a failed login does equal work whether or not the account exists. Its
 * plaintext is unknown and irrelevant — it exists only to burn the same time.
 */
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO3d1YQ0mQ2xX0YxXqy5o7Z3v0m1kF3nq";

function banInfo(user: StoredUser): BanInfo {
  return { reason: user.banReason, until: user.banUntil ? user.banUntil.toISOString() : null };
}

/** Prisma stores roles upper-cased; the wire and the shared helpers use lowercase. */
const ROLE_FROM_DB: Record<string, UserRole> = {
  PLAYER: USER_ROLE.PLAYER,
  MODERATOR: USER_ROLE.MODERATOR,
  ADMIN: USER_ROLE.ADMIN,
};

function toPublic(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
    banned: user.banned,
    banReason: user.banReason,
    banUntil: user.banUntil ? user.banUntil.toISOString() : null,
    // Anything unrecognised falls back to the least privileged role, so a
    // malformed value can never read as moderator.
    role: ROLE_FROM_DB[user.role ?? ""] ?? USER_ROLE.PLAYER,
  };
}

// --- In-memory implementation (tests) --------------------------------------

/**
 * A RAM-backed provider for tests — same behavior as the real one, no database.
 * Exposes `seedBanned` / `seedUser` so a test can arrange an account (banned or
 * not) directly without going through the register flow.
 */
export class InMemoryAuthProvider extends BaseAuthProvider {
  private readonly users = new Map<string, StoredUser>();
  private nextId = 1;

  protected async findById(id: string): Promise<StoredUser | null> {
    return this.users.get(id) ?? null;
  }

  protected async findByEmail(emailLower: string): Promise<StoredUser | null> {
    for (const user of this.users.values()) {
      if (user.email === emailLower) {
        return user;
      }
    }
    return null;
  }

  protected async findByUsernameLower(usernameLower: string): Promise<StoredUser | null> {
    for (const user of this.users.values()) {
      if (user.usernameLower === usernameLower) {
        return user;
      }
    }
    return null;
  }

  protected async insert(user: NewUser): Promise<StoredUser> {
    if (
      (await this.findByEmail(user.email)) ||
      (await this.findByUsernameLower(user.usernameLower))
    ) {
      throw new Error("unique constraint");
    }
    const stored: StoredUser = {
      id: `mem_${this.nextId++}`,
      createdAt: new Date(),
      banned: false,
      banReason: null,
      banUntil: null,
      ...user,
    };
    this.users.set(stored.id, stored);
    return stored;
  }

  protected async remove(id: string): Promise<void> {
    this.users.delete(id);
  }

  /** Directly seed a stored user (test arrangement); returns the row. */
  async seedUser(
    overrides: Partial<StoredUser> & { username: string; email: string },
  ): Promise<StoredUser> {
    const username = overrides.username;
    const stored: StoredUser = {
      id: overrides.id ?? `mem_${this.nextId++}`,
      username,
      usernameLower: overrides.usernameLower ?? username.toLowerCase(),
      email: overrides.email.toLowerCase(),
      passwordHash: overrides.passwordHash ?? (await hashPassword("password123")),
      createdAt: overrides.createdAt ?? new Date(),
      banned: overrides.banned ?? false,
      banReason: overrides.banReason ?? null,
      banUntil: overrides.banUntil ?? null,
      ageConfirmed: overrides.ageConfirmed ?? true,
      consentAcceptedAt: overrides.consentAcceptedAt ?? new Date(),
    };
    this.users.set(stored.id, stored);
    return stored;
  }

  /** A valid token for a seeded (or freshly seeded) user — the test shortcut into `authenticate`. */
  tokenFor(userId: string): string {
    return signToken(userId);
  }

  reset(): void {
    this.users.clear();
    this.nextId = 1;
  }
}

// --- Swappable registry ----------------------------------------------------

let current: AuthProvider | null = null;

/** Install the process-wide provider — Prisma at boot, in-memory in tests. */
export function setAuthProvider(provider: AuthProvider | null): void {
  current = provider;
}

/** The active provider. Throws if none is installed, so a misconfigured boot fails loudly. */
export function getAuthProvider(): AuthProvider {
  if (!current) {
    throw new Error("No AuthProvider configured — call setAuthProvider() during boot.");
  }
  return current;
}
