import type { PrismaClient, CosmeticType as PrismaCosmeticType } from "@prisma/client";
import {
  COSMETIC_TYPE,
  COSMETICS_BY_ID,
  EQUIP_FIELD_BY_TYPE,
  cosmeticById,
  emptyLoadout,
  starterCosmeticIds,
  type CosmeticType,
  type EquippedCosmetics,
} from "@foghaven/shared";
import type { Result } from "../auth/provider";

/**
 * Ownership, equip state and the coin balance behind the cosmetics system —
 * the same swappable-provider seam `auth/`, `friends/` and `moderation/` all
 * use, and for the same reason: the suite runs every one of these paths with
 * no database.
 *
 * What a cosmetic actually *is* (its shape, its price) is never this layer's
 * concern — that's the shared catalog (`@foghaven/shared`'s `COSMETICS`) on
 * the price/identity side and `client/src/game/characters/cosmeticVisuals.ts`
 * on the rendering side. This provider only ever answers "who owns what" and
 * "who has how many coins."
 */

export interface OwnedCosmetic {
  id: string;
  type: CosmeticType;
  name: string;
  priceCoins: number;
  equipped: boolean;
}

export type PurchaseError = "not_found" | "already_owned" | "insufficient_coins";
export type EquipError = "not_found" | "not_owned";

export interface CosmeticProvider {
  getCoins(userId: string): Promise<number>;
  /** Returns the new balance. */
  awardCoins(userId: string, amount: number): Promise<number>;
  listOwned(userId: string): Promise<OwnedCosmetic[]>;
  /** What to write onto a `Player` schema row at join time — see `GameRoom.onJoin`. */
  getLoadout(userId: string): Promise<EquippedCosmetics>;
  purchase(userId: string, cosmeticId: string): Promise<Result<{ coins: number }, PurchaseError>>;
  equip(userId: string, cosmeticId: string): Promise<Result<EquippedCosmetics, EquipError>>;
  unequip(userId: string, type: CosmeticType): Promise<EquippedCosmetics>;
}

// --- Prisma implementation ---------------------------------------------

const TYPE_TO_DB: Record<CosmeticType, PrismaCosmeticType> = {
  [COSMETIC_TYPE.HAT]: "HAT",
  [COSMETIC_TYPE.ACCESSORY]: "ACCESSORY",
  [COSMETIC_TYPE.PET]: "PET",
  [COSMETIC_TYPE.OUTFIT]: "OUTFIT",
  [COSMETIC_TYPE.VICTORY_POSE]: "VICTORY_POSE",
  [COSMETIC_TYPE.DEATH_EFFECT]: "DEATH_EFFECT",
};

const TYPE_FROM_DB: Record<string, CosmeticType> = {
  HAT: COSMETIC_TYPE.HAT,
  ACCESSORY: COSMETIC_TYPE.ACCESSORY,
  PET: COSMETIC_TYPE.PET,
  OUTFIT: COSMETIC_TYPE.OUTFIT,
  VICTORY_POSE: COSMETIC_TYPE.VICTORY_POSE,
  DEATH_EFFECT: COSMETIC_TYPE.DEATH_EFFECT,
};

export class PrismaCosmeticProvider implements CosmeticProvider {
  constructor(private readonly prisma: PrismaClient) {}

