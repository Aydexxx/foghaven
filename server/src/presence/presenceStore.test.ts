import { describe, expect, it } from "vitest";
import { InMemoryPresenceStore } from "./presenceStore";

describe("InMemoryPresenceStore", () => {
  it("reports online only after the first connection, offline after the last", async () => {
    const store = new InMemoryPresenceStore();
    expect(await store.isOnline("u1")).toBe(false);

    expect(await store.connect("u1")).toBe(true); // 0 -> 1, a real transition
    expect(await store.isOnline("u1")).toBe(true);

    expect(await store.disconnect("u1")).toBe(true); // 1 -> 0
    expect(await store.isOnline("u1")).toBe(false);
  });

  it("only the first connection and the last disconnection are transitions", async () => {
    const store = new InMemoryPresenceStore();
    await store.connect("u1"); // tab 1
    expect(await store.connect("u1")).toBe(false); // tab 2 — already online
    expect(await store.disconnect("u1")).toBe(false); // tab 2 closes — tab 1 still open
    expect(await store.isOnline("u1")).toBe(true);
    expect(await store.disconnect("u1")).toBe(true); // tab 1 closes — now offline
  });

  it("disconnecting past zero does not go negative or misreport online", async () => {
    const store = new InMemoryPresenceStore();
    expect(await store.disconnect("u1")).toBe(true);
    expect(await store.isOnline("u1")).toBe(false);
    expect(await store.connect("u1")).toBe(true);
  });

  it("onlineAmong filters a list down to who's actually online", async () => {
    const store = new InMemoryPresenceStore();
    await store.connect("u1");
    await store.connect("u3");

    const online = await store.onlineAmong(["u1", "u2", "u3", "u4"]);
    expect(online).toEqual(new Set(["u1", "u3"]));
  });

  it("onlineAmong of an empty list is empty, with no store lookups", async () => {
    const store = new InMemoryPresenceStore();
    expect(await store.onlineAmong([])).toEqual(new Set());
  });
});
