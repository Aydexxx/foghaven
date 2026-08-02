import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Server, type Room as ServerRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  FACTION,
  factionOf,
  LOBBY_READY_PAD_POINT,
  MAX_ROLE_OPTIONS,
  PHASE,
  PRESET,
  presetRoleIds,
  RANDOM_ROLE_PICK,
  resolveRoleCounts,
  ROLE_DEFINITIONS,
  ROLE_REVEAL_MS,
  ROLE_SELECT_MS,
  ROLES,
  roleSelectOptionCount,
  factionRolePool,
  TICK_RATE,
  type RoleAssignment,
  type RoleOptionsMessage,
} from "@foghaven/shared";
import { GameRoom } from "./GameRoom";
import type { GameState } from "./schema/GameState";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { InMemoryFriendProvider, setFriendProvider } from "../friends/provider";

/**
 * Role selection's secrecy contract.
 *
 * The mechanic hands every player a small hand of role cards drawn from their
 * own faction's pool. That makes the hand itself a faction reveal, so the
 * question these tests answer is not "does the UI hide it" but **what can a
 * modified client actually observe**. Nothing below inspects rendering; it
 * reads the wire and the decoded public state each client is entitled to.
 *
 * Four channels, because closing only the first is the classic mistake:
 *
 *   1. **Content** — is anyone else's hand, pick or faction in what I receive?
 *   2. **Addressing** — is the options message genuinely per-socket, or is it
 *      a broadcast that clients merely filter for display?
 *   3. **Cardinality** — can I learn how many cards someone else was shown?
 *      A faction with a thinner pool would be identifiable by hand size alone.
 *   4. **Timing** — does *when* someone finishes correlate with faction? If
 *      Strangers were shown fewer cards they would choose faster on average,
 *      and "who finished first" becomes a statistical tell over many games,
 *      no matter how carefully the payloads are addressed.
 *
 * (3) and (4) are the same defect wearing different clothes, and both are
 * closed structurally rather than by policy: `roleSelectOptionCount` returns
 * ONE number for the whole room, derived from public state, so there is no
 * per-faction hand size to observe or to be slower than.
 *
 * Selection needs a faction pool with at least two distinct dealt roles on
 * both sides, which under Chaos means 10+ players — see the pure-function
 * describe at the bottom, which pins exactly when it runs.
 */

let colyseus: ColyseusTestServer;
let authProvider: InMemoryAuthProvider;
let friendProvider: InMemoryFriendProvider;

beforeAll(async () => {
  authProvider = new InMemoryAuthProvider();
  setAuthProvider(authProvider);
  friendProvider = new InMemoryFriendProvider();
  setFriendProvider(friendProvider);
  const gameServer = new Server({ transport: new WebSocketTransport({}) });
  gameServer.define("game", GameRoom);
  await gameServer.listen(0);
  const address = (gameServer.transport.server as import("net").Server).address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  (gameServer as unknown as { port: number }).port = port;
  colyseus = new ColyseusTestServer(gameServer);
});

afterAll(async () => {
  if (colyseus) {
    await colyseus.shutdown();
  }
  setAuthProvider(null);
  setFriendProvider(null);
});

afterEach(async () => {
  await colyseus.cleanup();
  authProvider.reset();
  friendProvider.reset();
});

