import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryFriendProvider } from "./provider";

let provider: InMemoryFriendProvider;

function user(id: string, username: string) {
  provider.registerUser({ id, username });
  return { id, username };
}

beforeEach(() => {
  provider = new InMemoryFriendProvider();
});

describe("sendRequest", () => {
  it("creates a pending request between two known users", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");

    const result = await provider.sendRequest(ada.id, bea.username);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("PENDING");
      expect(result.value.requester.id).toBe(ada.id);
      expect(result.value.addressee.id).toBe(bea.id);
    }

    const incoming = await provider.listIncomingRequests(bea.id);
    expect(incoming).toHaveLength(1);
    const outgoing = await provider.listOutgoingRequests(ada.id);
    expect(outgoing).toHaveLength(1);
  });

  it("rejects a request to an unknown username", async () => {
    const ada = user("u1", "Ada");
    const result = await provider.sendRequest(ada.id, "Ghost");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("rejects a request to yourself", async () => {
    const ada = user("u1", "Ada");
    const result = await provider.sendRequest(ada.id, "Ada");
    expect(result).toEqual({ ok: false, error: "self" });
  });

  it("rejects a duplicate pending request in the same direction", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");
    await provider.sendRequest(ada.id, bea.username);
    const again = await provider.sendRequest(ada.id, bea.username);
    expect(again).toEqual({ ok: false, error: "already_pending" });
  });

  it("rejects a request once already friends", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");
    provider.seedFriendship(ada.id, bea.id);
    const result = await provider.sendRequest(ada.id, bea.username);
    expect(result).toEqual({ ok: false, error: "already_friends" });
  });

  it("auto-accepts a crossed request instead of creating a second row", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");
    await provider.sendRequest(bea.id, ada.username); // Bea asks first

    const result = await provider.sendRequest(ada.id, bea.username); // Ada asks back
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("ACCEPTED");
    }
    expect(await provider.areFriends(ada.id, bea.id)).toBe(true);
    // No leftover pending row on either side.
    expect(await provider.listIncomingRequests(ada.id)).toHaveLength(0);
    expect(await provider.listOutgoingRequests(bea.id)).toHaveLength(0);
  });

  it("refuses a request when either side has blocked the other", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");
    provider.seedBlock(bea.id, ada.id);

    const result = await provider.sendRequest(ada.id, bea.username);
    expect(result).toEqual({ ok: false, error: "blocked" });
  });
});

describe("accept / decline", () => {
  it("accepting makes both sides list each other as friends", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");
    const sent = await provider.sendRequest(ada.id, bea.username);
    if (!sent.ok) throw new Error("setup failed");

    const result = await provider.acceptRequest(bea.id, sent.value.id);
    expect(result).toEqual({ ok: true, value: { id: ada.id, username: ada.username } });

    expect(await provider.listFriends(ada.id)).toEqual([{ id: bea.id, username: bea.username }]);
    expect(await provider.listFriends(bea.id)).toEqual([{ id: ada.id, username: ada.username }]);
  });

  it("only the addressee may accept", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");
    const sent = await provider.sendRequest(ada.id, bea.username);
    if (!sent.ok) throw new Error("setup failed");

    const result = await provider.acceptRequest(ada.id, sent.value.id);
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("either the requester or the addressee may decline/cancel a pending request", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");
    const sent = await provider.sendRequest(ada.id, bea.username);
    if (!sent.ok) throw new Error("setup failed");

    const result = await provider.declineRequest(ada.id, sent.value.id);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(await provider.listIncomingRequests(bea.id)).toHaveLength(0);
  });

  it("a stranger may not decline someone else's request", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");
    const carl = user("u3", "Carl");
    const sent = await provider.sendRequest(ada.id, bea.username);
    if (!sent.ok) throw new Error("setup failed");

    const result = await provider.declineRequest(carl.id, sent.value.id);
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("removeFriend", () => {
  it("removes an existing friendship in either direction", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");
    provider.seedFriendship(ada.id, bea.id);

    const result = await provider.removeFriend(bea.id, ada.id);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(await provider.areFriends(ada.id, bea.id)).toBe(false);
  });

  it("errors when there is no friendship to remove", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");
    const result = await provider.removeFriend(ada.id, bea.id);
    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});

describe("block / unblock", () => {
  it("blocking severs an existing friendship", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");
    provider.seedFriendship(ada.id, bea.id);

    const result = await provider.block(ada.id, bea.username);
    expect(result.ok).toBe(true);
    expect(await provider.areFriends(ada.id, bea.id)).toBe(false);
    expect(await provider.isBlocked(ada.id, bea.id)).toBe(true);
  });

  it("blocking severs a pending request", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");
    await provider.sendRequest(ada.id, bea.username);

    await provider.block(bea.id, ada.username);
    expect(await provider.listIncomingRequests(bea.id)).toHaveLength(0);
    expect(await provider.listOutgoingRequests(ada.id)).toHaveLength(0);
  });

  it("is one-directional: only the blocker cannot be un-invited by unblocking the other side", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");
    await provider.block(ada.id, bea.username);

    // isBlocked is symmetric for matching/inviting purposes...
    expect(await provider.isBlocked(bea.id, ada.id)).toBe(true);
    // ...but only Ada's own block list contains Bea.
    expect(await provider.listBlocked(ada.id)).toEqual([{ id: bea.id, username: bea.username }]);
    expect(await provider.listBlocked(bea.id)).toEqual([]);
  });

  it("unblock is idempotent", async () => {
    const ada = user("u1", "Ada");
    const bea = user("u2", "Bea");
    await provider.unblock(ada.id, bea.id); // never blocked — should not throw
    await provider.block(ada.id, bea.username);
    await provider.unblock(ada.id, bea.id);
    await provider.unblock(ada.id, bea.id); // already unblocked
    expect(await provider.isBlocked(ada.id, bea.id)).toBe(false);
  });

  it("rejects blocking yourself", async () => {
    const ada = user("u1", "Ada");
    const result = await provider.block(ada.id, "Ada");
    expect(result).toEqual({ ok: false, error: "self" });
  });
});
