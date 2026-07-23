import { beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { COSMETIC_TYPE } from "@foghaven/shared";
import { signToken } from "../auth/token";
import { InMemoryCosmeticProvider, setCosmeticProvider } from "../cosmetics/provider";
import { createCosmeticsRouter } from "./cosmeticsRoutes";

let provider: InMemoryCosmeticProvider;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/cosmetics", createCosmeticsRouter());
  return app;
}

function auth(userId: string) {
  return { Authorization: `Bearer ${signToken(userId)}` };
}

beforeEach(() => {
  provider = new InMemoryCosmeticProvider();
  setCosmeticProvider(provider);
});

describe("GET /cosmetics/catalog", () => {
  it("is reachable with no token at all", async () => {
    const res = await request(buildApp()).get("/cosmetics/catalog");
    expect(res.status).toBe(200);
    expect(res.body.catalog.length).toBeGreaterThan(0);
    expect(res.body.catalog.some((c: { id: string }) => c.id === "top_hat")).toBe(true);
  });
});

describe("authentication on the account-scoped routes", () => {
  it("refuses every other route without a bearer token", async () => {
    const app = buildApp();
    expect((await request(app).get("/cosmetics")).status).toBe(401);
    expect((await request(app).post("/cosmetics/purchase").send({ cosmeticId: "x" })).status).toBe(401);
    expect((await request(app).post("/cosmetics/equip").send({ cosmeticId: "x" })).status).toBe(401);
    expect(
      (await request(app).post("/cosmetics/unequip").send({ type: COSMETIC_TYPE.HAT })).status,
    ).toBe(401);
  });

  it("refuses a forged token", async () => {
    const res = await request(buildApp())
      .get("/cosmetics")
      .set("Authorization", "Bearer not-a-real-jwt");
    expect(res.status).toBe(401);
  });
});

describe("GET /cosmetics", () => {
  it("reports coins and owned items, starters included", async () => {
    provider.seedCoins("u1", 300);
    const res = await request(buildApp()).get("/cosmetics").set(auth("u1"));
    expect(res.status).toBe(200);
    expect(res.body.coins).toBe(300);
    expect(res.body.owned.some((o: { id: string }) => o.id === "top_hat")).toBe(true);
  });
});

describe("POST /cosmetics/purchase", () => {
  it("purchases an item and returns the new balance", async () => {
    provider.seedCoins("u1", 200);
    const res = await request(buildApp())
      .post("/cosmetics/purchase")
      .set(auth("u1"))
      .send({ cosmeticId: "straw_boater" });
    expect(res.status).toBe(200);
    expect(res.body.coins).toBe(50);
  });

  it("402s on insufficient coins", async () => {
    provider.seedCoins("u1", 10);
    const res = await request(buildApp())
      .post("/cosmetics/purchase")
      .set(auth("u1"))
      .send({ cosmeticId: "straw_boater" });
    expect(res.status).toBe(402);
    expect(res.body.error).toBe("insufficient_coins");
  });

  it("409s a duplicate purchase", async () => {
    provider.seedCoins("u1", 1000);
    const app = buildApp();
    await request(app).post("/cosmetics/purchase").set(auth("u1")).send({ cosmeticId: "straw_boater" });
    const again = await request(app)
      .post("/cosmetics/purchase")
      .set(auth("u1"))
      .send({ cosmeticId: "straw_boater" });
    expect(again.status).toBe(409);
  });

  it("404s an unknown item and 400s a missing id", async () => {
    const app = buildApp();
    const unknown = await request(app)
      .post("/cosmetics/purchase")
      .set(auth("u1"))
      .send({ cosmeticId: "not-real" });
    expect(unknown.status).toBe(404);

    const missing = await request(app).post("/cosmetics/purchase").set(auth("u1")).send({});
    expect(missing.status).toBe(400);
  });

  it("one account's purchase never touches another account's coins", async () => {
    provider.seedCoins("u1", 1000);
    provider.seedCoins("u2", 5);
    await request(buildApp()).post("/cosmetics/purchase").set(auth("u1")).send({ cosmeticId: "straw_boater" });
    expect(await provider.getCoins("u2")).toBe(5);
  });
});

describe("POST /cosmetics/equip", () => {
  it("equips a starter item with no purchase needed", async () => {
    const res = await request(buildApp())
      .post("/cosmetics/equip")
      .set(auth("u1"))
      .send({ cosmeticId: "top_hat" });
    expect(res.status).toBe(200);
    expect(res.body.loadout.hatId).toBe("top_hat");
  });

  it("403s equipping something never purchased", async () => {
    const res = await request(buildApp())
      .post("/cosmetics/equip")
      .set(auth("u1"))
      .send({ cosmeticId: "straw_boater" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_owned");
  });

  it("404s an unknown item", async () => {
    const res = await request(buildApp())
      .post("/cosmetics/equip")
      .set(auth("u1"))
      .send({ cosmeticId: "not-real" });
    expect(res.status).toBe(404);
  });
});

describe("POST /cosmetics/unequip", () => {
  it("clears the given slot", async () => {
    const app = buildApp();
    await request(app).post("/cosmetics/equip").set(auth("u1")).send({ cosmeticId: "top_hat" });
    const res = await request(app)
      .post("/cosmetics/unequip")
      .set(auth("u1"))
      .send({ type: COSMETIC_TYPE.HAT });
    expect(res.status).toBe(200);
    expect(res.body.loadout.hatId).toBe("");
  });

  it("400s an invalid type", async () => {
    const res = await request(buildApp())
      .post("/cosmetics/unequip")
      .set(auth("u1"))
      .send({ type: "not-a-real-type" });
    expect(res.status).toBe(400);
  });
});

describe("no cosmetic anywhere in the catalog implies a gameplay effect", () => {
  it("every catalog entry is one of the six purely-decorative types", async () => {
    const res = await request(buildApp()).get("/cosmetics/catalog");
    const allowed = new Set(Object.values(COSMETIC_TYPE));
    for (const item of res.body.catalog) {
      expect(allowed.has(item.type)).toBe(true);
    }
  });
});

describe("503 when the provider isn't installed", () => {
  it("answers unavailable rather than crashing", async () => {
    setCosmeticProvider(null);
    const res = await request(buildApp()).get("/cosmetics").set(auth("u1"));
    expect(res.status).toBe(503);
  });
});