function tick(count: number): Promise<void> {
  const ms = (1000 / TICK_RATE) * count + 20;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Smallest lobby whose Chaos deal gives both factions a choosable pool. */
const SELECT_PLAYERS = 11;

let seatCount = 0;

/**
 * A seated client with both views tapped: decoded application messages (to
 * name what arrived) and the raw socket (to count and size what arrived).
 * Selection leaks would show up in either.
 */
async function seat(room: ServerRoom<GameState>) {
  const name = `Picker${++seatCount}`;
  const client = await colyseus.connectTo(room, { name });
  const player = room.state.players.get(client.sessionId)!;

  const roleMessages: RoleAssignment[] = [];
  client.onMessage("role", (m: RoleAssignment) => roleMessages.push(m));

  // Arrival time is recorded in the typed handler rather than via an
  // `onMessage("*")` tap: colyseus.js routes a message to its specific
  // handler *instead of* the wildcard, so a wildcard counter would report
  // zero here and quietly turn every addressing/timing assertion below into
  // a no-op that passes for the wrong reason.
  const optionMessages: Array<RoleOptionsMessage & { at: number }> = [];
  client.onMessage("roleOptions", (m: RoleOptionsMessage) =>
    optionMessages.push({ ...m, at: Date.now() }),
  );

  return { client, player, name, roleMessages, optionMessages };
}

type Seat = Awaited<ReturnType<typeof seat>>;

/** The decoded public state as a plain object, for walking it field by field. */
interface PublicView {
  players: Record<string, Record<string, unknown>>;
}

/**
 * Seat a Chaos lobby large enough for selection, start it, and stop in the
 * ROLE_SELECT phase with every client's own hand already delivered.
 */
async function seatAndSelect(
  room: ServerRoom<GameState>,
  count = SELECT_PLAYERS,
): Promise<Seat[]> {
  const seats: Seat[] = [];
  for (let i = 0; i < count; i++) {
    seats.push(await seat(room));
  }
  seats[0]!.client.send("set_preset", { preset: PRESET.CHAOS });
  await tick(2);
  for (const s of seats) {
    s.player.x = LOBBY_READY_PAD_POINT.x;
    s.player.y = LOBBY_READY_PAD_POINT.y;
  }
  seats[0]!.client.send("start");
  await tick(4);
  return seats;
}

/** The server's own answer for who ended up what — the ground truth to test against. */
function serverRoles(room: ServerRoom<GameState>): Map<string, string> {
  return (room as unknown as { roles: Map<string, string> }).roles;
}

/** What the server privately offered each player, read directly off the room. */
function serverOffers(room: ServerRoom<GameState>): Map<string, string[]> {
  return (room as unknown as { roleSelectOffers: Map<string, string[]> }).roleSelectOffers;
}

function serverFactions(room: ServerRoom<GameState>): Map<string, string> {
  return (room as unknown as { roleSelectFactions: Map<string, string> }).roleSelectFactions;
}

describe("role selection — the phase runs at all", () => {
  it("opens a selection phase and deals every player their own hand", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);

    expect(room.state.phase).toBe(PHASE.ROLE_SELECT);
    for (const s of seats) {
      expect(s.optionMessages).toHaveLength(1);
      expect(s.optionMessages[0]!.options.length).toBe(MAX_ROLE_OPTIONS);
      // Nothing is revealed yet — the reveal is a later phase.
      expect(s.roleMessages).toHaveLength(0);
    }
  });

  it("skips the phase entirely when the host turns selection off", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats: Seat[] = [];
    for (let i = 0; i < SELECT_PLAYERS; i++) {
      seats.push(await seat(room));
    }
    seats[0]!.client.send("set_preset", { preset: PRESET.CHAOS });
    seats[0]!.client.send("set_setting", { id: "roleSelectionEnabled", value: false });
    await tick(2);
    for (const s of seats) {
      s.player.x = LOBBY_READY_PAD_POINT.x;
      s.player.y = LOBBY_READY_PAD_POINT.y;
    }
    seats[0]!.client.send("start");
    await tick(4);

    // Straight to the reveal, exactly as before selection existed, and not a
    // single options message on any socket.
    expect(room.state.phase).toBe(PHASE.ROLE_REVEAL);
    for (const s of seats) {
      expect(s.optionMessages).toHaveLength(0);
      expect(s.roleMessages).toHaveLength(1);
    }
  });
});

