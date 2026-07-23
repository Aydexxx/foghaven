import { beforeEach, describe, expect, it } from "vitest";
import { COSMETIC_TYPE, starterCosmeticIds } from "@foghaven/shared";
import { InMemoryCosmeticProvider } from "./provider";

let provider: InMemoryCosmeticProvider;

beforeEach(() => {
  provider = new InMemoryCosmeticProvider();
});

describe("coins", () => {
  it("starts at zero and accumulates awards", async () => {
    expect(await provider.getCoins("u1")).toBe(0);
    expect(await provider.awardCoins("u1", 25)).toBe(25);
    expect(await provider.awardCoins("u1", 15)).toBe(40);
    expect(await provider.getCoins("u1")).toBe(40);
  });

  it("keeps balances separate per user", async () => {
    await provider.awardCoins("u1", 100);
    expect(await provider.getCoins("u2")).toBe(0);
  });
});

describe("listOwned", () => {
  it("includes every starter item as owned with nothing purchased", async () => {
    const owned = await provider.listOwned("u1");
    const ownedIds = owned.map((o) => o.id).sort();
    expect(ownedIds).toEqual([...starterCosmeticIds()].sort());
    expect(owned.every((o) => !o.equipped)).toBe(true);
  });

  it("includes a purchased item alongside the starters", async () => {
    provider.seedCoins("u1", 500);
    await provider.purchase("u1", "straw_boater");
    const owned = await provider.listOwned("u1");
    expect(owned.map((o) => o.id)).toContain("straw_boater");
  });
});

describe("purchase", () => {
  it("deducts coins and grants ownership", async () => {
    provider.seedCoins("u1", 200);
    const result = await provider.purchase("u1", "straw_boater"); // 150 coins
    expect(result).toEqual({ ok: true, value: { coins: 50 } });
    expect(await provider.getCoins("u1")).toBe(50);
  });

  it("refuses when coins are insufficient", async () => {
    provider.seedCoins("u1", 10);
    const result = await provider.purchase("u1", "straw_boater");
    expect(result).toEqual({ ok: false, error: "insufficient_coins" });
    expect(await provider.getCoins("u1")).toBe(10);
  });

  it("refuses a second purchase of the same item", async () => {
    provider.seedCoins("u1", 1000);
    await provider.purchase("u1", "straw_boater");
    const again = await provider.purchase("u1", "straw_boater");
    expect(again).toEqual({ ok: false, error: "already_owned" });
  });

  it("refuses an unknown cosmetic id", async () => {
    provider.seedCoins("u1", 1000);
    const result = await provider.purchase("u1", "not-a-real-item");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("never charges more than the listed price, even for expensive items", async () => {
    provider.seedCoins("u1", 250);
    const result = await provider.purchase("u1", "golden_sash"); // 250 coins
    expect(result).toEqual({ ok: true, value: { coins: 0 } });
  });
});

describe("equip", () => {
  it("equips a starter item with no purchase required", async () => {
    const result = await provider.equip("u1", "top_hat");
    expect(result).toEqual({
      ok: true,
      value: { hatId: "top_hat", accessoryId: "", petId: "", outfitId: "", victoryPoseId: "", deathEffectId: "" },
    });
  });

  it("refuses to equip a paid item that was never purchased", async () => {
    const result = await provider.equip("u1", "straw_boater");
    expect(result).toEqual({ ok: false, error: "not_owned" });
  });

  it("equips a purchased item", async () => {
    provider.seedCoins("u1", 1000);
    await provider.purchase("u1", "straw_boater");
    const result = await provider.equip("u1", "straw_boater");
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ hatId: "straw_boater" }) });
  });

  it("equipping a second hat swaps out the first — never both at once", async () => {
    provider.seedCoins("u1", 1000);
    await provider.equip("u1", "top_hat");
    await provider.purchase("u1", "feathered_cap");
    const result = await provider.equip("u1", "feathered_cap");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hatId).toBe("feathered_cap");
    }
  });

  it("different slots don't interfere with each other", async () => {
    await provider.equip("u1", "top_hat");
    const result = await provider.equip("u1", "spectacles");
    expect(result).toEqual({
      ok: true,
      value: {
        hatId: "top_hat",
        accessoryId: "spectacles",
        petId: "",
        outfitId: "",
        victoryPoseId: "",
        deathEffectId: "",
      },
    });
  });

  it("refuses an unknown cosmetic id", async () => {
    const result = await provider.equip("u1", "not-a-real-item");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});

describe("unequip", () => {
  it("clears exactly one slot, leaving the rest intact", async () => {
    await provider.equip("u1", "top_hat");
    await provider.equip("u1", "spectacles");
    const loadout = await provider.unequip("u1", COSMETIC_TYPE.HAT);
    expect(loadout.hatId).toBe("");
    expect(loadout.accessoryId).toBe("spectacles");
  });

  it("is a no-op when nothing of that type is equipped", async () => {
    const loadout = await provider.unequip("u1", COSMETIC_TYPE.PET);
    expect(loadout.petId).toBe("");
  });
});

describe("getLoadout", () => {
  it("reflects only what is currently equipped, not everything owned", async () => {
    provider.seedCoins("u1", 1000);
    await provider.purchase("u1", "straw_boater"); // owned, not equipped
    await provider.equip("u1", "top_hat"); // equipped instead
    const loadout = await provider.getLoadout("u1");
    expect(loadout.hatId).toBe("top_hat");
  });

  it("is empty for a user with nothing equipped", async () => {
    const loadout = await provider.getLoadout("u1");
    expect(loadout).toEqual({
      hatId: "",
      accessoryId: "",
      petId: "",
      outfitId: "",
      victoryPoseId: "",
      deathEffectId: "",
    });
  });
});
