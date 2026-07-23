/**
 * The cosmetics catalog and economy — shared because both sides need to
 * agree on what exists and what it costs: the server validates every
 * purchase/equip against this exact list, and the client uses it to render
 * the shop/inventory. What each entry actually *looks like* (polygon
 * geometry, anchor offsets, particle colours, pose frames) is deliberately
 * NOT here — that lives in `client/src/game/characters/cosmeticVisuals.ts`,
 * client-only, the same way the character rig's own shape data
 * (`archetypes.ts`) never crosses into `shared/`. This file only carries what
 * the server has any business knowing: identity, category, price.
 *
 * Same registry pattern as `roles.ts` and `settings.ts` — a static array is
 * the single source of truth, and the Prisma `Cosmetic` table is a synced
 * mirror of it (see `server/src/index.ts`'s boot-time upsert) that exists
 * purely to give `UserCosmetic` ownership rows something with real
 * referential integrity to point at.
 */

export const COSMETIC_TYPE = {
  HAT: "hat",
  ACCESSORY: "accessory",
  PET: "pet",
  OUTFIT: "outfit",
  VICTORY_POSE: "victory_pose",
  DEATH_EFFECT: "death_effect",
} as const;

export type CosmeticType = (typeof COSMETIC_TYPE)[keyof typeof COSMETIC_TYPE];

export const COSMETIC_TYPES: readonly CosmeticType[] = Object.values(COSMETIC_TYPE);

export function isCosmeticType(value: unknown): value is CosmeticType {
  return typeof value === "string" && (COSMETIC_TYPES as readonly string[]).includes(value);
}

export interface CosmeticDefinition {
  /** The stable catalog key — matches a key in `client/src/game/characters/cosmeticVisuals.ts`. */
  id: string;
  type: CosmeticType;
  /** English display name; the client looks up `cosmetics.items.{{id}}` for the localized one, falling back to this. */
  name: string;
  /** Coins to purchase. 0 = free/starter — owned by everyone with no purchase or grant needed. */
  priceCoins: number;
}

/**
 * The catalog. Never mutated at runtime — "removing" an item means deleting
 * its entry here (existing owners keep their `UserCosmetic` row and can still
 * equip it; it just stops being purchasable, since `listCatalog` is the only
 * thing that reads this list for the shop).
 */
export const COSMETICS: readonly CosmeticDefinition[] = [
  // Hats — anchored above the head, small enough never to rival the
  // archetype's own silhouette (see the sizing note in `cosmeticVisuals.ts`).
  { id: "top_hat", type: COSMETIC_TYPE.HAT, name: "Top Hat", priceCoins: 0 },
  { id: "straw_boater", type: COSMETIC_TYPE.HAT, name: "Straw Boater", priceCoins: 150 },
  { id: "feathered_cap", type: COSMETIC_TYPE.HAT, name: "Feathered Cap", priceCoins: 150 },

  // Accessories — face/neck level.
  { id: "spectacles", type: COSMETIC_TYPE.ACCESSORY, name: "Round Spectacles", priceCoins: 0 },
  { id: "red_scarf", type: COSMETIC_TYPE.ACCESSORY, name: "Red Scarf", priceCoins: 100 },
  { id: "eye_patch", type: COSMETIC_TYPE.ACCESSORY, name: "Eye Patch", priceCoins: 150 },

  // Pets — a small companion trailing beside the player.
  { id: "harbor_gull", type: COSMETIC_TYPE.PET, name: "Harbor Gull", priceCoins: 0 },
  { id: "tabby_cat", type: COSMETIC_TYPE.PET, name: "Tabby Cat", priceCoins: 200 },
  { id: "hermit_crab", type: COSMETIC_TYPE.PET, name: "Hermit Crab", priceCoins: 200 },

  // Outfits — a small chest trim/pin; never recolours the archetype's own
  // garment, only decorates it.
  { id: "brass_pin", type: COSMETIC_TYPE.OUTFIT, name: "Brass Pin", priceCoins: 0 },
  { id: "golden_sash", type: COSMETIC_TYPE.OUTFIT, name: "Golden Sash", priceCoins: 250 },
  { id: "silver_sash", type: COSMETIC_TYPE.OUTFIT, name: "Silver Sash", priceCoins: 250 },

  // Victory poses — shown on the results screen for the winning faction.
  { id: "triumphant_wave", type: COSMETIC_TYPE.VICTORY_POSE, name: "Triumphant Wave", priceCoins: 0 },
  { id: "bow", type: COSMETIC_TYPE.VICTORY_POSE, name: "Bow", priceCoins: 200 },

  // Death effects — a one-shot flourish the instant a death animation plays.
  { id: "dust_puff", type: COSMETIC_TYPE.DEATH_EFFECT, name: "Dust Puff", priceCoins: 0 },
  { id: "spark_burst", type: COSMETIC_TYPE.DEATH_EFFECT, name: "Spark Burst", priceCoins: 150 },
  { id: "feather_scatter", type: COSMETIC_TYPE.DEATH_EFFECT, name: "Feather Scatter", priceCoins: 150 },
];

export const COSMETICS_BY_ID: ReadonlyMap<string, CosmeticDefinition> = new Map(
  COSMETICS.map((c) => [c.id, c]),
);

export function cosmeticById(id: string): CosmeticDefinition | undefined {
  return COSMETICS_BY_ID.get(id);
}

export function cosmeticsByType(type: CosmeticType): CosmeticDefinition[] {
  return COSMETICS.filter((c) => c.type === type);
}

/** Every free/starter cosmetic — what a brand-new account already owns, no play or purchase required. */
export function starterCosmeticIds(): string[] {
  return COSMETICS.filter((c) => c.priceCoins === 0).map((c) => c.id);
}

// --- Economy -----------------------------------------------------------

/** Coins awarded to every connected account-holder at the end of a round, win or lose. */
export const COINS_PER_ROUND = 25;

/** Additional coins for players on the winning faction. */
export const COINS_WIN_BONUS = 15;

// --- Wire shapes ---------------------------------------------------------

/** The six equip slots, empty string meaning "nothing equipped" — mirrors the `Player` schema fields. */
export interface EquippedCosmetics {
  hatId: string;
  accessoryId: string;
  petId: string;
  outfitId: string;
  victoryPoseId: string;
  deathEffectId: string;
}

export function emptyLoadout(): EquippedCosmetics {
  return { hatId: "", accessoryId: "", petId: "", outfitId: "", victoryPoseId: "", deathEffectId: "" };
}

/** Which `EquippedCosmetics` field a given cosmetic type occupies. */
export const EQUIP_FIELD_BY_TYPE: Record<CosmeticType, keyof EquippedCosmetics> = {
  [COSMETIC_TYPE.HAT]: "hatId",
  [COSMETIC_TYPE.ACCESSORY]: "accessoryId",
  [COSMETIC_TYPE.PET]: "petId",
  [COSMETIC_TYPE.OUTFIT]: "outfitId",
  [COSMETIC_TYPE.VICTORY_POSE]: "victoryPoseId",
  [COSMETIC_TYPE.DEATH_EFFECT]: "deathEffectId",
};