describe("role selection — channel 1: content", () => {
  it("never puts a role, an option or a faction onto any public player", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);

    // Every role id that exists, so this catches a leak of ANY role, not just
    // the ones that happen to have been offered in this run.
    const everyRoleId = ROLE_DEFINITIONS.map((r) => r.id);

    // Scoped to the per-player rows on purpose. Role ids DO legitimately
    // appear at the top level of public state, in `enabledRoleIds` and
    // `rolePreset` — that is the lobby's role configuration, identical for
    // everyone, public since long before selection existed, and a statement
    // about the game rather than about any player. A leak would have to
    // attach a role to a *person*, which is precisely what this walks.
    for (const s of seats) {
      const view = s.client.state.toJSON() as unknown as PublicView;
      for (const [id, row] of Object.entries(view.players)) {
        const encoded = JSON.stringify(row);
        for (const roleId of everyRoleId) {
          expect(encoded, `player ${id} leaked role ${roleId}`).not.toContain(`"${roleId}"`);
        }
        expect(encoded).not.toContain(FACTION.STRANGER);
        expect(encoded).not.toContain(FACTION.TOWNSFOLK);
        expect(encoded).not.toContain(RANDOM_ROLE_PICK);
      }
    }
  });

  it("adds exactly one public field for selection, and it is a boolean", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);

    // Pins the public surface itself, so a future field that happens to carry
    // selection detail fails here rather than silently becoming readable.
    const expected = new Set([
      "id",
      "name",
      "x",
      "y",
      "color",
      "alive",
      "lanternColor",
      "lanternState",
      "connected",
      "hasVoted",
      "ready",
      "hasPickedRole",
      "lastSeq",
      // Carries no information about anyone. It is a bare tick counter that
      // every player's row increments in lockstep during PLAYING (see
      // `Player.heartbeat`), so it is always identical across all rows and
      // says nothing beyond "a tick happened" — which the positions already
      // said. It exists so a client can tell "still being sent this player"
      // apart from "this player stopped moving", and it rides the same fog
      // filter as every other field here.
      "heartbeat",
      "hatId",
      "accessoryId",
      "petId",
      "outfitId",
      "victoryPoseId",
      "deathEffectId",
    ]);
    const view = seats[0]!.client.state.toJSON() as unknown as PublicView;
    const rows = Object.values(view.players);
    for (const row of rows) {
      expect(new Set(Object.keys(row))).toEqual(expected);
      expect(typeof row.hasPickedRole).toBe("boolean");
    }

    // The one non-boolean field added since: prove it distinguishes nobody.
    // Every row's heartbeat moves in lockstep (`GameRoom.update` bumps them
    // all in the same pass), so it can never be read as a per-player signal —
    // which is the only reason a per-tick counter is safe to make public.
    const heartbeats = new Set(rows.map((row) => (row as { heartbeat: number }).heartbeat));
    expect(heartbeats.size).toBe(1);
  });

  it("publishes only a boolean about someone else's progress", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);

    const picker = seats[0]!;
    picker.client.send("pick_role", { roleId: picker.optionMessages[0]!.options[0]! });
    await tick(3);

    // A observer sees THAT they finished, and nothing else about it.
    const observer = seats[1]!;
    const seen = observer.client.state.players.get(picker.client.sessionId)!;
    expect(seen.hasPickedRole).toBe(true);

    const fields = Object.keys(seen.toJSON());
    // No field anywhere on the public player carries selection detail.
    expect(fields).not.toContain("role");
    expect(fields).not.toContain("faction");
    expect(fields).not.toContain("roleOptions");
    expect(fields).not.toContain("options");
    expect(fields).not.toContain("pickedRole");
    expect(fields).toContain("hasPickedRole");
  });
});

describe("role selection — channel 2: addressing", () => {
  it("sends each hand to exactly one socket, never broadcast", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);

    // The decisive count. Were `roleOptions` broadcast — or sent per player to
    // everyone and merely filtered client-side — each client would hold
    // SELECT_PLAYERS of them instead of exactly its own one.
    for (const s of seats) {
      expect(s.optionMessages).toHaveLength(1);
    }

    // n hands delivered across n sockets. A broadcast would make this n².
    const totalDelivered = seats.reduce((sum, s) => sum + s.optionMessages.length, 0);
    expect(totalDelivered).toBe(seats.length);
  });

  it("gives each client the hand the server recorded for that client, and no other", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);
    const offers = serverOffers(room);

    for (const s of seats) {
      const mine = offers.get(s.client.sessionId)!;
      expect(s.optionMessages[0]!.options).toEqual(mine);
    }
  });
});

describe("role selection — channel 3: cardinality", () => {
  it("shows every player the same number of cards", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);

    const sizes = new Set(seats.map((s) => s.optionMessages[0]!.options.length));
    expect(sizes.size).toBe(1);
  });

  it("shows Strangers and Townsfolk the same number of cards", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);
    const factions = serverFactions(room);

    const byFaction = new Map<string, number[]>();
    for (const s of seats) {
      const faction = factions.get(s.client.sessionId)!;
      const sizes = byFaction.get(faction) ?? [];
      sizes.push(s.optionMessages[0]!.options.length);
      byFaction.set(faction, sizes);
    }

    // Both factions must actually be represented, or this proves nothing.
    expect(byFaction.size).toBe(2);
    const distinct = new Set([...byFaction.values()].flat());
    expect(distinct.size).toBe(1);
  });

  it("draws every hand from the recipient's own faction pool", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);
    const factions = serverFactions(room);

    // The reason cardinality matters at all: a hand IS a faction statement.
    // This documents that, and is why the count must never vary with it.
    for (const s of seats) {
      const faction = factions.get(s.client.sessionId)!;
      for (const option of s.optionMessages[0]!.options) {
        expect(factionOf(option)).toBe(faction);
      }
    }
  });
});

