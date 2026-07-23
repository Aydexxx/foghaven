import { describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { createHealthRouter, type HealthChecks } from "./healthRoutes";

function buildApp(checks: HealthChecks): Express {
  const app = express();
  app.use("/health", createHealthRouter(checks));
  return app;
}

const ok: HealthChecks = { db: async () => 1, redis: async () => "PONG" };

describe("GET /health", () => {
  it("is 200 without touching any dependency", async () => {
    let touched = false;
    const res = await request(
      buildApp({
        db: async () => {
          touched = true;
          return 1;
        },
        redis: async () => {
          touched = true;
          return "PONG";
        },
      }),
    ).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(touched).toBe(false);
  });
});

describe("GET /health/ready", () => {
  it("is 200 when both Postgres and Redis are reachable", async () => {
    const res = await request(buildApp(ok)).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready", db: true, redis: true });
  });

  it("is 503 and names the failing dependency when Redis is down", async () => {
    const res = await request(
      buildApp({
        db: async () => 1,
        redis: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    ).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "unavailable", db: true, redis: false });
  });

  it("is 503 when Postgres is down", async () => {
    const res = await request(
      buildApp({
        db: async () => {
          throw new Error("db unreachable");
        },
        redis: async () => "PONG",
      }),
    ).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "unavailable", db: false, redis: true });
  });
});
