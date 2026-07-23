import type { Redis } from "ioredis";

/**
 * Who's online, right now. Kept in Redis rather than in a room's own memory
 * because presence needs to survive `HubRoom` recycling (it disposes when
 * empty, like any Colyseus room) and — eventually — to work across more than
 * one server process; a plain in-memory `Set` on the room instance would
 * reset every time the room did.
 *
 * A user can hold more than one connection (two tabs, a phone and a laptop),
 * so this counts connections rather than storing a boolean: only the
 * *first* connect and the *last* disconnect are transitions worth telling
 * anyone about, which is what `connect`/`disconnect`'s boolean return values
 * signal to the caller (`HubRoom`, which uses them to decide whether to
 * notify friends at all).
 */
export interface PresenceStore {
  /** Register a connection. Returns true if this was the 0→1 transition (user just came online). */
  connect(userId: string): Promise<boolean>;
  /** Drop a connection. Returns true if this was the transition to zero (user just went offline). */
  disconnect(userId: string): Promise<boolean>;
  isOnline(userId: string): Promise<boolean>;
  /** Filters `userIds` down to the ones currently online — one round trip for a whole friends list. */
  onlineAmong(userIds: string[]): Promise<Set<string>>;
}

const ONLINE_SET_KEY = "presence:online";
const connectionCountKey = (userId: string) => `presence:count:${userId}`;

export class RedisPresenceStore implements PresenceStore {
  constructor(private readonly redis: Redis) {}

  async connect(userId: string): Promise<boolean> {
    const count = await this.redis.incr(connectionCountKey(userId));
    if (count === 1) {
      await this.redis.sadd(ONLINE_SET_KEY, userId);
      return true;
    }
    return false;
  }

  async disconnect(userId: string): Promise<boolean> {
    const count = await this.redis.decr(connectionCountKey(userId));
    if (count <= 0) {
      // A pipeline, not two round trips: nothing outside this store touches
      // either key, so there is no race to protect against, only latency.
      await this.redis
        .pipeline()
        .del(connectionCountKey(userId))
        .srem(ONLINE_SET_KEY, userId)
        .exec();
      return true;
    }
    return false;
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.sismember(ONLINE_SET_KEY, userId)) === 1;
  }

  async onlineAmong(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) {
      return new Set();
    }
    const results = await this.redis.smismember(ONLINE_SET_KEY, ...userIds);
    const online = new Set<string>();
    userIds.forEach((id, i) => {
      if (results[i]) {
        online.add(id);
      }
    });
    return online;
  }
}

/** A RAM-backed store for tests — same connection-counting semantics, no Redis. */
export class InMemoryPresenceStore implements PresenceStore {
  private readonly counts = new Map<string, number>();

  async connect(userId: string): Promise<boolean> {
    const next = (this.counts.get(userId) ?? 0) + 1;
    this.counts.set(userId, next);
    return next === 1;
  }

  async disconnect(userId: string): Promise<boolean> {
    const next = (this.counts.get(userId) ?? 0) - 1;
    if (next <= 0) {
      this.counts.delete(userId);
      return true;
    }
    this.counts.set(userId, next);
    return false;
  }

  async isOnline(userId: string): Promise<boolean> {
    return (this.counts.get(userId) ?? 0) > 0;
  }

  async onlineAmong(userIds: string[]): Promise<Set<string>> {
    const online = new Set<string>();
    for (const id of userIds) {
      if (await this.isOnline(id)) {
        online.add(id);
      }
    }
    return online;
  }

  reset(): void {
    this.counts.clear();
  }
}

// --- Swappable registry, mirroring `auth/provider.ts`'s pattern -----------

let current: PresenceStore | null = null;

/** Install the process-wide store — Redis at boot, in-memory in tests. */
export function setPresenceStore(store: PresenceStore | null): void {
  current = store;
}

/** The active store. Throws if none is installed, so a misconfigured boot fails loudly. */
export function getPresenceStore(): PresenceStore {
  if (!current) {
    throw new Error("No PresenceStore configured — call setPresenceStore() during boot.");
  }
  return current;
}