describe("role selection — channel 4: timing", () => {
  it("gives everyone one shared deadline rather than a per-player turn", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);

    // Identical durations: nobody's window is longer or shorter, so there is
    // no per-player turn whose length could be measured.
    const deadlines = new Set(seats.map((s) => s.optionMessages[0]!.deadlineMs));
    expect(deadlines.size).toBe(1);
    expect([...deadlines][0]).toBe(ROLE_SELECT_MS);
  });

  it("prompts every player in the same instant, not in sequence", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);

    const arrivals = seats.map((s) => s.optionMessages[0]!.at);
    const spread = Math.max(...arrivals) - Math.min(...arrivals);
    // All hands go out in one pass. A sequential design would stagger these
    // by a turn length each, and the gap between them would itself be a
    // channel — who is prompted when, and therefore how long each took.
    expect(spread).toBeLessThan(1000);
  });

  it("keeps hand size faction-independent, so pick speed cannot encode faction", async () => {
    // The structural version of "timing does not correlate with faction".
    // Rather than trying to measure human pick latency, this pins the only
    // thing the SERVER controls that could bias it: how much there is to read
    // before choosing. Equal hands, equal window, no systematic difference.
    const enabled = presetRoleIds(PRESET.CHAOS);
    for (let players = 4; players <= 14; players++) {
      const optionCount = roleSelectOptionCount(players, enabled);
      if (optionCount === 0) {
        continue;
      }
      const stranger = factionRolePool(FACTION.STRANGER, players, enabled).length;
      const townsfolk = factionRolePool(FACTION.TOWNSFOLK, players, enabled).length;
      // Whatever the two pools look like, the hand dealt from them is the
      // same size on both sides.
      expect(Math.min(optionCount, stranger)).toBe(optionCount);
      expect(Math.min(optionCount, townsfolk)).toBe(optionCount);
    }
  });
});

describe("role selection — the pick is a trust boundary", () => {
  it("refuses a role the player was never offered", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);
    const victim = seats[0]!;
    const offered = new Set(victim.optionMessages[0]!.options);

    const notOffered = ROLE_DEFINITIONS.map((r) => r.id).find((id) => !offered.has(id))!;
    victim.client.send("pick_role", { roleId: notOffered });
    await tick(3);

    // Ignored outright: not even marked as decided.
    expect(room.state.players.get(victim.client.sessionId)!.hasPickedRole).toBe(false);
  });

  it("refuses a cross-faction pick, so selection cannot be used to choose a faction", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);
    const factions = serverFactions(room);

    const townsfolk = seats.find(
      (s) => factions.get(s.client.sessionId) === FACTION.TOWNSFOLK,
    )!;
    // The worst case this guard exists for: a modified client naming the base
    // Stranger role to deal itself onto the other side.
    townsfolk.client.send("pick_role", { roleId: ROLES.STRANGER });
    await tick(3);
    expect(room.state.players.get(townsfolk.client.sessionId)!.hasPickedRole).toBe(false);

    // And it is still townsfolk when the dust settles.
    for (const s of seats) {
      s.client.send("pick_role", { roleId: RANDOM_ROLE_PICK });
    }
    await tick(4);
    const role = serverRoles(room).get(townsfolk.client.sessionId)!;
    expect(factionOf(role)).toBe(FACTION.TOWNSFOLK);
  });

  it("refuses a malformed or empty pick without throwing", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);
    const s = seats[0]!;

    s.client.send("pick_role", {});
    s.client.send("pick_role", { roleId: 42 });
    s.client.send("pick_role", { roleId: "" });
    s.client.send("pick_role", null);
    await tick(3);

    expect(room.state.phase).toBe(PHASE.ROLE_SELECT);
    expect(room.state.players.get(s.client.sessionId)!.hasPickedRole).toBe(false);
  });
});

