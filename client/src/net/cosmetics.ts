/**
 * Client half of the cosmetics HTTP surface — `/cosmetics` (see
 * `server/src/http/cosmeticsRoutes.ts`). Every route but the catalog needs a
 * bearer token; a guest has no account for ownership or a coin balance to
 * attach to.
 */

import type { CosmeticDefinition, CosmeticType, EquippedCosmetics } from "@foghaven/shared";

export interface OwnedCosmetic {
  id: string;
  type: CosmeticType;
  name: string;
  priceCoins: number;
  equipped: boolean;
}

/** A failed cosmetics-API call, carrying the server's stable error code. */
export class CosmeticsError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "CosmeticsError";
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

async function call(
  path: string,
  method: string,
  token?: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${baseUrl()}/cosmetics${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new CosmeticsError((data as { error?: string }).error ?? "unknown", res.status);
  }
  return data;
}

/** The full catalog — public, no token needed. */
export async function fetchCatalog(): Promise<CosmeticDefinition[]> {
  const data = (await call("/catalog", "GET")) as { catalog: CosmeticDefinition[] };
  return data.catalog;
}

export async function fetchInventory(
  token: string,
): Promise<{ coins: number; owned: OwnedCosmetic[] }> {
  return (await call("/", "GET", token)) as { coins: number; owned: OwnedCosmetic[] };
}

export async function purchaseCosmetic(token: string, cosmeticId: string): Promise<number> {
  const data = (await call("/purchase", "POST", token, { cosmeticId })) as { coins: number };
  return data.coins;
}

export async function equipCosmetic(token: string, cosmeticId: string): Promise<EquippedCosmetics> {
  const data = (await call("/equip", "POST", token, { cosmeticId })) as {
    loadout: EquippedCosmetics;
  };
  return data.loadout;
}

export async function unequipCosmetic(
  token: string,
  type: CosmeticType,
): Promise<EquippedCosmetics> {
  const data = (await call("/unequip", "POST", token, { type })) as { loadout: EquippedCosmetics };
  return data.loadout;
}