  async getCoins(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { coins: true } });
    return user?.coins ?? 0;
  }

  async awardCoins(userId: string, amount: number): Promise<number> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { coins: { increment: amount } },
      select: { coins: true },
    });
    return updated.coins;
  }

  async listOwned(userId: string): Promise<OwnedCosmetic[]> {
    const rows = await this.prisma.userCosmetic.findMany({
      where: { userId },
      include: { cosmetic: true },
    });
    const owned = new Map<string, OwnedCosmetic>();
    for (const row of rows) {
      owned.set(row.cosmetic.slug, {
        id: row.cosmetic.slug,
        type: TYPE_FROM_DB[row.cosmetic.type] ?? COSMETIC_TYPE.HAT,
        name: row.cosmetic.name,
        priceCoins: row.cosmetic.priceCoins,
        equipped: row.equipped,
      });
    }
    // Starter items are ownable on demand — they appear as owned even before
    // any row exists for this user (see the module doc on `equip`).
    for (const id of starterCosmeticIds()) {
      if (!owned.has(id)) {
        const def = cosmeticById(id);
        if (def) {
          owned.set(id, { id: def.id, type: def.type, name: def.name, priceCoins: 0, equipped: false });
        }
      }
    }
    return [...owned.values()];
  }

  async getLoadout(userId: string): Promise<EquippedCosmetics> {
    const rows = await this.prisma.userCosmetic.findMany({
      where: { userId, equipped: true },
      include: { cosmetic: { select: { slug: true, type: true } } },
    });
    const loadout = emptyLoadout();
    for (const row of rows) {
      const type = TYPE_FROM_DB[row.cosmetic.type];
      if (type) {
        loadout[EQUIP_FIELD_BY_TYPE[type]] = row.cosmetic.slug;
      }
    }
    return loadout;
  }

  async purchase(
    userId: string,
    cosmeticId: string,
  ): Promise<Result<{ coins: number }, PurchaseError>> {
    const def = cosmeticById(cosmeticId);
    if (!def) {
      return { ok: false, error: "not_found" };
    }
    const cosmetic = await this.prisma.cosmetic.findUnique({ where: { slug: cosmeticId } });
    if (!cosmetic) {
      return { ok: false, error: "not_found" };
    }
    const existing = await this.prisma.userCosmetic.findUnique({
      where: { userId_cosmeticId: { userId, cosmeticId: cosmetic.id } },
    });
    if (existing) {
      return { ok: false, error: "already_owned" };
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { coins: true } });
    if (!user || user.coins < def.priceCoins) {
      return { ok: false, error: "insufficient_coins" };
    }

    // One transaction: a coin deduction that left no ownership row (or the
    // reverse) would be exactly the kind of economy bug a moderation queue
    // can't even see, let alone fix.
    const [updatedUser] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { coins: { decrement: def.priceCoins } },
        select: { coins: true },
      }),
      this.prisma.userCosmetic.create({ data: { userId, cosmeticId: cosmetic.id } }),
    ]);
    return { ok: true, value: { coins: updatedUser.coins } };
  }

  async equip(userId: string, cosmeticId: string): Promise<Result<EquippedCosmetics, EquipError>> {
    const def = cosmeticById(cosmeticId);
    if (!def) {
      return { ok: false, error: "not_found" };
    }
    const cosmetic = await this.prisma.cosmetic.findUnique({ where: { slug: cosmeticId } });
    if (!cosmetic) {
      return { ok: false, error: "not_found" };
    }

    let owned = await this.prisma.userCosmetic.findUnique({
      where: { userId_cosmeticId: { userId, cosmeticId: cosmetic.id } },
    });
    if (!owned) {
      // Starter items are ownable the instant they're equipped — no separate
      // "claim your free hat" step for the player to miss.
      if (def.priceCoins > 0) {
        return { ok: false, error: "not_owned" };
      }
      owned = await this.prisma.userCosmetic.create({ data: { userId, cosmeticId: cosmetic.id } });
    }

    await this.prisma.$transaction([
      // Unequip whatever else of this same type was equipped — a player has
      // exactly one hat on at a time.
      this.prisma.userCosmetic.updateMany({
        where: { userId, equipped: true, cosmetic: { type: cosmetic.type } },
        data: { equipped: false },
      }),
      this.prisma.userCosmetic.update({ where: { id: owned.id }, data: { equipped: true } }),
    ]);
    return { ok: true, value: await this.getLoadout(userId) };
  }

  async unequip(userId: string, type: CosmeticType): Promise<EquippedCosmetics> {
    await this.prisma.userCosmetic.updateMany({
      where: { userId, equipped: true, cosmetic: { type: TYPE_TO_DB[type] } },
      data: { equipped: false },
    });
    return this.getLoadout(userId);
  }
}

/**
 * Idempotent catalog sync: upserts every entry from the shared registry into
 * the `Cosmetic` table by slug. Run once at boot (see `index.ts`) so the
 * registry in code is the only place anyone ever edits the catalog — this
 * just keeps the DB's ownership foreign keys pointing at something real.
 */
export async function syncCosmeticCatalog(prisma: PrismaClient): Promise<void> {
  for (const def of COSMETICS_BY_ID.values()) {
    await prisma.cosmetic.upsert({
      where: { slug: def.id },
      create: { slug: def.id, type: TYPE_TO_DB[def.type], name: def.name, priceCoins: def.priceCoins },
      update: { type: TYPE_TO_DB[def.type], name: def.name, priceCoins: def.priceCoins },
    });
  }
}

// --- In-memory implementation (tests) -----------------------------------

interface OwnedRow {
  cosmeticId: string;
  equipped: boolean;
}

/** A RAM-backed provider for tests — same rules as the real one, no database. */
export class InMemoryCosmeticProvider implements CosmeticProvider {
  private readonly coins = new Map<string, number>();
  private readonly owned = new Map<string, OwnedRow[]>();