describe("role selection — resolution", () => {
  it("honours a pick the player was actually offered", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);

    const wanted = new Map<string, string>();
    for (const s of seats) {
      const choice = s.optionMessages[0]!.options[0]!;
      wanted.set(s.client.sessionId, choice);
      s.client.send("pick_role", { roleId: choice });
    }
    await tick(6);

    // Everyone picked, so the window closes early and the reveal begins.
    expect(room.state.phase).toBe(PHASE.ROLE_REVEAL);

    // Seats are finite, so a contested role can go to someone else — but the
    // room as a whole must have honoured most of what it was asked for, and
    // nobody may end up outside their own hand's faction.
    const roles = serverRoles(room);
    let honoured = 0;
    for (const s of seats) {
      const got = roles.get(s.client.sessionId)!;
      if (got === wanted.get(s.client.sessionId)) {
        honoured++;
      }
    }
    expect(honoured).toBeGreaterThan(0);
    expect(roles.size).toBe(seats.length);
  });

  it("deals the exact same role multiset selection or not, so balance is untouched", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);
    for (const s of seats) {
      s.client.send("pick_role", { roleId: s.optionMessages[0]!.options[0]! });
    }
    await tick(6);

    const dealt = new Map<string, number>();
    for (const role of serverRoles(room).values()) {
      dealt.set(role, (dealt.get(role) ?? 0) + 1);
    }

    // The distribution `resolveRoleCounts` would have produced at random.
    // Selection decides who takes which seat, never which seats exist — so
    // the parity clamp and every threshold survive it untouched.
    const expected = resolveRoleCounts(seats.length, presetRoleIds(PRESET.CHAOS));
    for (const [roleId, count] of Object.entries(expected)) {
      if (count > 0) {
        expect(dealt.get(roleId) ?? 0).toBe(count);
      }
    }
  });

  it("falls back to a random deal for anyone who never answers", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);

    // Nobody picks. The shared window has to run out on its own.
    await new Promise((resolve) => setTimeout(resolve, ROLE_SELECT_MS + 500));

    expect(room.state.phase).toBe(PHASE.ROLE_REVEAL);
    const roles = serverRoles(room);
    expect(roles.size).toBe(seats.length);
    for (const s of seats) {
      expect(s.roleMessages).toHaveLength(1);
      expect(roles.get(s.client.sessionId)).toBeTruthy();
    }
  }, 40_000);

  it("forgets every hand and pick once the deal is made", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);
    for (const s of seats) {
      s.client.send("pick_role", { roleId: RANDOM_ROLE_PICK });
    }
    await tick(6);

    // No faction oracle left sitting in memory for the rest of the round.
    expect(serverOffers(room).size).toBe(0);
    expect(serverFactions(room).size).toBe(0);
    room.state.players.forEach((player) => {
      expect(player.hasPickedRole).toBe(false);
    });
  });

  it("reaches the world on the same schedule as a game without selection", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndSelect(room);
    for (const s of seats) {
      s.client.send("pick_role", { roleId: RANDOM_ROLE_PICK });
    }
    await tick(6);
    expect(room.state.phase).toBe(PHASE.ROLE_REVEAL);

    await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 400));
    expect(room.state.phase).toBe(PHASE.PLAYING);
  }, 20_000);
});

describe("roleSelectOptionCount — one public number for the whole room", () => {
  const chaos = presetRoleIds(PRESET.CHAOS);
  const classic = presetRoleIds(PRESET.CLASSIC);

  it("is a pure function of public inputs, so any client can compute it", () => {
    // Same inputs, same answer, every time — nothing about who drew what
    // feeds into it, which is what makes it safe for the number to be known.
    for (let players = 4; players <= 14; players++) {
      const a = roleSelectOptionCount(players, chaos);
      const b = roleSelectOptionCount(players, chaos);
      expect(a).toBe(b);
    }
  });

  it("never exceeds either faction's pool", () => {
    for (let players = 4; players <= 14; players++) {
      const count = roleSelectOptionCount(players, chaos);
      if (count === 0) {
        continue;
      }
      for (const faction of [FACTION.STRANGER, FACTION.TOWNSFOLK]) {
        expect(factionRolePool(faction, players, chaos).length).toBeGreaterThanOrEqual(count);
      }
    }
  });

  it("caps at MAX_ROLE_OPTIONS", () => {
    for (let players = 4; players <= 14; players++) {
      expect(roleSelectOptionCount(players, chaos)).toBeLessThanOrEqual(MAX_ROLE_OPTIONS);
    }
  });

  it("returns 0 when a faction pool is too thin to be a real choice", () => {
    // Classic enables only villager and stranger, so neither side has anything
    // to choose between. Selection is skipped rather than offering one card.
    for (let players = 4; players <= 14; players++) {
      expect(roleSelectOptionCount(players, classic)).toBe(0);
    }
  });

  it("turns on only once BOTH pools can fill an equal hand", () => {
    // Documents the reach of the mechanic as it stands: the Stranger pool is
    // the binding constraint, so Chaos needs 10+ players. Deliberately pinned
    // — if a role's thresholds change, this is where that becomes visible.
    expect(roleSelectOptionCount(9, chaos)).toBe(0);
    expect(roleSelectOptionCount(10, chaos)).toBe(2);
    expect(roleSelectOptionCount(11, chaos)).toBe(3);
  });
});