  private rowsFor(userId: string): OwnedRow[] {
    let rows = this.owned.get(userId);
    if (!rows) {
      rows = [];
      this.owned.set(userId, rows);
    }
    return rows;
  }

  /** Test convenience: give a user coins directly. */
  seedCoins(userId: string, amount: number): void {
    this.coins.set(userId, amount);
  }

  /** Test convenience: grant ownership directly, skipping `purchase`. */
  seedOwned(userId: string, cosmeticId: string, equipped = false): void {
    const rows = this.rowsFor(userId);
    if (!rows.some((r) => r.cosmeticId === cosmeticId)) {
      rows.push({ cosmeticId, equipped });
    }
  }

  async getCoins(userId: string): Promise<number> {
    return this.coins.get(userId) ?? 0;
  }

  async awardCoins(userId: string, amount: number): Promise<number> {
    const next = (this.coins.get(userId) ?? 0) + amount;
    this.coins.set(userId, next);
    return next;
  }

  async listOwned(userId: string): Promise<OwnedCosmetic[]> {
    const rows = this.rowsFor(userId);
    const result = new Map<string, OwnedCosmetic>();
    for (const row of rows) {
      const def = cosmeticById(row.cosmeticId);
      if (def) {
        result.set(def.id, {
          id: def.id,
          type: def.type,
          name: def.name,
          priceCoins: def.priceCoins,
          equipped: row.equipped,
        });
      }
    }
    for (const id of starterCosmeticIds()) {
      if (!result.has(id)) {
        const def = cosmeticById(id);
        if (def) {
          result.set(id, { id: def.id, type: def.type, name: def.name, priceCoins: 0, equipped: false });
        }
      }
    }
    return [...result.values()];
  }

  async getLoadout(userId: string): Promise<EquippedCosmetics> {
    const loadout = emptyLoadout();
    for (const row of this.rowsFor(userId)) {
      if (!row.equipped) {
        continue;
      }
      const def = cosmeticById(row.cosmeticId);
      if (def) {
        loadout[EQUIP_FIELD_BY_TYPE[def.type]] = def.id;
      }
    }
    return loadout;
  }

  async purchase(
    userId: string,
    cosmeticId: string,
  ): Promise<Result<{ coins: number }, PurchaseError>> {
    const def = cosmeticById(cosmeticId);
    if (!def) {
      return { ok: false, error: "not_found" };
    }
    const rows = this.rowsFor(userId);
    if (rows.some((r) => r.cosmeticId === cosmeticId)) {
      return { ok: false, error: "already_owned" };
    }
    const balance = this.coins.get(userId) ?? 0;
    if (balance < def.priceCoins) {
      return { ok: false, error: "insufficient_coins" };
    }
    this.coins.set(userId, balance - def.priceCoins);
    rows.push({ cosmeticId, equipped: false });
    return { ok: true, value: { coins: balance - def.priceCoins } };
  }

  async equip(userId: string, cosmeticId: string): Promise<Result<EquippedCosmetics, EquipError>> {
    const def = cosmeticById(cosmeticId);
    if (!def) {
      return { ok: false, error: "not_found" };
    }
    const rows = this.rowsFor(userId);
    let row = rows.find((r) => r.cosmeticId === cosmeticId);
    if (!row) {
      if (def.priceCoins > 0) {
        return { ok: false, error: "not_owned" };
      }
      row = { cosmeticId, equipped: false };
      rows.push(row);
    }
    for (const other of rows) {
      const otherDef = cosmeticById(other.cosmeticId);
      if (otherDef?.type === def.type) {
        other.equipped = false;
      }
    }
    row.equipped = true;
    return { ok: true, value: await this.getLoadout(userId) };
  }

  async unequip(userId: string, type: CosmeticType): Promise<EquippedCosmetics> {
    for (const row of this.rowsFor(userId)) {
      const def = cosmeticById(row.cosmeticId);
      if (def?.type === type) {
        row.equipped = false;
      }
    }
    return this.getLoadout(userId);
  }

  reset(): void {
    this.coins.clear();
    this.owned.clear();
  }
}

// --- Swappable registry --------------------------------------------------

let current: CosmeticProvider | null = null;

export function setCosmeticProvider(provider: CosmeticProvider | null): void {
  current = provider;
}

/** The active provider, or null when none is installed — see `getModerationProvider` for why this doesn't throw. */
export function getCosmeticProvider(): CosmeticProvider | null {
  return current;
}
